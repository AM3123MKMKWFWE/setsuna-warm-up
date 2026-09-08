import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import { DisconnectReason, WAMessageStatus } from "@whiskeysockets/baileys"

import { SESSION_STATE } from "../src/sessions/session-state.js"
import { WhatsAppSession } from "../src/sessions/whatsapp-session.js"

function createFakeLogger() {
  return {
    info() {},
    warn() {},
    error() {}
  }
}

function createHarness(options = {}) {
  const ev = new EventEmitter()
  const sentMessages = []
  const socketConfigsUsed = []
  let savedCredentials = 0
  let ended = 0
  const readMessagesCalls = []
  const presenceUpdateCalls = []
  const socket = {
    ev,
    user: { id: "628123456789:17@s.whatsapp.net" },
    async onWhatsApp(jid) {
      return [{ jid, exists: true }]
    },
    async sendMessage(jid, content) {
      sentMessages.push({ jid, content })
      return { key: { id: "message-1" } }
    },
    async readMessages(keys) {
      readMessagesCalls.push({ keys, at: Date.now() })
    },
    async sendPresenceUpdate(state, jid) {
      presenceUpdateCalls.push({ state, jid, at: Date.now() })
    },
    async end() {
      ended += 1
    }
  }
  const session = new WhatsAppSession({
    name: options.name ?? "admin-1",
    authDirectory: "C:/sessions/admin-1",
    logger: options.logger ?? createFakeLogger(),
    reconnectLimit: options.reconnectLimit ?? 0,
    reconnectBaseDelayMs: 1,
    reconnectMaxDelayMs: 2,
    authStateLoader: async () => ({
      state: {},
      saveCreds: async () => {
        savedCredentials += 1
      }
    }),
    makeSocket: (config) => {
      socketConfigsUsed.push(config)
      return socket
    },
    qrRenderer: async () => {},
    disconnectReason: DisconnectReason,
    baileysLogger: {},
    sessionHealth: options.sessionHealth ?? { enabled: false },
    humanEntropy: options.humanEntropy,
    humanEntropyFactory: options.humanEntropyFactory,
    deviceFingerprint: options.deviceFingerprint,
    stealthConnect: options.stealthConnect,
    generateFingerprint: options.generateFingerprint,
    applyFingerprint: options.applyFingerprint,
    getStealthSocketConfig: options.getStealthSocketConfig,
    rampPresenceAfterConnect: options.rampPresenceAfterConnect,
    readReceiptVariance: options.readReceiptVariance,
    readReceiptVarianceFactory: options.readReceiptVarianceFactory,
    sessionFingerprint: options.sessionFingerprint,
    generateSessionFingerprint: options.generateSessionFingerprint,
    applySessionFingerprint: options.applySessionFingerprint,
    getRetryJitter: options.getRetryJitter
  })

  return {
    session,
    socket,
    sentMessages,
    socketConfigsUsed,
    readMessagesCalls,
    presenceUpdateCalls,
    get savedCredentials() {
      return savedCredentials
    },
    get ended() {
      return ended
    }
  }
}

test("session mencapai ready, menyimpan credential, dan mengirim teks", async () => {
  const harness = createHarness()

  await harness.session.start()
  assert.equal(harness.session.state, SESSION_STATE.CONNECTING)

  const ready = harness.session.waitUntilReady({ timeoutMs: 100 })
  harness.socket.ev.emit("creds.update", {})
  harness.socket.ev.emit("connection.update", { connection: "open" })

  await ready
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(harness.savedCredentials, 1)
  assert.equal(harness.session.state, SESSION_STATE.READY)
  assert.equal(harness.session.getOwnJid(), "628123456789@s.whatsapp.net")
  assert.equal(
    await harness.session.resolveTargetJid("628999999999"),
    "628999999999@s.whatsapp.net"
  )

  await harness.session.sendText("628123456789", "Halo")
  assert.deepEqual(harness.sentMessages, [
    {
      jid: "628123456789@s.whatsapp.net",
      content: { text: "Halo" }
    }
  ])

  await harness.session.stop("test")
  assert.equal(harness.session.state, SESSION_STATE.STOPPED)
  assert.equal(harness.session.userJid, null)
  assert.equal(harness.ended, 1)
})

