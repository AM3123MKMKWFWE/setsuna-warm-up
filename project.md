# Spesifikasi Proyek

## 1. Identitas

**Nama kerja:** WhatsApp Multi-Session Warm-Up & Inbound Bot

**Platform:** Node.js 20+ / JavaScript ES Modules

**Library koneksi:** `@whiskeysockets/baileys`

**Tahap saat ini:** kode Tahap 3 selesai — validasi simulator end-to-end dengan dua akun nyata masih diperlukan

## 2. Latar belakang

Proyek ini menyatukan dua kebutuhan pengujian WhatsApp berbasis dua akun milik sendiri:

- menjalankan percakapan dua arah yang terkontrol untuk QA dan verifikasi koneksi; serta
- menjalankan dua akun admin penerima pesan inbound yang dapat membalas trigger dengan tautan undangan Community.

Kedua kebutuhan menggunakan fondasi yang sama: multi-session Baileys, penyimpanan auth terpisah, pengelolaan lifecycle koneksi, validasi event, logging, dan perlindungan dari loop atau pemrosesan ganda.

## 3. Tujuan

### 3.1 Tujuan fungsional

1. Membuat dan menjalankan dua session WhatsApp secara independen.
2. Menunggu status kedua session siap sebelum simulator dijalankan.
3. Menjalankan skenario percakapan berurutan dengan delay dan batas langkah.
4. Menerima pesan masuk pada masing-masing session admin.
5. Memvalidasi trigger dan mengirim satu balasan berisi tautan undangan.
6. Mencegah message ID yang sama diproses lebih dari sekali.
7. Mengantrekan pengiriman untuk mencegah tabrakan saat beberapa pesan tiba bersamaan.
8. Melakukan reconnect terbatas untuk gangguan sementara.
9. Menghentikan session yang logout/auth invalid dan meminta pairing ulang manual.
10. Menyediakan log dan status kesehatan per session.

### 3.2 Tujuan nonfungsional

- **Keandalan:** gangguan Admin 1 tidak menjatuhkan Admin 2 dan sebaliknya.
- **Keamanan:** credential dan konfigurasi sensitif tidak disimpan di repository.
- **Auditabilitas:** setiap koneksi, pesan yang diproses, skip, retry, dan error memiliki log yang relevan.
- **Maintainability:** session, simulator, inbound handler, queue, dan konfigurasi dipisahkan ke modul berbeda.
- **Privasi:** log menyimpan data sesedikit mungkin dan dapat melakukan masking nomor.
- **Keselamatan operasional:** tidak ada infinite conversation, retry tanpa batas, broadcast, atau unsolicited message.

## 4. Ruang lingkup

### 4.1 Termasuk

- dua session Baileys;
- pairing dan penyimpanan multi-file auth state;
- simulator percakapan finite antara dua akun pengujian;
- listener pesan inbound;
- validasi trigger;
- balasan tautan undangan Community;
- deduplication berbasis message ID;
- queue dan delay pengiriman;
- reconnect handler terbatas;
- logging per session;
- konfigurasi environment;
- unit test untuk logika yang tidak membutuhkan koneksi WhatsApp.

### 4.2 Tidak termasuk

- broadcast atau cold messaging;
- scraping atau impor daftar nomor;
- auto-join/penambahan paksa ke Community;
- mekanisme untuk menyamarkan bot sebagai manusia;
- upaya menghindari deteksi, limit, atau sistem anti-abuse;
- jaminan bahwa akun tidak akan dibatasi;
- dashboard web, database produksi, atau deployment cloud pada versi awal;
- pengelolaan nomor owner Community melalui Baileys.

## 5. Aktor dan komponen

| Aktor/komponen | Tanggung jawab |
|---|---|
| Owner Community | Memiliki dan mengelola Community; tidak dipakai sebagai session bot |
| Admin 1 | Menerima inbound chat dan/atau berpartisipasi dalam simulator |
| Admin 2 | Menerima inbound chat dan/atau berpartisipasi dalam simulator |
| Pelanggan opt-in | Memulai chat dan memilih sendiri apakah akan membuka tautan undangan |
| Session Manager | Membuat socket, menyimpan credential, memantau status, dan reconnect |
| Conversation Runner | Menjalankan skenario finite secara berurutan |
| Inbound Handler | Memvalidasi dan memproses pesan masuk |
| Dedup Store | Mencegah message ID diproses ulang |
| Send Queue | Mengurutkan pekerjaan pengiriman dan menerapkan delay |
| Logger | Merekam lifecycle dan hasil pemrosesan per session |

## 6. Arsitektur target

```text
                         src/app.js
                             |
                       Session Manager
                        /           \
                       v             v
                Socket Admin 1   Socket Admin 2
                       |             |
                       v             v
                Auth Admin 1     Auth Admin 2
                       \             /
                        +-----+-----+
                              |
                 +------------+------------+
                 |                         |
                 v                         v
        Conversation Runner          Inbound Handler
                 |                         |
          Scenario + maxSteps      Validator -> Dedup
                                           |
                                           v
                                     Send Queue
                                           |
                                           v
                                    Invite Response
```

### 6.1 Prinsip isolasi session

- Admin 1 menggunakan `sessions/admin-1`.
- Admin 2 menggunakan `sessions/admin-2`.
- Tidak ada file credential yang digunakan bersama.
- Setiap session memiliki state, log context, reconnect counter, dan queue sendiri.
- Error ditangani pada batas session agar tidak menjadi unhandled rejection pada process utama.

## 7. Rencana struktur kode

