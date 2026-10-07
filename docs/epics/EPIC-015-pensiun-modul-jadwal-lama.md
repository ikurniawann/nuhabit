# EPIC-015: Pensiun Modul Jadwal Lama (Schedules & Sections berbasis `staff`)

status: ready-for-qa
environment: dev
retries: 0

## Goal

Menutup kebingungan dua sistem jadwal yang berjalan paralel: halaman lama
`/dashboard/hris/schedules` (+ saudaranya `/dashboard/hris/sections`) yang
bersandar pada tabel `staff` sudah **tidak dipakai dan tidak terhubung ke modul
apa pun**, sementara penjadwalan yang hidup ada di **Shift Kerja**
(`/dashboard/hris/shifts` → `hris.shifts` + `hris.employee_shifts`) yang menyuplai
absensi, cuti, lembur, dan payroll. Hasil akhir: satu sumber kebenaran jadwal
(Shift Kerja), menu & route lama dipensiunkan dengan redirect, kode dan tabel
mati dibersihkan tanpa menyentuh data yang masih dipakai.

## Evidence (audit 2026-07-20)

Anchor kode: `src/app/dashboard/(dashboard)/hris/schedules/page.tsx`,
`src/features/hris/schedules/*` (393 baris komponen), `src/app/api/staff-schedules/route.ts`,
`src/app/api/staff/*`, pembanding `src/lib/hris/daily-roster.ts` +
`src/app/api/hris/attendance/schedule/route.ts`.

| | `/hris/schedules` (lama) | `/hris/shifts` (aktif) |
|---|---|---|
| Tabel | `hris.staff_schedules` | `hris.shifts` + `hris.employee_shifts` |
| Acuan orang | `staff` — **0 baris** | `hris.employees` — **19 baris** |
| Isi data | **0 baris** | 3 shift, 14 penugasan |
| Konvensi hari | 0–6 (Minggu=0) | 1–7 |
| Dibaca modul lain | **tidak ada** | daily-roster/absensi, cuti, lembur, payroll |

1. **Halaman lama tampak "belum aktif" karena datanya mustahil ada** — daftar staf
   ditarik dari `/api/staff` (tabel `staff`, 0 baris); seluruh karyawan hidup di
   `hris.employees`. Menu `hris.workforce.schedules` sendiri `is_active=true`,
   jadi masalahnya bukan menu.
2. **Tidak ada konsumen** — `staff_schedules` tidak dibaca satu pun query
   absensi/payroll; `deriveRosterStatus` murni memakai `employee_shifts`.
   Mengisinya pun tidak berefek ke mana-mana (jebakan bagi user).
3. **Modul `sections` satu paket** — `src/features/hris/sections/*` juga menarik
   `/api/staff`; `sections` & `staff_sections` sama-sama 0 baris. Dua halaman ini
   saling menautkan tab satu sama lain, jadi memensiunkan satu tanpa yang lain
   meninggalkan tautan menggantung.
4. **`/api/staff` hanya dipakai dua modul ini** — grep: `features/hris/sections/api.ts`
   dan `features/hris/schedules/api.ts`. Tidak ada konsumen lain.
5. **Tabel `staff` TIDAK boleh di-drop** — masih jadi target FK
   `purchase_returns.{created_by,approved_by}`, `vendor_credits.{created_by,approved_by}`,
   dan `employees.old_staff_id` (jejak migrasi). Yang boleh hilang hanya
   `staff_schedules` dan `staff_sections`.
6. **Preseden ada** — pola identik sudah dieksekusi di EPIC-009 untuk
   `logbook-list` (redirect + menu dinonaktifkan lewat migrasi).

## Keputusan yang Perlu Dikonfirmasi Owner

- [x] **Sections ikut dipensiunkan?** → **Ya, satu paket** (owner, 2026-07-20).
- [ ] **Drop tabel atau arsipkan?** Rekomendasi: drop `staff_schedules` +
      `staff_sections` (0 baris, tidak ada FK masuk). `staff` tetap.