test("session health menghentikan pengiriman saat Bad MAC melewati ambang", async () => {
  const harness = createHarness({
    sessionHealth: {
      enabled: true,
      badMacThreshold: 2,
      badMacWindowMs: 60000
    }
  })

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })
  harness.socket.ev.emit("messages.upsert", {
    messages: [{ message: { conversation: "Pesan valid" } }]
  })
  harness.socket.ev.emit("messages.upsert", {
    messages: [
      { messageStubType: 2 },
      { messageStubType: 2 }
    ]
  })

  assert.equal(harness.session.state, SESSION_STATE.DEGRADED)
  assert.equal(harness.session.snapshot().health.decryptSuccess, 1)
  assert.equal(harness.session.snapshot().health.badMacCount, 2)
  await assert.rejects(
    harness.session.sendText("628999999999", "Jangan dikirim"),
    /state saat ini: degraded/
  )
  await harness.session.stop("test")
})

test("session menulis log konfigurasi, health snapshot, ready, dan stop summary", async () => {
  const entries = []
  const logger = {
    info: (event, meta) => entries.push({ level: "info", event, meta }),
    warn: (event, meta) => entries.push({ level: "warn", event, meta }),
    error: (event, meta) => entries.push({ level: "error", event, meta })
  }
  const harness = createHarness({
    logger,
    sessionHealth: {
      enabled: true,
      badMacThreshold: 3,
      badMacWindowMs: 60000
    },
    humanEntropy: { enabled: false }
  })

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })
  harness.socket.ev.emit("messages.upsert", {
    messages: [
      { message: { conversation: "Pesan valid" } },
      { messageStubType: 2 }
    ]
  })
  await harness.session.stop("test-observability")

  const eventNames = entries.map((entry) => entry.event)
  assert.equal(eventNames.includes("session.features.configured"), true)
  assert.equal(eventNames.includes("session.ready.summary"), true)
  assert.equal(eventNames.includes("session.health.observed"), true)
  assert.equal(eventNames.includes("session.stop.summary"), true)

  const healthEntry = entries.find(
    (entry) => entry.event === "session.health.observed"
  )
  assert.equal(healthEntry.meta.decryptSuccess, 1)
  assert.equal(healthEntry.meta.decryptFail, 1)
  assert.equal(healthEntry.meta.stats.badMacCount, 1)
})

test("session menolak target yang tidak dapat diverifikasi", async () => {
  const harness = createHarness()
  harness.socket.onWhatsApp = async () => []

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })

  await assert.rejects(
    harness.session.resolveTargetJid("628999999999"),
    /tidak terdaftar atau tidak dapat diverifikasi/
  )
  await harness.session.stop("test")
})

test("session menunggu konfirmasi delivery untuk messageId yang tepat", async () => {
  const harness = createHarness()

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })

  const result = await harness.session.sendText("628123456789", "Halo")
  const delivery = harness.session.waitForMessageStatus(result.key.id, {
    timeoutMs: 100
  })

  harness.socket.ev.emit("messages.update", [
    {
      key: { id: "pesan-lain" },
      update: { status: WAMessageStatus.DELIVERY_ACK }
    },
    {
      key: { id: result.key.id },
      update: { status: WAMessageStatus.DELIVERY_ACK }
    }
  ])

  assert.equal(await delivery, WAMessageStatus.DELIVERY_ACK)
  await harness.session.stop("test")
})

test("session melaporkan timeout jika delivery belum terkonfirmasi", async () => {
  const harness = createHarness()

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })

  await assert.rejects(
    harness.session.waitForMessageStatus("message-tidak-ada", {
      timeoutMs: 10
    }),
    /tidak diterima dalam 10ms/
  )
  await harness.session.stop("test")
})

test("logged out menghentikan reconnect otomatis", async () => {
  const harness = createHarness({ reconnectLimit: 5 })

  await harness.session.start()
  harness.socket.ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: {
      error: { output: { statusCode: DisconnectReason.loggedOut } }
    }
  })

  assert.equal(harness.session.state, SESSION_STATE.LOGGED_OUT)
  await assert.rejects(
    harness.session.waitUntilReady(),
    /state saat ini: logged-out/
  )
})

test("reconnect berhenti ketika batas percobaan nol", async () => {
  const harness = createHarness({ reconnectLimit: 0 })

  await harness.session.start()
  harness.socket.ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: {
      error: { output: { statusCode: DisconnectReason.connectionClosed } }
    }
  })

  assert.equal(harness.session.state, SESSION_STATE.STOPPED)
})

test("device fingerprint nonaktif secara default: socket config tidak berubah", async () => {
  const harness = createHarness()

  await harness.session.start()

  assert.equal(harness.socketConfigsUsed.length, 1)
  assert.equal("version" in harness.socketConfigsUsed[0], false)
  assert.equal("browser" in harness.socketConfigsUsed[0], false)
  assert.equal(harness.session.snapshot().fingerprint, null)

  await harness.session.stop("test")
})

