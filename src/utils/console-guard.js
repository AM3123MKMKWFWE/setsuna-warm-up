const SENSITIVE_LIBSIGNAL_MESSAGES = new Set([
  "Closing session:",
  "Closing open session in favor of incoming prekey bundle"
])

export function installSensitiveConsoleGuard({ logger, target = console }) {
  const originalInfo = target.info

  const guardedConsoleInfo = function (...args) {
    if (SENSITIVE_LIBSIGNAL_MESSAGES.has(args[0])) {
      logger.warn("security.sensitive-console-output.suppressed", {
        source: "libsignal"
      })
      return
    }

    return originalInfo.apply(this, args)
  }
  target.info = guardedConsoleInfo

  return () => {
    if (target.info === guardedConsoleInfo) {
      target.info = originalInfo
    }
  }
}
