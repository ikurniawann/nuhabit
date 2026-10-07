# Audit: SIW Menu Matrix vs Database

- **Workbook**: `docs/SIW - Menu Matrix_31-08-2026.xlsx`
- **Database**: `server-sulu` / `arkiv`
- **Scope**: company `SULU` · branch `SULU-DAGO`
- **Dijalankan**: 2026-09-01T23:42:06.009Z

## 1. Cakupan data

| Objek | Workbook | Database |
|---|---|---|
| Bahan baku beli | 186 | 200 |
| WIP | 106 | 102 |
| Menu / produk | 121 | 148 |
| Baris BOM produk | 532 | 518 |
| Baris resep WIP | 494 | 486 |
| Produk punya BOM | - | 97 / 148 |
| WIP punya resep | - | 87 / 102 |

## 2. Tingkat kecocokan

Dihitung per objek, bukan per baris temuan: satu objek dianggap **cocok** hanya bila tidak ada satu pun selisih pada master maupun BOM-nya.

| Objek di workbook | Total | Tidak ada di DB | Ada tapi beda | Cocok | % cocok |
|---|---|---|---|---|---|
| Bahan baku beli | 186 | 0 | 4 | 182 | 98% |
| WIP | 103 | 0 | 3 | 100 | 97% |
| Menu / produk | 121 | 0 | 14 | 107 | 88% |

**389 dari 410 objek (95%) cocok sepenuhnya.**

## 3. Ringkasan temuan

| Dimensi | File | Hilang di DB | Ekstra di DB | Nilai beda | Kandidat rename | Kualitas data | Total |
|---|---|---|---|---|---|---|---|
| A. Bahan Baku (Market List) | `01-raw-materials.csv` | 0 | 12 | 6 | 0 | 0 | 18 |
| B. Master WIP | `02-wip-master.csv` | 0 | 1 | 2 | 0 | 0 | 3 |
| C. Resep WIP | `03-wip-bom.csv` | 2 | 0 | 0 | 0 | 0 | 2 |
| D. Produk / Menu | `04-products.csv` | 0 | 25 | 10 | 0 | 0 | 35 |
| E. BOM Produk | `05-product-bom.csv` | 17 | 0 | 8 | 0 | 0 | 25 |
| F. Integritas Workbook | `06-unresolved-references.csv` | 0 | 0 | 0 | 0 | 13 | 13 |

**Total temuan: 96.**

## 4. Pola masalah utama

| Pola | Jumlah | Dampak |
|---|---|---|
| `konversi_factor` = 1 padahal Market List punya isi kemasan > 1 | 1 | Biaya per gram/ml jadi sebesar harga satu kemasan penuh — sumber utama COGS yang membengkak. |
| `satuan_besar` tidak mencerminkan Purchase UOM | 1 | Satuan pembelian di master tidak sama dengan yang dipakai purchasing di Market List. |
| `harga_modal` produk masih 0 | 2 | Produk tidak punya COGS sama sekali di database. |
| Komponen sudah ada di master tapi belum terpasang di BOM | 19 | Resep tinggal dihubungkan, bahannya sendiri tidak perlu dibuat ulang. |

> Contoh: **Lada Bubuk** — Market List mencatat kemasan 250 unit, database mencatat `konversi_factor = 1`. Akibatnya harga satu kemasan dibaca sebagai harga per satuan terkecil.

## 5. Selisih nilai terbesar

Nilai `Direct Cost (rekalkulasi BOM)` dihitung ulang dari BOM database, jadi ikut membesar karena pola `konversi_factor` di atas — bukan selisih yang berdiri sendiri.

| Item | Field | Workbook | Database | Selisih |
|---|---|---|---|---|
| Lada Bubuk | biaya per satuan kecil | 114,4 | 28.600 | -28.485,6 |
| Aka Miso Ramen | harga_modal | 16.069,31 | 0 | 16.069,31 |
| Signature Shoyu Ramen | harga_modal | 8.879,63 | 20.879,63 | -12.000 |
| Signature Shoyu Ramen | Direct Cost (rekalkulasi BOM) | 8.879,63 | 20.879,63 | -12.000 |
| Spicy Goma Ramen | harga_modal | 19.404,34 | 31.404,34 | -12.000 |
| Spicy Goma Ramen | Direct Cost (rekalkulasi BOM) | 19.404,34 | 31.404,34 | -12.000 |
| Tori Abura Soba | harga_modal | 16.809,39 | 28.809,39 | -12.000 |
| Tori Abura Soba | Direct Cost (rekalkulasi BOM) | 16.809,39 | 28.809,39 | -12.000 |
| Beef Abura Soba | harga_modal | 18.314,04 | 30.314,04 | -12.000 |
| Smoked Duck Abura Soba | harga_modal | 23.249,04 | 35.249,04 | -12.000 |
| Beef Abura Soba | Direct Cost (rekalkulasi BOM) | 18.314,04 | 30.314,04 | -12.000 |
| Smoked Duck Abura Soba | Direct Cost (rekalkulasi BOM) | 23.249,04 | 35.249,04 | -12.000 |
| Tamagoyaki Mentai | harga_modal | 10.929,44 | 0 | 10.929,44 |
| Jukut | biaya per satuan kecil | 0 | 3.000 | -3.000 |
| Oolong Peach | harga_modal | 4.066,85 | 2.566,85 | 1.500 |

## 7. Cara membaca

| Severity | Arti |
|---|---|
| `MISSING_IN_DB` | Ada di workbook, tidak ada di database. |
| `EXTRA_IN_DB` | Ada di database, tidak ada di workbook. |
| `VALUE_MISMATCH` | Objek yang sama, nilainya berbeda (harga, qty, satuan, kategori). |
| `RENAME_CANDIDATE` | Pasangan hilang/ekstra dengan nama sangat mirip — kemungkinan typo atau rename. |
| `DATA_QUALITY` | Masalah internal workbook (referensi tidak ketemu, satuan tak dikenal, biaya tidak konsisten). |

Toleransi pembanding: uang ±0,01 · qty ±0,0001. Audit ini read-only; tidak ada data yang diubah.

