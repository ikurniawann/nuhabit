# POS Manual Discount (Item + Transaction) — Design

**Date:** 2026-08-13  
**Status:** Approved & implemented (2026-08-13)  
**Related:** EPIC-032 promo (transaction promo codes), CRM membership tier %, existing `pos_orders.discount_amount` / `pos_order_items.discount_amount`

## Goal

Kasir dapat memberi **diskon manual** pada:
1. **Item** (per baris cart)
2. **Transaksi** (seluruh order)

masing-masing sebagai **persen (%)** atau **nominal (Rp)**, tanpa approval manager.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Scope | Item + transaksi |
| Types | `%` dan nominal |
| Stacking | Item → membership → promo → manual transaksi |
| Approval | Tidak ada; cap = basis (line/order sisa) |
| Persist | Type + value + amount terhitung (bukan amount-only) |

## Current state

- Order-level: `discount_amount` / `discount_reason` dipakai membership + promo code.
- Line-level: kolom `discount_amount` ada, selalu diisi `0`.
- Tidak ada UI diskon manual kasir (% / Rp).
- Cart di `localStorage` (`pos_cart_state`), bukan tabel DB.

## Data model

### Migration — `pos.pos_order_items`

| Column | Type | Notes |
|--------|------|--------|
| `discount_type` | `varchar(16)` nullable | `percent` \| `fixed` |
| `discount_value` | `numeric(12,2)` nullable | Input kasir (10 = 10%, atau 5000 = Rp) |
| `discount_amount` | existing | Computed, `0 ≤ amount ≤ line subtotal` |

### Migration — `pos.pos_orders`

| Column | Type | Notes |
|--------|------|--------|
| `manual_discount_type` | `varchar(16)` nullable | `percent` \| `fixed` |
| `manual_discount_value` | `numeric(12,2)` nullable | Input kasir untuk diskon transaksi |
| `discount_amount` | existing | **Agregat** semua potongan (line + membership + promo + manual) |
| `discount_reason` | existing | Teks gabungan untuk audit (lihat di bawah) |

Tidak menambah tabel baru. Promo engine tidak diubah.

### `discount_reason` format (contoh)

```
ITEM line discounts; MEMBER 10%; PROMO SUMMER10; MANUAL 5%
```

Segmen kosong dihilangkan. Cukup untuk audit manusia; type/value tetap di kolom terstruktur.

## Calculation

Pure helpers (unit-tested), dipakai client preview + server authority.

### Per line

1. `line_subtotal = (unit_price + adjustments) * qty` (pola harga existing)
2. Jika `discount_type = percent`: `amount = floor(line_subtotal * value / 100)`
3. Jika `fixed`: `amount = value` (diperlakukan sebagai potongan line, bukan per unit)
4. Cap: `amount = min(amount, line_subtotal)`
5. `line_total = line_subtotal - amount`

### Order stack

1. `items_subtotal = Σ line_total` (setelah diskon item)
2. `membership_amt = floor(items_subtotal * membership_pct / 100)` (existing)
3. `promo_amt` dari promo engine pada basis sisa setelah membership (existing hold/preview)
4. Basis manual = `items_subtotal - membership_amt - promo_amt`
5. Manual transaksi: percent atau fixed atas basis manual; cap ≤ basis
6. `discount_amount` order = `(Σ line discount_amount) + membership_amt + promo_amt + manual_amt`
7. Tax / service / other via `calculateBillCharges` pada **subtotal setelah semua diskon** (`items_subtotal - membership - promo - manual`)

Tolerance server vs client: **Rp 1** (sama pola promo sekarang).

### Validation rules

- `percent`: `0 < value ≤ 100`
- `fixed`: `value > 0` dan ≤ basis
- Clear discount → type/value/amount null/0
- Tidak boleh total order negatif

## UI (Cashier)

Standar: soft borders, `DialogPanel`, loading + disabled pada mutasi, toast sukses/error (satu sumber).

### Item

- Aksi **Diskon** pada baris cart
- `DialogPanel` (`sm`): toggle `%` | `Rp`, input, preview potongan, **Hapus** / **Terapkan**
- Badge di baris: `−10%` atau `−Rp 5.000`

### Transaksi

- Kontrol **Diskon transaksi** di panel Order (dekat promo code)
- Dialog sama; basis = sisa setelah membership + promo
- Breakdown: Subtotal → Diskon item → Membership → Promo → Diskon transaksi → Tax/charges → Total

### Disabled when

- Keranjang kosong / basis 0
- Sedang submit pembayaran (ikut loading existing)

## Cart & API

### Cart state (`usePosCart` / checkout)

- Item: `discount_type`, `discount_value`, `discount_amount`
- Order: `manual_discount_type`, `manual_discount_value`

### Create order / open-bill payload

- Items: include `discount_type`, `discount_value`, `discount_amount`
- Order: `manual_discount_type`, `manual_discount_value`, `discount_amount`, `discount_reason`
- Server recomputes stack; mismatch → 400

### Accounting

- Tetap memakai `discount_amount` agregat + mapping DISCOUNT existing
- Tidak ada akun terpisah per tipe manual vs promo di v1

### Split bill

- Line discount sudah tercermin di `line_total` / subtotal
- Order-level discount (membership + promo + manual) dialokasi proporsional seperti pola split existing
- Promo + split: batasan existing (promo ditolak pada split) **tidak diubah** di v1; manual transaksi mengikuti alokasi order discount

## Out of scope (v1)

- Manager approval / `discount:approve` gate
- Perubahan promo campaign / per-product promo (EPIC-032 Fase E)
- UI CFD khusus (ikut total existing)
- Skema voucher legacy `pos_vouchers`
- Soft-delete / history diskon terpisah

## Test plan (acceptance)

- [ ] Item % dan Rp mengurangi line; cap tidak melebihi line subtotal
- [ ] Transaksi % dan Rp setelah membership + promo; cap pada sisa
- [ ] Stack penuh: item + member + promo + manual → tax dari net
- [ ] Hapus diskon item/transaksi mengembalikan total
- [ ] Server tolak payload amount yang dimanipulasi
- [ ] Order tersimpan type/value/amount; reason terbaca
- [ ] Unit test helper perhitungan

## Non-goals clarification

Ini **bukan** pengganti promo code atau membership. Manual discount adalah lapisan tambahan yang ditumpuk sesuai urutan di atas.
