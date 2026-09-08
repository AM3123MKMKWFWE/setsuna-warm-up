import assert from "node:assert/strict"
import path from "node:path"
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

test("file logging nonaktif secara default: appendLine tidak pernah dipanggil", () => {
  const appendCalls = []
  const sink = { log() {}, info() {}, warn() {}, error() {} }
  const logger = createLogger({
    level: "info",
    sink,
    appendLine: (filePath, line) => appendCalls.push({ filePath, line })
  })

  logger.info("some-event")

  assert.equal(appendCalls.length, 0)
})

test("file logging aktif menulis satu baris JSON per hari ke direktori terkonfigurasi", () => {
  const appendCalls = []
  const sink = { log() {}, info() {}, warn() {}, error() {} }
  const logger = createLogger({
    level: "info",
    sink,
    fileLogging: { enabled: true, directory: "/var/logs/setsuna" },
    now: () => new Date("2026-09-05T10:00:00.000Z"),
    appendLine: (filePath, line) => appendCalls.push({ filePath, line })
  })

  logger.info("session.socket.created", { phoneNumber: "628123456789" })

  assert.equal(appendCalls.length, 1)
  assert.equal(
    appendCalls[0].filePath,
    path.join("/var/logs/setsuna", "app-2026-09-05.log")
  )
  const parsed = JSON.parse(appendCalls[0].line)
  assert.equal(parsed.event, "session.socket.created")
  assert.equal(parsed.phoneNumber, "628*******89")
})

test("file logging menghormati level minimum yang sama dengan console", () => {
  const appendCalls = []
  const logger = createLogger({
    level: "warn",
    sink: { log() {}, info() {}, warn() {}, error() {} },
    fileLogging: { enabled: true, directory: "/var/logs/setsuna" },
    now: () => new Date("2026-09-05T10:00:00.000Z"),
    appendLine: (filePath, line) => appendCalls.push({ filePath, line })
  })

  logger.info("ignored")
  logger.error("included")

  assert.equal(appendCalls.length, 1)
  assert.equal(JSON.parse(appendCalls[0].line).event, "included")
})

test("kegagalan menulis file tidak melempar error dan memanggil onFileError", () => {
  const fileErrors = []
  const logger = createLogger({
    level: "info",
    sink: { log() {}, info() {}, warn() {}, error() {} },
    fileLogging: { enabled: true, directory: "/var/logs/setsuna" },
    now: () => new Date("2026-09-05T10:00:00.000Z"),
    appendLine: () => {
      throw new Error("disk penuh")
    },
    onFileError: (error) => fileErrors.push(error.message)
  })

  assert.doesNotThrow(() => logger.info("some-event"))
  assert.deepEqual(fileErrors, ["disk penuh"])
})

test("child logger mewarisi konfigurasi file logging dari parent", () => {
  const appendCalls = []
  const logger = createLogger({
    level: "info",
    sink: { log() {}, info() {}, warn() {}, error() {} },
    fileLogging: { enabled: true, directory: "/var/logs/setsuna" },
    now: () => new Date("2026-09-05T10:00:00.000Z"),
    appendLine: (filePath, line) => appendCalls.push({ filePath, line })
  })
  const child = logger.child("admin-1")

  child.info("session.socket.created")

  assert.equal(appendCalls.length, 1)
  assert.equal(JSON.parse(appendCalls[0].line).context, "app:admin-1")
})

test("fileLogging.enabled true tanpa directory melempar error konfigurasi", () => {
  assert.throws(
    () => createLogger({ fileLogging: { enabled: true } }),
    /fileLogging.directory wajib diisi/
  )
})
