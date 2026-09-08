import { EventEmitter } from "node:events"

import makeWASocket, {
  DisconnectReason,
  jidNormalizedUser,
  WAMessageStubType,
  WAMessageStatus,
  useMultiFileAuthState
} from "@whiskeysockets/baileys"
import {
  classifyDisconnect,
  SessionHealthMonitor,
  generateFingerprint,
  applyFingerprint,
  getStealthSocketConfig,
  rampPresenceAfterConnect,
  AbortError,
  readReceiptVariance,
  generateSessionFingerprint,
  applySessionFingerprint,
  getRetryJitter,
} from "baileys-antiban"
import pino from "pino"

import { isWhatsAppUserJid, toWhatsAppJid } from "../utils/jid.js"
import { createHumanEntropyService } from "./human-entropy.js"
import { OperationAbortedError } from "../utils/sleep.js"
import {
  calculateReconnectDelay,
  getDisconnectConflictType,
  getDisconnectReasonName,
  getDisconnectStatusCode,
  shouldReconnect
} from "./reconnect-policy.js"
import { renderTerminalQr } from "./qr-renderer.js"
import {
  MessageDeliveryTimeoutError,
  SESSION_STATE,
  SessionNotReadyError
} from "./session-state.js"

function toTargetJid(target) {
  return isWhatsAppUserJid(target) ? target : toWhatsAppJid(target)
}

export class WhatsAppSession {
  #authStateLoader
  #baileysLogger
  #disconnectReason
  #events = new EventEmitter()
  #makeSocket
  #messageStatuses = new Map()
  #sessionHealthMonitor = null
  #humanEntropy = null
  #humanEntropyFactory
  #qrRenderer
  #reconnectTimer = null
  #saveCreds = null
  #socket = null
  #stopping = false
  #generateFingerprint
  #applyFingerprint
  #getStealthSocketConfig
  #rampPresenceAfterConnect
  #readReceiptVariance
  #generateSessionFingerprint
  #applySessionFingerprint
  #getRetryJitter
  #fingerprint = null
  #sessionFingerprint = null
  #presenceRampController = null
  #readReceiptVarianceController = null

