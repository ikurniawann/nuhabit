# EPIC-021: /dashboard — Ringkasan Eksekutif Lintas Modul

status: ready-for-qa
environment: dev
retries: 0

## Goal

Halaman `/dashboard` menjadi ringkasan high-level + taktis lintas modul untuk
super_admin dan owner (direksi): sekali buka terlihat kondisi bisnis, insight
yang bisa ditindaklanjuti, dan antrean keputusan — semua angka berpembanding
dan ber-deep-link. Analisis dalam tetap di dashboard modul masing-masing.

## Evidence (audit 2026-07-21)

1. **`/dashboard` sebelumnya bukan dashboard global — ia dashboard rekrutmen.**
   Landing merender `RecruitmentDashboardPage` (kandidat bulan ini, kandidat
   butuh perhatian, ekspor CSV) untuk SEMUA role non-employee. Jejak sejarah
   aplikasi yang tumbuh dari produk talentpool.
2. Bahan sudah tersedia dari EPIC-019: `buildDesktopOverview` (denyut hari ini),
   nav-badges, query tool Do — tinggal ditumpangi lapisan insight.

## Keputusan Owner (2026-07-21)

- Dashboard rekrutmen pindah ke **`/dashboard/rekrutmen`** (konten tidak diubah).
- **`/dashboard` khusus super_admin + owner** (dipetakan ke `direksi`), berisi
  informasi high-level & taktis lintas modul untuk pengambilan keputusan.

## Scope

**Fase A — pemindahan + eksekutif v1 (selesai)**
- Routing: super_admin/direksi → Ringkasan Eksekutif; employee → `/dashboard/me`
  (aturan lama); role lain → redirect `/dashboard/rekrutmen` (konten yang sama
  dengan yang mereka lihat sebelum halaman berganti isi — least surprise).
- Menu `hris.recruitment.dashboard` (→ /dashboard/rekrutmen) di atas grup
  Rekrutmen, izin disalin dari Pipeline. Migrasi `20260721030000`, applied.
- `src/lib/dashboard/executive.ts`: menumpang `buildDesktopOverview` + insight
  baru — tren 14 hari, top 5 produk 7 hari, nilai persediaan
  (qty × unit_cost), purchasing bulan berjalan per status, payroll run terakhir,
  kontrak `active` berakhir ≤30 hari. Gagal-aman per seksi; 4 unit test.
- `GET /api/dashboard/executive`: gate super_admin+direksi, cache 60 dtk,
  hasil ber-seksi-gagal tidak di-cache (pola /api/desktop/overview).
- Halaman: KPI berpembanding ganda (vs kemarin DAN vs hari sama minggu lalu),
  tren 14 hari dengan pembanding minggu berjalan vs minggu sebelumnya,
  Perlu Keputusan, produk terlaris, inventori (nilai + menipis), purchasing,
  payroll & kontrak, CRM 7 hari. Auto-refresh 60 dtk saat tab terlihat.

**Fase B — outlet, target, role-aware (selesai)**
- Kartu **Per Outlet · 7 Hari**: omzet per branch (LEFT JOIN — pesanan tanpa
  branch tampil sebagai "Tanpa outlet" agar totalnya selalu cocok dengan KPI).
- Kartu **Bulan Berjalan**: omzet & pesanan month-to-date + progress terhadap
  target bulanan; KPI Omzet Hari Ini mendapat progress target harian.
- **Target omzet** diedit inline dari kartu Bulan Berjalan ("Atur target ›") —
  tersimpan di `app_settings.sales_target_config` via
  `PUT /api/settings/sales-target` (gate super_admin+direksi; sanitasi menolak
  input sampah — "abc" TIDAK menjadi 0 yang diam-diam menghapus target — dan
  plafon Rp 100 M menangkal salah ketik nol; 7 unit test).
- **Landing role-aware**: purchasing_* → dashboard purchasing; pos/pos_supervisor
  → dashboard POS; finance_staff → payroll; sisanya tetap → rekrutmen.

## Non-Goals

- Grafik analitik berat / library chart — bar CSS cukup untuk tren ringkas.
- Mengubah isi dashboard rekrutmen.
- Realtime — polling 60 dtk cukup.

## Acceptance Criteria

- [x] super_admin & direksi melihat Ringkasan Eksekutif di `/dashboard`.
- [x] Role lain mendarat di konten yang sama seperti sebelumnya (rekrutmen),
      kini di `/dashboard/rekrutmen`; employee tetap ke `/dashboard/me`.
- [x] Endpoint eksekutif menolak 401 tanpa login; role di luar daftar ditolak.
- [x] Setiap kartu ber-deep-link; KPI omzet berpembanding ganda.
- [x] Seksi gagal hanya menandai kartunya (diverifikasi: kolom `total_amount`
      yang keliru di purchasing membuat SATU kartu gagal, sisanya tetap hidup —
      lalu diperbaiki ke kolom `total`).
