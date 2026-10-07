# EPIC-028: Ticketing — Season Pass & Membership (Pass Masuk Berlaku)

status: ready-for-qa
environment: dev
retries: 0

## Goal

Menambah **Season Pass** pada modul Ticketing (EPIC-023): pengunjung membeli
**pass masuk berlaku** (mis. annual pass) sekali, lalu bisa masuk berulang
selama masa berlaku tanpa beli tiket harian. Ini menutup salah satu gap
terbesar vs benchmark accesso (Passport/Siriusware — season pass & membership),
yang paling cepat menaikkan recurring revenue & retensi pengunjung.

MVP fokus **entry-only**: jual pass → terbit pass + QR → validasi masuk di gate.
Benefit member (diskon POS), perpanjangan, cicilan, foto, guest pass = fase lanjut.

## Konteks Repo (hasil scoping 2026-07-24)

Modul ticketing sudah kaya — season pass lebih banyak **merangkai** infrastruktur
yang ada daripada greenfield:

- **Produk & varian**: `ticketing.ticket_products` punya `product_kind`
  (`single`|`bundle`) + `base_price` + kategori + thumbnail. Ditambah jenis
  ketiga `season_pass`.
- **Gate & access control SUDAH ada**: `ticket_gate_events` (band_uid, gate_label,
  result) + route `POST /api/ticketing/gate/tap`. Validasi pass masuk memperluas
  jalur ini (deteksi kode pass vs band vs booking).
- **Gelang NFC**: `ticket_bands` (nfc_uid, label, status) — pass bisa ditautkan ke
  band untuk tap; reuse langsung.
- **Jalur bayar online**: `ticket_bookings` + Xendit (`xendit_invoice_id/url`,
  `paid_at`, `access_token`, webhook `public/booking/webhook/xendit`) + kirim QR via
  WhatsApp. Pola dipakai ulang untuk penjualan pass online (pass punya field
  jual/bayar sendiri agar TIDAK mengganggu skema booking harian).
- **Loket (POS box office)**: menu `ticketing/loket` — titik jual pass walk-in.
- **Blackout / kalender**: `ticket_product_dates` (date_kind, label, start/end) —
  blackout date pass reuse tabel ini (`date_kind='blackout'`), tanpa skema baru.
- **Tenancy & migrasi**: pola `company_id`+`branch_id`, delta
  `database/migrations/deltas/YYYYMMDDHHMMSS_*.sql`, menu/role via `iam.menus`.
- **CRM member** (`crm.crm_member_profiles`, `crm_membership_tiers`, portal member)
  ADA tapi terpisah — tautkan `customer_id` opsional di fase lanjut, JANGAN kopel
  di MVP.
- **Greenfield sesungguhnya**: konsep pass berlaku (validity rolling), kebijakan
  entry configurable (1x/hari · tak terbatas · punch-card), penerbitan pass + QR,
  validasi entry per-pass.

## Keputusan Owner (2026-07-24)

1. **Masa berlaku = ROLLING dari pembelian.** Tiap pass punya `valid_from` →
   `valid_until` sendiri; durasi (bulan) diatur per produk pass (`validity_months`).
2. **Kebijakan entry CONFIGURABLE per produk pass** — tiga tipe hidup berdampingan,
   dipilih saat membuat produk:
   - `once_per_day` — boleh masuk kapan saja dalam masa berlaku, **maks 1×/hari**.
   - `unlimited` — bebas masuk-keluar (dukung re-entry sesuai kebijakan gate).
   - `limited_visits` — **punch card**: jatah N kunjungan (`visit_quota`), berkurang
     tiap masuk.
3. **Media = QR utama + opsional gelang NFC.** QR (HP/cetak) sebagai identitas
   utama; boleh ditautkan ke `ticket_bands` untuk tap. Foto verifikasi = fase lanjut.
4. **MVP = entry-only.** Benefit diskon member (POS F&B/retail), perpanjangan/
   renewal + reminder, cicilan, foto, guest pass, portal pemegang = **fase lanjut**.

## Skema Baru (Fase A)

