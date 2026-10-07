# EPIC-028 — Sistem Season Pass & Membership Ticketing (Dokumentasi Teknis Holistik)

> Dokumen ini merangkum **keseluruhan sistem** modul _Season Pass_ (pass masuk
> berlaku) yang dibangun di EPIC-028: arsitektur, model data, alur end-to-end,
> inventaris teknis, keputusan desain, dan status.
> Companion dari epic utama [`EPIC-028-ticketing-season-pass.md`](./EPIC-028-ticketing-season-pass.md).
> Bagian dari cluster Ticketing bersama [`EPIC-023`](./EPIC-023-ticketing-theme-park.md)
> (fondasi: produk, gate, band, booking, Xendit, WA) dan [`EPIC-024`](./EPIC-024-pos-customer-display.md).
>
> **Status:** TUNTAS MVP A–C + Fase D sebagian (D2 renewal/reminder ✅, D1 benefit FONDASI) → `ready-for-qa`
> · **Environment:** dev (PM2 port 3459) · **Terakhir diperbarui:** 2026-07-25

---

## 1. Ringkasan Eksekutif

Modul ini menambah **Season Pass** pada Ticketing: pengunjung membeli **pass masuk
berlaku** sekali (mis. annual pass), lalu bisa masuk berulang selama masa berlaku
tanpa beli tiket harian. Menutup gap terbesar vs benchmark _accesso_ (Passport/
Siriusware) dan mendorong **recurring revenue + retensi**. Alur lengkapnya:

```
Produk Season Pass (config) → Jual (Loket / Online-Xendit) → Terbit pass + QR →
    → Validasi masuk di GATE (per kebijakan entry) → Log entry
                    │
       ┌────────────┼────────────────────────┐
       ▼            ▼                          ▼
   Renewal      Reminder WA               Benefit member
  (loket)      (≤14 hari)              (diskon POS, FONDASI)
```

Keputusan arsitektural inti: **BUKAN modul baru** — season pass **merangkai**
infrastruktur Ticketing (EPIC-023) yang sudah ada (produk, gate, band NFC, booking,
Xendit, WA) lewat **jenis produk ketiga `season_pass`** + **jalur pass yang terpisah
dari booking harian** (field jual/bayar & validasi entry milik pass sendiri, agar
TIDAK ada regresi pada tiket harian).

---

## 2. Konteks & Keputusan Owner (2026-07-24)

| Keputusan | Isi |
|-----------|-----|
| **Merangkai, jangan greenfield** | Reuse `ticket_products` (jenis ke-3 `season_pass`), `ticket_bands` (NFC opsional), jalur Xendit + WA dari booking. |
| **Masa berlaku = ROLLING dari pembelian** | Tiap pass punya `valid_from` → `valid_until` sendiri; durasi (bulan) per produk (`validity_months`). |
| **Kebijakan entry CONFIGURABLE per produk** | Tiga tipe hidup berdampingan: `once_per_day` (maks 1×/hari) · `unlimited` (bebas) · `limited_visits` (punch-card `visit_quota`). |
| **Media = QR utama + gelang NFC opsional** | QR (`access_token`) identitas utama; boleh ditautkan ke `ticket_bands` untuk tap. Foto verifikasi = fase lanjut. |
| **MVP = entry-only** | Benefit diskon member, renewal, cicilan, foto, guest pass, portal pemegang = fase lanjut. |
| **Jalur pass TERPISAH dari booking harian** | Field jual/bayar & validasi entry milik pass sendiri; TIDAK menyentuh `ticket_bookings`/`gate/tap` → 0 regresi. |
| **CRM member tak dikopel di MVP** | `customer_id` opsional (null); tautan CRM = fase lanjut. |
| **Fase D (2026-07-25): controller gate + wiring cashier benefit + laporan omzet = digarap di PR** | Jalur uang/checkout tak aman diubah buta — wajib review + E2E. |

---

## 3. Arsitektur

### 3.1 Jenis produk ketiga `season_pass`

`ticketing.ticket_products.product_kind` diperluas: `single | bundle | **season_pass**`.
Produk pass punya baris **1:1** di `ticket_pass_configs` (validity, entry_policy,
kuota, diskon member) + satu **varian "Umum"** penampung harga (reuse mekanisme harga
varian yang ada). Membuat produk pass = buat product + config + varian dalam satu POST.

### 3.2 Jalur pass vs jalur booking harian (pemisahan tegas)

Poin arsitektur terpenting: season pass **memakai ulang komponen infrastruktur**
Ticketing, TAPI **jalur transaksinya terpisah** agar tak ada regresi:

| Aspek | Jalur booking harian (EPIC-023) | **Jalur pass (EPIC-028)** |
|-------|--------------------------------|---------------------------|
| Header transaksi | `ticket_bookings` | `ticket_season_passes` (field jual/bayar sendiri) |
| Endpoint gate | `POST /api/ticketing/gate/tap` | `POST /api/ticketing/gate/pass-tap` (TERSENDIRI) |
| Webhook Xendit | prefix invoice booking | prefix `tkt-pass-` (cabang di webhook yang sama) |
| Media | band/booking QR | `access_token` (QR) + `pass_code` + NFC opsional |

**Reuse (bersama):** `ticket_products`, `ticket_bands`, `ticket_product_dates`
(blackout, `date_kind='blackout'`), gateway WA, generator `access_token` opaque.

### 3.3 Peta layer

```
UI publik (/pass/[slug], /pass/status/[token])   — beli & status (allowlisted di proxy)
UI dashboard (/dashboard/ticketing/passes, /gate-pass, /mapping)
   └─ Feature (season-passes/* + booking-public/pass-purchase, pass-status-page)
       └─ API route (/api/ticketing/season-passes/*, /gate/pass-tap,
                     /api/public/booking/[slug]/pass(es), /pass-status, /api/pos/pass-lookup)
           └─ lib/ticketing/season-pass.ts (validity, kode) · pass-wa.ts (QR via WA)
               └─ PostgreSQL schema `ticketing` (+ iam untuk menu/role)
```

---

## 4. Model Data (schema `ticketing`)

Tiga tabel baru (migrasi `20260724160000`). Semua ber-scope `company_id`+`branch_id`.

### 4.1 `ticket_pass_configs` — konfigurasi produk pass (1:1 produk)

| Kolom | Tipe | Catatan |
|-------|------|---------|
| `ticket_product_id` | uuid, **UNIQUE**, FK→products (ON DELETE CASCADE) | 1:1 dgn produk kind `season_pass` |
| `validity_months` | int, default 12, CHECK `>0` | durasi rolling |
| `entry_policy` | text CHECK `once_per_day\|unlimited\|limited_visits` | kebijakan masuk |
| `visit_quota` | int null | **XOR quota**: wajib>0 bila `limited_visits`, wajib NULL selainnya |
| `member_discount_percent` | numeric(5,2), default 0, CHECK 0–100 | Fase D1 (benefit member) |
| `is_active` + audit | | |

> **Constraint kunci** `ticket_pass_configs_quota_check`: `(limited_visits AND quota>0) OR (≠limited_visits AND quota IS NULL)` — memaksa konsistensi kuota di level DB.

### 4.2 `ticket_season_passes` — pass terbit (per pemegang)

| Kelompok | Kolom |
|----------|-------|
| Identitas | `pass_code` (UNIQUE, `SP-YYYYMMDD-####`), `access_token` (UNIQUE, opaque 64hex — QR/portal) |
| Pemegang | `holder_name`, `holder_phone`, `holder_photo_url` (null MVP) |
| Berlaku | `valid_from date`, `valid_until date`, `status` (`pending\|active\|expired\|suspended\|cancelled`) |
| **Snapshot kebijakan** | `entry_policy`, `visit_quota_total`, `visit_quota_used` (default 0) — di-_snapshot_ saat terbit agar perubahan config tak mengubah pass lama |
| NFC opsional | `band_id` (FK→bands, ON DELETE SET NULL), `band_uid` |
| Penjualan | `source` (`loket\|online`), `unit_price`, `xendit_invoice_id/url`, `payment_expires_at`, `paid_at`, `activated_at` |
| CRM (lanjut) | `customer_id` uuid null |

Index: scope `(company,branch)`, `band_uid` (partial), `status`, `xendit_invoice_id` (partial).

### 4.3 `ticket_pass_entries` — log masuk (audit + enforcement)

| Kolom | Catatan |
|-------|---------|
| `season_pass_id` | FK→passes (ON DELETE CASCADE) |
| `entry_date` | default CURRENT_DATE |
| `entry_policy` | **snapshot** (agar unique once/day bisa dibatasi di DB) |
| `gate_label`, `band_uid` | konteks tap |
| `result` | CHECK `granted\|denied_expired\|denied_duplicate\|denied_quota\|denied_inactive\|denied_blackout` |

