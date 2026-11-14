# Research: Root Cause Incident OOM-Kill Saat Upload Video 6,47 GB (`waha-downloader`)

**Tanggal:** 2026-11-14  
**Cakupan:** Investigasi insiden OOM-kill pada VPS (2 GB RAM + 2 GB swap) saat mengunggah file MP4 berukuran `6.475.586.763` bytes (~6,47 GB / 6,03 GiB), diverifikasi terhadap sumber primer (WHATWG Streams Standard, `temp.sh`, `bun-types` & perilaku runtime Bun `1.4.4`, serta kode `src/archive.ts` dan `src/handler.ts`).

---

## Ringkasan Eksekutif (TL;DR)

1. **Penyebab Utama OOM-Kill (`TempShArchive.upload`):**  
   Di [`src/archive.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L79-L95), `TempShArchive.upload` membangun `ReadableStream` menggunakan `async start(controller)` berisi loop `while (true)` yang memanggil `reader.read()` dan `controller.enqueue(value)` tanpa jeda dan tanpa memeriksa `controller.desiredSize`.  
   Menurut **WHATWG Streams Standard**, mekanisme *backpressure* hanya bekerja melalui `pull(controller)` (yang dipanggil oleh `ReadableStreamDefaultControllerCallPullIfNeeded` saat `desiredSize > 0`). Karena `start()` berjalan terus-menerus, pembacaan SSD jauh lebih cepat daripada kecepatan upload jaringan sehingga seluruh file 6,47 GB dipompa ke *internal queue* `ReadableStream` di RAM. Di VPS 2 GB RAM + 2 GB swap, pemakaian memori melonjak hingga **1,7G RAM + 1,5G swap (~3,2 GB)** hingga memicu Linux OOM killer.
2. **Upload ke `temp.sh` Sia-Sia untuk File 6,47 GB:**  
   Halaman utama `https://temp.sh/` secara eksplisit menyatakan batas ukuran file adalah **4 GB** (`"Current file size limit is 4GB"`). Mengirim `6.475.586.763` bytes ke `temp.sh` pasti ditolak/gagal.
3. **Temuan Sekunder di `GoogleDriveArchive.uploadFile`:**  
   Di [`src/archive.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L340-L352), `GoogleDriveArchive.uploadFile` mengiris file 8 MiB per iterasi memakai `file.slice(offset, end)` dan langsung mengirim objek `BunFile` tersebut sebagai `body: chunk` ke `fetch()`. Uji empiris pada **Bun `1.4.4`** menunjukkan `fetch()` dengan `BunFile.slice(offset, end)` gagal dengan `TypeError: EAGAIN` pada chunk ke-5 (`offset = 33554432`). Menggunakan `await file.slice(offset, end).arrayBuffer()` (atau buffer `Uint8Array` 8 MiB yang dipakai ulang) menyelesaikan masalah ini dengan RSS tetap rendah (~11 MB).
4. **`R2Archive.upload` (`S3Client.write`) Aman untuk File Besar:**  
   `this.client.write(objectKey, Bun.file(filePath), { type: "video/mp4" })` di [`src/archive.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L31-L34) menggunakan mekanisme multipart streaming bawaan Bun dengan default `partSize = 5 MiB` dan `queueSize = 5` (~25 MiB buffer aktif di memori, jauh di bawah batas 2 GB).
5. **Solusi Backpressure untuk `TempShArchive`:**  
   Mengganti `start()` + `while (true)` menjadi `pull(controller)` pada `ReadableStream` sudah terverifikasi di Bun `1.4.4` menerapkan *backpressure* penuh terhadap `fetch()` (`minDesired = 1`, RSS tetap datar). Alternatif `curl -F file=@...` juga bebas tekanan JS heap/GC, namun menambah dependensi eksternal dan memutus injeksi `fetchFn` untuk unit test.

---

## 1. Kronologi Insiden dari Log Systemd

Berdasarkan log unit `waha-downloader.service` pada VPS (2 GB RAM + 2 GB swap):

| Waktu | Event | Lokasi Kode |
|---|---|---|
| `08:21:09` | `[yt-dlp] Downloading https://x.com/Shino1648576/... (cookies=yes)` | [`src/handler.ts#L210-L212`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L210-L212) |
| `08:27:29` | `[Archive] Uploading ...mp4 (6475586763 bytes) -> ...` | [`src/handler.ts#L219-L221`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L219-L221) |
| `08:31:47` | `waha-downloader.service: A process of this unit has been killed by the OOM killer.` | — |
| Summary | `Consumed 4min 15.900s CPU time, 1.7G memory peak, 1.5G memory swap peak.` | — |

Proses download oleh `yt-dlp` memakan waktu 6 menit 20 detik tanpa OOM. OOM killer baru aktif **4 menit 18 detik setelah fase `[Archive] Uploading` dimulai**, dengan puncak konsumsi **1,7 GiB RAM + 1,5 GiB swap (~3,2 GiB)**.

---

## 2. Analisis `TempShArchive.upload` & WHATWG Streams Backpressure

### 2.1 Kode Bermasalah di `src/archive.ts`

Pada [`src/archive.ts#L79-L95`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L79-L95):

```ts
const bodyStream = new ReadableStream<Uint8Array>({
  async start(controller) {
    try {
      controller.enqueue(header);
      const reader = file.stream().getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        controller.enqueue(value);
      }
      controller.enqueue(footer);
      controller.close();
    } catch (err) {
      controller.error(err);
    }
  },
});
```

### 2.2 Mengapa `start()` + `while (true)` Mem-bypass Backpressure (WHATWG Streams Standard)

Menurut **WHATWG Streams Standard** (`https://streams.spec.whatwg.org/`):

1. **`start(controller)` hanya dipanggil sekali saat konstruksi stream:**  
   Algoritma `start` ditujukan untuk inisialisasi sumber data, bukan untuk mendorong seluruh payload secara tak terkendali.
2. **`desiredSize` hanya bersifat sinyal pasif:**  
   `controller.desiredSize` dihitung dari `highWaterMark - totalQueueSize` (default `highWaterMark` adalah `1` chunk). Ketika consumer (`fetch`) membaca lebih lambat dari producer, `desiredSize` turun menjadi `0` lalu negatif (`-1`, `-2`, ...). Namun menurut spesifikasi, `ReadableStreamDefaultControllerEnqueue` **tidak pernah memblokir atau melempar error** ketika `desiredSize <= 0` — ia tetap memasukkan chunk ke dalam `controller.[[queue]]`.
3. **Backpressure bekerja melalui `pull(controller)`:**  
   Pada model pull-based, runtime memanggil `ReadableStreamDefaultControllerCallPullIfNeeded(controller)`, yang terlebih dahulu memeriksa `ReadableStreamDefaultControllerShouldCallPull(controller)`. Fungsi ini hanya mengembalikan `true` jika stream belum ditutup, `[[started]]` bernilai `true`, dan ada *read request* aktif atau `desiredSize > 0`. Jika queue penuh (`desiredSize <= 0`), `pull()` **tidak dipanggil lagi** sampai consumer mengosongkan queue.

Karena `TempShArchive.upload` memakai `start()` dengan `while (true)` tanpa pernah menunggu `pull()` maupun memeriksa `controller.desiredSize`, loop membaca seluruh `6.475.586.763` bytes dari disk secepat I/O SSD (ratusan MB/s), sementara socket upload ke `temp.sh` hanya menguras beberapa MB/s. Selisihnya menumpuk di `[[queue]]` di RAM hingga menghabiskan 2 GB RAM + 2 GB swap.

### 2.3 Verifikasi Empiris di Bun `1.4.4`

Pengujian langsung pada runtime lokal (`bun 1.4.4`) dengan membaca file 40 MiB melalui `Bun.file(filePath).stream().getReader()` ke server HTTP lokal yang lambat:

- **Pola `start()` + `while (true)` (sama dengan `TempShArchive`):**  
  `minDesired` turun hingga **`-79`** (80 chunk menumpuk di queue internal sekaligus), puncak RSS **`93 MB`** hanya untuk file 40 MiB.
- **Pola `pull(controller)`:**  
  `minDesired` tetap **`1`**, RSS turun menjadi **`57 MB`**.
- **Pola `pull(controller)` dengan chunk 256 KiB ke `fetch()` lambat (20 MiB total):**  
  `pulled: 80`, `minDesired: 1`, durasi `706 ms` (mengikuti kecepatan consumer), RSS **`13 MB`**.

Ini membuktikan dua hal sekaligus:
1. `start()` + `while (true)` benar-benar mem-bypass backpressure di Bun `1.4.4`.
2. `fetch()` di Bun `1.4.4` **memang menerapkan backpressure** ke `ReadableStream` `body` apabila stream tersebut menggunakan `pull(controller)`.

### 2.4 Batas Ukuran `temp.sh` (4 GB)

Pemeriksaan langsung ke sumber primer `https://temp.sh/` menunjukkan metadata dan teks resmi di halaman utama:

- `<meta name="description" content="Temporary File Upload. 3 days. 4GB Size Limit. CLI and ShareX Support">`
- `<p>Current file size limit is 4GB</p>`
- `<p>Files expire after 3 days</p>`

Artinya, mengunggah file `6.475.586.763` bytes (~6,47 GB) ke `https://temp.sh/upload` **pasti gagal** karena melampaui batas 4 GB. `TempShArchive.upload` seharusnya menolak/melewati file di atas batas tersebut sejak awal sebelum membuka stream.

---

## 3. Analisis `GoogleDriveArchive.uploadFile`

Pada [`src/archive.ts#L314-L357`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L314-L357), `GoogleDriveArchive.uploadFile` mengunggah secara *resumable* per `CHUNK_SIZE = 8 * 1024 * 1024` (8 MiB):

```ts
const chunk = file.slice(offset, end);
const uploadRes = await this.fetchFn(uploadUrl, {
  method: "PUT",
  headers: {
    "Content-Type": "video/mp4",
    "Content-Length": String(end - offset),
    "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`,
  },
  body: chunk,
});
```

Menurut definisi tipe resmi Bun di [`node_modules/bun-types/bun.d.ts#L2684-L2694`](file:///Users/vermaysha/lainnya/waha-downloader/node_modules/bun-types/bun.d.ts#L2684-L2694):
> `slice(begin?: number, end?: number, contentType?: string): BunFile` — *"Does not copy the file, open the file, or modify the file. If `begin` > 0, `Bun.write()` is slower on macOS"*.

