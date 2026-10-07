# POS Kasir Pusat — Multi-Stall Cart & Checkout

**Date:** 2026-08-15  
**Status:** Approved (2026-08-15)  
**Related:** `pos-sell-stall.ts` (1 order = 1 stall), `arkiv-active-stall` cookie, `can_switch_stall`, Xendit QRIS POS, restaurant open bills, KDS by station

## Goal

Kasir pusat menjual menu semua stall dalam 1 keranjang dan **bayar 1x** (1 akun Xendit). Data operasional tetap pecah per stall. Kasir stall tidak berubah: 1 stall, transaksi sendiri.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Settlement ke rekening stall | Belakang. 1 akun Xendit perusahaan |
| xenPlatform / disbursement | Out of scope |
| Model data campur stall | `pos_checkouts` (payung) + child `pos_orders` per stall |
| Keranjang 1 stall | Order biasa. Tidak buat checkout |
| Siapa jual campur | Hanya user kasir pusat, switcher = **Semua Stall** |
| Akses | IAM `pos.cashier.central` **dan** switch user **Kasir pusat** |
| Role baru `kasir_pusat` | Tidak |
| Switcher stall | **Tetap**. Tidak dihapus |
| `can_switch_stall` | Tetap = pindah 1 stall ↔ 1 stall |
| Ganti stall + keranjang isi | Konfirmasi → clear **draft** keranjang |
| Open bill tersimpan | Tidak di-void saat ganti stall |
| Meja + kasir pusat | 1 checkout, banyak pesanan stall, **bayar 1x** |
| Kasir stall di meja yang sama | Selalu transaksi terpisah |
| Floor meja | Tampilkan **semua** tagihan terbuka (pusat + stall) |
| KDS | Child / order stall saja. Parent checkout tidak masuk KDS |
| Nomor antrian kasir pusat | 1 nomor untuk tamu; child ikut nomor induk |
| Pajak / SC / diskon campur | Proporsional ke child menurut subtotal stall |

## Current state

- Jual wajib 1 stall. Mode cookie `all` / "Semua Stall" → katalog kosong + checkout 400.
- `pos_orders.warehouse_id` = 1 stall. Item tidak punya stall sendiri.
- Switcher: ganti stall ditolak jika `pos_cart_state` berisi item.
- Di path kasir/restaurant, opsi "Semua Stall" disembunyikan.
- Payment 1 metode per order. Xendit = 1 dynamic QR, poll, lalu create order. Webhook Xendit belum menandai order lunas.
- KDS filter `station`, bukan stall.
- Pindah order ke meja yang sudah ada open bill → 409 `Table is occupied`.
- Laporan transaksi/produk sudah bisa filter `warehouse_id`.

## Actors

**Kasir stall** — switch Kasir pusat Off. Satu stall aktif. Katalog + checkout seperti sekarang.

**Kasir pusat** — IAM `pos.cashier.central` + switch Kasir pusat On. Default switcher **Semua Stall**. Boleh pilih 1 stall (berperilaku seperti kasir stall untuk transaksi itu).

**Supervisor cover** — `can_switch_stall` On, Kasir pusat Off. Pindah stall, tetap 1 transaksi = 1 stall.

## Access & setting

### IAM (sekali)

Menu capability (bukan halaman baru):

| Field | Value |
|-------|--------|
| Code | `pos.cashier.central` |
| Name | Kasir Pusat |
| Parent | `pos.operations` |
| Sidebar | `is_visible = false` |
| Actions | `read` |
| Default grant | `admin`, `super_admin`, `pos_supervisor`, `pos` |
| Jangan grant | Role non-POS |

Tanpa menu ini, switch "Kasir pusat" di user tidak muncul / tidak berlaku.

Masuk `iam-menus.sql` + whitelist seeder (pola menu POS lain).

### Per user (harian)

`configuration.users.can_central_checkout boolean NOT NULL DEFAULT false`

Di form user, kartu stall (sebelah "Boleh pindah stall"):

**Kasir stall**

| Field | Isi |
|-------|-----|
| Role | `pos` |
| Stall default | Stall-nya |
| Boleh pindah stall | Off |
| Kasir pusat | Off |

**Kasir pusat**

| Field | Isi |
|-------|-----|
| Role | `pos` atau `pos_supervisor` |
| Stall default | Bebas (dipakai jika turun jaga 1 stall) |
| Boleh pindah stall | On (dipaksa On jika Kasir pusat On) |
| Kasir pusat | On |

