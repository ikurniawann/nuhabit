# EPIC-007: Kehadiran & Cuti — Perombakan + ESS

status: ready-for-qa
environment: dev
retries: 0

## Goal

Merombak modul Kehadiran & Cuti berdasarkan hasil audit (bug kritis + salah
aktor): karyawan absen & mengajukan cuti lewat portal ESS (Employee
Self-Service) miliknya sendiri, sedangkan halaman HRD/Super Admin menjadi
murni rekap + approval. Ditutup dengan jadwal kerja HRIS sebagai dasar
perhitungan keterlambatan.

## Tasks

1. **Fase 1 — Stop pendarahan** ✅ (commit `6d25c2c`)
   - Fix FK `approved_by` (cuti) & `validated_by` (absensi): mapping akun→
     karyawan via `lib/hris/workforce-auth.getWorkforceActor`.
   - Approval cuti transaksional + upsert kuota `ON CONFLICT (employee_id, year)`;
     super_admin/admin kini boleh approve.
   - Auth wajib di `GET /api/hris/leaves` & `/api/hris/attendance` (sebelumnya
     terbuka publik); non-HR dibatasi data sendiri; dukungan `employee_id=me`;
     clock-in/cuti non-HR tidak bisa atas nama orang lain.
   - Clock-out pulih setelah refresh; tolak clock-out ganda; kalender
     auto-refresh; embed FK leaves diberi hint eksplisit.
   - Fitur palsu dijujurkan: upload lampiran cuti & import Excel jadwal.
2. **Fase 2 — ESS + role employee** ✅ (commit `720ea7a`)
   - Role `employee` + menu "Area Karyawan" `/dashboard/me`
     (migrasi `20260716150000`); redirect employee dari /dashboard.
   - Halaman ESS: clock-in/out GPS, kalender absensi sendiri, kuota cuti,
     riwayat + form pengajuan izin/cuti mandiri; API `GET /api/hris/me`.
3. **Fase 3 — Absensi v2: shift + selfie kamera + keterlambatan** ✅
   (commit `3488e0b` + `66e0c71`, 2026-07-17)
   - Master `hris.shifts` (jam kerja, toleransi terlambat per shift, shift
     malam; seed Pagi/Siang/Malam) + `hris.employee_shifts` (pola mingguan
     berversi effective_from/to) — halaman Kepegawaian → Shift Kerja + tab
     Jadwal Shift di detail karyawan. Lib `lib/hris/shifts.ts` (10 unit test).
   - ESS dipecah: menu Absensi (/dashboard/me/absensi) & Izin & Cuti
     (/dashboard/me/cuti).
   - Selfie kamera WAJIB clock-in/out (CameraCapture + EssClockPanel), foto
     di storage private, disajikan via route ber-auth
     /api/hris/attendance/photo (HR semua, karyawan miliknya).
   - Keterlambatan dihitung dari shift saat clock-in (snapshot shift + jam
     terjadwal ke baris absen); tanggal absen berbasis WIB; tanpa jadwal =
     tercatat di luar jadwal. Quick Stats rekap HRD hidup via
     /api/hris/attendance/stats; tombol clock dihapus dari halaman HRD.
4. **Fase 4 — Penyempurnaan cuti** ✅ (commit `53c6430`, 2026-07-17)
   - Refund kuota otomatis saat HRD membatalkan cuti yang sudah disetujui
     (transaksional); karyawan tetap bisa membatalkan pengajuan pending.
   - Lampiran cuti sungguhan (storage private + route ber-auth) di form ESS
     dan form HRD.
   - MSS: atasan langsung (`reporting_to`) boleh approve/reject anak buah.
   - Notifikasi WhatsApp keputusan approve/reject via link wa.me (dibuka
     otomatis oleh UI approver).
   - Sisa kecil: label/CSV jenis cuti marriage/bereavement belum lengkap.
5. **Fase 5 — Monitoring harian + Rekap HRD** ✅ (2026-07-17)
   - API `GET /api/hris/attendance/daily-roster?date=` (khusus HR): semua
     karyawan aktif + shift terjadwal (resolve pola `employee_shifts`) LEFT
     JOIN absensi tanggal itu + cuti approved; status turunan per karyawan
     hadir/terlambat/belum_absen/absen(tgl lewat)/cuti/libur/tanpa_jadwal.
     Lib murni `lib/hris/daily-roster.ts` (15 unit test): absensi menang atas
     cuti; `is_overdue` = terjadwal belum absen melewati jam mulai+toleransi;
     shift malam masuk roster tanggal MULAI shift (konsisten `date` clock-in).
   - Halaman Absensi HRD dirombak jadi 2 tab. **Monitoring**: pemilih
     tanggal, chip ringkasan (klik = filter), grup per shift + grup "tanpa
     shift", baris karyawan (jam masuk/pulang WIB, menit telat, link selfie,
     badge status, highlight lewat toleransi), filter shift/status/cari.
     **Rekap**: tabel absensi berpagination (filter karyawan sungguhan via
     Combobox, bulan, hanya-terlambat via param baru `is_late=true`),
     statistik bulan terpilih, export CSV mengikuti filter, kalender
     per-karyawan hanya saat satu karyawan dipilih (memperbaiki bug kalender
     org-wide yang saling menimpa record per tanggal).
   - Filter mati di halaman lama (dropdown karyawan statis, bulan tanpa
     handler) dihapus/diganti yang berfungsi.