> **Anti-race kunci** — unique partial index `uq_pass_entries_once_per_day` pada
> `(season_pass_id, entry_date) WHERE result='granted' AND entry_policy='once_per_day'`:
> menjamin **maks 1 entry granted per (pass, tanggal)** untuk pass `once_per_day`
> **di level DB**, bukan hanya cek aplikasi. `unlimited` bebas; `limited_visits`
> dibatasi kuota, bukan per-hari.

Blackout **reuse** `ticket_product_dates` (`date_kind='blackout'`), tanpa skema baru.

---

## 5. Alur End-to-End

### 5.1 Diagram status pass

```
buat produk pass (config) ──► JUAL
   ├─ Loket:  terbit langsung ──► status=active, valid_from=today, valid_until=+validity_months
   └─ Online: pending (Xendit invoice) ──webhook PAID (tkt-pass-)──► active,
                 valid_from=tgl bayar, valid_until=+validity_months, kirim QR via WA
                 └─ webhook EXPIRED ──► cancelled

active ──tap di gate/pass-tap──► validasi berlapis ──► granted / denied_*
active ──renew (loket)──► valid_until += validity_months dari MAX(today, valid_until); punch-card reset kuota
active & ≤14 hari ──► reminder WA ke holder (maybeSendPassExpiring)
valid_until terlewat ──► expired
```

### 5.2 Validasi gate (`POST /api/ticketing/gate/pass-tap`) — berlapis

Endpoint **tersendiri** (bukan entangle `gate/tap`). Input `code` = `access_token`
(QR) / `pass_code` (SP-…) / UID gelang NFC → `resolvePass()` dengan **`FOR UPDATE`**
(kunci baris) → validasi urut:

1. **status** ≠ active → `denied_inactive`
2. **masa berlaku** (`valid_from..valid_until`) → `denied_expired`
3. **blackout** (`ticket_product_dates` date_kind='blackout') → `denied_blackout`
4. **entry_policy**:
   - `once_per_day` — **check-first** (cek entry granted hari ini) + **unique index backstop**. Check-first dipakai karena error `23505` meracuni transaksi. → duplikat = `denied_duplicate`
   - `unlimited` — lolos
   - `limited_visits` — cek `visit_quota_used < total` lalu **increment transaksional** → habis = `denied_quota`
5. tulis `ticket_pass_entries` + kembalikan granted/denied + alasan.

### 5.3 Karakter tiap tahap

- **Jual loket** — `/dashboard/ticketing/passes`: pilih produk pass aktif, nama/HP pemegang, UID band opsional → pass `active` seketika (rolling), QR (`QRCodeSVG`) tampil. Band NFC divalidasi terdaftar.
- **Jual online** — `/pass/[slug]` (publik): katalog pass website-distributed → data pemegang → Xendit invoice (MOCK di dev). Halaman `/pass/status/[token]` polling: pending→tombol bayar; active→QR+masa berlaku; expired/cancelled→info.
- **Gate** — layar `/dashboard/ticketing/gate-pass` fullscreen HIJAU/MERAH, wedge auto-focus untuk reader QR/NFC + input manual; tampil nama pemegang, sisa kuota/masa berlaku, alasan tolak.
- **Renewal** — `POST /season-passes/[id]/renew`: `valid_until += validity_months` dari `MAX(today, valid_until)`; punch-card **reset kuota penuh**. Tombol "Perpanjang" di daftar pass.
- **Reminder** — `maybeSendPassExpiring` di notifications-watcher: WA ke `holder_phone` untuk pass berlaku ≤14 hari; klaim-dulu `wa_notif_log` (`notif_type='passExpiring'`), gated master WA + jam 8-21 WIB.
- **Benefit member (FONDASI)** — `GET /api/pos/pass-lookup`: cashier scan QR/pass_code/NFC → kembalikan `member_discount_percent` bila pass **active**. Wiring checkout cashier = DEFER ke PR.

---

## 6. Inventaris Teknis

### 6.1 Migrasi (`database/migrations/deltas/`)

| File | Fase | Isi |
|------|------|-----|
| `20260724160000_ticketing_season_pass.sql` | A1 | 3 tabel (`ticket_pass_configs`, `ticket_season_passes`, `ticket_pass_entries`) + `product_kind='season_pass'` + FK products/bands + unique once/day + index gate-lookup. |
| `20260724170000_ticketing_product_kind_widen.sql` | A2 | Lebarkan `product_kind` varchar(10)→(20) ('season_pass' = 11 char). |
| `20260724180000_ticketing_season_pass_menu.sql` | B1 | Menu `ticketing.passes` (grant super_admin/pos_supervisor/pos). |
| `20260724190000_ticketing_ticket_gate_cogs.sql` | tambahan | `ticket_products.has_gate bool` (default true) + `cogs numeric` (HPP → omzet kotor/bersih). |
| `20260724200000_ticketing_gate_mapping_menu.sql` | tambahan | Menu `ticketing.mapping` (Gate Mapping scaffold, super_admin). |
| `20260724210000_ticketing_gate_pass_menu.sql` | C2 | Menu `ticketing.gate_pass` (grant operator). |
| `20260724220000_season_pass_member_benefit.sql` | D1 | `ticket_pass_configs.member_discount_percent numeric(5,2)` (0–100). |