  constructor(options) {
    this.name = options.name
    this.authDirectory = options.authDirectory
    this.logger = options.logger
    this.reconnectLimit = options.reconnectLimit
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs
    this.showRawQr = options.showRawQr ?? false
    const sessionHealth = options.sessionHealth ?? { enabled: true }
    this.sessionHealthConfig = sessionHealth
    this.humanEntropyConfig = options.humanEntropy ?? { enabled: false }
    this.deviceFingerprintConfig = options.deviceFingerprint ?? {
      enabled: false
    }
    this.stealthConnectConfig = options.stealthConnect ?? {
      enabled: false,
      presenceRampMinMs: 30000,
      presenceRampMaxMs: 90000
    }
    this.readReceiptVarianceConfig = options.readReceiptVariance ?? {
      enabled: false,
      meanMs: 1500,
      stdDevMs: 800
    }
    this.sessionFingerprintConfig = options.sessionFingerprint ?? {
      enabled: false
    }
    this.state = SESSION_STATE.STOPPED
    this.reconnectAttempt = 0
    this.userJid = null
    this.#makeSocket = options.makeSocket ?? makeWASocket
    this.#authStateLoader = options.authStateLoader ?? useMultiFileAuthState
    this.#qrRenderer = options.qrRenderer ?? renderTerminalQr
    this.#disconnectReason = options.disconnectReason ?? DisconnectReason
    this.#baileysLogger = options.baileysLogger ?? pino({ level: "silent" })
    this.#generateFingerprint = options.generateFingerprint ?? generateFingerprint
    this.#applyFingerprint = options.applyFingerprint ?? applyFingerprint
    this.#getStealthSocketConfig =
      options.getStealthSocketConfig ?? getStealthSocketConfig
    this.#rampPresenceAfterConnect =
      options.rampPresenceAfterConnect ?? rampPresenceAfterConnect
    this.#readReceiptVariance = options.readReceiptVarianceFactory ?? readReceiptVariance
    this.#generateSessionFingerprint =
      options.generateSessionFingerprint ?? generateSessionFingerprint
    this.#applySessionFingerprint =
      options.applySessionFingerprint ?? applySessionFingerprint
    this.#getRetryJitter = options.getRetryJitter ?? getRetryJitter
    this.#humanEntropyFactory =
      options.humanEntropyFactory ?? createHumanEntropyService

    if (sessionHealth.enabled !== false) {
      const createHealthMonitor =
        options.sessionHealthMonitorFactory ??
        ((healthOptions) => new SessionHealthMonitor(healthOptions))

      this.#sessionHealthMonitor = createHealthMonitor({
        badMacThreshold: sessionHealth.badMacThreshold ?? 3,
        badMacWindowMs: sessionHealth.badMacWindowMs ?? 60000,
        onDegraded: (stats) => {
          this.logger.error("session.health.degraded", { stats })
          if (this.state === SESSION_STATE.READY) {
            this.#setState(SESSION_STATE.DEGRADED, {
              reason: "bad-mac-threshold"
            })
          }
        },
        onRecovered: (stats) => {
          this.logger.info("session.health.recovered", { stats })
          if (this.state === SESSION_STATE.DEGRADED && this.#socket !== null) {
            this.#setState(SESSION_STATE.READY, {
              reason: "decrypt-health-recovered"
            })
          }
        }
      })
    }
  }

  get socket() {
    return this.#socket
  }

  snapshot() {
    return {
      name: this.name,
      state: this.state,
      reconnectAttempt: this.reconnectAttempt,
      userJid: this.userJid,
      health: this.#sessionHealthMonitor?.getStats() ?? null,
      humanEntropy: {
        enabled: this.humanEntropyConfig.enabled === true,
        ...(this.#humanEntropy?.getStats?.() ?? { running: false })
      },
      fingerprint: this.#fingerprint
        ? {
            deviceModel: this.#fingerprint.deviceModel,
            osVersion: this.#fingerprint.osVersion,
            appVersion: this.#fingerprint.appVersion.join(".")
          }
        : null
    }
  }

  onStateChange(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Listener state harus berupa function")
    }

    this.#events.on("state.changed", listener)
    return () => this.#events.off("state.changed", listener)
  }

  async start() {
    if (this.state !== SESSION_STATE.STOPPED) {
      return this.snapshot()
    }

    this.#stopping = false
    this.reconnectAttempt = 0
    this.logger.info("session.features.configured", {
      sessionHealth: {
        enabled: this.sessionHealthConfig.enabled !== false,
        badMacThreshold: this.sessionHealthConfig.badMacThreshold ?? 3,
        badMacWindowMs: this.sessionHealthConfig.badMacWindowMs ?? 60000
      },
      humanEntropy: {
        enabled: this.humanEntropyConfig.enabled === true,
        minIntervalMs: this.humanEntropyConfig.minIntervalMs ?? 300000,
        maxIntervalMs: this.humanEntropyConfig.maxIntervalMs ?? 900000
      },
      deviceFingerprintEnabled: this.deviceFingerprintConfig.enabled === true,
      stealthConnectEnabled: this.stealthConnectConfig.enabled === true,
      readReceiptVarianceEnabled:
        this.readReceiptVarianceConfig.enabled === true,
      sessionFingerprintEnabled:
        this.sessionFingerprintConfig.enabled === true
    })
    this.#setState(SESSION_STATE.INITIALIZING)
    await this.#connect()
    return this.snapshot()
  }

  async #connect() {
    if (this.#stopping) {
      return
    }

    this.#setState(
      this.reconnectAttempt > 0
        ? SESSION_STATE.RECONNECTING
        : SESSION_STATE.CONNECTING
    )

    try {
      const { state, saveCreds } = await this.#authStateLoader(
        this.authDirectory
      )

      if (this.#stopping) {
        return
      }

      let socketConfig = {
        auth: state,
        logger: this.#baileysLogger,
        markOnlineOnConnect: false,
        syncFullHistory: false
      }

      // Stealth connect: randomized browser tuple from a small realistic
      // pool, plus (later) a delayed presence ramp once connected. Only the
      // browser tuple is applied here; `markOnlineOnConnect: false` above
      // already covers "don't snap online immediately".
      if (this.stealthConnectConfig.enabled === true) {
        socketConfig = {
          ...socketConfig,
          ...this.#getStealthSocketConfig()
        }
      }

      // Device fingerprint randomization: stable per session name (so the
      // same admin keeps the same fingerprint across restarts instead of
      // re-pairing looking suspicious), distinct between admin-1/admin-2.
      // Runs after stealth connect, so its browser tuple (mobile-style
      // [deviceModel, osVersion, WhatsApp/version]) takes precedence over
      // the stealth-connect browser tuple when both are enabled.
      if (this.deviceFingerprintConfig.enabled === true) {
        this.#fingerprint = this.#generateFingerprint({}, this.name)
        socketConfig = this.#applyFingerprint(socketConfig, this.#fingerprint)
        // baileys-antiban's applyFingerprint() also sets socketConfig.version
        // to fp.appVersion (a mobile-app-style [major, minor, patch, build]
        // number, e.g. [2, 24, 5, 18]). That field is NOT the mobile app
        // version -- it is Baileys' WA multi-device PROTOCOL version
        // ([2, 3000, buildNumber] scheme), and baileys-antiban's hardcoded
        // pool is stale. Sending it as-is gets the connection killed
        // immediately by WhatsApp with a fatal disconnect (observed as
        // statusCode 405 on every reconnect attempt until the limit is
        // exhausted). Drop it so makeWASocket() falls back to Baileys' own
        // correct built-in version; only the (cosmetic, safe) browser tuple
        // from the fingerprint is kept.
        delete socketConfig.version
        this.logger.info("session.fingerprint.applied", {
          deviceModel: this.#fingerprint.deviceModel,
          osVersion: this.#fingerprint.osVersion,
          appVersion: this.#fingerprint.appVersion.join(".")
        })
      }

      // Session fingerprint (Obscura-inspired): superset of device
      // fingerprint that additionally randomizes-but-stabilizes network
      // timing jitter, voice-note metadata, and battery/connection state.
      // Runs after (and overrides) plain device fingerprint's browser/version
      // fields when both are enabled — SESSION_FINGERPRINT_ENABLED alone is
      // enough, DEVICE_FINGERPRINT_ENABLED does not need to also be on.
      if (this.sessionFingerprintConfig.enabled === true) {
        this.#sessionFingerprint = this.#generateSessionFingerprint({}, this.name)
        socketConfig = this.#applySessionFingerprint(
          socketConfig,
          this.#sessionFingerprint
        )
        // Same stale-version problem as applyFingerprint() above --
        // applySessionFingerprint() also overwrites socketConfig.version with
        // fingerprint.device.appVersion. Drop it for the same reason.
        delete socketConfig.version
        this.#fingerprint = this.#sessionFingerprint.device
        this.logger.info("session.session-fingerprint.applied", {
          deviceModel: this.#sessionFingerprint.device.deviceModel,
          osVersion: this.#sessionFingerprint.device.osVersion,
          protocolVersion: this.#sessionFingerprint.protocolVersion
        })
      }

      let socket = this.#makeSocket(socketConfig)

      // Read receipt variance: proxies `sock.readMessages` so any read
      // receipt this session sends goes out with Gaussian-jittered delay
      // instead of instantly. No-op until something calls readMessages().
      this.#stopReadReceiptVariance()
      if (this.readReceiptVarianceConfig.enabled === true) {
        this.#readReceiptVarianceController = this.#readReceiptVariance({
          meanMs: this.readReceiptVarianceConfig.meanMs,
          stdDevMs: this.readReceiptVarianceConfig.stdDevMs
        })
        socket = this.#readReceiptVarianceController.wrap(socket)
      }

      this.#socket = socket
      this.#saveCreds = saveCreds
      socket.ev.on("creds.update", this.#onCredsUpdate)
      socket.ev.on("connection.update", this.#onConnectionUpdate)
      socket.ev.on("messages.upsert", this.#onMessagesUpsert)
      socket.ev.on("messages.update", this.#onMessagesUpdate)
      this.logger.info("session.socket.created")
    } catch (error) {
      this.logger.error("session.connect.failed", { error })
      this.#setState(SESSION_STATE.DISCONNECTED, { reason: "startup-error" })
      this.#scheduleReconnect()
    }
  }

  #onCredsUpdate = () => {
    if (this.#saveCreds === null) {
      return
    }

    Promise.resolve(this.#saveCreds()).catch((error) => {
      this.logger.error("session.credentials.save-failed", { error })
    })
  }

  #onConnectionUpdate = (update) => {
    if (update.qr) {
      this.logger.info("session.qr.available")
      void this.#qrRenderer(this.name, update.qr, {
        showRaw: this.showRawQr
      }).catch((error) => {
        this.logger.error("session.qr.render-failed", { error })
      })
    }

    if (update.connection === "open") {
      const connectedJid = this.#socket?.user?.id
      this.userJid = connectedJid ? jidNormalizedUser(connectedJid) : null
      this.reconnectAttempt = 0
      this.#clearReconnectTimer()
      this.#sessionHealthMonitor?.reset()
      this.#startHumanEntropy()
      this.#startPresenceRamp()
      this.#setState(SESSION_STATE.READY)
      this.logger.info("session.ready.summary", {
        health: this.#sessionHealthMonitor?.getStats() ?? null,
        humanEntropy:
          this.#humanEntropy?.getStats?.() ?? {
            enabled: this.humanEntropyConfig.enabled === true,
            running: false
          }
      })
      return
    }

    if (update.connection === "close") {
      this.#handleConnectionClose(update.lastDisconnect)
    }
  }

  #onMessagesUpsert = ({ messages } = {}) => {
    if (!Array.isArray(messages)) {
      return
    }

    let decryptSuccess = 0
    let decryptFail = 0
    let inboundContactsTracked = 0

    for (const message of messages) {
      if (message?.messageStubType === WAMessageStubType.CIPHERTEXT) {
        this.#sessionHealthMonitor?.recordDecryptFail(true)
        decryptFail += 1
      } else if (message?.message) {
        this.#sessionHealthMonitor?.recordDecryptSuccess()
        decryptSuccess += 1
      }

      const remoteJid = message?.key?.remoteJid
      if (remoteJid && message?.key?.fromMe !== true) {
        // Optional call (?.()) because the real baileys-antiban
        // HumanEntropyService exposes no such public method -- this line
        // predates a correct reading of that library's actual API (see
        // BUG-004). Guarded so a mismatched/injected entropy object can
        // never crash message handling either.
        try {
          this.#humanEntropy?.addRecentContact?.(remoteJid, message.key)
          if (this.#humanEntropy?.addRecentContact) {
            inboundContactsTracked += 1
          }
        } catch (error) {
          this.logger.warn("session.human-entropy.track-contact-failed", {
            error
          })
        }
      }
    }

    if (decryptSuccess > 0 || decryptFail > 0) {
      this.logger.info("session.health.observed", {
        batchSize: messages.length,
        decryptSuccess,
        decryptFail,
        stats: this.#sessionHealthMonitor?.getStats() ?? null,
        inboundContactsTracked
      })
    }
  }

  #onMessagesUpdate = (updates) => {
    let decryptFail = 0

    for (const item of updates) {
      if (item?.update?.messageStubType === WAMessageStubType.CIPHERTEXT) {
        this.#sessionHealthMonitor?.recordDecryptFail(true)
        decryptFail += 1
      }

      const messageId = item?.key?.id
      const status = item?.update?.status

      if (!messageId || !Number.isInteger(status)) {
        continue
      }

      const previousStatus = this.#messageStatuses.get(messageId)
      const nextStatus = Math.max(previousStatus ?? status, status)
      this.#messageStatuses.set(messageId, nextStatus)

      while (this.#messageStatuses.size > 500) {
        this.#messageStatuses.delete(this.#messageStatuses.keys().next().value)
      }

      this.logger.info("session.message.status", {
        messageId,
        status: nextStatus,
        statusName: WAMessageStatus[nextStatus] ?? "UNKNOWN"
      })
      this.#events.emit("message.status.changed", {
        messageId,
        status: nextStatus
      })
    }

    if (decryptFail > 0) {
      this.logger.warn("session.health.decrypt-failure-update", {
        decryptFail,
        stats: this.#sessionHealthMonitor?.getStats() ?? null
      })
    }
  }

  #handleConnectionClose(lastDisconnect) {
    if (this.#stopping) {
      return
    }

    const closedSocket = this.#socket
    this.#stopHumanEntropy()
    this.#stopPresenceRamp()
    this.#stopReadReceiptVariance()
    this.#detachSocket(closedSocket)
    this.#socket = null
    this.#saveCreds = null

    const statusCode = getDisconnectStatusCode(lastDisconnect?.error)
    const conflictType = getDisconnectConflictType(lastDisconnect?.error)
    const reason = getDisconnectReasonName(statusCode, this.#disconnectReason)
    const classification = Number.isInteger(statusCode)
      ? classifyDisconnect(statusCode)
      : null

    this.logger.warn("session.connection.closed", {
      statusCode,
      reason,
      conflictType,
      disconnectCategory: classification?.category ?? "unknown",
      recommendedBackoffMs: classification?.backoffMs ?? null
    })

    if (!shouldReconnect(statusCode, this.#disconnectReason)) {
      this.#setState(SESSION_STATE.LOGGED_OUT, { reason, statusCode })
      return
    }

    this.#setState(SESSION_STATE.DISCONNECTED, { reason, statusCode })
    this.#scheduleReconnect(classification?.backoffMs)
  }

  #scheduleReconnect(recommendedBackoffMs = 0) {
    if (this.#stopping || this.#reconnectTimer !== null) {
      return
    }

    const nextAttempt = this.reconnectAttempt + 1

    if (nextAttempt > this.reconnectLimit) {
      this.logger.error("session.reconnect.exhausted", {
        reconnectLimit: this.reconnectLimit
      })
      this.#setState(SESSION_STATE.STOPPED, { reason: "reconnect-exhausted" })
      return
    }

    this.reconnectAttempt = nextAttempt
    // Session fingerprint's retry jitter (stable per session, ±50% of a
    // per-session base) avoids every reconnect landing on the exact same
    // exponential-backoff schedule as every other session.
    const retryJitterMs =
      this.sessionFingerprintConfig.enabled === true && this.#sessionFingerprint
        ? this.#getRetryJitter(this.#sessionFingerprint)
        : 0
    const delayMs =
      Math.max(
        calculateReconnectDelay(nextAttempt, {
          baseDelayMs: this.reconnectBaseDelayMs,
          maxDelayMs: this.reconnectMaxDelayMs
        }),
        Number.isFinite(recommendedBackoffMs) ? recommendedBackoffMs : 0
      ) + retryJitterMs

    this.logger.info("session.reconnect.scheduled", {
      attempt: nextAttempt,
      delayMs
    })

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null
      void this.#connect()
    }, delayMs)
  }

  #clearReconnectTimer() {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
  }

  #detachSocket(socket) {
    socket?.ev?.off("creds.update", this.#onCredsUpdate)
    socket?.ev?.off("connection.update", this.#onConnectionUpdate)
    socket?.ev?.off("messages.upsert", this.#onMessagesUpsert)
    socket?.ev?.off("messages.update", this.#onMessagesUpdate)
  }

  #setState(state, metadata = {}) {
    const previousState = this.state
    this.state = state
    const snapshot = this.snapshot()

    this.logger.info("session.state.changed", {
      previousState,
      state,
      ...metadata
    })
    this.#events.emit("state.changed", snapshot)
  }

  waitUntilReady(options = {}) {
    if (this.state === SESSION_STATE.READY) {
      return Promise.resolve(this.snapshot())
    }

    if (
      this.state === SESSION_STATE.LOGGED_OUT ||
      this.state === SESSION_STATE.DEGRADED ||
      this.state === SESSION_STATE.STOPPED
    ) {
      return Promise.reject(new SessionNotReadyError(this.name, this.state))
    }

    const timeoutMs = options.timeoutMs
    const signal = options.signal

    return new Promise((resolve, reject) => {
      let timeout = null

      const cleanup = () => {
        this.#events.off("state.changed", onStateChanged)
        signal?.removeEventListener("abort", onAbort)
        if (timeout !== null) clearTimeout(timeout)
      }

      const onStateChanged = (snapshot) => {
        if (snapshot.state === SESSION_STATE.READY) {
          cleanup()
          resolve(snapshot)
        } else if (
          snapshot.state === SESSION_STATE.LOGGED_OUT ||
          snapshot.state === SESSION_STATE.DEGRADED ||
          snapshot.state === SESSION_STATE.STOPPED
        ) {
          cleanup()
          reject(new SessionNotReadyError(this.name, snapshot.state))
        }
      }

      const onAbort = () => {
        cleanup()
        reject(new OperationAbortedError())
      }

      this.#events.on("state.changed", onStateChanged)
      signal?.addEventListener("abort", onAbort, { once: true })

      if (signal?.aborted) {
        onAbort()
        return
      }

      if (Number.isFinite(timeoutMs)) {
        timeout = setTimeout(() => {
          cleanup()
          reject(
            new SessionNotReadyError(
              this.name,
              `${this.state} (timeout ${timeoutMs}ms)`
            )
          )
        }, timeoutMs)
      }
    })
  }

  async sendText(target, text) {
    if (this.state !== SESSION_STATE.READY || this.#socket === null) {
      throw new SessionNotReadyError(this.name, this.state)
    }

    const normalizedText = String(text ?? "").trim()

    if (normalizedText.length === 0 || normalizedText.length > 4096) {
      throw new TypeError("Teks harus memiliki panjang 1-4096 karakter")
    }

    const jid = toTargetJid(target)
    const result = await this.#socket.sendMessage(jid, { text: normalizedText })

    this.logger.info("session.message.sent", {
      targetJid: jid,
      messageId: result?.key?.id ?? null
    })

    return result
  }

  async resolveTargetJid(target) {
    if (this.state !== SESSION_STATE.READY || this.#socket === null) {
      throw new SessionNotReadyError(this.name, this.state)
    }

    const requestedJid = toTargetJid(target)
    const matches = await this.#socket.onWhatsApp(requestedJid)
    const match = matches?.find((item) => item?.exists && item?.jid)

    if (!match) {
      throw new RangeError("Nomor penerima tidak terdaftar atau tidak dapat diverifikasi di WhatsApp")
    }

    const canonicalJid = jidNormalizedUser(match.jid)
    this.logger.info("session.target.resolved", {
      requestedJid,
      canonicalJid
    })
    return canonicalJid
  }

  waitForMessageStatus(messageId, options = {}) {
    const minimumStatus = options.minimumStatus ?? WAMessageStatus.DELIVERY_ACK
    const timeoutMs = options.timeoutMs ?? 30000
    const signal = options.signal
    const currentStatus = this.#messageStatuses.get(messageId)

    if (Number.isInteger(currentStatus) && currentStatus >= minimumStatus) {
      return Promise.resolve(currentStatus)
    }

    return new Promise((resolve, reject) => {
      let timeout = null

      const cleanup = () => {
        this.#events.off("message.status.changed", onStatusChanged)
        signal?.removeEventListener("abort", onAbort)
        if (timeout !== null) clearTimeout(timeout)
      }

      const onStatusChanged = (update) => {
        if (update.messageId !== messageId || update.status < minimumStatus) {
          return
        }

        cleanup()
        resolve(update.status)
      }

      const onAbort = () => {
        cleanup()
        reject(new OperationAbortedError())
      }

      this.#events.on("message.status.changed", onStatusChanged)
      signal?.addEventListener("abort", onAbort, { once: true })

      if (signal?.aborted) {
        onAbort()
        return
      }

      timeout = setTimeout(() => {
        cleanup()
        reject(new MessageDeliveryTimeoutError(this.name, messageId, timeoutMs))
      }, timeoutMs)
    })
  }

  getOwnJid() {
    if (
      this.state !== SESSION_STATE.READY ||
      this.#socket === null ||
      this.userJid === null
    ) {
      throw new SessionNotReadyError(this.name, this.state)
    }

    return this.userJid
  }
  #startHumanEntropy() {
    this.#stopHumanEntropy()

    if (this.humanEntropyConfig.enabled !== true || this.#socket === null) {
      return
    }

    // Defensive: the entropy factory (default: our own createHumanEntropyService,
    // see human-entropy.js and BUG-004) or any injected replacement must
    // never be able to take down the whole session/process. It is a
    // best-effort QA nicety, not a critical path -- a broken integration
    // should degrade to "entropy disabled for this connection", not crash
    // conversation runs that have nothing to do with it.
    try {
      this.#humanEntropy = this.#humanEntropyFactory(this.#socket, {
        enabled: true,
        minIntervalMs: this.humanEntropyConfig.minIntervalMs ?? 300000,
        maxIntervalMs: this.humanEntropyConfig.maxIntervalMs ?? 900000,
        logger: this.logger
      })
      this.#humanEntropy.start()
      this.logger.info("session.human-entropy.started")
    } catch (error) {
      this.#humanEntropy = null
      this.logger.error("session.human-entropy.start-failed", { error })
    }
  }

  #stopHumanEntropy() {
    if (this.#humanEntropy == null) {
      return
    }

    try {
      this.#humanEntropy.stop()
    } catch (error) {
      this.logger.warn("session.human-entropy.stop-failed", { error })
    }

    this.#humanEntropy = null
  }

  #startPresenceRamp() {
    this.#stopPresenceRamp()

    if (this.stealthConnectConfig.enabled !== true || this.#socket === null) {
      return
    }

    const controller = new AbortController()
    this.#presenceRampController = controller
    const socket = this.#socket

    this.#rampPresenceAfterConnect(socket, {
      minDelayMs: this.stealthConnectConfig.presenceRampMinMs,
      maxDelayMs: this.stealthConnectConfig.presenceRampMaxMs,
      signal: controller.signal
    })
      .then(() => {
        this.logger.info("session.presence-ramp.completed")
      })
      .catch((error) => {
        if (error instanceof AbortError) {
          return
        }
        this.logger.warn("session.presence-ramp.failed", { error })
      })
  }

  #stopPresenceRamp() {
    if (this.#presenceRampController === null) {
      return
    }

    this.#presenceRampController.abort()
    this.#presenceRampController = null
  }

  #stopReadReceiptVariance() {
    if (this.#readReceiptVarianceController === null) {
      return
    }

    try {
      this.#readReceiptVarianceController.stop()
    } catch (error) {
      this.logger.warn("session.read-receipt-variance.stop-failed", { error })
    }

    this.#readReceiptVarianceController = null
  }

  async stop(reason = "manual") {
    if (this.state === SESSION_STATE.STOPPED && this.#socket === null) {
      return
    }

    this.#stopping = true
    this.#clearReconnectTimer()
    this.logger.info("session.stop.summary", {
      reason,
      state: this.state,
      trackedMessageStatuses: this.#messageStatuses.size,
      health: this.#sessionHealthMonitor?.getStats() ?? null,
      humanEntropy:
        this.#humanEntropy?.getStats?.() ?? {
          enabled: this.humanEntropyConfig.enabled === true,
          running: false
        }
    })
    this.#stopHumanEntropy()
    this.#stopPresenceRamp()
    this.#stopReadReceiptVariance()
    const socket = this.#socket
    this.#detachSocket(socket)
    this.#socket = null
    this.#saveCreds = null
    this.userJid = null
    this.#messageStatuses.clear()
    this.#sessionHealthMonitor?.reset()
    this.#setState(SESSION_STATE.STOPPED, { reason })

    if (socket?.end) {
      try {
        await socket.end(undefined)
      } catch (error) {
        this.logger.warn("session.socket.close-failed", { error })
      }
    }
  }
}
