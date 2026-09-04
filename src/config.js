import path from "node:path"

const APP_MODES = new Set(["conversation", "inbound"])
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"])

export class ConfigurationError extends Error {
  constructor(message, field) {
    super(message)
    this.name = "ConfigurationError"
    this.field = field
  }
}

function parseEnum(value, { field, allowed, fallback }) {
  const normalized = String(value ?? fallback).trim().toLowerCase()

  if (!allowed.has(normalized)) {
    throw new ConfigurationError(
      `${field} harus salah satu dari: ${[...allowed].join(", ")}`,
      field
    )
  }

  return normalized
}

function parseInteger(value, { field, fallback, min, max }) {
  const rawValue = value === undefined || value === "" ? fallback : value
  const parsed = Number(rawValue)

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigurationError(
      `${field} harus berupa bilangan bulat antara ${min} dan ${max}`,
      field
    )
  }

  return parsed
}

function parseBoolean(value, { field, fallback }) {
  const normalized = String(value ?? fallback).trim().toLowerCase()

  if (normalized === "true") return true
  if (normalized === "false") return false

  throw new ConfigurationError(`${field} harus bernilai true atau false`, field)
}

function parseDirectory(value, fallback, field, cwd) {
  const directory = String(value ?? fallback).trim()

  if (directory === "") {
    throw new ConfigurationError(`${field} tidak boleh kosong`, field)
  }

  return path.resolve(cwd, directory)
}

function parseInviteUrl(value) {
  const normalized = String(value ?? "").trim()

  if (normalized === "") {
    return null
  }

  let url

  try {
    url = new URL(normalized)
  } catch {
    throw new ConfigurationError(
      "COMMUNITY_INVITE_URL harus berupa URL yang valid",
      "COMMUNITY_INVITE_URL"
    )
  }

  if (url.protocol !== "https:" || url.hostname !== "chat.whatsapp.com") {
    throw new ConfigurationError(
      "COMMUNITY_INVITE_URL harus menggunakan https://chat.whatsapp.com/",
      "COMMUNITY_INVITE_URL"
    )
  }

  return url.toString()
}

