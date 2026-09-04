import { PresenceChoreographer } from "baileys-antiban"

import { WhatsAppSession } from "./whatsapp-session.js"

function createQaPresence(config = {}) {
  return new PresenceChoreographer({
    enabled: config.enabled ?? false,
    enableCircadianRhythm: false,
    circadian: {
      enabled: false,
      profile: "always_on",
      timezone: "UTC"
    },
    distractionPauseProbability: 0,
    offlineGapProbability: 0,
    readReceiptSkipProbability: 0,
    readReceiptDelayMinMs: 0,
    readReceiptDelayMaxMs: 0,
    enableTypingModel: true,
    typingWPM: config.typingWPM ?? 45,
    typingWPMStdDev: 0,
    thinkPauseProbability: 0,
    intermittentPausedProbability: 0,
    typingMinMs: config.typingMinMs ?? 600,
    typingMaxMs: config.typingMaxMs ?? 8000
  })
}

export class SessionManager {
  constructor({ config, logger, sessionFactory, presenceChoreographer }) {
    this.logger = logger
    this.presenceChoreographer =
      presenceChoreographer ?? createQaPresence(config.presence)
    const createSession =
      sessionFactory ?? ((options) => new WhatsAppSession(options))
    const reconnectOptions = {
      reconnectLimit: config.limits.reconnectLimit,
      reconnectBaseDelayMs: config.limits.reconnectBaseDelayMs,
      reconnectMaxDelayMs: config.limits.reconnectMaxDelayMs
    }

    this.sessions = new Map(
      Object.values(config.admins).map((admin) => {
        const session = createSession({
          name: admin.name,
          authDirectory: admin.authDirectory,
          logger: logger.child(admin.name),
          showRawQr: config.showRawQr,
          sessionHealth: config.sessionHealth,
          ...reconnectOptions
        })
        return [admin.name, session]
      })
    )
  }

  get(name) {
    const session = this.sessions.get(name)

    if (!session) {
      throw new RangeError(`Session tidak dikenal: ${name}`)
    }

    return session
  }

  snapshots() {
    return [...this.sessions.values()].map((session) => session.snapshot())
  }

  onStateChange(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Listener state harus berupa function")
    }

    const removeListeners = [...this.sessions.values()].map((session) =>
      session.onStateChange(listener)
    )
    return () => removeListeners.forEach((removeListener) => removeListener())
  }

  async startAll() {
    const sessionList = [...this.sessions.values()]
    const results = await Promise.allSettled(
      sessionList.map((session) => session.start())
    )

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.logger.error("session-manager.start.failed", {
          sessionName: sessionList[index].name,
          error: result.reason
        })
      }
    })

    return this.snapshots()
  }

  waitUntilAllReady(options = {}) {
    return Promise.all(
      [...this.sessions.values()].map((session) =>
        session.waitUntilReady(options)
      )
    )
  }

  assertAllReady() {
    const ownJids = new Map()

    for (const session of this.sessions.values()) {
      const ownJid = session.getOwnJid()

      if (ownJids.has(ownJid)) {
        throw new Error(
          `Session ${session.name} dan ${ownJids.get(ownJid)} terhubung ke akun WhatsApp yang sama`
        )
      }

      ownJids.set(ownJid, session.name)
    }

    return this.snapshots()
  }

  sendText(sessionName, target, text) {
    return this.get(sessionName).sendText(target, text)
  }

  async sendBetween(senderName, recipientName, text) {
    const sender = this.get(senderName)
    const recipient = this.get(recipientName)
    const senderJid = sender.getOwnJid()
    const recipientJid = recipient.getOwnJid()

    if (senderJid === recipientJid) {
      throw new Error(
        `Pengiriman ${senderName} ke ${recipientName} ditolak karena keduanya memakai akun yang sama`
      )
    }

    const canonicalRecipientJid = await sender.resolveTargetJid(recipientJid)
    const normalizedText = String(text ?? "").trim()
    const plan = this.presenceChoreographer.computeTypingPlan(
      normalizedText.length
    )

    if (plan.length > 0) {
      this.logger.info("session-manager.presence.qa", {
        sender: senderName,
        recipient: recipientName,
        steps: plan.length
      })
      await this.presenceChoreographer.executeTypingPlan(
        sender.socket,
        canonicalRecipientJid,
        plan
      )
    }

    return sender.sendText(canonicalRecipientJid, normalizedText)
  }

  waitForMessageStatus(sessionName, messageId, options = {}) {
    return this.get(sessionName).waitForMessageStatus(messageId, options)
  }

  async stopAll(reason = "manual") {
    const results = await Promise.allSettled(
      [...this.sessions.values()].map((session) => session.stop(reason))
    )
    const failures = results.filter((result) => result.status === "rejected")

    if (failures.length > 0) {
      this.logger.error("session-manager.stop.failed", {
        failureCount: failures.length,
        errors: failures.map((result) => result.reason)
      })
    }
  }
}

export function createSessionManager(options) {
  return new SessionManager(options)
}