test("device fingerprint deterministik per nama session ketika diaktifkan", async () => {
  const harnessA1 = createHarness({
    name: "admin-1",
    deviceFingerprint: { enabled: true }
  })
  const harnessA1Again = createHarness({
    name: "admin-1",
    deviceFingerprint: { enabled: true }
  })
  const harnessA2 = createHarness({
    name: "admin-2",
    deviceFingerprint: { enabled: true }
  })

  await harnessA1.session.start()
  await harnessA1Again.session.start()
  await harnessA2.session.start()

  const fpA1 = harnessA1.session.snapshot().fingerprint
  const fpA1Again = harnessA1Again.session.snapshot().fingerprint
  const fpA2 = harnessA2.session.snapshot().fingerprint

  // Same session name -> same fingerprint (stable across restarts).
  assert.deepEqual(fpA1, fpA1Again)
  // Different session name -> different fingerprint (not all instances
  // advertising the same device to WhatsApp).
  assert.notDeepEqual(fpA1, fpA2)

  const socketConfig = harnessA1.socketConfigsUsed[0]
  assert.equal(Array.isArray(socketConfig.browser), true)
  assert.equal(socketConfig.browser[0], fpA1.deviceModel)
  assert.equal(socketConfig.browser[1], fpA1.osVersion)
  assert.equal(socketConfig.browser[2], `WhatsApp/${fpA1.appVersion}`)

  await harnessA1.session.stop("test")
  await harnessA1Again.session.stop("test")
  await harnessA2.session.stop("test")
})

test("human entropy tetap tersedia saat SESSION_HEALTH_ENABLED dimatikan", async () => {
  // Regresi BUG-004: humanEntropyFactory dulu cuma di-assign di dalam blok
  // `if (sessionHealth.enabled !== false)`, jadi kalau SESSION_HEALTH_ENABLED
  // dimatikan sementara HUMAN_ENTROPY_ENABLED aktif, factory-nya tidak pernah
  // ter-set dan #startHumanEntropy() akan crash memanggil undefined().
  let started = false
  const harness = createHarness({
    sessionHealth: { enabled: false },
    humanEntropy: { enabled: true, minIntervalMs: 1000, maxIntervalMs: 2000 },
    humanEntropyFactory: () => ({
      start: () => {
        started = true
      },
      stop: () => {}
    })
  })

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })

  assert.equal(started, true)

  await harness.session.stop("test")
})

test("human entropy yang gagal dibuat tidak menjatuhkan session (defense-in-depth)", async () => {
  // Regresi BUG-004. Sejak perbaikan ini, factory default (createHumanEntropyService
  // di human-entropy.js) tidak lagi punya masalah constructor seperti
  // HumanEntropyService asli baileys-antiban (constructor (wasp, sessionId,
  // config) yang butuh objek "wasp" ber-method .on()/.getProvider()). Tapi
  // #startHumanEntropy() harus tetap aman terhadap FACTORY APA PUN yang gagal
  // -- termasuk kalau nanti ada yang meng-inject factory lain yang salah.
  // Test ini meniru persis kegagalan lama itu untuk memastikan try/catch-nya
  // masih bekerja, bukan untuk menyatakan itu perilaku default saat ini.
  const errors = []
  const harness = createHarness({
    logger: {
      info() {},
      warn() {},
      error: (event, meta) => errors.push({ event, meta })
    },
    humanEntropy: { enabled: true },
    humanEntropyFactory: () => {
      throw new TypeError("this.wasp.on is not a function")
    }
  })

  await harness.session.start()

  assert.doesNotThrow(() => {
    harness.socket.ev.emit("connection.update", { connection: "open" })
  })

  assert.equal(harness.session.state, SESSION_STATE.READY)
  assert.equal(
    errors.some(
      (entry) => entry.event === "session.human-entropy.start-failed"
    ),
    true
  )

  await harness.session.stop("test")
})

test("pesan masuk tidak crash walau instance human entropy tidak punya addRecentContact (defense-in-depth)", async () => {
  // Regresi BUG-004. HumanEntropyService asli baileys-antiban tidak pernah
  // punya method publik addRecentContact() -- itu diasumsikan salah oleh
  // kode lama. Factory default sekarang (createHumanEntropyService) memang
  // punya method ini (lihat test di bawah), tapi #onMessagesUpsert tetap
  // harus aman kalau suatu saat ada factory lain yang tidak menyediakannya.
  const harness = createHarness({
    humanEntropy: { enabled: true },
    humanEntropyFactory: () => ({
      start: () => {},
      stop: () => {}
    })
  })

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })

  assert.doesNotThrow(() => {
    harness.socket.ev.emit("messages.upsert", {
      messages: [
        {
          key: {
            remoteJid: "628123456789@s.whatsapp.net",
            fromMe: false,
            id: "MSG1"
          },
          message: { conversation: "hai" }
        }
      ]
    })
  })

  await harness.session.stop("test")
})

