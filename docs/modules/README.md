# Modules — Registry Deploy

Registry modul yang **bisa dipanggil namanya** saat ingin dinaikkan ke
production. Selama status masih `dev`, modul hanya ada di branch
`development` dan **tidak** dipromosikan ke `production`.

Cara memakai: sebut nama modulnya, mis. *"deploy MODULE-RESORT ke production"*.
Prosedurnya mengikuti bagian **Checklist rilis** di dokumen modul.

| Modul | Judul | Status | Epic | Migration | Catatan |
|-------|-------|--------|------|-----------|---------|
| `MODULE-BRANDING` | Merek instance multi-perusahaan | `dev` | [EPIC-045](../epics/EPIC-045-resort-akomodasi.md#module-branding) | — | Aman ke production kapan saja (default tetap Sulu in Wounderland) |
| `MODULE-RESORT` | Resort & Akomodasi (booking kamar, front office, folio) | `dev` | [EPIC-045](../epics/EPIC-045-resort-akomodasi.md) | `20260906130000_resort_booking.sql` | Menu baru **Resort**; tidak mengubah modul lain |
| `MODULE-RESORT-DEMO` | Data contoh Resort untuk venue utama (lokal) | `dev-only` | [EPIC-045](../epics/EPIC-045-resort-akomodasi.md#data-contoh-lokal) | — | **Tidak pernah** ke production: seeder menolak database non-lokal |
| `MODULE-DUSUN-BAMBU` | Tenant Dusun Bambu (data demo lokal: bisnis, resort penuh, F&B, ticketing) | `dev-only` | [EPIC-046](../epics/EPIC-046-tenant-dusun-bambu.md) | — | **Tidak pernah** ke production: seeder menolak database non-lokal |
| `MODULE-APPAREL` | Apparel & alas kaki — varian ukuran/warna dari master produk sampai produksi (reuse Items/Purchasing/Manufacturing + `pos_product_skus`) | `dev` | [EPIC-047](../epics/EPIC-047-apparel-varian-produksi.md) | `20260910120000_production_variant_output`, `20260910233939_grn_variant_sku`, `20260911081906_opname_variant_sku`, `20260911083000_opname_variant_sku_unique_fix` (urut) | Bukan modul baru; company `SULU-APPAREL` terpisah. Seeder `apparel*.js` tinggal di `development`. Fase 0 (2026-09-09, lokal): 35 bahan baku (32 dibeli + 3 WIP otomatis) di 9 kategori, 15 produk (12 jadi + 3 WIP) di 6 kategori, 80 baris BOM, 12 `pos_products` merchandise tersinkron — harga & konsumsi bahan adalah ASUMSI demo, lihat header `apparel-items.js` |

## Arti status

| Status | Arti |
|--------|------|
| `dev` | Sudah di branch `development`, terverifikasi lokal, menunggu perintah owner untuk dipromosikan ke `production` |
| `dev-only` | Sengaja tidak untuk production (data demo / alat bantu lokal) |
| `production` | Sudah live; tanggal rilis dicatat di dokumen modul |

## Urutan promosi bila dinaikkan bersamaan

1. `MODULE-BRANDING` — tidak ada migration, tidak mengubah perilaku bila
   `NEXT_PUBLIC_APP_NAME` tidak diisi.
2. `MODULE-RESORT` — apply migration lebih dulu, baru deploy kode.

`MODULE-DUSUN-BAMBU` dan `MODULE-RESORT-DEMO` tidak ikut promosi apa pun —
keduanya seeder lokal.
