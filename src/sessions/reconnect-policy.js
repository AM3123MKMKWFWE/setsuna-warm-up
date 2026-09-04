export function getDisconnectStatusCode(error) {
  const statusCode = error?.output?.statusCode ?? error?.statusCode
  return Number.isInteger(statusCode) ? statusCode : null
}

export function getDisconnectConflictType(error) {
  const content = error?.data?.content

  if (!Array.isArray(content)) {
    return null
  }

  const conflictNode = content.find((node) => node?.tag === "conflict")
  const type = conflictNode?.attrs?.type
  return typeof type === "string" ? type : null
}

export function getDisconnectReasonName(statusCode, disconnectReason) {
  return statusCode === null
    ? "unknown"
    : disconnectReason[statusCode] ?? `status-${statusCode}`
}

export function shouldReconnect(statusCode, disconnectReason) {
  const terminalReasons = new Set([
    disconnectReason.loggedOut,
    disconnectReason.badSession,
    disconnectReason.connectionReplaced,
    disconnectReason.multideviceMismatch,
    disconnectReason.forbidden
  ])

  return !terminalReasons.has(statusCode)
}

export function calculateReconnectDelay(
  attempt,
  { baseDelayMs, maxDelayMs }
) {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new TypeError("Reconnect attempt harus berupa bilangan bulat positif")
  }

  return Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)
}
