# EPIC-046: Tenant Dusun Bambu — `MODULE-DUSUN-BAMBU`

status: ready-for-qa
environment: dev-only
module: `MODULE-DUSUN-BAMBU`
retries: 0

## Goal

Menyiapkan **data demo tenant kedua** di database lokal: Dusun Bambu
(Lembang) sebagai perusahaan terpisah dari Sulu in Wounderland, memakai
basis kode dan modul yang sama. Tujuannya membuktikan ERP ini bisa melayani
bisnis wisata lain tanpa repo baru, sekaligus jadi bahan demo ke calon klien.

> **Tidak untuk production.** Ketiga seeder memanggil `assertLocalTarget()`
> dan berhenti bila `DATABASE_URL` bukan database lokal.

## Referensi profil (dusunbambu.id, dibaca 2026-09-06)

Destinasi keluarga 15 ha di kaki Gunung Burangrang: **4 restoran bertema**
(Burangrang untuk meeting & Western, Lembur Urang bernuansa Bali, Purbasari
lesehan tepi danau, Lutung Kasarung piknik di sarang pohon) plus outlet Bebek
Kabayan; **resort** (Cabin: Single/Family/Double; Kampung Layung:
Village/Deluxe/Family Residence dengan hot tub); dan **aktivitas** (Bandung
Playground, wahana danau).

Harga menu, tarif kamar, dan harga tiket di seeder adalah **angka asumsi**
yang wajar untuk demo, bukan harga resmi Dusun Bambu — halaman e-menu dan
daftar aktivitas ada di domain pihak ketiga yang tidak dibaca.

## Isi seeder

### 1. `npm run db:seed:dusun-bambu-business` — `database/seeders/dusun-bambu.js`

- Perusahaan **Dusun Bambu** (`DUSUN-BAMBU`) → cabang **Dusun Bambu Lembang**
  (`DB-LEMBANG`) di holding Prologe.
- 8 outlet/gudang: `MAIN`, 4 restoran, Bebek Kabayan, Bandung Playground,
  Resort Front Office.
- 4 departemen HRIS: Resort & Front Office, Housekeeping, Ticketing &
  Activity, Landscape & Garden.
- 24 meja/saung POS: saung Purbasari, sarang Lutung Kasarung, meja Burangrang.
- User demo **demo@dusunbambu.id / dusunbambu** (role `admin`, scope cabang
  Dusun Bambu) — ini kunci melihat data tenant kedua.

### 2. `npm run db:seed:dusun-bambu-resort` — `database/seeders/dusun-bambu-resort.js`

Mengisi **seluruh** modul Resort, dibangkitkan deterministik (RNG ber-seed)
sehingga dijalankan ulang menghasilkan angka yang sama:

- **6 tipe kamar / 30 unit**: Cabin Area (Single 5, Family 4, Double 3) dan
  Kampung Layung (Village 8, Deluxe 6, Family 4).
- **4 musim tarif**: Nataru +25%, libur sekolah +15%, long weekend Agustus
  +10%, dan promo weekday khusus Village Residence −10%.
- **45 reservasi** tersebar −60 s.d. +45 hari, semua status (25 selesai,
  8 sedang menginap, 6 terkonfirmasi termasuk 2 kedatangan hari ini,
  3 menunggu bayar, 2 dibatalkan, 1 no-show) dan semua sumber
  (walk-in, website, OTA, telepon, korporat), sebagian 2 kamar dan
  memakai extra bed. Unit kamar ditetapkan tanpa tabrakan tanggal.
- **185 baris folio**: tagihan kamar, extra bed, diskon, F&B (menu asli dari
  keempat restoran), aktivitas (sepeda listrik, berkuda, playground, sampan,
  panahan), laundry, denda, serta pembayaran sesuai status (lunas saat
  check-out, DP 50% untuk terkonfirmasi, refund untuk yang dibatalkan).
- **Status housekeeping campuran**: kamar terisi, siap dijual, perlu
  dibersihkan, dan 2 kamar perbaikan — supaya papan Front Office tidak kosong.

Total nilai reservasi demo sekitar Rp 281 juta.

Logika pembangkitannya ada di `database/seeders/lib/resort-demo.js`, dipakai
bersama dengan seeder venue utama (`npm run db:seed:resort-demo`) — lihat
[EPIC-045](EPIC-045-resort-akomodasi.md#data-contoh-lokal).

### 3. `npm run db:seed:dusun-bambu-fnb` — `database/seeders/dusun-bambu-fnb.js`

Satuan per perusahaan, 38 bahan baku (protein, sayur & lalapan, bumbu Sunda,
bahan kering, minuman, kemasan) dengan konversi satuan beli; 5 resep bahan
setengah jadi (sambal dadak, bumbu kuning Bali, bumbu bakar kecap, kaldu ayam
kampung, base bandrek); 2 produk WIP ungkep (ayam & bebek); **18 menu jadi**
per outlet dengan BOM bertingkat, stok awal, dan sinkron POS; 8 contoh
produksi prep dapur.

### 4. `npm run db:seed:dusun-bambu-ticketing` — `database/seeders/dusun-bambu-ticketing.js`

Pengaturan venue (kuota 2.500 orang/hari), 3 kanal (loket, website, OTA), 3
sesi waktu, kuota musim; **8 produk tiket** (masuk dewasa/anak, Bandung
Playground, wahana danau, sepeda listrik, berkuda, panahan, paket keluarga
bundle, Dusun Pass tahunan) dengan harga per kanal dan high season; 30 gelang
NFC; 6 booking lintas status termasuk rombongan sekolah; 2 kunjungan (satu
selesai, satu berjalan dengan tab F&B + aktivitas); 2 season pass.

Seeder **tidak** mengubah default venue CRM, sehingga data Sulu tidak
terganggu.

## Cara mencoba

```bash
npm run db:seed:dusun-bambu      # menjalankan ketiga bagian berurutan
```

Lalu login sebagai `demo@dusunbambu.id` / `dusunbambu`:

- **Resort → Front Office**: okupansi ±33% dari 30 kamar, kedatangan,
  tamu menginap dengan sisa tagihan, papan status kamar.
- **Resort → Reservasi**: 45 reservasi lintas status, filter periode, dan
  pembuatan reservasi baru dengan cek ketersediaan.
- **Resort → Kamar & Tipe**: 6 tipe kamar dengan tarif weekday/weekend serta
  daftar musim tarif aktif.
- **Ticketing**: master tiket, booking, loket, gate, Dusun Pass.
- **Items → Produk → Produksi Internal**: prep dapur `PROD-DB-*`.
- **Point of Sales**: menu Sunda/Nusantara per outlet.

Super admin Sulu tetap melihat data Sulu karena venue diambil dari scope user
(fallback default venue CRM = Sulu).

## Batasan yang diketahui

- Master unit, kategori produk global, dan tabel `pos_products`/`pos_tables`
  dipakai bersama antar tenant di satu database lokal. Pemisahan penuh terjadi
  saat production memakai database terpisah per instance.
- Dataroom belum di-seed untuk tenant ini (folder Dataroom belum ber-scope
  perusahaan).
- Harga bersifat asumsi; ganti dengan daftar harga resmi sebelum dipakai demo
  ke pihak Dusun Bambu.
