# Photobooth Partner Integration Guide

Last updated: 2026-05-22

Dokumen ini adalah panduan integrasi antara ARK/Talentpool dan vendor photobooth.

Posisi sistem:

- ARK/Talentpool mengelola customer, member CRM, payment POS, ARK Coin, QRIS, XP, dan audit event.
- Partner photobooth mengelola device, session photobooth, proses foto, dan status hasil foto.

Catatan penting:

- Payment photobooth akan memakai POS self-service/kiosk khusus photobooth.
- POS self-service photobooth terpisah dari POS F&B/cashier.
- Detail rancangan POS self-service ada di `docs/crm/PHOTOBOOTH_SELF_SERVICE_POS_PLAN.md`.

## Ringkasan Flow

```text
Customer beli photobooth di POS self-service
  -> payment sukses lewat QRIS / ARK Coin / metode POS lain
  -> ARK kirim payment success ke partner
  -> partner membuka session photobooth
  -> customer memakai photobooth
  -> partner kirim callback session completed ke ARK
  -> ARK validasi callback
  -> ARK update XP member
  -> ARK simpan audit event supaya tidak double XP
```

XP tidak diberikan saat payment sukses. XP diberikan setelah partner mengirim status photobooth selesai sukses.

## Yang Harus Disiapkan ARK

### 1. Partner Registry

ARK akan menyimpan data partner di `crm_integration_partners`.

Field penting:

- `code`: kode unik partner, contoh `photobooth_vendor_a`
- `name`: nama partner
- `partner_type`: `photobooth`
- `secret_hash`: hash secret untuk signature
- `webhook_url`: endpoint partner untuk menerima payment success
- `allowed_event_types`: daftar event yang boleh dikirim partner
- `is_active`: status partner
- `metadata`: config tambahan seperti timeout, outlet mapping, booth mapping

### 2. Event Audit

Semua event masuk/keluar akan dicatat di `crm_external_events`.

Field penting:

- `partner_id`
- `external_event_id`
- `source_channel`: `photobooth`
- `event_type`
- `customer_id`
- `member_id`
- `outlet_id`
- `xp_rule_id`
- `xp_ledger_id`
- `processing_status`: `pending`, `processed`, `failed`, `ignored`
- `payload`
- `received_at`
- `processed_at`

Unique key:

```text
partner_id + external_event_id
```

Ini dipakai untuk idempotency supaya callback retry dari partner tidak memberi XP dua kali.

### 3. Outbound Payment Success

Saat payment POS sukses untuk produk photobooth, ARK akan mengirim event ke partner.

Rencana endpoint partner:

```http
POST {partner_webhook_url}
```

Event:

```text
photobooth.payment_success
```

Contoh payload:

```json
{
  "event": "photobooth.payment_success",
  "event_id": "ark_evt_20260522_000001",
  "partner_code": "photobooth_vendor_a",
  "order": {
    "id": "pos_order_uuid",
    "order_number": "POS-1777298006140",
    "outlet_id": "outlet_uuid",
    "paid_at": "2026-05-22T15:30:00Z",
    "amount": 50000,
    "currency": "IDR",
    "payment_method": "qris",
    "ark_coin_used": 0
  },
  "customer": {
    "id": "customer_uuid",
    "member_id": "crm_member_uuid",
    "name": "Customer Name",
    "phone": "081234567890",
    "email": "customer@example.com",
    "tier": "Bronze",
    "current_xp": 1500
  },
  "photobooth": {
    "product_id": "pos_product_uuid",
    "product_name": "Photobooth Basic",
    "quantity": 1,
    "session_token": "one_time_session_token",
    "session_token_expires_at": "2026-05-22T16:00:00Z"
  },
  "metadata": {
    "source": "ark_pos",
    "environment": "production"
  }
}
```

Expected partner response:

```json
{
  "success": true,
  "partner_session_id": "PB-SESSION-000001",
  "status": "ready",
  "message": "Photobooth session created"
}
```

