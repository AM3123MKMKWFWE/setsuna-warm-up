import "dotenv/config"

import { loadConfig, summarizeConfig } from "./config.js"
import { installSensitiveConsoleGuard } from "./utils/console-guard.js"
import { createLogger } from "./utils/logger.js"
import { createShutdownManager } from "./utils/shutdown.js"

async function main() {
  const config = loadConfig()
  const logger = createLogger({ level: config.logLevel })
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
    const [{ createConversationRunner }, { createDefaultConversationScenario }] =
      await Promise.all([
        import("./conversation/runner.js"),
        import("./conversation/scenarios.js")
      ])
    const runner = createConversationRunner({ sessionManager, logger })
    const scenario = createDefaultConversationScenario(
      config.limits.messageDelayMs
    )

    try {
      await runner.run(scenario, {
        maxSteps: config.limits.maxConversationSteps,
        deliveryReceiptTimeoutMs: config.limits.deliveryReceiptTimeoutMs,
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
