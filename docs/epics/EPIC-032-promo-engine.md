# EPIC-032: Engine Promosi — Promo Code, Voucher Tiket, Diskon & Gifting

status: ready-for-qa
environment: dev
retries: 0

## Goal

Menutup gap benchmark #6 vs accesso (lihat
[`BENCHMARK-ticketing-vs-accesso.md`](./BENCHMARK-ticketing-vs-accesso.md)):
**satu engine promo bersama** yang dipakai Ticketing (booking online +
loket) DAN kasir POS — promo code, voucher batch sekali-pakai, diskon
terkontrol, dan gifting ("kirim e-tiket sebagai hadiah"). Bukan dua sistem
paralel.

## Temuan Audit (2026-07-25) — kenapa "integrasi" ≠ jembatan

1. **`pos.pos_vouchers` + `pos_customer_vouchers` = LEGACY MATI.** Tidak
   direferensikan di mana pun di `src/` dan tanpa kolom tenancy
   (company/branch). Catatan benchmark "POS punya voucher sendiri" sudah
   basi — tidak ada engine POS yang perlu dijembatani; tabel ini kandidat
   pensiun (jangan dipakai ulang).
2. **POS checkout SUDAH punya pipa diskon**: `pos_orders.discount_amount`
   + `discount_reason` mengalir di order path (`/api/pos/orders`, RPC
   `p_discount_amount`) — manual kasir, tanpa kode, tanpa audit siapa/
   kenapa selain teks bebas. Integrasi POS = **menyuapi pipa existing ini
   dari validasi kode** (minimal invasive), bukan merombak checkout.
3. **CRM loyalty adalah sistem KETIGA yang hidup**: `crm_rewards`
   (reward_type `voucher|discount`, harga XP) + `crm_redemptions`
   (`voucher_code` unik, pending→approved→fulfilled, expires). Ini
   loyalty (tukar XP), BUKAN marketing promo — jangan dilebur paksa di
   MVP, tapi engine harus didesain agar reward CRM bisa menerbitkan kode
   ke engine yang sama di fase lanjut.
4. **Ticketing** tanpa promo sama sekali; pola integrasinya sudah mapan:
   harga dihitung ulang server (`buildPublicCatalog`), total di-snapshot
   ke booking, pelepasan otomatis via status (kedaluwarsa/dibatalkan/
   hangus) — pola yang sama dipakai kuota EPIC-031 dan bisa dipakai untuk
   "melepas" pemakaian promo tanpa mekanisme refund terpisah.
5. Fondasi terkait: `ticket_pass_configs.member_discount_percent`
   (EPIC-028 D1) + `GET /api/pos/pass-lookup` — diskon member pass di
   kasir yang wiring-nya di-defer. Engine promo TIDAK menggantikannya,
   tapi laporannya kelak satu bahasa (lihat Non-Goals).

## Usulan Arsitektur

**Satu schema baru `promo`** (bukan numpang `pos`/`ticketing` — dipakai
lintas modul), tenancy penuh, 3 tabel:

```
promo.promo_campaigns      -- induk aturan
  id, company_id, branch_id, name, description,
  discount_type ('percent'|'fixed'), value,
  max_discount (cap utk percent), min_purchase,
  valid_from, valid_until, usage_limit (total, NULL=∞),
  per_phone_limit (default 1, NULL=∞),
  scope ('ticketing_online'|'ticketing_loket'|'pos'|'semua')  -- array/flags
  is_active, audit

promo.promo_codes          -- kode di bawah campaign
  id, campaign_id FK, code (UNIQUE per company),
  usage_limit (NULL = ikut campaign; 1 = voucher sekali-pakai),
  usage_count, is_active
  -- 1 campaign bisa: SATU kode publik (promo code marketing)
  --                  ATAU batch ribuan kode unik (voucher/gift)

promo.promo_redemptions    -- ledger pemakaian (append-only)
  id, code_id FK, campaign snapshot (name/type/value),
  context_type ('ticket_booking'|'pos_order'), context_id,
  phone/customer_id, discount_amount, status
  ('held'|'captured'|'released'), created_at
```