> Runner: `npm run db:migrate` (dry) / `db:migrate:apply`. Ledger `public.schema_migrations`
> pakai checksum — **JANGAN edit file migrasi setelah apply**. Tiap migrasi idempoten
> (`IF NOT EXISTS` + DO guard), atomik, target dev.

### 6.2 Route fisik

| Area | Route |
|------|-------|
| Dashboard — daftar/terbit pass | `src/app/dashboard/(dashboard)/ticketing/passes/` |
| Dashboard — gate pass | `.../ticketing/gate-pass/` |
| Dashboard — gate mapping (scaffold) | `.../ticketing/mapping/` |
| Publik — beli | `src/app/(public)/pass/[slug]/` |
| Publik — status/QR | `src/app/(public)/pass/status/[token]/` |

> Halaman publik `/pass/*` **di-allowlist** di `src/proxy.ts` (bukan `middleware.ts`).

### 6.3 API endpoint

| Endpoint | Peran |
|----------|-------|
| `POST/GET /api/ticketing/season-passes` | Terbitkan pass di loket (issue → active rolling) + list. |
| `GET /api/ticketing/season-passes/pass-options` | Produk pass aktif untuk dropdown loket. |
| `POST /api/ticketing/season-passes/[id]/renew` | Perpanjang (Fase D2). |
| `POST /api/ticketing/gate/pass-tap` | Validasi masuk berlapis (TERSENDIRI). |
| `GET /api/public/booking/[slug]/passes` · `POST .../pass` | Katalog + beli pass online (publik). |
| `GET /api/public/booking/pass-status/[token]` | Polling status pass online. |
| `GET /api/pos/pass-lookup` | Cashier scan → diskon member (Fase D1 fondasi). |

Webhook Xendit publik **diperluas** (bukan baru) dengan cabang prefix `tkt-pass-`.

### 6.4 Feature (`src/features/ticketing/`)

| Path | Peran |
|------|-------|
| `season-passes/components/season-passes-page.tsx` | Daftar pass + dialog "Terbitkan Pass" + QR result + tombol Perpanjang. |
| `season-passes/components/pass-gate-page.tsx` | Layar gate HIJAU/MERAH (wedge reader). |
| `season-passes/{api,queries,types,index}.ts` | Pemanggil endpoint + TanStack Query + tipe. |
| `booking-public/pass-purchase.tsx` | Halaman beli pass online. |
| `booking-public/pass-status-page.tsx` | Halaman status/QR polling. |

### 6.5 Lib inti (`src/lib/ticketing/`)