```
ticketing.ticket_pass_configs        -- 1:1 dgn produk kind='season_pass'
  ticket_product_id (FK unik) · validity_months int
  entry_policy text CHECK (once_per_day|unlimited|limited_visits)
  visit_quota int null   -- hanya utk limited_visits
  is_active bool · company_id/branch_id · audit

ticketing.ticket_season_passes       -- pass terbit (per pemegang)
  pass_code (unik) · access_token (portal/QR) · ticket_product_id
  holder_name · holder_phone · holder_photo_url (null MVP)
  valid_from date · valid_until date
  status text CHECK (pending|active|expired|suspended|cancelled)
  visit_quota_total int null · visit_quota_used int default 0
  band_id uuid null · band_uid text null  -- tautan NFC opsional
  sale: source (loket|online) · unit_price · xendit_invoice_id/url · paid_at · payment_expires_at
  customer_id uuid null  -- tautan CRM (fase lanjut)
  activated_at · company_id/branch_id · audit

ticketing.ticket_pass_entries        -- log masuk per pass (audit + enforcement)
  season_pass_id (FK) · entry_date date · gate_label · band_uid null
  result text (granted|denied_expired|denied_duplicate|denied_quota|denied_inactive|denied_blackout)
  company_id/branch_id · created_by · created_at
  -- UNIQUE partial (season_pass_id, entry_date) WHERE result='granted'
  --   → enforce once_per_day di level DB
```

Blackout reuse `ticket_product_dates` (`date_kind='blackout'`).

## Tasks (fase)

### Fase A — Skema & master config `[coding]`
- A1. ✅ **SELESAI** — Migrasi `20260724160000_ticketing_season_pass.sql` (applied dev):
  3 tabel (`ticket_pass_configs`, `ticket_season_passes`, `ticket_pass_entries`) +
  `product_kind` terima `season_pass`, FK ke products/bands, unique once/day
  (dibatasi `entry_policy='once_per_day'`), index gate-lookup. Terverifikasi:
  constraint kuota `limited_visits` & unique once/day tepat.
- A2. ✅ **SELESAI** — Master produk pass: dialog "Buat Ticket" dapat jenis **Season
  Pass** + field `validity_months` / `entry_policy` (1×hari · tak terbatas · punch-card)
  / `visit_quota` (muncul saat punch-card, wajib). API `products` POST diperluas:
  buat produk kind `season_pass` + 1 varian "Umum" penampung harga + row
  `ticket_pass_configs`. Badge "Season Pass" di daftar. Migrasi fix
  `20260724170000` (lebarkan `product_kind` varchar(10)→(20) — 'season_pass' 11 char).
  Terverifikasi (DB rollback): produk+config+varian terbentuk; harga diisi di editor
  (varian Umum) lalu diaktifkan.
- **Exit**: ✅ bisa membuat produk Season Pass + config di dashboard; tersimpan & tervalidasi.
  **Fase A TUNTAS.**

### Fase B — Penjualan & penerbitan pass `[testing]` (TUNTAS B1+B2)
- B1. ✅ **SELESAI** — **Loket**: halaman **Season Pass** (`/dashboard/ticketing/passes`,
  role operator) — daftar pass terbit + dialog "Terbitkan Pass" (pilih produk pass aktif,
  nama/HP pemegang, UID gelang NFC opsional) → pass `active`, `valid_until = today +
  validity_months` (rolling), `pass_code` SP-YYYYMMDD-#### + `access_token` +
  **QR (QRCodeSVG)**; band NFC opsional divalidasi terdaftar. API
  `POST/GET /api/ticketing/season-passes` + `pass-options`; lib `season-pass.ts`
  (addMonthsIso, generatePassCode). Menu `20260724180000` (grant super_admin/pos_supervisor/pos).
  Terverifikasi end-to-end (DB rollback) + route 307/401 + menu 3 grant.
- B2. ✅ **SELESAI** — **Online**: halaman publik `/pass/[slug]` (pilih produk pass →
  data pemegang → Xendit invoice) → webhook `PAID` (prefix `tkt-pass-`) → pass `active`,
  `valid_from`=tanggal bayar (rolling), `valid_until`=+validity_months, kirim QR via
  WhatsApp (`pass-wa.ts`). Halaman status `/pass/status/[token]` (polling: pending→tombol
  bayar; active→QR+masa berlaku; expired/cancelled→info). API publik `passes` (katalog
  website-distributed) + `pass` (beli) + `pass-status`. Field jual/bayar di pass sendiri
  (tak sentuh `ticket_bookings`). **Fix**: allowlist middleware `/pass` (halaman publik).
  Terverifikasi end-to-end (DB rollback: katalog online→beli pending→webhook PAID aktivasi
  valid_from/until) + route publik 200. Xendit MOCK aktif di dev.
- **Exit**: ✅ pass bisa dijual dari loket & online; status pending→active setelah bayar;
  QR tampil di halaman status + terkirim WA. **Fase B TUNTAS.**

