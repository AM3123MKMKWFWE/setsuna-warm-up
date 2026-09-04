# WhatsApp Multi-Session Warm-Up & Inbound Bot

Proyek ini adalah rancangan aplikasi Node.js berbasis Baileys untuk mengelola dua akun WhatsApp milik sendiri dalam dua skenario pengujian:

1. simulasi percakapan dua arah dengan langkah yang terbatas; dan
2. bot admin yang hanya merespons pesan masuk untuk memberikan tautan undangan WhatsApp Community.

> [!IMPORTANT]
> Baileys adalah library tidak resmi dan tidak berafiliasi dengan WhatsApp atau Meta. Proyek ini hanya ditujukan untuk development, QA, demo, akun milik sendiri, dan komunikasi kepada pengguna yang sudah memberikan persetujuan (opt-in). Jangan digunakan untuk spam, broadcast tanpa izin, auto-join, atau menghindari sistem anti-abuse.

## Status proyek

Tahap 1 dan implementasi kode Tahap 2 sudah tersedia. Implementasi kode Tahap 3 juga selesai: validator skenario, conversation runner finite, delay per langkah, konfirmasi delivery, `maxSteps`, penghentian saat session putus, dan pembatalan saat shutdown. Validasi end-to-end Tahap 3 dengan dua akun nyata tetap harus dilakukan setelah kedua session sehat.

Dokumen yang tersedia:

- `README.md` — gambaran umum dan panduan awal;
- `project.md` — spesifikasi teknis, arsitektur, roadmap, dan kriteria penerimaan;
- `../baileys_two_account_conversation_blueprint.md` — blueprint simulator percakapan dua akun;
- `../Alur WA admin - Baileys.txt` — rancangan operasional bot inbound dua admin.

## Sasaran utama

- Menjalankan dua socket Baileys dalam satu aplikasi dengan auth state terpisah.
- Memastikan kegagalan satu akun tidak menghentikan akun lainnya.
- Mendukung simulator percakapan yang selalu berhenti setelah skenario selesai.
- Memproses pesan inbound yang valid tanpa mengirim pesan pertama kepada pelanggan.
- Mencegah balasan ganda setelah reconnect atau event yang terkirim ulang.
- Menyediakan queue, logging, reconnect handler, dan konfigurasi yang mudah diaudit.

## Arsitektur ringkas

```text
                         Node.js Application
                                  |
                    +-------------+-------------+
                    |                           |
                    v                           v
             Baileys Admin 1             Baileys Admin 2
                    |                           |
                    v                           v
           sessions/admin-1            sessions/admin-2
                    |                           |
                    +-------------+-------------+
                                  |
                         Shared Controller
                       /                   \
                      v                     v
          Conversation Simulator      Inbound Handler
```

Setiap akun menggunakan folder session sendiri. Credential tidak boleh digunakan bersama atau disimpan ke Git.

## Rencana struktur direktori

```text
warm-up/
|-- src/
|   |-- app.js
|   |-- config.js
|   |-- sessions/
|   |   |-- create-session.js
|   |   `-- session-manager.js
|   |-- conversation/
|   |   |-- runner.js
|   |   `-- scenarios.js
|   |-- inbound/
|   |   |-- handler.js
|   |   |-- validator.js
|   |   `-- queue.js
|   `-- utils/
|       |-- logger.js
|       `-- sleep.js
|-- sessions/
|   |-- admin-1/
|   `-- admin-2/
|-- logs/
|-- tests/
|-- .env.example
|-- .gitignore
|-- package.json
|-- README.md
`-- project.md
```

Struktur tersebut masih berupa target dan dapat disesuaikan saat implementasi.

## Prasyarat

- Node.js 20 atau lebih baru;
- dua akun WhatsApp milik sendiri untuk pengujian multi-session;
- perangkat yang dapat melakukan pairing/scan QR;
- koneksi internet stabil;
- tautan undangan Community yang sah jika mode inbound digunakan.

Dependency utama yang direncanakan:

```text
@whiskeysockets/baileys
@hapi/boom
qrcode-terminal
```

Versi dependency harus dipilih dan diuji saat implementasi karena API Baileys dapat berubah.

Implementasi Tahap 2 memakai Baileys `7.0.0-rc14` agar menggunakan perbaikan Signal session dan pemetaan LID terbaru. Karena versi ini masih release candidate, setiap upgrade berikutnya harus diikuti pengujian pairing, reconnect, dan delivery dua arah.

## Rencana konfigurasi

Nilai sensitif dan nilai yang berbeda antar-environment akan diletakkan di `.env`. Contoh variabel:

```dotenv
COMMUNITY_INVITE_URL=https://chat.whatsapp.com/replace-with-valid-code
INBOUND_TRIGGER=JOIN
MAX_CONVERSATION_STEPS=10
MESSAGE_DELAY_MS=65000
```

File `.env` dan seluruh isi `sessions/` wajib masuk `.gitignore`.

## Alur simulator percakapan

```text
Connect Admin 1 + Admin 2
            |
            v
     Wait until both ready
            |
            v
     Load finite scenario
            |
            v
  Delay -> Send -> Log each step
            |
            v
       Stop at end/maxSteps