`Bun.file().slice()` sendiri hanya membuat view/referensi offset tanpa menyalin ke RAM. **Namun**, pengujian empiris di **Bun `1.4.4`** terhadap loop `PUT` 8 MiB pada file 64 MiB menemukan bug/perilaku penting saat `BunFile` slice diteruskan langsung sebagai `body: chunk` ke `fetch()`:

- **Mengirim `file.slice(offset, end)` langsung ke `fetch()`:**  
  Berhasil untuk 4 chunk pertama (`offset = 0`, `8388608`, `16777216`, `25165824`), lalu **gagal pada chunk ke-5 (`offset = 33554432`)** dengan:
  ```text
  TypeError: EAGAIN fetching "http://127.0.0.1:.../upload" (code: "EAGAIN")
  ```
- **Mengirim `await file.slice(offset, end).arrayBuffer()` ke `fetch()`:**  
  Berhasil penuh untuk seluruh 8 chunk, dengan hasil akhir `rssAfter: 11 MB`, `heapMB: 0` setelah `Bun.gc(true)`.

Jadi meskipun `GoogleDriveArchive.uploadFile` bukan penyebab OOM 3,2 GB pada insiden ini, mengganti `body: chunk` menjadi `await chunk.arrayBuffer()` (atau membaca 8 MiB per iterasi ke dalam satu `Uint8Array` yang dipakai ulang via `fs/promises` `FileHandle.read`) jauh lebih bersih, deterministik, dan menghindari error `EAGAIN` pada Bun `1.4.4`.

