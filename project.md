# Spesifikasi Proyek

## 1. Identitas

**Nama kerja:** WhatsApp Two-Account Conversation Simulator

**Platform:** Node.js 20+ / JavaScript ES Modules

**Library koneksi:** `@whiskeysockets/baileys`
**Tahap saat ini:** Tahap 3 selesai pada level kode; Tahap 4 dirancang ulang untuk stabilitas simulator dua akun

**Integrasi tambahan:** subset defensif dan opt-in `baileys-antiban` 4.10.0
diterapkan (lihat §7.1) tanpa menjalankan Tahap 4.

## 2. Tujuan

Proyek ini digunakan untuk QA percakapan terkontrol antara dua akun WhatsApp milik sendiri:

```text
Admin 1 -> Admin 2 -> Admin 1 -> Admin 2 -> selesai
```

Tujuan fungsional:

1. Menjalankan dua session WhatsApp secara independen.
2. Menyimpan credential kedua session pada direktori berbeda.
3. Memastikan kedua session siap dan menggunakan akun berbeda.
4. Menjalankan skenario percakapan finite secara berurutan.
5. Memberikan jeda yang dapat dikonfigurasi di antara pesan.
6. Menunggu status delivery setiap langkah tanpa membuat percakapan tanpa batas.
7. Menghentikan skenario saat session putus, logout, proses dibatalkan, atau langkah habis.
8. Menyediakan log aman untuk diagnosis pairing, delivery, dan reconnect.

## 3. Batas proyek

### Termasuk

- dua session Baileys milik pengguna;
- pairing QR dan penyimpanan auth state terpisah;
- pengiriman manual dua arah untuk diagnosis;
- skenario percakapan finite;
- delay per langkah;
- validasi skenario dan batas jumlah langkah;
- konfirmasi delivery;
- reconnect terbatas dan graceful shutdown;
- klasifikasi disconnect dan monitoring indikasi `Bad MAC`;
- pengujian otomatis tanpa koneksi WhatsApp nyata;
- subset opt-in `baileys-antiban` untuk *mengurangi sinyal bot* pada koneksi
  antara dua akun sendiri (lihat §7.1): presence choreography (typing plan
  deterministik), human entropy (aktivitas idle acak ke kontak yang sudah
  membalas duluan), device fingerprint randomization, dan stealth connect.
  Ini bukan penyamaran percakapan — kedua ujung percakapan tetap akun sendiri
  yang saling tahu, tidak ada pihak yang dikelabui.

### Tidak termasuk

- bot inbound pelanggan;
- trigger `JOIN` atau tautan Community;
- broadcast, cold messaging, atau daftar penerima;
- percakapan tanpa batas;
- auto-reply yang saling memicu;
- auto-join atau penambahan pengguna ke group/Community;
- konten pesan yang menyamarkan otomasi sebagai manusia (typo buatan, isi
  pesan yang dipalsukan seolah ditulis manusia, dsb.) — fitur presence/entropy/
  fingerprint di §7.1 bekerja di level koneksi/protokol, bukan pada isi pesan;
- upaya melewati limit atau sistem anti-abuse untuk keperluan blast/cold
  messaging;
- proxy rotation, warm-up otomatis skala besar, atau mekanisme fleet/multi-
  instance lain dari `baileys-antiban` di luar yang eksplisit didaftar di
  §7.1;
- jaminan akun tidak akan dibatasi — semua fitur di §7.1 bersifat mitigasi,
  bukan jaminan.

## 4. Arsitektur

```text
                       src/app.js
                           |
                    Session Manager
                    /             \
                   v               v
            Session Admin 1   Session Admin 2
                   \               /
                    +-------------+
                           |
                  Conversation Runner
                           |
             Scenario -> Delay -> Send -> ACK
                           |
                    Finite completion
```

Setiap session memiliki socket, auth directory, state, reconnect counter, dan log context sendiri. Error satu session tidak boleh mengubah credential session lainnya.

## 5. Struktur kode

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

## 6. Konfigurasi utama

