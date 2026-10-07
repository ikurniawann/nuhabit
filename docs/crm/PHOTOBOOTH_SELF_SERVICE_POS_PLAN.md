# Photobooth Self-Service POS Plan

Last updated: 2026-05-22

Dokumen ini menjelaskan kebutuhan POS self-service khusus photobooth. Modul ini harus terpisah dari POS F&B/cashier agar flow, UI, payment, dan integrasi partner tidak bercampur.

## Prinsip Utama

- Photobooth POS adalah kiosk/self-service.
- POS F&B tetap dipakai untuk operasional cashier, table, split bill, KDS, dan F&B order.
- Photobooth POS fokus pada:
  - pilih paket photobooth
  - lookup/daftar customer/member
  - bayar QRIS atau ARK Coin
  - kirim payment success ke partner
  - menunggu session photobooth siap
  - menerima callback partner setelah foto selesai
  - update XP dari callback partner

## Entry Point

Rencana route:

```text
/photobooth
/photobooth/self-service
/dashboard/crm/photobooth
```

Rekomendasi:

- `/photobooth/self-service` untuk kiosk customer-facing.
- `/dashboard/crm/photobooth` untuk admin monitoring, partner config, event log, dan troubleshooting.

## Perbedaan Dengan POS F&B

| Area | POS F&B | Photobooth Self-Service |
| --- | --- | --- |
| User utama | cashier/staff | customer |
| Order | dine-in/takeaway/table | single purpose session |
| Cart | banyak item F&B | paket photobooth |
| Payment | cash, QRIS, debit, credit, ARK Coin | QRIS, ARK Coin |
| Setelah bayar | order kitchen/KDS | buka session partner |
| XP | saat order/payment POS selesai | setelah photobooth callback sukses |
| Partner | tidak wajib | wajib |
| UI | staff dashboard | kiosk/simple touch UI |

## Flow Self-Service

```text
Customer buka kiosk photobooth
  -> pilih paket
  -> input nomor HP / scan member / pilih guest
  -> sistem cari atau buat POS customer
  -> tampilkan harga, XP benefit, ARK Coin balance
  -> customer pilih payment QRIS atau ARK Coin
  -> payment sukses
  -> sistem membuat POS order photobooth paid
  -> sistem kirim payment success ke partner
  -> partner return partner_session_id dan status ready
  -> kiosk tampilkan instruksi / QR session / booth ready
  -> customer memakai photobooth
  -> partner callback session completed
  -> sistem award XP
  -> kiosk/admin bisa melihat session completed
```

## UI Kiosk Yang Dibutuhkan

### 1. Welcome Screen

- Brand photobooth.
- Pilihan bahasa jika diperlukan.
- Tombol mulai.

### 2. Package Selection

- Daftar paket photobooth dari `pos_products`.
- Filter hanya produk kategori/type `photobooth`.
- Tampilkan:
  - nama paket
  - harga
  - deskripsi
  - estimasi XP
  - jumlah print atau template jika ada

### 3. Member Identification

Pilihan:

- Input nomor HP.
- Scan QR member.
- Continue as guest.

Jika member ditemukan:

- tampilkan nama
- tier
- current XP
- ARK Coin balance

Jika belum ada:

- buat POS customer minimal:
  - name optional
  - phone wajib jika ingin XP/member
  - email optional

### 4. Payment Screen

Payment method:

- QRIS
- ARK Coin

Behavior:

- QRIS menampilkan QR dan status payment.
- ARK Coin cek balance cukup.
- Jika balance kurang, arahkan ke QRIS atau top up.

### 5. Session Ready Screen

Setelah payment sukses dan partner menerima event:

- tampilkan session ready.
- tampilkan booth/session instruction.
- optional QR session token.
- tampilkan countdown expiry.

### 6. Completion Screen

Setelah callback partner sukses:

- tampilkan thank you.
- tampilkan XP earned.
- tampilkan total XP/current XP baru.
- optional link/QR preview foto jika partner menyediakan.

### 7. Error/Recovery Screen

Case:

- payment gagal
- ARK Coin kurang
- partner offline
- session expired
- callback terlambat

Harus ada opsi:

- retry partner dispatch
- pilih payment lain
- panggil staff
- refund/manual handling nanti

## Data Model

Baseline bisa memakai tabel POS/CRM yang sudah ada:

- `pos_products`
- `pos_orders`
- `pos_order_items`
- `pos_customers`
- `crm_member_profiles`
- `crm_xp_rules`
- `crm_xp_ledger`
- `crm_integration_partners`
- `crm_external_events`

Tambahan yang direkomendasikan untuk self-service:

```text
photobooth_sessions
```

Field rencana:

- `id`
- `order_id`
- `order_number`
- `customer_id`
- `member_id`
- `partner_id`
- `partner_session_id`
- `session_token`
- `status`
- `payment_method`
- `amount`
- `ark_coins_used`
- `expires_at`
- `started_at`
- `completed_at`
- `xp_ledger_id`
- `metadata`
- `created_at`
- `updated_at`

