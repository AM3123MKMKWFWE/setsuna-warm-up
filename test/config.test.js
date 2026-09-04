import assert from "node:assert/strict"
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
