# EPIC-055: Personal Training

status: ready-for-qa
environment: dev
retries: 0

## Goal

Member (atau front desk) memesan sesi **Personal Training** — sesi privat 1 coach 1
member: pilih program → muncul coach yang bisa melatihnya beserta background-nya →
pilih tanggal → pilih jam dari slot kosong coach. Kredit Personal Training dikunci;
revenue Personal Training diakui saat sesi selesai (dasar pool komisi 40%, EPIC-056).

Referensi: [PRD](../product/PRD.md) §2 ("private memilih coach dan tanggalnya") ·
[EPIC-053](./EPIC-053-member-pass.md) · [EPIC-054](./EPIC-054-booking-kelas-checkin.md).

## Keputusan desain

- **Istilah**: owner meminta "Personal Training" ditulis lengkap di semua UI/pesan (tidak
  disingkat "PT"); singkatan hanya di identifier kode. Dicatat di DESIGN.md §7.
- **Cara jual PT belum diputuskan owner** → keduanya didukung: kredit Personal Training di
  paket Class + Personal Training, dan kategori paket baru **"Personal Training saja"**
  (`pt`) untuk jual per sesi / paket Personal Training tanpa kredit kelas.
- **Slot = ketersediaan − jadwal − cuti**: jam mingguan coach (`studio.coach_availability`)
  dikurangi semua sesi coach yang tidak batal (kelas grup & Personal Training lain) dan cuti
  (`studio.coach_time_off`), dipotong per 30 menit sesuai durasi program. Coach hanya
  muncul untuk program yang ditautkan (`studio.coach_programs`).
- **Sesi Personal Training dibuat on-demand** di `studio.class_sessions` (`origin =
  'pt_booking'`, kuota 1) + booking + kunci kredit `pt`. Dengan begitu kalender, check-in,
  beban coach, revenue & komisi memakai jalur yang sama dengan kelas.
- **Anti double-booking**: advisory lock per coach+tanggal, slot dicek ulang di dalam
  transaksi; member juga tidak bisa punya dua jadwal di jam yang sama.
- **Batal**: aturan sama dengan kelas (12 jam). Batal tepat waktu → kredit kembali dan sesi
  dibatalkan (slot coach bebas). Batal telat → sesi tetap, kredit diakui saat selesai.
- **Revenue per jenis kredit**: penyelesaian sesi menghitung nilai dari `pt_value /
  pt_credits_total` (alokasi kumulatif) dan memposting `STUDIO_PASS_REDEEM_PT` terpisah
  dari `STUDIO_PASS_REDEEM_CLASS`.
- **Pengujian terisolasi**: setelah data uji sempat bercampur dengan data asli owner di
  database dev, E2E kini dijalankan di database `nuhabit_test` (lihat DEPLOY-DEV.md).

## Tasks

- [x] T-055-1 Migrasi `20261002210000_studio_personal_training.sql`: kategori paket `pt`, `coach_programs`, `coach_availability`, `coach_time_off`, `class_sessions.origin`, menu Personal Training & Ketersediaan Coach.
- [x] T-055-2 Logika murni `src/lib/studio/pt.ts` (slot kosong, jendela per tanggal, cuti) + 6 tes.
- [x] T-055-3 Mesin: `pt-server.ts` (katalog, slot, booking, ketersediaan) + generalisasi `booking-server.ts` (kunci/lepas kredit per jenis, revenue & jurnal per jenis, batal Personal Training membebaskan slot).
- [x] T-055-4 API staf `availability/*`, `pt/{catalog,slots,bookings}`; API Member App `member-portal/studio/pt/{catalog,slots,bookings}`.
- [x] T-055-5 UI: Personal Training (alur booking 4 langkah + jadwal Personal Training), Ketersediaan Coach (program, jam mingguan, cuti); Check-in menampilkan sesi Personal Training; "PT" ditulis lengkap di seluruh UI.
- [ ] T-055-6 UI Personal Training di Member App — EPIC-057.

## Acceptance Criteria

- [x] Admin menautkan program Personal Training & jam mingguan per coach; jam tumpang tindih ditolak.
- [x] Slot otomatis terpotong jadwal kelas coach & cuti; booking slot yang sama dua kali ditolak.
- [x] Booking mengunci kredit Personal Training (FEFO); pass "Personal Training saja" tidak bisa dipakai kelas grup.
- [x] Batal tepat waktu → kredit kembali & slot tersedia lagi.
- [x] Sesi selesai → revenue Personal Training diakui (ledger `pt`, utang pass turun).
- [x] Member App: katalog program + profil coach, slot, booking.

## Automation Log

- 2026-10-02 — Owner: "kredit PT itu apa?" → dijelaskan; owner minta lanjut development dan menulis "Personal Training" lengkap.
- 2026-10-02 — Selesai T-055-1..5. Gate: vitest studio (pt 6) PASS; typecheck file studio bersih; E2E di `nuhabit_test`: jadwal 22/22, pass 27/27, booking 32/32 (regresi setelah generalisasi kredit), Personal Training 25/25. Data uji yang sempat masuk ke database dev dihapus terarah (suffix OZWT/PLGA) dengan pengaman; data owner (Coach Pras, Program Hyrox 1, Hyrox Special Program, Regular/Special Class, member Ilham, 5 template, 16 sesi) utuh.
