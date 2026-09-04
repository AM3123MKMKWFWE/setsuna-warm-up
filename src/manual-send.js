import "dotenv/config"

import { randomUUID } from "node:crypto"

import { loadConfig } from "./config.js"
import { createSessionManager } from "./sessions/session-manager.js"
import { createLogger } from "./utils/logger.js"
import { installSensitiveConsoleGuard } from "./utils/console-guard.js"
import { sleep } from "./utils/sleep.js"

async function sendAndConfirm(manager, config, logger, options) {
  const result = await manager.sendBetween(
    options.sender,
    options.recipient,
    options.text
  )
  const messageId = result?.key?.id

  if (!messageId) {
    throw new Error(`Baileys tidak mengembalikan messageId untuk ${options.sender}`)
  }

  try {
    const status = await manager.waitForMessageStatus(
      options.sender,
      messageId,
      { timeoutMs: config.limits.deliveryReceiptTimeoutMs }
    )
    logger.info("manual-send-test.delivery-confirmed", {
      runId: options.runId,
      sender: options.sender,
      recipient: options.recipient,
      messageId,
      status
    })
    return { messageId, delivered: true, status }
  } catch (error) {
    logger.warn("manual-send-test.delivery-unconfirmed", {
      runId: options.runId,
      sender: options.sender,
      recipient: options.recipient,
      messageId,
      error
    })
    return { messageId, delivered: false, status: null }
  }
}

async function main() {
  const config = loadConfig()
  const logger = createLogger({ level: config.logLevel })
  const restoreConsole = installSensitiveConsoleGuard({ logger })
  const manager = createSessionManager({ config, logger })
  const runId = randomUUID().slice(0, 8).toUpperCase()

  try {
    logger.info("manual-send-test.started", { runId })
    await manager.startAll()
    await manager.waitUntilAllReady({
      timeoutMs: config.limits.sessionReadyTimeoutMs
    })
    logger.info("manual-send-test.stabilizing", {
      runId,
      delayMs: config.limits.manualTestStabilizationMs
    })
    await sleep(config.limits.manualTestStabilizationMs)
    manager.assertAllReady()

    const admin1Result = await sendAndConfirm(manager, config, logger, {
      runId,
      sender: "admin-1",
      recipient: "admin-2",
      text: `Tes koneksi dari Admin 1 [${runId}]`
    })
    const delayStartedAt = new Date()
    logger.info("manual-send-test.inter-message-delay.started", {
      runId,
      from: "admin-1",
      to: "admin-2",
      delayMs: config.limits.messageDelayMs,
      startedAt: delayStartedAt.toISOString()
    })
    await sleep(config.limits.messageDelayMs)
    logger.info("manual-send-test.inter-message-delay.completed", {
      runId,
      delayMs: config.limits.messageDelayMs,
      startedAt: delayStartedAt.toISOString(),
      completedAt: new Date().toISOString()
    })
    const admin2Result = await sendAndConfirm(manager, config, logger, {
      runId,
      sender: "admin-2",
      recipient: "admin-1",
      text: `Tes koneksi dari Admin 2 [${runId}]`
    })

    const deliveries = {
      "admin-1-to-admin-2": admin1Result.delivered,
      "admin-2-to-admin-1": admin2Result.delivered
    }
    logger.info("manual-send-test.results", {
      runId,
      deliveries
    })

    if (Object.values(deliveries).some((delivered) => !delivered)) {
      throw new Error(
        "Uji dua arah gagal: semua pesan wajib mendapat DELIVERY_ACK"
      )
    }

    logger.info("manual-send-test.completed", { runId, deliveries })
  } finally {
    await manager.stopAll("manual-test-completed")
    restoreConsole()
  }
}

main().catch((error) => {
  const logger = createLogger({ level: "error" })
  logger.error("manual-send-test.failed", { error })
  process.exitCode = 1
})
