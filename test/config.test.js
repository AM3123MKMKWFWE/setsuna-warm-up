import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"

import { ConfigurationError, loadConfig, summarizeConfig } from "../src/config.js"

test("loadConfig menggunakan nilai default Tahap 1 yang aman", () => {
  const config = loadConfig({}, { cwd: "C:/workspace" })

  assert.equal(config.mode, "conversation")
  assert.equal(config.logLevel, "info")
  assert.equal(config.whatsappConnectionEnabled, false)
  assert.equal(config.showRawQr, false)
  assert.equal(config.sessionHealth.enabled, true)
  assert.equal(config.sessionHealth.badMacThreshold, 3)
  assert.equal(config.sessionHealth.badMacWindowMs, 60000)
  assert.equal(config.presence.enabled, false)
  assert.equal(config.presence.typingWPM, 45)
  assert.equal(config.presence.typingMinMs, 600)
  assert.equal(config.presence.typingMaxMs, 8000)
  assert.equal(config.limits.maxConversationSteps, 10)
  assert.equal(config.limits.messageDelayMs, 65000)
  assert.equal(config.limits.deliveryReceiptTimeoutMs, 30000)
  assert.equal("adminNumbersConfigured" in summarizeConfig(config), false)
})

test("konfigurasi logging ke file default aktif dengan direktori ./logs", () => {
  const config = loadConfig({}, { cwd: "C:/workspace" })

  assert.equal(config.logging.toFileEnabled, true)
  assert.equal(config.logging.directory, path.resolve("C:/workspace", "./logs"))

  const disabled = loadConfig(
    { LOG_TO_FILE_ENABLED: "false" },
    { cwd: "C:/workspace" }
  )
  assert.equal(disabled.logging.toFileEnabled, false)

  const customDir = loadConfig(
    { LOG_DIRECTORY: "./custom-logs" },
    { cwd: "C:/workspace" }
  )
  assert.equal(
    customDir.logging.directory,
    path.resolve("C:/workspace", "./custom-logs")
  )

  assert.throws(
    () => loadConfig({ LOG_DIRECTORY: "" }, { cwd: "C:/workspace" }),
    /LOG_DIRECTORY tidak boleh kosong/
  )
})

test("konfigurasi session health divalidasi", () => {
  assert.equal(
    loadConfig({ SESSION_HEALTH_ENABLED: "false" }).sessionHealth.enabled,
    false
  )
  assert.throws(
    () => loadConfig({ SESSION_BAD_MAC_THRESHOLD: "0" }),
    /antara 1 dan 100/
  )
})

test("konfigurasi presence QA bersifat opt-in dan tervalidasi", () => {
  const config = loadConfig({
    PRESENCE_ENABLED: "true",
    PRESENCE_TYPING_WPM: "55",
    PRESENCE_TYPING_MIN_MS: "800",
    PRESENCE_TYPING_MAX_MS: "5000"
  })

  assert.equal(config.presence.enabled, true)
  assert.equal(config.presence.typingWPM, 55)
  assert.equal(config.presence.typingMinMs, 800)
  assert.equal(config.presence.typingMaxMs, 5000)
  assert.throws(
    () => loadConfig({ PRESENCE_TYPING_WPM: "5" }),
    /antara 10 dan 120/
  )
})

test("konfigurasi human entropy bersifat opt-in", () => {
  const defaults = loadConfig({})
  assert.equal(defaults.humanEntropy.enabled, false)
  assert.equal(defaults.humanEntropy.minIntervalMs, 300000)
  assert.equal(defaults.humanEntropy.maxIntervalMs, 900000)

  const enabled = loadConfig({ HUMAN_ENTROPY_ENABLED: "true" })
  assert.equal(enabled.humanEntropy.enabled, true)
})

test("konfigurasi device fingerprint bersifat opt-in", () => {
  const defaults = loadConfig({})
  assert.equal(defaults.deviceFingerprint.enabled, false)

  const enabled = loadConfig({ DEVICE_FINGERPRINT_ENABLED: "true" })
  assert.equal(enabled.deviceFingerprint.enabled, true)
  assert.throws(
    () => loadConfig({ DEVICE_FINGERPRINT_ENABLED: "yes" }),
    /true atau false/
  )
})