```

Simulator tidak boleh menggunakan dua auto-reply listener yang saling memicu karena dapat menghasilkan infinite loop.

Skenario bawaan berada di `src/conversation/scenarios.js` dan terdiri dari sepuluh pesan mengenai karakter fiktif Steven C.H., dengan urutan pengirim yang terus bergantian:

```text
Admin 1 -> Admin 2 -> Admin 1 -> Admin 2 -> ... -> selesai
```

Pesan pertama dikirim segera setelah kedua session siap. Setiap pesan berikutnya menunggu `MESSAGE_DELAY_MS` sebelum dikirim. Runner menunggu `DELIVERY_ACK` pada setiap langkah. Jika receipt timeout tetapi session masih `ready`, hasil dicatat sebagai `delivery-unconfirmed` dan skenario dilanjutkan. Disconnect, logout, shutdown, skenario invalid, atau batas langkah terlampaui tetap menghentikan sisa percakapan.

## Alur bot inbound

```text
Pelanggan membuka link resmi WhatsApp
                  |
                  v
       Pelanggan mengirim trigger
                  |
                  v
        Validate messages.upsert
                  |
                  v
       Check duplicate + enqueue
                  |
                  v
       Kirim tautan Community
                  |
                  v
     Pelanggan memilih untuk join