- [x] Build hijau; 704 test hijau (4 baru).
- [ ] QA manual: login direksi sungguhan (bukan hanya super_admin).

## Test Plan

- Unit: tren selalu 14 titik urut, gagal parsial, payroll null saat belum ada
  run, prefix `overview:` untuk kegagalan bawaan.
- Smoke data dev: seluruh seksi terisi (top produk: Nasi Goreng Spesial 5×;
  persediaan Rp 115 rb; PO bulan ini 1/Rp 127.650; payroll Agu 2026 paid;
  kontrak ≤30 hari: 1).
- Manual: login super_admin → /dashboard; login hrd → terlempar ke
  /dashboard/rekrutmen dengan konten lama.

## QA Checklist (step-by-step)

Prasyarat: **buat akun role `direksi` dulu** — dev belum punya satu pun
(diverifikasi 26 Jul). Buat via Manajemen User (role "Executive" ada di
dropdown), lengkapi scope bisnis company+branch.

1. Login **super_admin** → `/dashboard` → Ringkasan Eksekutif tampil:
   KPI omzet berpembanding ganda, tren 14 hari, Per Outlet 7 hari,
   Bulan Berjalan + target, Perlu Keputusan, produk terlaris, inventori,
   purchasing, payroll & kontrak, CRM.
2. Klik "Atur target ›" di kartu Bulan Berjalan → isi target → progress
   bar berubah; coba input sampah ("abc") → ditolak, target TIDAK terhapus.
3. Login **direksi** → `/dashboard` → Ringkasan Eksekutif yang sama
   (bukan terlempar ke ESS/rekrutmen).
4. Login **hrd** → `/dashboard` → mendarat di `/dashboard/rekrutmen`
   dengan konten dashboard rekrutmen lama.
5. Login **purchasing_admin/staff** → mendarat di `/dashboard/purchasing`;
   **pos/pos_supervisor** → `/dashboard/pos`; **finance_staff** →
   `/dashboard/hris/payroll`.
6. Setiap kartu eksekutif ber-deep-link ke modulnya (klik beberapa sampel).
7. Biarkan tab terbuka >60 dtk → angka menyegarkan sendiri.

## Automation Log

- 2026-07-21 — **Fase B selesai**: per-outlet + bulan berjalan + target omzet
  (editor inline) + landing role-aware. Unit test target menangkap bug nyata
  sebelum sampai ke user: sanitasi lama membuang semua non-digit sehingga
  "abc" menjadi 0 — yang artinya diam-diam MENGHAPUS target; kini input sampah
  ditolak 400. Smoke data dev: outlet Dago Rp 457 rb + "Tanpa outlet" Rp 165 rb
  (7 hari), MTD Rp 622 rb/4 pesanan. 711 test hijau, build sukses, endpoint
  target 401 tanpa login. Sisa QA: login role purchasing/pos/finance memastikan
  landing barunya masuk akal bagi mereka.
- 2026-07-21 — Fase A selesai satu sesi. Insiden kecil selama smoke: seksi
  purchasing gagal karena mengasumsikan kolom `total_amount` (nama di
  pos_orders) padahal purchase_orders memakai `total` — persis jenis bug yang
  ditangkap pola gagal-aman + smoke data sungguhan sebelum sampai ke user.
  Status → coding (sisa QA login direksi).
- 2026-07-26 — **Audit penutupan → ready-for-qa.** Latar: epic menggantung
  di `coding` 5 hari; satu-satunya sisa = QA manual. Hasil audit hari ini:
  (1) **Interaksi dgn fix security H1 EPIC-032 A4** (guard path layout kini
  berlaku utk SEMUA role non-full-access) diverifikasi AMAN — `direksi`
  punya grant menu root `dashboard` (guard exact-match meloloskan
  /dashboard), dan SEMUA target landing role-aware tercakup grant menu
  masing-masing (purchasing→/dashboard/purchasing, pos→/dashboard/pos
  [layout terpisah, guard tak berlaku], finance→/dashboard/hris/payroll,
  hiring_manager→rekrutmen — dicek per-role ke iam.role_menu_permissions).
  (2) Route hidup: /dashboard & /dashboard/rekrutmen 307 tanpa login,
  /api/dashboard/executive 401 — normal. (3) 11 unit test
  (executive+sales-target) hijau. (4) TEMUAN: dev belum punya SATU PUN
  user `direksi` — inilah blocker QA sesungguhnya; role sudah tersedia di
  dropdown Manajemen User, tinggal dibuat owner (masuk prasyarat QA
  Checklist). Tidak ada perubahan kode diperlukan. Status →
  **ready-for-qa**.