---

## 4. Analisis `R2Archive.upload` (`S3Client.write`)

Pada [`src/archive.ts#L31-L34`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L31-L34):

```ts
await this.client.write(objectKey, Bun.file(filePath), {
  type: "video/mp4",
});
```

Berdasarkan definisi tipe resmi Bun di [`node_modules/bun-types/s3.d.ts#L250-L278`](file:///Users/vermaysha/lainnya/waha-downloader/node_modules/bun-types/s3.d.ts#L250-L278) dan [`node_modules/bun-types/s3.d.ts#L1048-L1060`](file:///Users/vermaysha/lainnya/waha-downloader/node_modules/bun-types/s3.d.ts#L1048-L1060):

- `S3Client.write(path, BunFile, options)` mendukung `BunFile` secara native dan secara otomatis melakukan **multipart upload** untuk file besar.
- Konfigurasi default multipart di Bun `S3Client`:
  - `partSize`: **5 MiB** (minimum `5 MiB`, maksimum `5120 MiB`).
  - `queueSize`: **5** part paralel (maksimum `255`).
- Konsekuensi memori: pada konfigurasi default, buffer part in-flight di memori hanya sekitar `5 × 5 MiB = 25 MiB` (bukan 6,47 GB). Untuk file `6.475.586.763` bytes dengan `partSize = 5 MiB`, jumlah part adalah ~1.236 part — masih jauh di bawah batas maksimum 10.000 part S3/R2.
- Catatan tambahan: [`CompositeArchive.uploadAll`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L142-L177) sudah menjalankan target upload secara **sekuensial** (bukan paralel), sehingga `R2Archive` dan `TempShArchive` tidak berjalan bersamaan. Pada VPS 2 GB RAM, `R2Archive` dapat dibuat lebih hemat lagi jika diinginkan dengan `queueSize: 2` (10 MiB in-flight), tetapi secara default pun `R2Archive` bukan penyebab OOM.

---

## 5. Perbandingan Solusi Backpressure untuk `TempShArchive`

| Pendekatan | Mekanisme Backpressure | Pemakaian RAM | Dependensi & Testability |
|---|---|---|---|
| **`ReadableStream` dengan `pull(controller)`** | Native WHATWG Streams (`ReadableStreamDefaultControllerCallPullIfNeeded` hanya memanggil `pull` saat `desiredSize > 0`). Terverifikasi di Bun `1.4.4` bahwa `fetch()` menghormati backpressure ini. | Rendah & konstan (hanya ~1 chunk aktif + overhead runtime). | Murni TypeScript/Bun, tidak butuh binary eksternal, tetap kompatibel dengan `fetchFn` DI di unit test. |
| **`curl` subprocess (`curl -sS -f -F file=@...`)** | Native C `libcurl` membaca dari file descriptor dalam buffer tetap (~16–64 KiB) sesuai laju TCP/TLS socket. | Sangat rendah (~2–5 MB RSS, nol tekanan JS heap/GC). | Butuh binary `curl` di VPS/container dan mem-bypass `fetchFn` DI kecuali di-abstraksi di level runner. |

**Kesimpulan Teknis:**  
Mengubah `TempShArchive.upload` dari `start()` + `while (true)` ke `pull(controller)` (disertai `cancel()` untuk menutup `reader`) **sudah menyelesaikan masalah backpressure secara tuntas** di Bun `1.4.4` tanpa perlu `curl`, asalkan juga disertai pengecekan batas ukuran **4 GB** milik `temp.sh` agar file 6,47 GB tidak sia-sia diunggah.
