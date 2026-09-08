// Home-grown replacement for baileys-antiban's HumanEntropyService.
//
// Why this exists instead of the library's own class (see project.md
// BUG-004): baileys-antiban's HumanEntropyService is built for a separate
// multi-session framework ("WaSP") that exposes a global event bus
// (`wasp.on('MESSAGE_RECEIVED', ...)`) and a session registry
// (`wasp.getProvider(sessionId)`). This project has neither -- each
// WhatsAppSession owns exactly one Baileys socket directly. Rather than
// building and maintaining an adapter that fakes an entire foreign
// framework's API just to satisfy one class, this module reimplements the
// same idea (occasional idle typing/read-receipt/presence activity toward
// contacts who have already messaged first) directly against a plain
// Baileys-shaped socket.
//
// Design notes:
// - Only ever targets contacts that messaged first (addRecentContact() is
//   only ever called for inbound, non-group messages -- see
//   WhatsAppSession#onMessagesUpsert). Never contacts a stranger.
// - Read receipts go out via socket.readMessages() with no extra delay of
//   their own -- if READ_RECEIPT_VARIANCE_ENABLED is also on, that feature
//   already wraps readMessages() with realistic jitter, so adding a second,
//   independent random delay here would just be redundant complexity.
// - All waits (both the inter-cycle interval and the mid-action typing/
//   presence-toggle holds) go through the shared abortable `sleep()` used
//   elsewhere in this codebase, tied to one AbortController per start()/
//   stop() lifecycle. That guarantees stop() actually cancels everything --
//   including a wait that is already in progress -- instead of leaving a
//   stray timer that fires minutes later against a socket that may already
//   be closed.
// - Every action is individually caught: one failing action (e.g. a stale
//   contact, or the session stopping mid-action) must never stop the cycle
//   loop or bubble up to the session.

import { OperationAbortedError, sleep } from "../utils/sleep.js"

const DEFAULT_ACTION_CONFIG = Object.freeze({
  maxRecentContacts: 30,
  typingProbability: 0.3,
  typingMinMs: 3000,
  typingMaxMs: 8000,
  readReceiptProbability: 0.2,
  presenceToggleProbability: 0.15,
  presenceToggleMinMs: 30000,
  presenceToggleMaxMs: 120000
})

function randomBetween(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min
}

function pickRandom(random, list) {
  return list[Math.floor(random() * list.length)]
}

