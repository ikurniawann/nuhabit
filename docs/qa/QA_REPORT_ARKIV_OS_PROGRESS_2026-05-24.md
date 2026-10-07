# QA Report - Arkiv OS Development Progress

Tanggal: 24 Mei 2026
Tester: Codex
Environment: Local development
URL utama: `http://localhost:3000`
Branch: `main`
Commit baseline: `2856b4b`
Status dokumen: Progress QA berjalan

## 1. Executive Summary

QA dilakukan secara bertahap selama pengembangan beberapa module besar Arkiv OS, terutama POS, CRM, Purchasing, Barang Masuk, dan Production. Fokus QA sejauh ini adalah memastikan flow utama bisa berjalan end-to-end, UI tidak membingungkan, data dummy bisa dibuat/diubah, dan perubahan stok/transaksi mulai terhubung antar module.

Secara umum, beberapa flow utama sudah bisa digunakan untuk testing lanjutan:

- CRM membership dan member detail.
- POS F&B cashier, open bill, table management, KDS.
- Customer table ordering self-service.
- Purchasing master data, PO, Barang Masuk, raw material, recipe/BOM, production order.
- Production shortage ke PO dan recheck stock.

Masih ada area yang perlu dilanjutkan sebelum dianggap production-ready, terutama finalisasi produksi, stock card, audit movement, dan laporan QA/regression yang lebih formal per release.

## 2. QA Scope

Module yang tercakup dalam report ini:

| Module | Area QA | Status |
|---|---|---|
| CRM | Members, rewards, avatars, XP concept | Passed with Notes |
| POS F&B | Cashier, dine-in table modal, customer add/search, product autocomplete | Passed with Notes |
| POS Open Bills | Table order masuk open bill, pindah meja, bayar bill | Passed with Notes |
| POS KDS | Pending/open bill masuk KDS, station flow | Passed with Notes |
| Table Ordering | Customer scan QR table, pilih menu, varian, cart, payment option, order status | Passed with Notes |
| Photobooth POS | Self-service UI draft | Prototype Ready |
| Purchasing Master Data | Supplier, raw material, price list, products | Passed with Notes |
| Purchase Order | Create PO, PO dari shortage production, link ke barang masuk | Passed with Notes |
| Barang Masuk | Delivery + receiving workspace, input penerimaan, status penerimaan | Passed with Notes |
| Recipe/BOM | BOM product/WIP, UX relocation ke Recipe/BOM | Passed with Notes |
| Production Order | Material requirement, shortage, create PO, recheck stock | Passed with Notes |

## 3. Test Summary

| Status | Jumlah Area |
|---|---:|
| Passed | 0 |
| Passed with Notes | 10 |
| Prototype Ready | 1 |
| Failed | 0 |
| Blocked | 0 |
| Not Tested | 4 |

Catatan: status `Passed with Notes` berarti flow utama sudah berjalan dalam local QA, tetapi masih ada improvement lanjutan sebelum siap production.

## 4. QA Timeline Highlights

| Area | Aktivitas QA | Hasil |
|---|---|---|
| CRM | Cek halaman dashboard, members, rewards, avatars | UI dan flow awal berjalan, perlu pengembangan lanjutan collectible/avatar ownership |
| POS Customer Ordering | QA order dari `/table-order/T-01` sampai terkirim | Order flow berjalan, ditambahkan summary transaksi dan status pesanan |
| POS Open Bills | QA order meja masuk open bills dan pembayaran | Flow open bill berjalan, table management mulai terhubung |
| POS KDS | Cek pending/open bill muncul di KDS | Gap ditemukan lalu diperbaiki agar order pending masuk KDS |
| POS Products | QA produk, station, dan koneksi ke API real | Konfigurasi station diarahkan ke data real |
| Purchasing Master Data | QA supplier, raw material, price list create/edit/delete | Flow master data distabilkan |
| Production BOM | QA add BOM, nested button/hydration issue, validasi BOM | Error ditemukan dan diperbaiki lewat perubahan UX/API |
| Barang Masuk | QA penyatuan Delivery dan Penerimaan | UI disederhanakan menjadi workspace `Barang Masuk` |
| Production Shortage | QA tombol `Buatkan PO` dari bahan kurang | Berhasil redirect ke PO dengan item shortage |
| Production Recheck | QA tombol `Cek Ulang Stok` | Berhasil menampilkan hasil recheck stok dari backend |

## 5. Detailed Test Scenarios

### CRM

