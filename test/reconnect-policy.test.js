import assert from "node:assert/strict"
import test from "node:test"

import { DisconnectReason } from "@whiskeysockets/baileys"

import {
  calculateReconnectDelay,
  getDisconnectConflictType,
  getDisconnectReasonName,
  getDisconnectStatusCode,
  shouldReconnect
} from "../src/sessions/reconnect-policy.js"

test("status disconnect dibaca dari Boom-like error", () => {
  const error = { output: { statusCode: DisconnectReason.loggedOut } }

  assert.equal(getDisconnectStatusCode(error), DisconnectReason.loggedOut)
  assert.equal(
    getDisconnectReasonName(DisconnectReason.loggedOut, DisconnectReason),
    "loggedOut"
  )
})

test("tipe conflict device_removed diekstrak tanpa mencatat payload", () => {
  const error = {
    data: {
      content: [
        { tag: "conflict", attrs: { type: "device_removed" } }
      ]
    }
  }

  assert.equal(getDisconnectConflictType(error), "device_removed")
  assert.equal(getDisconnectConflictType({}), null)
})

test("alasan terminal tidak melakukan reconnect", () => {
  const terminalReasons = [
    DisconnectReason.loggedOut,
    DisconnectReason.badSession,
    DisconnectReason.connectionReplaced,
    DisconnectReason.multideviceMismatch,
    DisconnectReason.forbidden
  ]

  for (const reason of terminalReasons) {
    assert.equal(shouldReconnect(reason, DisconnectReason), false)
  }

  assert.equal(
    shouldReconnect(DisconnectReason.connectionClosed, DisconnectReason),
    true
  )
  assert.equal(shouldReconnect(null, DisconnectReason), true)
})

test("backoff reconnect dibatasi maksimum", () => {
  const options = { baseDelayMs: 1000, maxDelayMs: 5000 }

  assert.equal(calculateReconnectDelay(1, options), 1000)
  assert.equal(calculateReconnectDelay(3, options), 4000)
  assert.equal(calculateReconnectDelay(4, options), 5000)
})
