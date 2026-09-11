import { OperationAbortedError, sleep } from "../utils/sleep.js"
import { MessageDeliveryTimeoutError } from "../sessions/session-state.js"

const DEFAULT_PARTICIPANTS = ["admin-1", "admin-2"]

export class ScenarioValidationError extends Error {
  constructor(message, stepIndex = null) {
    super(stepIndex === null ? message : `Langkah ${stepIndex + 1}: ${message}`)
    this.name = "ScenarioValidationError"
    this.stepIndex = stepIndex
  }
}

export class ConversationInterruptedError extends Error {
  constructor(message, reason = "interrupted") {
    super(message)
    this.name = "ConversationInterruptedError"
    this.reason = reason
  }
}

export function validateScenario(scenario, options = {}) {
  const maxSteps = options.maxSteps ?? 10
  const minDelayMs = options.minDelayMs ?? 0
  const maxDelayMs = options.maxDelayMs ?? 300000
  const maxTextLength = options.maxTextLength ?? 4096
  const participants = new Set(options.participants ?? DEFAULT_PARTICIPANTS)
  const participantList = [...participants].join(", ")

  if (!Array.isArray(scenario) || scenario.length === 0) {
    throw new ScenarioValidationError("Skenario harus berupa array yang tidak kosong")
  }

  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) {
    throw new ScenarioValidationError("maxSteps harus berupa bilangan bulat positif")
  }

  if (scenario.length > maxSteps) {
    throw new ScenarioValidationError(
      `Jumlah langkah ${scenario.length} melampaui maxSteps ${maxSteps}`
    )
  }

  return scenario.map((step, index) => {
    if (step === null || typeof step !== "object" || Array.isArray(step)) {
      throw new ScenarioValidationError("Format langkah tidak valid", index)
    }

    if (!participants.has(step.sender)) {
      throw new ScenarioValidationError(
        `sender harus salah satu dari: ${participantList}`,
        index
      )
    }

    if (!participants.has(step.recipient)) {
      throw new ScenarioValidationError(
        `recipient harus salah satu dari: ${participantList}`,
        index
      )
    }

    if (step.sender === step.recipient) {
      throw new ScenarioValidationError(
        "sender dan recipient tidak boleh sama (tidak bisa kirim pesan ke diri sendiri)",
        index
      )
    }

    const text = String(step.text ?? "").trim()
    if (text.length === 0 || text.length > maxTextLength) {
      throw new ScenarioValidationError(
        `text harus memiliki panjang 1-${maxTextLength} karakter`,
        index
      )
    }

    if (
      !Number.isSafeInteger(step.delayMs) ||
      step.delayMs < minDelayMs ||
      step.delayMs > maxDelayMs
    ) {
      throw new ScenarioValidationError(
        `delayMs harus berupa bilangan bulat antara ${minDelayMs}-${maxDelayMs}`,
        index
      )
    }

    return Object.freeze({
      sender: step.sender,
      recipient: step.recipient,
      text,
      delayMs: step.delayMs
    })
  })
}

export class ConversationRunner {
  constructor({ sessionManager, logger, wait = sleep, historyRecorder = null }) {
    this.sessionManager = sessionManager
    this.logger = logger
    this.wait = wait
    this.historyRecorder = historyRecorder
    this.running = false
  }

  async run(scenario, options = {}) {
    if (this.running) {
      throw new Error("Conversation runner sedang berjalan")
    }

    const steps = validateScenario(scenario, {
      maxSteps: options.maxSteps,
      participants: options.participants
    })
    const externalSignal = options.signal
    const deliveryReceiptTimeoutMs = options.deliveryReceiptTimeoutMs ?? 30000
    const controller = new AbortController()
    let interruption = null
    let removeStateListener = () => {}

    const interrupt = (error) => {
      if (interruption === null) {
        interruption = error
        controller.abort()
      }
    }

    const onExternalAbort = () => {
      interrupt(
        new ConversationInterruptedError(
          "Percakapan dibatalkan oleh proses shutdown",
          "aborted"
        )
      )
    }

    this.running = true
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true })
    if (externalSignal?.aborted) onExternalAbort()

    try {
      this.logger.info("conversation.waiting-for-sessions", {
        totalSteps: steps.length
      })
      await this.sessionManager.waitUntilAllReady({ signal: controller.signal })
      this.sessionManager.assertAllReady()

      removeStateListener = this.sessionManager.onStateChange((snapshot) => {
        if (snapshot.state !== "ready") {
          interrupt(
            new ConversationInterruptedError(
              `Percakapan dihentikan karena ${snapshot.name} berubah ke state ${snapshot.state}`,
              "session-unavailable"
            )
          )
        }
      })

      this.logger.info("conversation.started", {
        totalSteps: steps.length,
        maxSteps: options.maxSteps
      })

      const results = []

      for (const [index, step] of steps.entries()) {
        const recipient = step.recipient
        this.logger.info("conversation.step.waiting", {
          step: index + 1,
          sender: step.sender,
          recipient,
          delayMs: step.delayMs
        })

        await this.wait(step.delayMs, { signal: controller.signal })
        this.sessionManager.assertAllReady()

        const sentAt = new Date().toISOString()
        const result = await this.sessionManager.sendBetween(
          step.sender,
          recipient,
          step.text
        )
        const messageId = result?.key?.id

        if (!messageId) {
          throw new Error(`Baileys tidak mengembalikan messageId pada langkah ${index + 1}`)
        }

        if (this.historyRecorder) {
          try {
            this.historyRecorder.record(step.sender, recipient, sentAt)
          } catch (error) {
            this.logger.warn("conversation.step.history-record-failed", {
              step: index + 1,
              sender: step.sender,
              recipient,
              error
            })
          }
        }

        let deliveryStatus = null

        try {
          deliveryStatus = await this.sessionManager.waitForMessageStatus(
            step.sender,
            messageId,
            {
              timeoutMs: deliveryReceiptTimeoutMs,
              signal: controller.signal
            }
          )
        } catch (error) {
          if (!(error instanceof MessageDeliveryTimeoutError)) {
            throw error
          }

          this.logger.warn("conversation.step.delivery-unconfirmed", {
            step: index + 1,
            sender: step.sender,
            recipient,
            messageId,
            timeoutMs: deliveryReceiptTimeoutMs
          })
        }

        const stepResult = Object.freeze({
          step: index + 1,
          sender: step.sender,
          recipient,
          messageId,
          deliveryStatus,
          deliveryConfirmed: deliveryStatus !== null,
          sentAt
        })
        results.push(stepResult)
        this.logger.info("conversation.step.completed", {
          ...stepResult,
          textLength: step.text.length
        })
      }

      const summary = Object.freeze({
        status: "completed",
        totalSteps: steps.length,
        executedSteps: results.length,
        results: Object.freeze(results)
      })
      this.logger.info("conversation.completed", {
        totalSteps: summary.totalSteps,
        executedSteps: summary.executedSteps
      })
      return summary
    } catch (error) {
      const finalError =
        interruption ??
        (error instanceof OperationAbortedError
          ? new ConversationInterruptedError(
              "Percakapan dibatalkan",
              "aborted"
            )
          : error)

      this.logger.warn("conversation.stopped", {
        executedReason: finalError.reason ?? "error",
        error: finalError
      })
      throw finalError
    } finally {
      this.running = false
      removeStateListener()
      externalSignal?.removeEventListener("abort", onExternalAbort)
    }
  }
}

export function createConversationRunner(options) {
  return new ConversationRunner(options)
}
