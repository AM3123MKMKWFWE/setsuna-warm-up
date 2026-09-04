import assert from "node:assert/strict"
import test from "node:test"

import { OperationAbortedError, sleep } from "../src/utils/sleep.js"

test("sleep dapat dibatalkan", async () => {
  const controller = new AbortController()
  const result = sleep(1000, { signal: controller.signal })

  controller.abort()

  await assert.rejects(result, OperationAbortedError)
})

test("sleep menolak durasi negatif", async () => {
  await assert.rejects(sleep(-1), /non-negatif/)
})