test("konfigurasi stealth connect bersifat opt-in dan tervalidasi", () => {
  const defaults = loadConfig({})
  assert.equal(defaults.stealthConnect.enabled, false)
  assert.equal(defaults.stealthConnect.presenceRampMinMs, 30000)
  assert.equal(defaults.stealthConnect.presenceRampMaxMs, 90000)

  const enabled = loadConfig({
    STEALTH_CONNECT_ENABLED: "true",
    STEALTH_PRESENCE_RAMP_MIN_MS: "45000",
    STEALTH_PRESENCE_RAMP_MAX_MS: "120000"
  })
  assert.equal(enabled.stealthConnect.enabled, true)
  assert.equal(enabled.stealthConnect.presenceRampMinMs, 45000)
  assert.equal(enabled.stealthConnect.presenceRampMaxMs, 120000)
  assert.throws(
    () => loadConfig({ STEALTH_PRESENCE_RAMP_MIN_MS: "-1" }),
    /antara 0 dan 300000/
  )
})

test("summarizeConfig menyertakan deviceFingerprint dan stealthConnect", () => {
  const config = loadConfig({})
  const summary = summarizeConfig(config)
  assert.equal("deviceFingerprint" in summary, true)
  assert.equal("stealthConnect" in summary, true)
})

test("konfigurasi read receipt variance bersifat opt-in dan tervalidasi", () => {
  const defaults = loadConfig({})
  assert.equal(defaults.readReceiptVariance.enabled, false)
  assert.equal(defaults.readReceiptVariance.meanMs, 1500)
  assert.equal(defaults.readReceiptVariance.stdDevMs, 800)

  const enabled = loadConfig({
    READ_RECEIPT_VARIANCE_ENABLED: "true",
    READ_RECEIPT_VARIANCE_MEAN_MS: "2000",
    READ_RECEIPT_VARIANCE_STDDEV_MS: "500"
  })
  assert.equal(enabled.readReceiptVariance.enabled, true)
  assert.equal(enabled.readReceiptVariance.meanMs, 2000)
  assert.equal(enabled.readReceiptVariance.stdDevMs, 500)
  assert.throws(
    () => loadConfig({ READ_RECEIPT_VARIANCE_MEAN_MS: "-1" }),
    /antara 0 dan 60000/
  )
})

test("konfigurasi legitimacy signals bersifat opt-in dan probabilitas tervalidasi", () => {
  const defaults = loadConfig({})
  assert.equal(defaults.legitimacySignals.enabled, false)
  assert.equal(defaults.legitimacySignals.typoProbability, 0.025)

  const enabled = loadConfig({
    LEGITIMACY_SIGNALS_ENABLED: "true",
    LEGITIMACY_SIGNALS_TYPO_PROBABILITY: "0.05"
  })
  assert.equal(enabled.legitimacySignals.enabled, true)
  assert.equal(enabled.legitimacySignals.typoProbability, 0.05)
  assert.throws(
    () => loadConfig({ LEGITIMACY_SIGNALS_TYPO_PROBABILITY: "1.5" }),
    /antara 0 dan 1/
  )
  assert.throws(
    () => loadConfig({ LEGITIMACY_SIGNALS_TYPO_PROBABILITY: "-0.1" }),
    /antara 0 dan 1/
  )
})

test("konfigurasi session fingerprint bersifat opt-in", () => {
  const defaults = loadConfig({})
  assert.equal(defaults.sessionFingerprint.enabled, false)

  const enabled = loadConfig({ SESSION_FINGERPRINT_ENABLED: "true" })
  assert.equal(enabled.sessionFingerprint.enabled, true)
})

test("summarizeConfig menyertakan fitur baileys-antiban terbaru", () => {
  const config = loadConfig({})
  const summary = summarizeConfig(config)
  assert.equal("readReceiptVariance" in summary, true)
  assert.equal("legitimacySignals" in summary, true)
  assert.equal("sessionFingerprint" in summary, true)
  assert.equal("logging" in summary, true)
})

test("loadConfig menolak mode yang tidak didukung", () => {
  assert.throws(
    () => loadConfig({ APP_MODE: "broadcast" }),
    (error) =>
      error instanceof ConfigurationError && error.field === "APP_MODE"
  )
  assert.throws(
    () => loadConfig({ APP_MODE: "inbound" }),
    (error) =>
      error instanceof ConfigurationError && error.field === "APP_MODE"
  )
})

test("batas numerik divalidasi", () => {
  assert.throws(
    () => loadConfig({ MAX_CONVERSATION_STEPS: "0" }),
    /antara 1 dan 100/
  )
})

