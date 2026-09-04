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
  SessionHealthMonitor
} from "baileys-antiban"
import pino from "pino"

import { isWhatsAppUserJid, toWhatsAppJid } from "../utils/jid.js"
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
  #qrRenderer
  #reconnectTimer = null
  #saveCreds = null
  #socket = null
  #stopping = false

  constructor(options) {
    this.name = options.name
    this.authDirectory = options.authDirectory
    this.logger = options.logger
    this.reconnectLimit = options.reconnectLimit
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs
    this.showRawQr = options.showRawQr ?? false
    const sessionHealth = options.sessionHealth ?? { enabled: true }
    this.state = SESSION_STATE.STOPPED
    this.reconnectAttempt = 0
    this.userJid = null
    this.#makeSocket = options.makeSocket ?? makeWASocket
    this.#authStateLoader = options.authStateLoader ?? useMultiFileAuthState
    this.#qrRenderer = options.qrRenderer ?? renderTerminalQr
    this.#disconnectReason = options.disconnectReason ?? DisconnectReason
    this.#baileysLogger = options.baileysLogger ?? pino({ level: "silent" })

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
      health: this.#sessionHealthMonitor?.getStats() ?? null
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

      const socket = this.#makeSocket({
        auth: state,
        logger: this.#baileysLogger,
        markOnlineOnConnect: false,
        syncFullHistory: false
      })

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
      this.#setState(SESSION_STATE.READY)
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

    for (const message of messages) {
      if (message?.messageStubType === WAMessageStubType.CIPHERTEXT) {
        this.#sessionHealthMonitor?.recordDecryptFail(true)
      } else if (message?.message) {
        this.#sessionHealthMonitor?.recordDecryptSuccess()
      }
    }
  }

  #onMessagesUpdate = (updates) => {
    for (const item of updates) {
      if (item?.update?.messageStubType === WAMessageStubType.CIPHERTEXT) {
        this.#sessionHealthMonitor?.recordDecryptFail(true)
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
  }

  #handleConnectionClose(lastDisconnect) {
    if (this.#stopping) {
      return
    }

    const closedSocket = this.#socket
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
    const delayMs = Math.max(
      calculateReconnectDelay(nextAttempt, {
        baseDelayMs: this.reconnectBaseDelayMs,
        maxDelayMs: this.reconnectMaxDelayMs
      }),
      Number.isFinite(recommendedBackoffMs) ? recommendedBackoffMs : 0
    )

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

  async stop(reason = "manual") {
    if (this.state === SESSION_STATE.STOPPED && this.#socket === null) {
      return
    }

    this.#stopping = true
    this.#clearReconnectTimer()
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