export function createHumanEntropyService(socket, options = {}) {
  const config = { ...DEFAULT_ACTION_CONFIG, ...options }
  const enabled = config.enabled !== false
  const minIntervalMs = config.minIntervalMs ?? 300000
  const maxIntervalMs = config.maxIntervalMs ?? 900000
  const logger = config.logger ?? { info() {}, warn() {}, error() {} }
  const random = config.random ?? Math.random

  let recentContacts = []
  let unreadMessages = []
  let running = false
  let controller = null
  const stats = {
    cycles: 0,
    skippedCycles: 0,
    typingActions: 0,
    readActions: 0,
    presenceActions: 0,
    failedActions: 0
  }

  function getStats() {
    return {
      running,
      recentContacts: recentContacts.length,
      pendingReadReceipts: unreadMessages.length,
      ...stats
    }
  }

  function addRecentContact(jid, key) {
    const existing = recentContacts.find((contact) => contact.jid === jid)
    if (existing) {
      existing.lastMessageAt = Date.now()
    } else {
      recentContacts.push({ jid, lastMessageAt: Date.now() })
    }

    if (recentContacts.length > config.maxRecentContacts) {
      recentContacts.sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      recentContacts = recentContacts.slice(0, config.maxRecentContacts)
    }

    if (key) {
      unreadMessages.push({ jid, key })
      if (unreadMessages.length > 50) {
        unreadMessages = unreadMessages.slice(-50)
      }
    }

    logger.debug?.("human-entropy.contact.tracked", {
      recentContacts: recentContacts.length,
      pendingReadReceipts: unreadMessages.length
    })
  }

  async function performTyping(signal) {
    if (recentContacts.length === 0) {
      return
    }

    const contact = pickRandom(random, recentContacts)
    const durationMs = randomBetween(random, config.typingMinMs, config.typingMaxMs)

    try {
      await socket.sendPresenceUpdate("composing", contact.jid)
      await sleep(durationMs, { signal })
      await socket.sendPresenceUpdate("paused", contact.jid)
      stats.typingActions += 1
      logger.info("human-entropy.cycle.typing", { durationMs })
    } catch (error) {
      if (error instanceof OperationAbortedError) {
        return
      }
      stats.failedActions += 1
      logger.warn("human-entropy.cycle.typing-failed", { error })
    }
  }

  async function performReadReceipt() {
    if (unreadMessages.length === 0) {
      return
    }

    const message = pickRandom(random, unreadMessages)

    try {
      await socket.readMessages([message.key])
      unreadMessages = unreadMessages.filter((entry) => entry !== message)
      stats.readActions += 1
      logger.info("human-entropy.cycle.read-receipt")
    } catch (error) {
      stats.failedActions += 1
      logger.warn("human-entropy.cycle.read-receipt-failed", { error })
    }
  }

  async function performPresenceToggle(signal) {
    const durationMs = randomBetween(
      random,
      config.presenceToggleMinMs,
      config.presenceToggleMaxMs
    )

    try {
      await socket.sendPresenceUpdate("available")
      await sleep(durationMs, { signal })
      await socket.sendPresenceUpdate("unavailable")
      stats.presenceActions += 1
      logger.info("human-entropy.cycle.presence-toggle", { durationMs })
    } catch (error) {
      if (error instanceof OperationAbortedError) {
        return
      }
      stats.failedActions += 1
      logger.warn("human-entropy.cycle.presence-toggle-failed", { error })
    }
  }

  async function runCycle(signal) {
    stats.cycles += 1

    if (recentContacts.length === 0) {
      stats.skippedCycles += 1
      logger.info("human-entropy.cycle.skipped", { reason: "no-recent-contacts" })
      return
    }

    const actions = []
    if (random() < config.typingProbability) {
      actions.push(performTyping(signal))
    }
    if (random() < config.readReceiptProbability) {
      actions.push(performReadReceipt())
    }
    if (random() < config.presenceToggleProbability) {
      actions.push(performPresenceToggle(signal))
    }

    await Promise.allSettled(actions)
    logger.info("human-entropy.cycle.completed", {
      scheduledActions: actions.length,
      stats: getStats()
    })
  }

  async function runLoop(signal) {
    while (!signal.aborted) {
      const delayMs = randomBetween(random, minIntervalMs, maxIntervalMs)

      logger.info("human-entropy.cycle.scheduled", {
        delayMs,
        recentContacts: recentContacts.length,
        pendingReadReceipts: unreadMessages.length
      })

      try {
        await sleep(delayMs, { signal })
      } catch (error) {
        if (error instanceof OperationAbortedError) {
          return
        }
        throw error
      }

      if (signal.aborted) {
        return
      }

      try {
        await runCycle(signal)
      } catch (error) {
        logger.warn("human-entropy.cycle-failed", { error })
      }
    }
  }

  function start() {
    if (!enabled || running) {
      return
    }

    running = true
    controller = new AbortController()
    runLoop(controller.signal).catch((error) => {
      logger.error("human-entropy.loop-crashed", { error })
    })
    logger.info("human-entropy.started", {
      minIntervalMs,
      maxIntervalMs,
      maxRecentContacts: config.maxRecentContacts
    })
  }

  function stop() {
    if (!running) {
      return
    }

    running = false
    if (controller !== null) {
      controller.abort()
      controller = null
    }
    logger.info("human-entropy.stopped", { stats: getStats() })
  }

  return Object.freeze({
    start,
    stop,
    addRecentContact,
    getRecentContacts: () => [...recentContacts],
    getStats
  })
}
