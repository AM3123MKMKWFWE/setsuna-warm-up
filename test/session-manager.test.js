import assert from "node:assert/strict"
import test from "node:test"

import { loadConfig } from "../src/config.js"
import { SessionManager } from "../src/sessions/session-manager.js"

function createLogger() {
  const logger = {
    child: () => logger,
    info() {},
    warn() {},
    error() {}
  }
  return logger
}

test("SessionManager membuat dan mengelola dua session terpisah", async () => {
  const created = []
  const config = loadConfig({}, { cwd: "C:/workspace" })
  const manager = new SessionManager({
    config,
    logger: createLogger(),
    sessionFactory(options) {
      const fake = {
        name: options.name,
        started: 0,
        stopped: 0,
        snapshot() {
          return { name: this.name, state: "ready" }
        },
        async start() {
          this.started += 1
        },
        async stop() {
          this.stopped += 1
        },
        async waitUntilReady() {
          return this.snapshot()
        },
        getOwnJid() {
          return this.name === "admin-1"
            ? "628111111111@s.whatsapp.net"
            : "628222222222@s.whatsapp.net"
        },
        async resolveTargetJid(target) {
          return target
        },
        async sendText(target, text) {
          return { target, text }
        },
        async waitForMessageStatus(messageId, options) {
          return { messageId, options }
        }
      }
      created.push(fake)
      return fake
    }
  })

  assert.deepEqual(
    created.map((session) => session.name),
    ["admin-1", "admin-2"]
  )

  await manager.startAll()
  await manager.waitUntilAllReady()
  assert.deepEqual(
    await manager.sendText("admin-1", "628123456789", "Halo"),
    { target: "628123456789", text: "Halo" }
  )
  assert.deepEqual(
    await manager.sendBetween("admin-1", "admin-2", "Tes"),
    { target: "628222222222@s.whatsapp.net", text: "Tes" }
  )
  assert.deepEqual(
    await manager.waitForMessageStatus("admin-1", "message-1", {
      timeoutMs: 500
    }),
    { messageId: "message-1", options: { timeoutMs: 500 } }
  )
  await manager.stopAll()

  assert.deepEqual(
    created.map((session) => [session.started, session.stopped]),
    [
      [1, 1],
      [1, 1]
    ]
  )
  assert.throws(() => manager.get("unknown"), /Session tidak dikenal/)
})

test("SessionManager menolak dua session dengan akun yang sama", () => {
  const config = loadConfig({}, { cwd: "C:/workspace" })
  const manager = new SessionManager({
    config,
    logger: createLogger(),
    sessionFactory({ name }) {
      return {
        name,
        snapshot: () => ({ name, state: "ready" }),
        getOwnJid: () => "628111111111@s.whatsapp.net"
      }
    }
  })

  assert.throws(() => manager.assertAllReady(), /akun WhatsApp yang sama/)
})
