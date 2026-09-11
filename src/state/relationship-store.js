import fs from "node:fs"
import path from "node:path"

/**
 * Penyimpanan riwayat "siapa sudah chat dengan siapa" untuk fitur warm-up
 * bertahap (seniority-based). Sengaja TIDAK memakai database (lihat
 * newFeture.md §1/§2.1) -- cukup satu file JSON polos, karena skala datanya
 * kecil (beberapa admin) dan hanya diakses oleh satu proses Node.js secara
 * berurutan.
 *
 * Struktur state:
 * {
 *   admins: { "admin-1": { totalMessagesSent: 45 }, ... },
 *   pairs: {
 *     "admin-1|admin-2": {
 *       messageCount: 20,
 *       firstContactBy: "admin-1",
 *       firstContactAt: "2026-09-01T10:00:00.000Z"
 *     },
 *     ...
 *   }
 * }
 */

export function createEmptyState() {
  return { admins: {}, pairs: {} }
}

/**
 * Kunci pasangan dinormalisasi (urut alfabetis) supaya getPairKey("a","b")
 * dan getPairKey("b","a") selalu merujuk entri `pairs` yang sama.
 */
export function getPairKey(adminA, adminB) {
  const [first, second] = [String(adminA), String(adminB)].sort()
  return `${first}|${second}`
}

function normalizeState(candidate) {
  if (candidate === null || typeof candidate !== "object") {
    return createEmptyState()
  }

  const admins =
    candidate.admins !== null && typeof candidate.admins === "object"
      ? candidate.admins
      : {}
  const pairs =
    candidate.pairs !== null && typeof candidate.pairs === "object"
      ? candidate.pairs
      : {}

  return { admins, pairs }
}

/**
 * Baca state dari disk. Fail-safe: file belum ada, tidak bisa dibaca, atau
 * isinya bukan JSON valid -- semuanya mengembalikan state kosong daripada
 * melempar error, supaya file riwayat yang rusak tidak pernah menjatuhkan
 * aplikasi. `onError` opsional dipanggil (tanpa menghentikan apa pun) supaya
 * pemanggil bisa mencatat kejadian ini ke logger kalau mau.
 */
export function loadState(filePath, options = {}) {
  const onError = options.onError ?? (() => {})
  let raw

  try {
    raw = fs.readFileSync(filePath, "utf8")
  } catch (error) {
    if (error.code !== "ENOENT") {
      onError(error)
    }
    return createEmptyState()
  }

  try {
    return normalizeState(JSON.parse(raw))
  } catch (error) {
    onError(error)
    return createEmptyState()
  }
}

/**
 * Tulis state ke disk dengan pola atomic write: tulis dulu ke file
 * sementara, baru rename ke nama asli. Ini menghindari file korup kalau
 * proses mati persis di tengah penulisan (rename di filesystem yang sama
 * bersifat atomik).
 */
export function saveState(filePath, state) {
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true })

  const tmpPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`
  )

  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8")
  fs.renameSync(tmpPath, filePath)
}

/**
 * Catat satu pesan terkirim. Mengembalikan STATE BARU (tidak mengubah
 * `state` yang diberikan) supaya gampang diuji dan tidak ada efek samping
 * tersembunyi.
 *
 * - `totalMessagesSent` milik `sender` bertambah 1.
 * - Kalau pasangan (sender, recipient) ini baru pertama kali tercatat,
 *   `firstContactBy`/`firstContactAt` diisi sekali dan tidak pernah diubah
 *   lagi setelahnya -- ini yang dipakai fitur seniority untuk tahu siapa
 *   yang "mengenalkan diri duluan" ke pasangan itu.
 */
export function recordMessage(
  state,
  sender,
  recipient,
  timestamp = new Date().toISOString()
) {
  const previousSenderEntry = state.admins[sender] ?? { totalMessagesSent: 0 }
  const admins = {
    ...state.admins,
    [sender]: {
      ...previousSenderEntry,
      totalMessagesSent: previousSenderEntry.totalMessagesSent + 1
    }
  }

  const key = getPairKey(sender, recipient)
  const existingPair = state.pairs[key]
  const pairs = {
    ...state.pairs,
    [key]: existingPair
      ? { ...existingPair, messageCount: existingPair.messageCount + 1 }
      : { messageCount: 1, firstContactBy: sender, firstContactAt: timestamp }
  }

  return { admins, pairs }
}

/**
 * `true` kalau total pesan terkirim admin ini sudah mencapai ambang batas
 * seniority (`SENIORITY_THRESHOLD`). Admin yang belum pernah tercatat sama
 * sekali dianggap punya 0 pesan terkirim.
 */
export function isOldAdmin(state, adminName, thresholdMessages) {
  const totalMessagesSent = state.admins[adminName]?.totalMessagesSent ?? 0
  return totalMessagesSent >= thresholdMessages
}

/**
 * `true` kalau pasangan ini sudah pernah tercatat mengirim pesan sebelumnya
 * (di run mana pun, karena state ini persist lintas-run).
 */
export function hasChattedBefore(state, adminA, adminB) {
  return getPairKey(adminA, adminB) in state.pairs
}

/**
 * Bungkus state + persistensi file jadi satu objek kecil yang gampang
 * dipakai pemanggil (mis. `ConversationRunner` di Tahap 4, `app.js` di
 * Tahap 5) tanpa perlu mengelola sendiri kapan harus `loadState`/`saveState`.
 *
 * `record()` SENGAJA tidak menelan errornya sendiri (tidak try/catch di
 * sini) -- state di memori tetap diperbarui, tapi kegagalan tulis ke disk
 * (mis. disk penuh) dilempar ke pemanggil supaya pemanggil (biasanya
 * `ConversationRunner`) yang memutuskan cara menanganinya (log warning,
 * tetap lanjut jalankan skenario) sesuai kebutuhan masing-masing.
 */
export function createFileBackedRecorder(filePath, options = {}) {
  let state = options.initialState ?? loadState(filePath, options)

  return {
    getState() {
      return state
    },
    record(sender, recipient, timestamp) {
      state = recordMessage(state, sender, recipient, timestamp)
      saveState(filePath, state)
      return state
    }
  }
}
