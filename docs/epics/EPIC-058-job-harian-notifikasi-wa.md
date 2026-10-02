# EPIC-058: Job Harian Otomatis & Pengingat WhatsApp

status: ready-for-qa
environment: dev
retries: 0

## Goal

Proses rutin studio berjalan sendiri tanpa tombol manual, dan member menerima pengingat WhatsApp.

Referensi: [PRD](../product/PRD.md) · [BACKLOG](../BACKLOG.md) · [EPIC-054](./EPIC-054-booking-kelas-checkin.md) · [EPIC-056](./EPIC-056-komisi-coach-coach-portal.md).

## Keputusan desain

- **Watcher di proses aplikasi** (pola `instrumentation.ts` yang sudah dipakai BCD), tick tiap 10 menit per venue.
  `STUDIO_JOBS_DISABLED=1` mematikannya per proses.
- **Tutup hari** (default nyala, 23.00 WIB): selesaikan sesi yang selesai > 1 jam lalu (tanpa check-in = tidak hadir,
  kredit & revenue diakui), kedaluwarsakan pass (breakage), tutup pesanan paket online kedaluwarsa. Sekali per hari per
  venue — dijamin indeks unik `job_runs (branch, job, tanggal)` untuk trigger auto; server mati di jam itu → dikejar
  pada tick berikutnya. Semua langkah idempoten; tombol manual tetap ada.
- Alasan bisnis: komisi coach dihitung dari revenue yang diakui, jadi sesi yang lupa diselesaikan membuat komisi kurang.
- **Pengingat WhatsApp** (default **mati**, dinyalakan admin): H-1 sesi kelas & Personal Training (jam kirim bisa
  diatur, default 19.00), naik dari waitlist (segera), kredit hampir habis (total sisa semua paket ≤ ambang), paket
  hampir berakhir (≤ N hari). Hanya 08.00–21.00 WIB; satu pesan per kejadian (klaim `dedup_key` sebelum kirim → restart
  tidak mengirim ulang; timeout tidak diulang). H-1 dilewati bila member baru dikabari naik dari waitlist untuk booking yang sama.
- Pengingat bersifat **transaksional**, terpisah dari `wa_consent` (persetujuan marketing). Member bisa mematikannya dari
  Member App (`studio.member_prefs`).
- Jurnal untuk aksi sistem memakai `userId = null` (EPIC-057), jadi revenue sesi yang diselesaikan otomatis tetap terjurnal.

## Tasks

- [x] T-058-1 Migrasi `20261003090000_studio_jobs_notifications.sql`: `job_runs`, `member_notifications`, `member_prefs`, menu Otomasi & Pengingat.
- [x] T-058-2 Logika murni `jobs.ts` (jadwal, jam layak, isi pesan, dedup) + 6 tes; mesin `jobs-server.ts`; watcher `jobs-watcher.ts` terdaftar di `instrumentation.ts`.
- [x] T-058-3 API `studio/automation` (status, pengaturan, jalankan manual) + halaman backoffice (status, pengaturan, riwayat job, log pengingat); toggle pengingat di profil Member App.

## Acceptance Criteria

- [x] Pass kedaluwarsa & sesi lewat diproses otomatis tiap hari tanpa duplikasi.
- [x] Member menerima pengingat WA sesuai jadwal; bisa dimatikan admin (global) dan member (pribadi).

## Automation Log

- 2026-10-02 — Didaftarkan dari daftar sisa pekerjaan setelah EPIC-056.
- 2026-10-02 — Owner bertanya "job harian itu apa?" → dijelaskan; owner setuju dikerjakan.
- 2026-10-02 — Selesai T-058-1..3. Gate: vitest studio+accounting 80/80 (jobs 6); typecheck file studio/member-app/whatsapp bersih (error tersisa di modul warisan BCD → EPIC-065); E2E `jobs-e2e` di `nuhabit_test` + mock WA gateway 29/29 (tutup hari manual & idempoten, unik harian, no-show diakui, breakage, H-1, waitlist, kredit habis, paket berakhir, opt-out member, nomor ditolak/tidak valid, tidak dobel); watcher otomatis terbukti menjalankan tutup hari sendiri setelah boot.
- 2026-10-02 — DEV: tutup hari aktif 23.00 WIB; pengingat WA mati sampai WA Gateway dikonfigurasi & admin menyalakan.