| Variabel | Fungsi |
|---|---|
| `APP_MODE` | Gunakan `conversation` |
| `LOG_TO_FILE_ENABLED` | Menulis log ke file harian selain ke console (default `true`) |
| `LOG_DIRECTORY` | Direktori file log harian, default `./logs` |
| `WA_CONNECT_ENABLED` | Mengaktifkan koneksi nyata secara eksplisit |
| `ADMIN_1_AUTH_DIR` | Direktori credential Admin 1 |
| `ADMIN_2_AUTH_DIR` | Direktori credential Admin 2 |
| `MAX_CONVERSATION_STEPS` | Batas keras jumlah langkah |
| `MESSAGE_DELAY_MS` | Jeda antarlangkah setelah pesan pertama |
| `DELIVERY_RECEIPT_TIMEOUT_MS` | Batas tunggu `DELIVERY_ACK` |
| `RECONNECT_LIMIT` | Batas percobaan reconnect per session |
| `SESSION_READY_TIMEOUT_MS` | Batas tunggu kedua session siap |
| `MANUAL_TEST_STABILIZATION_MS` | Jeda stabilisasi tes manual |
| `SESSION_HEALTH_ENABLED` | Mengaktifkan monitoring kesehatan dekripsi defensif |
| `SESSION_BAD_MAC_THRESHOLD` | Jumlah indikasi `Bad MAC` sebelum session dianggap degraded |
| `SESSION_BAD_MAC_WINDOW_MS` | Jendela waktu penghitungan indikasi `Bad MAC` |
| `PRESENCE_ENABLED` | Mengaktifkan typing plan deterministik sebelum `sendBetween` |
| `PRESENCE_TYPING_WPM` / `_MIN_MS` / `_MAX_MS` | Parameter kecepatan mengetik simulasi |
| `HUMAN_ENTROPY_ENABLED` | Mengaktifkan aktivitas idle acak ke kontak yang sudah membalas |
| `HUMAN_ENTROPY_MIN_INTERVAL_MS` / `_MAX_INTERVAL_MS` | Rentang jarak antar siklus human entropy |
| `DEVICE_FINGERPRINT_ENABLED` | Mengaktifkan randomisasi appVersion/osVersion/deviceModel per admin |
| `STEALTH_CONNECT_ENABLED` | Mengaktifkan browser tuple acak + penundaan presence `available` |
| `STEALTH_PRESENCE_RAMP_MIN_MS` / `_MAX_MS` | Rentang jeda sebelum presence `available` setelah connect |
| `READ_RECEIPT_VARIANCE_ENABLED` | Membungkus `readMessages()` dengan jeda Gaussian, bukan instan |
| `READ_RECEIPT_VARIANCE_MEAN_MS` / `_STDDEV_MS` | Parameter distribusi jeda read receipt |
| `LEGITIMACY_SIGNALS_ENABLED` | Mengaktifkan typo QWERTY + koreksi pada sebagian kecil pesan QA |
| `LEGITIMACY_SIGNALS_TYPO_PROBABILITY` | Probabilitas (0-1) sebuah pesan mendapat typo buatan |
| `SESSION_FINGERPRINT_ENABLED` | Fingerprint + jitter network/typing/retry per session (superset device fingerprint) |

## 7. Aturan simulator

- Hanya `admin-1` dan `admin-2` yang dapat menjadi sender.
- Target selalu merupakan akun pasangannya.
- Kedua session harus `ready` dan terhubung ke akun berbeda.
- Pesan pertama dapat dikirim segera; pesan berikutnya mengikuti `MESSAGE_DELAY_MS`.
- Setiap langkah hanya memanggil satu pengiriman.
- Receipt timeout dicatat sebagai `delivery-unconfirmed`; skenario hanya berlanjut jika session tetap sehat.
- Logout, disconnect, abort, atau skenario invalid menghentikan langkah yang tersisa.
- Status `degraded` akibat ambang `Bad MAC` juga menghentikan langkah tersisa.
- Skenario selalu dibatasi oleh array langkah dan `MAX_CONVERSATION_STEPS`.

## 7.1 Integrasi stabilitas dan pengurangan sinyal bot

Paket `baileys-antiban` dikunci pada versi `4.10.0`. Modul yang dipakai:

**Defensif (selalu aktif, `SESSION_HEALTH_ENABLED=true` default):**

- `SessionHealthMonitor` — event pesan dipantau untuk mendeteksi indikasi
  kegagalan dekripsi; session masuk state `degraded` ketika ambang tercapai
  sehingga pengiriman berikutnya ditolak; statistik kesehatan tersedia dalam
  snapshot session.
- `classifyDisconnect` — disconnect dicatat menurut kategori dan rekomendasi
  backoff dipakai sebagai jeda minimum reconnect.

**Opt-in, default OFF (lihat `.env.example`):**

- `PresenceChoreographer.computeTypingPlan` / `executeTypingPlan`
  (`PRESENCE_ENABLED`) — mengirim `composing`/`paused` dengan timing
  deterministik (bukan instan) sebelum `sendBetween` mengirim pesan QA.
  Circadian rhythm, distraction pause, offline gap, dan skip read-receipt
  dimatikan agar tetap deterministik untuk pengujian.