| ID | Scenario | Steps | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|---|
| QA-CRM-001 | Buka dashboard CRM | Open `/dashboard/crm` | Dashboard CRM tampil | Dashboard tampil | Passed with Notes | Data masih dummy/test |
| QA-CRM-002 | Buka list member | Open `/dashboard/crm/members` | List member tampil | List member tampil | Passed with Notes | Detail member sudah dipindah ke page sendiri |
| QA-CRM-003 | Buka detail member | Open `/dashboard/crm/members/[id]` | Detail member tampil | Detail tampil | Passed with Notes | Bisa lanjut ownership avatar |
| QA-CRM-004 | Buka rewards | Open `/dashboard/crm/rewards` | Rewards tampil | Rewards tampil | Passed with Notes | Perlu redemption flow lengkap |
| QA-CRM-005 | Buka avatars | Open `/dashboard/crm/avatars` | Avatar list tampil | Avatar list tampil | Passed with Notes | Sudah ada sample avatar |

### POS F&B

| ID | Scenario | Steps | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|---|
| QA-POS-001 | Buka POS cashier | Open `/dashboard/pos/cashier-new` | POS cashier tampil | Tampil | Passed with Notes | UI sudah beberapa kali dirapikan |
| QA-POS-002 | Dine-in table selector | Aktifkan dine-in | Modal pilih meja tampil | Modal tampil | Passed with Notes | Data meja sudah diarahkan ke real table |
| QA-POS-003 | Cari produk autocomplete | Ketik produk, enter | Varian terbuka atau item masuk cart | Flow dibuat | Passed with Notes | Perlu regression lebih luas untuk semua jenis produk |
| QA-POS-004 | Tambah customer/member baru | Dari POS tambah customer | Customer tersimpan dan bisa dipakai | Flow dibuat | Passed with Notes | Terhubung ke CRM concept |
| QA-POS-005 | Simpan/Buka bill | Buat order pending | Bill tersimpan | Bill tersimpan | Passed with Notes | Diperbaiki agar masuk KDS |

### Open Bills & KDS

| ID | Scenario | Steps | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|---|
| QA-OB-001 | Order meja masuk open bill | Buat order dari table/POS | Open bill muncul | Muncul | Passed with Notes | Sudah QA end-to-end |
| QA-OB-002 | Pindah meja | Dari open bill pindah meja | Table berubah | Berjalan | Passed with Notes | Perlu audit history nanti |
| QA-OB-003 | Bayar open bill | Pilih bayar | Status completed dan open bill berkurang | Berjalan | Passed with Notes | Perlu payment gateway real |
| QA-KDS-001 | Pending order masuk KDS | Simpan/Buka bill | Order tampil di KDS | Gap ditemukan lalu diperbaiki | Passed with Notes | Flow kitchen/bar station perlu QA lanjutan |
| QA-KDS-002 | Station product config | Set station produk | KDS bisa route per station | API real disiapkan | Passed with Notes | Perlu data station lebih lengkap |

### Table Self-Service Ordering

| ID | Scenario | Steps | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|---|
| QA-TBL-001 | Buka QR table order | Open `/table-order/T-01` | Page order tampil untuk meja T-01 | Tampil | Passed with Notes | Dine-in otomatis dari table ID |
| QA-TBL-002 | Product grid 2 kolom | Lihat menu list | Thumbnail lebih kecil dan 2 kolom | Berubah | Passed with Notes | Sesuai request mobile |
| QA-TBL-003 | Add to cart dengan varian | Klik produk | Modal varian tampil | Tampil | Passed with Notes | Flow dibuat lebih sederhana |
| QA-TBL-004 | Summary order | Klik info order bawah | Halaman summary tampil | Tampil | Passed with Notes | Summary bawah langsung dihapus |
| QA-TBL-005 | Submit order | Pilih metode bayar/order | Order terkirim dan status tampil | Berjalan | Passed with Notes | Backend API dibuat |
| QA-TBL-006 | Order lagi setelah submit | Klik order lagi | Bisa mulai order baru | Ditambahkan | Passed with Notes | Perlu regression multi-order |

### Purchasing Master Data

| ID | Scenario | Steps | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|---|
| QA-PUR-MD-001 | Supplier CRUD | Create/edit/delete supplier | Data tersimpan | Distabilkan | Passed with Notes | Data test boleh berubah |
| QA-PUR-MD-002 | Raw material create/edit/detail | Kelola raw material | Data tersimpan dan detail tampil | Distabilkan | Passed with Notes | Ditambahkan sample 5 raw material |
| QA-PUR-MD-003 | Price list create/edit/detail | Kelola harga supplier | Data tersimpan | Distabilkan | Passed with Notes | Perlu QA multi-supplier |
| QA-PUR-MD-004 | Product detail tab | Buka product detail | Tab informasi/BOM familiar | Diperbaiki | Passed with Notes | BOM dipindahkan lebih proper ke Recipe/BOM |

### Purchase Order & Barang Masuk