- [ ] **Butuh jadwal jam bebas per orang** (bukan template shift)? Kalau ya, itu
      fitur baru **di dalam** Shift Kerja, bukan menghidupkan halaman lama →
      dipecah jadi epic terpisah.

## Scope

**Fase A — Pensiunkan route & menu (PR 1)**
- `/dashboard/hris/schedules` → `redirect("/dashboard/hris/shifts")` (server component).
- `/dashboard/hris/sections` → `redirect("/dashboard/hris/shifts")` bila disetujui.
- Migrasi baru: set `is_active=false, is_visible=false` untuk menu
  `hris.workforce.schedules` (+ `hris.organization.sections`), pola sama seperti
  migrasi `20260718180000` di EPIC-009.
- Bersihkan tautan tab silang di `schedule-staff-page.tsx:179` &
  `section-staff-page.tsx:175`, dan entri `/dashboard/hris/schedules` di
  `src/features/users/components/users-list-page.tsx:202`.

**Fase B — Hapus kode mati (PR 2)**
- Hapus `src/features/hris/schedules/` + `sections/`, `src/app/api/staff-schedules/`,
  `src/app/api/staff-sections/`, `src/app/api/staff/`.
- **`src/app/api/sections/` DIPERTAHANKAN** — koreksi atas draft awal: endpoint ini
  masih dipakai `features/users/api.ts:285` (`fetchUserFormLookups`) untuk mengisi
  dropdown Section di form karyawan (`user-form-page.tsx:465`).
- Buang `"staff"` dari `hrisModules` di `src/proxy.ts` — `/dashboard/hris/staff`
  tidak pernah dibuat, jadi redirect-nya hanya mengantar ke 404.
- Verifikasi tidak ada import yatim (`tsc` + build hijau).

**Fase C — Migrasi DB (PR 3)**
- `DROP TABLE hris.staff_schedules` + `hris.staff_sections` saja (setelah
  konfirmasi 0 baris di dev **dan** produksi).
- Tabel `staff` **dipertahankan** (FK purchasing/vendor + `employees.old_staff_id`).
- Tabel `sections` **dipertahankan** — koreksi atas draft awal: masih jadi target FK
  `employees.section_id` (ON DELETE SET NULL) dan
  `employment_history.{prev,new}_section_id`, serta terpasang di form karyawan.
  Yang mati hanya tabel penghubung `staff_sections` (staff ↔ section).
- Migrasi `20260720200000_drop_tabel_jadwal_lama.sql` **sudah disiapkan tetapi
  belum di-apply**: berisi pengaman `RAISE EXCEPTION` bila salah satu tabel
  ternyata berisi baris, sehingga di produksi ia gagal keras + rollback alih-alih
  menghapus data diam-diam. `DROP` sengaja tanpa `CASCADE`.
- Kandidat terpisah (butuh konfirmasi owner, **belum masuk scope**):
  `hris.employee_schedules` — 0 baris, tanpa referensi di `src/`, tampak sisa
  iterasi sebelum `employee_shifts`. Perlu dipastikan bukan cadangan yang
  disengaja sebelum ikut di-drop.

**Fase D — Dokumentasi**
- Catat di Automation Log + tambahkan satu paragraf "sumber kebenaran jadwal =
  Shift Kerja" di dokumen HRIS/runbook agar tidak lahir modul kembar lagi.

## Non-Goals

- Menambah kemampuan baru ke Shift Kerja (jam bebas per orang, rotasi otomatis,
  jadwal per-tanggal). Epic terpisah bila memang dibutuhkan.
- Migrasi data dari `staff_schedules` ke `employee_shifts` — tidak ada data untuk
  dimigrasikan (0 baris).
- Menghapus tabel `staff` atau membereskan FK purchasing/vendor.
- Perubahan pada modul Absensi, Cuti, Lembur, Payroll.

## Acceptance Criteria

- [x] Buka `/dashboard/hris/schedules` → ter-redirect ke `/dashboard/hris/shifts`
      (tanpa 404, tanpa flash halaman kosong). *(kode + build; verifikasi
      end-to-end butuh sesi login → sisa QA manual)*