- Human entropy (`HUMAN_ENTROPY_ENABLED`) — background service yang sesekali
  mengirim typing/read-receipt/presence acak ke kontak yang *sudah* membalas
  duluan (tidak pernah ke kontak baru), dimulai saat `connection.update` jadi
  `open`, dihentikan saat disconnect/stop, dengan
  `HUMAN_ENTROPY_MIN_INTERVAL_MS`/`MAX_INTERVAL_MS` mengatur jarak antar
  siklus. **Sejak BUG-004, ini BUKAN lagi `HumanEntropyService` milik
  `baileys-antiban`** — modul itu didesain untuk framework multi-session
  terpisah ("WaSP") yang tidak ada di proyek ini, jadi diganti dengan
  implementasi sendiri di `src/sessions/human-entropy.js`
  (`createHumanEntropyService`), yang bekerja langsung terhadap socket
  Baileys biasa. Perilakunya sama secara konsep: setiap siklus, dengan
  probabilitas tetap (typing 30%, read-receipt 20%, presence-toggle 15% —
  konstanta internal, meniru default `HumanEntropyService` asli), memilih
  kontak acak dari yang sudah membalas duluan dan mengirim
  `composing`/`paused`, menandai satu pesan sebagai dibaca lewat
  `readMessages()` (tanpa jeda tambahan sendiri — kalau
  `READ_RECEIPT_VARIANCE_ENABLED` juga aktif, jeda Gaussian-nya sudah
  otomatis berlaku lewat Proxy `readMessages()`, jadi tidak perlu jeda ganda),
  atau toggle `available`/`unavailable`. Semua jeda tunggu (baik antar siklus
  maupun di tengah aksi) memakai `sleep()` yang bisa dibatalkan lewat satu
  `AbortController` per siklus hidup start()/stop(), jadi `stop()` benar-benar
  membatalkan aksi yang sedang berjalan, bukan cuma jadwal siklus berikutnya.
- `generateFingerprint` / `applyFingerprint` (`DEVICE_FINGERPRINT_ENABLED`) —
  appVersion/osVersion/deviceModel diacak tapi deterministik per nama session
  (admin-1 dan admin-2 mendapat fingerprint berbeda, stabil lintas restart).
  Hanya tuple `browser` (kosmetik) dari fingerprint yang dipakai; field
  `version` yang ikut ditimpa oleh `applyFingerprint()` sengaja dibuang
  (`delete socketConfig.version`) karena memakai skema versi mobile-app lama
  yang tidak kompatibel dengan versi protokol WA multi-device Baileys —
  penyebab disconnect fatal `statusCode 405`, lihat BUG-003.
- `getStealthSocketConfig` / `rampPresenceAfterConnect`
  (`STEALTH_CONNECT_ENABLED`) — browser tuple acak dari pool realistis (kalah
  prioritas dari device/session fingerprint jika salah satunya aktif, karena
  fingerprint diterapkan setelahnya), dan status `available` ditunda dengan
  jeda acak (`STEALTH_PRESENCE_RAMP_MIN_MS`/`MAX_MS`) alih-alih langsung
  online saat connect. Ramp dibatalkan melalui `AbortController` saat socket
  disconnect atau session `stop()`.
- `readReceiptVariance` (`READ_RECEIPT_VARIANCE_ENABLED`) — membungkus
  `sock.readMessages()` via Proxy sehingga read receipt keluar dengan jeda
  Gaussian (`READ_RECEIPT_VARIANCE_MEAN_MS`/`STDDEV_MS`), bukan instan. Tidak
  berefek jika tidak ada kode yang memanggil `readMessages()`. Timer berjalan
  dihentikan saat disconnect/stop.
- `LegitimacySignalInjector` (`LEGITIMACY_SIGNALS_ENABLED`) — sebagian kecil
  pesan QA (`LEGITIMACY_SIGNALS_TYPO_PROBABILITY`, default 2.5%) dikirim
  dengan typo QWERTY yang disengaja lewat `sendBetween`, lalu dikoreksi
  setelah jeda singkat (500ms-2s). Hanya bagian typo-and-correct yang dipakai
  dari modul ini — read gap (mensimulasikan jeda sebelum membalas pesan
  masuk) dan mid-typing pause dimatikan karena simulator ini tidak punya alur
  balas-otomatis dan pause-nya akan tumpang tindih dengan `PresenceChoreographer`.
