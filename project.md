# Spesifikasi Proyek

## 1. Identitas

**Nama kerja:** WhatsApp Two-Account Conversation Simulator

**Platform:** Node.js 20+ / JavaScript ES Modules

**Library koneksi:** `@whiskeysockets/baileys`
**Tahap saat ini:** Tahap 3 selesai pada level kode; Tahap 4 dirancang ulang untuk stabilitas simulator dua akun

**Integrasi tambahan:** subset defensif `baileys-antiban` 4.10.0 diterapkan
tanpa menjalankan Tahap 4.

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
- pengujian otomatis tanpa koneksi WhatsApp nyata.

### Tidak termasuk

- bot inbound pelanggan;
- trigger `JOIN` atau tautan Community;
- broadcast, cold messaging, atau daftar penerima;
- percakapan tanpa batas;
- auto-reply yang saling memicu;
- auto-join atau penambahan pengguna ke group/Community;
- penyamaran otomatisasi sebagai manusia;
- upaya melewati limit atau sistem anti-abuse;
- fingerprint acak, typo buatan, presence palsu, proxy rotation, dan mekanisme
  lain untuk menyamarkan otomasi;
- jaminan akun tidak akan dibatasi.

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

## 7.1 Integrasi stabilitas tambahan

Paket `baileys-antiban` dikunci pada versi `4.10.0`. Hanya
`SessionHealthMonitor` dan `classifyDisconnect` yang digunakan:

- event pesan dipantau untuk mendeteksi indikasi kegagalan dekripsi;
- session masuk state `degraded` ketika ambang tercapai sehingga pengiriman
  berikutnya ditolak;
- disconnect dicatat menurut kategori dan rekomendasi backoff dipakai sebagai
  jeda minimum reconnect;
- statistik kesehatan ikut tersedia dalam snapshot session.

Wrapper anti-ban umum dan fitur human-like tidak digunakan. Integrasi ini tidak
menjamin akun bebas pembatasan dan tidak boleh dianggap sebagai mekanisme untuk
melewati sistem anti-abuse WhatsApp.

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
