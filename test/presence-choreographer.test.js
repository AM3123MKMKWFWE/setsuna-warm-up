import assert from "node:assert/strict"
import test from "node:test"

import { PresenceChoreographer } from "../src/utils/presence-choreographer.js"

test("PresenceChoreographer tidak melakukan apa pun ketika disabled", async () => {
  const calls = []
  const choreographer = new PresenceChoreographer({ enabled: false })
  const plan = choreographer.computeTypingPlan(20)

  assert.deepEqual(plan, [])

  await choreographer.executeTypingPlan(
    {
      sendPresenceUpdate(state, jid) {
        calls.push([state, jid])
      }
    },
    "628111111111@s.whatsapp.net",
    plan
  )

  assert.deepEqual(calls, [])
})

test("PresenceChoreographer mengirim composing lalu paused", async () => {
  const calls = []
  const waits = []
  const choreographer = new PresenceChoreographer({
    enabled: true,
    typingWpm: 60,
    typingMinMs: 500,
    typingMaxMs: 500,
    wait: async (durationMs) => waits.push(durationMs)
  })

  const plan = choreographer.computeTypingPlan(25)
  await choreographer.executeTypingPlan(
    {
      async sendPresenceUpdate(state, jid) {
        calls.push([state, jid])
      }
    },
    "628222222222@s.whatsapp.net",
    plan
  )

  assert.deepEqual(calls, [
    ["composing", "628222222222@s.whatsapp.net"],
    ["paused", "628222222222@s.whatsapp.net"]
  ])
  assert.deepEqual(waits, [500])
})
