import assert from "node:assert/strict"
import test from "node:test"

import {
  isWhatsAppUserJid,
  normalizePhoneNumber,
  toWhatsAppJid
} from "../src/utils/jid.js"

test("normalizePhoneNumber membersihkan pemisah umum", () => {
  assert.equal(normalizePhoneNumber("+62 812-3456-789"), "628123456789")
})

test("toWhatsAppJid menghasilkan user JID", () => {
  assert.equal(
    toWhatsAppJid("628123456789"),
    "628123456789@s.whatsapp.net"
  )
  assert.equal(isWhatsAppUserJid("628123456789@s.whatsapp.net"), true)
})

test("nomor lokal atau terlalu pendek ditolak", () => {
  assert.throws(() => normalizePhoneNumber("08123"), /format internasional/)
})