```text
src/
|-- app.js                        # bootstrap dan graceful shutdown
|-- config.js                     # parsing serta validasi environment
|-- sessions/
|   |-- create-session.js         # konstruksi socket Baileys
|   `-- session-manager.js        # lifecycle dua session
|-- conversation/
|   |-- runner.js                 # finite scenario executor
|   `-- scenarios.js              # daftar skenario pengujian
|-- inbound/
|   |-- handler.js                # orchestration pesan masuk
|   |-- validator.js              # filter event dan trigger
|   |-- dedup-store.js            # penyimpanan message ID
|   `-- queue.js                  # antrean per admin
|-- recovery/
|   |-- sqlite-store.js           # checkpoint dan pemulihan
|   `-- migrations.js             # schema database cadangan
`-- utils/
    |-- logger.js
    `-- sleep.js

data/
`-- recovery.sqlite               # dibuat saat runtime, tidak di-commit
```

## 8. Mode aplikasi

### 8.1 Mode `conversation`

Digunakan untuk QA dengan dua akun sendiri. Input adalah array langkah:

```javascript
[
  { sender: "admin-1", text: "Halo", delayMs: 3000 },
  { sender: "admin-2", text: "Halo juga", delayMs: 5000 }
]
```

Aturan:

- hanya sender yang terdaftar boleh digunakan;
- target ditentukan dari pasangan sender;
- `text` tidak boleh kosong dan memiliki batas panjang;
- delay memiliki nilai minimum dan maksimum;
- jumlah eksekusi dibatasi `MAX_CONVERSATION_STEPS`;
- runner selesai saat array habis, batas tercapai, session putus, atau proses dibatalkan;
- event pesan masuk tidak boleh memicu balasan simulator berikutnya.

### 8.2 Mode `inbound`

Digunakan untuk membalas pengguna yang lebih dahulu menghubungi admin.

Urutan proses:

1. terima event `messages.upsert`;
2. ambil pesan baru yang relevan;
3. abaikan status, group yang tidak diizinkan, `fromMe`, event lama, dan payload kosong;
4. normalisasi isi teks;
5. cocokkan trigger;
6. periksa message ID pada dedup store;
7. masukkan pekerjaan ke queue session terkait;
8. kirim satu balasan berisi tautan undangan;
9. catat hasil tanpa mengekspos data sensitif.

## 9. Validasi inbound

Pesan hanya diproses jika seluruh kondisi berikut terpenuhi:

- event merupakan pesan baru;
- memiliki message key dan remote JID yang valid;
- bukan pesan yang dikirim akun sendiri;
- bukan status broadcast;
- bukan event historis akibat sinkronisasi/reconnect;
- tipe pesan didukung dan teks berhasil diekstrak;
- trigger sesuai aturan konfigurasi;
- message ID belum pernah diselesaikan atau sedang diproses;
- session pengirim berstatus siap;
- queue belum melampaui kapasitas.

Jika salah satu syarat gagal, event dilewati dengan reason code pada log.

## 10. Deduplication dan idempotensi

Penyimpanan utama saat aplikasi berjalan menggunakan in-memory store dengan TTL. SQLite digunakan sebagai lapisan cadangan untuk memulihkan data deduplication setelah restart, bukan sebagai ketergantungan utama seluruh aplikasi.

Kunci minimum yang disarankan:

```text
sessionName + remoteJid + messageId
```

State pekerjaan:

```text
received -> queued -> processing -> completed
                              \-> failed
```

Message ID berstatus `queued`, `processing`, atau `completed` tidak boleh dimasukkan ulang. Retry kegagalan hanya dilakukan jika error dinilai sementara dan jumlah percobaan belum mencapai batas.

### 10.1 Database sebagai cadangan

Database bersifat opsional dan digunakan khusus untuk persistence serta recovery. Pilihan awal adalah SQLite karena berjalan lokal, tidak memerlukan service database terpisah, dan cukup untuk dua session admin.

```text
Runtime utama
    ↓
In-memory dedup + queue
    ↓ write-through/checkpoint
SQLite cadangan
    ↓ saat restart
Recovery dedup + pekerjaan yang belum selesai
```

Data minimum yang dapat disimpan:

- identitas message yang sudah atau sedang diproses;
- status pekerjaan queue;
- jumlah percobaan dan waktu pemrosesan;
- status kesehatan session untuk keperluan pemulihan.

Database tidak boleh menyimpan auth state Baileys, QR, pairing code, isi lengkap pesan, atau credential. File session tetap berada di `sessions/admin-1` dan `sessions/admin-2`.

Jika SQLite tidak tersedia saat startup, aplikasi masih dapat menjalankan simulator. Untuk mode inbound, aplikasi harus menampilkan status recovery tidak tersedia dan menggunakan kebijakan fail closed terhadap event lama yang belum dapat diverifikasi. Kegagalan menulis checkpoint tidak boleh disembunyikan dan harus masuk health status serta log.

## 11. Queue dan pembatasan

Queue dibuat per session agar beban satu admin tidak memblokir admin lainnya.

Konfigurasi minimum:

- concurrency per session;
- delay antar-pengiriman;
- ukuran queue maksimum;
- timeout pekerjaan;
- retry maksimum dengan backoff terbatas;
- dead-letter/error log untuk pekerjaan yang gagal permanen.

Jika queue penuh, sistem tidak boleh terus menambah pekerjaan tanpa batas. Event dicatat dan diarahkan untuk pemeriksaan operasional.

## 12. Lifecycle koneksi

State internal yang diharapkan:

```text
initializing -> pairing/connecting -> ready
                    ^                 |
                    |                 v
                 reconnecting <- disconnected
                                      |
                                      v
                              logged-out/stopped
