# WhatsApp Two-Account Conversation Simulator

Proyek Node.js berbasis Baileys untuk menguji percakapan finite antara dua akun WhatsApp milik sendiri:

```text
Admin 1 -> Admin 2 -> Admin 1 -> Admin 2 -> selesai
```

> [!IMPORTANT]
> Baileys merupakan library tidak resmi dan tidak berafiliasi dengan WhatsApp atau Meta. Proyek ini hanya untuk development dan QA menggunakan akun milik sendiri. Jangan digunakan untuk broadcast, cold messaging, percakapan tanpa batas, atau melewati sistem anti-abuse. Fitur opt-in yang mengurangi sinyal bot (presence timing, fingerprint device/session, jeda read receipt, typo buatan lihat di bawah) tidak menjamin akun bebas pembatasan; kedua akun tetap milik pengguna sendiri yang saling tahu, tidak ada pihak ketiga yang dikelabui.

## Status

- Tahap 1: fondasi proyek — selesai.
- Tahap 2: koneksi dua session — kode selesai; verifikasi auth nyata masih diperlukan.
- Tahap 3: simulator finite — kode dan automated test selesai.
- Tahap 4: stabilitas, profil skenario, dan laporan run — sudah dirancang ulang, belum diimplementasikan.

Fitur inbound pelanggan, trigger `JOIN`, tautan Community, queue inbound, dan SQLite tidak termasuk dalam proyek ini.

## Fitur saat ini

- Dua socket Baileys dengan auth directory terpisah.
- QR pairing terpisah untuk Admin 1 dan Admin 2.
- Pengecekan bahwa kedua session menggunakan akun berbeda.
- Reconnect terbatas dan penghentian terminal saat logout.
- Tes pengiriman satu kali pada kedua arah.
- Skenario percakapan finite dengan sepuluh langkah.
- Jeda yang dapat dikonfigurasi.
- Konfirmasi `DELIVERY_ACK` per langkah.
- Stop protection saat session disconnect atau proses dibatalkan.
- Redaksi output sensitif dari log.
- Monitoring kesehatan dekripsi dan klasifikasi disconnect melalui
  `baileys-antiban` 4.10.0.
- Session berubah menjadi `degraded` dan pengiriman dihentikan ketika ambang
  indikasi `Bad MAC` tercapai.
- **Opt-in, default OFF** — presence choreography: typing plan deterministik
  (`PRESENCE_ENABLED`) sebelum pesan QA dikirim.
- **Opt-in, default OFF** — human entropy: aktivitas idle acak (typing/read
  receipt/presence) ke kontak yang sudah membalas duluan, tidak pernah ke
  kontak baru (`HUMAN_ENTROPY_ENABLED`). Implementasi sendiri di
  `src/sessions/human-entropy.js` (bukan lagi `HumanEntropyService` dari
  `baileys-antiban`, yang ternyata butuh framework terpisah yang tidak ada
  di proyek ini -- lihat project.md BUG-004).
- **Opt-in, default OFF** — device fingerprint randomization: appVersion/
  osVersion/deviceModel acak tapi stabil per admin (`DEVICE_FINGERPRINT_ENABLED`).
- **Opt-in, default OFF** — stealth connect: browser tuple acak + penundaan
  presence `available` setelah connect (`STEALTH_CONNECT_ENABLED`).
- **Opt-in, default OFF** — read receipt variance: `sock.readMessages()`
  dibungkus dengan jeda Gaussian, bukan instan (`READ_RECEIPT_VARIANCE_ENABLED`).
- **Opt-in, default OFF** — legitimacy signals: sebagian kecil pesan QA
  dikirim dengan typo QWERTY yang disengaja lalu dikoreksi setelah jeda
  singkat (`LEGITIMACY_SIGNALS_ENABLED`). Hanya bagian typo-and-correct yang
  dipakai; read gap dan mid-typing pause dari modul ini dimatikan.
- **Opt-in, default OFF** — session fingerprint: superset dari device
  fingerprint, menambah jitter network/typing/retry serta metadata voice-note
  dan battery state, semuanya stabil per admin (`SESSION_FINGERPRINT_ENABLED`).
  Mengalahkan `DEVICE_FINGERPRINT_ENABLED` bila keduanya aktif.