test("human entropy (implementasi default createHumanEntropyService, tanpa override) benar-benar berjalan lewat WhatsAppSession", async () => {
  // Ini bukti BUG-004 sungguh diperbaiki, bukan cuma dijadikan aman: TIDAK
  // ada humanEntropyFactory yang di-override, jadi ini memakai
  // createHumanEntropyService asli dari human-entropy.js persis seperti yang
  // dipakai di produksi.
  const harness = createHarness({
    humanEntropy: { enabled: true, minIntervalMs: 1, maxIntervalMs: 5 }
  })

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })

  // Pesan masuk ter-track tanpa error (dulu crash di sini -- BUG-004 poin 2).
  assert.doesNotThrow(() => {
    harness.socket.ev.emit("messages.upsert", {
      messages: [
        {
          key: {
            remoteJid: "628123456789@s.whatsapp.net",
            fromMe: false,
            id: "MSG1"
          },
          message: { conversation: "hai" }
        }
      ]
    })
  })

  // Interval 1-5ms dengan probabilitas default (bukan 0) berarti puluhan
  // siklus sempat berjalan dalam 300ms -- practically certain setidaknya
  // satu aksi presence terjadi kalau wiring-nya benar.
  await new Promise((resolve) => setTimeout(resolve, 300))

  assert.equal(harness.presenceUpdateCalls.length > 0, true)

  await harness.session.stop("test")
})

test("device fingerprint (implementasi asli baileys-antiban) tidak menimpa version protokol WhatsApp", async () => {
  // Sengaja TIDAK meng-override generateFingerprint/applyFingerprint supaya
  // memakai implementasi asli dari baileys-antiban. Implementasi asli itu
  // menimpa socketConfig.version dengan skema versi mobile-app lama
  // ([major, minor, patch, build], mis. [2, 24, 5, 18]) yang tidak
  // kompatibel dengan skema versi protokol WA multi-device Baileys saat ini
  // ([2, 3000, buildNumber]). Ini persis penyebab disconnect fatal
  // (statusCode 405) yang teramati di real-world testing begitu
  // DEVICE_FINGERPRINT_ENABLED dinyalakan. #connect() harus membuang field
  // version tersebut agar Baileys tetap memakai versi bawaannya yang benar.
  const harness = createHarness({
    deviceFingerprint: { enabled: true }
  })

  await harness.session.start()

  const socketConfig = harness.socketConfigsUsed[0]
  assert.equal("version" in socketConfig, false)
  // browser tuple tetap dipakai -- itu kosmetik (nama linked device), bukan
  // bagian dari negosiasi protokol, jadi aman untuk dirandomisasi.
  assert.equal(Array.isArray(socketConfig.browser), true)

  await harness.session.stop("test")
})

test("session fingerprint (implementasi asli baileys-antiban) tidak menimpa version protokol WhatsApp", async () => {
  const harness = createHarness({
    sessionFingerprint: { enabled: true }
  })

  await harness.session.start()

  const socketConfig = harness.socketConfigsUsed[0]
  assert.equal("version" in socketConfig, false)
  assert.equal(Array.isArray(socketConfig.browser), true)

  await harness.session.stop("test")
})

test("stealth connect menerapkan browser tuple dan menjalankan presence ramp yang bisa dibatalkan", async () => {
  let rampCalls = 0
  let abortedRamp = false
  const harness = createHarness({
    stealthConnect: {
      enabled: true,
      presenceRampMinMs: 10,
      presenceRampMaxMs: 20
    },
    getStealthSocketConfig: () => ({
      markOnlineOnConnect: false,
      browser: ["Windows", "Chrome", "121.0.0.0"]
    }),
    rampPresenceAfterConnect: (_socket, { signal }) => {
      rampCalls += 1
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          abortedRamp = true
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        })
        // Never resolves on its own within the test window, so we can
        // assert the abort path fires on disconnect/stop.
      })
    }
  })

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })

  assert.deepEqual(harness.socketConfigsUsed[0].browser, [
    "Windows",
    "Chrome",
    "121.0.0.0"
  ])
  assert.equal(rampCalls, 1)

  await harness.session.stop("test")
  assert.equal(abortedRamp, true)
})

