# Research: Efisiensi Disk & Memori `waha-downloader` pada VM Ber-Resource Terbatas

**Tanggal:** 2026-11-14  
**Cakupan:** Audit menyeluruh terhadap penggunaan **disk** dan **memori (RAM/swap)** di `waha-downloader` dengan asumsi dijalankan di VM ber-resource terbatas (mis. 512 MB–2 GB RAM dan disk kecil), diverifikasi terhadap kode sumber (`src/index.ts`, `src/config.ts`, `src/downloader.ts`, `src/archive.ts`, `src/handler.ts`, `src/waha.ts`, `src/cleanup.ts`, `README.md`) serta sumber primer (`bun --help` / dokumentasi Bun `1.4.4` di `node_modules/bun-types`, `yt-dlp --help`, `ffmpeg`, dokumentasi Linux kernel `tmpfs`, dan `systemd.resource-control(5)`).

---

## Ringkasan Eksekutif (TL;DR)

Secara keseluruhan, jalur streaming utama (`GoogleDriveArchive` dan `TempShArchive` dengan `pull()`) sudah hemat memori (~8–15 MiB RSS). Namun, ada **temuan kritis** dan beberapa optimasi bernilai tinggi jika `waha-downloader` dijalankan di VM dengan RAM dan disk terbatas:

| Prioritas | Kategori | Temuan & Dampak | Lokasi Kode |
|---|---|---|---|
| **P0 (Kritis)** | **Disk / RAM** | `TempShArchive` membuat folder split di `os.tmpdir()` (`/tmp`). Di banyak VM Linux, `/tmp` adalah `tmpfs` (berbasis RAM + swap), sehingga video >3,8 GB akan ditulis ke RAM/swap dan memicu OOM atau `ENOSPC`. | [`src/archive.ts#L253`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L253) |
| **P1 (Tinggi)** | **Disk** | `TempShArchive` baru menghapus seluruh segmen split di blok `finally` setelah semua part selesai diunggah, padahal tiap part bisa langsung dihapus segera setelah `uploadSingleFile(partPath)` sukses. | [`src/archive.ts#L268-L281`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L268-L281) |
| **P1 (Tinggi)** | **Memori & Disk** | `DOWNLOAD_CONCURRENCY` default adalah `2`. Dua proses `yt-dlp` + `ffmpeg` paralel menggandakan puncak pemakaian disk (hingga 2×2 = 4× ukuran video saat merge `bv*+ba`) dan RAM. | [`src/config.ts#L300-L304`](file:///Users/vermaysha/lainnya/waha-downloader/src/config.ts#L300-L304) |
| **P1 (Tinggi)** | **Memori** | Jalur `GDRIVE_PUBLIC=false` (`preferLocalFile: true`) memicu `WahaClient.sendVideo` membaca file utuh ke RAM lalu encode base64 + `JSON.stringify` (~3×–4× ukuran file di RAM). | [`src/waha.ts#L129-L154`](file:///Users/vermaysha/lainnya/waha-downloader/src/waha.ts#L129-L154) |
| **P2 (Sedang)** | **Disk** | `yt-dlp` dipanggil tanpa `--no-cache-dir`, sehingga cache permanen di `${XDG_CACHE_HOME}/yt-dlp` (`~/.cache/yt-dlp`) dapat terus menumpuk pada disk VM yang kecil. | [`src/downloader.ts#L16-L33`](file:///Users/vermaysha/lainnya/waha-downloader/src/downloader.ts#L16-L33) |
| **P2 (Sedang)** | **Memori** | `R2Archive` memakai default `Bun.S3Client` (`partSize = 5 MiB`, `queueSize = 5`), yang menahan hingga ~25 MiB buffer multipart aktif di memori. Menurunkan `queueSize` ke `1`–`2` menurunkannya ke ~5–10 MiB. | [`src/archive.ts#L33-L36`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L33-L36) |
| **P2 (Sedang)** | **Memori** | Unit `systemd` di `README.md` belum memakai `bun --smol` maupun batas cgroup `MemoryHigh=` / `MemoryMax=` untuk menahan lonjakan heap JSC dan mencegah hang sistem. | [`README.md#L88-L105`](file:///Users/vermaysha/lainnya/waha-downloader/README.md#L88-L105) |

---

## 1. Audit Efisiensi Disk

### 1.1 `os.tmpdir()` (`/tmp`) vs `config.tmpDir` pada `TempShArchive` (Kritis)

- **Kondisi di Kode:**
  - `config.tmpDir` default bernilai `"tmp"` (dapat diubah via `TMP_DIR`) pada [`src/config.ts#L312`](file:///Users/vermaysha/lainnya/waha-downloader/src/config.ts#L312), dan seluruh unduhan `yt-dlp` serta salinan cookie sementara ditaruh di sana ([`src/handler.ts#L273-L281`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L273-L281)).
  - Namun, saat video melebihi `TEMP_SH_SPLIT_THRESHOLD_BYTES` (`3_800_000_000` bytes / ~3,8 GB), `TempShArchive.uploadAll` membuat direktori split memakai `os.tmpdir()`:
    [`src/archive.ts#L253`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L253):
    ```ts
    const splitDir = await mkdtemp(join(tmpdir(), "waha-dl-split-"));
    ```
  - `cleanupTempStorage` di [`src/cleanup.ts#L9-L33`](file:///Users/vermaysha/lainnya/waha-downloader/src/cleanup.ts#L9-L33) juga ikut membersihkan `waha-dl-split-*` di `systemTmpDir = tmpdir()` saat startup.
- **Verifikasi Sumber Primer (Linux Kernel `tmpfs`):**
  - Menurut dokumentasi resmi Linux kernel (`tmpfs` — [kernel.org](https://www.kernel.org/doc/html/latest/filesystems/tmpfs.html)) dan `mount(8)`, `tmpfs` menyimpan seluruh file di **page cache RAM kernel** dan hanya dapat di-*swap out* ke ruang swap jika tersedia, dengan ukuran maksimum default **50% dari RAM fisik**.
  - Pada banyak distribusi Linux modern dan image VM/container, `/tmp` di-mount sebagai `tmpfs`. Jika VM memiliki 1–2 GB RAM, menulis segmen split >3,8 GB ke `os.tmpdir()` (`/tmp`) akan langsung gagal dengan `ENOSPC` (meski disk utama masih luas) atau memenuhi RAM + swap hingga memicu OOM killer.
- **Rekomendasi:**
  - Arahkan `splitDir` di `TempShArchive` agar menggunakan `config.tmpDir` (yang berada di disk persisten, bukan `os.tmpdir()`), dengan meneruskan `tmpDir` melalui `TempShArchiveConfig` di `createArchive(config)` ([`src/archive.ts#L600-L605`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L600-L605)).

### 1.2 Penghapusan Bertahap Segmen Split `TempShArchive` & Urutan `CompositeArchive`

- **Kondisi di Kode:**
  - Di [`src/archive.ts#L263-L281`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L263-L281), `splitVideoWithFfmpeg` memecah file ke semua `partPaths`, lalu loop `for (const partPath of partPaths)` mengunggah satu per satu. Seluruh `splitDir` baru dihapus di blok `finally` setelah loop selesai.
  - Pada `CompositeArchive.uploadAll` ([`src/archive.ts#L305-L343`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L305-L343)), target diunggah secara sekuensial sesuai urutan `config.uploadTargets` (`UPLOAD_TARGET=all` menghasilkan `["s3", "temp", "gdrive"]` di [`src/config.ts#L59-L61`](file:///Users/vermaysha/lainnya/waha-downloader/src/config.ts#L59-L61)).
- **Dampak Disk:**
  - Selama `TempShArchive` mengunggah part 1..N, seluruh segmen (~1× ukuran file asli) tetap bertahan di disk bersama file asli (~1×) hingga part terakhir selesai diunggah.
  - Menghapus setiap `partPath` segera setelah `await this.uploadSingleFile(partPath)` berhasil (mis. `await rm(partPath, { force: true })`) membebaskan ruang disk secara progresif di setiap iterasi.
  - Selain itu, menempatkan `temp` di urutan paling akhir pada `UPLOAD_TARGET` memastikan target persisten (`s3`, `gdrive`) selesai lebih dulu sebelum `TempShArchive` mengalokasikan direktori split sementara (dan menghindari split sia-sia bila target sebelumnya gagal). Catatan: selama `CompositeArchive` dan `handler.ts` masih memegang `filePath` asli sampai blok `finally` di [`src/handler.ts#L398-L402`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L398-L402), file asli tetap berada di disk hingga semua target selesai.

### 1.3 `yt-dlp`: `--no-cache-dir` dan Puncak Disk 2× Saat Merge `bv*+ba`

- **Verifikasi `yt-dlp --help` (versi terpasang `2026.10.26`):**
  - `yt-dlp --help` mendokumentasikan:
    - `--cache-dir DIR`: *"Location in the filesystem where yt-dlp can store some downloaded information (such as client ids and signatures) permanently. By default `${XDG_CACHE_HOME}/yt-dlp`"*
    - `--no-cache-dir`: *"Disable filesystem caching"*
- **Kondisi di Kode:**
  - `buildYtDlpArgs` di [`src/downloader.ts#L16-L33`](file:///Users/vermaysha/lainnya/waha-downloader/src/downloader.ts#L16-L33) **tidak** menyertakan `--no-cache-dir`. Pada VM dengan partisi root kecil, `${XDG_CACHE_HOME}/yt-dlp` (`~/.cache/yt-dlp`) dapat menumpuk tanpa pembersihan otomatis.
  - `buildYtDlpArgs` memakai `--merge-output-format mp4 -f bv*+ba/b` ([`src/downloader.ts#L19-L22`](file:///Users/vermaysha/lainnya/waha-downloader/src/downloader.ts#L19-L22)). Untuk video dengan stream video dan audio terpisah, `yt-dlp` mengunduh kedua stream ke `workDir` lalu menjalankan `ffmpeg` untuk menggabungkannya ke `.mp4` sebelum menghapus file perantara. Saat fase muxing `ffmpeg` ini, **file perantara (~1×) dan file hasil merge (~1×) hadir bersamaan di disk**, sehingga kebutuhan puncak disk per pekerjaan adalah **~2× ukuran video akhir**.

### 1.4 `MAX_WHATSAPP_MEDIA_BYTES` dan `cleanupTempStorage`

- **Kondisi di Kode:**
  - `MAX_WHATSAPP_MEDIA_BYTES` default `50 * 1024 * 1024` (50 MiB) di [`src/config.ts#L307-L311`](file:///Users/vermaysha/lainnya/waha-downloader/src/config.ts#L307-L311).
  - Di [`src/handler.ts#L352-L358`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L352-L358), batas ini hanya dipakai setelah download & upload selesai untuk memutuskan apakah WAHA mengirim video langsung (`sendVideo`) atau teks tautan (`sendText`). Nilai ini **tidak** membatasi ukuran unduhan `yt-dlp` (tidak ada argumen `--max-filesize` di `buildYtDlpArgs`).
  - `cleanupTempStorage` ([`src/cleanup.ts#L9-L33`](file:///Users/vermaysha/lainnya/waha-downloader/src/cleanup.ts#L9-L33)) hanya dipanggil sekali saat startup di [`src/index.ts#L10`](file:///Users/vermaysha/lainnya/waha-downloader/src/index.ts#L10). Pembersihan per-pekerjaan bergantung pada blok `catch`/`finally` di [`src/handler.ts#L322`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L322) dan [`#L399-L401`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L399-L401) serta `finally` di [`src/archive.ts#L280`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L280). Jika proses mati mendadak (`SIGKILL` / OOM), file sisa baru dibersihkan saat restart berikutnya.

---

## 2. Audit Efisiensi Memori (RAM & Swap)

### 2.1 Flag `bun --smol`

- **Verifikasi Sumber Primer (`bun --help` & `node_modules/bun-types/docs/`):**
  - Output `bun --help` (Bun `1.4.4`):
    ```text
    --smol                          Use less memory, but run garbage collection more often
    ```
  - Dokumentasi resmi Bun di `node_modules/bun-types/docs/runtime/index.mdx` (baris 207–215) dan `docs/runtime/workers.mdx` (baris 291) menjelaskan:
    - `--smol` mengatur `JSC::HeapSize` menjadi `Small` (alih-alih `Large`), dan memaksa *garbage collector* berjalan lebih sering agar pertumbuhan heap lebih lambat di lingkungan dengan batas memori ketat (termasuk cgroups), dengan kompensasi sedikit penurunan kecepatan eksekusi JS.
- **Kondisi di Kode:**
  - `README.md#L38` (`bun run src/index.ts`) dan template unit systemd di [`README.md#L99`](file:///Users/vermaysha/lainnya/waha-downloader/README.md#L99) (`ExecStart=%h/.bun/bin/bun run src/index.ts`) belum memakai `--smol` (`bun --smol run src/index.ts`).

### 2.2 `R2Archive` (`S3Client.write` / `partSize` & `queueSize`)

- **Kondisi di Kode:**
  - [`src/archive.ts#L25-L36`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L25-L36) memanggil:
    ```ts
    await this.client.write(objectKey, Bun.file(filePath), {
      type: "video/mp4",
    });
    ```
- **Verifikasi Sumber Primer (`node_modules/bun-types/s3.d.ts`):**
  - Pada `S3Options` (`node_modules/bun-types/s3.d.ts#L250-L293`), opsi multipart upload yang tersedia adalah:
    - `partSize?: number` — Minimum `5 MiB`, Maksimum `5120 MiB`, **Default: `5 MiB`**.
    - `queueSize?: number` — Jumlah part yang diunggah paralel, Maksimum `255`, **Default: `5`** (*"Increasing this value can improve upload speeds for large files but uses more memory"*).
    - `retry?: number` — **Default: `3`**.
- **Implikasi Memori:**
  - Dengan konfigurasi default (`partSize = 5 MiB`, `queueSize = 5`), `S3Client` dapat menahan hingga **`5 × 5 MiB = 25 MiB`** buffer part aktif di memori per upload.
  - Di VM ber-RAM sangat kecil (mis. 512 MB), meneruskan `queueSize: 1` (atau `2`) dan `partSize: 5 * 1024 * 1024` ke `S3Client` atau `this.client.write(..., { type: "video/mp4", queueSize: 1, partSize: 5 * 1024 * 1024 })` menurunkan buffer aktif menjadi **~5–10 MiB** (dengan trade-off throughput upload ke R2 lebih rendah karena tidak paralel 5 part).

### 2.3 `WahaClient.sendVideo` dengan Base64 (`GDRIVE_PUBLIC=false`)

- **Kondisi di Kode:**
  - Jika `GDRIVE_PUBLIC=false`, `GoogleDriveArchive.uploadAll` mengembalikan `preferLocalFile: true` ([`src/archive.ts#L589`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L589)).
  - Di [`src/handler.ts#L349-L355`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L349-L355), batas ukuran dihitung dengan `effectiveMediaBytes = Math.ceil((fileSize * 4) / 3) + 1024` agar muat dalam `maxWhatsappMediaBytes` (default 50 MiB, sehingga ukuran file mentah maksimal ~37,5 MiB).
  - Saat mengirim ke WAHA di [`src/waha.ts#L129-L154`](file:///Users/vermaysha/lainnya/waha-downloader/src/waha.ts#L129-L154):
    ```ts
    data: Buffer.from(
      await Bun.file(params.filePath).arrayBuffer(),
    ).toString("base64"),
    ```
    lalu dibungkus dengan `body: JSON.stringify({ ..., file })`.
- **Dampak Memori:**
  - Untuk file berukuran $S$, jalur ini mengalokasikan di RAM secara bersamaan:
    1. `ArrayBuffer` mentah ($\approx 1\times S$),
    2. String hasil `.toString("base64")` ($\approx 1,33\times S$),
    3. String JSON dari `JSON.stringify` ($\approx 1,33\times S$, ditambah buffer UTF-8 saat `fetch()` mengirim body).
  - Total puncak memori mencapai **~3×–4× ukuran file** (~110–150 MiB untuk file ~37,5 MiB dengan batas default 50 MiB, dan akan membesar proporsional jika `MAX_WHATSAPP_MEDIA_BYTES` dinaikkan).
  - Sebaliknya, jika `GDRIVE_PUBLIC=true` (atau target `s3` / `temp`), `WahaClient.sendVideo` hanya mengirim `{ url: params.videoUrl }` ([`src/waha.ts#L140`](file:///Users/vermaysha/lainnya/waha-downloader/src/waha.ts#L140)) sehingga pemakaian RAM di proses `waha-downloader` hampir nol.

### 2.4 `GoogleDriveArchive` & `TempShArchive` (Sudah Hemat Memori)

- **`GoogleDriveArchive.uploadFile`** ([`src/archive.ts#L480`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L480), [`#L506-L523`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L506-L523)):
  - Memakai `CHUNK_SIZE = 8 * 1024 * 1024` (**8 MiB**, kelipatan 256 KiB sesuai syarat Google Drive API v3 resumable upload).
  - Setiap iterasi hanya membaca satu irisan `await file.slice(offset, end).arrayBuffer()` ke `Uint8Array`, sehingga footprint memori stabil di kisaran **~8–16 MiB** meski file berukuran beberapa GB.
- **`TempShArchive.uploadSingleFile`** ([`src/archive.ts#L185-L218`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L185-L218)):
  - Memakai `ReadableStream` dengan `pull(controller)` yang membaca `file.stream().getReader()` hanya ketika konsumen (`fetch()`) meminta chunk berikutnya (*backpressure* penuh sesuai WHATWG Streams Standard), sehingga RSS tetap datar di kisaran **~8–15 MiB**.
- **`CompositeArchive.uploadAll`** ([`src/archive.ts#L309-L336`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L309-L336)):
  - Sudah mengunggah antar-target secara **sekuensial** (bukan `Promise.all`), sehingga buffer upload dari `R2Archive`, `GoogleDriveArchive`, dan `TempShArchive` tidak bertumpuk bersamaan.

### 2.5 Konkurensi (`DOWNLOAD_CONCURRENCY=1`) & `systemd` `MemoryHigh`

- **`DOWNLOAD_CONCURRENCY=1`:**
  - Default di [`src/config.ts#L300-L304`](file:///Users/vermaysha/lainnya/waha-downloader/src/config.ts#L300-L304) adalah `2`. Pada VM dengan RAM 512 MB–1 GB dan disk kecil, menurunkan `DOWNLOAD_CONCURRENCY=1` di `.env` langsung memangkas puncak penggunaan disk (menghindari dua proses merge `bv*+ba` 2× sekaligus) dan mencegah dua proses `yt-dlp`/`ffmpeg` + dua upload berjalan paralel.
- **`systemd` `MemoryHigh=` & `MemoryMax=`:**
  - Menurut `systemd.resource-control(5)` ([freedesktop.org](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html)):
    - `MemoryHigh=` (memetakan ke cgroup v2 `memory.high`) adalah **soft limit**: saat pemakaian memori unit melewati batas ini, kernel memperlambat alokasi proses (*throttling*) dan agresif melakukan *reclaim* halaman memori/swap tanpa langsung membunuh proses.
    - `MemoryMax=` (cgroup v2 `memory.max`) adalah **hard limit**: jika tetap terlampaui dan tidak bisa di-reclaim, OOM killer kernel dijalankan khusus di dalam cgroup unit tersebut sehingga tidak menjatuhkan proses lain (seperti WAHA atau SSH) di VM.
  - Contoh konfigurasi di [`README.md#L94-L102`](file:///Users/vermaysha/lainnya/waha-downloader/README.md#L94-L102) dapat diperkuat pada VM terbatas (mis. VM 1 GB RAM) dengan menambahkan `MemoryHigh=` (mis. `512M`) dan `MemoryMax=` (mis. `768M`) serta `ExecStart=%h/.bun/bin/bun --smol run src/index.ts`.

---

## 3. Ringkasan Rekomendasi Praktis

1. **Perbaikan Kode Prioritas Tinggi (Disk & Memori):**
   - Pindahkan `splitDir` `TempShArchive` dari `tmpdir()` ke `config.tmpDir` ([`src/archive.ts#L253`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L253)) agar tidak pernah menulis file multi-GB ke `tmpfs` `/tmp`.
   - Hapus setiap `partPath` segera setelah `uploadSingleFile(partPath)` selesai di [`src/archive.ts#L269-L271`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L269-L271).
   - Tambahkan `--no-cache-dir` pada `buildYtDlpArgs` di [`src/downloader.ts#L16-L28`](file:///Users/vermaysha/lainnya/waha-downloader/src/downloader.ts#L16-L28).
   - Pertimbangkan `queueSize: 1` (atau konfigurasi env) pada `R2Archive` (`S3Client`) di [`src/archive.ts#L25-L36`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L25-L36) untuk memangkas buffer multipart dari ~25 MiB menjadi ~5 MiB.
2. **Konfigurasi Deployment untuk VM Terbatas (Tanpa Ubah Kode):**
   - Set `DOWNLOAD_CONCURRENCY=1` di `.env`.
   - Pertahankan `GDRIVE_PUBLIC=true` (atau gunakan `s3`/`temp`) agar `WahaClient.sendVideo` tidak memuat file ke RAM untuk base64 + `JSON.stringify`.
   - Jika memakai multi-target (`UPLOAD_TARGET`), tempatkan `temp` di urutan terakhir (mis. `s3,gdrive,temp`).
   - Jalankan dengan `bun --smol run src/index.ts` dan tambahkan `MemoryHigh=` + `MemoryMax=` di unit `systemd`.