**Pola anti-race & pelepasan (reuse EPIC-031):**
- Klaim kode = transaksional `UPDATE usage_count WHERE …` + insert
  redemption `held` (pola klaim-dulu wa_notif_log).
- Booking `menunggu-bayar` memegang redemption `held`; webhook PAID →
  `captured`; kedaluwarsa/dibatalkan → `released` + usage_count turun —
  **menumpang jalur status existing**, tanpa cron baru.
- Validasi & kalkulasi = **lib murni `src/lib/promo/promo.ts`**
  (pola pricing.ts/capacity.ts, TDD): cek window/limit/min_purchase →
  hitung diskon (percent ber-cap / fixed, tak boleh > subtotal).

## ⚠ Risiko teknis yang HARUS dijaga (jalur uang)

**Asersi net-0 redeem booking (EPIC-023 D4)**: redeem menegaskan
Σ debit item = `booking.total`. Kalau diskon mengurangi total, asersi
pecah. Solusinya BUKAN melonggarkan asersi, tapi menambah **baris ledger
`diskon` (debit negatif / kredit promo)** saat redeem sehingga
Σ debit item − diskon = total tetap seimbang — konsisten filosofi ledger
dua-arah. Ini menyentuh `settlementPlan`/`chk_charge_direction` — wajib
review + test ekstra (preseden: jalur uang di-PR-kan, EPIC-028 D1).

## Fase (masing-masing PR-sized, rilis bertahap)