## Acceptance Criteria

- [x] Approve/reject cuti dan validasi absensi berfungsi tanpa error FK.
- [x] Endpoint list absensi/cuti menolak akses tanpa login; non-HR hanya melihat miliknya.
- [x] Karyawan role employee bisa clock-in/out & mengajukan cuti dari /dashboard/me.
- [x] Fase 3: keterlambatan terhitung otomatis dari jadwal shift + toleransi.
- [x] Clock-in/out menolak permintaan tanpa foto selfie; foto hanya bisa diakses via route ber-auth.
- [ ] QA manual: atur shift karyawan → login ESS → absen dgn kamera → cek terlambat/tepat waktu + foto di rekap HRD → ajukan cuti → approve sebagai HRD.
- [x] Fase 4: kuota dikembalikan saat pembatalan cuti approved; link WA keputusan dibuat otomatis.
- [x] Fase 5: HRD melihat roster hari ini per shift (siapa sudah/belum absen, cuti, libur) + rekap tabel berfilter.
- [ ] QA manual Fase 5: buka Absensi → tab Monitoring (cek grup shift & status) → tab Rekap (filter karyawan/bulan/terlambat, export CSV, kalender per karyawan).

## Automation Log

- **20 Jul 2026** — Badge notifikasi navigasi dua arah untuk seluruh pengajuan
  (izin & cuti, lembur, pinjaman). Sisi HR menghitung pengajuan `pending`;
  sisi karyawan menghitung pembaruan sejak terakhir halaman dibuka, memakai
  tabel penanda baru `hris.ess_module_reads`. Pengajuan yang masih `pending`
  sengaja tidak memberi badge kepada karyawan agar ia tidak dinotifikasi atas
  perbuatannya sendiri. Angka antrean HR hanya dikembalikan kepada role HR di
  level API, bukan sekadar disembunyikan di UI. Badge pengumuman yang dulu
  punya fetch sendiri ikut disatukan ke endpoint yang sama.

- 2026-07-16: Audit menyeluruh (agen eksplorasi) menemukan 2 bug kritis
  (FK approval/validasi; is_late mati total karena tak ada jadwal employee),
  2 endpoint tanpa auth, dan modul Jadwal ternyata mengelola staff POS —
  bukan karyawan HRIS. Keputusan produk: pola ESS/MSS — absen & pengajuan di
  portal karyawan, halaman HRD murni rekap/approval; Fase 1+2 dikerjakan
  langsung, Fase 3+4 menunggu.
- 2026-07-17: Fase 5 (monitoring harian) — keputusan desain: status
  kehadiran DITURUNKAN (bukan dibaca dari kolom `status` yang selalu
  'present'): row absensi menang atas cuti; "absen/mangkir" hanya utk
  tanggal lewat, hari berjalan memakai "belum_absen" + flag `is_overdue`;
  filter rekap keterlambatan pakai param baru `is_late=true` di
  GET /api/hris/attendance. Gate: 312 test lulus, tsc/eslint bersih di file
  terdampak, build OK, deploy dev PM2 + smoke 200/401.
- 2026-07-17: Laporan user — kalender ESS (/dashboard/me/absensi) tidak
  menampilkan jadwal shift. Fix: (1) endpoint baru
  `GET /api/hris/attendance/schedule?employee_id=me|<uuid>` (karyawan boleh
  jadwal sendiri, HR semua); (2) AttendanceCalendar merender jadwal per hari
  (nama shift + jam, "Libur" utk hari libur) via
  `resolveScheduleRowForDate` baru di lib/hris/shifts.ts (membedakan libur
  vs tanpa jadwal); (3) BUG LATEN ditemukan: server TZ WIB membuat kolom
  `date` ter-serialize "T17:00Z hari sebelumnya" sehingga lookup kalender
  per tanggal TIDAK PERNAH match — tanda absensi tak pernah tampil;
  dinormalisasi via toLocaleDateString en-CA zona Asia/Jakarta + kunci
  tanggal lokal tanpa toISOString. 314 test lulus, build + deploy dev OK.
