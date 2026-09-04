import { sleep } from "./sleep.js"

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export class PresenceChoreographer {
  constructor(options = {}) {
    this.enabled = options.enabled ?? false
    this.typingWpm = clamp(options.typingWpm ?? 42, 10, 120)
    this.typingMinMs = clamp(options.typingMinMs ?? 700, 0, 10000)
    this.typingMaxMs = clamp(options.typingMaxMs ?? 8000, this.typingMinMs, 30000)
    this.wait = options.wait ?? sleep
  }

  computeTypingPlan(messageLength) {
    if (!this.enabled) return []

    const length = Math.max(1, Number(messageLength) || 1)
    const estimatedWords = Math.max(1, length / 5)
    const baseDurationMs = (estimatedWords / this.typingWpm) * 60_000
    const durationMs = Math.round(
      clamp(baseDurationMs, this.typingMinMs, this.typingMaxMs)
    )

    return [
      Object.freeze({ state: "composing", durationMs }),
      Object.freeze({ state: "paused", durationMs: 0 })
    ]
  }

  async executeTypingPlan(socket, jid, plan, options = {}) {
    if (!this.enabled || !Array.isArray(plan) || plan.length === 0) return

    for (const step of plan) {
      await socket.sendPresenceUpdate(step.state, jid)
      if (step.durationMs > 0) {
        await this.wait(step.durationMs, { signal: options.signal })
      }
    }
  }
}

export function createPresenceChoreographer(options) {
  return new PresenceChoreographer(options)
}
