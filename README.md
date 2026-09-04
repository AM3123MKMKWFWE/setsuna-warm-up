# WhatsApp Two-Account Conversation Simulator

Proyek Node.js berbasis Baileys untuk menguji percakapan finite antara dua akun WhatsApp milik sendiri:

```text
Admin 1 -> Admin 2 -> Admin 1 -> Admin 2 -> selesai
```

> [!IMPORTANT]
> Baileys merupakan library tidak resmi dan tidak berafiliasi dengan WhatsApp atau Meta. Proyek ini hanya untuk development dan QA menggunakan akun milik sendiri. Jangan digunakan untuk broadcast, cold messaging, percakapan tanpa batas, menyamarkan otomatisasi, atau menghindari sistem anti-abuse.

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

Integrasi `baileys-antiban` dibatasi pada fungsi defensif tersebut. Simulator
tidak mengaktifkan typo buatan, fingerprint acak, aktivitas presence palsu,
proxy rotation, warm-up otomatis, atau fitur lain yang menyamarkan otomasi.

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
WA_CONNECT_ENABLED=true

ADMIN_1_AUTH_DIR=./sessions/admin-1
ADMIN_2_AUTH_DIR=./sessions/admin-2

MAX_CONVERSATION_STEPS=10
MESSAGE_DELAY_MS=65000
DELIVERY_RECEIPT_TIMEOUT_MS=30000

SESSION_HEALTH_ENABLED=true
SESSION_BAD_MAC_THRESHOLD=3
SESSION_BAD_MAC_WINDOW_MS=60000
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

## Masalah session saat ini

Uji terakhir menunjukkan Admin 2 berubah menjadi `401 loggedOut` setelah langkah kedua. Ini bukan masalah jeda atau urutan sender. Pairing ulang Admin 2 diperlukan sebelum skenario penuh diulang.

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
