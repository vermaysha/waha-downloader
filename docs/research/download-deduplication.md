# Research: Deduplikasi Download & Caching URL di `waha-downloader`

**Tanggal:** 2026-11-14  
**Cakupan:** Analisis teknis atas skenario *"kalau file sudah didownload, tidak perlu didownload ulang, alias kalau ada 2 perintah untuk download file yang sama, yang satunya diabaikan"* pada `waha-downloader`, mencakup deduplikasi event WAHA, deduplikasi *in-flight*, *completed URL cache* (TTL), isolasi Cookie Profile antar-Requester, batasan VPS 2 GB RAM, dan opsi UX.

---

## Ringkasan Eksekutif (TL;DR)

Saat ini `waha-downloader` **belum memiliki mekanisme deduplikasi maupun caching** di level event, antrean, maupun URL hasil download. Setiap event `message.any` yang lolos filter akan langsung masuk ke `createConcurrencyQueue` ([`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L190-L315)), menjalankan `yt-dlp`, mengunggah ke Media Archive, lalu menghapus `workDir` di blok `finally` ([`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L305-L312)).

Untuk menangani perintah duplikat secara aman dan hemat resource di VPS 2 GB RAM, masalah ini perlu dipecah menjadi **3 kasus terpisah**:

1. **Kasus 1 — Duplikasi Event / `payload.id`:** Mencegah satu pesan WhatsApp diproses dua kali (mis. saat WebSocket WAHA reconnect atau redelivery) menggunakan `Set`/`Map` berbatas ukuran untuk `payload.id` + *silent ignore*.
2. **Kasus 2 — Duplikasi URL *In-Flight* (sedang diproses):** Saat URL yang sama diminta lagi ketika masih antre/downloading/uploading. Bisa di-**abaikan** (opsi reaksi `⏭️`) jika berasal dari chat yang sama, atau di-**coalesce** (*share* `Promise` yang sama) jika ingin semua peminta tetap mendapat balasan tanpa `yt-dlp` ganda.
3. **Kasus 3 — *Completed URL Cache* (berbasis TTL):** Menyimpan **metadata hasil upload** (bukan file video lokal di disk), dengan TTL yang mengikuti masa berlaku URL target upload terpendek (mis. `< R2_PRESIGN_TTL_SECONDS` yang default-nya `3600` detik), serta **wajib mengisolasi kunci cache** berdasarkan status Cookie Profile agar video privat milik satu Requester tidak bocor ke Requester lain.

---

## 1. Kondisi Alur `waha-downloader` Saat Ini

Berdasarkan pembacaan kode sumber saat ini:

- **Penerimaan Event WebSocket ([`src/waha.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/waha.ts#L196-L264)):**
  - `connectWahaWebSocket` terhubung ke `/ws?session=...&events=message.any` dan melakukan reconnect otomatis dengan *exponential backoff* (`computeBackoffMs`).
  - Setiap pesan masuk langsung memanggil `options.onEvent(parsed)` tanpa pengecekan ID event/pesan yang pernah diterima.
- **Parsing & Antrean ([`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L40-L50), [`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L110-L192), [`src/queue.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/queue.ts#L4-L26)):**
  - `handleWahaEvent` hanya memfilter `event.event !== "message.any"` dan `payload.source === "api"`.
  - `parseDlUrls` memecah token URL setelah `/dl` dengan `rest.split(/\s+/).filter(isValidHttpUrl)` tanpa menghapus duplikat dalam satu pesan yang sama (mis. `/dl <url1> <url1>`).
  - `enqueue = createConcurrencyQueue(deps.downloadConcurrency ?? 2)` hanya membatasi jumlah task paralel, tidak memeriksa apakah URL yang sama sedang berjalan.
- **Siklus File Sementara ([`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L193-L312)):**
  - Setiap URL membuat direktori unik `mkdtemp(join(deps.tmpDir, "dl-"))` dan menyalin Cookie Profile ke file sementara (`createTempCookieCopy`).
  - Setelah upload dan pengiriman balasan WAHA selesai (atau gagal), `workDir` dan `tempCookiePath` selalu dihapus di blok `finally`.

---

## 2. Analisis Tiga Kasus Deduplikasi

### Kasus 1: Duplikasi Event `message.any` / `payload.id`

- **Penyebab:** WAHA WebSocket bisa terputus dan reconnect ([`src/waha.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/waha.ts#L246-L250)), atau server WAHA mengirim ulang event dengan `payload.id` yang sama ([`src/types.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/types.ts#L7-L18)).
- **Dampak saat ini:** Satu pesan `/dl` (atau `/cookies`, `/help`) bisa dieksekusi dua kali dan mengirim balasan ganda.
- **Solusi:**
  - Simpan `payload.id` yang sudah/sedang diproses di struktur berbatas (mis. `Map<string, number>` dengan TTL beberapa menit–jam dan batas `maxEntries`, mis. 1.000–5.000 ID).
  - Pengecekan dilakukan di awal `handleWahaEvent` sebelum `markSeenBestEffort()` dan `sendReaction(payload.id, "⏳")`.
  - **Perilaku UX:** **Silent ignore** (`return` langsung), karena dari sudut pandang Requester, pesan tersebut memang hanya dikirim satu kali.
  - **Bonus intra-pesan:** Pada `parseDlUrls` ([`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L40-L50)), lakukan deduplikasi URL di dalam satu pesan (mis. `Array.from(new Set(urls))` setelah normalisasi URL dasar) agar `/dl <url> <url>` tidak mendownload file yang sama dua kali.

### Kasus 2: Duplikasi URL *In-Flight* (Sedang Diproses)

Terjadi ketika Request #1 untuk `url` masih berada di antrean `enqueue(...)`, sedang dijalankan `yt-dlp`, atau sedang diunggah ke Media Archive, lalu Request #2 masuk untuk `url` yang sama.

Ada dua pendekatan desain yang bisa dipilih:

| Pendekatan | Mekanisme | Kelebihan | Kekurangan |
| :--- | :--- | :--- | :--- |
| **Opsi A: Ignore / Tolak (*Skip*)** | Simpan `Set<string>` (atau `Map<string, InFlightMeta>`) berisi kunci job aktif. Jika kunci sudah ada, langsung lewati proses download dan opsional beri reaksi `⏭️`. | Sangat sesuai dengan instruksi *"yang satunya diabaikan"*; tidak memblokir worker/handler tambahan; implementasi paling sederhana. | Jika Request #2 berasal dari chat/grup berbeda (atau Requester berbeda pada video publik), Requester #2 tidak otomatis mendapat file/link hasilnya. |
| **Opsi B: *Promise Coalescing*** | Simpan `Map<string, Promise<DownloadCacheEntry>>`. Request #2 melakukan `await` pada `Promise` yang sama, lalu tetap mengirim balasan ke `chatId` & `payload.id` Request #2 saat selesai. | Tidak ada download/upload ganda, namun semua Requester tetap menerima hasil video/link masing-masing. | Jika Request #2 datang dari user yang *spam* di chat yang sama, user tetap menerima balasan ganda (kecuali dibatasi per `(chatId, url)`). |

**Rekomendasi praktis:**
- Jika dua perintah datang dari **`chatId` yang sama** saat masih *in-flight*: **abaikan** dengan reaksi `⏭️` (Opsi A) agar chat tidak penuh balasan duplikat.
- Jika datang dari **`chatId` berbeda** (untuk URL publik yang aman di-share): gunakan **Promise Coalescing** (Opsi B) atau tetap abaikan jika kebijakan bot memang 100% mengabaikan permintaan ganda.

### Kasus 3: *Completed URL Cache* (Permintaan Ulang Setelah Selesai)

Terjadi ketika `url` yang sama diminta lagi **setelah** job sebelumnya selesai dan `workDir` sudah dihapus di blok `finally` ([`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L305-L312)).

Karena file video lokal tidak dipertahankan di disk, cache hanya boleh menyimpan **metadata hasil Media Archive**, misalnya:
- `primaryUrl: string`
- `links: Array<{ label: string; url: string }>`
- `filename: string`
- `fileSize: number`
- `preferLocalFile?: boolean`
- `expiresAt: number`

#### Kapan URL Hasil Upload Aman Dipakai Ulang (TTL per Target)

Masa berlaku URL sangat bergantung pada `UPLOAD_TARGET` yang dikonfigurasi di [`src/config.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/config.ts#L50-L138) dan [`src/archive.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L431-L467):

1. **Cloudflare R2 (`R2Archive`, [`src/archive.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L19-L44), [`src/config.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/config.ts#L253-L260)):**
   - **Dengan `R2_PUBLIC_BASE_URL`:** Mengembalikan `${publicBaseUrl}/${objectKey}` yang bersifat **permanen** (selama objek tidak dihapus di bucket). Cache TTL bisa panjang (mis. 24 jam–7 hari).
   - **Tanpa `R2_PUBLIC_BASE_URL`:** Mengembalikan *presigned URL* lewat `this.client.presign(objectKey, { expiresIn: this.config.presignTtlSeconds })` dengan default `R2_PRESIGN_TTL_SECONDS = 3600` (1 jam).
   - **Aturan TTL:** TTL cache **harus lebih pendek** dari `presignTtlSeconds` (mis. `Math.max(60, presignTtlSeconds - 300)` detik, memberi margin 5 menit) agar link yang dikirim dari cache belum kedaluwarsa saat diklik Requester atau diambil oleh WAHA `sendVideo`.
2. **`temp.sh` (`TempShArchive`, [`src/archive.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L59-L120)):**
   - Layanan `temp.sh` menyimpan file sementara (umumnya hingga 3 hari sebelum kedaluwarsa).
   - **Aturan TTL:** Gunakan TTL cache yang konservatif (mis. 24 jam / `86400` detik, atau maksimal 48 jam) agar tidak mengembalikan link yang sudah dihapus oleh `temp.sh`.
3. **Google Drive (`GoogleDriveArchive`, [`src/archive.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L212-L426)):**
   - File dan URL (`viewUrl` / `directUrl`) bersifat **permanen** selama tidak dihapus secara manual dari Google Drive.
   - **Catatan kritis `GDRIVE_PUBLIC=false`:** Saat `makePublic` bernilai `false`, `GoogleDriveArchive.uploadAll` mengembalikan `preferLocalFile: true` ([`src/archive.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L419-L424)). Pada [`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L258-L260), `preferLocalFile` membuat `sendVideo` memakai `filePath: downloaded.filePath` lokal. Karena `workDir` sudah dihapus setelah job pertama selesai, cache hit dengan `preferLocalFile: true` **tidak bisa** mengirim video via file lokal—ia harus fallback ke `sendText` (mengirim `viewUrl`), kecuali `GDRIVE_PUBLIC=true`.
4. **Multi-target (`CompositeArchive`, [`src/archive.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L130-L178)):**
   - Jika `UPLOAD_TARGET` berisi lebih dari satu target (mis. `both` = `s3,temp` atau `all` = `s3,temp,gdrive`), TTL cache **wajib mengikuti nilai minimum** dari semua target aktif (mis. jika `s3` presigned 1 jam dan `gdrive` permanen, TTL efektif = `< 1 jam`).

---

## 3. Batasan Keamanan & Kebenaran (*Correctness*)

### 3.1 Isolasi Requester & Cookie Profile (ADR-0001)

Mengacu pada [`docs/adr/0001-per-job-cookie-copy.md`](file:///Users/vermaysha/lainnya/waha-downloader/docs/adr/0001-per-job-cookie-copy.md) dan [`src/cookies.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/cookies.ts#L36-L181):
- `cookieStore.resolvePathForUrl(payload, url)` mencari file Netscape cookie berdasarkan `normalizeRequester(payload)` dan `extractNormalizedDomain(url)`.
- Jika Requester A memiliki Cookie Profile untuk `instagram.com` dan mendownload video privat/Close Friends, lalu hasilnya di-cache hanya dengan kunci `url`, maka ketika Requester B meminta `url` yang sama, **Requester B akan menerima video privat milik Requester A** (kebocoran data lintas-Requester).
- Sebaliknya, jika Requester B (tanpa cookie) gagal atau mendapat versi publik lalu di-cache untuk `url`, Requester A bisa terhalang.

**Cara mencegah kebocoran:**
Gunakan kunci komposit `(scopeKey, normalizedUrl)` untuk *in-flight map* maupun *completed cache*:
- **Opsi paling aman & sederhana:** Selalu gunakan `requesterKey = normalizeRequester(payload) ?? chatId` sebagai `scopeKey` sehingga cache bersifat **per-Requester** (atau per-`chatId`).
- **Opsi *shared public cache*:** Cek `profilePath = await cookieStore?.resolvePathForUrl(payload, url)` terlebih dahulu:
  - Jika `profilePath` ada: `scopeKey = "user:" + requesterKey` (plus `mtimeMs` file cookie jika ingin otomatis invalidasi saat `/cookies <domain>` diperbarui).
  - Jika `profilePath` tidak ada: `scopeKey = "public"`.
- Selain itu, **normalisasi URL** (mis. menghapus parameter tracking seperti `utm_*`, `igsh`, `si` secara hati-hati, atau minimal `new URL(url).toString()`) membantu menghindari cache miss semu tanpa mengubah identitas video (parameter krusial seperti `?v=` pada YouTube atau `?id=` tetap harus dipertahankan).

### 3.2 Penanganan Error (*Error Handling*)

- Pada [`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L286-L304), jika `downloader.download` atau `archive.upload`/`uploadAll` gagal, error ditangkap dan dibalas ke Requester.
- **Aturan wajib:**
  1. Download/upload yang gagal **tidak boleh** dimasukkan ke *completed URL cache* (negative caching tidak disarankan karena error sering bersifat sementara, seperti `429`, `ETIMEDOUT`, atau cookie baru diperbarui).
  2. Entri di *in-flight map* **wajib dihapus di blok `finally`** agar percobaan ulang (*retry*) oleh Requester berikutnya tidak tersangkut selamanya pada entri gagal.

### 3.3 Jejak Memori & Penyimpanan di VPS 2 GB RAM

- **Jangan simpan file video di disk untuk cache:** `workDir` sudah tepat dihapus di `finally` ([`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L307)). Menyimpan file MP4 di disk berisiko memenuhi kapasitas VPS, sedangkan menyimpannya di RAM akan memicu OOM pada VPS 2 GB.
- **Simpan metadata saja:**
  - **In-memory `Map` (disarankan untuk tahap awal):** Simpan maksimal `N` entri (mis. 500–1.000 entri) dengan eviksi entri tertua (FIFO/LRU) dan pembersihan entri kedaluwarsa (`expiresAt <= Date.now()`). Ukuran 1.000 entri metadata URL hanya memakan **< 1 MB RAM**.
  - **`bun:sqlite` (opsional jika perlu tahan restart):** Bun sudah menyertakan `bun:sqlite` secara bawaan tanpa dependensi eksternal. Cocok jika hasil download (seperti URL Google Drive atau R2 public) ingin tetap diingat setelah proses bot restart, dengan jadwal cleanup berkala `DELETE FROM url_cache WHERE expires_at <= ?`.

### 3.4 Opsi UX Saat Duplikat Terdeteksi

| Skenario | Opsi UX yang Disarankan | Implementasi di `waha-downloader` |
| :--- | :--- | :--- |
| **Duplikat `payload.id`** (WAHA reconnect / redelivery) | **Silent ignore** | `return` lebih awal sebelum `sendSeen` / `sendReaction`. |
| **Duplikat URL *in-flight* di chat yang sama** | **Abaikan + reaksi `⏭️`** (atau abaikan diam-diam) | Panggil `deps.waha.sendReaction(payload.id, "⏭️")` (best-effort) lalu `return` tanpa `enqueue`. |
| **Duplikat URL *completed* (cache hit, URL masih valid)** | **Opsi A (Strict Ignore):** reaksi `⏭️` / teks singkat *"Link sudah pernah didownload."*<br>**Opsi B (Cache Reply — disarankan jika user minta ulang):** reaksi `✅` lalu kirim `sendVideo` (via `primaryUrl` jika `<= maxWhatsappMediaBytes` & `!preferLocalFile`) atau `sendText(replyText)`. | Tidak menjalankan `yt-dlp` dan tidak mengunggah ulang ke Media Archive; langsung pakai metadata cache. |

---

## 4. Ringkasan Rekomendasi Implementasi

1. **Deduplikasi `payload.id`** di awal `handleWahaEvent` ([`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L116)) dengan `Map` berbatas (mis. TTL 10 menit, maks 2.000 entri) → *silent ignore*.
2. **Deduplikasi URL dalam satu pesan** di `parseDlUrls` ([`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L40-L50)) agar URL kembar dalam satu `/dl` hanya diproses sekali.
3. **Peta *In-Flight* & *Completed Cache* di memori** berkey `(scopeKey, url)` (dengan `scopeKey` terisolasi per Requester saat ada Cookie Profile, sesuai [ADR-0001](file:///Users/vermaysha/lainnya/waha-downloader/docs/adr/0001-per-job-cookie-copy.md)):
   - Pastikan entri *in-flight* selalu dibersihkan di `finally`.
   - Hanya masukkan ke *completed cache* jika download **dan** upload sukses.
   - Hitung `expiresAt` berdasarkan target upload dengan masa berlaku terpendek (wajib `< presignTtlSeconds` untuk R2 presigned URL).
   - Batasi ukuran `Map` (mis. maks 500–1.000 entri) agar jejak RAM tetap di bawah 1 MB pada VPS 2 GB.