Jika partner gagal menerima event:

```json
{
  "success": false,
  "error_code": "BOOTH_OFFLINE",
  "message": "Selected booth is offline"
}
```

ARK perlu menyimpan status dispatch dan menyiapkan retry.

### 4. Inbound Callback Dari Partner

Partner akan mengirim callback ke ARK setelah session photobooth selesai.

Rencana endpoint ARK:

```http
POST /api/crm/integrations/photobooth/callback
```

Event wajib:

```text
photobooth.session_completed
```

Event opsional:

```text
photobooth.session_started
photobooth.session_failed
photobooth.session_cancelled
photobooth.session_expired
```

Contoh payload session completed:

```json
{
  "event": "photobooth.session_completed",
  "event_id": "pb_evt_000001",
  "partner_code": "photobooth_vendor_a",
  "partner_session_id": "PB-SESSION-000001",
  "order_id": "pos_order_uuid",
  "order_number": "POS-1777298006140",
  "customer_id": "customer_uuid",
  "member_id": "crm_member_uuid",
  "outlet_id": "outlet_uuid",
  "status": "success",
  "completed_at": "2026-05-22T15:45:00Z",
  "photobooth": {
    "booth_id": "BOOTH-01",
    "template_id": "TEMPLATE-01",
    "media_count": 4,
    "print_count": 1,
    "preview_url": "https://partner.example.com/preview/PB-SESSION-000001"
  },
  "metadata": {
    "duration_seconds": 180
  }
}
```

Expected ARK response:

```json
{
  "success": true,
  "processing_status": "processed",
  "xp_awarded": 100,
  "xp_ledger_id": "crm_xp_ledger_uuid"
}
```

Jika event sudah pernah diproses:

```json
{
  "success": true,
  "processing_status": "ignored",
  "reason": "duplicate_event"
}
```

Jika payload tidak valid:

```json
{
  "success": false,
  "error": "Invalid signature"
}
```

## Authentication & Signature

Semua request antar sistem harus memakai signature.

Header dari ARK ke partner:

```http
X-ARK-Partner-Code: photobooth_vendor_a
X-ARK-Timestamp: 2026-05-22T15:30:00Z
X-ARK-Event-Id: ark_evt_20260522_000001
X-ARK-Signature: sha256=<hmac_signature>
Content-Type: application/json
```

Header dari partner ke ARK:

```http
X-Partner-Code: photobooth_vendor_a
X-Partner-Timestamp: 2026-05-22T15:45:00Z
X-Partner-Event-Id: pb_evt_000001
X-Partner-Signature: sha256=<hmac_signature>
Content-Type: application/json
```

Signature formula:

```text
HMAC_SHA256(secret, timestamp + "." + event_id + "." + raw_json_body)
```

Validasi ARK:

- partner code aktif
- timestamp tidak lebih dari 5 menit
- signature valid
- event type diizinkan
- `event_id` belum pernah diproses untuk partner tersebut

## Idempotency

Partner wajib mengirim `event_id` yang unik dan stabil untuk event yang sama.

Contoh idempotency key:

```text
photobooth:photobooth_vendor_a:PB-SESSION-000001:completed
```

ARK akan menyimpan event di `crm_external_events`.

Jika partner retry dengan `event_id` yang sama, ARK tidak akan memberi XP ulang.

## XP Rule

XP photobooth diatur dari `crm_xp_rules`.

Rule default yang sudah disiapkan:

- `source_channel`: `photobooth`
- `source_type`: `purchase_completed`
- nilai XP mengikuti konfigurasi rule

Rekomendasi rule:

```text
photobooth.session_completed = fixed XP per successful session
```

Contoh:

- Basic photobooth: 100 XP
- Premium photobooth: 250 XP
- Event campaign: 2x multiplier lewat campaign rule

XP hanya diproses jika:

- callback partner valid
- status session `success`
- customer/member ditemukan
- event belum pernah diproses
- rule XP aktif

## Status Mapping

Partner harus menggunakan status berikut:

| Partner Status | ARK Processing | XP |
| --- | --- | --- |
| `success` | `processed` | Award XP |
| `failed` | `failed` atau `ignored` | No XP |
| `cancelled` | `ignored` | No XP |
| `expired` | `ignored` | No XP |

## Retry Policy

Partner disarankan retry callback jika ARK memberi response non-2xx atau timeout.

Rekomendasi retry:

- Retry 1: 30 detik
- Retry 2: 2 menit
- Retry 3: 10 menit
- Retry 4: 30 menit
- Stop setelah 24 jam

ARK akan menjaga idempotency, jadi retry aman selama `event_id` tetap sama.

## Timeout & Session Token

ARK akan mengirim `session_token` yang hanya boleh dipakai satu kali.

Rekomendasi:

- Token expired dalam 15-30 menit.
- Token terikat ke `order_id`, `customer_id`, dan `partner_code`.
- Partner menolak token expired atau token yang sudah dipakai.

## Checklist Untuk ARK

- Buat UI/API partner registry.
- Simpan secret partner dengan aman.
- Buat dispatcher payment success dari POS ke partner.
- Buat API callback `/api/crm/integrations/photobooth/callback`.
- Implement HMAC signature verification.
- Implement idempotency ke `crm_external_events`.
- Implement XP award dari callback `session_completed`.
- Buat event log page untuk admin CRM.
- Buat retry queue untuk outbound payment success.
- Buat monitoring failed event.

## Checklist Untuk Partner

- Siapkan endpoint untuk menerima `photobooth.payment_success`.
- Validasi signature dari ARK.
- Buat session photobooth berdasarkan `session_token`.
- Return `partner_session_id` ke ARK.
- Kirim callback `photobooth.session_completed` setelah foto sukses.
- Gunakan `event_id` yang unik dan stabil.
- Implement retry webhook dengan `event_id` yang sama.
- Jangan memberi akses photobooth tanpa payment success dari ARK.
- Jangan mengirim `session_completed` lebih dari satu event id untuk session yang sama.
- Berikan dokumentasi error code:
  - booth offline
  - token expired
  - token already used
  - session failed
  - media processing failed

## Minimal Data Yang Harus Disepakati

Sebelum integrasi dimulai, ARK dan partner harus menyepakati:

- `partner_code`
- shared secret untuk HMAC
- URL endpoint partner
- URL callback ARK
- daftar outlet dan booth mapping
- daftar produk photobooth di POS
- masa berlaku session token
- XP rule per produk/session
- retry policy
- environment:
  - sandbox
  - production

## Development Phases

### Phase A - Contract & Sandbox

- Finalisasi payload.
- Partner registry sandbox.
- Mock endpoint partner.
- Callback endpoint ARK.
- Test signature.

### Phase B - POS Payment Dispatch

- POS payment sukses mendeteksi item photobooth.
- ARK kirim `photobooth.payment_success`.
- Partner create session.
- ARK simpan dispatch result.

### Phase C - Session Completed Callback

- Partner kirim `photobooth.session_completed`.
- ARK validasi event.
- ARK update XP.
- ARK update `crm_external_events`.

### Phase D - Monitoring

- Event log page.
- Retry failed dispatch.
- Failed callback visibility.
- Manual reprocess untuk admin.

## Catatan Implementasi

Fondasi database sudah tersedia:

- `crm_integration_partners`
- `crm_external_events`
- `crm_xp_rules`
- `crm_xp_ledger`
- `crm_member_profiles`
- `pos_customers`

Endpoint dan UI integrasi photobooth belum final, tetapi dokumen ini bisa langsung diberikan ke partner agar mereka tahu kontrak teknis yang akan dibutuhkan.