test("device fingerprint diterapkan setelah stealth connect (fingerprint menang pada field browser)", async () => {
  const harness = createHarness({
    deviceFingerprint: { enabled: true },
    stealthConnect: { enabled: true },
    getStealthSocketConfig: () => ({
      markOnlineOnConnect: false,
      browser: ["Windows", "Chrome", "121.0.0.0"]
    }),
    rampPresenceAfterConnect: async () => {}
  })

  await harness.session.start()

  const fingerprint = harness.session.snapshot().fingerprint
  const socketConfig = harness.socketConfigsUsed[0]

  // Fingerprint's [deviceModel, osVersion, WhatsApp/version] tuple must win
  // over stealth connect's ["Windows", "Chrome", ...] tuple.
  assert.equal(socketConfig.browser[0], fingerprint.deviceModel)
  assert.notEqual(socketConfig.browser[0], "Windows")

  await harness.session.stop("test")
})

test("session fingerprint nonaktif secara default", async () => {
  const harness = createHarness()

  await harness.session.start()

  assert.equal("__sessionFingerprint" in harness.socketConfigsUsed[0], false)

  await harness.session.stop("test")
})

test("session fingerprint mengalahkan device fingerprint dan menambah jitter reconnect", async () => {
  let retryJitterCalls = 0
  const harness = createHarness({
    reconnectLimit: 5,
    deviceFingerprint: { enabled: true },
    sessionFingerprint: { enabled: true },
    generateSessionFingerprint: (_config, sessionId) => ({
      device: {
        appVersion: [9, 9, 9, 9],
        osVersion: "99",
        deviceModel: "Session Fingerprint Device",
        sessionId
      },
      networkTiming: { sendJitterMs: 100, typingJitterMs: 50, retryJitterMs: 400 },
      voiceNote: { waveformSeed: 1, durationJitterMs: 1, sampleRate: 16000 },
      connectionState: {
        idleTimeoutMs: 30000,
        keepaliveMs: 20000,
        batteryLevel: 80,
        batteryCharging: false
      },
      protocolVersion: "9.9.9",
      sessionId,
      createdAt: Date.now()
    }),
    applySessionFingerprint: (config, fingerprint) => ({
      ...config,
      version: fingerprint.device.appVersion,
      browser: [
        fingerprint.device.deviceModel,
        fingerprint.device.osVersion,
        `WhatsApp/${fingerprint.device.appVersion.join(".")}`
      ],
      __sessionFingerprint: fingerprint
    }),
    getRetryJitter: (fingerprint) => {
      retryJitterCalls += 1
      return fingerprint.networkTiming.retryJitterMs
    }
  })

  await harness.session.start()

  const socketConfig = harness.socketConfigsUsed[0]
  assert.equal(socketConfig.browser[0], "Session Fingerprint Device")
  assert.equal(socketConfig.__sessionFingerprint.protocolVersion, "9.9.9")
  // snapshot().fingerprint reuses the session fingerprint's device profile.
  assert.equal(
    harness.session.snapshot().fingerprint.deviceModel,
    "Session Fingerprint Device"
  )

  // Trigger a reconnect so #scheduleReconnect runs with the jitter helper.
  harness.socket.ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: {
      error: { output: { statusCode: DisconnectReason.connectionClosed } }
    }
  })

  assert.equal(retryJitterCalls, 1)
  await harness.session.stop("test")
})

test("read receipt variance nonaktif secara default: readMessages tidak dibungkus", async () => {
  const harness = createHarness()

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })

  const before = Date.now()
  await harness.session.socket.readMessages([{ id: "1", messageTimestamp: Math.floor(before / 1000) }])
  assert.equal(harness.readMessagesCalls.length, 1)

  await harness.session.stop("test")
})

test("read receipt variance aktif membungkus readMessages dengan delay", async () => {
  const harness = createHarness({
    readReceiptVariance: { enabled: true, meanMs: 5, stdDevMs: 0 }
  })

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })

  const before = Date.now()
  await harness.session.socket.readMessages([
    { id: "1", messageTimestamp: Math.floor(before / 1000) }
  ])
  const elapsed = Date.now() - before

  assert.equal(harness.readMessagesCalls.length, 1)
  // meanMs: 5 with stdDevMs: 0 clamps to the library's default minMs (200ms)
  // since we didn't override it — real behavior, not an arbitrary bound.
  assert.equal(elapsed >= 150, true)

  await harness.session.stop("test")
})
