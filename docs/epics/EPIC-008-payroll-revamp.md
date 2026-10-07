# EPIC-008: Payroll & Gaji — Integrasi Flow HRIS Terbaru

status: ready-for-qa
environment: dev
retries: 0

## Goal

Merombak modul Payroll (HRIS Fase 2, dibangun 2026-05-05) yang saat ini
terputus total dari fitur HRIS terbaru: absensi v2 berbasis shift (EPIC-007),
kuota cuti, dan kontrak PKWT/PKWTT (EPIC-006). Payroll harus menghitung gaji
dari data operasional sungguhan (shift, keterlambatan, lembur, cuti, kontrak,
cicilan pinjaman), aman secara akses, punya satu sumber kebenaran konfigurasi,
dan karyawan bisa melihat slip gajinya sendiri lewat ESS.

## Evidence (hasil audit 2026-07-17)

Anchor kode: engine `src/lib/payroll/calculator.ts` (535 baris),
batch `src/app/api/hris/payroll/[id]/calculate/route.ts`,
status flow `src/app/api/hris/payroll/[id]/route.ts`,
skema `database/migrations/schemas/hris/000000000017{0,1,2,3}_*.sql` +
`..._employee_salary.sql`.

1. **Terputus dari HRIS baru** — payroll hanya membaca `attendance.status`
   (string kasar) + cuti `unpaid`; mengabaikan `shift_id`,
   `scheduled_start/end`, `late_minutes`, `overtime_hours`, `leave_balances`,
   dan `employment_contracts` sepenuhnya (grep: 0 referensi).
2. **Lembur tidak pernah masuk** — input `overtimeHours` selalu 0 di batch
   route; kolom `attendance.overtime_hours`/`is_overtime` tidak dipakai.
3. **Keterlambatan tidak berdampak** — `late_days` dihitung & disimpan tapi
   tidak pernah menghasilkan potongan apa pun.
4. **Dua sumber kebenaran konfigurasi** — engine memakai konstanta hardcoded
   (BPJS caps, bracket PPh21, PTKP) padahal tabel `payroll_settings` dan
   `payroll_tax_config` ada; keduanya bisa saling menyimpang. Ada indikasi bug
   bracket PPh21: `limit` diperlakukan sebagai lebar bracket tapi diisi
   campuran nilai kumulatif & lebar (calculator.ts:131–137, 192–198).
5. **Auth bolong** — endpoint paling sensitif (buat run, ubah status,
   calculate, hapus) TANPA `requireApiRole`; hanya `payslips` dan
   `employee-salary` yang dijaga. Pola auth campur (`db.auth.getUser()` vs
   `requireApiRole`).
6. **THR pakai magic string** — gate `employment_status==='permanent'`
   padahal default employees `'probation'` dan sumber kebenaran jenis
   hubungan kerja sekarang adalah kontrak (pkwt/pkwtt).
7. **Hari kerja pakai fallback 20** — bukan dari jadwal shift karyawan;
   hourly rate hardcoded base/hariKerja/8 jam.
8. **Cicilan pinjaman tidak mengalir** — tabel `loans` + approval ada, tapi
   kalkulator tidak menarik `monthly_installment` aktif ke
   `payroll_details.loan_deduction` dan saldo tidak berkurang saat run paid.
9. **Tidak ada slip gaji ESS** — karyawan tidak bisa melihat slipnya sendiri;
   API `payslips` dibatasi HR/finance; langkah "kirim payslip" di doc lama
   tidak diimplementasi (`payslip_sent` tak terpakai); "PDF" = window.print().
10. **Duplikasi logika** — `calculatePayrollForEmployee()` vs loop inline di
    batch route memuat data yang sama dua versi.
11. **Integritas** — `payroll_details` tanpa FK; pola delete-before-insert.
    Tidak ada proraté untuk karyawan masuk/keluar di tengah bulan.

## Scope

