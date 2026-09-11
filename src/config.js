import path from "node:path"

const APP_MODES = new Set(["conversation"])
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

function parseProbability(value, { field, fallback }) {
  const rawValue = value === undefined || value === "" ? fallback : value
  const parsed = Number(rawValue)

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new ConfigurationError(
      `${field} harus berupa angka antara 0 dan 1`,
      field
    )
  }

  return parsed
}

function parseDirectory(value, fallback, field, cwd) {
  const directory = String(value ?? fallback).trim()

  if (directory === "") {
    throw new ConfigurationError(`${field} tidak boleh kosong`, field)
  }

  return path.resolve(cwd, directory)
}

/**
 * admin-1 dan admin-2 SELALU ada, dengan direktori default kalau
 * `ADMIN_1_AUTH_DIR`/`ADMIN_2_AUTH_DIR` tidak diisi -- ini menjaga perilaku
 * lama (kompatibel dengan `.env` yang belum menyebutkan admin sama sekali)
 * dan sekaligus memastikan sistem selalu punya minimal 2 admin untuk
 * dijalankan tanpa konfigurasi tambahan apa pun.
 *
 * admin-3 dan seterusnya bersifat opsional: hanya ditambahkan kalau
 * `ADMIN_{n}_AUTH_DIR` memang diisi eksplisit di `.env`. Penomoran berhenti
 * begitu ketemu nomor pertama yang variabelnya tidak ada -- jadi
 * `ADMIN_3_AUTH_DIR` tanpa `ADMIN_4_AUTH_DIR` hanya menghasilkan 3 admin,
 * bukan meloncat ke `ADMIN_5_AUTH_DIR` kalau itu ada.
 */
