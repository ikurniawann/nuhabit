# EPIC-018: Lampiran & OCR — Do Bisa Membaca Dokumen

status: ready-for-qa
environment: dev
retries: 0

## Goal

Do bisa menerima lampiran (foto, PDF, DOCX, Excel, CSV), membaca isinya, lalu
menjawab berdasarkan dokumen itu. Lib ekstraksinya dibuat bebas-modul sejak awal
karena purchasing akan memakainya untuk scan nota/faktur di epic terpisah.

## Evidence (2026-07-21)

1. **OCR sudah ada dan sudah bekerja** — bukan perlu "diaktifkan". `tesseract.js`
   v7 terpasang, dipakai `src/lib/recruitment/cv-extract.ts` untuk CV kandidat.
   Diuji langsung: gambar berisi "Faktur Pembelian Nomor 12345" terbaca persis
   dalam < 1 detik.
2. **Data bahasa sudah lokal** — `eng.traineddata` (5,2 MB) dan `ind.traineddata`
   (1,8 MB) di root repo adalah cache unduhan tesseract.js, jadi OCR tidak lagi
   bergantung koneksi ke CDN saat runtime.
3. **Pipeline dokumen sudah terbukti** — `cv-extract.ts` menangani PDF (unpdf),
   DOCX (mammoth), gambar (OCR), plus fallback OCR untuk PDF hasil scan. Tetapi
   ia terikat ke storage rekrutmen (`cvUrlToDiskPath`), jadi tidak bisa dipakai
   ulang apa adanya.
4. **`xlsx` sudah jadi dependensi** — Excel tidak butuh paket baru.

## Keputusan Owner (2026-07-21)

- Mulai dari **chat Do**; purchasing menyusul sebagai modul terpisah.
- **Excel/CSV wajib didukung** agar file bisa dianalisis, bukan cuma dokumen teks.

## Scope

**Fase A — Lampiran di chat Do (selesai)**
- `src/lib/attachments/extract.ts`: ekstraksi bebas-modul (Buffer + nama file).
- `POST /api/ai/assistant/attachment`: unggah → teks, ber-guard login.
- UI chat: tombol klip, daftar lampiran, hapus per item, kirim bersama pesan.

**Fase B — Purchasing (selesai)**
- Scan nota/faktur mengisi otomatis nomor, tanggal, dan total.
- Penyimpanan file permanen (arsip nota menempel ke pembayaran vendor) +
  pemetaan hasil OCR ke field form pembayaran.
- Keputusan penempatan (owner 25 Jul): BUKAN halaman baru — upload menempel di
  dialog pembayaran invoice (`purchase-invoice-pay-dialog`, shared 3 modul
  RM/product/general), karena di situlah titik input nomor/tanggal/jumlah.

## Non-Goals

- Menyimpan file lampiran chat secara permanen (lihat Keputusan Desain).
- Analisis gambar non-teks (grafik, foto produk) — itu ranah vision, bukan OCR.

## Keputusan Desain

- **File chat tidak disimpan.** Yang dibutuhkan Do hanya teksnya; menyimpan
  dokumen HR/keuangan yang diunggah sambil lalu menambah permukaan kebocoran
  tanpa manfaat jelas. Purchasing yang butuh arsip akan menyimpan di modulnya.
- **Spreadsheet dirender sebagai CSV per sheet**, bukan JSON. Bentuk datar lebih
  mudah dianalisis model dan jauh lebih hemat token daripada objek per sel.
- **Validasi berdasarkan ekstensi, bukan MIME** — MIME dari browser mudah
  dipalsukan, dan pemilihan ekstraktor memang bergantung ekstensi.
- **Lampiran hanya ikut satu pesan** lalu dikosongkan, supaya pertanyaan
  berikutnya tidak diam-diam membawa dokumen lama.

## Batas yang Ditegakkan

| Batas | Nilai | Alasan |
|---|---|---|
| Ukuran file | 10 MB | OCR file besar bisa menghabiskan memori & waktu |
| Teks per file | 20.000 char | Melindungi jendela konteks |
| Total semua lampiran | 40.000 char | Satu pesan tidak boleh membengkak tak terkendali |
| Jumlah file | 5 | Idem |
| Timeout OCR | 120 detik | Scan padat butuh waktu, tapi tidak boleh menggantung |

## Acceptance Criteria

- [x] PDF, DOCX, gambar, XLSX, dan CSV bisa dilampirkan dan terbaca.
- [x] PDF hasil scan (tanpa lapisan teks) otomatis jatuh ke OCR.
- [x] Endpoint menolak tanpa login, file kosong, terlalu besar, dan format asing.
- [x] Teks yang terlalu panjang dipotong dan ditandai, bukan diam-diam hilang.
- [x] Lampiran bisa dihapus sebelum dikirim.
- [ ] Uji end-to-end di browser dengan sesi login (unggah → tanya → jawab).
- [x] Fase B: scan nota di dialog pembayaran mengisi tanggal/nomor/jumlah
      otomatis; file terarsip permanen dan bisa dilihat lagi dari riwayat
      pembayaran PO; parsing gagal tidak menggagalkan unggah (isi manual).

