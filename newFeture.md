# Fitur Baru — Warm-up Bertahap Berdasarkan Riwayat (Seniority-based Warm-up)

**Status:** rencana, belum diimplementasikan.
**Tujuan dokumen:** rencana teknis untuk didiskusikan/dikoreksi dulu sebelum mulai coding.

## 1. Kebutuhan (dari diskusi dengan pengguna)

1. Sistem harus tetap bisa jalan (minimal) kalau baru ada **2 nomor** yang sudah discan barcode — tidak boleh lagi maksa harus 4 nomor sekaligus siap baru bisa mulai chat.
2. Kalau nomor yang aktif lebih dari 2, urutan chat harus dimulai dari **pasangan yang sudah pernah saling chat sebelumnya**, baru setelah itu melibatkan nomor ke-3/ke-4.
3. Nomor yang **baru** (belum pernah chat dengan siapa pun) tidak boleh jadi yang memulai duluan. Nomor **lama** yang harus mengirim pesan pertama ke nomor baru itu.

Keputusan tambahan yang sudah disepakati:

- Status "lama" vs "baru" **dideteksi otomatis** oleh sistem, bukan diset manual.
- Sebuah nomor dianggap "lama" kalau total pesan yang sudah dikirimnya mencapai angka ambang batas tertentu (`SENIORITY_THRESHOLD`, usulan default **20 pesan**, bisa diubah lewat `.env`).
- Riwayat disimpan di **file JSON sederhana** (bukan SQLite/database beneran) — cukup untuk kebutuhan proyek ini, tidak menambah dependency baru.
- Riwayat **diingat lintas-run** (persist), bukan dihitung ulang dari nol tiap kali program dijalankan.

### Kasus khusus yang disepakati

- **Belum ada riwayat sama sekali** (pertama kali dijalankan): semua nomor "baru" semua → boleh saling chat bebas (tidak ada nomor lama yang bisa mengenalkan).
- **Dua nomor baru sekaligus, tidak ada nomor lama yang aktif untuk mengenalkan**: kedua nomor baru itu boleh langsung saling chat (kasus darurat, tidak ada pilihan lain).

## 2. Desain teknis

### 2.1 Penyimpanan riwayat — `data/relationship-state.json`

Modul baru `src/state/relationship-store.js`, membaca/menulis satu file JSON:

```json
{
  "admins": {
    "admin-1": { "totalMessagesSent": 45 },
    "admin-3": { "totalMessagesSent": 3 }
  },
  "pairs": {
    "admin-1|admin-2": { "messageCount": 20, "firstContactBy": "admin-1", "firstContactAt": "2026-09-01T10:00:00.000Z" },
    "admin-1|admin-3": { "messageCount": 2, "firstContactBy": "admin-1", "firstContactAt": "2026-09-09T08:00:00.000Z" }
  }
}
```

Kunci pasangan (`pairs`) dinormalisasi (urut nama admin secara alfabetis) supaya `admin-1|admin-3` dan `admin-3|admin-1` selalu merujuk entri yang sama.

Fungsi yang disediakan:

- `loadState()` — baca file, kalau belum ada kembalikan state kosong.
- `saveState(state)` — tulis file (atomic write: tulis ke file sementara lalu rename, supaya tidak korup kalau proses mati di tengah jalan).
- `recordMessage(state, sender, recipient)` — tambah `totalMessagesSent` sender, tambah `messageCount` pasangan, isi `firstContactBy`/`firstContactAt` kalau pasangan ini baru pertama kali. Mengembalikan state baru (tidak mutasi in-place, biar gampang diuji).
- `isOldAdmin(state, adminName, thresholdMessages)` — `true` kalau `totalMessagesSent >= thresholdMessages`.
- `hasChattedBefore(state, a, b)` — `true` kalau pasangan sudah punya entri di `pairs`.
- `getPairKey(a, b)` — helper normalisasi kunci pasangan.

File `data/` ditambahkan ke `.gitignore` (sama seperti `sessions/`) karena berisi data riwayat yang tidak perlu ikut ke-commit.

### 2.2 Jumlah admin jadi dinamis — `src/config.js`

Saat ini `config.js` selalu membaca persis 4 admin (`admin1`..`admin4`) secara hardcode. Diubah jadi: baca `ADMIN_1_AUTH_DIR`, `ADMIN_2_AUTH_DIR`, `ADMIN_3_AUTH_DIR`, ... berurutan selama variabelnya ada di `.env`, berhenti begitu ketemu nomor yang kosong. Minimal harus ada 2 admin terdefinisi, kalau kurang lempar `ConfigurationError`.

Tambahan config baru:

```
SENIORITY_THRESHOLD=20   # jumlah pesan terkirim sebelum sebuah nomor dianggap "lama"
```

### 2.3 Skenario percakapan jadi dinamis — `src/conversation/scenarios.js`

Fungsi `createDefaultConversationScenario(messageDelayMs)` yang isinya 24 langkah hardcode diganti dengan `createDynamicConversationScenario({ activeAdmins, relationshipState, thresholdMessages, messageDelayMs, maxSteps })`, dengan logika:

1. Bentuk semua pasangan yang mungkin dari `activeAdmins` (misal 2 admin → 1 pasangan, 4 admin → 6 pasangan).
2. Pisah jadi dua kelompok: pasangan yang **sudah pernah chat** (ada di `relationshipState.pairs`) vs yang **belum pernah**.
3. Urutan pemrosesan: kelompok "sudah pernah chat" diproses lebih dulu, baru kelompok "belum pernah".
4. Untuk tiap pasangan baru (belum pernah chat), tentukan siapa yang mengirim pesan pertama:
   - Kalau salah satu "lama" dan satunya "baru" → yang **lama** wajib jadi `sender` di langkah pertama pasangan itu.
   - Kalau status keduanya sama (sama-sama lama, atau sama-sama baru/tidak ada nomor lama yang tersedia) → boleh bebas, dipilih berdasarkan urutan admin di konfigurasi (yang index lebih kecil duluan) supaya deterministik dan gampang diuji.