Admin/superadmin punya menu IAM; switch Kasir pusat **default Off** — tidak semua admin otomatis jual campur.

### Gate

```
bolehJualCampur =
  punya menu pos.cashier.central
  AND users.can_central_checkout = true
  AND switcher mode = "all"
```

`can_switch_stall` saja **tidak** membuka katalog campur.

## Catalog UI (kasir pusat, mode Semua Stall)

- `GET /api/pos/products` mengembalikan union produk semua stall di branch (scope assignment / all-access yang sudah ada).
- Tiap produk membawa `warehouse_id` + nama stall.
- Chip filter **Stall** di samping filter kategori: Semua / Stall A / Stall B. Client-side, pola kategori.
- Kasir stall / mode 1 stall: API tetap scoped 1 `warehouse_id`. Tidak ada chip stall.

## Switch stall

Berlaku di Kasir, restaurant, open bill, meja (sidebar `StallSwitcher` + `CashierStallGate`).

| Kondisi | Aksi |
|---------|------|
| Keranjang draft kosong | Langsung ganti + reload |
| Draft ada isi | `DialogPanel` `xs`: "Keranjang akan dikosongkan karena stall diganti. Lanjut?" Batal / Ganti stall |
| Ganti stall | Clear `pos_cart_state` → `POST /api/auth/active-stall` → reload |
| Open bill / child / checkout tersimpan | Tidak dihapus |

## Data model

Checkout **bukan** `pos_orders`. Parent = `pos.pos_checkouts`. Child = `pos.pos_orders` (1 baris per stall). Laporan/KDS/stok/jurnal tetap baca `pos_orders` — tidak double-count.

### Kapan checkout dibuat

Ditentukan saat submit, bukan saat buka mode Semua Stall.

| Keranjang | Hasil |
|-----------|--------|
| 1 stall (kasir stall atau kasir pusat) | 1 `pos_orders` (jalur lama). `checkout_id` null |
| ≥2 stall, kasir pusat, mode `all` | 1 `pos_checkouts` + 1 child per stall |
| Campur lalu item stall lain dihapus sebelum bayar | Jatuh ke jalur 1 order |

### `pos.pos_checkouts`

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid PK | |
| `checkout_number` | varchar | Nomor tamu / struk (unik) |
| `queue_number` | existing generator | 1 nomor antrian tamu |
| `company_id` / `branch_id` | uuid | |
| `table_id` | text null | Meja restaurant |
| `customer_id` | uuid null | |
| `cashier_id` / `shift_id` | uuid | |
| `payment_method` / `payment_status` | enum existing | Tender di sini |
| `subtotal`, `discount_amount`, `tax_amount`, `service_charge_amount`, `other_charges_amount`, `total_amount` | numeric | Total tamu |
| `amount_paid`, `change_amount` | numeric | |
| `xendit_qr_id` | text null | QR dinamis |
| `xendit_external_id` | text null | Idempotensi webhook |
| `notes` | text null | |
| `created_at` / `updated_at` | timestamptz | |

### `pos.pos_orders` (tambahan)

| Column | Type | Notes |
|--------|------|--------|
| `checkout_id` | uuid null FK → `pos_checkouts` | Terisi hanya pada child |
| `sold_from` | varchar | `central` \| `stall`. Default `stall`. Kasir pusat (1 stall atau child) = `central` |

`warehouse_id` child = stall itu. Item tetap milik child. Rule `assertOrderItemsMatchSellStall` berlaku **per child**.

`payment_status` child mengikuti checkout saat tender sukses (semua child `paid` bersama). `payment_method` child disalin dari checkout untuk laporan shift yang masih baca order.

### Alokasi ke child

1. Subtotal child = Σ item stall itu.
2. Diskon / pajak / service charge / charge lain: proporsional `subtotal_child / subtotal_checkout` (billing cabang, bukan settlement per stall).
3. Pembulatan sisa sen ke child dengan subtotal terbesar.
4. Stok, HPP, jurnal: per child, hook existing setelah lunas.

## Payment

Tender **hanya** di checkout (campur) atau di order (1 stall).

| Metode | Alur campur |
|--------|-------------|
| Cash / debit / credit / ARK / NFC / gift | Create checkout + children atomically, status `paid` |
| QRIS Xendit | Create checkout `unpaid` + 1 QR = `total_amount` → poll/webhook lunas → create children + set semua `paid` |

Satu QR, satu akun Xendit. Jangan N QR. Simpan `xendit_qr_id` / `xendit_external_id` di checkout.

