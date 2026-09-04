import assert from "node:assert/strict"
import test from "node:test"

import {
  ConversationInterruptedError,
  createConversationRunner,
  ScenarioValidationError,
  validateScenario
} from "../src/conversation/runner.js"
import { createDefaultConversationScenario } from "../src/conversation/scenarios.js"
import { OperationAbortedError } from "../src/utils/sleep.js"
import { MessageDeliveryTimeoutError } from "../src/sessions/session-state.js"

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {}
  }
}

function createManager() {
  const listeners = new Set()
  const sent = []
  const deliveryChecks = []
  let ready = true

  return {
    sent,
    deliveryChecks,
    async waitUntilAllReady({ signal } = {}) {
      if (signal?.aborted) throw new OperationAbortedError()
    },
    assertAllReady() {
      if (!ready) throw new Error("Session tidak ready")
    },
    onStateChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async sendBetween(sender, recipient, text) {
      const messageId = `message-${sent.length + 1}`
      sent.push({ sender, recipient, text, messageId })
      return { key: { id: messageId } }
    },
    async waitForMessageStatus(sender, messageId, options) {
      deliveryChecks.push({ sender, messageId, options })
      return 3
    },
    disconnect(name = "admin-1") {
      ready = false
      for (const listener of listeners) {
        listener({ name, state: "disconnected" })
      }
    }
  }
}

test("skenario default memakai jeda konfigurasi dan sepuluh langkah finite", () => {
  const scenario = createDefaultConversationScenario(65000)

  assert.equal(scenario.length, 10)
  assert.deepEqual(
    scenario.map((step) => step.sender),
    [
      "admin-1",
      "admin-2",
      "admin-1",
      "admin-2",
      "admin-1",
      "admin-2",
      "admin-1",
      "admin-2",
      "admin-1",
      "admin-2"
    ]
  )
  assert.deepEqual(
    scenario.map((step) => step.delayMs),
    [0, 65000, 65000, 65000, 65000, 65000, 65000, 65000, 65000, 65000]
  )
})

test("validator menormalisasi skenario valid", () => {
  const result = validateScenario(
    [{ sender: "admin-1", text: "  Halo  ", delayMs: 1000 }],
    { maxSteps: 1 }
  )

  assert.deepEqual(result, [
    { sender: "admin-1", text: "Halo", delayMs: 1000 }
  ])
})

test("validator menolak skenario kosong, sender, text, delay, dan maxSteps invalid", () => {
  assert.throws(() => validateScenario([]), ScenarioValidationError)
  assert.throws(
    () => validateScenario([{ sender: "admin-3", text: "Halo", delayMs: 0 }]),
    /sender harus admin-1 atau admin-2/
  )
  assert.throws(
    () => validateScenario([{ sender: "admin-1", text: " ", delayMs: 0 }]),
    /text harus memiliki panjang/
  )
  assert.throws(
    () => validateScenario([{ sender: "admin-1", text: "Halo", delayMs: -1 }]),
    /delayMs harus berupa bilangan bulat/
  )
  assert.throws(
    () =>
      validateScenario(
        [
          { sender: "admin-1", text: "Satu", delayMs: 0 },
          { sender: "admin-2", text: "Dua", delayMs: 0 }
        ],
        { maxSteps: 1 }
      ),
    /melampaui maxSteps/
  )
})

test("runner menunggu delay, mengirim berurutan, dan mengonfirmasi delivery", async () => {
  const manager = createManager()
  const waits = []
  const runner = createConversationRunner({
    sessionManager: manager,
    logger: createLogger(),
    wait: async (delayMs, { signal }) => {
      assert.equal(signal.aborted, false)
      waits.push(delayMs)
    }
  })
  const scenario = [
    { sender: "admin-1", text: "Satu", delayMs: 0 },
    { sender: "admin-2", text: "Dua", delayMs: 65000 }
  ]

  const result = await runner.run(scenario, {
    maxSteps: 2,
    deliveryReceiptTimeoutMs: 1234
  })

  assert.equal(result.status, "completed")
  assert.equal(result.executedSteps, 2)
  assert.deepEqual(waits, [0, 65000])
  assert.deepEqual(
    manager.sent.map(({ sender, recipient, text }) => ({
      sender,
      recipient,
      text
    })),
    [
      { sender: "admin-1", recipient: "admin-2", text: "Satu" },
      { sender: "admin-2", recipient: "admin-1", text: "Dua" }
    ]
  )
  assert.deepEqual(
    manager.deliveryChecks.map(({ sender, messageId, options }) => ({
      sender,
      messageId,
      timeoutMs: options.timeoutMs
    })),
    [
      { sender: "admin-1", messageId: "message-1", timeoutMs: 1234 },
      { sender: "admin-2", messageId: "message-2", timeoutMs: 1234 }
    ]
  )
})

test("runner berhenti tanpa mengirim langkah berikutnya ketika session putus", async () => {
  const manager = createManager()
  let waitCount = 0
  const runner = createConversationRunner({
    sessionManager: manager,
    logger: createLogger(),
    wait: async (_delayMs, { signal }) => {
      waitCount += 1
      if (waitCount === 2) manager.disconnect("admin-2")
      if (signal.aborted) throw new OperationAbortedError()
    }
  })

  await assert.rejects(
    runner.run(
      [
        { sender: "admin-1", text: "Satu", delayMs: 0 },
        { sender: "admin-2", text: "Dua", delayMs: 1000 }
      ],
      { maxSteps: 2 }
    ),
    (error) =>
      error instanceof ConversationInterruptedError &&
      error.reason === "session-unavailable"
  )
  assert.equal(manager.sent.length, 1)
})

test("runner tetap melanjutkan skenario ketika delivery receipt timeout", async () => {
  const manager = createManager()
  manager.waitForMessageStatus = async (sender, messageId, options) => {
    if (messageId === "message-1") {
      throw new MessageDeliveryTimeoutError(
        sender,
        messageId,
        options.timeoutMs
      )
    }
    return 3
  }
  const runner = createConversationRunner({
    sessionManager: manager,
    logger: createLogger(),
    wait: async () => {}
  })

  const result = await runner.run(
    [
      { sender: "admin-1", text: "Satu", delayMs: 0 },
      { sender: "admin-2", text: "Dua", delayMs: 0 }
    ],
    { maxSteps: 2, deliveryReceiptTimeoutMs: 10 }
  )

  assert.equal(result.executedSteps, 2)
  assert.equal(result.results[0].deliveryConfirmed, false)
  assert.equal(result.results[0].deliveryStatus, null)
  assert.equal(result.results[1].deliveryConfirmed, true)
})

test("runner menghormati AbortSignal sebelum percakapan dimulai", async () => {
  const manager = createManager()
  const controller = new AbortController()
  controller.abort()
  const runner = createConversationRunner({
    sessionManager: manager,
    logger: createLogger(),
    wait: async () => {}
  })

  await assert.rejects(
    runner.run(
      [{ sender: "admin-1", text: "Satu", delayMs: 0 }],
      { maxSteps: 1, signal: controller.signal }
    ),
    (error) =>
      error instanceof ConversationInterruptedError &&
      error.reason === "aborted"
  )
  assert.equal(manager.sent.length, 0)
})
