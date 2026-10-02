# EPIC-053: Member Pass — Paket Kredit, Penjualan & Utang Pass

status: ready-for-qa
environment: dev
retries: 0

## Goal

Member membeli **pass berkuota** (mis. 3x kelas dalam 14 hari, 7x dalam 30 hari),
dibagi 3 tipe: **Class · Class + PT · Class + PT + Facility**. Pass yang belum
di-redeem adalah **utang** (pendapatan diterima di muka); revenue diakui saat kredit
dipakai (EPIC-054) atau saat pass kedaluwarsa (breakage). Pembagian nilai kelas vs PT
menjadi dasar pool komisi coach (10% revenue kelas + 40% revenue PT, EPIC-056).

Referensi: [PRD](../product/PRD.md) §2 (Member, Revenue Breakdown) · [EPIC-052](./EPIC-052-studio-coach-program-jadwal.md).

## Keputusan desain

- **Member = `pos.pos_customers`** (identitas berbasis HP yang sama dengan login OTP
  Member Portal). HP dinormalisasi ke `62xxx`; HP yang sama dengan format berbeda ditolak.
- **Katalog `studio.pass_products`** memegang kredit kelas/PT, akses facility, masa
  berlaku (hari) dan **pembagian nilai** `class_value + pt_value + facility_value = price`
  (dijaga CHECK di DB + validasi API). Tombol "Usulkan" membagi rata per sesi.
- **Snapshot saat jual** (`studio.member_passes`): kredit, nilai, masa berlaku dibekukan
  per pass — ubah katalog tidak mengubah pass terjual. Harga khusus dibagi proporsional.
- **Ledger `studio.pass_credit_ledger`**: issue / redeem / unredeem / adjust / expire / cancel.
- **Utang dihitung dari NILAI, bukan sisa kredit**: `utang = harga − nilai yang sudah
  diakui (redeem − unredeem + expire)`. Penyesuaian kredit manual hanya mengubah jumlah
  sesi (tidak ada jurnal), sehingga angka modul selalu sama dengan saldo akun
  `PASS_LIABILITY` di buku besar. (Ditemukan saat E2E: model awal "nilai × sisa kredit"
  membuat Rp150.000 hilang dari utang tanpa jurnal setelah adjust −1.)
- **Nilai per redeem kumulatif**: `round(nilai × n / kredit)` dalam sen → total redeem =
  nilai persis (Rp1.000.000 / 3 = 333.333,33 · 333.333,34 · 333.333,33). Kredit kompensasi
  di luar kuota bernilai 0.
- **Kedaluwarsa**: tombol "Proses kedaluwarsa" (idempoten) → sisa nilai kelas/PT + nilai
  facility diakui sebagai revenue, status `expired`, tidak bisa diperpanjang lagi.
  Zona waktu venue `Asia/Jakarta`.
- **Jurnal non-blocking** lewat mekanisme journal mapping yang ada. Modul baru `STUDIO`,
  peran `PASS_LIABILITY` (+ `COMMISSION_EXPENSE/PAYABLE` untuk EPIC-056), event
  `STUDIO_PASS_SALE_{CASH,QRIS,CARD,TRANSFER,ONLINE}`, `STUDIO_PASS_REDEEM_{CLASS,PT}`,
  `STUDIO_PASS_BREAKAGE`, `STUDIO_PASS_CANCEL`. Tanpa mapping aktif → dilewati; transaksi
  pass tidak pernah gagal karena akuntansi.

## Tasks

- [x] T-053-1 Migrasi `20261002180000_studio_member_pass.sql` (3 tabel + menu Member Pass & Paket Member + grant).
- [x] T-053-2 Logika murni `src/lib/studio/pass.ts` (alokasi nilai, status efektif, utang, breakage, kode pass) + 11 tes.
- [x] T-053-3 Server `pass-server.ts` (jual, expire, batal, posting jurnal) + event jurnal STUDIO.
- [x] T-053-4 API: `pass-products`, `members` (cari/daftar), `passes` (list+ringkasan, jual, detail, adjust, extend, cancel, expire).
- [x] T-053-5 UI: Paket Member (kartu katalog + dialog pembagian nilai), Member Pass (KPI utang, tabel, jual pass dengan cari/daftar member, detail + riwayat kredit + aksi).
- [ ] T-053-6 Atur mapping COA untuk event STUDIO di Accounting → Journal Mapping (butuh COA dari owner/finance).
- [ ] T-053-7 Penjualan online Member App (Xendit, status `pending_payment`) — bersama EPIC-054.
- [ ] T-053-8 Jadwalkan proses kedaluwarsa harian (sekarang manual).

## Acceptance Criteria

- [x] Admin membuat paket 3 tipe; pembagian nilai ≠ harga ditolak.
- [x] Front desk mendaftarkan member baru (HP unik, 62xxx) atau mencari member lama.
- [x] Jual pass → kredit terbit, masa berlaku benar (14 hari = s/d hari ke-14), kode `NH-XXXXXX`.
- [x] Penyesuaian kredit (+ dibatasi kuota paket, − dibatasi sisa), perpanjang/freeze dengan alasan.
- [x] Batal hanya untuk pass yang belum dipakai; proses kedaluwarsa mengakui sisa nilai sekali saja.
- [x] Ringkasan: pass aktif, total utang pass, kredit kelas/PT tersisa, berakhir ≤ 7 hari.

## Automation Log

- 2026-10-02 — Selesai T-053-1..5. Gate: vitest `src/lib/studio` 25+ PASS (pass 11); E2E API dev 27/27 PASS (split salah 400, HP duplikat format beda 409, jual QRIS, 14 hari, jurnal dilewati tanpa mapping, adjust batas kuota, utang tetap Rp450.000 setelah adjust −1, batal pass terpakai 409, breakage Rp1.000.000 = kelas+PT+facility, proses ulang 0, extend setelah breakage 409); typecheck file studio bersih; data uji dibersihkan.
- 2026-10-02 — Koreksi model utang ke berbasis nilai (lihat Keputusan desain) setelah E2E pertama menunjukkan selisih modul vs buku besar.