export function loadConfig(env = process.env, options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const mode = parseEnum(env.APP_MODE, {
    field: "APP_MODE",
    allowed: APP_MODES,
    fallback: "conversation"
  })
  const logLevel = parseEnum(env.LOG_LEVEL, {
    field: "LOG_LEVEL",
    allowed: LOG_LEVELS,
    fallback: "info"
  })
  const communityInviteUrl = parseInviteUrl(env.COMMUNITY_INVITE_URL)
  const inboundTrigger = String(env.INBOUND_TRIGGER ?? "").trim()

  if (mode === "inbound" && communityInviteUrl === null) {
    throw new ConfigurationError(
      "COMMUNITY_INVITE_URL wajib diisi ketika APP_MODE=inbound",
      "COMMUNITY_INVITE_URL"
    )
  }

  if (mode === "inbound" && inboundTrigger === "") {
    throw new ConfigurationError(
      "INBOUND_TRIGGER wajib diisi ketika APP_MODE=inbound",
      "INBOUND_TRIGGER"
    )
  }

  return Object.freeze({
    mode,
    logLevel,
    whatsappConnectionEnabled: parseBoolean(env.WA_CONNECT_ENABLED, {
      field: "WA_CONNECT_ENABLED",
      fallback: false
    }),
    showRawQr: parseBoolean(env.WA_QR_SHOW_RAW, {
      field: "WA_QR_SHOW_RAW",
      fallback: false
    }),
    presence: Object.freeze({
      enabled: parseBoolean(env.PRESENCE_ENABLED, {
        field: "PRESENCE_ENABLED",
        fallback: false
      }),
      typingWpm: parseInteger(env.PRESENCE_TYPING_WPM, {
        field: "PRESENCE_TYPING_WPM",
        fallback: 42,
        min: 10,
        max: 120
      }),
      typingMinMs: parseInteger(env.PRESENCE_TYPING_MIN_MS, {
        field: "PRESENCE_TYPING_MIN_MS",
        fallback: 700,
        min: 0,
        max: 10000
      }),
      typingMaxMs: parseInteger(env.PRESENCE_TYPING_MAX_MS, {
        field: "PRESENCE_TYPING_MAX_MS",
        fallback: 8000,
        min: 0,
        max: 30000
      })
    }),
    admins: Object.freeze({
      admin1: Object.freeze({
        name: "admin-1",
        authDirectory: parseDirectory(
          env.ADMIN_1_AUTH_DIR,
          "./sessions/admin-1",
          "ADMIN_1_AUTH_DIR",
          cwd
        )
      }),
      admin2: Object.freeze({
        name: "admin-2",
        authDirectory: parseDirectory(
          env.ADMIN_2_AUTH_DIR,
          "./sessions/admin-2",
          "ADMIN_2_AUTH_DIR",
          cwd
        )
      })
    }),
    inbound: Object.freeze({
      communityInviteUrl,
      trigger: inboundTrigger
    }),
    limits: Object.freeze({
      maxConversationSteps: parseInteger(env.MAX_CONVERSATION_STEPS, {
        field: "MAX_CONVERSATION_STEPS",
        fallback: 10,
        min: 1,
        max: 100
      }),
      messageDelayMs: parseInteger(env.MESSAGE_DELAY_MS, {
        field: "MESSAGE_DELAY_MS",
        fallback: 65000,
        min: 0,
        max: 300000
      }),
      queueMaxSize: parseInteger(env.QUEUE_MAX_SIZE, {
        field: "QUEUE_MAX_SIZE",
        fallback: 100,
        min: 1,
        max: 10000
      }),
      sendRetryLimit: parseInteger(env.SEND_RETRY_LIMIT, {
        field: "SEND_RETRY_LIMIT",
        fallback: 3,
        min: 0,
        max: 10
      }),
      reconnectLimit: parseInteger(env.RECONNECT_LIMIT, {
        field: "RECONNECT_LIMIT",
        fallback: 5,
        min: 0,
        max: 20
      }),
      reconnectBaseDelayMs: parseInteger(env.RECONNECT_BASE_DELAY_MS, {
        field: "RECONNECT_BASE_DELAY_MS",
        fallback: 2000,
        min: 100,
        max: 60000
      }),
      reconnectMaxDelayMs: parseInteger(env.RECONNECT_MAX_DELAY_MS, {
        field: "RECONNECT_MAX_DELAY_MS",
        fallback: 30000,
        min: 100,
        max: 300000
      }),
      sessionReadyTimeoutMs: parseInteger(env.SESSION_READY_TIMEOUT_MS, {
        field: "SESSION_READY_TIMEOUT_MS",
        fallback: 300000,
        min: 1000,
        max: 1800000
      }),
      manualTestStabilizationMs: parseInteger(
        env.MANUAL_TEST_STABILIZATION_MS,
        {
          field: "MANUAL_TEST_STABILIZATION_MS",
          fallback: 10000,
          min: 0,
          max: 120000
        }
      ),
      deliveryReceiptTimeoutMs: parseInteger(
        env.DELIVERY_RECEIPT_TIMEOUT_MS,
        {
          field: "DELIVERY_RECEIPT_TIMEOUT_MS",
          fallback: 30000,
          min: 1000,
          max: 120000
        }
      )
    })
  })
}

export function summarizeConfig(config) {
  return {
    mode: config.mode,
    logLevel: config.logLevel,
    whatsappConnectionEnabled: config.whatsappConnectionEnabled,
    showRawQr: config.showRawQr,
    presence: config.presence,
    inboundConfigured:
      config.inbound.communityInviteUrl !== null && config.inbound.trigger !== "",
    limits: config.limits
  }
}
