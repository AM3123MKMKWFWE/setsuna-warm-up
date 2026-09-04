import assert from "node:assert/strict"
import test from "node:test"

import {
  createLogger,
  maskPhoneNumber,
  sanitizeLogMetadata
} from "../src/utils/logger.js"

test("maskPhoneNumber menyamarkan bagian tengah nomor", () => {
  assert.equal(maskPhoneNumber("628123456789"), "628*******89")
})

test("sanitizeLogMetadata meredaksi rahasia dan JID", () => {
  const sanitized = sanitizeLogMetadata({
    pairingCode: "12345678",
    remoteJid: "628123456789@s.whatsapp.net",
    nested: { password: "secret" }
  })

  assert.equal(sanitized.pairingCode, "[redacted]")
  assert.equal(sanitized.remoteJid, "628*******89@s.whatsapp.net")
  assert.equal(sanitized.nested.password, "[redacted]")
})

test("logger menghormati level minimum", () => {
  const output = []
  const sink = {
    log: (value) => output.push(value),
    info: (value) => output.push(value),
    warn: (value) => output.push(value),
    error: (value) => output.push(value)
  }
  const logger = createLogger({ level: "warn", sink })

  logger.info("ignored")
  logger.warn("included", { phoneNumber: "628123456789" })

  assert.equal(output.length, 1)
  assert.equal(JSON.parse(output[0]).phoneNumber, "628*******89")
})
