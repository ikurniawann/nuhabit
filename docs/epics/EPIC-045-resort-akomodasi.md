# EPIC-045: Resort & Akomodasi — `MODULE-RESORT`

status: deploying-dev
environment: dev
module: `MODULE-RESORT` (+ `MODULE-BRANDING`)
retries: 0

## Goal

Menambah modul **Resort** ke ERP: penjualan kamar menginap dari master tipe
kamar sampai check-out, lengkap dengan **folio tamu** yang menampung tagihan
kamar, F&B, dan aktivitas. Modul ini kebutuhan wisata bertipe Dusun Bambu
(cabin, glamping, village residence) dan berguna juga untuk unit menginap
Sulu di masa depan — karena itu dibangun di basis kode yang sama, bukan repo
terpisah.

## Keputusan Perencanaan (2026-09-06)

Hasil diskusi dengan owner setelah meninjau dusunbambu.id:

- **Satu repo, banyak perusahaan.** ERP sudah multi-bisnis (holding →
  company → branch, scope user, venue per cabang). Tenant baru cukup jadi
  company/branch; production dipisah lewat deployment (database, domain,
  volume storage sendiri), bukan lewat repo baru.
- **Nama merek tidak boleh ditulis di kode** (`MODULE-BRANDING`), supaya satu
  basis kode bisa tampil sebagai perusahaan berbeda.
- **Fase 1 Resort**: reservasi, ketersediaan, front office, folio. Yang
  ditunda ke fase berikutnya: pembayaran online Xendit untuk reservasi,
  halaman booking publik, channel manager OTA, dan penyatuan folio dengan tab
  gelang Ticketing (kolom `ticket_visit_id` sudah disiapkan).

## Lingkup yang dikerjakan

### `MODULE-BRANDING`

`src/lib/branding.ts` (client & server) + `src/lib/branding-server.ts`
(resolusi dari DB). Urutan sumber nama merek: **nama perusahaan pemilik
data** → `configuration.app_settings.app_brand_name` → env
`NEXT_PUBLIC_APP_NAME` → default `Sulu in Wounderland`.

Diterapkan pada keluaran yang dilihat pengguna/penerima dokumen: watermark
Dataroom, email & halaman publik `/share`, judul ekspor Excel laporan POS
(memakai nama perusahaan sesuai scope), judul aplikasi, pesan uji notifikasi
WA, dan seluruh teks merek di desktop Arkiv OS.

### `MODULE-RESORT`

**Data** (`resort` schema, migration `20260906130000_resort_booking.sql`):
`room_types`, `rooms`, `rate_dates`, `reservations`, `reservation_rooms`,
`folio_charges`, plus menu IAM `resort` (Reservasi, Front Office, Kamar &
Tipe) dengan grant `super_admin`, `direksi`, `admin`.

**Logika murni** (teruji):
- `src/lib/resort/rates.ts` — malam menginap, tarif weekday/weekend (malam
  Jumat & Sabtu), penimpaan kalender musim (harga tetap atau surcharge %),
  rincian per malam, deteksi tabrakan tanggal.
- `src/lib/resort/reservation.ts` — status & transisi sah, kode `RSV-XXXXXX`,
  arah debit/kredit folio, saldo folio, validasi tanggal.

**API**: `room-types`, `rooms`, `availability`, `reservations` (+`[id]`,
`status`, `charges`), `front-office`.

**Halaman**: `/dashboard/resort/reservations`, `/front-office`, `/rooms`.

## Aturan bisnis yang dikunci

1. Tarif **di-snapshot** ke reservasi (`nightly_rate`, `rate_breakdown`), jadi
   perubahan master tidak mengubah tagihan berjalan.
2. Ketersediaan dihitung dari status yang memblokir stok: menunggu bayar,
   terkonfirmasi, sedang menginap. Check-out/batal/no-show melepas kamar.