### Fase A — Engine inti + admin
| Task | Scope |
|---|---|
| A1 | Skema `promo` 3 tabel + lib murni validasi/kalkulasi (TDD) |
| A2 | Helper server klaim/capture/release transaksional + unit/SQL smoke |
| A3 | Halaman admin `/dashboard/promo` (super_admin + marketing): CRUD campaign, buat kode publik, **generate batch voucher** (N kode unik, export CSV), lihat pemakaian |
| A4 | Role baru `marketing`: UserRole type + grant menu promo + akses dashboard (per keputusan owner #6; role belum ada di sistem — wajib security review krn menyentuh access gate) |

### Fase B — Ticketing booking online (konsumen pertama)
| Task | Scope |
|---|---|
| B1 | Endpoint publik validasi kode (rate-limited, tanpa bocor detail campaign) + create booking terima `promo_code`: hitung ulang server, snapshot `discount_amount`+`promo_code` ke booking, invoice Xendit = total bersih; redemption `held`→`captured`/`released` menumpang webhook & expiry existing |
| B2 | Wizard: input kode di langkah ringkasan → tampil potongan & total baru; pesan jelas saat kode tak sah/habis/di bawah min. pembelian |
| B3 | **Baris ledger `diskon` saat redeem** (jaga net-0) + kartu diskon di laporan ticketing (net-void aware) |

### Fase C — Kasir POS
| Task | Scope |
|---|---|
| C1 | Endpoint validasi kode utk kasir (scope `pos`) → hasil mengisi pipa `discount_amount` + `discount_reason` existing (format "PROMO {code}") + catat redemption `captured` atomik dgn order; void order → `released` |
| C2 | UI kasir: field "Kode promo" di panel pembayaran (di samping diskon manual existing; diskon manual tetap ada utk supervisor) |

### Fase D — Voucher tiket & Gifting
| Task | Scope |
|---|---|
| D1 | Voucher batch end-to-end: generate → distribusi (CSV/WA) → dipakai di booking/POS (kode unik `usage_limit=1`) — sebagian besar sudah jadi dari A3+B+C, task ini QA path + polish |
| D2 | Gifting booking: checkbox "Kirim sebagai hadiah" di wizard → nama+WA penerima (`gift_recipient_name/phone` di booking) → e-tiket & status page dikirim ke WA penerima (pemesan tetap dapat bukti bayar); redeem loket menampilkan nama penerima |

### Fase E — Lanjut (opsional, tunggu kebutuhan)
- CRM loyalty → engine: reward XP menerbitkan `promo_codes` (ganti
  `crm_redemptions.voucher_code` lepas) — loyalty & marketing satu ledger.
- Targeting per produk/varian tiket; jadwal jam; stacking rules.
- Pensiun resmi tabel legacy `pos_vouchers` (drop setelah dikonfirmasi).

**Dependensi:** A → B → C (C bisa paralel dgn B3) → D. Gifting D2
independen dari engine (bisa maju duluan bila owner mau).

## Non-Goals

- Menggabungkan diskon member season pass (EPIC-028 D1) ke engine —
  tetap jalur sendiri, wiring kasirnya masih defer PR terpisah.
- Merombak checkout POS / RPC order — hanya menyuapi pipa diskon existing.
- Gift card ber-saldo / stored value (gap benchmark #8 — epic terpisah).
- Stacking multi-kode dalam satu transaksi (MVP: 1 kode per transaksi).
- Migrasi/reuse tabel legacy `pos_vouchers` (mati, tanpa tenancy).

## Acceptance Criteria (inti)

- [ ] Kode publik: dipakai di booking online → total & invoice terpotong
      benar (server yang hitung, klien tak dipercaya); limit total &
      per-nomor-WA ditegakkan anti-race (2 tab rebutan sisa 1 → tepat 1).
- [ ] Booking kedaluwarsa/batal → pemakaian kode kembali (usage lepas).
- [ ] Redeem booking ber-diskon → ledger seimbang (net-0 dgn baris
      diskon); laporan menampilkan diskon terpisah dari revenue.
- [ ] Kode yang sama (scope `semua`) berlaku di kasir POS mengisi
      discount_amount + tercatat di redemptions; void melepas pemakaian.
- [ ] Voucher batch: N kode unik ter-generate & masing-masing mati
      setelah 1×.
- [ ] Gifting: e-tiket sampai ke WA penerima; redeem menampilkan nama
      penerima; pemesan tetap terlihat sebagai pembayar.
- [ ] Tanpa kode → semua alur berperilaku persis seperti sekarang.

## Open Questions (SEMUA TERJAWAB owner 2026-07-26)

1. ~~Urutan konsumen~~ → **Ticketing online dulu**, baru POS.
2. ~~Level diskon~~ → **Per transaksi** di MVP; per produk = Fase E.
3. ~~Gifting~~ → **Kirim e-tiket ke WA penerima, tanpa halaman klaim.**
4. ~~Voucher batch~~ → **Nominal saja** (fixed/percent sekali pakai);
   "1 tiket gratis produk X" = Fase E (butuh targeting produk).
5. ~~Loyalty CRM~~ → **Fase E.**
6. ~~Pengelola~~ → **super_admin + marketing**. TEMUAN: role `marketing`
   BELUM ada (tak di UserRole type maupun DB; role non-super_admin/hrd =
   ESS-only via `FULL_ACCESS_ROLES` access.ts) → Fase A ketambahan task
   **A4: role marketing** (UserRole type + akses dashboard menu promo +
   grant IAM; menyentuh permukaan auth → wajib security review).

## Automation Log

- 2026-07-25 — Epic dibuat dari gap benchmark #6. Audit integrasi:
  `pos_vouchers` legacy MATI (tak dipakai, tanpa tenancy) → keputusan
  desain: SATU engine baru schema `promo` utk ticketing+POS, POS
  diintegrasikan lewat pipa `discount_amount/discount_reason` existing,
  CRM loyalty menyusul Fase E. Risiko dicatat: asersi net-0 redeem wajib
  baris ledger `diskon`. Status **backlog** — menunggu jawaban 6 open
  questions owner.
- 2026-07-26 — Owner menjawab SEMUA open questions (lihat seksi OQ):
  ticketing online dulu, diskon per transaksi, gifting WA-only, voucher
  nominal saja, CRM Fase E, pengelola super_admin+marketing. Temuan: role
  `marketing` belum ada → task A4 ditambahkan. Status → **on-progress**;
  mulai Fase A1.
- 2026-07-26 — **A1 SELESAI**: migrasi `20260726100000_promo_engine.sql`
  applied di dev — schema `promo` + 3 tabel (campaigns/codes/redemptions)
  sesuai arsitektur; kunci DB: CHECK percent≤100, XOR-ish limit kode vs
  campaign lewat kolom nullable, **unique partial
  `uq_promo_redemptions_context` (1 kode hidup per transaksi)**, index
  per-phone & per-code ber-WHERE status<>released. `database/schema-map.js`
  + domain `promo` (order 68, search_path). Lib murni `src/lib/promo/
  promo.ts` (TDD 14 test hijau): `computeDiscount` (percent 2dp ber-cap,
  fixed ≤ subtotal), `evaluatePromo` (urutan cek deterministik: aktif →
  window inklusif → scope → min-pembelian [subtotal 0 ditolak] → kuota
  [limit KODE menang atas campaign] → limit-nomor) +
  `PROMO_REJECT_MESSAGES`. Smoke DB rollback: CHECK & unique context
  terbukti menolak. Commit d88e68c2 (pushed).
- 2026-07-26 — **A2 SELESAI**: `src/lib/promo/promo-server.ts` —
  `previewPromoCode` (read-only tanpa lock utk endpoint validasi; kode tak
  dikenal = pesan sama dgn nonaktif, anti-enumerasi), `holdPromoRedemption`
  (DI DALAM transaksi pemanggil: **advisory lock per CAMPAIGN** — bukan per
  kode, karena limit campaign melintasi batch voucher — → muat ulang di
  bawah lock → hitung hidup (1 query FILTER campaign+phone) → evaluatePromo
  → usage_count+1 + insert `held`; throw `PromoRejectedError` 422),
  `capturePromoRedemption` (held→captured, idempoten),
  `releasePromoRedemption` (→released + usage_count-1 GREATEST 0,
  idempoten). Lookup kode case-insensitive per venue. Smoke SQL 10 asersi
  OK: hitungan campaign/phone, release mengembalikan jatah + nomor bisa
  pakai lagi, capture idempoten, **race klaim voucher 1× → tepat 1 LOLOS**
  (advisory lock terbukti), cleanup 0 sisa. tsc bersih. Belum ada konsumen
  runtime (wiring = B1) — build tidak diperlukan. Commit 992f5cec (pushed).
- 2026-07-26 — **A3 SELESAI, live dev**: halaman admin `/dashboard/promo`
  (feature `src/features/promo/*`: promo-page + campaign-detail-dialog) —
  CRUD campaign (dialog lengkap: jenis/nilai/cap/min/window/kuota/limit
  WA/kanal + kode publik opsional), toggle aktif, tabel ber-statistik
  (kode, terpakai/kuota, held menunggu bayar, total diskon captured);
  dialog detail: tambah kode publik, **generate batch voucher sekali-pakai**
  (prefix+jumlah ≤1000, kode `PREFIX-XXXXXX` charset anti-ambigu, ON
  CONFLICT skip+isi ulang maks 6 ronde), **export CSV di klien**, toggle
  kode (nonaktif — TANPA hard delete, jejak voucher tersebar harus awet),
  riwayat pemakaian 100 terbaru ber-status. API: `/api/promo/campaigns`
  (GET+stats subquery, POST + kode publik atomik), `[id]` PATCH (validasi
  nilai FINAL gabungan), `[id]/codes` GET/POST (single|batch discriminated
  union), `codes/[id]` PATCH toggle, `[id]/redemptions` GET. Guard:
  `requirePromoContext` (`lib/promo/server.ts`, PROMO_MANAGER_ROLES =
  super_admin+marketing; reuse resolver venue ticketing). GROUNDWORK A4:
  `"marketing"` ditambahkan ke UserRole type (belum ada user/menu grant —
  efektif masih super_admin only). Menu delta `20260726110000` (level-1
  'promo' + 'promo.campaigns', grant super_admin; marketing menyusul A4).
  Verifikasi: tsc bersih, 14 test, build OK (6 route promo di manifest) →
  pm2 restart, smoke 307/401 normal. Commit 52b1076e (pushed).
- 2026-07-26 — **A4 SELESAI (Fase A TUNTAS), live dev** + **SECURITY REVIEW
  dijalankan (agent security-reviewer)**:
  - Role `marketing`: migrasi `20260726120000` (iam.roles + grant HANYA
    promo/promo.campaigns + menu ESS — diverifikasi DB: non-ESS cuma 2
    menu itu); `ROLE_MODULE_PATHS.marketing = ["/dashboard/promo"]` (pola
    sales/finance_staff); masuk ADMIN_USER_ROLES (dropdown+zod otomatis) +
    ROLE_LABELS. Pembuatan user marketing tetap super_admin-only
    (diverifikasi reviewer: requireApiRole admin users).
  - **Temuan HIGH H1 (pre-existing, DIPERBAIKI)**: layout `(dashboard)`
    hanya menjalankan `canAccessPath` saat essOnly — role ber-grant menu
    non-ESS (sales/finance_staff, dan marketing kalau dibiarkan) bisa
    membuka URL modul lain (shell render; data tetap 403 di API). Fix:
    guard jalan utk SEMUA role non-full-access; path sah = ESS ∪
    ROLE_MODULE_PATHS ∪ **href menu IAM ber-grant** (`collectNavHrefs` +
    `isPathAllowedByMenus`; root `/dashboard` EXACT-only karena banyak
    role punya menu Beranda dan prefix-nya meloloskan semua). Redirect:
    essOnly → ESS home, selainnya → modul pertama role. CATATAN: fix
    berbasis menu-grant (BUKAN saran reviewer yang statis ROLE_MODULE_PATHS
    saja — itu bakal mengunci pos/purchasing dkk yang tidak terdaftar di
    map). `/dashboard/pos/*` layout terpisah — kasir tak tersentuh.
    Fix ini sekaligus menutup celah utk sales & finance_staff.
  - **Temuan LOW diperbaiki**: `generateVoucherCode` kini `crypto.randomInt`
    (kode voucher = bearer, tak boleh tertebak). Temuan LOW kedua (params
    id non-UUID → 500 kosmetik) diterima apa adanya.
  - Verdict reviewer: permukaan API promo sendiri solid (guard, tenant
    scoping, parameterized, zod). Verifikasi pasca-fix: tsc bersih, build
    OK → pm2 restart, smoke 307/401/200 normal. Commit 7f081709 (pushed).
- 2026-07-26 — **B1 SELESAI (termasuk inti ledger B3 yang DITARIK MAJU),
  live dev**:
  - Migrasi `20260726130000`: bookings + `discount_amount` (CHECK 0..total)
    + `promo_code`; **`total` TETAP GROSS** (semantik lama utuh — asersi
    net-0 redeem tak berubah); jenis ledger BARU `diskon` (kredit) di
    chk_charge_direction + tab.ts CHARGE_TYPES (840 test lib tetap hijau).
  - Endpoint publik `POST /[slug]/promo-check` (rate-limit 15/mnt,
    indikatif, anti-enumerasi).
  - Create booking: terima `promo_code` → hold DI transaksi (advisory lock
    campaign) setelah insert booking → snapshot discount/promo_code;
    **invoice Xendit = total − diskon**; gagal-invoice → release. 422
    pesan ramah bila kode tak lolos.
  - Webhook: cek-silang PAID pakai **tagihan NET** (total − diskon; bug
    kalau tidak: PAID net selalu dianggap kurang bayar); PAID → capture;
    EXPIRED → release. Lazy expiry (`expireBookingIfDue`) & cancel
    dashboard → release. **KEPUTUSAN AKUNTANSI: `hangus` TIDAK release**
    — uang sudah dibayar ber-diskon, pemakaian kode final (beda dari
    kedaluwarsa yang tak pernah dibayar).
  - Ledger redeem (inti B3): kredit `pembayaran` = NET (uang riil) +
    kredit `diskon` = potongan → Σkredit = gross = Σdebit tiket, net-0
    dipertahankan TANPA melonggarkan asersi.
  - Status publik expose discount/payable (+ slot jam — utang known
    limitation EPIC-031 ikut lunas di API); WA terbayar menampilkan
    Total/Potongan/Dibayar.
  - **E2E live dev penuh**: promo-check valid & kode ngawur (pesan sama);
    booking promo lowercase `zsmokeb1` → total 75rb, diskon 10rb, payable
    65rb, redemption `held`, usage 1; kode salah → 422; **webhook PAID
    amount NET 65rb → terbayar TANPA alert + `captured`**; booking kedua →
    usage 2 → webhook EXPIRED → `released` + usage turun ke 1; cleanup 0
    sisa. Build sempat 2× gagal fetch font Google (DNS flaky — retry
    sukses, isu known).
  - Sisa utk B2: input kode di wizard + tampilan potongan di halaman
    status publik (API-nya sudah siap). Commit 98096adb (pushed).
- 2026-07-26 — **B2 SELESAI, live dev**: wizard booking langkah ringkasan
  — input "Punya kode promo?" + tombol Pakai (preview via /promo-check,
  pesan penolakan ramah), kode terpasang tampil ber-baris hijau
  −potongan + tombol Hapus; rincian Subtotal/Potongan/Total Bayar; tombol
  "Bayar Sekarang" pakai payable; **ganti tiket/tanggal otomatis melepas
  kode** (subtotal berubah = preview basi); submit 422 → kode dilepas dari
  ringkasan + pesan server (pengunjung bisa lanjut tanpa kode). Halaman
  status publik: baris Subtotal/Potongan (kode)/Total Bayar + tombol bayar
  pakai payable + **jam slot tampil** (utang known-limitation EPIC-031
  lunas penuh di UI). tsc bersih, build OK → pm2 restart, /booking/sulu
  200. Fase B sisa: B3 kartu diskon di laporan ticketing (ledger sudah
  jalan sejak B1). Commit 13e51b33 (pushed).
- 2026-07-26 — **B3 SELESAI (Fase B TUNTAS), live dev**: laporan ticketing
  + `summary.diskon_promo` (dari netByType `diskon`, otomatis net-void
  aware karena lewat jalur eff_type sama) + kartu "Potongan Promo" (tampil
  hanya bila > 0; hint menjelaskan bukan uang keluar & revenue tiket tetap
  gross). AUDIT PENTING yang membuat B3 kecil: agregasi existing SUDAH
  benar — `uang_masuk` & rekonsiliasi metode hanya menjumlah
  deposit+pembayaran, jadi kredit `diskon` tak pernah tercampur uang riil.
  tsc bersih (error hris/reports = baseline lama), build OK → live.
  Fase B TUNTAS: booking online ber-promo end-to-end (validasi → hold →
  bayar net → capture → redeem net-0 ber-baris diskon → laporan).
  Sisa epic: Fase C (kasir POS) + Fase D (voucher QA-path + gifting).
  Commit 7221af9d (pushed).
- 2026-07-26 — **FASE C SELESAI (C1+C2), live dev** — kasir POS:
  - C1 server: `POST /api/pos/promo-check` (sesi kasir, rate-limit,
    channel 'pos'); `/api/pos/orders` terima `promo_code` — **hold DI AWAL
    dgn id order yang di-generate route sendiri** (insert pakai id
    eksplisit; kuota terkunci sebelum uang diterima, 422 rapi sebelum ada
    baris order); diskon = TURUNAN SERVER (membership dari
    `membership_discount_pct` + promo dari engine, dicap ≤ subtotal),
    klien diverifikasi ±1 rupiah (selisih = state basi → release + 400);
    order ber-promo total WAJIB turunan server (client total diabaikan);
    release di SEMUA jalur kompensasi (insert gagal, NFC-tab gagal charge,
    ARK gagal debit) + `pos/orders/[id]/void` → released (jatah kembali);
    capture sebelum respons sukses final (mencakup jalur normal/ARK/NFC).
    Split bill + promo → 400 (belum didukung MVP).
  - C2 UI: pola integrasi teraman ditemukan — financials kasir dihitung di
    SATU titik (membership → discountAmount → total), promo disisipkan di
    situ sehingga SEMUA payload builder + CFD + kembalian ikut otomatis
    tanpa menyentuh 6 builder satu-satu. `CartPanel` + input "Kode promo"
    di blok totals (baris Discount membership & Promo terpisah, hapus per
    baris); rumus klien = rumus hook checkout = rumus server (identik,
    selisih ditolak). Guard fail-closed: **offline / open-bill / split
    bill dgn promo terpasang → ditolak dgn pesan jelas**; promo auto-lepas
    saat subtotal berubah; promo ikut sah utk pembayaran NFC-tab.
  - Verifikasi: nol error TS baru (validator void & merge = baseline
    lama), build OK → pm2 restart, smoke 401/307 normal. CATATAN QA:
    E2E checkout kasir butuh sesi POS riil — masuk daftar QA owner
    (buat campaign scope 'pos'/'semua' → kasir pakai kode → cek order
    discount_reason "PROMO ..." + redemption captured → void → released).
    Commit c9ae7ee9 (pushed).
- 2026-07-26 — **FASE D SELESAI (EPIC TUNTAS A–D → ready-for-qa), live
  dev**:
  - D2 Gifting (migrasi `20260726140000`): booking +
    `gift_recipient_name/phone` (CHECK wajib berpasangan). Wizard: checkbox
    "Kirim sebagai hadiah 🎁" di langkah pemesan + field nama/WA penerima
    (ter-gate ke tombol lanjut) + baris "Hadiah untuk" di ringkasan. Saat
    PAID: WA pemesan = bukti bayar + catatan hadiah; **WA penerima =
    e-tiket link status ber-QR** (`sendBookingGiftWa`, best-effort, tanpa
    halaman klaim sesuai keputusan owner). Resend-WA dashboard mengirim
    ulang KEDUANYA. Status publik + baris "Hadiah untuk"; **lookup loket &
    dialog redeem menampilkan 🎁 nama penerima**.
  - D1 Voucher batch: TIDAK butuh kode baru — jalur A3 (generate) + B/C
    (redeem) terbukti E2E.
  - **E2E live dev**: booking hadiah + voucher sekali-pakai → sukses
    (diskon 15rb, payable 60rb); gift tanpa pasangan → 400; voucher
    dipakai orang lain → 422 "Kuota kode promo sudah habis"; webhook PAID
    net → terbayar + captured; status publik menampilkan gift+diskon+
    payable; kolom DB terisi (phone penerima ternormalisasi 62…);
    cleanup 0 sisa.
  - Sisa di luar epic (fase lanjut, lihat Fase E): loyalty CRM masuk
    engine, targeting per produk, scope `ticketing_loket` (enum sudah
    siap, konsumen belum), stacking multi-kode, pensiun tabel legacy
    pos_vouchers. QA owner: lihat catatan QA kasir POS di log Fase C.