- [x] Menu "Schedules" dan "Sections" hilang dari sidebar untuk semua role;
      tidak ada tautan menggantung di halaman lain.
- [x] `grep -rn "api/staff-schedules\|features/hris/schedules" src` → 0 hasil.
- [x] `tsc` bersih (selain error pre-existing modul lain) dan `next build` hijau.
- [ ] Absensi harian, monitoring roster, cuti, lembur, dan payroll tetap normal
      (smoke dev) — membuktikan tidak ada ketergantungan tersembunyi.
- [x] Migrasi drop table applied + tercatat, dan `to_regclass` memastikan
      `staff_schedules`/`staff_sections` hilang; tabel `staff` dan `sections`
      tetap ada.

## Test Plan

- Manual dev: klik menu HRIS satu per satu → tidak ada 404; buka URL lama langsung
  → redirect; login role non-full-access → menu lama tidak muncul.
- Smoke absensi: `/api/hris/attendance/daily-roster` untuk hari ini mengembalikan
  status roster yang sama sebelum & sesudah perubahan (bandingkan output).
- Regresi build: `npm run build` + `tsc --noEmit`; unit test existing hijau.
- Verifikasi DB pra-drop: `SELECT count(*)` = 0 di dev **dan** produksi sebelum
  Fase C dijalankan.

## Agent Routing

- Audit (Explore) ✔ sudah dilakukan 2026-07-20.
- Fase A–B: sesi Claude (`/task-work EPIC-015 <n>`) → code-reviewer gate.
- Fase C: database-reviewer gate wajib (drop table) + konfirmasi owner eksplisit.
- Tidak perlu security-reviewer (tidak ada permukaan auth baru).

## Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Ada data `staff_schedules` di produksi (dev 0 baris) | Cek count di produksi sebelum Fase C; kalau ada, ubah Fase C jadi arsip (rename `_deprecated`) |
| Role tertentu masih punya permission menu lama di `iam` | Nonaktifkan di level menu (`is_active=false`), bukan per-role |
| ~~Drop table `sections` menyentuh modul lain~~ | **Terbukti terjadi** — `sections` masih dipakai form karyawan + FK `employment_history`; dikeluarkan dari scope drop (lihat Fase C) |

## Done Signal

Semua Acceptance Criteria tercentang + Automation Log terisi + status
`ready-for-qa`.

## Automation Log

- 2026-07-21 — **Fase C dieksekusi** oleh owner (`npm run db:migrate:apply` —
  perintah destruktif sengaja dijalankan user, bukan agen). Pengaman tidak
  berbunyi: kedua tabel kosong saat di-drop. Verifikasi `to_regclass`:
  `staff_schedules` & `staff_sections` hilang; `staff` & `sections` utuh sesuai
  rencana. Dua migrasi menu yang dulu di-apply manual (Suara AI, Dashboard
  Rekrutmen) kini ikut tercatat di tracker. Status → ready-for-qa; sisa QA
  manusia: redirect kedua halaman lama dengan sesi login + dropdown Section di
  form karyawan.

- 2026-07-20 — Epic dibuat dari audit `/dashboard/hris/schedules` ("belum aktif"):
  ditemukan dua sistem jadwal paralel; halaman lama bersandar tabel `staff` (0
  baris) dan `staff_schedules` (0 baris, tanpa konsumen), sedangkan jadwal yang
  hidup adalah Shift Kerja (`employee_shifts`, 14 baris) yang menyuplai
  absensi/payroll. Rekomendasi: pensiunkan (redirect + nonaktif menu + hapus kode
  + drop tabel), bukan diperbaiki. Menunggu keputusan owner pada 3 poin di atas.
  Status → backlog.