function loadAdmins(env, cwd) {
  const admins = {}

  for (const index of [1, 2]) {
    admins[`admin${index}`] = Object.freeze({
      name: `admin-${index}`,
      authDirectory: parseDirectory(
        env[`ADMIN_${index}_AUTH_DIR`],
        `./sessions/admin-${index}`,
        `ADMIN_${index}_AUTH_DIR`,
        cwd
      )
    })
  }

  let index = 3
  while (env[`ADMIN_${index}_AUTH_DIR`] !== undefined) {
    admins[`admin${index}`] = Object.freeze({
      name: `admin-${index}`,
      authDirectory: parseDirectory(
        env[`ADMIN_${index}_AUTH_DIR`],
        `./sessions/admin-${index}`,
        `ADMIN_${index}_AUTH_DIR`,
        cwd
      )
    })
    index += 1
  }

  // Defensif: secara desain admin-1/admin-2 di atas selalu mengisi minimal
  // dua entri, jadi baris ini seharusnya tidak pernah terpicu -- disimpan
  // sebagai jaring pengaman kalau logikanya berubah di masa depan.
  if (Object.keys(admins).length < 2) {
    throw new ConfigurationError(
      "Minimal 2 admin harus dikonfigurasi (ADMIN_1_AUTH_DIR dan ADMIN_2_AUTH_DIR)",
      "ADMIN_AUTH_DIR"
    )
  }

  return Object.freeze(admins)
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
  return Object.freeze({
    mode,
    logLevel,
    logging: Object.freeze({
      toFileEnabled: parseBoolean(env.LOG_TO_FILE_ENABLED, {
        field: "LOG_TO_FILE_ENABLED",
        fallback: true
      }),
      directory: parseDirectory(
        env.LOG_DIRECTORY,
        "./logs",
        "LOG_DIRECTORY",
        cwd
      )
    }),
    whatsappConnectionEnabled: parseBoolean(env.WA_CONNECT_ENABLED, {
      field: "WA_CONNECT_ENABLED",
      fallback: false
    }),
    showRawQr: parseBoolean(env.WA_QR_SHOW_RAW, {
      field: "WA_QR_SHOW_RAW",
      fallback: false
    }),
    sessionHealth: Object.freeze({
      enabled: parseBoolean(env.SESSION_HEALTH_ENABLED, {
        field: "SESSION_HEALTH_ENABLED",
        fallback: true
      }),
      badMacThreshold: parseInteger(env.SESSION_BAD_MAC_THRESHOLD, {
        field: "SESSION_BAD_MAC_THRESHOLD",
        fallback: 3,
        min: 1,
        max: 100
      }),
      badMacWindowMs: parseInteger(env.SESSION_BAD_MAC_WINDOW_MS, {
        field: "SESSION_BAD_MAC_WINDOW_MS",
        fallback: 60000,
        min: 1000,
        max: 3600000
      })
    }),
    presence: Object.freeze({
      enabled: parseBoolean(env.PRESENCE_ENABLED, {
        field: "PRESENCE_ENABLED",
        fallback: false
      }),
      typingWPM: parseInteger(env.PRESENCE_TYPING_WPM, {
        field: "PRESENCE_TYPING_WPM",
        fallback: 45,
        min: 10,
        max: 120
      }),
      typingMinMs: parseInteger(env.PRESENCE_TYPING_MIN_MS, {
        field: "PRESENCE_TYPING_MIN_MS",
        fallback: 600,
        min: 0,
        max: 10000
      }),
      typingMaxMs: parseInteger(env.PRESENCE_TYPING_MAX_MS, {
        field: "PRESENCE_TYPING_MAX_MS",
        fallback: 8000,
        min: 600,
        max: 30000
      })
    }),
    humanEntropy: Object.freeze({
      enabled: parseBoolean(env.HUMAN_ENTROPY_ENABLED, {
        field: "HUMAN_ENTROPY_ENABLED",
        fallback: false
      }),
      minIntervalMs: parseInteger(env.HUMAN_ENTROPY_MIN_INTERVAL_MS, {
        field: "HUMAN_ENTROPY_MIN_INTERVAL_MS",
        fallback: 300000,
        min: 1000,
        max: 86400000
      }),
      maxIntervalMs: parseInteger(env.HUMAN_ENTROPY_MAX_INTERVAL_MS, {
        field: "HUMAN_ENTROPY_MAX_INTERVAL_MS",
        fallback: 900000,
        min: 1000,
        max: 86400000
      })
    }),
    deviceFingerprint: Object.freeze({
      enabled: parseBoolean(env.DEVICE_FINGERPRINT_ENABLED, {
        field: "DEVICE_FINGERPRINT_ENABLED",
        fallback: false
      })
    }),
    stealthConnect: Object.freeze({
      enabled: parseBoolean(env.STEALTH_CONNECT_ENABLED, {
        field: "STEALTH_CONNECT_ENABLED",
        fallback: false
      }),
      presenceRampMinMs: parseInteger(env.STEALTH_PRESENCE_RAMP_MIN_MS, {
        field: "STEALTH_PRESENCE_RAMP_MIN_MS",
        fallback: 30000,
        min: 0,
        max: 300000
      }),
      presenceRampMaxMs: parseInteger(env.STEALTH_PRESENCE_RAMP_MAX_MS, {
        field: "STEALTH_PRESENCE_RAMP_MAX_MS",
        fallback: 90000,
        min: 0,
        max: 600000
      })
    }),
    readReceiptVariance: Object.freeze({
      enabled: parseBoolean(env.READ_RECEIPT_VARIANCE_ENABLED, {
        field: "READ_RECEIPT_VARIANCE_ENABLED",
        fallback: false
      }),
      meanMs: parseInteger(env.READ_RECEIPT_VARIANCE_MEAN_MS, {
        field: "READ_RECEIPT_VARIANCE_MEAN_MS",
        fallback: 1500,
        min: 0,
        max: 60000
      }),
      stdDevMs: parseInteger(env.READ_RECEIPT_VARIANCE_STDDEV_MS, {
        field: "READ_RECEIPT_VARIANCE_STDDEV_MS",
        fallback: 800,
        min: 0,
        max: 30000
      })
    }),
    legitimacySignals: Object.freeze({
      enabled: parseBoolean(env.LEGITIMACY_SIGNALS_ENABLED, {
        field: "LEGITIMACY_SIGNALS_ENABLED",
        fallback: false
      }),
      typoProbability: parseProbability(env.LEGITIMACY_SIGNALS_TYPO_PROBABILITY, {
        field: "LEGITIMACY_SIGNALS_TYPO_PROBABILITY",
        fallback: 0.025
      })
    }),
    sessionFingerprint: Object.freeze({
      enabled: parseBoolean(env.SESSION_FINGERPRINT_ENABLED, {
        field: "SESSION_FINGERPRINT_ENABLED",
        fallback: false
      })
    }),
    admins: loadAdmins(env, cwd),
    seniority: Object.freeze({
      thresholdMessages: parseInteger(env.SENIORITY_THRESHOLD, {
        field: "SENIORITY_THRESHOLD",
        fallback: 20,
        min: 1,
        max: 10000
      }),
      stateFilePath: parseDirectory(
        env.RELATIONSHIP_STATE_FILE,
        "./data/relationship-state.json",
        "RELATIONSHIP_STATE_FILE",
        cwd
      )
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
    logging: config.logging,
    whatsappConnectionEnabled: config.whatsappConnectionEnabled,
    showRawQr: config.showRawQr,
    sessionHealth: config.sessionHealth,
    humanEntropy: config.humanEntropy,
    presence: config.presence,
    deviceFingerprint: config.deviceFingerprint,
    stealthConnect: config.stealthConnect,
    readReceiptVariance: config.readReceiptVariance,
    legitimacySignals: config.legitimacySignals,
    sessionFingerprint: config.sessionFingerprint,
    seniority: config.seniority,
    limits: config.limits
  }
}
