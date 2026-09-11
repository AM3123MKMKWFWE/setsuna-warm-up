import { hasChattedBefore, isOldAdmin } from "../state/relationship-store.js"

/**
 * Pool kalimat obrolan generik untuk skenario dinamis. Tidak terikat ke
 * topik/pasangan admin tertentu karena pasangan sekarang tidak lagi tetap
 * (bergantung admin mana saja yang aktif dan riwayat mereka).
 *
 * Empat kategori dipakai bergiliran per pasangan supaya tiap putaran
 * obrolan tetap terasa seperti percakapan yang mengalir (buka -> balas ->
 * lanjutan -> penutup), bukan empat pesan acak yang tidak nyambung.
 */
const CHAT_POOL = {
  openers: [
    "Eh, lagi sibuk apa nih hari ini?",
    "Weekend ini ada rencana apa?",
    "Udah makan siang belum? Aku masih laper nih.",
    "Di tempatmu cuacanya gimana? Di sini mendung terus dari tadi.",
    "Udah lama ga ngobrol, gimana kabarnya akhir-akhir ini?",
    "Eh udah nonton film yang lagi rame itu belum?"
  ],
  replies: [
    "Belum ada rencana pasti sih, mungkin beres-beres rumah dulu.",
    "Lagi mikir mau makan apa nih, ada rekomendasi?",
    "Belum sempat, emang gimana ceritanya, bagus ga?",
    "Sama, dari pagi udah gerimis kecil-kecil di sini juga.",
    "Baik-baik aja kok, cuma lagi sibuk beberes rumah.",
    "Lumayan, masih proses beberapa hal, dikit lagi kelar."
  ],
  continuations: [
    "Oh oke, kalau sempat mampir ya, aku kabarin lagi.",
    "Coba deh, katanya enak banget di sana.",
    "Lumayan seru, endingnya agak bikin mikir sih.",
    "Kalau gitu bawa payung ya kalau mau keluar nanti.",
    "Semangat ya, kalau butuh bantuan bilang aja langsung.",
    "Santai aja, jangan dipaksain kalau lagi capek."
  ],
  closings: [
    "Siap, ditunggu ya, jangan lupa kabarin.",
    "Boleh, nanti aku cobain deh, tak kasih tau hasilnya.",
    "Wah jadi penasaran, nanti aku coba tonton deh.",
    "Iya, udah disiapin dari tadi soalnya.",
    "Makasih banyak, nanti kalau perlu aku kabarin lagi.",
    "Oke, nanti aku kabarin kalau udah selesai semua."
  ]
}

const CHAT_POOL_CATEGORIES = ["openers", "replies", "continuations", "closings"]

function pickStepText(pairIndex, stepIndexWithinPair) {
  const category = CHAT_POOL_CATEGORIES[stepIndexWithinPair % CHAT_POOL_CATEGORIES.length]
  const pool = CHAT_POOL[category]
  return pool[pairIndex % pool.length]
}

function buildAllPairs(activeAdmins) {
  const pairs = []
  for (let i = 0; i < activeAdmins.length; i += 1) {
    for (let j = i + 1; j < activeAdmins.length; j += 1) {
      pairs.push([activeAdmins[i], activeAdmins[j]])
    }
  }
  return pairs
}

/**
 * Tentukan siapa yang wajib memulai chat duluan untuk sebuah pasangan yang
 * BELUM PERNAH chat sebelumnya (lihat newFeture.md §2.3 poin 4):
 *
 * - Kalau salah satu "lama" dan satunya "baru" -> yang lama wajib memulai.
 * - Kalau status sama (sama-sama lama, atau sama-sama baru/tidak ada nomor
 *   lama yang tersedia -- kasus darurat) -> bebas, dipilih berdasarkan
 *   urutan admin di konfigurasi (index lebih kecil duluan) supaya
 *   deterministik dan gampang diuji.
 */