```

Aturan reconnect:

- reconnect hanya untuk gangguan sementara;
- gunakan backoff dan batas percobaan;
- hanya satu reconnect aktif per session;
- jangan menghapus auth state untuk disconnect biasa;
- status logged out/auth invalid menghentikan session;
- pairing ulang dilakukan secara manual;
- process dapat tetap hidup selama session lain sehat.

## 13. Logging dan observability

Log minimum:

- waktu;
- level;
- nama session;
- event koneksi;
- message ID yang di-hash atau dipotong bila memungkinkan;
- hasil validasi atau reason code skip;
- status queue;
- hasil pengiriman;
- retry count dan ringkasan error.

Data yang tidak boleh dicatat:

- credential/auth key;
- QR atau pairing code;
- isi lengkap `.env`;
- tautan undangan pada log publik;
- isi pesan dan nomor lengkap jika tidak diperlukan.

## 14. Konfigurasi

Rancangan environment variable:

| Variabel | Wajib | Keterangan |
|---|---:|---|
| `APP_MODE` | Ya | `conversation` atau `inbound` |
| `ADMIN_1_AUTH_DIR` | Ya | Folder auth Admin 1 |
| `ADMIN_2_AUTH_DIR` | Ya | Folder auth Admin 2 |
| `COMMUNITY_INVITE_URL` | Mode inbound | Tautan undangan yang tervalidasi |
| `INBOUND_TRIGGER` | Mode inbound | Kata/frasa pemicu |
| `MAX_CONVERSATION_STEPS` | Mode conversation | Batas keras langkah |
| `MESSAGE_DELAY_MS` | Tidak | Jeda antarpesan; default 65000 ms agar label menit berbeda |
| `QUEUE_MAX_SIZE` | Tidak | Kapasitas queue per session |
| `SEND_RETRY_LIMIT` | Tidak | Batas retry pengiriman |
| `RECONNECT_LIMIT` | Tidak | Batas reconnect |
| `RECOVERY_DB_ENABLED` | Tidak | Mengaktifkan checkpoint SQLite |
| `RECOVERY_DB_PATH` | Jika diaktifkan | Lokasi file SQLite cadangan |
| `RECOVERY_RETENTION_DAYS` | Tidak | Masa retensi record recovery |
| `LOG_LEVEL` | Tidak | Level logging |

Semua nilai perlu divalidasi saat startup. Aplikasi gagal lebih awal dengan pesan aman jika konfigurasi wajib tidak valid.

## 15. Penanganan error

| Kondisi | Respons sistem |
|---|---|
| Satu session disconnect sementara | Pause queue session tersebut dan reconnect terbatas |
| Session logged out | Stop session dan minta pairing ulang manual |
| Pengiriman timeout | Retry terbatas bila aman |
| Payload tidak valid | Skip dengan reason code |
| Message ID duplikat | Skip tanpa mengirim ulang |
| Queue penuh | Tolak pekerjaan baru, log alert, dan lakukan review |
| Skenario melebihi maxSteps | Stop runner secara normal |
| Unhandled error pada handler | Tangkap pada batas event dan pertahankan process bila aman |
| Shutdown process | Stop intake, selesaikan/batalkan queue, lalu tutup socket |

## 16. Strategi pengujian

### 16.1 Unit test

- normalisasi nomor menjadi JID;
- ekstraksi teks dari tipe pesan yang didukung;
- filter `fromMe`, status, event lama, dan payload kosong;
- pencocokan trigger;
- transisi state dedup;
- batas queue dan retry;
- validasi scenario dan `maxSteps`;
- keputusan reconnect berdasarkan alasan disconnect.

### 16.2 Integration test lokal

- auth state Admin 1 dan Admin 2 tidak saling menimpa;
- kedua session dapat mencapai state `ready`;
- Admin 1 dapat mengirim ke Admin 2 dan sebaliknya;
- simulator berhenti sesuai jumlah langkah;
- inbound valid menghasilkan tepat satu balasan;
- pengulangan event yang sama tidak menghasilkan balasan kedua;
- disconnect satu session tidak mematikan session lain;
- restart dengan SQLite cadangan tidak memproses ulang pesan selesai;
- pekerjaan queue yang belum selesai dipulihkan ke state yang aman;
- simulator tetap dapat berjalan ketika database dinonaktifkan.

### 16.3 Uji operasional

- mulai dari akun sendiri dan volume sangat rendah;
- pantau error, duplicate rate, queue depth, dan disconnect;
- hentikan otomasi jika ada perilaku tidak sesuai, komplain, atau pembatasan akun;
- peningkatan trafik hanya dilakukan setelah hasil tahap sebelumnya stabil.

## 17. Kriteria penerimaan versi awal

Versi awal dianggap selesai jika:

- [ ] project Node.js dapat di-install dan dijalankan dari dokumentasi;
- [ ] credential kedua admin tersimpan di folder berbeda dan diabaikan Git;
- [ ] kedua session dapat terhubung serta melaporkan status independen;
- [ ] simulator menjalankan skenario finite dan selalu berhenti;
- [ ] inbound handler hanya merespons pesan opt-in yang valid;
- [ ] event duplikat tidak menghasilkan balasan ganda;
- [ ] queue memiliki kapasitas, delay, timeout, dan retry terbatas;
- [ ] disconnect sementara dan logged out ditangani berbeda;
- [ ] log per session tersedia tanpa membocorkan credential;
- [ ] unit test utama lulus;
- [ ] graceful shutdown tidak meninggalkan pekerjaan baru yang diterima diam-diam;
- [ ] README sesuai dengan perilaku aplikasi yang sebenarnya.

## 18. Roadmap

### Fase 0 — Fondasi dokumentasi

- finalisasi ruang lingkup;
- tetapkan kebijakan opt-in dan data retention;
- buat README serta spesifikasi proyek.

### Fase 1 — Bootstrap

- inisialisasi package Node.js;
- tambahkan lint/test script;
- buat konfigurasi dan `.gitignore`;
- buat logger serta utilitas dasar.

### Fase 2 — Session tunggal

- implementasikan create session;
- pairing Admin 1;
- uji credential persistence dan reconnect.

### Fase 3 — Multi-session

- tambahkan Admin 2;
- isolasi lifecycle dan log;
- uji kegagalan salah satu socket.

### Fase 4 — Simulator

- implementasikan schema scenario;
- wait-until-ready;
- runner, delay, cancellation, dan `maxSteps`;
- uji kirim dua arah dengan akun sendiri.

### Fase 5 — Inbound bot

- implementasikan event validator;
- trigger matcher;
- dedup store;
- queue dan invite response.

### Fase 6 — Hardening

- retry/reconnect policy;
- dedup persisten;
- graceful shutdown;
- masking log dan retensi data;
- health status serta dokumentasi troubleshooting.

### Fase 7 — Uji terbatas

- jalankan dengan trafik opt-in rendah;
- evaluasi log dan stabilitas;
- lakukan review manual sebelum peningkatan penggunaan.

## 19. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Perubahan protokol/API Baileys | Aplikasi gagal terhubung | Pin versi, uji upgrade, dan siapkan rollback dependency |
| Pembatasan akun WhatsApp | Session tidak dapat digunakan | Pola opt-in, volume wajar, manual review, dan pisahkan owner |
| Auth state bocor | Pengambilalihan session | `.gitignore`, permission lokal, backup terenkripsi bila diperlukan |
| Event replay setelah reconnect | Balasan ganda | Dedup persisten dan validasi timestamp/event type |
| Infinite loop | Pesan berulang dan risiko akun | Finite runner, maxSteps, abaikan `fromMe` |
| Queue tidak terbatas | Memory exhaustion | Kapasitas, backpressure, timeout, dan alert |
| SQLite cadangan rusak/tidak tersedia | State recovery tidak dapat diverifikasi | Health status degraded, backup file, migration, integrity check, dan fail closed untuk event lama |
| Server lokal/offline | Bot berhenti merespons | Health check, log, SOP restart, dan jalur manual |
| Log memuat data pribadi | Risiko privasi | Masking, minimisasi, access control, dan retensi terbatas |

## 20. Keputusan desain

1. **Owner dipisahkan dari bot.** Kepemilikan Community tidak bergantung pada session otomatisasi.
2. **Inbound-only untuk pelanggan.** Pengguna memulai chat dan memilih sendiri untuk bergabung.
3. **Dua auth directory.** Tidak ada credential lintas session.
4. **Queue per session.** Gangguan atau beban satu admin tidak memblokir lainnya.
5. **Finite conversation.** Simulator berbasis daftar langkah, bukan auto-reply timbal balik.
6. **Manual re-pairing.** Auth invalid tidak memicu loop pairing otomatis.
7. **Fail closed.** Jika konfigurasi, validasi, atau state meragukan, pesan tidak dikirim.
8. **Database sebagai cadangan.** Runtime memakai state in-memory; SQLite hanya menyimpan checkpoint untuk recovery deduplication dan queue setelah restart.

## 21. Referensi internal

- `../baileys_two_account_conversation_blueprint.md`
- `../Alur WA admin - Baileys.txt`

Referensi eksternal dan versi dependency perlu diverifikasi kembali ketika tahap implementasi dimulai.

# IMPLEMENTASI

Implementasi proyek dibagi menjadi enam tahap utama. Setiap tahap memiliki sub-tahap dan target kelulusan yang harus dipenuhi sebelum melanjutkan ke tahap berikutnya.

## Tahap 1 — Perencanaan dan fondasi proyek

Tahap ini menyiapkan keputusan operasional, struktur aplikasi, konfigurasi, dan utilitas yang digunakan oleh seluruh modul.

**Status:** selesai diimplementasikan tanpa database. Syntax check, startup, dan automated test telah dijalankan dengan sukses.

### 1.1 Menentukan kebutuhan operasional

- Menentukan nomor Admin 1 dan Admin 2.
- Memisahkan nomor owner Community dari akun yang terhubung ke Baileys.
- Menentukan mode `conversation` dan `inbound`.
- Menentukan trigger inbound, format balasan, dan tautan Community.
- Menentukan batas delay, queue, timeout, retry, reconnect, dan jumlah langkah percakapan.
- Menentukan kebijakan penyimpanan log serta data pengguna.

### 1.2 Membuat fondasi Node.js

- Menginisialisasi `package.json`.
- Mengaktifkan JavaScript ES Modules.
- Menginstal dependency yang dibutuhkan.
- Membuat script `start` dan `test`.
- Membuat `.gitignore` dan `.env.example`.
- Membuat struktur direktori awal.

Struktur target:

```text
src/
├── app.js
├── config.js
├── sessions/
├── conversation/
├── inbound/
└── utils/

