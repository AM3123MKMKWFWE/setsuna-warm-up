import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import { DisconnectReason, WAMessageStatus } from "@whiskeysockets/baileys"

import { SESSION_STATE } from "../src/sessions/session-state.js"
import { WhatsAppSession } from "../src/sessions/whatsapp-session.js"

function createFakeLogger() {
  return {
    info() {},
    warn() {},
    error() {}
  }
}

function createHarness(options = {}) {
  const ev = new EventEmitter()
  const sentMessages = []
  let savedCredentials = 0
  let ended = 0
  const socket = {
    ev,
    user: { id: "628123456789:17@s.whatsapp.net" },
    async onWhatsApp(jid) {
      return [{ jid, exists: true }]
    },
    async sendMessage(jid, content) {
      sentMessages.push({ jid, content })
      return { key: { id: "message-1" } }
    },
    async end() {
      ended += 1
    }
  }
  const session = new WhatsAppSession({
    name: "admin-1",
    authDirectory: "C:/sessions/admin-1",
    logger: createFakeLogger(),
    reconnectLimit: options.reconnectLimit ?? 0,
    reconnectBaseDelayMs: 1,
    reconnectMaxDelayMs: 2,
    authStateLoader: async () => ({
      state: {},
      saveCreds: async () => {
        savedCredentials += 1
      }
    }),
    makeSocket: () => socket,
    qrRenderer: async () => {},
    disconnectReason: DisconnectReason,
    baileysLogger: {}
  })

  return {
    session,
    socket,
    sentMessages,
    get savedCredentials() {
      return savedCredentials
    },
    get ended() {
      return ended
    }
  }
}

test("session mencapai ready, menyimpan credential, dan mengirim teks", async () => {
  const harness = createHarness()

  await harness.session.start()
  assert.equal(harness.session.state, SESSION_STATE.CONNECTING)

  const ready = harness.session.waitUntilReady({ timeoutMs: 100 })
  harness.socket.ev.emit("creds.update", {})
  harness.socket.ev.emit("connection.update", { connection: "open" })

  await ready
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(harness.savedCredentials, 1)
  assert.equal(harness.session.state, SESSION_STATE.READY)
  assert.equal(harness.session.getOwnJid(), "628123456789@s.whatsapp.net")
  assert.equal(
    await harness.session.resolveTargetJid("628999999999"),
    "628999999999@s.whatsapp.net"
  )

  await harness.session.sendText("628123456789", "Halo")
  assert.deepEqual(harness.sentMessages, [
    {
      jid: "628123456789@s.whatsapp.net",
      content: { text: "Halo" }
    }
  ])

  await harness.session.stop("test")
  assert.equal(harness.session.state, SESSION_STATE.STOPPED)
  assert.equal(harness.session.userJid, null)
  assert.equal(harness.ended, 1)
})

test("session menolak target yang tidak dapat diverifikasi", async () => {
  const harness = createHarness()
  harness.socket.onWhatsApp = async () => []

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })

  await assert.rejects(
    harness.session.resolveTargetJid("628999999999"),
    /tidak terdaftar atau tidak dapat diverifikasi/
  )
  await harness.session.stop("test")
})

test("session menunggu konfirmasi delivery untuk messageId yang tepat", async () => {
  const harness = createHarness()

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })

  const result = await harness.session.sendText("628123456789", "Halo")
  const delivery = harness.session.waitForMessageStatus(result.key.id, {
    timeoutMs: 100
  })

  harness.socket.ev.emit("messages.update", [
    {
      key: { id: "pesan-lain" },
      update: { status: WAMessageStatus.DELIVERY_ACK }
    },
    {
      key: { id: result.key.id },
      update: { status: WAMessageStatus.DELIVERY_ACK }
    }
  ])

  assert.equal(await delivery, WAMessageStatus.DELIVERY_ACK)
  await harness.session.stop("test")
})

test("session melaporkan timeout jika delivery belum terkonfirmasi", async () => {
  const harness = createHarness()

  await harness.session.start()
  harness.socket.ev.emit("connection.update", { connection: "open" })

  await assert.rejects(
    harness.session.waitForMessageStatus("message-tidak-ada", {
      timeoutMs: 10
    }),
    /tidak diterima dalam 10ms/
  )
  await harness.session.stop("test")
})

test("logged out menghentikan reconnect otomatis", async () => {
  const harness = createHarness({ reconnectLimit: 5 })

  await harness.session.start()
  harness.socket.ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: {
      error: { output: { statusCode: DisconnectReason.loggedOut } }
    }
  })

  assert.equal(harness.session.state, SESSION_STATE.LOGGED_OUT)
  await assert.rejects(
    harness.session.waitUntilReady(),
    /state saat ini: logged-out/
  )
})

test("reconnect berhenti ketika batas percobaan nol", async () => {
  const harness = createHarness({ reconnectLimit: 0 })

  await harness.session.start()
  harness.socket.ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: {
      error: { output: { statusCode: DisconnectReason.connectionClosed } }
    }
  })

  assert.equal(harness.session.state, SESSION_STATE.STOPPED)
})