- Perombakan engine kalkulasi + integrasi shift/absensi/cuti/kontrak/pinjaman.
- Penguatan auth & status flow run payroll.
- Konfigurasi tunggal dari DB (settings + tax config).
- Slip gaji ESS untuk role employee.
- Non-goals: multi-tenant HRIS (tidak ada `business_id` di seluruh skema hris
  — keputusan arsitektur terpisah, lihat Open Questions), modul benefits
  (`benefits`/`employee_benefits` tetap tidak disentuh), pembayaran/transfer
  bank otomatis, e-Bupot/pelaporan pajak.

## Tasks

1. **Fase A — Stop pendarahan: auth, konfigurasi, bug engine** ✅ (2026-07-17)
   - `requireApiRole(['super_admin','hrd','finance_staff'])` di SEMUA endpoint
     payroll run (GET/POST/PUT/DELETE/calculate); pola auth seragam
     (`lib/payroll/roles.ts`); pengubahan tarif (PUT settings) lebih ketat:
     super_admin + hrd saja.
   - Engine membaca `payroll_settings` + `payroll_tax_config` (per tax_year)
     via `lib/payroll/config.loadPayrollConfig`; konstanta hardcoded jadi
     fallback default saja. Halaman pengaturan baru
     `/dashboard/hris/payroll/settings` (BPJS, Tapera, THR/lembur, PTKP &
     bracket per tahun pajak) + API `GET/PUT /api/hris/payroll-settings`
     (Zod, batas kumulatif bracket divalidasi harus naik ketat).
   - Bracket PPh21 hardcoded terverifikasi BENAR (nilai = lebar lapisan);
     konversi batas kumulatif DB → lebar via `cumulativeLimitsToBrackets`.
     Bug sungguhan yang diperbaiki: (a) Tapera terpotong GANDA dari
     penghasilan kena pajak & keliru mengikuti flag BPJS TK, (b) biaya
     jabatan (5%, maks 6jt/thn) tidak pernah diterapkan, (c) PKP kini
     dibulatkan ke ribuan penuh ke bawah (ketentuan DJP), (d) pph21_annual
     disimpan nilai tahunan sebenarnya (bukan bulanan×12).
     24 unit test `lib/payroll/calculator.test.ts` dengan angka acuan manual.
   - Loader tunggal `lib/payroll/inputs.ts` dipakai batch & per-karyawan;
     seluruh console.log debug dihapus; karyawan yang dilewati kalkulasi
     kini dilaporkan eksplisit di respons (`summary.skipped`).
   - Guard status flow: transisi sah hanya draft→processing→completed→paid,
     run `paid` tidak bisa dihapus, calculate tetap khusus `draft`.
   - Review gate (code-reviewer): APPROVE, 0 CRITICAL/HIGH. Catatan MEDIUM
     "segregation of duties" (satu akun bisa process+approve+paid sendiri)
     → keputusan produk, lihat Open Questions #5.