| File | Peran |
|------|-------|
| `season-pass.ts` | `PASS_ENTRY_POLICIES`/`PASS_STATUSES`, `addMonthsIso()` (rolling validity, aritmetika bulan UTC), `generatePassCode()` (SP-YYYYMMDD-#### dari MAX hari ini). QR/token reuse `generateAccessToken()` booking (opaque). |
| `pass-wa.ts` | `sendPassPaidWa()` — kirim QR via WA saat pass online terbayar; best-effort (gagal WA tak menggagalkan webhook). |

Reminder `maybeSendPassExpiring` berada di notifications-watcher (jalur WA notif owner, EPIC-020).

---

## 7. Pola & Keputusan Desain Kunci

1. **Jenis produk ke-3 `season_pass`, bukan modul baru** — reuse mesin produk/harga varian Ticketing.
2. **Jalur pass terpisah dari booking harian** — header, endpoint gate, & field bayar milik pass sendiri → **0 regresi** tiket harian.
3. **Endpoint gate TERSENDIRI** (`gate/pass-tap`) — tak entangle `gate/tap` (visit/band).
4. **Snapshot kebijakan di pass & entry** — `entry_policy`/`visit_quota_total` di-copy saat terbit, agar ubah config tak mengubah pass lama & agar unique once/day bisa dibatasi di DB.
5. **Anti-race once/day di level DB** — unique partial index, bukan sekadar cek aplikasi. Di route pakai **check-first** karena `23505` meracuni transaksi Postgres; unique index = backstop.
6. **Kuota transaksional + `FOR UPDATE`** — `limited_visits` cek+increment di bawah kunci baris → tak minus di race.
7. **XOR kuota di config** — constraint `(limited_visits AND quota>0) OR (else quota NULL)`.
8. **Rolling validity dari pembelian** — `valid_from`=hari terbit/bayar; `valid_until`=+`validity_months`. Renewal dari `MAX(today, valid_until)`.
9. **QR opaque, tak ter-enumerasi** — `access_token` 64hex (reuse generator booking); `pass_code` `SP-…` untuk manusia.
10. **Blackout reuse `ticket_product_dates`** — tanpa skema baru.
11. **Media QR utama + NFC opsional** — `band_id`/`band_uid` nullable, FK ON DELETE SET NULL.
12. **Jalur uang di-DEFER ke PR** — wiring cashier benefit + controller gate riil + laporan omzet tak diubah buta (perlu review + E2E).

---

## 8. Perbedaan vs Jalur Booking Harian (EPIC-023)

| Aspek | Booking harian | **Season Pass** |
|-------|----------------|-----------------|
| Header | `ticket_bookings` | `ticket_season_passes` |
| Produk | `single` / `bundle` | `season_pass` (+ `ticket_pass_configs`) |
| Masa pakai | 1 hari kunjungan | rolling `validity_months`, masuk berulang |
| Kebijakan masuk | per booking | `once_per_day` / `unlimited` / `limited_visits` |
| Endpoint gate | `gate/tap` | `gate/pass-tap` |
| Prefix webhook | booking | `tkt-pass-` |
| Renewal | — | ✅ (loket) |
| Reminder WA | — | ✅ (≤14 hari, holder) |

---

## 9. Status & Fase Lanjut

**TUNTAS:** A (skema + master config) · B1 (loket) · B2 (online Xendit + WA) ·
C1 (validasi gate berlapis) · C2 (layar gate) · **D2 (renewal + reminder)** →
**ready-for-qa**. Tambahan owner: `has_gate` + COGS per ticket, Gate Mapping scaffold.

**Fase lanjut (backlog):**
- **D1 wiring cashier benefit** — fondasi ada (`member_discount_percent` + `pos/pass-lookup`); alirkan `discountAmount` ke 3 builder payload + CFD → **PR** (jalur uang, wajib review + E2E).
- **Controller gate riil** — Gate Mapping baru scaffold; koneksi controller fisik menyusul.
- **Laporan omzet kotor/bersih** — snapshot COGS saat sale/tap.
- Cicilan/payment plan · foto verifikasi · guest pass · portal pemegang · UI blackout date · tautan CRM `customer_id`.

---

## 10. Riwayat Commit (branch `development`)

| Commit | Isi |
|--------|-----|
| `20b2681` | Fase A — skema Season Pass (3 tabel + `product_kind` season_pass + unique once/day). |
| `f3e3041` | A2 — master produk pass (dialog buat + config + varian Umum) + widen product_kind. |
| `2b7b54d` | B1 — terbitkan pass di loket + QR. |
| `c51db38` | B2 — jual pass online (Xendit + WA QR). |
| `caeeb54` | Tambahan — flag `has_gate` per ticket + COGS/HPP per ticket. |
| `2f2d9af` | Fase C — validasi gate `pass-tap` + Gate Mapping scaffold. |
| `5097e2f` | Fase D — renewal + reminder pass + fondasi benefit member. |

---

## 11. Catatan Operasional

- **App dev:** PM2 `arkiv-pos-saas` → `next start -p 3459` (**production build**). Ubah kode → `npm run build` + `pm2 restart arkiv-pos-saas`.
- **Urutan build vs restart:** `pm2 restart` **setelah** `npm run build`; cek `.next/BUILD_ID` ada sebelum restart (build|tail bisa menelan exit code).
- **`ignoreBuildErrors`:** build hijau ≠ runtime aman. Setelah perubahan besar, jalankan `npx tsc --noEmit` & diff error BARU vs baseline.
- **Routing edge:** halaman publik `/pass/*` wajib di-allowlist di **`src/proxy.ts`** (bukan `middleware.ts`).
- **Xendit MOCK aktif di dev** — webhook PAID/EXPIRED disimulasikan; produksi butuh kredensial riil.
- **Smoke non-auth:** route dashboard terproteksi balas `307` (redirect login) / `401`, bukan `200` — itu normal. Route publik `/pass/<slug>` balas `200`.
- **Push:** `git -c credential.helper='store --file=~/.git-credentials-arkiv' push origin development`.