test("WA_CONNECT_ENABLED hanya menerima boolean eksplisit", () => {
  assert.equal(
    loadConfig({ WA_CONNECT_ENABLED: "true" }).whatsappConnectionEnabled,
    true
  )
  assert.throws(
    () => loadConfig({ WA_CONNECT_ENABLED: "yes" }),
    /true atau false/
  )
})

test("WA_QR_SHOW_RAW hanya aktif jika diminta eksplisit", () => {
  assert.equal(loadConfig({ WA_QR_SHOW_RAW: "true" }).showRawQr, true)
  assert.throws(() => loadConfig({ WA_QR_SHOW_RAW: "1" }), /true atau false/)
})

test("config.admins selalu berisi admin-1 dan admin-2 walau .env kosong", () => {
  const config = loadConfig({}, { cwd: "C:/workspace" })

  assert.deepEqual(Object.keys(config.admins), ["admin1", "admin2"])
  assert.equal(config.admins.admin1.name, "admin-1")
  assert.equal(config.admins.admin2.name, "admin-2")
  assert.equal(
    config.admins.admin1.authDirectory,
    path.resolve("C:/workspace", "./sessions/admin-1")
  )
  assert.equal(
    config.admins.admin2.authDirectory,
    path.resolve("C:/workspace", "./sessions/admin-2")
  )
})

test("config.admins bertambah otomatis kalau ADMIN_3_AUTH_DIR dst diisi eksplisit", () => {
  const config = loadConfig(
    {
      ADMIN_3_AUTH_DIR: "./sessions/admin-3",
      ADMIN_4_AUTH_DIR: "./sessions/admin-4"
    },
    { cwd: "C:/workspace" }
  )

  assert.deepEqual(Object.keys(config.admins), [
    "admin1",
    "admin2",
    "admin3",
    "admin4"
  ])
  assert.equal(config.admins.admin4.name, "admin-4")
})

test("penomoran admin berhenti begitu ketemu nomor yang kosong (tidak meloncat)", () => {
  const config = loadConfig(
    {
      ADMIN_3_AUTH_DIR: "./sessions/admin-3",
      // ADMIN_4_AUTH_DIR sengaja tidak diisi
      ADMIN_5_AUTH_DIR: "./sessions/admin-5"
    },
    { cwd: "C:/workspace" }
  )

  assert.deepEqual(Object.keys(config.admins), ["admin1", "admin2", "admin3"])
  assert.equal("admin5" in config.admins, false)
})

test("ADMIN_3_AUTH_DIR yang sengaja dikosongkan tetap melempar error, bukan diabaikan", () => {
  assert.throws(
    () => loadConfig({ ADMIN_3_AUTH_DIR: "" }),
    /ADMIN_3_AUTH_DIR tidak boleh kosong/
  )
})

test("SENIORITY_THRESHOLD default 20 dan bisa dikustomisasi", () => {
  assert.equal(loadConfig({}).seniority.thresholdMessages, 20)
  assert.equal(
    loadConfig({ SENIORITY_THRESHOLD: "5" }).seniority.thresholdMessages,
    5
  )
  assert.throws(
    () => loadConfig({ SENIORITY_THRESHOLD: "0" }),
    /antara 1 dan 10000/
  )
})

test("summarizeConfig menyertakan seniority tapi tidak pernah menyertakan admins", () => {
  const summary = summarizeConfig(loadConfig({}))

  assert.equal("seniority" in summary, true)
  assert.equal(summary.seniority.thresholdMessages, 20)
  assert.equal("admins" in summary, false)
})

test("seniority.stateFilePath default ke ./data/relationship-state.json dan bisa dikustomisasi", () => {
  const defaults = loadConfig({}, { cwd: "C:/workspace" })
  assert.equal(
    defaults.seniority.stateFilePath,
    path.resolve("C:/workspace", "./data/relationship-state.json")
  )

  const custom = loadConfig(
    { RELATIONSHIP_STATE_FILE: "./data/custom-state.json" },
    { cwd: "C:/workspace" }
  )
  assert.equal(
    custom.seniority.stateFilePath,
    path.resolve("C:/workspace", "./data/custom-state.json")
  )

  assert.throws(
    () => loadConfig({ RELATIONSHIP_STATE_FILE: "" }, { cwd: "C:/workspace" }),
    /RELATIONSHIP_STATE_FILE tidak boleh kosong/
  )
})
