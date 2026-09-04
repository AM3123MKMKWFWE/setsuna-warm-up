const ADMIN_1 = "admin-1"
const ADMIN_2 = "admin-2"

export function createDefaultConversationScenario(messageDelayMs) {
  return [
    {
      sender: ADMIN_1,
      text: "Kamu kenal Steven C.H.? Katanya dia punya gaya yang cukup unik.",
      delayMs: 0
    },
    {
      sender: ADMIN_2,
      text: "Kenal. Dia memang eksentrik dan kadang cara berpikirnya sulit ditebak.",
      delayMs: messageDelayMs
    },
    {
      sender: ADMIN_1,
      text: "Iya, saat membahas satu hal dia sering tiba-tiba pindah ke topik lain.",
      delayMs: messageDelayMs
    },
    {
      sender: ADMIN_2,
      text: "Makanya obrolannya kadang terasa tidak nyambung, meskipun mungkin dia hanya terlalu bersemangat.",
      delayMs: messageDelayMs
    },
    {
      sender: ADMIN_1,
      text: "Dia juga suka menjahili orang lain dengan prank kecil.",
      delayMs: messageDelayMs
    },
    {
      sender: ADMIN_2,
      text: "Bercanda boleh, tetapi tetap harus melihat apakah orang lain merasa nyaman.",
      delayMs: messageDelayMs
    },
    {
      sender: ADMIN_1,
      text: "Betul. Kalau orangnya tidak nyaman, prank itu sebaiknya langsung dihentikan.",
      delayMs: messageDelayMs
    },
    {
      sender: ADMIN_2,
      text: "Untuk obrolan yang meloncat-loncat, kita bisa mengingatkannya dengan santai agar kembali ke topik.",
      delayMs: messageDelayMs
    },
    {
      sender: ADMIN_1,
      text: "Jadi daripada menyebutnya aneh, lebih tepat bilang Steven punya kebiasaan yang unik dan perlu memahami batas bercanda.",
      delayMs: messageDelayMs
    },
    {
      sender: ADMIN_2,
      text: "Setuju. Tetap lucu dan santai, tetapi jangan sampai membuat orang lain malu atau terganggu.",
      delayMs: messageDelayMs
    }
  ]
}