sessions/
├── admin-1/
└── admin-2/

logs/
tests/
```

### 1.3 Membuat konfigurasi aplikasi

- Membaca environment variable.
- Memvalidasi mode aplikasi dan direktori auth admin.
- Memvalidasi direktori session dan tautan Community.
- Menyediakan nilai default yang aman.
- Menghentikan startup dengan pesan yang jelas jika konfigurasi wajib tidak valid.

### 1.4 Membuat utilitas dasar

- Logger dengan context nama session.
- Masking nomor pada log.
- Normalisasi nomor menjadi JID.
- Fungsi delay.
- Error handler dasar.
- Graceful shutdown dasar.

### Target Tahap 1

- [x] Aplikasi dapat dijalankan menggunakan `npm start`.
- [x] Konfigurasi tidak valid menghasilkan error yang jelas.
- [x] Credential dan file sensitif sudah diabaikan Git.
- [x] Struktur modul siap untuk implementasi berikutnya.
- [x] Automated test dan syntax check lulus.

## Tahap 2 — Sistem koneksi multi-session

Tahap ini membangun koneksi Admin 1, Admin 2, pengelolaan lifecycle, dan pengiriman manual dua arah.

**Status:** implementasi dan automated test selesai tanpa database. Pairing QR, verifikasi credential nyata, dan uji kirim A↔B belum dilakukan karena membutuhkan dua akun WhatsApp milik pengguna.

### 2.1 Membuat session Admin 1

- Menggunakan `useMultiFileAuthState()`.
- Membuat socket Baileys.
- Menampilkan QR atau metode pairing yang didukung.
- Menyimpan perubahan credential melalui `creds.update`.
- Menangani event `connection.update`.
- Mencatat status session secara internal.

State minimum:

```text
initializing
connecting
ready
disconnected
reconnecting
logged-out
stopped
```

### 2.2 Menguji kestabilan Admin 1

- Memastikan pairing berhasil.
- Memastikan credential tersimpan.
- Memastikan restart tidak selalu meminta pairing ulang.
- Menguji pemulihan dari disconnect sementara.
- Memastikan logout tidak menyebabkan reconnect tanpa batas.

Admin 2 baru ditambahkan setelah Admin 1 stabil.

### 2.3 Menambahkan Admin 2

Gunakan modul session yang sama dengan direktori auth terpisah:

```text
sessions/admin-1
sessions/admin-2
```

Setiap session wajib mempunyai socket, auth state, status, log context, queue, dan reconnect counter sendiri.

### 2.4 Membuat Session Manager

Session Manager bertanggung jawab untuk:

- memulai kedua session;
- memantau status setiap session;
- menunggu session siap;
- menyediakan socket kepada modul lain;
- mengisolasi error;
- menghentikan session dengan aman.

### 2.5 Menambahkan reconnect policy

- Reconnect hanya dilakukan untuk gangguan sementara.
- Gunakan backoff dan batas percobaan.
- Cegah lebih dari satu proses reconnect untuk session yang sama.
- Jangan menghapus auth state saat disconnect biasa.
- Hentikan session jika logout atau auth invalid.
- Lakukan pairing ulang secara manual.

### 2.6 Menguji pengiriman manual

Lakukan pengujian:

```text
Admin 1 -> Admin 2
Admin 2 -> Admin 1
```

Pengiriman harus ditolak dengan aman jika session pengirim belum siap.

### Target Tahap 2

- [x] Dua instance session dapat dijalankan bersamaan oleh Session Manager.
- [x] Auth directory kedua session dikonfigurasi secara terpisah.
- [x] QR terminal, penyimpanan `creds.update`, readiness, dan lifecycle tersedia.
- [x] Disconnect dan reconnect mempunyai batas serta kebijakan terminal.
- [x] Error satu session diisolasi dari session lainnya.
- [x] Jalur uji pengiriman manual dua arah tersedia dan tidak berjalan otomatis.
- [x] Automated test, syntax check, audit dependency, dan startup aman lulus.
- [ ] Admin 1 dan Admin 2 berhasil pairing dengan perangkat nyata.
- [ ] Credential nyata terbukti dapat digunakan kembali setelah restart.
- [ ] Pengiriman nyata Admin 1 → Admin 2 berhasil.
- [ ] Pengiriman nyata Admin 2 → Admin 1 berhasil.

## Tahap 3 — Conversation simulator

Tahap ini membuat simulasi percakapan finite antara dua akun milik sendiri.

**Status:** implementasi dan automated test selesai. Skenario bawaan saat ini berisi sepuluh pesan. Uji nyata pertama mengonfirmasi langkah 1 serta jeda 65 detik, kemudian berhenti aman karena Admin 2 berubah menjadi `logged-out` pada langkah 2. Uji sepuluh langkah penuh menunggu pairing ulang Admin 2.

### 3.1 Menentukan format skenario

Contoh:

```javascript
const scenario = [
  {
    sender: "admin-1",
    text: "Halo",
    delayMs: 3000
  },
  {
    sender: "admin-2",
    text: "Halo juga",
    delayMs: 5000
  }
]
```

### 3.2 Membuat validator skenario

- Sender hanya boleh `admin-1` atau `admin-2`.
- Teks tidak boleh kosong dan panjangnya dibatasi.
- Delay harus berada dalam rentang yang diizinkan.
- Jumlah langkah tidak boleh melampaui batas keras.
- Target session harus tersedia.

### 3.3 Membuat conversation runner

Runner akan:

1. Memuat dan memvalidasi skenario.
2. Menunggu kedua session siap.
3. Menjalankan langkah secara berurutan.
4. Menunggu delay sebelum pengiriman.
5. Mengirim pesan melalui sender yang sesuai.
6. Mencatat hasil setiap langkah.
7. Berhenti setelah skenario selesai.

### 3.4 Menambahkan stop protection

- Terapkan `MAX_CONVERSATION_STEPS`.
- Jangan menggunakan auto-reply timbal balik.
- Abaikan pesan `fromMe`.
- Hentikan runner jika session yang diperlukan disconnect.
- Dukung pembatalan saat aplikasi dihentikan.
- Jangan menggunakan loop tanpa batas.

### 3.5 Menguji simulator

- Urutan sender dan isi pesan.
- Ketepatan delay.
- Skenario kosong atau tidak valid.
- Batas jumlah langkah.
- Disconnect di tengah skenario.
- Penghentian manual.

### Target Tahap 3

- [x] Validator menolak skenario kosong, sender asing, text kosong, delay invalid, dan skenario yang melampaui `maxSteps`.
- [x] Runner menunggu kedua session berstatus `ready`.
- [x] Delay dan urutan pengiriman sesuai skenario.
- [x] Setiap langkah menunggu `DELIVERY_ACK`; receipt timeout dicatat dan tidak menghentikan skenario selama session tetap sehat.
- [x] Simulator berhenti setelah seluruh langkah selesai.
- [x] Simulator berhenti ketika salah satu session disconnect.
- [x] Simulator dapat dibatalkan melalui `AbortSignal` saat shutdown.
- [x] Pesan tidak pernah dikirim melebihi `maxSteps`.
- [x] Automated test dan syntax check lulus.
- [ ] Sepuluh langkah skenario bawaan berhasil dijalankan dengan dua akun nyata.

## Tahap 4 — Sistem inbound yang aman

Tahap ini menggabungkan listener pesan, validasi, duplicate protection, queue, dan balasan tautan Community.

### 4.1 Membuat inbound listener

- Mendengarkan event `messages.upsert`.
- Memisahkan listener dari logika bisnis.
- Meneruskan payload ke inbound handler.
- Menangkap error agar event yang rusak tidak menjatuhkan process.

### 4.2 Mengekstrak isi pesan

- Mendukung jenis pesan teks yang memang diperlukan.
- Menormalisasi teks sebelum pencocokan trigger.
- Melewati tipe pesan yang tidak didukung.

### 4.3 Memvalidasi pesan

Abaikan pesan jika:

- dikirim oleh akun sendiri;
- berasal dari status broadcast;
- merupakan event historis;
- tidak memiliki message ID atau remote JID yang valid;
- payload kosong atau tidak didukung;
- trigger tidak cocok;
- berasal dari group yang tidak diizinkan;
- session belum siap.

Gunakan reason code seperti:

```text
from-self
status-broadcast
old-event
empty-message
unsupported-type
trigger-not-matched
duplicate
session-not-ready
```

### 4.4 Membuat duplicate protection

Gunakan kunci:

```text
sessionName + remoteJid + messageId
```

State pekerjaan:

```text
received -> queued -> processing -> completed
                              \-> failed
