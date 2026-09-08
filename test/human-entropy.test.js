import assert from "node:assert/strict"
import test from "node:test"

import { createHumanEntropyService } from "../src/sessions/human-entropy.js"

function createFakeSocket() {
  const presenceCalls = []
  const readMessagesCalls = []
  return {
    presenceCalls,
    readMessagesCalls,
    async sendPresenceUpdate(state, jid) {
      presenceCalls.push({ state, jid })
    },
    async readMessages(keys) {
      readMessagesCalls.push(keys)
    }
  }
}

function createFakeLogger() {
  const entries = []
  return {
    entries,
    info: (event, meta) => entries.push({ level: "info", event, meta }),
    warn: (event, meta) => entries.push({ level: "warn", event, meta }),
    error: (event, meta) => entries.push({ level: "error", event, meta })
  }
}

test("enabled: false membuat start() tidak menjadwalkan siklus apa pun", async () => {
  const socket = createFakeSocket()
  let scheduled = false
  const service = createHumanEntropyService(socket, {
    enabled: false,
    random: () => {
      scheduled = true
      return 0
    }
  })

  service.start()
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.equal(scheduled, false)
  assert.equal(socket.presenceCalls.length, 0)
})

test("addRecentContact melacak kontak dan membatasi sampai maxRecentContacts", () => {
  const socket = createFakeSocket()
  const service = createHumanEntropyService(socket, {
    enabled: false,
    maxRecentContacts: 2
  })

  service.addRecentContact("a@s.whatsapp.net", { id: "1" })
  service.addRecentContact("b@s.whatsapp.net", { id: "2" })
  service.addRecentContact("c@s.whatsapp.net", { id: "3" })

  assert.equal(service.getRecentContacts().length, 2)
})

test("siklus dengan probabilitas 1 menjalankan typing, read receipt, dan presence toggle", async () => {
  const socket = createFakeSocket()
  const logger = createFakeLogger()
  const service = createHumanEntropyService(socket, {
    enabled: true,
    // Interval jauh lebih besar dari waktu tunggu test, supaya hanya SATU
    // siklus yang sempat berjalan sebelum stop() dipanggil (siklus berikutnya
    // baru dijadwalkan lagi setelah aksi siklus pertama selesai).
    minIntervalMs: 50,
    maxIntervalMs: 50,
    typingProbability: 1,
    readReceiptProbability: 1,
    presenceToggleProbability: 1,
    typingMinMs: 1,
    typingMaxMs: 1,
    presenceToggleMinMs: 1,
    presenceToggleMaxMs: 1,
    random: () => 0,
    logger
  })

  service.addRecentContact("628123456789@s.whatsapp.net", { id: "MSG1" })
  service.start()

  // Tunggu selesainya siklus pertama (tick 50ms + aksi ~1ms) lalu stop()
  // sebelum siklus kedua (dijadwalkan ulang di sekitar t=100ms) sempat mulai.
  await new Promise((resolve) => setTimeout(resolve, 70))
  service.stop()

  // Typing dan presence-toggle jalan paralel (Promise.allSettled), jadi urutan
  // ANTAR keduanya tidak dijamin -- yang harus benar adalah urutan DI DALAM
  // masing-masing pasangan (composing sebelum paused, available sebelum
  // unavailable).
  const states = socket.presenceCalls.map((c) => c.state)
  assert.equal(states.length, 4)
  assert.equal(states.filter((s) => s === "composing").length, 1)
  assert.equal(states.filter((s) => s === "paused").length, 1)
  assert.equal(states.filter((s) => s === "available").length, 1)
  assert.equal(states.filter((s) => s === "unavailable").length, 1)
  assert.equal(states.indexOf("composing") < states.indexOf("paused"), true)
  assert.equal(
    states.indexOf("available") < states.indexOf("unavailable"),
    true
  )
  assert.equal(socket.readMessagesCalls.length, 1)
  assert.deepEqual(socket.readMessagesCalls[0], [{ id: "MSG1" }])
  assert.deepEqual(service.getStats(), {
    running: false,
    recentContacts: 1,
    pendingReadReceipts: 0,
    cycles: 1,
    skippedCycles: 0,
    typingActions: 1,
    readActions: 1,
    presenceActions: 1,
    failedActions: 0
  })
  assert.equal(
    logger.entries.some((entry) => entry.event === "human-entropy.cycle.scheduled"),
    true
  )
  assert.equal(
    logger.entries.some((entry) => entry.event === "human-entropy.cycle.completed"),
    true
  )
  assert.equal(
    logger.entries.some((entry) => entry.event === "human-entropy.stopped"),
    true
  )
})

test("siklus dengan probabilitas 0 tidak melakukan aksi apa pun walau ada kontak", async () => {
  const socket = createFakeSocket()
  const service = createHumanEntropyService(socket, {
    enabled: true,
    minIntervalMs: 1,
    maxIntervalMs: 1,
    typingProbability: 0,
    readReceiptProbability: 0,
    presenceToggleProbability: 0,
    random: () => 0.999
  })

  service.addRecentContact("628123456789@s.whatsapp.net", { id: "MSG1" })
  service.start()

  await new Promise((resolve) => setTimeout(resolve, 30))
  service.stop()

  assert.equal(socket.presenceCalls.length, 0)
  assert.equal(socket.readMessagesCalls.length, 0)
})

test("stop() membatalkan siklus yang belum berjalan", async () => {
  const socket = createFakeSocket()
  const service = createHumanEntropyService(socket, {
    enabled: true,
    minIntervalMs: 20,
    maxIntervalMs: 20,
    typingProbability: 1,
    random: () => 0
  })

  service.addRecentContact("628123456789@s.whatsapp.net", { id: "MSG1" })
  service.start()
  service.stop()

  await new Promise((resolve) => setTimeout(resolve, 40))

  assert.equal(socket.presenceCalls.length, 0)
})

test("aksi yang gagal tidak melempar error ke pemanggil dan tetap dicatat", async () => {
  const failingSocket = {
    async sendPresenceUpdate() {
      throw new Error("socket tertutup")
    },
    async readMessages() {
      throw new Error("socket tertutup")
    }
  }
  const logger = createFakeLogger()
  const service = createHumanEntropyService(failingSocket, {
    enabled: true,
    minIntervalMs: 1,
    maxIntervalMs: 1,
    typingProbability: 1,
    readReceiptProbability: 1,
    presenceToggleProbability: 0,
    random: () => 0,
    logger
  })

  service.addRecentContact("628123456789@s.whatsapp.net", { id: "MSG1" })
  service.start()

  await new Promise((resolve) => setTimeout(resolve, 30))
  service.stop()

  assert.equal(
    logger.entries.some((e) => e.event === "human-entropy.cycle.typing-failed"),
    true
  )
  assert.equal(
    logger.entries.some(
      (e) => e.event === "human-entropy.cycle.read-receipt-failed"
    ),
    true
  )
})