Webhook Xendit untuk **sale checkout** (bukan hanya topup ARK) adalah pengerasan; MVP boleh tetap poll seperti kasir sekarang, asal id tersimpan.

Split bill tamu tetap di checkout (bagi orang). Bukan bagi stall.

## Restaurant / meja

**Kasir pusat + meja:** 1 checkout per sesi tagihan pusat di meja itu. Item banyak stall menumpuk ke child. Close = bayar 1x seluruh child checkout itu.

**Kasir stall:** selalu `pos_orders` baru. Tidak nempel ke checkout pusat. Tidak auto-merge.

Satu meja boleh beberapa tagihan terbuka:

```
Meja 5
 ├─ Checkout pusat (child stall 1+2+3)  → bayar 1x
 └─ Order kasir stall 2                 → bayar terpisah
```

- Longgarkan 409 `Table is occupied` untuk create/move tambahan ke meja yang sudah ber-bill.
- Floor: 1 meja occupied; detail = daftar semua tagihan terbuka (checkout + order stall), masing-masing status bayar.
- Kasir pusat tidak menggabungkan order stall yang sudah berdiri. Merge manual existing tetap di luar fitur ini.
- Order stall di meja **sudah lunas**, lalu kasir pusat pesan lagi → checkout baru. Jangan gabung ke yang sudah paid.
- Order stall **belum lunas**, kasir pusat ambil meja → **jangan** angkat otomatis jadi child. Tetap terpisah (keputusan kasir stall = transaksi sendiri).

Ganti stall: draft hilang; checkout + order meja tetap.

## KDS & antrian

- Tiket KDS = child atau order kasir stall. Checkout tidak dikirim ke KDS.
- Filter existing `station` + `warehouse_id` order (dapur stall 2 hanya lihat stall 2).
- Antrian tamu kasir pusat = `pos_checkouts.queue_number`. Child menyalin nomor yang sama + label stall di tiket/struk.
- Order kasir stall: `generate_queue_number` sendiri seperti sekarang.
- TV antrian: 1 baris per checkout (pusat) atau per order stall.

## Reports & accounting

- Omzet stall = `pos_orders` dengan `warehouse_id` itu (child + order stall). Jangan jumlahkan checkout.
- Laporan "transaksi kasir pusat": group by `checkout_id` / `sold_from = central`.
- Shift close: jumlahkan `pos_orders` (hindari double jika suatu saat ada yang menjumlah checkout).
- Jurnal: tetap per order id child setelah lunas. `document_id` = child id.

## Struk

Campur: 1 struk `checkout_number`, item dikelompokkan per stall, 1 total, 1 tender.  
1 stall: struk order seperti sekarang.

## Error handling

| Kasus | Perilaku |
|-------|----------|
| User tanpa gate jual campur, keranjang campur | Checkout 400 |
| Item produk tanpa `warehouse_id` | Tolak baris itu |
| QRIS paid + create child gagal | Checkout tetap `paid` pending repair; jangan charge QR kedua (idempoten `xendit_external_id`) |
| Sebagian child gagal insert | Transaksi DB rollback seluruh checkout+child |
| Ganti stall, localStorage gagal | Tetap POST stall baru; toast warning keranjang mungkin sisa |

## Testing (wajib)

Logika murni, bukan markup:

- Gate `bolehJualCampur` (kombinasi IAM + flag + mode).
- Keputusan checkout vs order biasa dari daftar `warehouse_id` item.
- Alokasi proporsional + rounding sisa.
- `posCartHasItems` + keputusan tampil dialog (sudah ada helper).
- Laporan: parent checkout tidak masuk omzet stall.

## Out of scope

- Xendit xenPlatform, split ke sub-account stall, disbursement
- Komisi / settlement ledger stall
- Auto-merge order kasir stall ke checkout pusat
- Bayar per stall di dalam checkout pusat
- Halaman sidebar baru "Kasir Pusat"

## Phasing

1. IAM + flag user + katalog union + filter stall + dialog ganti stall (clear draft). Keranjang tetap 1 stall: item stall lain ditolak / minta konfirmasi ganti. Checkout campur belum.
2. `pos_checkouts` + keranjang campur + payment 1x (cash + QRIS poll) + struk.
3. Restaurant: multi-bill per meja + floor list + longgarkan occupied.
4. KDS `warehouse_id` + antrian 1 nomor checkout.
5. Laporan `sold_from` / group checkout. Webhook Xendit sale.

Fase 1 sudah berguna (kasir pusat lihat semua menu) tanpa merusak 1 order = 1 stall.
