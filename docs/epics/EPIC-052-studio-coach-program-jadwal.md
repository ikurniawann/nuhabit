# EPIC-052: Studio — Coach, Program Kelas & Jadwal

status: ready-for-qa
environment: dev
retries: 0

## Goal

Fondasi operasional venue Hyrox Nuhabit: master **coach** (Head Coach / Coach,
profil publik, tautan ke karyawan HRIS), master **program** (kelas grup & personal
training), **template jadwal mingguan** (39 kelas/minggu), dan **jadwal nyata per
tanggal** yang dibentuk dari template lalu bisa diubah per sesi (coach pengganti,
kuota, batal). Booking member (EPIC-054), pass (EPIC-053) dan komisi (EPIC-056)
menempel ke sesi kelas di epic ini.

Referensi: [PRD](../product/PRD.md) §2 (Kelas, Coach) · [DESIGN.md](../../DESIGN.md).

## Keputusan desain

- **Schema baru `studio`** (bukan memperluas `ticketing`): domain kelas/kredit/coach
  berbeda dari tiket kunjungan. Pola yang dipakai ulang: konteks venue Resort
  (`resolveVenue` → scope user → fallback `crm_settings.default_*`), IAM menu
  prefix `studio`, respons `{ success, data, message }`.
- **Template → generate → sesi**: template mengubah sesi *berikutnya* saja; sesi yang
  sudah terbentuk diubah per sesi. Generate idempoten lewat unique index
  `(template_id, session_date)`; maksimal 62 hari sekali jalan; hari libur nasional
  (`hris.public_holidays` status `aktif`) dilewati secara default.
- **Bentrok coach ditolak di server**: template (hari sama) dan sesi (tanggal sama,
  status ≠ batal) yang jamnya tumpang tindih → 409. Slot bersambung (18:00 lalu 18:00)
  diizinkan.
- **Hapus aman**: coach/program yang sudah punya jadwal hanya dinonaktifkan, supaya
  histori & komisi tetap utuh. Batal sesi wajib alasan.
- **Gaji tetap tetap di payroll HRIS**; coach hanya ditautkan ke `hris.employees`.
  Komisi dihitung terpisah (EPIC-056).
- **zod 4**: `.partial()` tetap menerapkan `.default()` → skema PATCH dibangun dari
  field tanpa default (`src/lib/studio/schemas.ts`), diuji di `schemas.test.ts`.

## Tasks

- [x] T-052-1 Migrasi `20261002170000_studio_coach_program_schedule.sql`: schema + 4 tabel + menu grup "Kelas & Coach" (4 halaman) + grant super_admin/admin/direksi; keep-list seeder + `IAM.studio`.
- [x] T-052-2 Logika murni `src/lib/studio/schedule.ts` (hari ISO, ekspansi template, deteksi bentrok) + 12 tes.
- [x] T-052-3 API `/api/studio/{coaches,programs,templates,sessions}` (+ `[id]`, `sessions/generate`, `coaches/employee-options`).
- [x] T-052-4 UI dashboard: Jadwal Kelas (minggu, generate, sesi khusus, edit/batal, `?week=`), Template Mingguan (grid 7 hari, salin hari), Program Kelas, Coach.
- [ ] T-052-5 Upload foto coach (sekarang URL) — menunggu pola storage member app.
- [x] T-052-6 Kalender Kelas (monitoring, baca saja): `/dashboard/studio/calendar` — tampilan Hari / Minggu / Bulan, warna per program, jam kosong diciutkan jadi pita, kelas bertumpuk berdampingan, garis "sekarang", filter coach/program, beban coach, auto-refresh 60 detik, deep link `?view=&date=`; HP otomatis tampilan Hari. Migrasi menu `20261002190000_studio_calendar_menu.sql`.

## Acceptance Criteria

- [x] Admin bisa membuat program kelas & PT (PT kuota selalu 1).
- [x] Admin bisa mendaftarkan coach + level + tautan karyawan; coach berjadwal tidak bisa dihapus permanen.
- [x] Template mingguan menolak coach bentrok; salin slot satu hari ke hari lain.
- [x] Generate membentuk sesi sesuai template, idempoten, melewati hari libur.
- [x] Per sesi: ganti coach (pengganti), ubah kuota/jam, batalkan dengan alasan, tambah sesi khusus.

## Automation Log

- 2026-10-02 — EPIC dibuat dari PRD + skema insentif owner (pool 10% kelas + 40% PT, dibagi Head Coach 20% / Coach 16% per orang → EPIC-056).
- 2026-10-02 — Data bisnis dev di-rename dari seed BCD (Sulu/Prologe) → NüHabit / NüHabit Club (`NUHABIT-01`).
- 2026-10-02 — T-052-6 Kalender Kelas atas permintaan owner ("monitoring kelas dalam bentuk kalender agar mudah dibaca"). Logika tata letak murni di `src/lib/studio/calendar.ts` (10 tes: lajur bertumpuk, grid bulan, sumbu waktu bersegmen). Dicek visual dengan data demo 234 sesi (6 minggu × 39) lalu data demo dihapus. Catatan: `src/types/ui.d.ts` berisi deklarasi ambient lama yang menimpa tipe `@/components/ui/button` (dll.) — perlu dibersihkan terpisah.
- 2026-10-02 — T-052-1..4 selesai. Gate: vitest `src/lib/studio` 15/15 PASS; E2E API terhadap dev server 22/22 PASS (bentrok coach 409, generate idempoten, PATCH sebagian tidak mereset level/spesialisasi, batal wajib alasan, hapus coach berjadwal → nonaktif); typecheck file studio bersih. Data uji dibersihkan setelah E2E.