## Test Plan

- Unit: dukungan format, pemotongan teks, pembersihan baris, spreadsheet → CSV,
  penolakan file kosong & format asing (8 test).
- Manual: lampirkan foto nota, PDF, dan Excel; pastikan jawaban Do memakai isinya.

## Catatan Teknis Penting

OCR **tidak bisa diuji di vitest**: environment jsdom membuat tesseract.js
me-resolve path worker sebagai URL (`http://localhost:3000/…/worker-script/node/
index.js`) sehingga gagal. Ini murni artefak lingkungan test — jalur yang sama
diverifikasi berhasil di runtime Node sungguhan (`node harness.mjs` →
"Faktur Pembelian Nomor 12345"), dan route memakai `runtime = "nodejs"`.
Karena itu unit test sengaja tidak mencakup OCR; verifikasinya manual.

## Automation Log

- 2026-07-25 — **Fase B selesai: scan nota di pembayaran purchasing — status →
  ready-for-qa.** Desain UX untuk pengguna sangat awam (permintaan owner):
  satu tombol besar "Foto / Unggah Nota" (dashed, ikon kamera) di dialog
  pembayaran, bahasa polos tanpa istilah teknis, hasil baca = prefill yang
  selalu bisa dikoreksi (bukan kebenaran), dan gagal OCR ≠ gagal unggah.
  - **Arsip permanen**: `storage/private/purchasing-receipts/<yyyy>/<mm>` via
    `savePrivateDocument` (magic-bytes, PDF/JPG/PNG/WebP); kolom
    `vendor_payments.receipt_path`+`receipt_name` (migrasi `20260725110000`,
    applied). Riwayat pembayaran di detail PO menampilkan tautan "Lihat Nota".
  - **Pemetaan OCR → field**: `src/lib/purchasing/receipt-scan.ts` murni
    (15 unit test): `parseAmount` (format 1.234.567 / 1,234,567.00 / desimal),
    `findDate` (dd/mm/yyyy, dd-mm-yy, nama bulan Indonesia, fallback mm/dd),
    `findNumber` (label No/Nomor/Invoice/Faktur/Nota/Ref; iterasi semua
    kandidat — "Jl. Merdeka No. 12" di kop tidak menghentikan pencarian;
    tanggal murni ditolak), `findTotal` (baris berkata-kunci total, angka
    paling kanan, nilai terbesar antar kandidat; `\b` menyaring "Subtotal").
  - **Endpoint**: `POST /api/purchasing/receipt-scan` (role selaras pembayaran:
    admin/super_admin/purchasing_admin/finance_staff; ≤10 MB; foto/PDF saja;
    simpan dulu → ekstraksi best-effort) dan `GET /api/purchasing/receipts/
    [...path]` (penyaji ber-auth + direksi; anti-traversal; inline + nosniff).
    Path di payload pembayaran divalidasi regex `^purchasing-receipts/` agar
    record tidak bisa menunjuk file private lain.
  - **UX dialog**: status "Sedang membaca nota… 5–15 detik"; sukses = panel
    hijau menyebut field apa saja yang terisi otomatis + ajakan memeriksa;
    total nota > sisa tagihan → jumlah di-cap sisa tagihan dengan penjelasan;
    tak terbaca = panel amber "isi manual / foto ulang dengan cahaya terang";
    chip file + Lihat/Ganti; tombol submit & cancel dikunci saat scanning.
  - Gate: 887 unit test hijau (+15), `next build` sukses (2 route baru
    ter-generate), tsc 481 = baseline (0 baru), migrasi applied, PM2 restart,
    smoke kedua endpoint 401 tanpa sesi.
  - Sisa QA manual: E2E browser Fase A (unggah di chat Do) + Fase B (foto nota
    sungguhan di dialog pembayaran → cek prefill → simpan → "Lihat Nota" dari
    riwayat PO). OCR tak bisa diuji vitest (artefak jsdom — lihat Catatan).
- 2026-07-21 — **Fase A selesai.** Lib ekstraksi bebas-modul + endpoint unggah +
  UI lampiran di chat Do. Ditemukan bahwa OCR sudah aktif sejak modul CV
  (bukan perlu diaktifkan) dan `xlsx` sudah terpasang, sehingga tidak ada
  dependensi baru sama sekali. 676 test hijau, build sukses.
  Sisa: uji end-to-end di browser; Fase B (purchasing) belum dimulai.