Integrasi `baileys-antiban` dibatasi pada fungsi defensif dan opt-in di atas.
Sebagian besar bekerja pada level koneksi/protokol; satu pengecualian adalah
`LegitimacySignalInjector`, yang menyisipkan typo buatan pada isi pesan itu
sendiri sebagai simulasi ketidaksempurnaan manusia antar dua akun sendiri.
Simulator ini tidak mengaktifkan proxy rotation, warm-up otomatis skala
besar, `ReputationVoucher`, atau mekanisme fleet/broadcast lain dari
`baileys-antiban`. Kedua akun dalam simulator ini saling tahu (bukan
penipuan terhadap pihak ketiga), dan fitur opt-in ini tidak menjamin akun
bebas pembatasan. Detail lengkap: [project.md
§7.1](project.md#71-integrasi-stabilitas-dan-pengurangan-sinyal-bot).

## Struktur

```text
src/
|-- app.js
|-- config.js
|-- manual-send.js
|-- conversation/
|   |-- runner.js
|   `-- scenarios.js
|-- sessions/
|   |-- qr-renderer.js
|   |-- reconnect-policy.js
|   |-- session-manager.js
|   |-- session-state.js
|   `-- whatsapp-session.js
`-- utils/
    |-- console-guard.js
    |-- jid.js
    |-- logger.js
    |-- shutdown.js
    `-- sleep.js
```

## Persiapan

Prasyarat:

- Node.js 20 atau lebih baru;
- dua akun WhatsApp milik sendiri;
- koneksi internet stabil;
- satu process saja untuk setiap pasangan auth directory.

Instal dan periksa proyek:

```bash
npm install
npm test
npm run check
```

Salin `.env.example` menjadi `.env`, kemudian gunakan konfigurasi berikut:

```dotenv
APP_MODE=conversation
LOG_TO_FILE_ENABLED=true
LOG_DIRECTORY=./logs
WA_CONNECT_ENABLED=true

ADMIN_1_AUTH_DIR=./sessions/admin-1
ADMIN_2_AUTH_DIR=./sessions/admin-2

MAX_CONVERSATION_STEPS=10
MESSAGE_DELAY_MS=65000
DELIVERY_RECEIPT_TIMEOUT_MS=30000

SESSION_HEALTH_ENABLED=true
SESSION_BAD_MAC_THRESHOLD=3
SESSION_BAD_MAC_WINDOW_MS=60000

# Semua baris di bawah ini opsional dan default OFF. Lihat .env.example dan
# project.md §7.1 untuk penjelasan tiap fitur.
PRESENCE_ENABLED=false
HUMAN_ENTROPY_ENABLED=false
DEVICE_FINGERPRINT_ENABLED=false
STEALTH_CONNECT_ENABLED=false
READ_RECEIPT_VARIANCE_ENABLED=false
LEGITIMACY_SIGNALS_ENABLED=false
SESSION_FINGERPRINT_ENABLED=false
```

## Menjalankan simulator

```bash
npm start
```

Aplikasi akan:

1. Membuat atau memulihkan kedua session.
2. Menampilkan QR untuk session yang belum dipasangkan.
3. Menunggu kedua session `ready`.
4. Memastikan kedua session memakai akun berbeda.
5. Menjalankan skenario di `src/conversation/scenarios.js`.
6. Menutup kedua socket ketika skenario selesai atau gagal.

> [!WARNING]
> `npm start` dengan `WA_CONNECT_ENABLED=true` benar-benar mengirim pesan. Dengan sepuluh langkah dan jeda 65 detik, satu pengujian memerlukan sekitar sepuluh menit.

Pesan pertama dikirim segera setelah kedua session siap. Pesan berikutnya menunggu `MESSAGE_DELAY_MS`. Jangan menjalankan `npm start` dan `npm run test:manual-send` secara bersamaan.

## Tes pengiriman dua arah

Gunakan perintah ini untuk diagnosis satu pasang pesan sebelum menjalankan skenario penuh:

```bash
npm run test:manual-send
```

Tes tersebut menjalankan:

```text
Admin 1 -> Admin 2
menunggu MESSAGE_DELAY_MS
Admin 2 -> Admin 1
selesai
```

Setiap run memakai kode unik yang sama pada kedua pesan. Tes hanya berhasil jika kedua arah memperoleh `DELIVERY_ACK`.

## Mengubah percakapan

Ubah daftar pesan di `src/conversation/scenarios.js`. Setiap langkah harus mempunyai:

```javascript
{
  sender: "admin-1",
  text: "Isi pesan",
  delayMs: 65000
}
```

Aturan:

- `sender` hanya `admin-1` atau `admin-2`;
- sender sebaiknya bergantian;
- teks tidak boleh kosong;
- jumlah langkah tidak boleh melampaui `MAX_CONVERSATION_STEPS`;
- skenario harus finite dan tidak menggunakan listener auto-reply.

## Log

Setiap event ditulis sebagai satu baris JSON ke console. Selain itu, selama
`LOG_TO_FILE_ENABLED=true` (default), baris yang sama juga ditulis ke file
harian di `logs/app-YYYY-MM-DD.log` (mirip `storage/logs/laravel.log`),
dengan redaksi data sensitif yang sama seperti di console. File baru dibuat
otomatis setiap pergantian hari. Kegagalan menulis file (misalnya permission
disk) tidak menghentikan aplikasi -- hanya dicatat sebagai
`logger.file-write.failed` di console. Isi `logs/` tidak boleh dicommit
(sudah masuk `.gitignore`) karena bisa memuat konteks pengiriman pesan.

Event observability tambahan yang tersedia:

- `session.features.configured`: status ON/OFF dan parameter aman setiap fitur;
- `session.ready.summary`: snapshot health dan human entropy saat session siap;
- `session.health.observed`: jumlah decrypt sukses/gagal per batch pesan;
- `session.health.decrypt-failure-update`: indikasi ciphertext gagal dari update;
- `human-entropy.cycle.scheduled`: waktu tunggu menuju siklus berikutnya;
- `human-entropy.cycle.completed`: aksi dan statistik kumulatif tiap siklus;
- `human-entropy.stopped` dan `session.stop.summary`: ringkasan saat shutdown.

Statistik human entropy hanya berisi counter. JID kontak tidak dimasukkan ke
event-event tersebut.

## Masalah session saat ini

Uji terakhir menunjukkan Admin 2 berubah menjadi `401 loggedOut` setelah langkah kedua. Ini bukan masalah jeda atau urutan sender. Pairing ulang Admin 2 diperlukan sebelum skenario penuh diulang.

Jika terminal menampilkan `session.connection.closed` dengan `statusCode: 405` dan `disconnectCategory: "fatal"` berulang di setiap percobaan reconnect sampai `session.reconnect.exhausted` -- terutama tepat setelah `DEVICE_FINGERPRINT_ENABLED` atau `SESSION_FINGERPRINT_ENABLED` dinyalakan -- itu bukan masalah kredensial atau jaringan. Lihat [project.md BUG-003](project.md#bug-003--devicesession-fingerprint-memicu-disconnect-fatal-status-405-di-semua-percobaan-reconnect); sudah diperbaiki di kode saat ini.

Jika terminal menampilkan `Bad MAC` atau `Failed to decrypt message with any known session`:

1. Hentikan seluruh process yang memakai session tersebut.
2. Putuskan linked device yang bermasalah dari ponsel.
3. Arsipkan auth directory untuk diagnosis dan jangan membagikannya.
4. Buat ulang auth directory kosong.
5. Pairing ulang satu kali.
6. Jalankan `npm run test:manual-send` terlebih dahulu.

## Keamanan

- Jangan commit `.env`, folder `sessions/`, QR, pairing code, atau credential.
- Jangan membuka dua process menggunakan auth directory yang sama.
- Jangan mengirim ulang otomatis ketika status delivery tidak pasti.
- Batasi jumlah langkah, reconnect, dan durasi pengujian.
- Hentikan skenario jika salah satu session logout.
- Gunakan hanya dua akun pengujian milik sendiri.

Rancangan tahapan dan catatan bug tersedia di [project.md](project.md).
