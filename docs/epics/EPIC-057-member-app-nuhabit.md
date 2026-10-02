# EPIC-057: Member App NüHabit

status: ready-for-qa
environment: dev
retries: 0

## Goal

Member memakai semua fitur studio dari HP: lihat jadwal & booking kelas, booking Personal Training (pilih coach + jam), cek sisa kredit & masa aktif pass, beli paket online, baca News Hyrox, dan melihat profil coach. Backend booking/Personal Training/pass sudah ada (EPIC-053..055); epic ini membangun aplikasinya.

Referensi: [PRD](../product/PRD.md) · [BACKLOG](../BACKLOG.md).

## Keputusan desain

- `/member` diganti aplikasi NüHabit (desain DESIGN.md, mobile-first); portal Nox/klasik BCD (ARK Coin, XP) tidak relevan dan tidak lagi jadi rute utama.
- Login tetap OTP WhatsApp portal member yang sudah ada (identitas = `pos.pos_customers`, nomor 62xxx).
- "Personal Training" ditulis lengkap di seluruh UI.
- **Pass baru terbit hanya saat lunas**: pesanan disimpan di `studio.pass_orders` (`pending → paid/expired`);
  pass dibuat oleh `issuePass` channel `online` / metode `xendit` saat webhook (`reference_id` berawalan
  `NHP-`, lewat webhook Xendit yang sudah ada) atau cek status dari aplikasi. Klaim status mencegah pass ganda
  bila webhook & cek status datang bersamaan; pembayaran yang masuk setelah QR kedaluwarsa tetap dihormati.
- Paket bisa dikecualikan dari penjualan online (`pass_products.sell_online`).
- **Jurnal oleh sistem**: posting jurnal kini menerima `userId = null` (kolom `created_by` memang nullable), jadi
  penjualan online dan penyelesaian sesi oleh sistem tetap memposting jurnal (sebelumnya dilewati bila tanpa staf).
- Foto coach & gambar News diunggah lewat `/api/studio/uploads` (isi file dicek JPG/PNG/WebP, maks 5 MB).
- Pengingat WhatsApp dipindah ke EPIC-058 (butuh job terjadwal).

## Tasks

- [x] T-057-1 Shell aplikasi `/member` NüHabit + login OTP + navigasi bawah (Beranda, Jadwal, Personal Training, Paket, Profil).
- [x] T-057-2 Beranda: booking terdekat, ringkasan kredit kelas/Personal Training, masa aktif.
- [x] T-057-3 Jadwal kelas: daftar per hari, booking, waitlist, batal (aturan 12 jam ditampilkan).
- [x] T-057-4 Personal Training: pilih program → coach (profil) → tanggal → jam → konfirmasi; daftar & batal.
- [x] T-057-5 Paket: pass saya + riwayat kredit; katalog paket + beli online via Xendit QRIS (order, polling/webhook, aktivasi).
- [x] T-057-6 Profil coach (foto, bio, spesialisasi) + upload foto coach di backoffice.
- [x] T-057-7 News Hyrox: CMS sederhana di backoffice (judul, gambar, isi, terbit) + daftar & detail di Member App.

## Acceptance Criteria

- [x] Member login OTP lalu booking/batal kelas dan Personal Training dari HP.
- [x] Kredit & masa aktif sesuai backoffice; aturan batal ditampilkan sebelum konfirmasi.
- [x] Member membeli paket lewat QRIS; pass aktif otomatis setelah lunas dan utang pass tercatat.
- [x] News & profil coach yang diterbitkan admin tampil di Member App.

## Automation Log

- 2026-10-02 — Didaftarkan dari daftar sisa pekerjaan setelah EPIC-056; owner: "lanjut, 5 poin dimasukkan ke task".
- 2026-10-02 — Selesai T-057-1..7. Migrasi `20261002230000_studio_pass_orders.sql`, `20261002240000_studio_news.sql` (menu News Hyrox). Gate: typecheck file terkait bersih; vitest studio+accounting 74/74; E2E `member-app-e2e` di `nuhabit_test` + mock Xendit 45/45 (login, coach publik, katalog online, pesanan→QRIS, lunas via cek status & webhook, idempoten, kedaluwarsa, booking/waitlist/batal, Personal Training, News draft/terbit, upload foto); regresi pass 27/27, booking 32/32, Personal Training 25/25, komisi 36/36.
- 2026-10-02 — Catatan live: gateway Xendit di DEV belum aktif → tombol beli menampilkan "Pembayaran online belum aktif" sampai API key & webhook diisi (checklist di BACKLOG.md).
- 2026-10-02 — Owner: seluruh halaman member berbahasa **Inggris**. UI, format tanggal/jam/angka, dan pesan route khusus member diubah; pesan mesin bersama (booking/OTP) diterjemahkan di `src/features/member-app/i18n.ts` (+16 tes). Backoffice & Coach Portal tetap bahasa Indonesia. Dicatat di DESIGN.md §10. Regresi: member-app 45/45, loyalitas 37/37.
- 2026-10-02 — Owner: di DEV Member App bisa dibuka tanpa OTP. Tombol **Buka Member App** (detail pass & Program Loyalitas) hanya aktif bila `MEMBER_PREVIEW_ENABLED=1` (di-set di container DEV saja); sesi 4 jam, cookie `member_preview` → banner "Staff preview", tercatat di `studio.member_preview_log`. E2E `preview-e2e` 7/7 (aktif) + 2/2 (mati → 404).
- 2026-10-02 — Owner memilih kode OTP tetap untuk DEV (opsi 2) sampai WA Gateway terhubung: `MEMBER_OTP_FIXED_CODE=123456` (opt-in env, 6 digit) → OTP tidak dikirim WA, kode tetap 123456, Member App menampilkan petunjuk. Alur OTP lain tetap (member terdaftar, rate limit, percobaan). E2E `otp-e2e` 4/4 (aktif) + 2/2 (mati).