```

Message ID yang sedang diproses atau sudah selesai tidak boleh dimasukkan kembali. Runtime menggunakan memory dengan TTL, kemudian menulis checkpoint ke SQLite agar state dapat dipulihkan setelah restart.

### 4.5 Membuat queue per session

Setiap admin memiliki queue sendiri yang mengatur:

- concurrency;
- delay antar-pengiriman;
- kapasitas maksimum;
- timeout pekerjaan;
- retry dan backoff terbatas;
- pause saat session disconnect.

Jika queue penuh, pekerjaan baru tidak boleh terus ditambahkan tanpa batas.

### 4.6 Menambahkan database cadangan

Gunakan SQLite sebagai lapisan persistence opsional untuk deduplication dan queue.

```text
data/
└── recovery.sqlite
```

Sub-tahapnya:

1. Membuat schema dan migration SQLite.
2. Menulis perubahan state dedup dan queue sebagai checkpoint.
3. Memulihkan message ID dan pekerjaan yang belum selesai saat startup.
4. Mengubah pekerjaan berstatus `processing` yang tertinggal menjadi state recovery yang aman.
5. Membersihkan record kedaluwarsa berdasarkan retention/TTL.
6. Menampilkan status database pada health check.

Tabel minimum:

```text
processed_messages
├── session_name
├── message_id
├── remote_jid_hash
├── status
├── processed_at
└── expires_at

