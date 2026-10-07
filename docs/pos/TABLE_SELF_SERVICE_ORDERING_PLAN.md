# Table Self-Service Ordering Plan

Last updated: 2026-09-12 (EPIC-048 — status live ada di `docs/epics/EPIC-048-self-order-meja-qr.md`)

Dokumen ini menjelaskan POS self-service untuk customer/member yang order dari meja lewat QR Code.

## Ringkasan

Setiap meja punya QR Code (Dashboard → POS → Tables → tombol **QR self-order**: tampil, salin, unduh PNG, cetak kartu). Saat customer scan QR, customer diarahkan ke `/table-order/[qr_code]` yang otomatis membawa identitas meja. Customer bisa masuk sebagai member lewat OTP WhatsApp atau order sebagai tamu, memilih menu, memilih pembayaran, lalu submit order.

Flow ini terpisah dari POS cashier, tetapi order tetap masuk ke POS (open bill / paid) dan KDS per station.

## Route

```text
/table-order/[tableCode]      ← tableCode = pos_tables.qr_code (fallback: table_number / uuid)
```

Contoh: `/table-order/TBL-T01-9F3A2C1D`, `/table-order/T-01`.

## Flow Customer

```text
Scan QR meja
  -> buka /table-order/[tableCode]
  -> pilih Makan di tempat / Bawa pulang
  -> (opsional) Masuk Member: nomor WA -> OTP -> sesi member
  -> pilih menu (kategori sticky, cari, varian via sheet)
  -> keranjang: catatan dapur, ringkasan pajak/service sesuai profil billing
  -> pilih pembayaran
     -> QRIS (bila gateway Xendit aktif) — QR tampil di HP pemesan
     -> ARK Coin (member ber-sesi, saldo cukup) — langsung lunas
     -> Bayar di kasir — open bill, sebut nomor antrean
  -> submit -> layar pelacakan (antrean, progres dapur, status bayar)
  -> item otomatis masuk KDS sesuai station produk
```

## Kode

- Halaman: `src/app/table-order/[tableCode]/page.tsx` → `src/features/table-order/components/table-order-app.tsx`
- Komponen: `menu-item-row` (baris gaya referensi GoFood), `variant-sheet`, `cart-sheet`, `member-sheet` (OTP), `order-tracking`, `sheet`
- Lib murni: `src/lib/table-order/{menu,pricing,order-status}.ts` (teruji), server: `server.ts`, `qris.ts`
- Admin QR meja: `src/features/pos/tables/components/table-qr-dialog.tsx`

## API

| Endpoint | Fungsi |
|----------|--------|
| `GET /api/table-order/products` | Katalog `pos_products` aktif+tersedia, `categories`, `meta` diagnosa (kenapa kosong) |
| `GET /api/table-order/session/[tableCode]` | Identitas meja, profil billing (charges), brand, `qris_available`, `ark_rate`, status login member |
| `POST /api/table-order/orders` | Buat order — harga/XP/station dihitung server; `payment_method` `qris \| ark_coin \| cashier`; `order_type` `dine_in \| takeaway` |
| `GET /api/table-order/orders/[id]?qr=1` | Status pesanan + item; cek & settle QRIS otomatis; `qr=1` kirim ulang `qr_string` |
| `POST /api/member-portal/otp` · `/verify` · `GET /me` · `POST /logout` | Login member (reuse portal member) |

`POST /api/table-order/customers/lookup` **dihapus** (membuat member tanpa verifikasi).

## Keamanan

- Klien hanya mengirim `product_id`, `variant_id`, `quantity` — harga dari DB.
- ARK Coin hanya dengan cookie sesi member (OTP); `customer_id` dari body diabaikan.
- QRIS: konfigurasi gateway dicek sebelum order dibuat; QR terikat order sehingga webhook Xendit yang ada (`/api/payments/xendit/webhook` → `settleOrderQrisPayment`) melunasi otomatis; polling pemesan sebagai cadangan.
- Rate limit per IP: buat order 20/menit, status 90/menit.
- Order id (UUID acak) = token akses layar pelacakan; respons tanpa data pribadi.

## Prasyarat Operasional (QA T-10)

1. `pos.pos_products` terisi, `is_active` & `is_available` true (menu kosong → layar menampilkan diagnosa).
2. Settings → Payment Gateways: Xendit aktif + secret key + callback URL ke `/api/payments/xendit/webhook`.
3. Fonnte/WhatsApp aktif untuk OTP member (nomor harus terdaftar sebagai member).
4. Meja punya `qr_code` (otomatis saat dibuat) — cetak dari tombol QR.
5. `crm_settings.default_company_id/default_branch_id` terisi (nomor antrean & jurnal).

## Belum Dikerjakan

- Virtual Account (tidak ada integrasi VA di repo).
- Modifier group (hanya varian yang didukung di self-order).
- Mode strict kode meja / signed token (kode tak terdaftar masih boleh memesan, `table_id` null).
- Promo code di self-order (engine promo EPIC-032 baru untuk kasir & tiket).
