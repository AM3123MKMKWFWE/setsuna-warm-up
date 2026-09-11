import "dotenv/config"

import { loadConfig, summarizeConfig } from "./config.js"
import { installSensitiveConsoleGuard } from "./utils/console-guard.js"
import { createLogger } from "./utils/logger.js"
import { createShutdownManager } from "./utils/shutdown.js"

async function main() {
  const config = loadConfig()
  const logger = createLogger({
    level: config.logLevel,
    fileLogging: {
      enabled: config.logging.toFileEnabled,
      directory: config.logging.directory
    },
    onFileError: (error) => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          context: "app",
          event: "logger.file-write.failed",
          message: error.message
        })
      )
    }
  })
  const restoreConsole = installSensitiveConsoleGuard({ logger })
  const shutdownManager = createShutdownManager({ logger })
  const removeSignalHandlers = shutdownManager.installSignalHandlers()

  shutdownManager.register(async () => {
    removeSignalHandlers()
    restoreConsole()
  })

  if (!config.whatsappConnectionEnabled) {
    logger.info("app.sessions.disabled", {
      stage: 3,
      databaseEnabled: false,
      config: summarizeConfig(config),
      instruction: "Set WA_CONNECT_ENABLED=true untuk memulai pairing"
    })
    return
  }

  const { createSessionManager } = await import("./sessions/session-manager.js")
  const sessionManager = createSessionManager({ config, logger })

  shutdownManager.register(async () => {
    await sessionManager.stopAll("application-shutdown")
  })

  const startResults = await sessionManager.startAll()

  logger.info("app.sessions.started", {
    stage: 3,
    databaseEnabled: false,
    config: summarizeConfig(config),
    sessions: startResults
  })

  if (config.mode === "conversation") {
    const [
      { createConversationRunner },
      { createDynamicConversationScenario },
      { createFileBackedRecorder }
    ] = await Promise.all([
      import("./conversation/runner.js"),
      import("./conversation/scenarios.js"),
      import("./state/relationship-store.js")
    ])

    const activeAdmins = Object.values(config.admins).map((admin) => admin.name)
    const historyRecorder = createFileBackedRecorder(config.seniority.stateFilePath, {
      onError: (error) =>
        logger.warn("app.relationship-state.load-failed", {
          filePath: config.seniority.stateFilePath,
          error
        })
    })
    const relationshipState = historyRecorder.getState()

    logger.info("app.relationship-state.loaded", {
      filePath: config.seniority.stateFilePath,
      totalAdminsWithHistory: Object.keys(relationshipState.admins).length,
      totalPairsWithHistory: Object.keys(relationshipState.pairs).length
    })

    // Minimal 2 admin sudah cukup untuk mulai chat -- tidak perlu menunggu
    // admin ke-3/ke-4 aktif (lihat newFeture.md §1). Pasangan yang sudah
    // pernah chat diproses duluan, dan admin "lama" wajib menyapa admin
    // "baru" duluan untuk pasangan yang belum pernah chat sama sekali.
    const scenario = createDynamicConversationScenario({
      activeAdmins,
      relationshipState,
      thresholdMessages: config.seniority.thresholdMessages,
      messageDelayMs: config.limits.messageDelayMs,
      maxSteps: config.limits.maxConversationSteps
    })
    const runner = createConversationRunner({
      sessionManager,
      logger,
      historyRecorder
    })

    try {
      await runner.run(scenario, {
        maxSteps: config.limits.maxConversationSteps,
        deliveryReceiptTimeoutMs: config.limits.deliveryReceiptTimeoutMs,
        participants: activeAdmins,
        signal: shutdownManager.signal
      })
      await shutdownManager.shutdown("conversation-completed")
    } catch (error) {
      if (!shutdownManager.signal.aborted) {
        logger.error("app.conversation.failed", { error })
        process.exitCode = 1
        await shutdownManager.shutdown("conversation-failed")
      }
    }
    return
  }

  void sessionManager
    .waitUntilAllReady({ signal: shutdownManager.signal })
    .then(() => logger.info("app.sessions.all-ready"))
    .catch((error) => {
      if (!shutdownManager.signal.aborted) {
        logger.warn("app.sessions.readiness-ended", { error })
      }
    })
}

main().catch((error) => {
  const logger = createLogger({ level: "error" })
  logger.error("app.startup.failed", { error })
  process.exitCode = 1
})
