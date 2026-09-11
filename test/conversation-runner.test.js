import assert from "node:assert/strict"
import test from "node:test"

import {
  ConversationInterruptedError,
  createConversationRunner,
  ScenarioValidationError,
  validateScenario
} from "../src/conversation/runner.js"
import { createDynamicConversationScenario } from "../src/conversation/scenarios.js"
import { OperationAbortedError } from "../src/utils/sleep.js"
import { MessageDeliveryTimeoutError } from "../src/sessions/session-state.js"
import {
  createEmptyState,
  recordMessage
} from "../src/state/relationship-store.js"

const FOUR_ADMINS = ["admin-1", "admin-2", "admin-3", "admin-4"]

function createLogger() {
  return {
    info() { },
    warn() { },
    error() { }
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

test("createDynamicConversationScenario: 2 admin tanpa riwayat (kasus minimal)", () => {
  const scenario = createDynamicConversationScenario({
    activeAdmins: ["admin-1", "admin-2"],
    relationshipState: createEmptyState(),
    thresholdMessages: 20,
    messageDelayMs: 65000
  })

  assert.equal(scenario.length, 4)
  assert.equal(scenario[0].delayMs, 0)
  assert.deepEqual(
    scenario.slice(1).map((step) => step.delayMs),
    [65000, 65000, 65000]
  )
  // Sama-sama baru (tidak ada admin lama) -> urutan konfigurasi: admin-1 duluan.
  assert.deepEqual(
    scenario.map((step) => [step.sender, step.recipient]),
    [
      ["admin-1", "admin-2"],
      ["admin-2", "admin-1"],
      ["admin-1", "admin-2"],
      ["admin-2", "admin-1"]
    ]
  )
  for (const step of scenario) {
    assert.ok(step.text.length > 0)
  }
})

test("createDynamicConversationScenario: 4 admin tanpa riwayat sama sekali (bootstrap)", () => {
  const admins = ["admin-1", "admin-2", "admin-3", "admin-4"]
  const scenario = createDynamicConversationScenario({
    activeAdmins: admins,
    relationshipState: createEmptyState(),
    thresholdMessages: 20,
    messageDelayMs: 65000
  })

  assert.equal(scenario.length, 24)
  for (const step of scenario) {
    assert.notEqual(step.sender, step.recipient)
    assert.ok(admins.includes(step.sender))
    assert.ok(admins.includes(step.recipient))
  }

  const pairs = new Set(
    scenario.map((step) => [step.sender, step.recipient].sort().join("<->"))
  )
  assert.deepEqual(
    [...pairs].sort(),
    [
      "admin-1<->admin-2",
      "admin-1<->admin-3",
      "admin-1<->admin-4",
      "admin-2<->admin-3",
      "admin-2<->admin-4",
      "admin-3<->admin-4"
    ]
  )

  // Belum ada riwayat sama sekali -> semua pasangan "baru", tidak ada admin
  // lama yang bisa mengenalkan, jadi urutan konfigurasi yang menentukan
  // starter tiap pasangan (index lebih kecil duluan).
  const firstSenderPerPair = new Map()
  for (const step of scenario) {
    const key = [step.sender, step.recipient].sort().join("<->")
    if (!firstSenderPerPair.has(key)) firstSenderPerPair.set(key, step.sender)
  }
  assert.equal(firstSenderPerPair.get("admin-1<->admin-2"), "admin-1")
  assert.equal(firstSenderPerPair.get("admin-1<->admin-3"), "admin-1")
  assert.equal(firstSenderPerPair.get("admin-1<->admin-4"), "admin-1")
  assert.equal(firstSenderPerPair.get("admin-2<->admin-3"), "admin-2")
  assert.equal(firstSenderPerPair.get("admin-2<->admin-4"), "admin-2")
  assert.equal(firstSenderPerPair.get("admin-3<->admin-4"), "admin-3")
})

test("createDynamicConversationScenario: pasangan lama diproses duluan, admin lama wajib menyapa admin baru", () => {
  const threshold = 20
  let state = createEmptyState()
  // admin-1 <-> admin-2 sudah pernah chat sebelumnya, dan admin-1 sudah
  // mengirim cukup banyak pesan (jadi "lama"). admin-2 baru mengirim sedikit
  // (tetap "baru"). admin-3 dan admin-4 belum pernah chat dengan siapa pun.
  for (let i = 0; i < threshold; i += 1) {
    state = recordMessage(state, "admin-1", "admin-2", `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`)
  }
  state = recordMessage(state, "admin-2", "admin-1", "2026-01-01T00:01:00.000Z")

  const scenario = createDynamicConversationScenario({
    activeAdmins: ["admin-1", "admin-2", "admin-3", "admin-4"],
    relationshipState: state,
    thresholdMessages: threshold,
    messageDelayMs: 65000
  })

  // Pasangan admin-1<->admin-2 (sudah pernah chat) harus jadi 4 langkah pertama.
  const firstFourPairs = new Set(
    scenario.slice(0, 4).map((step) => [step.sender, step.recipient].sort().join("<->"))
  )
  assert.deepEqual([...firstFourPairs], ["admin-1<->admin-2"])

  const firstSenderPerPair = new Map()
  for (const step of scenario) {
    const key = [step.sender, step.recipient].sort().join("<->")
    if (!firstSenderPerPair.has(key)) firstSenderPerPair.set(key, step.sender)
  }
  // admin-1 "lama" wajib menyapa duluan ke admin-3/admin-4 yang "baru".
  assert.equal(firstSenderPerPair.get("admin-1<->admin-3"), "admin-1")
  assert.equal(firstSenderPerPair.get("admin-1<->admin-4"), "admin-1")
  // admin-2 dan admin-3/admin-4 sama-sama "baru" -> urutan konfigurasi.
  assert.equal(firstSenderPerPair.get("admin-2<->admin-3"), "admin-2")
  assert.equal(firstSenderPerPair.get("admin-2<->admin-4"), "admin-2")
  assert.equal(firstSenderPerPair.get("admin-3<->admin-4"), "admin-3")
})

test("createDynamicConversationScenario: dua admin baru boleh langsung chat kalau tidak ada admin lama yang aktif", () => {
  const scenario = createDynamicConversationScenario({
    activeAdmins: ["admin-3", "admin-4"],
    relationshipState: createEmptyState(),
    thresholdMessages: 20,
    messageDelayMs: 65000
  })

  assert.equal(scenario.length, 4)
  assert.deepEqual(
    scenario.map((step) => [step.sender, step.recipient]),
    [
      ["admin-3", "admin-4"],
      ["admin-4", "admin-3"],
      ["admin-3", "admin-4"],
      ["admin-4", "admin-3"]
    ]
  )
})

test("createDynamicConversationScenario: maxSteps memotong hasil akhir", () => {
  const scenario = createDynamicConversationScenario({
    activeAdmins: ["admin-1", "admin-2", "admin-3", "admin-4"],
    relationshipState: createEmptyState(),
    thresholdMessages: 20,
    messageDelayMs: 65000,
    maxSteps: 5
  })

  assert.equal(scenario.length, 5)
})

test("createDynamicConversationScenario: menolak kurang dari 2 admin aktif", () => {
  assert.throws(
    () =>
      createDynamicConversationScenario({
        activeAdmins: ["admin-1"],
        relationshipState: createEmptyState(),
        thresholdMessages: 20,
        messageDelayMs: 65000
      }),
    /minimal 2 admin aktif/
  )
})

test("validator menormalisasi skenario valid", () => {
  const result = validateScenario(
    [{ sender: "admin-1", recipient: "admin-2", text: "  Halo  ", delayMs: 1000 }],
    { maxSteps: 1 }
  )

  assert.deepEqual(result, [
    { sender: "admin-1", recipient: "admin-2", text: "Halo", delayMs: 1000 }
  ])
})

test("validator menerima daftar participants kustom", () => {
  const result = validateScenario(
    [{ sender: "admin-3", recipient: "admin-4", text: "Halo", delayMs: 0 }],
    { maxSteps: 1, participants: FOUR_ADMINS }
  )

  assert.deepEqual(result, [
    { sender: "admin-3", recipient: "admin-4", text: "Halo", delayMs: 0 }
  ])
})

test("validator menolak skenario kosong, sender, recipient, sender=recipient, text, delay, dan maxSteps invalid", () => {
  assert.throws(() => validateScenario([]), ScenarioValidationError)
  assert.throws(
    () =>
      validateScenario([
        { sender: "admin-3", recipient: "admin-2", text: "Halo", delayMs: 0 }
      ]),
    /sender harus salah satu dari/
  )
  assert.throws(
    () =>
      validateScenario([
        { sender: "admin-1", recipient: "admin-3", text: "Halo", delayMs: 0 }
      ]),
    /recipient harus salah satu dari/
  )
  assert.throws(
    () =>
      validateScenario([
        { sender: "admin-1", recipient: "admin-1", text: "Halo", delayMs: 0 }
      ]),
    /tidak boleh sama/
  )
  assert.throws(
    () =>
      validateScenario([
        { sender: "admin-1", recipient: "admin-2", text: " ", delayMs: 0 }
      ]),
    /text harus memiliki panjang/
  )
  assert.throws(
    () =>
      validateScenario([
        { sender: "admin-1", recipient: "admin-2", text: "Halo", delayMs: -1 }
      ]),
    /delayMs harus berupa bilangan bulat/
  )
  assert.throws(
    () =>
      validateScenario(
        [
          { sender: "admin-1", recipient: "admin-2", text: "Satu", delayMs: 0 },
          { sender: "admin-2", recipient: "admin-1", text: "Dua", delayMs: 0 }
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
    { sender: "admin-1", recipient: "admin-2", text: "Satu", delayMs: 0 },
    { sender: "admin-2", recipient: "admin-1", text: "Dua", delayMs: 65000 }
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

test("runner mendukung participants lebih dari dua admin", async () => {
  const manager = createManager()
  const runner = createConversationRunner({
    sessionManager: manager,
    logger: createLogger(),
    wait: async () => { }
  })
  const scenario = [
    { sender: "admin-3", recipient: "admin-4", text: "Halo", delayMs: 0 }
  ]

  const result = await runner.run(scenario, {
    maxSteps: 1,
    participants: FOUR_ADMINS
  })

  assert.equal(result.status, "completed")
  assert.deepEqual(
    manager.sent.map(({ sender, recipient }) => ({ sender, recipient })),
    [{ sender: "admin-3", recipient: "admin-4" }]
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
        { sender: "admin-1", recipient: "admin-2", text: "Satu", delayMs: 0 },
        { sender: "admin-2", recipient: "admin-1", text: "Dua", delayMs: 1000 }
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
    wait: async () => { }
  })

  const result = await runner.run(
    [
      { sender: "admin-1", recipient: "admin-2", text: "Satu", delayMs: 0 },
      { sender: "admin-2", recipient: "admin-1", text: "Dua", delayMs: 0 }
    ],
    { maxSteps: 2, deliveryReceiptTimeoutMs: 10 }
  )

  assert.equal(result.executedSteps, 2)
  assert.equal(result.results[0].deliveryConfirmed, false)
  assert.equal(result.results[0].deliveryStatus, null)
  assert.equal(result.results[1].deliveryConfirmed, true)
})

test("runner mencatat riwayat lewat historyRecorder setelah pesan berhasil terkirim", async () => {
  const manager = createManager()
  const recorded = []
  const historyRecorder = {
    record(sender, recipient, timestamp) {
      recorded.push({ sender, recipient, timestamp })
    }
  }
  const runner = createConversationRunner({
    sessionManager: manager,
    logger: createLogger(),
    wait: async () => { },
    historyRecorder
  })

  await runner.run(
    [
      { sender: "admin-1", recipient: "admin-2", text: "Satu", delayMs: 0 },
      { sender: "admin-2", recipient: "admin-1", text: "Dua", delayMs: 0 }
    ],
    { maxSteps: 2 }
  )

  assert.deepEqual(
    recorded.map(({ sender, recipient }) => ({ sender, recipient })),
    [
      { sender: "admin-1", recipient: "admin-2" },
      { sender: "admin-2", recipient: "admin-1" }
    ]
  )
  for (const entry of recorded) {
    assert.ok(entry.timestamp)
  }
})

test("runner tetap melanjutkan skenario walau historyRecorder gagal mencatat (mis. saveState gagal)", async () => {
  const manager = createManager()
  const warnings = []
  const logger = {
    info() { },
    warn(event, meta) {
      warnings.push({ event, meta })
    },
    error() { }
  }
  const historyRecorder = {
    record() {
      throw new Error("disk penuh (simulasi)")
    }
  }
  const runner = createConversationRunner({
    sessionManager: manager,
    logger,
    wait: async () => { },
    historyRecorder
  })

  const result = await runner.run(
    [
      { sender: "admin-1", recipient: "admin-2", text: "Satu", delayMs: 0 },
      { sender: "admin-2", recipient: "admin-1", text: "Dua", delayMs: 0 }
    ],
    { maxSteps: 2 }
  )

  assert.equal(result.status, "completed")
  assert.equal(result.executedSteps, 2)
  assert.equal(manager.sent.length, 2)
  assert.equal(
    warnings.filter((w) => w.event === "conversation.step.history-record-failed").length,
    2
  )
})

test("runner tidak mencatat riwayat sama sekali kalau historyRecorder tidak diberikan", async () => {
  const manager = createManager()
  const runner = createConversationRunner({
    sessionManager: manager,
    logger: createLogger(),
    wait: async () => { }
  })

  const result = await runner.run(
    [{ sender: "admin-1", recipient: "admin-2", text: "Satu", delayMs: 0 }],
    { maxSteps: 1 }
  )

  assert.equal(result.status, "completed")
})

test("runner menghormati AbortSignal sebelum percakapan dimulai", async () => {
  const manager = createManager()
  const controller = new AbortController()
  controller.abort()
  const runner = createConversationRunner({
    sessionManager: manager,
    logger: createLogger(),
    wait: async () => { }
  })

  await assert.rejects(
    runner.run(
      [{ sender: "admin-1", recipient: "admin-2", text: "Satu", delayMs: 0 }],
      { maxSteps: 1, signal: controller.signal }
    ),
    (error) =>
      error instanceof ConversationInterruptedError &&
      error.reason === "aborted"
  )
  assert.equal(manager.sent.length, 0)
})