- `generateSessionFingerprint` / `applySessionFingerprint`
  (`SESSION_FINGERPRINT_ENABLED`) — superset dari device fingerprint: selain
  appVersion/osVersion/deviceModel, juga membuat jitter network/typing/retry
  serta metadata voice-note dan battery state, semuanya stabil per nama
  session. Bila aktif bersama `DEVICE_FINGERPRINT_ENABLED`, session
  fingerprint diterapkan belakangan dan menang di field `browser` (field
  `version` dari kedua fitur ini sama-sama dibuang, lihat BUG-003).
  `getRetryJitter` menambah variasi kecil ke delay reconnect di
  `#scheduleReconnect` supaya admin-1/admin-2 tidak selalu memakai jadwal
  backoff yang identik.

Modul yang **tidak** dipakai: `wrapSocket`/`AntiBan` (wrapper rate-limiter
umum), `proxyRotator`, `ContactGraphWarmer`/`TopologyThrottler`, `WarmUp`
otomatis skala besar, `InstanceCoordinator` (fleet multi-instance), dan modul
group/broadcast — di luar kebutuhan simulator dua akun ini. `ReputationVoucher`
juga belum dipakai: modul itu secara desain butuh pihak ketiga ("customer"
yang dihubungi nomor baru setelah divouch oleh akun lama) di luar admin-1/
admin-2 yang sudah saling kenal — implementasinya berarti memutuskan apakah
simulator ini mulai menghubungi penerima di luar dua akun sendiri, yang belum
diputuskan (lihat catatan kontradiksi di §3 soal cold messaging/blast).

Batasan penting: fitur opt-in di atas kini mencakup dua level — koneksi/
protokol (presence timing, device/session fingerprint, jitter reconnect,
jeda read receipt) DAN, sejak `LegitimacySignalInjector`, isi pesan itu
sendiri (typo buatan + koreksi). Yang tidak berubah: kedua ujung percakapan
(`admin-1` dan `admin-2`) tetap akun milik pengguna sendiri yang saling
tahu, sehingga typo buatan ini adalah simulasi ketidaksempurnaan manusia
antar akun sendiri, bukan konten yang dipakai untuk mengelabui pihak ketiga.
Integrasi ini tetap **tidak menjamin** akun bebas pembatasan dan **tidak
dirancang** sebagai mekanisme untuk broadcast, cold messaging, atau melewati
sistem anti-abuse WhatsApp pada skala yang lebih besar — pertanyaan apakah
proyek ini akan diperluas ke arah itu masih terbuka (§3).

## 8. Tahapan implementasi

## Tahap 1 — Fondasi proyek

**Status:** selesai.

- Bootstrap Node.js ES Modules.
- Konfigurasi `.env` tervalidasi.
- Logger dengan redaksi data sensitif.
- Utilitas sleep dan graceful shutdown.
- Automated test dan syntax check.

## Tahap 2 — Multi-session

**Status:** implementasi selesai; kesehatan auth nyata tetap perlu dipantau.

- Dua auth directory terpisah.
- Lifecycle dan reconnect per session.
- QR pairing per admin.
- Verifikasi bahwa kedua session memakai akun berbeda.
- Jalur `npm run test:manual-send` untuk diagnosis dua arah.

Target nyata yang belum tuntas:

- [ ] Kedua session dapat dipakai kembali setelah restart.
- [ ] Admin 1 → Admin 2 memperoleh `DELIVERY_ACK`.
- [ ] Admin 2 → Admin 1 memperoleh `DELIVERY_ACK`.

## Tahap 3 — Conversation simulator

**Status:** kode dan automated test selesai; uji sepuluh langkah penuh masih menunggu session Admin 2 yang stabil.

- Validator skenario finite.
- Urutan sender dan recipient eksplisit.
- Delay per langkah.
- Konfirmasi delivery.
- `maxSteps` sebagai batas keras.
- Stop protection ketika salah satu session tidak sehat.
- Pembatalan melalui `AbortSignal` saat shutdown.

Target:

- [x] Skenario invalid ditolak.
- [x] Pengiriman mengikuti urutan langkah.
- [x] Delay diterapkan sebelum langkah berikutnya.
- [x] Runner berhenti ketika session tidak tersedia.
- [x] Runner selalu selesai atau gagal secara finite.
- [ ] Skenario bawaan selesai penuh menggunakan dua akun nyata.

## Tahap 4 — Stabilitas dan variasi pengujian percakapan

**Status:** dirancang ulang; belum diimplementasikan.

Tahap ini memperkuat simulator dua akun tanpa menambahkan pelanggan, Community, broadcast, atau auto-reply inbound.

### 4.1 Preflight kedua session

- Tunggu kedua session `ready`.
- Pastikan JID kedua akun berbeda.
- Verifikasi target kanonis sebelum skenario dimulai.
- Hentikan pengujian sebelum pesan pertama jika preflight gagal.

### 4.2 Profil skenario finite