2. **Fase B — Integrasi absensi v2 + shift + lembur dua arah** ✅ (2026-07-17)
   - `working_days` dihitung dari jadwal shift karyawan
     (`employee_shifts` via `lib/hris/shifts.resolveShiftForDate`) untuk
     periode berjalan, bukan fallback 20; jam kerja harian dari durasi shift,
     bukan hardcoded 8 jam.
   - **Pengajuan lembur dua arah** (keputusan owner 2026-07-17): tabel
     `hris.overtime_requests` — (a) karyawan mengajukan lembur via ESS,
     disetujui HRD/atasan; (b) HRD membuat penugasan lembur atas nama
     perusahaan (source `company`), karyawan mengonfirmasi. Jam lembur yang
     masuk payroll = jam dari pengajuan approved yang terealisasi
     (dicocokkan dengan clock-out attendance), bukan overtime_hours mentah.
   - Potongan keterlambatan berbasis `attendance.late_minutes` dengan aturan
     konfigurabel di `payroll_settings` (mis. per-menit / flat per kejadian /
     nonaktif) — kebijakan final tunggu keputusan (Open Questions).
   - Cuti: unpaid leave tetap memotong; cuti berbayar (annual/sick/dll yang
     approved) dihitung hadir-dibayar, tidak memotong; sumber hari dari
     `leaves` approved yang overlap periode.
   - **Realisasi (2026-07-17):** migrasi `20260717170000` (tabel
     `hris.overtime_requests` + kolom kebijakan + menu ESS/HRD) &
     `20260717180000` (unique index anti-duplikat aktif per karyawan+tanggal).
     Lib murni `lib/payroll/period.ts` (hari terjadwal dari pola shift dgn
     fallback eksplisit shift→absensi→20 via `workingDaysSource`; clamp cuti
     lintas bulan; realisasi lembur = approved ∧ ada clock_out, di-cap
     `attendance.overtime_hours` bila terisi; 17 unit test). Upah/jam lembur
     kini gaji pokok / `overtime_hourly_divisor` (default 173, Kepmenaker) —
     menggantikan base/hariKerja/8. Potongan telat konfigurabel
     (off/per_menit/flat) dari `late_minutes` absensi v2, tampil terpisah di
     slip (kolom `payroll_details.late_deduction`). API `GET|POST
     /api/hris/overtime` + `POST /api/hris/overtime/decide` (aturan aktor per
     sumber; pengaju tak bisa memutuskan pengajuannya sendiri sekalipun HR;
     guard balapan double-decide → 409). UI: ESS `/dashboard/me/lembur`
     (pengajuan + konfirmasi penugasan perusahaan), HRD
     `/dashboard/hris/overtime` (approve/reject + Tugaskan Lembur, page
     ber-`requireRole`), kartu Potongan Keterlambatan di pengaturan payroll.
     Review gate: 1 HIGH (self-approval bypass) + 3 MEDIUM — semua diperbaiki
     sebelum commit. Migrasi diapply ke DB dev (termasuk 6 migrasi lama yang
     belum tercatat di tracker; `20260716140000` dibuat idempoten karena
     rename menu bentrok dengan baris yang dibuat ulang migrasi 130000).
3. **Fase C — Integrasi kontrak PKWT/PKWTT** ✅ (2026-07-17)
   - Kelayakan & basis THR dari `employment_contracts` aktif (tipe pkwtt/pkwt
     + tanggal mulai untuk prorata), bukan magic string `employment_status`.
   - Saat kontrak ditandatangani/aktif, auto-buat versi `employee_salary`
     baru dari snapshot gaji kontrak (base_salary + allowances jsonb) supaya
     dua sumber gaji tidak menyimpang.
   - Proraté masuk/keluar tengah bulan dari tanggal mulai/berakhir kontrak
     (hari kerja terjadwal aktual dalam periode).
   - **Realisasi (2026-07-17):** THR kini berhak untuk pemegang kontrak
     PKWT MAUPUN PKWTT (Permenaker 6/2016); karyawan tanpa record kontrak
     memakai aturan lama (permanent) sebagai fallback. Proraté diterapkan
     ke gaji pokok + 5 tunjangan bulanan; THR & tarif per jam lembur tetap
     dari gaji penuh. Aktivasi kontrak (`activate()` di API contracts)
     menyinkronkan snapshot gaji kontrak → versi baru `hris.employee_salary`
     dalam transaksi yang sama (tunjangan/PTKP/flag BPJS dibawa dari versi
     sebelumnya; upsert aman utk effective_date sama). Temuan review yang
     diperbaiki: (a) CRITICAL — kolom `date` pg kembali sebagai objek Date
     lokal, dinormalisasi via `dateColToIso` (komponen lokal, bukan
     toISOString yang geser -1 hari WIB) di SEMUA tanggal loader — sekaligus
     memperbaiki bug laten Fase B (map tanggal lembur & perbandingan cuti);
     (b) CRITICAL — cakupan kontrak = GABUNGAN semua kontrak non-draft
     (`mergeDateRanges`, perpanjangan PKWT bersambungan 15→16 = cakupan
     penuh, bukan proraté 50%); (c) HIGH — denominator hari kerja konsisten
     dengan faktor proraté di semua cabang fallback.