5. Tiap pasangan diberi beberapa langkah bolak-balik (default 4 langkah, seperti pola sekarang), teksnya diambil dari **pool kalimat obrolan generik** (bukan lagi teks tetap per topik/pasangan tertentu, karena pasangan sekarang tidak lagi tetap) — pool ini berisi beberapa set pembuka/balasan/lanjutan/penutup yang bisa dipasangkan ke pasangan admin mana pun.
6. Gabungkan seluruh langkah dari semua pasangan, potong sesuai `maxSteps` kalau melebihi batas.

### 2.4 Runner/session-manager mencatat riwayat setelah kirim pesan

Setelah `sessionManager.sendBetween()` berhasil mengembalikan `messageId` di `runner.js`, panggil `relationshipStore.recordMessage()` lalu `saveState()`. Dibungkus `try/catch` — kalau gagal tulis file (misal disk penuh), dicatat sebagai warning di log, tidak menghentikan skenario yang sedang berjalan (sama seperti kegagalan log ke file yang sudah ada sekarang).

### 2.5 `app.js` menyambungkan semuanya

`app.js` sekarang: baca `config.admins` (jumlahnya dinamis) → `relationshipStore.loadState()` → `createDynamicConversationScenario()` dengan admin aktif + riwayat + threshold dari config → jalankan `runner.run()` seperti biasa dengan `participants` = seluruh admin aktif.

## 3. Tahapan implementasi

### Tahap 1 — Fondasi: modul penyimpanan riwayat

**File:** baru `src/state/relationship-store.js`, baru `test/relationship-store.test.js`, update `.gitignore`.

- Implementasi `loadState`, `saveState` (atomic write), `recordMessage`, `isOldAdmin`, `hasChattedBefore`, `getPairKey`.
- Unit test: state kosong di awal, `recordMessage` menambah counter dengan benar, `isOldAdmin` sesuai threshold, `getPairKey` konsisten untuk urutan nama terbalik, `saveState`/`loadState` roundtrip benar dari disk.
- Verifikasi: `npm test` khusus file ini hijau, `node --check` lolos.

### Tahap 2 — Config jadi dinamis jumlah admin

**File:** `src/config.js`, update `test/config.test.js`, update `.env.example`.

- Ganti blok `admins` dari hardcode 4 entri jadi loop dinamis.
- Tambah validasi minimal 2 admin.
- Tambah parsing `SENIORITY_THRESHOLD` (default 20).
- Update test: kasus 2 admin saja, kasus 4 admin, kasus kurang dari 2 admin (harus error).
- Verifikasi: `npm test` untuk `config.test.js` hijau.

### Tahap 3 — Scenario builder dinamis

**File:** rombak `src/conversation/scenarios.js`, update `test/conversation-runner.test.js` (bagian yang menguji skenario default).

- Implementasi `createDynamicConversationScenario(...)` sesuai §2.3.
- Siapkan pool teks obrolan generik pengganti teks tetap per topik.
- Unit test baru: 2 admin (kasus minimal), 4 admin tanpa riwayat sama sekali (bootstrap), 4 admin dengan sebagian riwayat (pasangan lama duluan, admin baru "disapa" oleh admin lama), kasus dua admin baru tanpa admin lama yang tersedia.
- Verifikasi: `npm test` untuk file ini hijau.

### Tahap 4 — Pencatatan riwayat setelah kirim pesan

**File:** `src/conversation/runner.js` (atau `src/sessions/session-manager.js`, dipilih saat implementasi mana yang lebih pas), update test terkait.

- Panggil `relationshipStore.recordMessage()` + `saveState()` setelah pengiriman sukses, dibungkus try/catch agar tidak mengganggu jalannya skenario kalau gagal tulis.
- Unit test: pastikan store ke-update setelah satu langkah terkirim, dan skenario tetap lanjut kalau `saveState` sengaja dibuat gagal (mock).

### Tahap 5 — Menyambungkan semua di `app.js`

**File:** `src/app.js`.

- Wiring: `config.admins` (dinamis) → `relationshipStore.loadState()` → `createDynamicConversationScenario()` → `runner.run()`.
- Verifikasi manual: jalankan dengan `.env` yang cuma berisi 2 admin, pastikan tidak ada error menunggu admin ke-3/4.

### Tahap 6 — Uji menyeluruh & dokumentasi

- Jalankan `npm test` penuh, pastikan semua hijau (termasuk test lama yang mungkin masih menyinggung skenario/format lama).
- Jalankan `npm run check` untuk syntax check seluruh file yang terlibat.
- Update `README.md` dan `project.md` untuk mendokumentasikan fitur ini (bagian "Fitur saat ini", tabel konfigurasi `SENIORITY_THRESHOLD`, dan penjelasan aturan urutan chat yang baru).

## 4. Hal yang masih perlu dikonfirmasi pengguna

- Angka default `SENIORITY_THRESHOLD=20` — apakah sudah pas atau mau diubah.
- Jumlah langkah per pasangan (default 4 langkah bolak-balik seperti pola lama) — apakah tetap segitu atau mau disesuaikan.
- Apakah pool teks obrolan generik boleh saya susun sendiri (mengambil nada obrolan santai seperti skenario yang sudah ada sekarang), atau ada contoh spesifik yang ingin dipakai.
