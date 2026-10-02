# EPIC-057: Member App NüHabit

status: on-progress
environment: dev
retries: 0

## Goal

Member memakai semua fitur studio dari HP: lihat jadwal & booking kelas, booking Personal Training (pilih coach + jam), cek sisa kredit & masa aktif pass, beli paket online, baca News Hyrox, dan melihat profil coach. Backend booking/Personal Training/pass sudah ada (EPIC-053..055); epic ini membangun aplikasinya.

Referensi: [PRD](../product/PRD.md) · [BACKLOG](../BACKLOG.md).

## Keputusan desain

- `/member` diganti aplikasi NüHabit (desain DESIGN.md, mobile-first); portal Nox/klasik BCD (ARK Coin, XP) tidak relevan dan tidak lagi jadi rute utama.
- Login tetap OTP WhatsApp portal member yang sudah ada (identitas = `pos.pos_customers`, nomor 62xxx).
- Beli paket online memakai Xendit QRIS dinamis yang sudah ada: pass dibuat `pending_payment`, aktif saat webhook/cek status lunas (event jurnal `STUDIO_PASS_SALE_ONLINE`).
- "Personal Training" ditulis lengkap di seluruh UI.

## Tasks

- [ ] T-057-1 Shell aplikasi `/member` NüHabit + login OTP + navigasi bawah (Beranda, Jadwal, Personal Training, Paket, Profil).
- [ ] T-057-2 Beranda: booking terdekat, ringkasan kredit kelas/Personal Training, masa aktif.
- [ ] T-057-3 Jadwal kelas: daftar per hari, booking, waitlist, batal (aturan 12 jam ditampilkan).
- [ ] T-057-4 Personal Training: pilih program → coach (profil) → tanggal → jam → konfirmasi; daftar & batal.
- [ ] T-057-5 Paket: pass saya + riwayat kredit; katalog paket + beli online via Xendit QRIS (order, polling/webhook, aktivasi).
- [ ] T-057-6 Profil coach (foto, bio, spesialisasi) + upload foto coach di backoffice.
- [ ] T-057-7 News Hyrox: CMS sederhana di backoffice (judul, gambar, isi, terbit) + daftar & detail di Member App.

## Acceptance Criteria

- [ ] Member login OTP lalu booking/batal kelas dan Personal Training dari HP.
- [ ] Kredit & masa aktif sesuai backoffice; aturan batal ditampilkan sebelum konfirmasi.
- [ ] Member membeli paket lewat QRIS; pass aktif otomatis setelah lunas dan utang pass tercatat.
- [ ] News & profil coach yang diterbitkan admin tampil di Member App.

## Automation Log

- 2026-10-02 — Didaftarkan dari daftar sisa pekerjaan setelah EPIC-056; owner: "lanjut, 5 poin dimasukkan ke task".