message_jobs
├── id
├── session_name
├── message_id
├── status
├── attempts
├── available_at
├── completed_at
└── last_error
```

Aturan keamanan:

- database bukan tempat penyimpanan credential Baileys;
- nomor/JID harus di-hash atau diminimalkan jika tidak diperlukan untuk recovery;
- isi lengkap pesan tidak disimpan;
- file database masuk `.gitignore`;
- kegagalan checkpoint dicatat sebagai kondisi degraded;
- mode simulator tetap dapat berjalan tanpa database;
- mode inbound menggunakan fail closed untuk event yang status lamanya tidak dapat diverifikasi.

### 4.7 Membuat balasan inbound

Balasan dikirim hanya setelah pesan:

1. Lolos validasi.
2. Lolos duplicate check.
3. Berhasil masuk queue.
4. Diproses saat session siap.

Isi balasan dan tautan Community diambil dari konfigurasi, bukan ditulis langsung di source code.

### 4.8 Menjaga pola opt-in

- Pelanggan mengirim pesan terlebih dahulu.
- Bot tidak mengirim pesan pertama.
- Bot tidak melakukan broadcast.
- Bot tidak memasukkan pengguna secara otomatis.
- Pelanggan memilih sendiri apakah akan membuka tautan dan bergabung.

### Target Tahap 4

- Satu pesan valid menghasilkan tepat satu balasan.
- Pesan tidak valid tidak menghasilkan balasan.
- Event duplikat tidak dibalas kembali.
- Semua pengiriman inbound melewati queue.
- Queue Admin 1 dan Admin 2 berjalan independen.
- SQLite dapat memulihkan state deduplication dan queue setelah restart.
- Mode simulator tetap dapat berjalan ketika database tidak tersedia.

## Tahap 5 — Hardening, keamanan, dan pengujian

Tahap ini memastikan aplikasi stabil, aman, dapat diuji, dan dapat dihentikan dengan benar.

### 5.1 Menyempurnakan error handling

Tangani kondisi berikut:

- send timeout;
- socket disconnect;
- internet offline;
- auth invalid;
- queue penuh;
- payload rusak;
- retry habis;
- unhandled rejection;
- shutdown ketika pekerjaan masih aktif.

### 5.2 Membuat graceful shutdown

```text
Stop menerima event baru
          ↓
