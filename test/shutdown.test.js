import assert from "node:assert/strict"
import test from "node:test"

import { createShutdownManager } from "../src/utils/shutdown.js"

test("shutdown idempotent dan menjalankan cleanup dalam urutan terbalik", async () => {
  const events = []
  const logger = {
    info: (event) => events.push(event),
    error: (event) => events.push(event)
  }
  const manager = createShutdownManager({ logger })

  manager.register(async () => events.push("cleanup-first-registered"))
  manager.register(async () => events.push("cleanup-last-registered"))

  const firstShutdown = manager.shutdown("test")
  const secondShutdown = manager.shutdown("ignored")

  assert.equal(firstShutdown, secondShutdown)
  await firstShutdown
  assert.equal(manager.signal.aborted, true)
  assert.deepEqual(events, [
    "app.shutdown.started",
    "cleanup-last-registered",
    "cleanup-first-registered",
    "app.shutdown.completed"
  ])
})