function determineStarter(a, b, relationshipState, thresholdMessages) {
  const aIsOld = isOldAdmin(relationshipState, a, thresholdMessages)
  const bIsOld = isOldAdmin(relationshipState, b, thresholdMessages)

  if (aIsOld && !bIsOld) return { starter: a, responder: b }
  if (bIsOld && !aIsOld) return { starter: b, responder: a }

  // Status sama (sama-sama lama, atau sama-sama baru): urutan konfigurasi.
  return { starter: a, responder: b }
}

/**
 * Bangun skenario percakapan secara dinamis berdasarkan admin yang sedang
 * aktif dan riwayat percakapan mereka. Menggantikan
 * `createDefaultConversationScenario` yang hardcode 4 admin.
 *
 * Aturan (lihat newFeture.md §1 dan §2.3):
 * 1. Minimal 2 admin aktif harus bisa langsung dilayani (tidak menunggu 4).
 * 2. Pasangan yang SUDAH PERNAH chat sebelumnya diproses lebih dulu,
 *    baru kemudian pasangan yang belum pernah chat sama sekali.
 * 3. Untuk pasangan yang belum pernah chat: admin "lama" (total pesan
 *    terkirim >= thresholdMessages) wajib memulai duluan ke admin "baru".
 *    Kalau status keduanya sama, urutan konfigurasi yang menentukan.
 *
 * @param {object} params
 * @param {string[]} params.activeAdmins - nama admin yang sedang aktif (mis. dari config.admins), urutan menentukan tie-break.
 * @param {object} params.relationshipState - state dari `relationship-store.js` (loadState()/createEmptyState()).
 * @param {number} params.thresholdMessages - ambang batas dianggap admin "lama".
 * @param {number} params.messageDelayMs - jeda antar pesan (ms), kecuali langkah pertama di seluruh skenario (0 ms).
 * @param {number} [params.maxSteps] - potong hasil akhir sampai sejumlah ini kalau melebihi. Default: tidak dipotong.
 * @param {number} [params.stepsPerPair] - jumlah langkah bolak-balik per pasangan. Default: 4.
 * @returns {{sender: string, recipient: string, text: string, delayMs: number}[]}
 */
export function createDynamicConversationScenario({
  activeAdmins,
  relationshipState,
  thresholdMessages,
  messageDelayMs,
  maxSteps = Infinity,
  stepsPerPair = 4
}) {
  if (!Array.isArray(activeAdmins) || activeAdmins.length < 2) {
    throw new Error(
      "createDynamicConversationScenario membutuhkan minimal 2 admin aktif"
    )
  }
  if (!Number.isSafeInteger(stepsPerPair) || stepsPerPair < 1) {
    throw new Error("stepsPerPair harus berupa bilangan bulat positif")
  }

  const allPairs = buildAllPairs(activeAdmins)
  const knownPairs = allPairs.filter(([a, b]) =>
    hasChattedBefore(relationshipState, a, b)
  )
  const newPairs = allPairs.filter(
    ([a, b]) => !hasChattedBefore(relationshipState, a, b)
  )
  const orderedPairs = [...knownPairs, ...newPairs]

  const steps = []
  let globalStepIndex = 0

  orderedPairs.forEach(([a, b], pairIndex) => {
    const alreadyChatted = hasChattedBefore(relationshipState, a, b)
    const { starter, responder } = alreadyChatted
      ? { starter: a, responder: b }
      : determineStarter(a, b, relationshipState, thresholdMessages)

    for (let stepInPair = 0; stepInPair < stepsPerPair; stepInPair += 1) {
      const sender = stepInPair % 2 === 0 ? starter : responder
      const recipient = sender === starter ? responder : starter
      const text = pickStepText(pairIndex, stepInPair)
      const delayMs = globalStepIndex === 0 ? 0 : messageDelayMs

      steps.push({ sender, recipient, text, delayMs })
      globalStepIndex += 1
    }
  })

  return steps.slice(0, maxSteps)
}