4. **Fase D — Pinjaman (kasbon) mengalir ke payroll** ✅ (2026-07-17)
   - Kalkulator menarik cicilan `loans` aktif (status approved, periode ≥
     first_installment) → `payroll_details.loan_deduction`.
   - Saat run ditandai `paid`: kurangi `remaining_balance`, tambah
     `paid_amount`, tandai lunas otomatis (transaksional, idempoten).
   - **Realisasi (2026-07-17):** lib murni `lib/payroll/loans.ts` (isLoanDue,
     loanDeductionForPeriod, allocateLoanPayment, validateLoanLimits — 14
     unit test). Transisi paid = satu transaksi dgn FOR UPDATE + guard
     status completed (idempoten, anti dobel-potong); bila alokasi < potongan
     slip (run lain dibayar duluan) transaksi DIBATALKAN dgn 409 + daftar
     selisih — tidak ada potongan karyawan yang hilang diam-diam (temuan
     HIGH review). **Limitasi pinjaman BARU (jawaban owner "limitasi udah
     ada?" → belum):** konfigurabel di pengaturan payroll — cicilan maks %
     gaji pokok (default 30%) + maks pinjaman aktif/karyawan (default 1),
     divalidasi saat pengajuan DAN approval. Hardening: POST loans
     sebelumnya TANPA AUTH → kini role guard (LOAN_MANAGE_ROLES termasuk
     admin, selaras menu/page — temuan HIGH); cicilan pertama fix ke bulan
     depan; `remaining_balance` = total kewajiban termasuk bunga; reject
     menonaktifkan pinjaman; guard balapan approve (409). UI baru:
     `/dashboard/hris/loans` (menu Penggajian → Pinjaman; migrasi
     `20260717190000`) — pengajuan + approval + progres pelunasan; slip gaji
     menampilkan baris Cicilan Pinjaman; pengaturan payroll bertambah kartu
     Limitasi Pinjaman. Catatan LOW ke Fase F: race duplikat pengajuan
     pending (tertahan di approval, dampak rendah).
5. **Fase E — Slip gaji ESS + distribusi** ✅ (2026-07-17)
   - Halaman ESS `/dashboard/me/slip-gaji`: daftar slip per periode milik
     sendiri + detail slip (komponen penghasilan/potongan/netto/kehadiran);
     API `payslips` mendukung `employee_id=me` untuk role employee, hanya
     run berstatus `paid` yang terlihat karyawan.
   - Menu iam `ess.payroll` untuk role employee (pola menu ESS EPIC-007).
   - Tandai `payslip_sent/payslip_sent_at` saat distribusi; notifikasi
     WhatsApp "slip gaji terbit" via pola wa.me (mengikuti Fase 4 EPIC-007).
   - **Realisasi (2026-07-17):** API payslips dirombak dual-mode via
     `getWorkforceActor` — non-HR SELALU dipaksa ke slip miliknya sendiri
     (semua kombinasi parameter IDOR-safe, fail-closed utk run yatim);
     `employee_id=me` = tampilan personal utk SEMUA role (milik sendiri +
     paid saja — perbaikan HIGH review: HR yang membuka halaman ESS-nya
     sempat bisa melihat 60 slip lintas karyawan termasuk run belum final).
     API baru `POST /api/hris/payslips/notify` (role payroll, run paid
     saja): tandai `payslip_sent` + link wa.me tanpa nominal gaji; tombol
     WA per karyawan di halaman detail run (✓ hijau bila sudah terkirim).
     Halaman ESS: kartu per periode + dialog rincian lengkap (termasuk
     potongan telat & cicilan pinjaman). Menu ESS → Slip Gaji (migrasi
     `20260717210000`); bonus: menu Pinjaman dipindah ke grup Kepegawaian
     (permintaan owner, migrasi `20260717200000`).
6. **Fase F — Integritas data + QA** ✅ (2026-07-17)
   - [Dari review Fase C] Test integrasi lewat driver pg sungguhan (tipe
     Date kolom `date`) + test authz route lembur; pertimbangkan hapus
     `.limit(5)` di query kontrak inputs.ts bila rekalkulasi payroll periode
     lama (back-dated) jadi use case yang didukung.
   - FK `payroll_details` → `payroll_runs` (ON DELETE CASCADE) + →
     `employees`; hapus pola delete-before-insert manual jika sudah aman.
   - Unit test kalkulator menyeluruh (PPh21, BPJS caps, THR prorata, proraté
     tengah bulan, lembur, potongan telat, cicilan) + test guard status flow.
   - Update `docs/hris/HRIS_FASE2_PAYROLL_COMPLETE.md` → tandai superseded
     oleh epic ini.
   - **Realisasi (2026-07-17):** migrasi `20260717220000` — bersihkan baris
     yatim, FK run (CASCADE) + employee (RESTRICT: catatan finansial tak
     boleh ikut terhapus) + index; DELETE run kini mengandalkan cascade.
     Test integrasi `pg-types.integration.test.ts` lewat driver pg sungguhan
     (kunci asumsi: date = objek Date lokal, numeric = string; auto-skip
     tanpa DATABASE_URL). Aturan authz lembur diekstrak ke
     `lib/hris/overtime-rules.canDecideOvertime` (murni, 12 test — termasuk
     regression self-approval HR) dan transisi status run ke
     `lib/payroll/run-status` (9 test); route memakai fungsi teruji ini.
     `.limit(5)` kontrak → 50 (rekalkulasi back-dated aman). Race duplikat
     pengajuan pending loans = ACCEPTED RISK (tertahan di approval, aksi
     internal HR). Doc HRIS Fase 2 lama ditandai superseded.

## Acceptance Criteria

- [x] Semua endpoint payroll menolak akses tanpa role yang berhak (403).
- [x] Mengubah rate BPJS/PPh21 di pengaturan langsung mengubah hasil
      kalkulasi tanpa deploy ulang; angka PPh21 cocok dengan acuan resmi.
- [x] Hari kerja & jam kerja dihitung dari jadwal shift karyawan; karyawan
      tanpa jadwal ditangani eksplisit (bukan diam-diam 20 hari).
- [x] Lembur tervalidasi dan menit keterlambatan tercermin di slip sesuai
      aturan yang dikonfigurasi.
- [x] THR & proraté mengikuti kontrak aktif (PKWT/PKWTT + tanggal).
- [x] Cicilan pinjaman terpotong otomatis dan saldo pinjaman berkurang saat
      run paid (idempoten — tidak dobel potong).
- [x] Karyawan melihat slip gaji miliknya sendiri (hanya run paid) di ESS;
      tidak bisa melihat slip orang lain.
- [x] Status flow run tidak bisa dilompati/dirusak (calculate non-draft
      ditolak, run paid tidak bisa dihapus).
- [x] Unit test kalkulator hijau; lint + build hijau.

## Test Plan

- Unit: kalkulator (bracket PPh21 nilai acuan, BPJS caps, THR prorata pkwt/
  pkwtt, proraté tengah bulan, lembur, telat, cicilan), resolusi hari kerja
  dari pola shift (termasuk shift malam & minggu tanpa jadwal).
- Integration: siklus penuh run (create→calculate→process→approve→paid) via
  API dengan role berbeda; akses ESS `employee_id=me`; idempotensi potong
  cicilan saat paid dipanggil dua kali.
- E2E (dev): HRD membuat run periode berjalan pada data seed shift+absensi,
  verifikasi angka slip 1 karyawan secara manual; karyawan login lihat slip.

## Agent Routing

- Implementasi: Claude Code per fase (satu fase = satu task group = satu PR).
- Review gate: typescript-reviewer + security-reviewer (auth & data gaji =
  sensitif), database-reviewer untuk migrasi FK/settings.
- Test gate: unit (calculator, shifts resolve) + build + lint.

## Done Signal

Semua fase A–F selesai, acceptance criteria tercentang, status → ready-for-qa
dengan QA manusia memverifikasi 1 siklus payroll penuh di dev.

## Open Questions — DIPUTUSKAN (owner, 2026-07-17)

1. **Potongan keterlambatan** → **konfigurabel** di pengaturan payroll
   (mode: nonaktif / per-menit / flat per kejadian), nonaktif by default.
2. **Lembur** → **pengajuan lembur tersendiri, dua arah**: karyawan
   mengajukan sendiri (ESS) DAN perusahaan bisa menugaskan lembur — HRD yang
   membuat pengajuan jika dari perusahaan. Detail di Fase B.
3. **Multi-tenant** → ikut best practice: di luar scope epic ini, ditangani
   sebagai epic arsitektur terpisah (menambah `business_id` ke seluruh skema
   hris sekaligus, bukan tambal sulam di payroll saja).
4. **Proraté** → basis hari kerja terjadwal dari pola shift (best practice,
   konsisten dengan absensi v2).
5. **Segregation of duties** → DIPUTUSKAN owner 2026-07-17: TIDAK perlu
   larangan satu akun memproses+approve+mark-paid run yang sama — cukup
   pembatasan role (sudah terpenuhi via `PAYROLL_MANAGE_ROLES`). Tidak ada
   pekerjaan lanjutan.

## Automation Log

- 2026-07-17 — Epic dibuat dari audit menyeluruh modul payroll (Explore
  agent): payroll HRIS Fase 2 terkonfirmasi terputus dari absensi v2/shift/
  kontrak/kuota cuti, auth bolong di endpoint run/calculate, konfigurasi
  hardcoded menyimpang dari tabel settings. Status: backlog (menunggu
  keputusan Open Questions + go dari owner).
- 2026-07-17 — Owner memutuskan Open Questions 1–4 (potongan telat
  konfigurabel; lembur via pengajuan dua arah karyawan/perusahaan;
  multi-tenant epic terpisah; proraté basis hari terjadwal). Status →
  on-progress.
- 2026-07-17 — Fase A selesai. Temuan penting: bracket PPh21 hardcoded
  ternyata sudah benar (nilai = lebar lapisan), bug sebenarnya adalah Tapera
  dobel-potong dari PKP + biaya jabatan tak pernah diterapkan — keduanya
  diperbaiki dengan regression test. Gates: 338 unit test hijau, tsc bersih,
  eslint 0 error, build produksi sukses, code-review APPROVE (2 MEDIUM:
  validasi bracket → langsung diperbaiki; segregation of duties → Open
  Question #5). CATATAN DEPLOY: perubahan menaikkan akurasi PPh21 — hasil
  kalkulasi run draft lama akan berubah sedikit saat dihitung ulang (bukan
  bug).
- 2026-07-17 — Fase B selesai. Lembur dua arah live di dev (tabel, API,
  ESS, HRD, menu iam); payroll membaca jadwal shift/lembur/telat/cuti
  sungguhan. Gates: 358 unit test hijau (17 baru utk period.ts), tsc/eslint
  bersih, build sukses, review WARNING→semua temuan diperbaiki (HIGH
  self-approval, race duplikat lembur via unique index, role guard page HRD,
  potongan telat di slip). Catatan: tarif lembur berubah ke standar 1/173 —
  nilai lembur run lama akan berbeda bila dihitung ulang. Test integrasi
  authz route lembur ditunda ke Fase F (test gate).
- 2026-07-17 — OQ#5 diputuskan owner: TIDAK perlu segregation of duties
  antar-akun pada run payroll; pembatasan role saja sudah cukup.
- 2026-07-17 — Fase C selesai. Review gate menemukan 2 CRITICAL penting:
  (1) kolom date pg = objek Date (bukan string) sehingga seluruh
  perbandingan tanggal loader mati diam-diam — juga bug laten Fase B;
  (2) pemilihan kontrak tunggal membuat perpanjangan PKWT tengah bulan
  terproraté 50% padahal kerja penuh. Keduanya + 1 HIGH diperbaiki
  (dateColToIso, mergeDateRanges union coverage, denominator konsisten)
  dan diverifikasi ulang reviewer. Gates: 375 unit test hijau, tsc/eslint
  bersih, build sukses. PELAJARAN: fungsi murni ber-test hijau bisa mati
  total di produksi bila asumsi tipe data driver salah — Fase F wajib
  tambah test integrasi yang lewat driver pg sungguhan.
- 2026-07-17 — Fase D selesai. Modul pinjaman ternyata setengah jadi
  (POST tanpa auth, tanpa limit, tanpa UI, saldo tak termasuk bunga,
  cicilan pertama bulan berjalan) — semua dibereskan + cicilan mengalir ke
  payroll dan saldo berkurang transaksional saat run paid. Review gate:
  2 HIGH diperbaiki (potongan slip yang tak teralokasi kini membatalkan
  transisi paid dgn 409 + daftar selisih; role admin diselaraskan
  menu↔page↔API via LOAN_MANAGE_ROLES). Gates: 389 unit test hijau,
  tsc/eslint bersih, build sukses, migrasi 20260717190000 diapply dev.
- 2026-07-17 — Menu Pinjaman dipindah ke grup Kepegawaian (permintaan
  owner; rename in-place hris.compensation.loans → hris.kepegawaian.loans,
  permissions utuh).
- 2026-07-17 — Fase E selesai. Karyawan kini melihat slip gajinya sendiri
  di ESS (run paid saja); HRD bisa kirim notifikasi WA "slip terbit" per
  karyawan + penanda payslip_sent. Review gate: scoping karyawan
  terverifikasi IDOR-safe & fail-closed; 1 HIGH diperbaiki (halaman ESS
  milik user ber-role HR sempat menampilkan slip lintas karyawan termasuk
  run belum final → employee_id=me kini tampilan personal utk semua role).
  Gates: 389 unit test hijau, tsc/eslint bersih, build sukses, migrasi
  20260717200000+210000 diapply dev.
- 2026-07-17 — Fase F selesai → EPIC ready-for-qa. FK integritas
  payroll_details (temuan menarik: DB dev TERNYATA sudah punya FK auto-named
  yang tak tercermin di file skema introspeksi — migrasi dibuat cek
  per-kolom, duplikat di dev dibersihkan; file skema stale, jalankan
  `npm run db:pull` saat senggang). Aturan authz lembur & transisi status
  run diekstrak jadi fungsi murni teruji (21 test baru); test integrasi
  driver pg sungguhan mengunci asumsi tipe (date=Date lokal,
  numeric=string); limit kontrak 5→50; DELETE run pakai FK cascade.
  Review: APPROVE, 2 MEDIUM langsung dibereskan (index duplikat; catatan
  deploy). ⚠️ DEPLOY NOTE: migrasi 20260717220000 WAJIB diapply
  sebelum/bersamaan deploy kode Fase F di environment mana pun (DELETE run
  kini bergantung FK cascade). Gates final: 408 unit test hijau, build
  sukses. Sisa utk QA manusia: 1 siklus payroll penuh di dev
  (create→calculate→approve→paid→slip ESS→notif WA).
