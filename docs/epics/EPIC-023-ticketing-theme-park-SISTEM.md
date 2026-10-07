# EPIC-023 — Sistem Ticketing Theme Park (Dokumentasi Teknis Holistik)

> Dokumen ini merangkum **keseluruhan sistem** modul _Ticketing Theme Park_ yang
> dibangun di EPIC-023: arsitektur, model data (~21 tabel), alur end-to-end,
> inventaris teknis, keputusan desain, dan batas dengan POS.
> Companion dari epic utama [`EPIC-023-ticketing-theme-park.md`](./EPIC-023-ticketing-theme-park.md).
> Bagian dari cluster Ticketing bersama [`EPIC-028` Season Pass](./EPIC-028-ticketing-season-pass-SISTEM.md)
> (dibangun di atas fondasi produk/gate/band/booking/Xendit/WA di dokumen ini) dan
> [`EPIC-024` POS Customer Display](./EPIC-024-pos-customer-display.md).
>
> **Status:** TUNTAS fase A–E + R1/R2 + D + P → `ready-for-qa` · **Environment:** dev
> (PM2 port 3459) · **Terakhir diperbarui:** 2026-07-25

---

## 1. Ringkasan Eksekutif

Modul ini menjalankan **operasi ticketing theme park** end-to-end atas tiga pilar:
**NFC postpaid** (gelang jadi tab akrual dalam venue), **harga musiman** (regular/high
per produk & kanal), dan **channel manager** (distribusi produk ke walk-in vs website).
Reuse infra POS/NFC/Xendit (~70%). Schema `ticketing.*` = domain terbesar di repo.

```
Registrasi loket (band → visit) ──► Gate tap: charge tiket ke tab
                                          │
        F&B di dalam (POS "NFC Tab") ─────┤ tagihan pindah jadi charge di tab
                                          ▼
                 Settlement kasir keluar: bayar total tab (tiket + F&B + penalti)
                                          │
  Jalur online:  Website booking (Xendit prepaid) ──► redeem gelang di loket
                     └─ tak di-redeem ──► hangus (forfeit configurable) → revenue diakui
```

Keputusan arsitektural inti: **Ticket = produk** (revisi R1) — master berbasis
`ticket_products` + varian ber-harga musiman, bukan master flat per venue. **Gelang =
aset venue berputar** (BEDA dari identitas member). **Tab = ledger dua arah** (debit
tiket/F&B/denda vs kredit deposit/refund/pembayaran).

---

## 2. Konteks & Keputusan Owner