- Pisahkan skenario menjadi profil pendek, sedang, dan diagnosis.
- Setiap profil tetap berupa array langkah yang eksplisit.
- Setiap profil memiliki batas langkah dan estimasi durasi.
- Pemilihan profil dilakukan melalui konfigurasi.

### 4.3 Laporan hasil per run

Setiap run menghasilkan ringkasan:

```text
runId
startedAt
completedAt
plannedSteps
executedSteps
deliveryConfirmed
deliveryUnconfirmed
stoppedReason
```

Laporan tidak boleh berisi credential, auth state, QR, atau nomor lengkap.

### 4.4 Kebijakan receipt timeout

- Bedakan pesan gagal dikirim dengan ACK yang datang terlambat.
- Catat waktu pengiriman dan waktu ACK.
- ACK terlambat tidak boleh menyebabkan pengiriman ulang otomatis.
- Timeout dapat dikonfigurasi hingga batas yang wajar untuk pengujian.

### 4.5 Isolasi kegagalan dan penghentian

- Jika salah satu session logout, hentikan skenario aktif.
- Jangan melakukan pairing otomatis tanpa batas.
- Jangan melanjutkan langkah lama setelah process restart.
- Tutup kedua socket melalui graceful shutdown.

### Target Tahap 4

- [ ] Preflight menolak session yang sama atau tidak siap.
- [ ] Profil skenario dapat dipilih melalui konfigurasi.
- [ ] Semua profil tetap finite dan mematuhi `maxSteps`.
- [ ] Setiap run mempunyai ID serta ringkasan hasil.
- [ ] ACK terlambat dicatat tanpa mengirim ulang pesan.
- [ ] Automated test mencakup preflight, profil, laporan, dan timeout.
- [ ] Uji nyata dijalankan hanya secara manual dengan dua akun milik sendiri.

## Tahap 5 — Hardening dan observability

**Status:** direncanakan.

- Health snapshot per session.
- Rotasi dan retensi log.
- Klasifikasi error terminal dan sementara.
- Pemeriksaan permission auth directory.
- Uji reconnect dan graceful shutdown yang lebih lengkap.
- Dokumentasi troubleshooting berdasarkan reason code.

## Tahap 6 — Uji operasional terbatas

**Status:** direncanakan.

- Jalankan hanya dengan dua akun pengujian milik sendiri.
- Mulai setiap run secara manual.
- Jangan menjalankan dua process pada auth directory yang sama.
- Tinjau hasil delivery dan disconnect setelah setiap run.
- Hentikan pengujian saat ada logout atau pembatasan akun.

## 9. Urutan pengerjaan

```text
Tahap 1 -> Tahap 2 -> Tahap 3 -> Tahap 4 -> Tahap 5 -> Tahap 6
 fondasi   session    simulator   stabilitas  hardening  uji terbatas
```

Tahap 4 hanya boleh diuji nyata setelah kedua session sehat. Log terakhir menunjukkan Admin 2 mengalami `401 loggedOut`, sehingga pairing ulang Admin 2 dan tes delivery dua arah merupakan prasyarat.

## 10. Risiko utama

| Risiko | Mitigasi |
|---|---|
| Auth state tidak sinkron | Pairing ulang manual dan pisahkan direktori session |
| Dua process memakai session sama | Jalankan satu process saja per auth directory |
| ACK terlambat | Catat sebagai unconfirmed tanpa resend otomatis |
| Salah satu session logout | Hentikan skenario dan pertahankan log diagnosis |
| Percakapan tidak berhenti | Array finite dan `MAX_CONVERSATION_STEPS` |
| Data sensitif masuk log | Redaksi QR, credential, JID, dan nomor |
| Perubahan Baileys | Pin versi dan uji sebelum upgrade |

# BUG

## BUG-001 — Uji pengiriman dua arah hanya berhasil pada satu arah

**Tanggal ditemukan:** 3 September 2026  
**Tahap terkait:** Tahap 2 — Sistem koneksi multi-session  
**Status:** perbaikan kode selesai; verifikasi akhir menunggu pairing ulang Admin 1

### Gejala

`npm run test:manual-send` seharusnya mengirim satu pesan pada setiap arah, tetapi hanya satu arah yang memperoleh `DELIVERY_ACK`.

```text
Admin 1 -> Admin 2
Admin 2 -> Admin 1
```

Terminal menampilkan:

```text
Failed to decrypt message with any known session
Bad MAC
```

### Akar masalah

Auth state Signal/LID Admin 1 tidak sinkron atau menyimpan key percakapan basi. Pesan dapat memperoleh message ID tanpa pernah terkonfirmasi pada perangkat penerima.

### Perbaikan yang diterapkan