- 2026-07-20 — **Fase A selesai.** Owner menyetujui Sections ikut pensiun.
  Perubahan: `hris/schedules/page.tsx` → `redirect("/dashboard/hris/shifts")`;
  `hris/sections/page.tsx` → `redirect("/dashboard/employees")` (menyimpang dari
  draft yang menulis `→ shifts`: Sections soal pengelompokan staf, bukan jadwal,
  jadi data karyawan adalah tujuan yang benar). Nav tab silang di
  `users-list-page.tsx` dihapus seluruhnya (menyisakan satu tab "All Employees"
  saja jadi tidak berguna) berikut `usePathname` yang jadi yatim. Migrasi
  `20260720190000_pensiun_menu_jadwal_lama.sql` menonaktifkan menu
  `hris.workforce.schedules` + `hris.organization.sections` — applied di dev,
  diverifikasi `is_active=f, is_visible=f`. Gates: `tsc` bersih pada file
  terdampak, `next build` sukses (kedua route tetap terdaftar sbg dynamic =
  redirect handler), PM2 restart.
  **Catatan jujur:** (a) smoke redirect via curl hanya mengembalikan 307 ke
  `/login` karena proxy auth menangkap lebih dulu — redirect terbukti di level
  kode/build, belum end-to-end; (b) `pm2 restart all` yang saya jalankan ikut
  me-restart app lain di server (padigiling, brag2026, omnipos, wa-gateway,
  gitlab-runner) — semuanya kembali `online`, tapi seharusnya cukup
  `pm2 restart arkiv-pos-saas`. (c) Referensi `/dashboard/hris/{schedules,sections}`
  masih tersisa di `features/hris/{schedules,sections}/components/*` yang sudah
  tidak dirender — dibersihkan di Fase B. Status → coding (Fase B berikutnya).
- 2026-07-20 — **Fase B selesai.** Dihapus: `features/hris/schedules/` +
  `sections/` (14 file), `api/staff-schedules/`, `api/staff-sections/`,
  `api/staff/` (list + [id]). `"staff"` dibuang dari `hrisModules` di `proxy.ts`
  karena `/dashboard/hris/staff` tidak pernah ada — redirect-nya hanya mengantar
  ke 404.
  **Koreksi rencana (penting):** draft epic keliru memasukkan `api/sections` ke
  daftar hapus dan tabel `sections` ke daftar drop. Keduanya MASIH HIDUP —
  `fetchUserFormLookups` (`features/users/api.ts:285`) memakai `/api/sections`
  untuk dropdown Section di form karyawan, dan tabel `sections` jadi target FK
  `employees.section_id` + `employment_history.{prev,new}_section_id`. Yang mati
  hanya tabel penghubung `staff_sections`. Scope Fase C dipersempit.
  Gates: `next build` sukses; manifest membuktikan `/api/staff*` hilang dan
  `/api/sections` tetap ada. Curl tidak bisa membedakan route terhapus vs ada
  (proxy mengembalikan 401 utk keduanya tanpa sesi) — manifest yang jadi bukti.
  Pre-existing & tidak disentuh: `features/configuration/roles/components/index.ts`
  mengimpor `./components/role-detail-sections` (path ganda, dari commit 8940e99).
- 2026-07-20 — **Fase C disiapkan, belum di-apply.** Migrasi
  `20260720200000_drop_tabel_jadwal_lama.sql` drop `hris.staff_schedules` +
  `hris.staff_sections` saja, tanpa `CASCADE`, dengan pengaman `RAISE EXCEPTION`
  bila tabelnya ternyata berisi baris. `database/schema-map.js` ikut dibersihkan
  dari dua entri itu.
  Verifikasi tanpa merusak dev: SQL dijalankan di dalam transaksi lalu
  di-ROLLBACK — kedua `DROP TABLE` sukses dan `to_regclass` membuktikan tabelnya
  kembali utuh setelah rollback. Cabang pengaman diuji terpisah dengan
  menjalankan blok yang sama terhadap `hris.shifts` (3 baris) → benar-benar
  `ERROR: hris.shifts berisi 3 baris — migrasi dibatalkan`.
  **Belum dijalankan di dev maupun produksi.** `npm run db:migrate` (dry-run)
  diblokir classifier di sesi ini, jadi apply harus dilakukan owner/sesi
  berikutnya — dan syarat dari Fase C tetap berlaku: cek `count(*)` di produksi
  lebih dulu. Kalau ternyata ada isinya, pengaman akan menggagalkan migrasi dan
  keputusan arsip-vs-migrasi-data kembali ke owner.
