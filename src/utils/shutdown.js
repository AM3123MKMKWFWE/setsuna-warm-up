export function createShutdownManager({ logger }) {
  const controller = new AbortController()
  const handlers = []
  let shutdownPromise = null

  function register(handler) {
    if (typeof handler !== "function") {
      throw new TypeError("Shutdown handler harus berupa function")
    }

    handlers.push(handler)

    return () => {
      const index = handlers.indexOf(handler)
      if (index >= 0) {
        handlers.splice(index, 1)
      }
    }
  }

  function shutdown(reason = "manual") {
    if (shutdownPromise !== null) {
      return shutdownPromise
    }

    shutdownPromise = (async () => {
      logger.info("app.shutdown.started", { reason })
      controller.abort()

      const results = await Promise.allSettled(
        [...handlers].reverse().map((handler) => handler(reason))
      )
      const failures = results.filter((result) => result.status === "rejected")

      if (failures.length > 0) {
        logger.error("app.shutdown.failed", {
          failureCount: failures.length,
          errors: failures.map((result) => result.reason)
        })
        process.exitCode = 1
      } else {
        logger.info("app.shutdown.completed")
      }
    })()

    return shutdownPromise
  }

  function installSignalHandlers() {
    const onSigint = () => void shutdown("SIGINT")
    const onSigterm = () => void shutdown("SIGTERM")

    process.once("SIGINT", onSigint)
    process.once("SIGTERM", onSigterm)

    return () => {
      process.removeListener("SIGINT", onSigint)
      process.removeListener("SIGTERM", onSigterm)
    }
  }

  return Object.freeze({
    signal: controller.signal,
    register,
    shutdown,
    installSignalHandlers
  })
}
