# EPIC-056: Komisi Coach + Coach Portal

status: ready-for-qa
environment: dev
retries: 0

## Goal

Menghitung dan mencairkan **komisi coach di luar payroll** setiap akhir bulan sesuai skema
insentif owner (Excel "Staffing Assumptions → Incentive Spread"), dan memberi coach
**Coach Portal** untuk melihat jadwal mengajar, menandai kehadiran peserta, dan memantau
komisinya.

Referensi: [PRD](../product/PRD.md) · [EPIC-054](./EPIC-054-booking-kelas-checkin.md) ·
[EPIC-055](./EPIC-055-personal-training.md).

## Keputusan desain

- **Skema owner**: pool = **10% revenue kelas + 40% revenue Personal Training**; dibagi per
  orang menurut peran: **Head Coach 20%, Coach 16%** (Ops Director 0%). Semua angka bisa
  diubah di "Skema komisi"; persentase bisa di-override per coach.
- **Opsi B (keputusan owner 2026-10-02)**: persentase per orang tetap. Total < 100% → sisa
  pool menjadi revenue perusahaan; total > 100% → approve diblokir sampai disesuaikan.
- **Revenue** = nilai kredit kelas/Personal Training yang **diakui saat dipakai** (hadir,
  tidak hadir, batal telat) dengan `recognized_at` di bulan itu (WIB). Breakage pass
  kedaluwarsa **tidak** masuk pool.
- **Alur bulanan**: pratinjau langsung (bulan berjalan = estimasi) → **Setujui** (hanya
  setelah bulan berakhir; angka & persentase dikunci ke `commission_periods/lines`, jurnal
  `STUDIO_COMMISSION_ACCRUAL` Dr beban komisi / Cr utang komisi, tanggal 1 bulan berikut)
  → **Bayar per coach** (tunai/transfer + referensi, jurnal `STUDIO_COMMISSION_PAYMENT`
  Dr utang komisi / Cr kas-bank). Semua baris dibayar → periode "Dibayar". Gaji tetap tetap
  di payroll HRIS. Jurnal non-blocking: dilewati selama mapping COA modul STUDIO belum diatur.
- **Peserta komisi**: coach aktif + coach yang mengajar di bulan itu (walau sudah nonaktif).
- **Coach Portal (`/coach`)**: akun login → `hris.employees.user_id` → `studio.coaches.employee_id`.
  Setelah login, akun yang tertaut coach diarahkan ke `/coach`. Coach hanya melihat sesinya
  sendiri, nama peserta (tanpa data pass/nilai), bisa menandai/membatalkan hadir pada hari
  sesi, dan melihat komisinya sendiri + total pool (tanpa angka coach lain).

## Tasks

- [x] T-056-1 Migrasi `20261002220000_studio_coach_commission.sql`: `coaches.commission_share_percent`, `commission_periods`, `commission_lines`, menu Komisi Coach (read/create/update/approve).
- [x] T-056-2 Logika murni `src/lib/studio/commission.ts` (pool, share, opsi B, pembulatan sen, periode) + 6 tes.
- [x] T-056-3 Mesin `commission-server.ts` (setting, revenue per bulan, aktivitas coach, pratinjau, approve, bayar, statement) + event jurnal STUDIO_COMMISSION_*.
- [x] T-056-4 API staf `studio/commissions/{[period],[period]/approve,lines/[id]/pay,settings}`, `studio/coaches/[id]/share`.
- [x] T-056-5 API Coach Portal `coach/{me,schedule,sessions/[id]/roster,bookings/[id]/check-in,commission}` + routing login coach.
- [x] T-056-6 UI backoffice "Komisi Coach" (ringkasan pool, baris per coach, skema, override, approve, bayar).
- [x] T-056-7 UI Coach Portal mobile (tab Jadwal & Komisi, desain NüHabit).

## Acceptance Criteria

- [x] Pool 10% kelas + 40% Personal Training; Head Coach 20%, Coach 16%; sisa → revenue perusahaan.
- [x] Total > 100% ditandai & approve diblokir; bulan berjalan tidak bisa disetujui.
- [x] Setelah disetujui angka terkunci (perubahan skema tidak memengaruhi); approve/bayar dua kali ditolak.
- [x] Coach login → Coach Portal; hanya jadwal/roster miliknya; tanda hadir hanya pada hari sesi.
- [x] Coach melihat estimasi bulan berjalan + riwayat komisi; tidak bisa membuka komisi backoffice.

## Automation Log

- 2026-10-02 — Owner menyetujui opsi B (persentase per orang tetap, sisa ke perusahaan, > 100% blok approve).
- 2026-10-02 — Selesai T-056-1..7. Gate: vitest studio 59/59 PASS (commission 6); typecheck file studio/coach bersih; E2E `commission-e2e` di `nuhabit_test` 36/36 (pool & spread, opsi B, override > 100%, approve guard, kunci angka, bayar, login coach, jadwal/roster milik sendiri, tanda hadir, komisi coach).