Pause queue
          ↓
Selesaikan atau batalkan pekerjaan aktif
          ↓
Simpan state
          ↓
Tutup socket
          ↓
Tutup logger dan storage
          ↓
Exit
```

### 5.3 Mengamankan credential

- Masukkan `sessions/`, `data/*.sqlite*`, dan `.env` ke `.gitignore`.
- Jangan menyimpan QR atau pairing code.
- Jangan memasukkan credential ke log.
- Batasi akses lokal ke folder session.
- Enkripsi backup credential jika backup memang diperlukan.

### 5.4 Menjaga privasi log

- Masking nomor telepon.
- Jangan mencatat isi pesan jika tidak diperlukan.
- Jangan menampilkan tautan undangan pada log publik.
- Tentukan masa retensi log.
- Bersihkan log lama secara berkala.
- Pisahkan context log Admin 1 dan Admin 2.

### 5.5 Membuat unit test

Uji:

- validasi environment;
- normalisasi nomor dan JID;
- ekstraksi teks;
- trigger matcher;
- event validator;
- deduplication;
- queue dan retry;
- reconnect decision;
- scenario validator dan `maxSteps`.

### 5.6 Membuat integration test

Uji:

- isolasi dua auth directory;
- pengiriman dua arah;
- simulator selesai sesuai batas;
- satu inbound menghasilkan satu balasan;
- event duplikat tidak dibalas;
- disconnect satu akun tidak mematikan akun lain;
- restart tidak memproses ulang pekerjaan selesai;
- graceful shutdown bekerja.

### Target Tahap 5

- Pengujian utama lulus.
- Retry dan reconnect selalu memiliki batas.
- Aplikasi dapat dihentikan dengan aman.
- Credential tidak terekspos.
- Log cukup untuk diagnosis tanpa menyimpan data berlebihan.

## Tahap 6 — Uji operasional dan penerapan

Tahap terakhir mempersiapkan aplikasi untuk penggunaan terbatas di lingkungan nyata.

### 6.1 Melakukan uji internal

- Menjalankan simulator menggunakan akun sendiri.
- Mengirim beberapa trigger inbound.
- Mengulang event yang sama untuk menguji deduplication.
- Membuat salah satu akun offline.
- Memutus internet sementara.
- Melakukan restart aplikasi.
- Menguji beberapa pesan yang datang berdekatan.

### 6.2 Melakukan uji volume rendah

- Mulai dari trafik opt-in yang sangat kecil.
- Pantau queue depth, retry, dan disconnect.
- Periksa kemungkinan balasan ganda.
- Pantau penggunaan memory dan ukuran log.
- Evaluasi pengalaman pengguna sebelum meningkatkan penggunaan.

### 6.3 Menyiapkan SOP operasional

Sediakan prosedur untuk:

- memulai dan menghentikan aplikasi;
- melakukan pairing ulang;
- menangani akun logout;
- menangani queue penuh;
- menangani internet offline;
- mengalihkan rotator ke admin yang sehat;
- kembali ke pelayanan manual.

### 6.4 Menyiapkan health check

Status minimum yang perlu tersedia:

```text
Admin 1: ready/offline
Admin 2: ready/offline
Queue Admin 1: jumlah pekerjaan
Queue Admin 2: jumlah pekerjaan
Recovery database: ready/degraded/disabled
Last successful send
Last reconnect
Application uptime
```

### 6.5 Melakukan evaluasi

Jangan meningkatkan penggunaan jika ditemukan:

- pesan terkirim ganda;
- reconnect berulang;
- queue sering penuh;
- banyak pengiriman gagal;
- komplain pengguna;
- pembatasan akun;
- penggunaan data yang tidak sesuai kebijakan.

### Target Tahap 6

- Sistem stabil pada penggunaan terbatas.
- SOP operasional tersedia.
- Kegagalan dapat ditangani secara manual.
- Peningkatan penggunaan hanya dilakukan setelah evaluasi berhasil.

## Urutan dan ketergantungan implementasi

```text
Tahap 1 — Perencanaan dan Fondasi
                  ↓
Tahap 2 — Sistem Multi-Session
          ┌───────┴────────┐
          ↓                ↓
Tahap 3 — Simulator   Tahap 4 — Inbound
          └───────┬────────┘
                  ↓
Tahap 5 — Hardening dan Pengujian
                  ↓
Tahap 6 — Operasional
```

Tahap 3 dan Tahap 4 dapat dikembangkan secara terpisah setelah Tahap 2 stabil. Keduanya harus dipertemukan kembali pada Tahap 5 untuk pengujian menyeluruh sebelum sistem digunakan pada Tahap 6.

# BUG

## BUG-001 — Uji pengiriman dua arah hanya berhasil pada satu arah

**Tanggal ditemukan:** 3 September 2026  
**Tahap terkait:** Tahap 2 — Sistem koneksi multi-session  
**Status:** perbaikan kode selesai; verifikasi akhir menunggu pairing ulang Admin 1

### Gejala

Saat menjalankan `npm run test:manual-send`, aplikasi seharusnya mengirim satu pesan pada setiap arah:

```text
Admin 1 -> Admin 2
Admin 2 -> Admin 1
```

Pada perangkat nyata, hanya pesan dari Admin 2 yang terus muncul. Pesan Admin 1 tidak sampai ke Admin 2 meskipun pemanggilan `sendMessage()` menghasilkan message ID.

### Hasil reproduksi

Pengujian menghasilkan kondisi berikut:

```text
admin-1-to-admin-2: tidak memperoleh DELIVERY_ACK
admin-2-to-admin-1: memperoleh DELIVERY_ACK
```

Kedua session mencapai state `ready`, menggunakan direktori auth yang berbeda, dan terhubung ke dua identitas WhatsApp yang berbeda. Resolusi nomor melalui WhatsApp juga mengembalikan PN JID dan LID yang valid untuk kedua akun.

Terminal menampilkan error Signal Protocol berikut selama koneksi:

```text
Failed to decrypt message with any known session
Bad MAC
```

### Akar masalah

Masalah bukan disebabkan oleh kedua session memakai nomor yang sama atau oleh urutan pemanggilan `sendBetween()`. Auth state Signal/LID pada session Admin 1 sudah tidak sinkron atau menyimpan key percakapan yang basi. Akibatnya, pesan Admin 1 dapat dibuat dan diterima server untuk diproses, tetapi tidak pernah terkonfirmasi sampai ke perangkat Admin 2.

Proyek sebelumnya menggunakan Baileys `6.7.24` dari jalur `legacy`. Versi tersebut juga tidak memiliki seluruh mekanisme pemetaan LID dan auto-recreation Signal session yang tersedia pada Baileys 7.

### Perbaikan yang diterapkan

1. Dependency Baileys dinaikkan dari `6.7.24` ke `7.0.0-rc14`.
2. Sebelum pengiriman antarsession, penerima diverifikasi melalui `onWhatsApp()` dan hasil JID kanonis digunakan sebagai target.
3. `SessionManager` memeriksa bahwa Admin 1 dan Admin 2 benar-benar terhubung ke akun berbeda.
4. Uji manual tidak lagi mencatat status `completed` jika salah satu arah gagal memperoleh `DELIVERY_ACK`.
5. Hasil kedua arah dicatat melalui event `manual-send-test.results`.
6. Ditambahkan unit test untuk resolusi target dan penolakan dua session dengan akun yang sama.
7. Auth state Admin 1 yang bermasalah diarsipkan secara lokal ke:

```text
sessions/admin-1-bad-mac-backup-20260903-1549
```

Folder tersebut adalah backup pemulihan dan tidak boleh di-commit atau dibagikan karena mengandung credential WhatsApp.

### Hasil pemeriksaan otomatis

```text
npm test       -> 28 test lulus
npm run check  -> lulus
npm audit      -> 0 vulnerability
```

### Verifikasi akhir yang masih diperlukan

Folder `sessions/admin-1` sudah disiapkan ulang dalam keadaan kosong. Jalankan:

```bash
npm run test:manual-send
```

Kemudian pindai QR `admin-1` menggunakan nomor Admin 1. Jangan menjalankan `npm start` dan `npm run test:manual-send` secara bersamaan.

Bug dinyatakan selesai sepenuhnya hanya jika hasil berikut tercapai pada satu run ID yang sama:

```text
admin-1-to-admin-2: true
admin-2-to-admin-1: true
```

Jika `Bad MAC` kembali muncul setelah pairing ulang, putuskan linked device lama dari ponsel Admin 1, arsipkan auth state baru untuk diagnosis, lalu lakukan pairing ulang sekali lagi sebelum melanjutkan ke Tahap 3.

## BUG-002 — Session Admin 2 logout saat langkah kedua simulator

**Tanggal ditemukan:** 3 September 2026  
**Tahap terkait:** Tahap 3 — Conversation simulator  
**Status:** auth lama diarsipkan; menunggu pairing ulang Admin 2

### Hasil uji nyata

Simulator memulai skenario empat langkah dan menghasilkan hasil berikut:

```text
Langkah 1: Admin 1 -> Admin 2 = DELIVERY_ACK
Jeda menuju langkah 2: 65000 ms = selesai
Langkah 2: Admin 2 -> Admin 1 = sendMessage menghasilkan message ID
Session Admin 2: 401 loggedOut
Langkah 3 dan 4: tidak dijalankan
```

Perilaku penghentian sesuai stop protection Tahap 3. Runner menerima perubahan state `logged-out`, membatalkan delivery wait, tidak mengirim langkah tersisa, lalu aplikasi menutup kedua socket melalui graceful shutdown.

Auth state Admin 2 yang terminal telah diarsipkan ke:

```text
sessions/admin-2-logged-out-20260903-164326
```

Folder `sessions/admin-2` baru sudah disiapkan dalam keadaan kosong. Verifikasi dilanjutkan dengan menjalankan `npm start`, memindai QR `admin-2` menggunakan nomor Admin 2, dan memastikan keempat langkah memperoleh `DELIVERY_ACK`.
