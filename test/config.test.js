import assert from "node:assert/strict"
import test from "node:test"

import { ConfigurationError, loadConfig, summarizeConfig } from "../src/config.js"

test("loadConfig menggunakan nilai default Tahap 1 yang aman", () => {
  const config = loadConfig({}, { cwd: "C:/workspace" })

  assert.equal(config.mode, "conversation")
  assert.equal(config.logLevel, "info")
  assert.equal(config.whatsappConnectionEnabled, false)
  assert.equal(config.showRawQr, false)
  assert.equal(config.limits.maxConversationSteps, 10)
  assert.equal(config.limits.messageDelayMs, 65000)
  assert.equal(config.limits.deliveryReceiptTimeoutMs, 30000)
  assert.equal("adminNumbersConfigured" in summarizeConfig(config), false)
})

test("loadConfig menolak mode yang tidak didukung", () => {
  assert.throws(
    () => loadConfig({ APP_MODE: "broadcast" }),
    (error) =>
      error instanceof ConfigurationError && error.field === "APP_MODE"
  )
})

test("mode inbound mewajibkan trigger dan tautan resmi WhatsApp", () => {
  assert.throws(
    () => loadConfig({ APP_MODE: "inbound" }),
    /COMMUNITY_INVITE_URL wajib/
  )

  assert.throws(
    () =>
      loadConfig({
        APP_MODE: "inbound",
        COMMUNITY_INVITE_URL: "https://example.com/invite",
        INBOUND_TRIGGER: "JOIN"
      }),
    /chat\.whatsapp\.com/
  )

  const config = loadConfig({
    APP_MODE: "inbound",
    COMMUNITY_INVITE_URL: "https://chat.whatsapp.com/example-code",
    INBOUND_TRIGGER: "JOIN"
  })

  assert.equal(config.inbound.trigger, "JOIN")
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