```

Bot hanya membalas setelah pelanggan mengirim pesan. Bot tidak memasukkan pengguna ke Community secara otomatis.

## Menjalankan aplikasi

Instal dependency, siapkan konfigurasi lokal, lalu jalankan pemeriksaan:

```bash
npm install
npm test
npm run check
npm start
```

Salin konfigurasi contoh menjadi konfigurasi lokal:

```powershell
Copy-Item .env.example .env
```

Secara default `WA_CONNECT_ENABLED=false`, sehingga `npm start` tidak membuka koneksi WhatsApp. Untuk melakukan pairing:

1. Ubah `WA_CONNECT_ENABLED=true` pada `.env`.
2. Jalankan `npm start`.
3. Scan QR `admin-1` menggunakan akun Admin 1.
4. Scan QR `admin-2` menggunakan akun Admin 2.
5. Jika `APP_MODE=conversation`, skenario bawaan otomatis berjalan setelah kedua session siap.

Pastikan QR tidak tertukar. Credential akan disimpan secara terpisah dalam `sessions/admin-1` dan `sessions/admin-2`.

> [!WARNING]
> `npm start` dengan `APP_MODE=conversation` dan `WA_CONNECT_ENABLED=true` akan benar-benar mengirim sepuluh pesan uji. Dengan jeda 65 detik, pengujian memerlukan sekitar sepuluh menit. Aplikasi berhenti dan menutup kedua socket secara otomatis setelah seluruh langkah selesai atau ketika salah satu langkah gagal.

Untuk menjalankan simulator Tahap 3:

```dotenv
APP_MODE=conversation
WA_CONNECT_ENABLED=true
MAX_CONVERSATION_STEPS=10
MESSAGE_DELAY_MS=65000
DELIVERY_RECEIPT_TIMEOUT_MS=30000
```

Kemudian jalankan:

```bash
npm start
```

Ubah isi percakapan hanya melalui `src/conversation/scenarios.js`. Setiap langkah wajib memiliki `sender`, `text`, dan `delayMs`; sender hanya boleh `admin-1` atau `admin-2`.

Jika benar-benar membutuhkan data QR dalam bentuk teks, aktifkan sementara:

```dotenv
WA_QR_SHOW_RAW=true
```

Terminal akan menampilkan nilai di antara penanda `QR_DATA_ADMIN_1_START`/`END` atau `QR_DATA_ADMIN_2_START`/`END`. Data tersebut adalah kredensial pairing sementara. Jangan memasukkannya ke log, chat, repository, atau layanan pembuat QR pihak ketiga yang tidak dipercaya. Setelah pairing selesai, kembalikan nilainya menjadi `false`.

Untuk uji pengiriman nyata dua arah, jalankan secara eksplisit setelah kedua session terhubung:

```bash
npm run test:manual-send
```

Perintah tersebut membaca JID langsung dari dua akun yang sudah terhubung, mengirim satu pesan Admin 1 ke Admin 2, menunggu delay yang dikonfigurasi, lalu mengirim satu pesan Admin 2 ke Admin 1. Setiap eksekusi memakai kode unik yang sama pada kedua pesan, misalnya `[08A06F59]`, agar pesan dari percobaan berbeda mudah dibedakan. Nomor tidak perlu ditulis di `.env`, dan perintah ini tidak dijalankan oleh automated test.

Uji manual menunggu `MANUAL_TEST_STABILIZATION_MS` setelah kedua session berstatus `ready` sebelum mengirim pesan pertama. Nilai defaultnya 10 detik agar pairing dan sinkronisasi awal mempunyai waktu untuk stabil. Setelah setiap pengiriman, aplikasi menunggu `DELIVERY_ACK` hingga `DELIVERY_RECEIPT_TIMEOUT_MS` (default 30 detik) dan mencatat hasilnya sebagai `delivery-confirmed` atau `delivery-unconfirmed`.

`npm run test:manual-send` adalah tes satu kali. Setelah dua arah selesai diuji, kedua koneksi sengaja dihentikan dan terminal kembali ke prompt. Menjalankan perintah itu kembali akan membuat satu pasang pesan baru.

Tes hanya dinyatakan berhasil jika kedua arah memperoleh `DELIVERY_ACK`. Nomor penerima diverifikasi melalui WhatsApp sebelum setiap pengiriman antarsession, dan aplikasi menolak pengujian jika kedua folder session ternyata tertaut ke akun yang sama.

Jeda uji manual menggunakan `MESSAGE_DELAY_MS=65000` atau 65 detik. Nilai ini sengaja lebih dari satu menit agar label waktu kedua pesan pada aplikasi WhatsApp tidak terlihat sama. Event log `manual-send-test.inter-message-delay.started` dan `manual-send-test.inter-message-delay.completed` mencatat waktu aktual sebelum dan setelah jeda.

Jika hanya satu arah yang terus mengalami timeout dan terminal menampilkan `Bad MAC`, auth state Signal pada session pengirim tidak sinkron. Arsipkan folder session pengirim (jangan langsung menghapusnya), putuskan linked device terkait dari ponsel bila masih tercantum, lalu pairing ulang session tersebut. Setelah pairing, jalankan kembali tes dan pastikan dua nilai delivery bernilai `true`.

Jika session berubah menjadi `logged-out` dengan status 401 segera setelah pairing, hentikan aplikasi, putuskan linked device yang gagal dari ponsel, arsipkan hanya folder session terkait, lalu lakukan pairing ulang. Jangan menjalankan `npm start` dan `npm run test:manual-send` secara bersamaan.

Pada uji nyata Tahap 3 tanggal 3 September 2026, langkah pertama `Admin 1 -> Admin 2` berhasil dan jeda 65 detik selesai, tetapi Admin 2 berubah menjadi `logged-out` ketika mengirim langkah kedua. Runner menghentikan langkah tersisa sebagaimana dirancang. Auth lama Admin 2 disimpan di `sessions/admin-2-logged-out-20260903-164326`; folder `sessions/admin-2` perlu dipasangkan ulang sebelum uji empat langkah diulang.

## Keamanan

- Jangan commit `sessions/`, `.env`, QR, pairing code, credential, atau log yang memuat data pribadi.
- Validasi pengirim, jenis event, message ID, timestamp, dan `fromMe` sebelum memproses pesan.
- Abaikan status broadcast, event lama, dan pesan yang sudah diproses.
- Batasi jumlah langkah, ukuran queue, retry, serta reconnect.
- Hentikan akun yang logout atau memiliki auth state invalid; pairing ulang dilakukan secara manual.
- Pisahkan nomor owner Community dari akun yang dipakai oleh aplikasi.
- Terapkan kebijakan retensi log dan minimalkan penyimpanan nomor serta isi pesan.

## Pengembangan

Urutan implementasi yang disarankan:

1. siapkan project Node.js dan konfigurasi dasar;
2. hubungkan dan stabilkan Admin 1;
3. tambahkan Admin 2 dengan auth state terpisah;
4. uji kirim manual dua arah menggunakan akun sendiri;
5. implementasikan finite conversation runner;
6. implementasikan inbound validation, duplicate protection, dan queue;
7. tambahkan reconnect handler, logging, health status, dan pengujian;
8. lakukan uji skala rendah sebelum penggunaan operasional.

Detail lengkap tersedia di [`project.md`](project.md).

## Lisensi dan tanggung jawab

Lisensi proyek belum ditentukan. Pengguna bertanggung jawab mematuhi ketentuan WhatsApp, kebijakan operator, perlindungan data, serta hukum yang berlaku.