### Fase C — Validasi masuk di gate `[testing]` (SELESAI)
- C1. ✅ **SELESAI** — Endpoint TERSENDIRI `POST /api/ticketing/gate/pass-tap` (bukan
  entangle `gate/tap` visit/tab). Input `code` = QR `access_token` (64hex) / `pass_code`
  (SP-…) / UID gelang NFC → resolve pass (FOR UPDATE) → validasi berlapis: status active ·
  `valid_from..valid_until` · blackout (reuse `ticket_product_dates` date_kind='blackout') ·
  entry_policy (`once_per_day` **check-first + unique index backstop**, `unlimited` lolos,
  `limited_visits` cek+increment quota transaksional) → tulis `ticket_pass_entries` →
  granted/denied + alasan. (Catatan: check-first dipakai karena 23505 meracuni transaksi.)
- C2. ✅ **SELESAI** — Layar gate `/dashboard/ticketing/gate-pass` (fullscreen HIJAU/MERAH,
  wedge auto-focus utk reader QR/NFC + input manual; tampil nama pemegang, sisa kuota/masa
  berlaku, alasan tolak). Menu `20260724210000` (grant operator).
- **Exit**: ✅ pass valid → MASUK & tercatat; kadaluarsa/duplikat/kuota habis/nonaktif/
  blackout → DITOLAK dgn alasan; 1×/hari benar-benar 1×/hari (unique index teruji).
  Terverifikasi DB: once/day terblok, unlimited 2× bebas, resolve token/code, quota habis 2/2.

### Fase (tambahan) — Gate flag & mapping `[SELESAI]`
- Flag `has_gate` per ticket + halaman **Gate Mapping** (`/dashboard/ticketing/mapping`,
  super_admin) — SCAFFOLD: list ticket gate=yes + slot pemetaan controller (koneksi riil
  menyusul). Menu `20260724200000`. + COGS/HPP per ticket (laporan omzet kotor/bersih
  menyusul — snapshot saat sale/tap).

### Fase D — Fase lanjut `[coding]`
- D1. **Benefit member (diskon POS)** — ⏳ **FONDASI SELESAI**: `member_discount_percent`
  per produk pass (config + input dialog buat) + endpoint POS `GET /api/pos/pass-lookup`
  (scan QR/pass_code/NFC → diskon bila pass aktif & berlaku). **Wiring cashier DEFER ke PR**
  (jalur uang/checkout: discountAmount mengalir ke 3 builder payload + CFD + deps — wajib
  di-review & E2E, tak aman diubah buta).
- D2. **Renewal + reminder** — ✅ **SELESAI**: (a) perpanjang di loket — `POST
  /api/ticketing/season-passes/[id]/renew` (valid_until += validity_months dari MAX(hari
  ini, valid_until); punch-card reset kuota) + tombol "Perpanjang" di daftar pass; (b)
  reminder WA ke **pemegang** pass berlaku ≤14 hari (`maybeSendPassExpiring` di
  notifications-watcher, kirim ke holder_phone, klaim-dulu `wa_notif_log`
  notif_type='passExpiring', gated master WA + jam 8-21). Terverifikasi DB: renewal
  extend+reset kuota, reminder menjaring ≤14h, claim dedup memblok kirim ganda.
- Sisa Fase D (backlog): cicilan/payment plan · foto verifikasi · guest pass · portal
  pemegang · UI blackout date · **wiring cashier benefit** · **laporan omzet kotor/bersih**.

## Acceptance Criteria (MVP: A–C)

- Owner dapat membuat produk **Season Pass** dengan durasi (bulan) & salah satu dari
  tiga kebijakan entry; `limited_visits` wajib mengisi kuota.
- Pass dapat dijual **di loket** dan **online (Xendit)**; setelah bayar status jadi
  `active`, `valid_until` = tanggal beli + `validity_months`, QR terkirim (online via WA).
- Di gate: pass **active & dalam masa berlaku** → **granted** dan tercatat di
  `ticket_pass_entries`; **kadaluarsa** → denied_expired; **`once_per_day` yang sudah
  masuk hari itu** → denied_duplicate; **`limited_visits` kuota habis** → denied_quota;
  **suspended/cancelled/pending** → denied_inactive.
- `once_per_day` dijamin **maksimum 1 entry granted per (pass, tanggal)** di level DB
  (unique partial index), bukan hanya cek aplikasi (anti-race).
- Semua tabel ber-scope `company_id`+`branch_id`; query fail-closed pada scope.
- Tidak ada regresi pada booking tiket harian & gate existing (jalur pass terpisah).

## Test Plan

- **Unit**: hitung `valid_until` (rolling), transisi status, decrement kuota
  `limited_visits`, resolusi entry_policy → hasil granted/denied.
- **Integrasi (DB rollback)**: buat produk+config; terbitkan pass; simulasi gate tap
  untuk tiap entry_policy & tiap alasan denied; uji unique index once/day menolak
  entry kedua di hari sama; uji kuota tak minus di bawah race (dua tap paralel).
- **E2E (dev)**: alur online beli pass → (mock) webhook paid → pass active → tap di
  gate granted; alur loket terbitkan → tap granted.
