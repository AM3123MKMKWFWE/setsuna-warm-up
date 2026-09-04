const WHATSAPP_USER_SUFFIX = "@s.whatsapp.net"

export function normalizePhoneNumber(value) {
  const normalized = String(value ?? "").replace(/[\s()+-]/g, "")

  if (!/^[1-9]\d{7,14}$/.test(normalized)) {
    throw new TypeError(
      "Nomor WhatsApp harus memakai format internasional 8-15 digit"
    )
  }

  return normalized
}

export function toWhatsAppJid(phoneNumber) {
  return `${normalizePhoneNumber(phoneNumber)}${WHATSAPP_USER_SUFFIX}`
}

export function isWhatsAppUserJid(value) {
  return /^[1-9]\d{7,14}@s\.whatsapp\.net$/.test(String(value ?? ""))
}
