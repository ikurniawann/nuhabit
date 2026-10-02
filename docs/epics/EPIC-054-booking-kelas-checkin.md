# EPIC-054: Booking Kelas, Waitlist & Check-in

status: ready-for-qa
environment: dev
retries: 0

## Goal

Member memesan kelas (front desk atau Member App), kredit pass terkunci, kelas penuh
masuk waitlist, front desk check-in lewat scan kode pass / nomor HP, lalu kelas
diselesaikan sehingga kehadiran tercatat dan **revenue kelas diakui** — dasar komisi
coach (EPIC-056).

Referensi: [PRD](../product/PRD.md) §2 · [EPIC-052](./EPIC-052-studio-coach-program-jadwal.md) · [EPIC-053](./EPIC-053-member-pass.md).

## Aturan (keputusan owner 2026-10-02, dapat diubah di Aturan Booking)

| Aturan | Default |
|---|---|
| Kredit dikunci saat booking | ya |
| Batas cancel agar kredit kembali | 12 jam sebelum kelas |
| Batal lewat batas | `late_cancelled`, kredit hangus |
| Tidak hadir | `no_show`, kredit hangus |
| Kelas penuh | waitlist (tanpa kunci kredit), naik otomatis saat ada kursi; kredit dikunci saat naik |
| Booking dibuka | 7 hari ke depan; ditutup saat kelas mulai (staf tetap bisa walk-in) |
| Check-in dibuka | 60 menit sebelum kelas |
| Revenue & dasar komisi | diakui saat kelas **diselesaikan** (hadir + no-show + batal telat) |

## Keputusan desain

- **Ledger yang sama dengan pass**: booking menulis `redeem` qty −1 amount 0
  (`recognized_at` NULL) → kursi & kredit aman. Cancel tepat waktu menulis `unredeem` +1.
  Saat kelas selesai, baris redeem diisi `amount` (alokasi kumulatif atas jumlah redeem
  yang sudah diakui per pass) + `recognized_at`, dan satu jurnal
  `STUDIO_PASS_REDEEM_CLASS` per sesi. Utang pass otomatis turun karena dihitung dari nilai
  yang diakui (EPIC-053).
- **Konkurensi**: transaksi dengan `FOR UPDATE` pada sesi (kursi terakhir) dan pass
  member (kredit terakhir); unique index satu booking aktif per member per sesi.
- **Pemilihan pass FEFO**: pass berlaku di tanggal kelas dengan kredit, yang paling
  cepat berakhir dipakai duluan.
- **Admin membatalkan kelas** → semua booking batal, kredit kembali (bukan salah member).
  Sesi berbooking tidak bisa dihapus; kuota tidak bisa diturunkan di bawah peserta.
  Status "Selesai" di form sesi diarahkan ke proses penyelesaian (bukan update mentah).
- **Kelas lewat** diselesaikan otomatis saat halaman Check-in dibuka dan sebelum proses
  kedaluwarsa pass, supaya kredit terkunci diakui sebagai redeem, bukan breakage.
- **Member App API** (`/api/member-portal/studio/*`) memakai sesi OTP + venue default;
  member hanya melihat & membatalkan booking miliknya; tidak ada angka utang di respons.
- Input global di `globals.css` kini memakai token NüHabit (border `--input`, fokus
  `--ring`); kelas `nh-dark-input` untuk input di atas permukaan gelap.

## Tasks

- [x] T-054-1 Migrasi `20261002200000_studio_booking_checkin.sql`: `studio.bookings`, `studio.settings`, `recognized_at` di ledger, `completed_at`/`journal_entry_id` di sesi, menu Check-in & Booking + Aturan Booking.
- [x] T-054-2 Logika murni `src/lib/studio/booking.ts` (jendela booking/check-in, klasifikasi cancel, FEFO, kursi, waitlist) + 11 tes.
- [x] T-054-3 Mesin `booking-server.ts`: create (waitlist, walk-in), cancel (tepat waktu/telat/pengecualian staf + promosi waitlist), check-in/undo, complete (no-show + pengakuan revenue + jurnal), complete-past, release saat kelas dibatalkan, roster, cari kode.
- [x] T-054-4 API staf: `bookings`, `bookings/[id]/cancel`, `bookings/[id]/check-in`, `check-in` (scan), `sessions/[id]/roster`, `sessions/[id]/complete`, `sessions/complete-past`, `settings`.
- [x] T-054-5 API Member App: `member-portal/studio/{schedule,bookings,bookings/[id]/cancel,passes}`.
- [x] T-054-6 UI: Check-in & Booking (scan, daftar kelas + keterisian, roster, tambah peserta, selesaikan kelas, `?date=&session=`), Aturan Booking; jumlah peserta di Jadwal Kelas & Kalender.
- [ ] T-054-7 Halaman booking di Member App (UI member) — bersama EPIC-057.
- [ ] T-054-8 Notifikasi WA naik waitlist / pengingat H-1 — EPIC-057.

## Acceptance Criteria

- [x] Booking mengunci kredit; kelas penuh → waitlist; booking ganda & member tanpa kredit ditolak.
- [x] Cancel ≥ 12 jam → kredit kembali + waitlist naik; < 12 jam → kredit hangus (staf bisa mengecualikan).
- [x] Scan kode pass / HP → check-in; belum booking → walk-in ke kelas yang dibuka.
- [x] Selesaikan kelas → no-show tercatat, revenue diakui sekali (idempoten), utang pass turun.
- [x] Kelas dibatalkan admin → semua kredit kembali.
- [x] Member App: lihat jadwal + sisa kursi, booking, batal, lihat pass; tidak bisa menyentuh booking orang lain.

## Automation Log

- 2026-10-02 — Aturan booking disetujui owner (kredit dikunci saat booking, cancel 12 jam, no-show hangus, waitlist otomatis).
- 2026-10-02 — Selesai T-054-1..6. Gate: vitest studio+theme+iam+accounting 109 PASS; E2E API dev 32/32 PASS (2× run) — waitlist promosi, late cancel, pengecualian staf, walk-in & scan, roster, no-show, revenue Rp450.000 sekali, late cancel diakui Rp150.000, utang A Rp150.000, batal kelas mengembalikan kredit, Member App booking/batal/401/akses booking orang lain 404; typecheck file studio bersih; data uji dibersihkan.