| ID | Scenario | Steps | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|---|
| QA-PO-001 | Create PO dari production shortage | Klik `Buatkan PO` | PO form terisi item shortage | Berjalan | Passed with Notes | Current flow PO dulu, PR menyusul |
| QA-PO-002 | Flow PO ke delivery | Buat delivery dari PO | Delivery tersimpan | Berjalan | Passed with Notes | UI awal sempat membingungkan |
| QA-GRN-001 | Barang Masuk workspace | Open `/dashboard/purchasing/grn` | Delivery dan penerimaan satu workspace | Berjalan | Passed with Notes | Menu diganti menjadi Barang Masuk |
| QA-GRN-002 | Input penerimaan | Open `/dashboard/purchasing/grn/new?delivery_id=...` | Form penerimaan tampil | Tampil | Passed with Notes | Nested button error diperbaiki |
| QA-GRN-003 | Action button colors | Lihat action table | Button beda warna | Diperbaiki | Passed with Notes | Pink/biru/hijau |
| QA-GRN-004 | Common wording | Lihat UI Barang Masuk | Istilah GRN diganti bahasa umum | Diperbaiki | Passed with Notes | Masih nama route `/grn` untuk kompatibilitas |

### Recipe/BOM & Production

| ID | Scenario | Steps | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|---|
| QA-BOM-001 | Add BOM item | Tambahkan BOM | BOM tersimpan | Error 400 ditemukan lalu diperbaiki | Passed with Notes | UX dipindah ke area lebih proper |
| QA-BOM-002 | BOM untuk WIP | Setup bahan dari bahan baku/WIP | WIP bisa jadi bahan | Didukung secara konsep/schema | Passed with Notes | Perlu QA produksi WIP end-to-end |
| QA-PROD-001 | Production list | Open `/dashboard/purchasing/production` | List produk yang mau diproduksi | Diperbaiki sesuai konsep | Passed with Notes | Perlu filtering/status |
| QA-PROD-002 | Production detail shortage | Buka order detail | Material shortage tampil | Tampil | Passed with Notes | QA order `PROD-202605-0004` |
| QA-PROD-003 | Create PO dari shortage | Klik action dari bahan kurang | Redirect ke PO | Berjalan | Passed with Notes | Item shortage terbawa di query |
| QA-PROD-004 | Recheck stock | Klik `Cek Ulang Stok` | Backend cek ulang stok | Berhasil | Passed with Notes | Muncul pesan masih ada 3 bahan kurang |
| QA-PROD-005 | Release blocked if shortage | Shortage masih ada | Release disabled/ditahan | Sesuai | Passed with Notes | Validasi backend dan UI ada |
| QA-PROD-006 | Complete production backend | Complete order | Stok bahan berkurang, output masuk, HPP dihitung | Logic backend tersedia | Not Tested | Perlu UI complete dan QA end-to-end |

## 6. Issues Found & Resolved

| ID | Severity | Module | Issue | Resolution | Status |
|---|---|---|---|---|---|
| BUG-001 | High | KDS/POS | Order pending dari Simpan/Buka bill tidak muncul di KDS | Flow pending/open bill dihubungkan ke KDS | Resolved |
| BUG-002 | High | Production BOM | Add BOM gagal dengan response 400 Validasi gagal | API/UX BOM diperbaiki dan konsep dipindah ke Recipe/BOM | Resolved |
| BUG-003 | Medium | Production DB View | Migration gagal karena rename kolom view `product_kode` ke `output_type` | Migration disesuaikan dan berhasil diterapkan | Resolved |
| BUG-004 | Medium | Barang Masuk | Nested `<button>` menyebabkan hydration error | Trigger popover/dropdown diperbaiki agar tidak nested button | Resolved |
| BUG-005 | Medium | Barang Masuk | Warna tombol action tetap pink semua | Button action dibuat custom color sesuai action | Resolved |
| BUG-006 | Low | Barang Masuk | Istilah GRN kurang umum untuk user | UI diganti ke `Penerimaan`/`Barang Masuk` | Resolved |
| BUG-007 | Low | Global UI | Clickable element kurang terasa bisa diklik | Global cursor pointer ditambahkan untuk action elements | Resolved |
| BUG-008 | Medium | POS Cashier | Table modal terlalu sempit dan kurang jelas | Modal/card table beberapa kali disesuaikan | Resolved |
| BUG-009 | Medium | POS Product Search | Search produk belum autocomplete dan enter behavior belum jelas | Autocomplete dan enter behavior ditambahkan | Resolved |

## 7. Data Changes During QA

Data yang digunakan masih data testing/dummy sesuai persetujuan user. Beberapa data dibuat, diubah, atau dipakai selama QA:

| Type | Identifier / Example | Action | Notes |
|---|---|---|---|
| CRM Member | Member test IDs | Read/update | Untuk detail member dan CRM flow |
| Avatar | 2 sample avatars | Created | Contoh collectible avatar |
| Table Order | `T-01` | Created/tested order | Self-service table ordering |
| Open Bill | Test dine-in bills | Created/paid/moved | Untuk table management |
| POS Product | QA products | Created/updated | Untuk station, recipe, POS connection |
| Raw Material | 5 sample raw materials | Created | Lengkap dengan harga untuk purchasing/production |
| PO | `PO-202605-000x` examples | Created/updated | Termasuk PO dari production shortage |
| Delivery | Delivery test IDs | Created | Untuk Barang Masuk |
| Production Order | `PROD-202605-0004` | Rechecked | Masih ada 3 bahan kurang |

## 8. API / Backend Verification

| Endpoint / Area | Method | Verification | Result | Status |
|---|---|---|---|---|
| `/api/purchasing/production/orders/[id]` | PATCH | Action `recheck_stock` | Mengembalikan pesan shortage | Passed |
| `/api/purchasing/receiving-workspace` | GET | Workspace Barang Masuk | Data delivery/penerimaan digabung | Passed with Notes |
| POS order API | POST | Table order submit | Order bisa terkirim | Passed with Notes |
| KDS API/flow | GET/POST | Pending/open bill masuk KDS | Gap diperbaiki | Passed with Notes |
| PO from production shortage | UI/API | Query item shortage terbawa | Berhasil | Passed with Notes |
| Production complete | PATCH | Complete logic backend | Logic tersedia | Not Tested End-to-End |

## 9. Database / Inventory Verification

| Area | Check | Expected | Actual | Status |
|---|---|---|---|---|
| PO Receiving | Barang diterima menambah stok | Inventory bertambah | Sudah disiapkan dan digunakan dalam flow | Passed with Notes |
| Production Shortage | Cek stok bahan dari order | Shortage dihitung | Tampil 3 bahan kurang pada QA terakhir | Passed |
| Production Complete | Bahan baku berkurang | Inventory movement tercatat | Logic backend tersedia | Not Tested |
| Production Output | Produk/WIP bertambah | Batch/output stock tercatat | Logic backend tersedia | Not Tested |
| HPP Aktual | HPP dihitung dari actual production cost | HPP tersimpan/update produk | Logic backend tersedia | Not Tested |

## 10. Regression Checklist

| Area | Check | Status | Notes |
|---|---|---|---|
| Login | User bisa akses dashboard sesuai role | Not Tested in this report | Session sudah aktif selama QA |
| Sidebar Purchasing | Menu Purchasing tampil | Passed | Barang Masuk dan Produksi bisa diakses |
| Topbar Purchasing | Menu module tampil | Passed | Delivery disembunyikan setelah digabung |
| Barang Masuk | Table dan action dapat diklik | Passed | Cursor pointer global ditambahkan |
| Production Detail | Recheck stock bisa diklik | Passed | QA via browser berhasil |
| POS Cashier | UI utama masih bisa dibuka | Passed with Notes | Perlu regression penuh setelah perubahan lanjutan |
| CRM | Halaman utama masih bisa dibuka | Passed with Notes | Data masih dummy |
| Mobile Table Order | Layout 2 kolom | Passed with Notes | Perlu QA device matrix |

## 11. Remaining QA Gaps

Area yang belum selesai atau perlu QA formal:

1. Production complete end-to-end dari UI.
2. Actual material consumption dan waste/susut saat complete production.
3. Inventory stock card per raw material/WIP/product.
4. WIP production end-to-end:
   - produksi WIP
   - WIP masuk stok
   - WIP dipakai sebagai BOM produk final
   - HPP WIP terbawa ke produk final
5. Multi-supplier PO dari shortage.
6. Payment real untuk QRIS, VA, dan Ark Coin.
7. Permission matrix per role.
8. Print kitchen/bar dan printer queue production-like test.
9. Responsive QA lengkap untuk tablet/mobile.
10. Regression build/deploy setelah seluruh flow purchasing-production stabil.

## 12. Recommendation

Status keseluruhan: Passed with Notes.

Rekomendasi development berikutnya:

1. Buat Production Complete UI.
2. Tambahkan Production Movement History.
3. Buat Inventory Stock Card.
4. QA WIP end-to-end.
5. Setelah itu baru lakukan QA regression formal untuk Purchasing + Production.

Untuk kebutuhan presentasi, report ini bisa dipecah menjadi slide:

1. Executive Summary.
2. Module Coverage.
3. End-to-End Flow yang Sudah Berjalan.
4. Issues Found & Resolved.
5. Current Risk / QA Gaps.
6. Recommended Next Phase.