Status:

```text
draft
payment_pending
paid
partner_pending
ready
in_progress
completed
failed
expired
cancelled
```

## Product Configuration

Photobooth package sebaiknya tetap berada di `pos_products`, tapi dibedakan dari F&B.

Opsi paling sederhana:

- buat category `Photobooth`
- filter self-service dari category ini

Opsi lebih proper:

- tambah field `product_type`
  - `fnb`
  - `photobooth`
  - `merchandise`
  - `service`

Rekomendasi:

- Phase awal pakai category `Photobooth` agar cepat.
- Phase proper tambah `product_type` supaya tidak bergantung nama kategori.

Metadata produk photobooth:

```json
{
  "photobooth": {
    "package_code": "PB_BASIC",
    "print_count": 1,
    "media_count": 4,
    "duration_minutes": 5,
    "partner_code": "photobooth_vendor_a"
  }
}
```

## Payment Handling

### QRIS

Rencana:

- create order/session dengan status `payment_pending`
- generate QRIS payment
- poll payment status atau terima callback payment gateway
- jika paid:
  - update `pos_orders.payment_status = paid`
  - update `photobooth_sessions.status = paid`
  - dispatch payment success ke partner

### ARK Coin

Rencana:

- cek `pos_customers.ark_coin_balance`
- jika cukup:
  - potong ARK Coin
  - create paid order
  - update `ark_coins_used`
  - dispatch payment success ke partner

Catatan:

- ARK Coin harus idempotent agar tidak terpotong dua kali saat retry.
- Jika dispatch partner gagal setelah ARK Coin terpotong, session masuk status `partner_pending` atau `failed`, bukan mengulang pemotongan coin.

## Integrasi Partner

Self-service POS memakai kontrak di:

- `docs/crm/PHOTOBOOTH_PARTNER_INTEGRATION_GUIDE.md`

Outbound setelah payment sukses:

```text
photobooth.payment_success
```

Inbound dari partner:

```text
photobooth.session_completed
photobooth.session_failed
photobooth.session_cancelled
photobooth.session_expired
```

XP diberikan hanya setelah:

- partner callback `photobooth.session_completed`
- status `success`
- idempotency valid

## API Yang Dibutuhkan

### Customer/Kiosk

```text
GET  /api/photobooth/products
POST /api/photobooth/customers/lookup
POST /api/photobooth/sessions
GET  /api/photobooth/sessions/:id
POST /api/photobooth/sessions/:id/pay/qris
POST /api/photobooth/sessions/:id/pay/ark-coin
POST /api/photobooth/sessions/:id/dispatch
```

### Partner Callback

```text
POST /api/crm/integrations/photobooth/callback
```

### Admin

```text
GET  /api/crm/integrations/partners
POST /api/crm/integrations/partners
GET  /api/crm/integrations/events
POST /api/crm/integrations/events/:id/retry
```

## Security

Kiosk/self-service harus dibatasi:

- tidak boleh akses dashboard admin
- tidak boleh melihat semua customer
- customer lookup harus by phone/member QR saja
- session token one-time dan expiry
- partner callback pakai HMAC signature
- idempotency untuk payment, dispatch, callback, dan XP ledger

## Development Phases

### Phase 1 - Planning & Contract

Status: ready to start

- Finalisasi route.
- Finalisasi data model `photobooth_sessions`.
- Finalisasi product config.
- Finalisasi partner payload.

### Phase 2 - Product & Kiosk UI Baseline

- Buat page `/photobooth/self-service`.
- Tampilkan paket photobooth.
- Customer lookup/create minimal.
- Cart single package.

### Phase 3 - Payment Baseline

- ARK Coin payment.
- QRIS placeholder/sandbox.
- Create POS order paid khusus photobooth.
- Create `photobooth_sessions`.

### Phase 4 - Partner Dispatch

- Partner registry.
- Dispatch `photobooth.payment_success`.
- Store partner response.
- Retry failed dispatch.

### Phase 5 - Partner Callback & XP

- Callback endpoint.
- HMAC verification.
- Store `crm_external_events`.
- Award XP on completed.
- Update session completed.

### Phase 6 - Admin Monitoring

- Page `/dashboard/crm/photobooth`.
- Session list.
- Event log.
- Retry/reprocess failed event.

## Keputusan Teknis Sementara

- Photobooth POS dibuat sebagai module/page terpisah dari `/dashboard/pos`.
- Produk photobooth tetap memakai `pos_products` agar reporting sales tetap menyatu.
- XP photobooth tidak diberikan oleh POS order biasa, tapi oleh callback partner.
- `crm_external_events` dipakai untuk audit callback partner.
- `photobooth_sessions` direkomendasikan sebagai tabel baru untuk state machine session.

## Next Implementation

Langkah berikutnya yang disarankan:

1. Buat migration `photobooth_sessions`.
2. Buat API `GET /api/photobooth/products`.
3. Buat UI awal `/photobooth/self-service`.
4. Buat session create dan ARK Coin payment baseline.