1. Baileys dinaikkan dari `6.7.24` ke `7.0.0-rc14`.
2. Penerima diverifikasi melalui `onWhatsApp()` sebelum pengiriman.
3. Session Manager menolak dua session dengan akun yang sama.
4. Tes manual hanya berhasil jika kedua arah memperoleh `DELIVERY_ACK`.
5. Auth bermasalah diarsipkan lokal dan tidak boleh dibagikan.

### Verifikasi akhir

Jalankan `npm run test:manual-send` setelah pairing ulang. Jangan menjalankannya bersamaan dengan `npm start`.

## BUG-002 — Session Admin 2 logout saat langkah kedua simulator

**Tanggal ditemukan:** 3 September 2026  
**Tahap terkait:** Tahap 3 — Conversation simulator  
**Status:** auth lama diarsipkan; menunggu pairing ulang Admin 2

### Hasil uji nyata

```text
Langkah 1: Admin 1 -> Admin 2 = DELIVERY_ACK
Jeda menuju langkah 2: 65000 ms = selesai
Langkah 2: Admin 2 -> Admin 1 = DELIVERY_ACK
Session Admin 2: 401 loggedOut
Langkah 3 dan seterusnya: tidak dijalankan
```

Runner menghentikan langkah tersisa dan menutup socket melalui graceful shutdown. Pairing ulang Admin 2 diperlukan sebelum pengujian penuh dilanjutkan.

## BUG-003 — Device/session fingerprint memicu disconnect fatal (status 405) di semua percobaan reconnect

**Tanggal ditemukan:** 5 September 2026  
**Tahap terkait:** Integrasi baileys-antiban §7.1 — `DEVICE_FINGERPRINT_ENABLED` / `SESSION_FINGERPRINT_ENABLED`  
**Status:** perbaikan kode selesai; sudah diverifikasi lewat automated test terhadap implementasi asli baileys-antiban

### Gejala

Begitu `DEVICE_FINGERPRINT_ENABLED=true` atau `SESSION_FINGERPRINT_ENABLED=true` diaktifkan, kedua session langsung terputus fatal beberapa detik setelah socket dibuat:

```text
session.connection.closed statusCode=405 disconnectCategory=fatal
```

Reconnect otomatis mencoba ulang sesuai `RECONNECT_LIMIT` dengan pola identik setiap kali (fingerprint baru dibuat lagi tiap percobaan, tapi tetap ditolak), sampai akhirnya `session.reconnect.exhausted` dan seluruh percakapan gagal (`SessionNotReadyError`). Tanpa kedua fitur ini, koneksi berhasil normal.

### Akar masalah

`applyFingerprint()` dan `applySessionFingerprint()` dari `baileys-antiban` sama-sama menimpa `socketConfig.version` dengan `fp.appVersion` — nilai dari pool bawaan seperti `[2, 24, 5, 18]`. Nilai ini adalah versi aplikasi WhatsApp mobile bergaya lama, BUKAN versi protokol WhatsApp multi-device yang sebenarnya dipakai Baileys untuk field `version` (skema `[2, 3000, buildNumber]`, mis. `[2, 3000, 1043857760]` pada `@whiskeysockets/baileys@7.0.0-rc14` yang dipin proyek ini). Karena `makeWASocket()` menggabungkan default itu dengan config yang di-pass memakai spread (`{...DEFAULT_CONNECTION_CONFIG, ...config}`), field `version` yang salah ini menimpa default yang benar, dan WhatsApp langsung menolak koneksi secara fatal (`statusCode 405`) — bukan masalah jaringan atau kredensial, sehingga reconnect otomatis tidak pernah membantu.

### Perbaikan yang diterapkan

1. `#connect()` di `whatsapp-session.js` sekarang menghapus (`delete socketConfig.version`) segera setelah `applyFingerprint()`/`applySessionFingerprint()` dipanggil, pada kedua jalur (device fingerprint dan session fingerprint).
2. Tuple `browser` dari fingerprint tetap dipakai — itu kosmetik (nama linked device yang tampil di WhatsApp), bukan bagian negosiasi protokol, jadi aman untuk dirandomisasi.
3. Baileys jadi memakai versi protokolnya sendiri yang benar (bawaan versi `@whiskeysockets/baileys` yang dipin proyek ini), bukan pool versi basi dari `baileys-antiban`.
4. Dua automated test baru sengaja TIDAK meng-override `generateFingerprint`/`applyFingerprint`/`generateSessionFingerprint`/`applySessionFingerprint`, supaya diuji langsung terhadap implementasi asli `baileys-antiban`, bukan cuma fake di test.

### Catatan risiko jangka panjang

