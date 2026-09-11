import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  createEmptyState,
  createFileBackedRecorder,
  getPairKey,
  hasChattedBefore,
  isOldAdmin,
  loadState,
  recordMessage,
  saveState
} from "../src/state/relationship-store.js"

function tempFilePath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relationship-store-test-"))
  return path.join(dir, name)
}

test("getPairKey menormalisasi urutan nama admin", () => {
  assert.equal(getPairKey("admin-1", "admin-2"), "admin-1|admin-2")
  assert.equal(getPairKey("admin-2", "admin-1"), "admin-1|admin-2")
  assert.equal(getPairKey("admin-3", "admin-1"), "admin-1|admin-3")
})

test("loadState mengembalikan state kosong kalau file belum ada", () => {
  const filePath = tempFilePath("does-not-exist.json")

  assert.deepEqual(loadState(filePath), createEmptyState())
})

test("loadState mengembalikan state kosong (bukan melempar error) kalau file corrupt", () => {
  const filePath = tempFilePath("corrupt.json")
  fs.writeFileSync(filePath, "{ ini bukan json valid ][", "utf8")
  const errors = []

  const state = loadState(filePath, { onError: (error) => errors.push(error) })

  assert.deepEqual(state, createEmptyState())
  assert.equal(errors.length, 1)
})

test("loadState mengembalikan state kosong kalau isi file bukan object yang valid", () => {
  const filePath = tempFilePath("wrong-shape.json")
  fs.writeFileSync(filePath, JSON.stringify([1, 2, 3]), "utf8")

  assert.deepEqual(loadState(filePath), createEmptyState())
})

test("recordMessage pertama kali antara dua admin mengisi firstContactBy dan messageCount=1", () => {
  const state = recordMessage(createEmptyState(), "admin-1", "admin-3", "2026-09-09T08:00:00.000Z")

  assert.equal(state.admins["admin-1"].totalMessagesSent, 1)
  assert.deepEqual(state.pairs["admin-1|admin-3"], {
    messageCount: 1,
    firstContactBy: "admin-1",
    firstContactAt: "2026-09-09T08:00:00.000Z"
  })
})

test("recordMessage berikutnya pada pasangan yang sama menambah messageCount tanpa mengubah firstContactBy", () => {
  let state = recordMessage(createEmptyState(), "admin-1", "admin-3", "2026-09-09T08:00:00.000Z")
  state = recordMessage(state, "admin-3", "admin-1", "2026-09-09T08:01:00.000Z")
  state = recordMessage(state, "admin-1", "admin-3", "2026-09-09T08:02:00.000Z")

  assert.equal(state.admins["admin-1"].totalMessagesSent, 2)
  assert.equal(state.admins["admin-3"].totalMessagesSent, 1)
  assert.deepEqual(state.pairs["admin-1|admin-3"], {
    messageCount: 3,
    firstContactBy: "admin-1",
    firstContactAt: "2026-09-09T08:00:00.000Z"
  })
})

test("recordMessage tidak mengubah state lama (immutable)", () => {
  const original = createEmptyState()
  const next = recordMessage(original, "admin-1", "admin-2")

  assert.deepEqual(original, createEmptyState())
  assert.notEqual(next, original)
})

test("isOldAdmin membandingkan totalMessagesSent terhadap ambang batas", () => {
  const state = recordMessage(createEmptyState(), "admin-1", "admin-2")

  assert.equal(isOldAdmin(state, "admin-1", 1), true)
  assert.equal(isOldAdmin(state, "admin-1", 2), false)
  assert.equal(isOldAdmin(state, "admin-tidak-dikenal", 1), false)
})

test("hasChattedBefore true hanya untuk pasangan yang sudah tercatat", () => {
  const state = recordMessage(createEmptyState(), "admin-1", "admin-2")

  assert.equal(hasChattedBefore(state, "admin-1", "admin-2"), true)
  assert.equal(hasChattedBefore(state, "admin-2", "admin-1"), true)
  assert.equal(hasChattedBefore(state, "admin-1", "admin-3"), false)
})

test("saveState lalu loadState roundtrip menghasilkan data yang identik", () => {
  const filePath = tempFilePath("state.json")
  let state = recordMessage(createEmptyState(), "admin-1", "admin-2", "2026-09-01T10:00:00.000Z")
  state = recordMessage(state, "admin-1", "admin-3", "2026-09-09T08:00:00.000Z")

  saveState(filePath, state)
  const reloaded = loadState(filePath)

  assert.deepEqual(reloaded, state)
})

test("saveState menulis file secara atomic (tidak meninggalkan file sementara)", () => {
  const filePath = tempFilePath("state.json")

  saveState(filePath, recordMessage(createEmptyState(), "admin-1", "admin-2"))

  const dir = path.dirname(filePath)
  const leftoverTmpFiles = fs
    .readdirSync(dir)
    .filter((name) => name.includes(".tmp-"))

  assert.deepEqual(leftoverTmpFiles, [])
  assert.equal(fs.existsSync(filePath), true)
})

test("createFileBackedRecorder: record() memperbarui state di memori dan menuliskannya ke disk", () => {
  const filePath = tempFilePath("recorder.json")
  const recorder = createFileBackedRecorder(filePath)

  const returned = recorder.record("admin-1", "admin-2", "2026-09-09T08:00:00.000Z")

  assert.equal(recorder.getState().admins["admin-1"].totalMessagesSent, 1)
  assert.equal(returned, recorder.getState())
  assert.deepEqual(loadState(filePath), recorder.getState())
})

test("createFileBackedRecorder: record() berikutnya melanjutkan dari state sebelumnya (bukan mulai dari nol)", () => {
  const filePath = tempFilePath("recorder.json")
  const first = createFileBackedRecorder(filePath)
  first.record("admin-1", "admin-2")

  const second = createFileBackedRecorder(filePath)
  second.record("admin-1", "admin-3")

  assert.equal(second.getState().admins["admin-1"].totalMessagesSent, 2)
  assert.equal(hasChattedBefore(second.getState(), "admin-1", "admin-2"), true)
  assert.equal(hasChattedBefore(second.getState(), "admin-1", "admin-3"), true)
})

test("createFileBackedRecorder: record() melempar error kalau gagal tulis ke disk, tapi state di memori tetap terupdate", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relationship-store-test-"))
  const blockerPath = path.join(dir, "blocker")
  fs.writeFileSync(blockerPath, "bukan direktori", "utf8")
  // "blocker" adalah file biasa, bukan direktori -> mkdirSync di dalam
  // saveState() akan gagal (ENOTDIR) saat mencoba membuat direktori ini.
  const unwritableFilePath = path.join(blockerPath, "state.json")
  const recorder = createFileBackedRecorder(unwritableFilePath)

  assert.throws(() => recorder.record("admin-1", "admin-2"))
  assert.equal(recorder.getState().admins["admin-1"].totalMessagesSent, 1)
})
