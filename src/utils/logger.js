const LOG_LEVEL_PRIORITY = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
})

const SENSITIVE_KEY_PATTERN =
  /(auth|credential|password|secret|token|pairing|qr|invite.*url)/i

export function maskPhoneNumber(value) {
  const normalized = String(value ?? "")

  if (!/^\d{8,15}$/.test(normalized)) {
    return "[redacted]"
  }

  return `${normalized.slice(0, 3)}${"*".repeat(normalized.length - 5)}${normalized.slice(-2)}`
}

function sanitizeValue(value, key = "") {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]"
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item))
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, childKey)
      ])
    )
  }

  if (/(phone|number)/i.test(key) && typeof value === "string") {
    return maskPhoneNumber(value)
  }

  if (/jid/i.test(key) && typeof value === "string") {
    const [phone, suffix] = value.split("@")
    return suffix ? `${maskPhoneNumber(phone)}@${suffix}` : "[redacted]"
  }

  return value
}

export function sanitizeLogMetadata(metadata = {}) {
  return sanitizeValue(metadata)
}

export function createLogger(options = {}) {
  const level = options.level ?? "info"
  const context = options.context ?? "app"
  const sink = options.sink ?? console

  if (!(level in LOG_LEVEL_PRIORITY)) {
    throw new TypeError(`Level log tidak didukung: ${level}`)
  }

  function write(messageLevel, event, metadata) {
    if (LOG_LEVEL_PRIORITY[messageLevel] < LOG_LEVEL_PRIORITY[level]) {
      return
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level: messageLevel,
      context,
      event,
      ...sanitizeLogMetadata(metadata)
    }
    const method = messageLevel === "debug" ? "log" : messageLevel
    const output = JSON.stringify(entry)

    if (typeof sink[method] === "function") {
      sink[method](output)
    } else {
      sink.log(output)
    }
  }

  return Object.freeze({
    debug: (event, metadata = {}) => write("debug", event, metadata),
    info: (event, metadata = {}) => write("info", event, metadata),
    warn: (event, metadata = {}) => write("warn", event, metadata),
    error: (event, metadata = {}) => write("error", event, metadata),
    child(childContext) {
      return createLogger({
        level,
        context: `${context}:${childContext}`,
        sink
      })
    }
  })
}