Perbaikan ini membuang override yang salah, tapi proyek masih bergantung pada versi protokol bawaan `@whiskeysockets/baileys@7.0.0-rc14` yang dipin. Versi protokol WA bisa berubah dari waktu ke waktu; kalau versi yang dipin itu sendiri kedaluwarsa, gejala yang sama (disconnect fatal) bisa muncul lagi meski fingerprint dimatikan. Opsi mitigasi yang belum diimplementasikan: memanggil `fetchLatestBaileysVersion()` secara dinamis setiap connect, dengan fallback ke versi bawaan kalau fetch gagal.

### Verifikasi akhir

`npm test` — semua test lulus, termasuk dua test baru yang memverifikasi langsung terhadap implementasi asli `baileys-antiban` (bukan fake), memastikan `socketConfig.version` tidak pernah terkirim ke `makeWASocket()` saat fingerprint aktif. Verifikasi nyata di WhatsApp (reconnect tidak lagi terjadi setelah fitur diaktifkan) menunggu run ulang oleh pengguna.

## BUG-004 — HumanEntropyService menjatuhkan seluruh proses saat `connection.update` jadi `open`

**Tanggal ditemukan:** 5 September 2026  
**Tahap terkait:** Integrasi baileys-antiban §7.1 — `HUMAN_ENTROPY_ENABLED`  
**Status:** selesai — crash diperbaiki (fail-safe) DAN fitur intinya diganti dengan implementasi sendiri yang benar-benar berjalan (Opsi B, dipilih pengguna)

### Gejala

Begitu `HUMAN_ENTROPY_ENABLED=true`, aplikasi crash total (proses Node keluar, bukan sekadar session logging error) tepat setelah kedua session `ready`:

```text
TypeError: this.wasp.on is not a function
    at new HumanEntropyService (.../baileys-antiban/dist/humanEntropy.js:58:19)
    at #startHumanEntropy (whatsapp-session.js:684:51)
    at #onConnectionUpdate (whatsapp-session.js:339:30)
```

Tidak ada graceful shutdown sama sekali — kedua session mati mendadak di tengah proses, beda dengan BUG-001/002/003 yang setidaknya sempat mencatat log dan mencoba reconnect.

### Akar masalah

Tiga bug independen ditemukan dalam integrasi `HumanEntropyService` yang sudah ada sejak sebelum sesi perbaikan ini, dan baru ketahuan sekarang karena modul ini sebelumnya tidak pernah benar-benar diuji end-to-end (tidak ada satu pun automated test untuk `HUMAN_ENTROPY_ENABLED` sebelum ini):

1. **Salah asumsi API constructor.** `HumanEntropyService` milik `baileys-antiban` didesain untuk framework multi-session terpisah bernama "WaSP" (lihat komentar sumbernya: "Works ONLY with WaSP's public API"). Constructornya adalah `(wasp, sessionId, config)`, di mana `wasp` harus berupa objek dengan method `.on(eventName, handler)` (event bus global) dan `.getProvider(sessionId)` (mengembalikan `{ socket }`). Kode proyek ini memanggilnya sebagai `new HumanEntropyService(socket, entropyOptions)` — meneruskan socket Baileys mentah sebagai `wasp` (tidak punya `.on()`) dan config sebagai `sessionId`. Constructor asli langsung memanggil `this.wasp.on(...)` sehingga langsung melempar TypeError.
2. **Method yang dipanggil tidak pernah ada.** `#onMessagesUpsert` di `whatsapp-session.js` memanggil `this.#humanEntropy?.addRecentContact(remoteJid, message.key)` pada setiap pesan masuk. `HumanEntropyService` yang asli TIDAK punya method publik `addRecentContact` sama sekali — daftar kontak barunya (`recentContacts`) sepenuhnya privat dan hanya terisi lewat event `'MESSAGE_RECEIVED'` dari `wasp`. Baris ini akan melempar `TypeError: ... addRecentContact is not a function` pada pesan masuk pertama, seandainya constructor di atas tidak lebih dulu gagal.
3. **`#humanEntropyFactory` salah ditempatkan.** Assignment-nya berada di dalam blok `if (sessionHealth.enabled !== false)`, padahal secara logika tidak berhubungan dengan `SESSION_HEALTH_ENABLED` sama sekali. Kalau `SESSION_HEALTH_ENABLED=false` sementara `HUMAN_ENTROPY_ENABLED=true`, `#humanEntropyFactory` tidak pernah ter-assign dan `#startHumanEntropy()` crash memanggil `undefined()`.

Kesimpulannya: seluruh integrasi `HumanEntropyService` sebelumnya dibangun berdasarkan asumsi bentuk API yang salah, bukan hasil membaca source code aslinya.

