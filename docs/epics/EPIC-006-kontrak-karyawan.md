# EPIC-006: Kontrak Karyawan (PKWT/PKWTT)

status: ready-for-qa
environment: dev
retries: 0

## Goal

Modul kontrak kerja sesuai regulasi Indonesia (UU 13/2003 jo. UU Cipta Kerja,
PP 35/2021): HRD mengelola siklus hidup kontrak PKWT/PKWTT per karyawan —
draft → aktif → berakhir/putus/konversi — dengan dokumen PDF siap cetak,
pengingat kedaluwarsa, dan integrasi otomatis dari rekrutmen (hired → draft).
Scope disepakati: PKWTT + PKWT saja (magang/harian lepas ditunda).

## Scope

- Migrasi `20260716120000`: `hris.employment_contracts` (snapshot isi kontrak,
  rantai perpanjangan, CHECK compliance: PKWT wajib end_date & tanpa probation,
  satu kontrak aktif per karyawan) + `20260716130000` (menu HRIS → Kontrak)
  + `20260716140000` (grup menu Kepegawaian: Karyawan + Kontrak).
- Lib `src/lib/hris/`: `contracts.ts` (validasi: total PKWT ≤ 60 bulan,
  probation PKWTT ≤ 3 bulan, kompensasi PP 35/2021, penomoran, pemetaan
  employment_status→tipe kontrak), `contract-pdf.ts` + `terbilang.ts`
  (PDF perjanjian b. Indonesia, klausul minimum Pasal 54), `contract-number.ts`,
  `create-contract.ts`, `contracts-list.ts` — 51 unit test.
- API: CRUD + aksi (activate/end/terminate/convert/renew — transaksional,
  sinkron employment_status + employment_history), list lintas karyawan
  (filter+sort whitelist), expiring (pengingat), dokumen PDF, company-profile.
- UI: tab Kontrak di detail karyawan, halaman HRIS → Kontrak (filter/sort),
  banner pengingat (berakhir ≤30 hari, probation selesai, karyawan aktif
  tanpa kontrak aktif — akun super_admin dikecualikan), form Profil Dokumen
  Kontrak di Settings → Business.
- Fase D: promote kandidat hired → draft kontrak otomatis (tipe dari
  employment_status; gaji/posisi dari offer accepted terakhir).
- Fase E (penuntasan): upload/lihat/hapus dokumen kontrak bertanda tangan
  (PDF/JPG/PNG/WebP maks 10 MB, storage private + sniff magic bytes, endpoint
  `/api/hris/contracts/[id]/signed-document` ber-auth), aksi `edit` draft
  (validasi compliance ulang; tipe kontrak terkunci), dialog Administrasi di
  tab Kontrak (dokumen ttd + tanggal ttd/pencatatan Kemnaker/pembayaran
  kompensasi) + info TTD & Kemnaker di kartu kontrak.

## Acceptance Criteria

- [x] PKWT ditolak bila tanpa tanggal berakhir / dengan masa percobaan / total rantai > 5 tahun.
- [x] Aktivasi kontrak transaksional: status karyawan + riwayat kepegawaian sinkron.
- [x] Uang kompensasi PP 35/2021 dihitung otomatis saat PKWT berakhir/diputus (pro-rata).
- [x] PDF kontrak memuat klausul minimum Pasal 54 + terbilang; profil perusahaan dari settings; field kosong jadi garis isian.
- [x] Perpanjangan PKWT membuat draft rantai baru dan divalidasi ulang batas 5 tahun.
- [x] Promote kandidat hired otomatis membuat draft kontrak; gagal draft tidak menggagalkan promote.
- [x] Pengingat tampil utk kontrak ≤30 hari (merah ≤14/terlewat) & karyawan tanpa kontrak aktif.
- [x] Dokumen bertanda tangan bisa diunggah/dilihat/dihapus; re-upload menimpa file lama; hanya PDF/gambar valid (magic bytes) yang diterima.
- [x] Draft kontrak bisa diedit tanpa hapus-buat-ulang; seluruh aturan compliance divalidasi ulang; tipe kontrak tidak bisa diubah.
- [x] Tanggal ttd, pencatatan Kemnaker, dan pembayaran kompensasi bisa dicatat dari dialog Administrasi.
- [ ] QA manual: alur lengkap buat → edit draft → PDF → aktifkan → upload ttd → catat Kemnaker → perpanjang/akhiri di DEV.
- [ ] Template PDF direview legal sebelum dipakai resmi.

## Catatan

- Sisa non-blocking: pencatatan Kemnaker baru berupa tanggal manual (belum
  integrasi wajiblapor.kemnaker.go.id — memang tidak ada API publiknya).

## Automation Log

- 2026-07-16: Fase A–D selesai satu hari (commit `167ac12` + fix aktivasi &
  auto-draft di commit lanjutan). Bug FK `employment_history.recorded_by`
  (diisi user id, FK ke employees) ditemukan saat QA user → diperbaiki dgn
  mapping user→employee + transaksi; 3 baris riwayat di-backfill. Keputusan:
  scope PKWTT+PKWT saja; template standar disusun sendiri (perlu review
  legal); record karyawan Super Admin dihapus dari HRIS (akun login murni).
- 2026-07-17: Fase E menuntaskan sisa catatan — upload dokumen ttd (storage
  private, sniff magic bytes `%PDF-`/gambar, MIME klaim client diabaikan),
  aksi `edit` draft (guard `AND status='draft'` di UPDATE utk cegah race dgn
  aktivasi), dialog Administrasi (ttd/Kemnaker/kompensasi; semantik
  undefined-pertahankan/null-kosongkan di `update` supaya tanggal salah isi
  bisa dihapus). Review gate: 0 CRITICAL/HIGH; 2 MEDIUM + 3 LOW semuanya
  diperbaiki sebelum commit. Bonus: fix test `formatCurrency` yang sudah
  gagal sebelumnya ("No limit" → "Tanpa limit", UI berbahasa Indonesia).
  297 unit test hijau.
