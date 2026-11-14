# Research: Streaming Download (`yt-dlp`) Sekaligus Upload untuk Satu File

**Tanggal:** 2026-11-14  
**Cakupan:** Evaluasi teknis terhadap pertanyaan *"kalau melakukan download sekaligus upload secara bersamaan untuk satu file apakah bisa ya?"* dalam konteks `waha-downloader` (`yt-dlp`, `ffmpeg`, Cloudflare R2 / S3, Google Drive API v3, `temp.sh`, dan runtime `bun`).

---

## Ringkasan Eksekutif (TL;DR)

**Secara teknis bisa, tetapi dengan batasan ketat — dan untuk alur `waha-downloader` saat ini, pendekatan *pure streaming* (tanpa file sementara di disk) lebih banyak menimbulkan masalah daripada manfaat.**

1. **Sisi `yt-dlp` & MP4 (`ffmpeg`):** `yt-dlp` bisa mengeluarkan stream ke `stdout` (`-o -`), tetapi **tidak bisa** menggabungkan (`merge`) video + audio terpisah (`bv*+ba/b`) menjadi MP4 standar secara *streaming* karena container MP4 butuh *seek* mundur untuk menulis atom `moov`. Solusinya (`-movflags frag_keyframe+empty_moov` atau MKV) menghasilkan *fragmented MP4* yang tidak selalu kompatibel penuh dengan semua pemutar video/WhatsApp.
2. **Sisi Target Upload (ukuran total belum diketahui di awal):**
   - **Cloudflare R2 / S3:** `PutObject` tunggal gagal tanpa `Content-Length` (`411 MissingContentLength`). Streaming **wajib** memakai Multipart Upload (`CreateMultipartUpload` → `UploadPart` ≥ 5 MiB → `CompleteMultipartUpload`), yang didukung otomatis oleh `Bun.S3Client`. Khusus R2, semua part non-terakhir **harus berukuran seragam**.
   - **Google Drive API v3:** Mendukung streaming via **Resumable Upload** dengan `Content-Range: bytes <start>-<end>/*` (kelipatan 256 KiB) selama ukuran belum diketahui, lalu difinalisasi dengan total ukuran saat EOF.
   - **`temp.sh`:** Uji empiris langsung ke `https://temp.sh/upload` (`nginx/1.30.3`) menunjukkan server **menerima** `multipart/form-data` tanpa `Content-Length` (baik HTTP/2 maupun HTTP/1.1 `Transfer-Encoding: chunked`, mengembalikan `200 OK`).
3. **Sisi Arsitektur `waha-downloader`:** `CompositeArchive` (multi-target seperti `all` atau `temp,gdrive`), pengecekan `MAX_WHATSAPP_MEDIA_BYTES`, fallback file lokal untuk Google Drive private (`preferLocalFile`), serta *retry* jika upload gagal di tengah jalan semuanya bergantung pada keberadaan file utuh (atau berujung membengkakkan RAM jika di-`tee()`).

---

## 1. Kondisi Alur `waha-downloader` Saat Ini

Saat ini `waha-downloader` memakai pola **download penuh ke disk sementara → upload → hapus**:

- **Download ([`src/downloader.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/downloader.ts)):**
  - `buildYtDlpArgs` menjalankan `yt-dlp --no-playlist --merge-output-format mp4 -f bv*+ba/b ... -o <outputDir>/%(title).80B-%(id).40B.%(ext)s`.
  - Setelah proses selesai, `YtDlpDownloader.download` membaca hasil file di `outputDir` dan memanggil `stat(filePath)` untuk mendapatkan `fileSize` dan `filename`.
- **Upload ([`src/archive.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts)):**
  - `R2Archive.upload`: memanggil `this.client.write(objectKey, Bun.file(filePath), { type: "video/mp4" })`.
  - `TempShArchive.upload`: membaca `file.size` dari `Bun.file(filePath)` untuk mengirim header `Content-Length: String(totalLength)` bersama `ReadableStream` multipart.
  - `GoogleDriveArchive.uploadFile`: mengirim `X-Upload-Content-Length: String(file.size)` saat inisiasi *resumable upload*, lalu mengirim chunk `8 MiB` (`CHUNK_SIZE = 8 * 1024 * 1024`) dengan `Content-Range: bytes ${offset}-${end - 1}/${file.size}`.
  - `CompositeArchive.uploadAll`: mengunggah ke beberapa target secara **sekuensial** (bukan paralel) dengan catatan eksplisit untuk menghindari lonjakan pemakaian RAM pada server ber-RAM rendah.
