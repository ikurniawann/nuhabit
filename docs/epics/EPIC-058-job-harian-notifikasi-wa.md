# EPIC-058: Job Harian Otomatis & Pengingat WhatsApp

status: backlog
environment: dev
retries: 0

## Goal

Proses rutin studio berjalan sendiri tanpa tombol manual, dan member menerima pengingat WhatsApp.

Referensi: [PRD](../product/PRD.md) · [BACKLOG](../BACKLOG.md).

## Keputusan desain

- Memakai mekanisme job/cron yang sudah ada di codebase BCD bila tersedia; idempoten (aman dijalankan ulang).
- Pengingat WA lewat integrasi WhatsApp yang sudah ada (EPIC-012/020).

## Tasks

- [ ] T-058-1 Job harian: kedaluwarsakan pass (breakage), selesaikan sesi yang sudah lewat (no-show diakui), tutup slot.
- [ ] T-058-2 Pengingat WA H-1 kelas / Personal Training, paket hampir habis (kredit/masa aktif), promosi waitlist.
- [ ] T-058-3 Log eksekusi job + halaman status di backoffice.

## Acceptance Criteria

- [ ] Pass kedaluwarsa & sesi lewat diproses otomatis tiap hari tanpa duplikasi.
- [ ] Member menerima pengingat WA sesuai jadwal; bisa dimatikan di pengaturan.

## Automation Log

- 2026-10-02 — Didaftarkan dari daftar sisa pekerjaan setelah EPIC-056; owner: "lanjut, 5 poin dimasukkan ke task".