### Perbaikan yang diterapkan (fail-safe, BUKAN membuat fitur ini fungsional)

1. `#startHumanEntropy()` sekarang membungkus pembuatan dan `start()` instance entropy dalam `try/catch` — kegagalan apa pun dicatat sebagai `session.human-entropy.start-failed` dan sesi tetap lanjut `ready`, tidak lagi menjatuhkan proses.
2. Pemanggilan `addRecentContact` diubah jadi optional call (`?.addRecentContact?.(...)`) dan dibungkus `try/catch` sendiri, supaya instance apa pun yang tidak punya method itu tidak crash saat pesan masuk.
3. `#humanEntropyFactory` dipindah keluar dari blok `sessionHealth`, jadi selalu ter-assign terlepas dari `SESSION_HEALTH_ENABLED`.
4. Tiga automated test regresi baru meniru persis ketiga kegagalan di atas (termasuk pesan error `TypeError` yang sama) dan memverifikasi session tetap `ready` serta tidak ada exception yang lolos ke pemanggil.

Setelah temuan di atas, pengguna diberi pilihan (Opsi A: bangun adaptor "WaSP" minimal supaya tetap memakai kelas `HumanEntropyService` asli; Opsi B: ganti dengan implementasi sendiri yang tidak bergantung pada framework asing) dan memilih **Opsi B**.

### Perbaikan lanjutan — implementasi sendiri (`src/sessions/human-entropy.js`)

5. `createHumanEntropyService(socket, options)` ditulis dari nol, meniru perilaku `HumanEntropyService` asli (typing/read-receipt/presence-toggle acak dengan probabilitas tetap 30%/20%/15%, ke kontak yang sudah membalas duluan) tapi bekerja langsung terhadap socket Baileys biasa — tidak butuh `wasp`, tidak butuh event bus eksternal.
6. Selama menulis ulang ini, ditemukan satu bug tambahan yang tidak ada di versi lama (karena versi lama tidak pernah sampai berjalan): timer `setTimeout` mentah untuk jeda antar-siklus maupun jeda di tengah aksi (mis. menunggu sebelum mengirim `paused` setelah `composing`) tidak ikut dibatalkan oleh `stop()`, sehingga aksi yang sedang berjalan tetap menyelesaikan `sendPresenceUpdate()`-nya beberapa detik SETELAH session berhenti — berisiko memanggil socket yang sudah ditutup, dan terbukti membuat proses test tidak keluar tepat waktu (durasi test suite melonjak dari ~2 detik ke 68 detik saat bug ini masih ada). Diperbaiki dengan memakai `sleep()` yang sudah ada di `utils/sleep.js` (dukungan `AbortSignal`, pola yang sama dipakai `#startPresenceRamp`), diikat ke satu `AbortController` per siklus hidup `start()`/`stop()` — `stop()` sekarang membatalkan jeda yang SEDANG berjalan, bukan cuma jadwal siklus berikutnya.
7. `whatsapp-session.js` diarahkan memakai `createHumanEntropyService` sebagai factory default (`HumanEntropyService` dari `baileys-antiban` tidak lagi diimpor sama sekali), dan `#startHumanEntropy()` meneruskan `logger` ke factory supaya aktivitas siklus (typing/read-receipt/presence-toggle) tercatat di log seperti fitur lain.
8. Test baru: `test/human-entropy.test.js` (6 test unit terhadap modul baru — nonaktif secara default, pelacakan kontak dan batasnya, siklus dengan probabilitas 1 menjalankan ketiga aksi, probabilitas 0 tidak melakukan apa-apa, `stop()` membatalkan siklus yang belum berjalan, aksi yang gagal tidak melempar error) dan satu test integrasi baru di `whatsapp-session.test.js` yang SENGAJA tidak meng-override `humanEntropyFactory` sama sekali, memverifikasi wiring produksi (`createHumanEntropyService` asli, lewat `WhatsAppSession`) benar-benar mengirim aktivitas presence dalam siklus cepat.

### Verifikasi akhir

`npm test` — 75/75 test lulus. Tiga test regresi awal terbukti gagal ketika perbaikan fail-safe dihapus sementara (constructor mismatch, method hilang, factory salah tempat semuanya memicu failure seperti di real-world run), dan lulus lagi dengan perbaikan terpasang. Modul `human-entropy.js` yang baru diuji baik secara unit (probabilitas, pelacakan kontak, pembatalan) maupun terintegrasi lewat `WhatsAppSession` tanpa mock apa pun pada factory-nya. Verifikasi nyata di WhatsApp (siklus idle benar-benar terlihat di log setelah `HUMAN_ENTROPY_ENABLED=true`) menunggu run ulang oleh pengguna.
