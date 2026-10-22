# EPIC-068: Task Departemen — progress management & pemantauan per departemen

status: ready-for-qa
environment: dev
retries: 0

## Goal

Permintaan client 2026-10-22: "Buatkan Task Department untuk progress management dan pemantauan pekerjaan per
departemen."

Fitur Task Departemen sudah ada dari BCD Coffee (task rutin harian/mingguan/bulanan & sekali jalan, penanggung jawab,
sub-task berbobot, review Head Division, indikator KPI `task_completion`) tetapi menunya disembunyikan saat Nuhabit
merapikan menu (2026-10-02). Epic ini menghidupkannya lagi dan menambah progress management serta pemantauan.

Referensi: [PRD](../product/PRD.md) · [BACKLOG](../BACKLOG.md).

## Keputusan

- **Cakupan dipilih user:** aktifkan menu + dashboard pemantauan (bukan epic lengkap dengan Kanban/komentar/lampiran
  dulu).
- **Hak lihat sama dengan daftar task:** HRD (role HR) melihat semua departemen; karyawan lain hanya departemennya.
  Atasan (punya bawahan langsung) mengelola & mereview task departemennya; penanggung jawab mengerjakan.
- **Status baru "Sedang dikerjakan"** (`in_progress`) dengan progres: dari bobot ceklis sub-task bila task punya
  sub-task, atau diisi penanggung jawab 0–99% (100% = Tandai Selesai). Catatan progres tersimpan sebagai riwayat.
- **Definisi pemantauan:** jatuh tempo = jadwal ≤ hari ini; terlambat = lewat tanggal & belum selesai (belum mulai,
  dikerjakan, atau ditolak); penyelesaian = disetujui ÷ jatuh tempo (sama dengan KPI `task_completion`).
- **Perbaikan:** task rutin tidak lagi dijadwalkan sebelum tanggal dibuat (sebelumnya task harian yang dibuat tgl 22
  langsung punya 21 jadwal "terlambat" sejak tgl 1 yang ikut dihitung KPI).

## Tasks

- [x] T-068-1 Hidupkan menu `hris.performance.dept-tasks` (migrasi + seeder IAM).
- [x] T-068-2 Status `in_progress`, persen progres, catatan progres (`hris.department_task_updates`).
- [x] T-068-3 Tab **Pemantauan**: ringkasan, per departemen & penanggung jawab, task terlambat, menunggu review.
- [x] T-068-4 Task rutin dijadwalkan sejak tanggal dibuat.
- [x] T-068-5 Deploy ke DEV.

## Acceptance Criteria

- [ ] Menu Task Departemen tampil untuk karyawan; HRD bisa memilih departemen.
- [ ] Penanggung jawab bisa mencatat progres (persen/catatan) dan status menjadi "Sedang dikerjakan".
- [ ] Tab Pemantauan menampilkan progres & penyelesaian per departemen dan per penanggung jawab, daftar task terlambat
      (dengan catatan terakhir), dan task yang menunggu review.
- [ ] Task rutin baru tidak memunculkan jadwal terlambat sebelum tanggal dibuat.
- [ ] Tampilan rapi di HP.

## Automation Log

- 2026-10-22 — **T-068-1 s/d T-068-4 selesai.**
  - Migrasi `20261023150000_hris_dept_task_progress.sql`: menu dihidupkan + hak akses semua role (seperti aslinya);
    kolom `progress_percent`, `started_at` di `hris.department_task_occurrences`; tabel `hris.department_task_updates`.
    Seeder `iam-menus.sql` memuat kembali menu (baris + daftar canonical).
  - API: aksi `progress` di `PATCH /api/hris/dept-tasks/occurrences/[id]`; ceklis sub-task sebagian → `in_progress`;
    daftar memuat persen & catatan terakhir; `GET /api/hris/dept-tasks/monitor?month=`.
  - UI: tab Daftar Task / Pemantauan; badge "Sedang dikerjakan", persen & catatan di baris; form Update progres;
    dashboard pemantauan (kartu ringkasan, kartu per departemen dengan bar penyelesaian & progres, tabel PJ — daftar
    ringkas di HP, task terlambat "terlambat N hari", menunggu review). Daftar dimuat ulang saat kembali dari tab
    Pemantauan. Widget ESS "tugas hari ini" ikut menghitung yang sedang dikerjakan.
  - Bukti:
    - 5 unit test pemantauan + 1 unit test jadwal sejak tanggal dibuat + 3 test integrasi DB (progres manual &
      sub-task, terlambat, tunggu review, catatan terakhir, filter departemen) lulus di `nuhabit_test`;
    - regresi HRIS/KPI: 231 lulus;
    - E2E (Head & anggota uji; fixture dihapus): anggota mencatat 40% + catatan pada task lewat tempo → menu tampil
      di sidebar → Head melihat Pemantauan (1 terlambat, catatan) → anggota Tandai Selesai → Head Setujui →
      Pemantauan: 0 terlambat, penyelesaian 50%; tampilan HP tanpa overflow; tanpa error console. Ditemukan &
      diperbaiki: jadwal sebelum tanggal dibuat, daftar tidak memuat ulang, tabel PJ terpotong di kartu sempit;
    - `tsc` tetap 508, eslint tanpa error baru.
  - Belum di-deploy.
- 2026-10-22 19.55 WIB — **Di-deploy ke DEV (https://nuhabitdev.reddie.id)** dari commit `354f0bbf` → status
  `ready-for-qa`.
  - Backup sebelum migrasi: `~/backups/nuhabitdev/nuhabit-20261022-194145-pre-epic068.sql.gz` (dump lengkap; jumlah
    baris departemen/karyawan/task/menu/sesi cocok).
  - Migrasi: 1 delta (`20261023150000_hris_dept_task_progress`), satu-satunya yang pending. Menu aktif & terlihat,
    hak akses 6 role, tabel & kolom baru ada.
  - Image: `nuhabitdev:local` baru (`d3f7bb1a5469`); rollback `nuhabitdev:pre-epic068`. Container dengan 6 env yang
    sama, healthy.
  - Smoke test (hanya baca, super admin): daftar task & pemantauan 200 (live belum punya task: 0 departemen
    bertask), bulan tidak valid 400; menu Task Departemen di sidebar; tab Pemantauan di desktop & 390px tanpa
    overflow/error; regresi payroll, cuti coach, cuti HRIS 200; log bersih; tidak ada jadwal yang tertulis di live.
  - Perlu di live: Head Division / HRD membuat task (Tambah Task); atasan di data karyawan menentukan siapa yang
    boleh membuat & mereview task.
  - Rollback: jalankan ulang container dengan `nuhabitdev:pre-epic068` (migrasi hanya menambah kolom/tabel dan
    menghidupkan menu; image lama tetap jalan). Restore dump di atas bila perlu.