3. **Check-in ditolak** bila ada baris reservasi tanpa unit kamar, atau bila
   kamar sedang ditempati reservasi lain.
4. **Check-out ditolak** bila folio masih bersaldo, kecuali dilanjutkan dengan
   alasan tertulis (tersimpan di catatan reservasi). Kamar otomatis menjadi
   `kotor` untuk housekeeping.
5. Arah debit/kredit folio ditentukan jenis biaya, bukan input kasir.

## Verifikasi lokal (2026-09-06)

- Vitest: `rates` + `reservation` + `branding` lulus.
- E2E lewat API sebagai user tenant: ketersediaan 6 tipe/30 unit → buat
  reservasi 2 kamar × 2 malam + extra bed − diskon = Rp 12.600.000 dengan
  folio otomatis → check-in tanpa kamar **ditolak** → check-in dengan
  penetapan kamar → tambah F&B → check-out dengan saldo **ditolak** →
  pelunasan → check-out → kamar berstatus `kotor`, ketersediaan pulih.
- UI: Front Office (okupansi, kedatangan, status kamar), Reservasi (filter,
  ringkasan, dialog buat reservasi dengan cek ketersediaan), Kamar & Tipe.
- Sebagai **super admin** setelah `npm run db:seed:resort-demo`: 24 kamar,
  44 reservasi, Front Office terisi (7 tamu menginap, 2 kedatangan).

## Data contoh lokal

Modul membaca venue dari **scope bisnis user**. Super admin tidak ber-scope,
jadi ia jatuh ke default venue di CRM Settings
(`crm_settings.default_company_id` / `default_branch_id`) — bukan cabang tenant
mana pun. Karena itu halaman Resort tampak kosong bagi super admin sampai venue
itu sendiri diisi.

Generator datanya dipakai bersama di `database/seeders/lib/resort-demo.js`
(tipe & unit kamar, musim tarif, reservasi deterministik lintas status,
penetapan kamar tanpa tabrakan tanggal, folio, status housekeeping), dengan dua
pemanggil:

| Seeder | Perintah | Venue |
|--------|----------|-------|
| `database/seeders/resort-demo.js` | `npm run db:seed:resort-demo` | Default venue CRM — **yang dilihat super admin**. Bisa ditimpa dengan `RESORT_COMPANY_CODE` + `RESORT_BRANCH_CODE`. 5 tipe kamar / 24 unit |
| `database/seeders/dusun-bambu-resort.js` | `npm run db:seed:dusun-bambu-resort` | Cabang tenant Dusun Bambu Lembang. 6 tipe kamar / 30 unit |

Keduanya memanggil `assertLocalTarget()` — berhenti bila `DATABASE_URL` bukan
database lokal, jadi **tidak akan pernah** menyentuh production.

## Checklist rilis ke production

Jalankan hanya bila owner memanggil `MODULE-RESORT`:

1. `MODULE-BRANDING` boleh ikut (tanpa migration). Bila ingin nama merek
   berbeda per instance, set `NEXT_PUBLIC_APP_NAME` atau isi
   `configuration.app_settings.app_brand_name`.
2. **Apply migration** `database/migrations/deltas/20260906130000_resort_booking.sql`.
3. Promosi `development` → `production`, tunggu tag `vX.Y.Z-production`,
   jalankan job `deploy-production`.
4. Setelah live: buka **Resort → Kamar & Tipe**, isi tipe kamar dan unit
   kamar milik venue tersebut. Modul kosong sampai master diisi; tidak ada
   data contoh yang ikut ke production.
5. Pastikan venue terbaca: user punya scope cabang, atau
   `crm_settings.default_company_id/default_branch_id` sudah diisi.

## Tidak termasuk (fase berikutnya)

Pembayaran online reservasi (Xendit), halaman booking publik + kode akses
tamu, channel manager OTA, penyatuan folio resort dengan tab gelang
Ticketing, laporan okupansi/ADR/RevPAR, dan housekeeping board terpisah.