- **Gate**: qa · test · security (scope tenant, tak ada bypass validasi, pass code tak
  ter-enumerasi).

## Agent Routing

- Skema/SQL → `ecc:database-reviewer`; backend TS → `ecc:typescript-reviewer`;
  keamanan (scope, enumerasi pass, bypass gate) → `ecc:security-reviewer`;
  build hijau → `ecc:build-error-resolver`.

## Done Signal

MVP (A–C) hijau di dev: produk pass dibuat, pass terjual (loket+online) & aktif,
validasi gate benar untuk tiga kebijakan entry + semua alasan denied, unique once/day
teruji, 0 regresi booking harian → **ready-for-qa**.

## Automation Log

- 2026-07-24 — Epic dibuat. Scoping selesai (reuse products/gate/bands/bookings/Xendit/WA).
  Keputusan owner: rolling validity, entry_policy configurable (3 tipe), QR+NFC opsional,
  MVP entry-only. Mulai Fase A (skema + master).
- 2026-07-24 — **A1 SELESAI**: migrasi `20260724160000_ticketing_season_pass.sql` applied di
  dev. 3 tabel + `product_kind='season_pass'` + unique once/day (partial, hanya once_per_day)
  + FK products/bands. Verifikasi DB: constraint kuota limited_visits menolak kuota kosong;
  index once/day tepat.
- 2026-07-24 — **A2 SELESAI (Fase A TUNTAS)**: dialog buat produk + API POST products
  (kind season_pass → varian Umum + ticket_pass_configs) + badge daftar. **Bug ketemu &
  fix**: kolom `product_kind` varchar(10) tak muat 'season_pass' (11 char) → migrasi
  `20260724170000` lebarkan ke varchar(20). Terverifikasi end-to-end (DB rollback):
  produk+config+varian terbentuk, unique config per-produk tegak. Build hijau, PM2 restart.
- 2026-07-24 — **B1 SELESAI**: penerbitan pass di loket. Halaman
  `/dashboard/ticketing/passes` (feature `season-passes`: page+dialog terbit+QR result),
  API `season-passes` (POST issue → active, rolling valid_until, pass_code+access_token;
  GET list) + `pass-options`, lib `season-pass.ts`, menu `20260724180000`. QR pakai
  `qrcode.react` (access_token). Terverifikasi DB rollback (issue path + valid_until +12bln)
  + route 307/401 + menu 3 grant. Dialog buat-produk juga dilebarkan sm:max-w-lg.
- 2026-07-24 — **B2 SELESAI (Fase B TUNTAS)**: jual pass online. Halaman publik
  `/pass/[slug]` (beli) + `/pass/status/[token]` (QR/status polling); API publik
  `passes`/`pass`/`pass-status`; webhook Xendit diperluas prefix `tkt-pass-` (PAID→active
  rolling valid_from/until + WA via `pass-wa.ts`; EXPIRED→cancelled); lib pass-wa.
  **Fix**: allowlist middleware `/pass`. Terverifikasi DB rollback (katalog online→beli
  pending→webhook aktivasi) + `/pass/sulu` 200. Xendit MOCK aktif dev. Build hijau.
- 2026-07-24 — **Tambahan owner**: (a) flag `has_gate` per ticket + halaman **Gate Mapping**
  scaffold (list gate=yes, slot controller) menu `20260724200000`; (b) **COGS/HPP** per
  ticket (fondasi laporan omzet kotor/bersih). Keputusan: non-gate ticket TETAP di Ticketing
  (perlu validasi NFC), bukan dipindah POS.
- 2026-07-24 — **Fase C SELESAI (MVP A–C TUNTAS → ready-for-qa)**: validasi gate pass.
  Endpoint `gate/pass-tap` (QR/pass_code/NFC → validasi status/validity/blackout/entry_policy
  → pass_entries) + layar `/dashboard/ticketing/gate-pass` (HIJAU/MERAH, wedge reader) + menu
  `20260724210000`. Terverifikasi DB: once/day unique terblok (check-first di route), unlimited
  2× bebas, resolve token/code, limited quota habis 2/2. Build hijau, PM2 restart.
- 2026-07-25 — **Fase D sebagian**: D2 (renewal + reminder) SELESAI, D1 (benefit) FONDASI.
  Keputusan owner: controller gate + wiring cashier benefit + laporan omzet = digarap di PR.
  Migrasi `20260724220000` (member_discount_percent). Renewal endpoint+tombol, reminder WA
  holder (`maybeSendPassExpiring`, wa_notif_log 'passExpiring'), POS pass-lookup endpoint.
  Terverifikasi DB (renewal extend+reset kuota, reminder ≤14h, claim dedup). Build hijau.