| Keputusan | Isi |
|-----------|-----|
| **Ticket sebagai Produk** (R1, 2026-07-21) | Master flat Fase A (jenis tiket + kalender venue + matriks harga) DIGANTI produk `ticket_products` + varian (Adult/Child) ber-2 harga (Regular & High), kalender & kebijakan per produk. |
| **Harga eksplisit, tanpa hitungan tersembunyi** | Tiap varian punya kolom harga Regular & High Season terpisah; override per kanal opsional. Harga kosong → **WAJIB tolak transaksi**, jangan menebak. |
| **High season menang saat overlap** | Resolver musim: high menang bila rentang tanggal tumpang tindih; default regular. TANPA auto-weekend. |
| **Credit limit & mode bayar = per VENUE, bukan produk** | `ticket_settings` per branch (melekat ke tab kunjungan). Re-entry policy = per produk (R1). |
| **Gelang = aset venue** | `ticket_bands` (nfc_uid unik per venue, status berputar tersedia/dipakai/hilang/rusak) — bukan identitas member. |
| **Settlement di POS, tiket tetap di Ticketing** | Lihat [§8 Batas Ticketing ↔ POS](#8-batas-ticketing--pos). |
| **Semua keputusan owner TUTUP (2026-07-22)** | Gelang hilang **tanpa denda** (settle by data), varian tunggal **"Umum"** boleh, venue fleksibel, alert webhook di dashboard Booking. |
| **Revenue booking = titipan-sampai-redeem + hangus configurable** (2026-07-23) | `booking_forfeit_days` per venue (NULL=tak hangus); watcher tiap jam → `hangus` + `forfeited_at` untuk pengakuan revenue. |

---

## 3. Arsitektur

### 3.1 Model produk (revisi R1)

```
ticket_categories        -- master kategori (autocomplete, auto-add)
ticket_products          -- Ticket = produk (kode TKT-####, base_price, thumbnail, status)
  └─ ticket_product_variants     -- Adult/Child; 2 kolom harga: price_regular, price_high
  └─ ticket_product_dates        -- kalender: date_kind 'high-season' | 'blok-online' | 'blackout'
  └─ ticket_product_channels     -- distribusi ke POS(walk-in) / website
       └─ ticket_variant_channel_prices  -- override harga per (varian × kanal × musim); kosong=ikut varian
```

Resolver harga v2 (`pricing.ts`): `(ticket, varian, tanggal, kanal)` → musim dari
kalender produk (high menang overlap) → `override kanal[musim] ?? harga varian[musim]`;
tanggal `blok-online` + kanal website → **ditolak**; harga kosong → null (tolak).

> Tabel Fase A lama `ticket_types` / `ticket_prices` (matriks flat tipe×season×channel)
> = **legacy** — digantikan model produk R1. Masih ada di schema tapi bukan jalur aktif.

### 3.2 Tab sebagai ledger dua arah

`ticket_visit_charges` = ledger append-only per visit:

- **Debit**: `tiket` · `fnb` · `denda` · `koreksi`
- **Kredit**: `deposit` · `refund-deposit` · `pembayaran`
- Saldo/total tagihan = **agregat ledger**, bukan kolom running. Postpaid: `debit − kredit ≤ credit_limit`; prepaid: `kredit − debit ≥ 0`.
- `price_context` (jsonb) menyimpan snapshot type/season/channel saat resolve; `voided_by_charge_id` untuk void supervisor (baris pembalik).

### 3.3 Peta layer

```
UI publik (/booking, /booking/[slug], /booking/status/[token])  — allowlisted di proxy
UI dashboard (/dashboard/ticketing/{tickets,channel-manager,loket,gate,settings,booking,reports})
   └─ Feature (masters / products / visits / bookings / booking-public / reports)
       └─ API route (/api/ticketing/*, /api/public/booking/*)
           └─ lib/ticketing/{pricing,tab,booking,bundle}(+ -server, .test) · booking-forfeit-watcher
               └─ PostgreSQL schema `ticketing` (+ pos_* untuk integrasi tab, iam untuk menu/role)
```

Tiap engine punya tiga file: `*.ts` (murni, teruji), `*-server.ts` (query DB), `*.test.ts` (unit).

---

## 4. Model Data (schema `ticketing`)

Dikelompokkan per sub-sistem. Semua ber-scope `company_id`+`branch_id` + audit.

### 4.1 Produk & harga (R1)
| Tabel | Peran |
|-------|-------|
| `ticket_categories` | Master kategori produk (autocomplete). |
| `ticket_products` | Ticket sebagai produk (kode `TKT-####`, base_price acuan, thumbnail, status draft/active, **`has_gate`**, **`cogs`**). |
| `ticket_product_variants` | Varian (Adult/Child/Umum) + `price_regular` & `price_high`. |
| `ticket_product_dates` | Kalender per produk: `date_kind` = `high-season` \| `blok-online` \| `blackout`. |
| `ticket_product_channels` | Distribusi produk → kanal (POS/website). |
| `ticket_variant_channel_prices` | Override harga per (varian × kanal × musim). |
| `ticket_seasons`, `ticket_channels` | Master musim & kanal (`is_online`). |
| `ticket_types`, `ticket_prices` | **Legacy** Fase A (matriks flat) — digantikan R1. |

### 4.2 Visit / NFC tab (core)
| Tabel | Peran |
|-------|-------|
| `ticket_bands` | Gelang NFC (nfc_uid unik/venue, status tersedia/dipakai/hilang/rusak). Aset venue. |
| `ticket_visits` | Grup kunjungan: `payment_mode` (postpaid/prepaid), status (open/settled/void), `credit_limit`, `customer_id`/`booking_id` nullable, `opened_at`/`settled_at`. |
| `ticket_visit_bands` | Pairing visit × band + `ticket_type_id` + `entered_at`; status per gelang. |
| `ticket_visit_charges` | **Ledger tab dua arah** (§3.2): debit/kredit, `pos_order_id`, `price_context`, `voided_by_charge_id`. |
| `ticket_gate_events` | Log tap gate append-only (band_uid, result masuk/ditolak-…, traffic). |
| `ticket_settings` | Konfigurasi per branch: `default_credit_limit`, `default_payment_mode`, re-entry, `booking_forfeit_days`. |

### 4.3 Booking publik
| Tabel | Peran |
|-------|-------|
| `ticket_bookings` | `booking_code` unik, `booking_slug`, channel, visit_date, kontak, status (`menunggu-bayar`/`terbayar`/`digunakan`/`hangus`/`dibatalkan`), `total_amount`, `xendit_*`, `expires_at`, `forfeited_at`, `visit_id`. |
| `ticket_booking_items` | Baris pesanan (ticket_type/varian, qty, unit_price). |
| `ticket_booking_guests` | Rombongan bernama (nama per unit tiket, pairing gelang saat redeem). |

### 4.4 Bundle & staff
| Tabel | Peran |
|-------|-------|
| `ticket_bundle_items` | Paket sesama tiket (Fase P); alokasi harga prorata net-0. |
| `ticket_staff_passes` | Gelang karyawan free-access; gate lolos **tanpa charge**. |

> **Season Pass** (`ticket_pass_configs` / `ticket_season_passes` / `ticket_pass_entries`)
> = milik EPIC-028, didokumentasikan di [companion-nya](./EPIC-028-ticketing-season-pass-SISTEM.md).

---

## 5. Alur End-to-End

### 5.1 Jalur walk-in (dalam venue)
1. **Registrasi loket** (`/ticketing/loket`, ala POS) — pilih produk via card, atur qty, tap NFC per slot → buat `ticket_visit` + pairing band. Rombongan bernama opsional.
2. **Gate tap masuk** (`/ticketing/gate`, fullscreen HIJAU/MERAH, reuse `pos-nfc-shell`) — tap pertama → **charge tiket** ke tab (harga hasil resolve). Tap ulang per re-entry policy. Gelang tak dikenal/settled/hilang → merah + alasan. Semua tap → `ticket_gate_events`.
3. **F&B di dalam** — di kasir POS existing, metode **"NFC Tab"** → order lunas kasir (`pos_split_payments` method `nfc_tab`), tagihan pindah jadi charge `fnb` di tab (ref `pos_order_id`). Guard: postpaid ≤ credit limit, prepaid saldo cukup.
4. **Settlement keluar** (`/ticketing/loket` exit) — tap/cari → rincian tagihan (tiket per kepala + F&B + penalti); settle per gelang atau serombongan. Postpaid: bayar total via layar POS. Prepaid: sisa deposit refund / bayar selisih. Sukses → visit `settled`, band `tersedia`.

### 5.2 Jalur online (website booking)
1. **Booking publik** (`/booking/[slug]`, single-page ala tiket.com) — pilih tanggal → resolve musim → pilih produk + qty varian → data pemesan → **Xendit prepaid**.
2. **Webhook Xendit** (`/api/public/booking/webhook/xendit`) — verifikasi `x-callback-token`, idempoten `UPDATE ... WHERE status='menunggu-bayar'`, cek nominal → `terbayar` + kirim **kode booking + QR** via WA. Halaman `/booking/status/[token]`.
3. **Redeem di loket** — booking `terbayar` → buat visit **prepaid net-0** (tiket sudah dibayar), pairing gelang → `digunakan`.
4. **Hangus** — tak di-redeem sampai `booking_forfeit_days` → `booking-forfeit-watcher.ts` (tiap jam) set `hangus` + `forfeited_at` → revenue titipan diakui.

---

## 6. Inventaris Teknis

### 6.1 Migrasi (`database/migrations/deltas/`) — 14 delta EPIC-023

| File | Fase | Isi |
|------|------|-----|
| `20260722060000_ticketing_fase_a.sql` | A | Skema awal (types/seasons/channels/prices flat + bands + settings). |
| `20260722070000_ticketing_fase_b.sql` | B | Visit core: visits, visit_bands, visit_charges (ledger), gate_events. |
| `20260722080000_ticketing_fase_c.sql` | C | Integrasi POS `nfc_tab` (F&B numpang tab). |
| `20260722100000_ticketing_fase_r1.sql` | R1 | **Ticket sebagai Produk**: categories, products, variants, product_dates, channels, variant_channel_prices. |
| `20260722110000_ticketing_fase_r2.sql` | R2 | Channel Manager (distribusi + override harga). |
| `20260722130000_ticketing_fase_d1_booking.sql` | D | Website booking: bookings + booking_items. |
| `20260722150000_ticketing_fase_d5_booking_menu.sql` | D | Menu kelola booking. |
| `20260722170000_ticketing_booking_guests.sql` | D | Rombongan bernama. |
| `20260722180000_ticketing_fase_p_bundle.sql` | P | Ticket bundling (bundle_items). |
| `20260722190000_ticketing_fase_e_reports_menu.sql` | E | Menu laporan. |
| `20260722200000_ticketing_staff_passes.sql` | E-ops | Gelang karyawan free access. |
| `20260722210000_ticketing_lost_band_webhook_alert.sql` | ops | Alert webhook gelang hilang. |
| `20260722220000_ticketing_booking_menu_loket.sql` | ops | Loket akses menu Booking read-only. |
| `20260723090000_ticketing_booking_hangus.sql` | ops | Forfeit configurable (`booking_forfeit_days`, `forfeited_at`). |

> Runner: `npm run db:migrate` (dry) / `db:migrate:apply`. Ledger `public.schema_migrations`
> pakai checksum — **JANGAN edit file migrasi setelah apply**.

### 6.2 Route fisik

| Area | Route |
|------|-------|
| Master ticket | `/dashboard/ticketing/tickets/`, `/tickets/[id]` (Tabs: Info & Varian · Kalender · Kebijakan) |
| Channel Manager | `/ticketing/channel-manager/` |
| Loket (registrasi + settlement) | `/ticketing/loket/` |
| Gate (tap masuk) | `/ticketing/gate/` |
| Settings venue | `/ticketing/settings/` |
| Kelola booking | `/ticketing/booking/` |
| Laporan | `/ticketing/reports/` |
| Publik | `/booking`, `/booking/[slug]`, `/booking/status/[token]` |

> `gate-pass`, `passes`, `mapping` = EPIC-028/gate-flag (lihat companion 028).

### 6.3 Feature (`src/features/ticketing/`)

| Folder | Peran |
|--------|-------|
| `masters/` | Master pendukung (kategori, kanal, settings). |
| `products/` | Master Ticket sebagai produk (Tabs varian/kalender/kebijakan + channel manager). |
| `visits/` | Loket registrasi, gate, settlement (tab). |
| `bookings/` | Kelola booking di dashboard. |
| `booking-public/` | Halaman publik: `booking-wizard.tsx`, `booking-calendar.tsx`, `booking-status-page.tsx`. |
| `reports/` | Laporan traffic/revenue/tab (net-void). |

### 6.4 Lib inti (`src/lib/ticketing/`)

| File | Peran |
|------|-------|
| `pricing.ts` / `-server.ts` / `.test.ts` | Resolver harga v2 (musim + override kanal; tolak bila kosong/blok-online). |
| `tab.ts` / `-server.ts` / `.test.ts` | Ledger tab (debit/kredit, saldo agregat, guard credit limit/saldo). |
| `booking.ts` / `-server.ts` / `.test.ts` | Booking publik (kode, status, redeem net-0). |
| `bundle.ts` / `-server.ts` / `.test.ts` | Ticket bundling (alokasi prorata net-0). |
| `booking-wa.ts` | Kirim kode+QR booking via WA. |
| `booking-forfeit-watcher.ts` | Watcher hangus (tiap jam → `hangus` + `forfeited_at`). |
| `server.ts` | Helper query bersama. |

### 6.5 API endpoint (inti)

| Endpoint | Peran |
|----------|-------|
| `/api/public/booking/[slug]/catalog` | Katalog produk website-distributed + resolve harga per tanggal. |
| `/api/public/booking/[slug]` (POST) | Buat booking + Xendit invoice. |
| `/api/public/booking/status/[token]` | Polling status booking. |
| `/api/public/booking/webhook/xendit` | Webhook prepaid (idempoten, `x-callback-token`, cek nominal). |
| `/api/ticketing/gate/tap` | Tap gate visit/band (charge tiket ke tab). |

---

## 7. Pola & Keputusan Desain Kunci

1. **Ticket = produk (R1)** — master `ticket_products` + varian ber-harga musiman menggantikan matriks flat Fase A.
2. **Harga eksplisit Regular/High per varian** — tanpa hitungan tersembunyi; kosong → tolak transaksi.
3. **High season menang saat overlap** — TANPA auto-weekend; default regular.
4. **Tab = ledger dua arah append-only** — saldo agregat, bukan kolom running; void = baris pembalik.
5. **Postpaid = akrual + credit limit** (tap ditolak bila lewat); **prepaid = deposit** (saldo = kredit − debit).
6. **Settle sekali di exit** — satu pembayar bisa lunasi banyak band (rombongan).
7. **Gelang = aset venue berputar** — BEDA dari identitas member; status siklus hidup.
8. **Credit limit & mode bayar per venue** (`ticket_settings`), re-entry per produk.
9. **Booking prepaid net-0 saat redeem** — tiket sudah dibayar online; visit tak charge ulang.
10. **Revenue booking = titipan sampai redeem + hangus configurable** — watcher tiap jam akui revenue hangus.
11. **Webhook idempoten** — `UPDATE ... WHERE status='menunggu-bayar'` + verifikasi `x-callback-token` + cek nominal.
12. **Gelang hilang tanpa denda** (keputusan owner) — settle by data.

---

## 8. Batas Ticketing ↔ POS

**Tiket adalah entitas modul Ticketing, BUKAN produk katalog POS F&B.** Keputusan
owner (ditegaskan lagi di EPIC-028): non-gate ticket pun **TETAP di Ticketing** karena
perlu validasi NFC — bukan dipindah ke POS.

```
Tiket        → Ticketing (loket + gate) — di-charge ke tab visit (charge_type='tiket')
F&B in-venue → POS F&B — dibayar via metode "NFC Tab" → pindah jadi charge_type='fnb' di tab
Settlement   → layar pembayaran POS bayar TOTAL tab (tiket + F&B + penalti)
```

Jadi POS hanya menyentuh dua titik: **(a)** menjual **F&B** (bukan tiket) yang tagihannya
dialihkan ke tab via `nfc_tab`, dan **(b)** menjadi **layar pembayaran** saat settlement.
Produk tiket, harga musiman, gate, dan tab tetap milik Ticketing. Alur dapur/stok/KDS/
shift POS **nol perubahan** — F&B on-tab jalan seperti order biasa.

---

## 9. Status & Fase Lanjut

**TUNTAS:** A (skema) · B (visit core + gate + settlement) · C (F&B on tab) · R1 (Ticket
sebagai Produk) · R2 (Channel Manager) · D (website booking + redeem) · P (bundling) ·
E (laporan + ops: staff pass, lost-band alert, forfeit) → **ready-for-qa**.

**Sisa / fase lanjut:**
- **Xendit produksi** (dev pakai MOCK).
- Kuota harian per kanal (alokasi) — disiapkan di matriks, implementasi lanjut.
- Ingress tunnel publik untuk halaman booking.

---

## 10. Riwayat Commit (branch `development`)

| Commit | Isi |
|--------|-----|
| `8dad882` | Fase A — skema ticketing + resolve harga musiman. |
| `b295041` | Fase B — gate tap charge tiket + kasir keluar tutup ledger. |
| `f0fff95` | Fase C — F&B numpang tab (nfc_tab). |
| `994cf23`, `c6b1ad0` | R1 — Ticket menjelma produk (varian musiman, kalender, kebijakan). |
| `b46ca80` | R2 — Channel Manager (distribusi + override harga per kanal). |
| `501d212`, `98516e9` | Fase D — website booking prepaid Xendit + redeem loket. |
| `312cadb` | Rombongan bernama (nama per unit + pairing gelang). |
| `ebc5120` | Fase P — ticket bundling (prorata net-0). |
| `ab39de5` | Fase E — laporan (net-void) + tampilan hemat paket. |
| `706af8c` | Gelang karyawan free access (staff pass). |
| `32b81ac` | Penutupan keputusan owner (gelang hilang tanpa denda, varian Umum, alert webhook). |
| `af084a3` | Loket akses Booking read-only + kirim ulang WA. |
| `32b3b03` | Revenue booking: titipan sampai redeem + hangus configurable. |
| `4c0f1ca` | Redesain booking publik single-page ala tiket.com. |

---

## 11. Catatan Operasional

- **App dev:** PM2 `arkiv-pos-saas` → `next start -p 3459` (**production build**). Ubah kode → `npm run build` + `pm2 restart arkiv-pos-saas`.
- **`build|tail` bisa menelan exit code** — cek `.next/BUILD_ID` ada sebelum `pm2 restart`.
- **`ignoreBuildErrors`:** build hijau ≠ runtime aman → jalankan `npx tsc --noEmit` & diff error BARU vs baseline setelah perubahan besar.
- **Webhook Xendit** wajib verifikasi `x-callback-token`; idempoten + cek nominal — jangan proses ganda.
- **Routing edge:** halaman publik `/booking/*` di-allowlist di **`src/proxy.ts`** (bukan `middleware.ts`).
- **Dialog sempit:** `DialogContent` default `sm:max-w-sm` — override lebar WAJIB prefix `sm:` (mis. `sm:max-w-6xl`).
- **Smoke non-auth:** route dashboard terproteksi balas `307`/`401`, bukan `200` — normal. Route publik `/booking/<slug>` balas `200`.
- **Push:** `git -c credential.helper='store --file=~/.git-credentials-arkiv' push origin development`.
