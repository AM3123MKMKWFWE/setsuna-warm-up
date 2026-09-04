import assert from "node:assert/strict"
import test from "node:test"

import { installSensitiveConsoleGuard } from "../src/utils/console-guard.js"

test("console guard membuang object SessionEntry yang sensitif", () => {
  const forwarded = []
  const warnings = []
  const target = {
    info: (...args) => forwarded.push(args)
  }
  const restore = installSensitiveConsoleGuard({
    logger: {
      warn: (event, metadata) => warnings.push({ event, metadata })
    },
    target
  })

  target.info("Closing session:", { privateKey: "must-not-appear" })
  target.info("safe message", { value: 1 })

  assert.deepEqual(forwarded, [["safe message", { value: 1 }]])
  assert.deepEqual(warnings, [
    {
      event: "security.sensitive-console-output.suppressed",
      metadata: { source: "libsignal" }
    }
  ])

  restore()
  target.info("after restore")
  assert.deepEqual(forwarded.at(-1), ["after restore"])
})