- **Handler & WAHA ([`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts)):**
  - Membutuhkan `downloaded.fileSize` sebelum mengirim ke WhatsApp (`effectiveMediaBytes <= deps.maxWhatsappMediaBytes`).
  - Jika `uploadResult.preferLocalFile` bernilai `true` (misalnya Google Drive private), `deps.waha.sendVideo` mengirim `filePath: downloaded.filePath` secara lokal.
  - Folder `workDir` baru dihapus di blok `finally` setelah semua proses selesai.

---

## 2. Kendala Sisi Download (`yt-dlp -o -` & Container MP4)

### 2.1 Single-Stream vs Merged Formats (`bv*+ba/b`)

- Di banyak platform (terutama YouTube), kualitas video terbaik disediakan sebagai dua *stream* terpisah: video (`bv*`) dan audio (`ba`).
- Ketika memakai `-o -` (`stdout`), `yt-dlp` memisahkan log ke `stderr` dan data biner ke `stdout` ([yt-dlp README](https://github.com/yt-dlp/yt-dlp)). Namun untuk format terpisah (`bv*+ba`), `yt-dlp` mengandalkan `ffmpeg` untuk menggabungkan (*muxing*) kedua *stream* tersebut.
- Pada format **single-stream** (video+audio sudah dalam satu file, misalnya `-f b`), `yt-dlp -o -` dapat langsung mengalirkan byte ke `stdout` tanpa proses *muxing*.

### 2.2 Masalah Atom `moov` pada MP4 & Output Non-Seekable

Menurut spesifikasi ISO BMFF dan dokumentasi resmi FFmpeg ([ffmpeg-formats.html](https://ffmpeg.org/ffmpeg-formats.html)):

- File **MP4 standar** menyimpan blok metadata indeks penting bernama **atom `moov`** (berisi durasi, daftar *track*, dan offset byte setiap paket di `mdat`).
- Karena ukuran `mdat` dan durasi total baru diketahui setelah proses selesai, muxer MP4 standar pada `ffmpeg` harus melakukan **seek mundur** untuk menulis/memperbarui header.
- Saat output berupa *pipe* (`stdout` / `pipe:1`), output bersifat **non-seekable**. Pengujian langsung dengan `ffmpeg` lokal membuktikan muxer MP4 standar langsung gagal:
  ```text
  $ ffmpeg -v error -f lavfi -i testsrc=duration=1:size=64x64:rate=1 -f mp4 pipe:1 >/dev/null
  [mp4 @ ...] muxer does not support non seekable output
  [out#0/mp4 @ ...] Could not write header (incorrect codec parameters ?): Invalid argument
  ```
- **Workaround di `ffmpeg`:** Menggunakan **fragmented MP4** dengan `-movflags frag_keyframe+empty_moov` (terverifikasi keluar dengan `exit=0` ke `pipe:1`), atau mengganti container ke **Matroska (`mkv`)** / **MPEG-TS**.
  - `empty_moov` menulis atom `moov` awal yang kosong (durasi 0), dan `frag_keyframe` memecah media menjadi fragmen `moof` + `mdat` pada tiap keyframe ([ffmpeg-formats.html](https://ffmpeg.org/ffmpeg-formats.html)).
  - **Konsekuensi:** Sebagian pemutar media lama, editor, atau parser video (termasuk potensi pemrosesan preview/transcoding WhatsApp) dapat bermasalah membaca durasi atau *seeking* pada *fragmented MP4* dengan `empty_moov` awal.

### 2.3 Metadata Sebelum Selesai Tidak Tersedia

Jika `yt-dlp` langsung di-pipe ke `stdout`, aplikasi **tidak mengetahui** `fileSize` dan ekstensi/nama file final yang akurat sebelum EOF tercapai. Ini berdampak langsung ke pengecekan `maxWhatsappMediaBytes` di `src/handler.ts`.

---

## 3. Kendala Sisi Upload: `Content-Length` Tidak Diketahui di Awal

Saat men-stream output `yt-dlp` ke upload secara bersamaan, **total ukuran file (`Content-Length`) belum diketahui** sampai download selesai. Masing-masing target memiliki perilaku berbeda:

| Target | Apakah Mendukung Streaming Tanpa `Content-Length`? | Mekanisme Wajib & Syarat Teknis |
| --- | --- | --- |
| **Cloudflare R2 / S3** | **Ya** (hanya via Multipart) | Wajib `CreateMultipartUpload` → `UploadPart` (≥ 5 MiB, di R2 harus seragam) → `CompleteMultipartUpload`. `PutObject` tunggal ditolak (`411`). |
| **Google Drive API v3** | **Ya** (via Resumable Upload) | Inisiasi tanpa `X-Upload-Content-Length`; kirim chunk kelipatan **256 KiB** dengan `Content-Range: bytes start-end/*`; tutup dengan total akhir saat EOF. |
| **`temp.sh`** | **Ya** (terverifikasi empiris) | `POST https://temp.sh/upload` (`multipart/form-data`) menerima HTTP/2 dan HTTP/1.1 `Transfer-Encoding: chunked` tanpa `Content-Length`. |

### 3.1 Cloudflare R2 / S3 (`R2Archive`)

- **`PutObject` tunggal tidak bisa streaming tanpa ukuran:** Dokumentasi Cloudflare R2 menyatakan request `PUT`/`POST` ke S3 API memerlukan header `Content-Length`; jika tidak ada, R2 mengembalikan error `411 MissingContentLength` ([Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/)). Bahkan protokol AWS SigV4 streaming (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`) mewajibkan header `x-amz-decoded-content-length` di awal ([AWS S3 SigV4 Docs](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-streaming.html)).
- **Multipart Upload adalah satu-satunya jalur streaming:**
  - Ukuran minimum setiap part adalah **5 MiB** (kecuali part terakhir), maksimum **5 GiB**, hingga **10.000 part** ([Cloudflare R2 Multipart](https://developers.cloudflare.com/r2/objects/multipart-objects/)).
  - **Catatan penting khusus R2:** Berbeda dari AWS S3 yang mengizinkan ukuran part non-terakhir bervariasi (asal ≥ 5 MiB), Cloudflare R2 mewajibkan **semua part non-terakhir berukuran seragam**; jika tidak, `CompleteMultipartUpload` gagal dengan `400 InvalidPart` (*"All non-trailing parts must have the same length"*) ([Cloudflare R2 Multipart](https://developers.cloudflare.com/r2/objects/multipart-objects/)).
- **Dukungan Bun `S3Client`:** `Bun.S3Client` mendukung `s3.write(key, readableStream)` dan `s3.file(key, { partSize, queueSize }).writer()` secara native — Bun otomatis mem-buffer per `partSize` (minimal 5 MiB) dan menjalankan `CreateMultipartUpload` / `UploadPart` / `CompleteMultipartUpload` secara paralel di balik layar ([Bun S3 Docs](https://bun.sh/docs/api/s3)). Jadi untuk target tunggal `s3`, Bun sudah mendukung pola ini tanpa menulis logika multipart manual.

### 3.2 Google Drive API v3 (`GoogleDriveArchive`)

Menurut panduan resmi Google Drive API v3 ([Manage Uploads — Resumable](https://developers.google.com/workspace/drive/api/guides/manage-uploads)):

- **Inisiasi sesi:** Kirim `POST` ke `uploadType=resumable` **tanpa** header `X-Upload-Content-Length` (karena panjang total belum diketahui).
- **Kirim chunk intermediate:** Setiap chunk selain chunk terakhir **wajib** berukuran kelipatan **256 KiB** (`262,144` bytes). Gunakan header:
  ```http
  Content-Length: <chunk_size>
  Content-Range: bytes <start>-<end>/*
  ```
  Server akan membalas `308 Resume Incomplete` selama upload belum selesai.
- **Finalisasi saat EOF:** Ketika `yt-dlp` menutup stream dan total ukuran `T` akhirnya diketahui, kirim chunk terakhir (yang boleh tidak kelipatan 256 KiB) dengan total ukuran eksplisit:
  ```http
  Content-Range: bytes <start>-<end>/<T>
  ```
  Jika EOF terjadi tepat di batas chunk sebelumnya (sisa 0 byte), kirim `PUT` kosong dengan `Content-Length: 0` dan `Content-Range: bytes */<T>`. Server akan membalas `200 OK` atau `201 Created` beserta metadata file.

### 3.3 `temp.sh` (`TempShArchive`)

- Dalam spesifikasi HTTP/1.1 (RFC 9112), payload dengan panjang belum diketahui dikirim menggunakan `Transfer-Encoding: chunked` tanpa `Content-Length` ([RFC 9112](https://httpwg.org/specs/rfc9112.html)). Di Bun, `fetch()` mendukung `ReadableStream` sebagai `body` asalkan opsi `duplex: "half"` disertakan ([Bun Fetch Docs](https://bun.com/docs/api/fetch)).
- **Verifikasi empiris langsung** terhadap `https://temp.sh/upload` (melalui `nginx/1.30.3`) pada 2026-11-14:
  - Via HTTP/2 (`curl -sS -i -F "file=@-;filename=test.txt" https://temp.sh/upload`) → **`HTTP/2 200`** dan mengembalikan URL `https://temp.sh/.../test.txt`.
  - Via HTTP/1.1 chunked (`curl --http1.1 -sS -i -F "file=@-;filename=test.txt" https://temp.sh/upload`) → **`HTTP/1.1 200 OK`** dan mengembalikan URL valid.
- Artinya `temp.sh` menerima upload streaming tanpa `Content-Length`. Namun implementasi `TempShArchive` di [`src/archive.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L68-L104) saat ini membaca `file.size` untuk menyetel `Content-Length` secara eksplisit.

---

## 4. Kendala Arsitektural Tambahan pada `waha-downloader`

1. **Multi-target (`both`, `all`, `temp,gdrive`):**
   - Untuk mengirim satu stream `stdout` ke beberapa upload bersamaan, stream harus dipecah dengan `ReadableStream.tee()` atau *broadcast buffer*.
   - Jika salah satu target jauh lebih lambat (mis. `temp.sh` cepat, Google Drive atau R2 lebih lambat), `tee()` akan **menumpuk seluruh selisih data di RAM**, yang justru berisiko OOM di server RAM rendah. Ini bertentangan langsung dengan alasan di [`src/archive.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts#L146-L147) mengapa `CompositeArchive` dibuat sekuensial.
2. **Error Recovery & Retry Tidak Bisa Mundur:**
   - Upload melalui jaringan rentan error sementara (timeout, `503`, reset koneksi). Pada file di disk, `GoogleDriveArchive` atau `R2Archive` dapat mengulang chunk/part dari offset tertentu. Pada *pipe* `yt-dlp`, data yang sudah lewat tidak dapat di-*seek* ulang — kegagalan 1 chunk berarti **seluruh proses download + upload harus diulang dari nol** (kecuali menyimpannya di buffer RAM/disk, yang meniadakan tujuan tanpa-disk).
3. **Interaksi dengan WAHA (`MAX_WHATSAPP_MEDIA_BYTES` & `preferLocalFile`):**
   - [`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts#L243-L260) memeriksa ukuran file sebelum memanggil `sendVideo`, dan untuk Google Drive private (`makePublic=false`) WAHA mengunggah file dari `filePath` lokal. Tanpa file di disk, jalur `preferLocalFile` tidak bisa bekerja.

---

## 5. Kesimpulan & Rekomendasi

| Skenario | Layak Streaming Download + Upload? | Alasan |
| --- | --- | --- |
| **Alur `waha-downloader` saat ini** (`bv*+ba/b` MP4, multi-target, `MAX_WHATSAPP_MEDIA_BYTES`, GDrive private) | **Tidak disarankan** | MP4 merge butuh seekable output, multi-target `tee()` membengkakkan RAM, tidak ada retry mundur, dan handler butuh `fileSize`/`filePath`. |
| **Kasus khusus: 1 target (`s3` atau `temp`), format single-stream / MKV / fMP4, tanpa butuh file lokal** | **Bisa** | Hemat disk I/O dan latensi total berkurang (upload selesai hampir bersamaan dengan download). |

### Rekomendasi untuk `waha-downloader`

1. **Pertahankan arsitektur saat ini (download ke `workDir` → upload sekuensial → `rm`)** sebagai default karena paling stabil untuk `bv*+ba/b` MP4, hemat RAM untuk multi-target, aman untuk retry, dan kompatibel dengan `MAX_WHATSAPP_MEDIA_BYTES` serta `preferLocalFile`.
2. **Jika ingin mengoptimalkan latensi tanpa mengorbankan reliabilitas:**
   - Untuk **R2 (`R2Archive`)**, tetap bisa memakai `Bun.S3Client` yang sudah otomatis melakukan multipart paralel saat membaca `Bun.file(filePath)`.
   - Untuk **multi-target**, jika RAM cukup dan hanya ingin mempercepat fase upload setelah download selesai, `CompositeArchive` bisa diberi opsi paralel terbatas setelah file berada di disk (berbeda dari streaming *download+upload*).

---

## Referensi Sumber Primer

- `yt-dlp` CLI & README (`-o -`, `--merge-output-format`): [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp)
- FFmpeg Muxer Documentation (`frag_keyframe`, `empty_moov`, non-seekable MP4): [ffmpeg.org/ffmpeg-formats.html](https://ffmpeg.org/ffmpeg-formats.html)
- Cloudflare R2 S3 API & Multipart Limits (`411 MissingContentLength`, uniform part size ≥ 5 MiB): [developers.cloudflare.com/r2/api/s3/api](https://developers.cloudflare.com/r2/api/s3/api/) dan [developers.cloudflare.com/r2/objects/multipart-objects](https://developers.cloudflare.com/r2/objects/multipart-objects/)
- AWS S3 SigV4 Streaming (`x-amz-decoded-content-length`): [docs.aws.amazon.com/AmazonS3/latest/API/sigv4-streaming.html](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-streaming.html)
- Google Drive API v3 Resumable Uploads (`256 KiB` chunks, `Content-Range: bytes .../*`): [developers.google.com/workspace/drive/api/guides/manage-uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- Bun S3 & Fetch APIs (`S3Client`, `writer()`, `fetch` `duplex: "half"`): [bun.sh/docs/api/s3](https://bun.sh/docs/api/s3) dan [bun.com/docs/api/fetch](https://bun.com/docs/api/fetch)
- Implementasi repo: [`src/downloader.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/downloader.ts), [`src/archive.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/archive.ts), [`src/handler.ts`](file:///Users/vermaysha/lainnya/waha-downloader/src/handler.ts)
