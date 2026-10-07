# EPIC-011: CRM Revamp — Member Global, XP Lifetime, ARK Coin & Portal Member

status: ready-for-qa
environment: dev
retries: 0

## Goal

Merombak total modul CRM menjadi sistem loyalty berbasis **identitas member
global lintas tenant**: XP sebagai skor seumur hidup (append-only, penentu
tier), ARK Coin sebagai satu-satunya jalur perolehan XP, dua tipe member
(terdaftar vs kartu), dan portal member self-service
(`member.suluindwounderland.com`) dengan login OTP WhatsApp. Menjadi fondasi
untuk Omnichannel CRM (broadcast, inbox WA) yang menyusul di epic berikutnya.

## Keputusan Owner (2026-07-19)

Hasil diskusi desain — SEMUA sudah diputuskan owner:

1. **Identitas member GLOBAL lintas tenant** — member, saldo ARK, XP hidup di
   level platform (bukan per venue). `pos_customers` tanpa `company_id` adalah
   by design. Konsekuensi: setiap transaksi wallet/XP/order wajib mencatat
   venue/tenant kejadian untuk laporan rekonsiliasi antar-venue.
2. **XP = skor seumur hidup**: hanya bertambah, TIDAK PERNAH berkurang.
   Konsep `current_xp`/`spent_xp` dihapus; ledger jadi append-only earn.
3. **XP hanya dari belanja dengan metode ARK Coin.** Metode pembayaran TIDAK
   boleh campur — 1 pembayaran = 1 metode. (Split bill antar orang tetap boleh;
   tiap split dibayar 1 metode; XP keluar untuk split yang dibayar ARK.)
4. **"Redeem" berubah jadi privilege**: produk khusus bersyarat `min_xp`
   (dan/atau min tier). Member yang memenuhi boleh membeli (bayar normal), XP
   tidak dipotong. Alur `crm_rewards` + `crm_redemptions` lama PENSIUN.
   **REVISI Fase F (19 Jul 2026, keputusan owner):** alur reward DIHIDUPKAN
   kembali dengan semantik yang benar — `crm_rewards.xp_cost` menjadi
   `min_xp` (syarat kelayakan, TIDAK dipotong), admin mengelola reward mana
   yang bisa di-redeem dan berapa kali jatah tiap member
   (`max_redemptions_per_member` × `quota_period`). Privilege produk ber-`min_xp`
   di kasir (Fase C) tetap berjalan berdampingan — keduanya memakai prinsip
   sama: XP/tier = compliance, bukan mata uang.
5. **4 tier default: Regular, Bronze, Silver, Gold** — nama & ambang XP
   (`min_lifetime_xp`) konfigurable Super Admin (tabel `crm_membership_tiers`
   existing sudah mendukung). Regular mulai dari 0 XP (tier awal semua member).
6. **Diskon per tier TETAP ADA**, konfigurable admin — kasir wajib baca
   `discount_percent` dari konfigurasi tier, bukan hardcode (fix bug audit).
7. **Dua tipe member**: (a) member terdaftar saja (nama + HP dari POS, tanpa
   kartu, tanpa topup → tidak pernah dapat XP transaksi); (b) member kartu
   (punya kartu NFC tertaut + akses topup ARK Coin).
8. **Topup ARK Coin hanya untuk member kartu.** Bonus topup default 10%
   (topup 1jt → saldo 1,1jt), persentase konfigurable Super Admin. Bonus
   dicatat sebagai transaksi wallet terpisah (`topup_bonus`) untuk akuntansi.
   ARK Coin **non-refundable**.
9. **Portal member** `member.suluindwounderland.com`, login **OTP WhatsApp**
   (via Fonnte existing). Member melengkapi profil → 100% komplit dapat
   **Free XP** (nominal konfigurable Super Admin, sekali seumur hidup,
   idempotent). Free XP berlaku untuk SEMUA member (satu-satunya pengecualian
   aturan tanpa-kartu-tanpa-XP).
10. **Field profil member**: nama, HP (verified via OTP), email, tanggal
    lahir, jenis kelamin, kota/domisili, foto profil, consent promo WA.
11. **Top spender = nilai belanja/order** (ARK maupun tunai/QRIS). Topup TIDAK
    dihitung spend (fix bug existing di route topup yang menambah
    `total_spent`). Porsi bonus ikut terhitung saat dibelanjakan. Laporan
    frequent visitor (visit_count/last_visit) dipertahankan.
12. **Collectible artwork per venue** — masih rancangan, TIDAK masuk scope
    epic ini (infra `crm_collectible_avatars` + inventory existing jadi bahan
    nanti).

## Aset Existing yang Dipertahankan vs Pensiun

| Dipertahankan (diperluas) | Pensiun / berubah total |
|---|---|
| `pos_customers` (+ tipe member, profil lengkap) | `crm_rewards` + `crm_redemptions` (ganti: produk khusus ber-syarat XP) |
| Wallet + `pos_wallet_transactions` (+ venue, + `topup_bonus`) | `current_xp`/`spent_xp` di `crm_member_profiles` |
| `crm_membership_tiers` (name/rank/min_lifetime_xp/discount_percent) | Map `TIER_DISCOUNTS` hardcoded di kasir |
| `crm_xp_ledger` (jadi append-only earn) | Alur `awardCrmXpForPosOrder` tanpa cek metode bayar |
| `crm_xp_rules` (basis besaran XP per Rp) | Split payment multi-metode dalam 1 pembayaran |
| RPC `update_ark_coin_balance` (pola atomik) | Topup menambah `total_spent` |
| Topup POS + NFC (`nfc_uid`) + struk | |
| Laporan top spender & frequent visitor | |

## Fase

### Fase A — Fondasi data & fix kritikal
- Migrasi skema: tipe member (terdaftar/kartu), kolom venue di wallet/XP/order,
  field profil + consent, hapus konsep current/spent XP, tabel konfigurasi CRM
  (bonus topup %, free XP, dst).
- Fix bug audit yang tetap relevan: diskon tier dari konfigurasi (bukan
  hardcode), role check endpoint konfigurasi CRM, topup tidak menambah
  `total_spent`, topup atomik via pola RPC, cache customer kasir refresh
  setelah transaksi, search member, error message leakage.

### Fase B — Engine XP & tier baru
- XP earn hanya dari pembayaran ARK Coin (cek metode; split per-metode).
- Auto-naik-tier saat lifetime XP menembus ambang.
- UI konfigurasi Super Admin: tier (rename, ambang, diskon), XP rules, bonus
  topup %, free XP.
- Enforcement 1 pembayaran = 1 metode di kasir.

### Fase C — Topup & member kartu
- Topup member-only (member kartu), bonus % dari konfigurasi, transaksi
  `topup_bonus` terpisah, penautan kartu NFC = upgrade member kartu.
- Produk khusus ber-syarat min XP/tier di kasir.

### Fase D — Portal member
- `member.suluindwounderland.com`: login OTP WA (Fonnte), lihat saldo/XP/tier,
  lengkapi profil (progress %), Free XP saat 100% (idempotent), riwayat
  transaksi.

### Fase E — Laporan & rekonsiliasi
- Top spender (basis order), frequent visitor, laporan rekonsiliasi
  antar-venue (topup di A dibelanjakan di B), dashboard CRM menyesuaikan
  skema baru.

### Fase F — Reward redeem berbasis syarat XP
- `min_xp` sebagai ambang kelayakan (XP tidak dipotong), kuota per member
  (`max_redemptions_per_member` × `quota_period`: total/harian/bulanan/tahunan),
  stok global, dan toggle aktif — semuanya dikelola admin di `/dashboard/crm/rewards`.
- Dua kanal redeem: member mengajukan dari portal (status `pending`, perlu
  approve) dan kasir/admin mengklaim langsung di venue (langsung `fulfilled`).

## Acceptance Criteria

- Member tanpa kartu tidak pernah bertambah XP dari transaksi apa pun; Free XP
  profil 100% tetap masuk untuk semua tipe member, sekali saja.
- Belanja ARK Coin menambah XP sesuai `crm_xp_rules`; metode lain tidak.
- XP tidak pernah berkurang oleh operasi apa pun.
- Ubah `discount_percent` tier di konfigurasi → langsung berlaku di kasir.
- Topup 1jt dengan bonus 10% → saldo bertambah 1,1jt, tercatat 2 baris wallet
  (topup + topup_bonus), `total_spent` TIDAK berubah.
- Dua request redeem/topup/bayar konkuren tidak bisa double-spend saldo
  (atomik + lock).
- Login portal hanya bisa dengan OTP WA yang valid.
- Semua transaksi wallet/XP baru tercatat venue kejadiannya.

## Catatan Keterkaitan

- Prasyarat/lanjutan dari analisa Omnichannel CRM (Qontak) — outbox WA +
  broadcast + inbox 2-arah menyusul sebagai epic terpisah setelah epic ini.
  Nomor WA terverifikasi OTP dari portal member = kunci penghubung inbox.
- Temuan audit CRM 19 Jul 2026 (10 bug): sebagian larut dalam rombakan
  (race XP spend, formula loyalty_score), sisanya masuk Fase A.

## Automation Log

- 2026-07-19 — Epic dibuat dari hasil diskusi desain owner (12 keputusan
  terkunci, lihat bagian Keputusan Owner). Status backlog — menunggu owner
  menandai on-progress.
- 2026-07-19 — **Fase A SELESAI.** Migrasi
  `20260719170000_crm_revamp_fase_a.sql` + `20260719171000_crm_seed_default_tiers.sql`
  diterapkan ke dev:
  - `pos_customers`: `member_type` (registered/card, backfill dari `nfc_uid`),
    `card_issued_at`, profil (`birth_date`, `gender`, `city`, `photo_url`),
    `wa_consent`, `wa_verified_at`, `profile_completed_at`,
    `free_xp_granted_at`; default tier baru = `regular`.
  - Tier `Regular` rank 0 (check rank dilonggarkan ke >=0) + seed default
    Bronze/Silver/Gold (tabel tier dev ternyata kosong sebelumnya).
  - Kolom venue `company_id`+`branch_id` di `pos_wallet_transactions`,
    `crm_xp_ledger`, `pos_orders` (+index) — FK ke `configuration.companies/branches`.
  - `crm.crm_settings` (key-value): `topup_bonus_percent`=10,
    `profile_completion_free_xp`=100, `default_company_id`/`default_branch_id`
    terisi otomatis dari hierarchy (single-venue Sulu).
  - RPC `public.process_ark_topup`: topup atomik (FOR UPDATE), TIDAK menambah
    `total_spent`, stempel venue; route `POST /api/pos/topup` memakainya.
  - Fix audit: diskon tier kasir dibaca dari `crm_membership_tiers` via
    `/api/pos/customers` (`discount_percent`), map `TIER_DISCOUNTS` hardcode
    dihapus; role guard `requireCrmConfigRole` (super_admin) di POST/DELETE
    tiers/rewards/xp-rules/avatars; kasir `refetchCustomers()` di semua jalur
    sukses bayar (incl. split); search members mencakup nama/phone/email;
    `apiErrorResponse` tidak lagi membocorkan pesan error internal (log
    server saja), catch-all route customers/topup dibuat generik.
  - Penautan NFC di POST customers otomatis set `member_type='card'` +
    `card_issued_at`.
  - CATATAN: `current_xp`/`spent_xp` sengaja belum di-drop — engine lama masih
    membacanya; drop di Fase B saat rewrite engine XP.
  - Gate: 489 unit test hijau (68 file), `next build` sukses, tsc error count
    identik baseline (466 noise lama, 0 baru).
- 2026-07-19 — **Fase B SELESAI.** Engine XP lifetime + konfigurasi Super Admin:
  - Migrasi `20260719180000_crm_revamp_fase_b.sql` diterapkan ke dev: drop
    `current_xp`/`spent_xp` di `crm_member_profiles`, drop `current_xp` di
    `pos_customers`, drop RPC legacy `pos_create_order_transaction` (memberi XP
    untuk semua metode bayar — jalur XP liar).
  - Engine XP baru di `src/lib/crm/loyalty-engine.ts`: XP earn HANYA dari
    pembayaran `ark_coin` (`isXpEligiblePayment`), lifetime XP append-only,
    auto-naik-tier saat `total_xp` menembus `min_lifetime_xp` (tanpa turun
    tier), stempel venue di `crm_xp_ledger`.
  - Enforcement 1 pembayaran = 1 metode di semua jalur bayar (`/api/pos/orders`
    create langsung-bayar, `[id]` pay, split pay): ARK Coin tidak boleh campur
    metode lain dan wajib menutup total; debit wallet atomik via
    `update_ark_coin_balance` SEBELUM order ditandai paid (fix bug: checkout
    langsung sebelumnya tidak pernah memotong saldo ARK).
  - Alur potong-XP PENSIUN: `POST /api/crm/redemptions` dan aksi `redeem` di
    avatar-inventory kini 410 Gone; UI redeem reward + beli avatar di detail
    member dihapus (riwayat redemption lama tetap tampil sebagai arsip).
  - Halaman konfigurasi Super Admin baru `/dashboard/crm/settings`
    (`src/features/crm/settings/`): kelola tier (nama, ambang XP, diskon %,
    warna, aktif), XP rules, bonus topup %, free XP profil — via API baru
    `GET/PUT /api/crm/settings` (guard super_admin) + API tiers/xp-rules
    existing. Quick link "Konfigurasi" ditambah di dashboard CRM.
  - Bersih-bersih referensi `current_xp`/`spent_xp` di seluruh codebase
    (routes customers/members/dashboard/lookup, types, hooks, UI kasir/topup/
    table-order/CRM); default tier "bronze" → "regular"; `CRM_DEFAULT_TIERS`
    fallback kini menyertakan Regular rank 0.
  - Gate: 489 unit test hijau (68 file), `next build` sukses, tsc 458 error
    (baseline lama 466, 0 baru — turun karena kode legacy terhapus).
  - Sisa ke Fase C: topup member-kartu-only + bonus % dari settings dipakai
    route topup, produk privilege min XP/tier di kasir.
- 2026-07-19 — **Fase B di-deploy ke dev (sulu.within.ventures) + menu sidebar.**
  - Deploy: `next build` (BUILD_ID 11:10) + `pm2 restart arkiv-pos-saas`
    (`next start -p 3459`, Cloudflare Tunnel `sulu.within.ventures` → :3459).
    Migrasi Fase B sudah masuk DB dev (postgres :5435 `arkiv_local`).
  - Menu sidebar baru via migrasi `20260719190000_crm_settings_menu.sql`
    (diterapkan ke dev): grup `crm.settings` "Pengaturan" (level 2, parent
    `crm`) + item `crm.settings.config` "CRM Settings" →
    `/dashboard/crm/settings`, grant HANYA `super_admin` (selaras guard
    `requireCrmConfigRole`). Commit `4ac06f3`; Fase B utama di `e6e731b`.
  - Status: menunggu hasil UAT owner di dev. Skenario tes yang disepakati:
    (1) ubah tier/XP rules/bonus topup %/free XP di `/dashboard/crm/settings`
    lalu verifikasi tersimpan + ditolak untuk non-super-admin;
    (2) bayar full ARK Coin → `total_xp` naik sesuai rules, saldo terpotong;
    (3) bayar tunai/QRIS → XP TIDAK naik (stats kunjungan tetap naik);
    (4) campur ARK + metode lain → ditolak; saldo ARK kurang → ditolak tanpa
    order/saldo berubah; split per-metode (split ARK dapat XP);
    (5) auto-naik-tier saat lifetime XP tembus ambang (tidak pernah turun);
    (6) redeem reward/beli avatar sudah hilang dari detail member.
  - LANJUTKAN DARI SINI → **Fase C**: (a) topup hanya untuk member kartu
    (`member_type='card'`) — route `POST /api/pos/topup` saat ini belum
    menolak member terdaftar; (b) bonus topup dibaca dari
    `crm_settings.topup_bonus_percent` (RPC `process_ark_topup` masih pakai
    nilai parameter/default) + baris wallet `topup_bonus` terpisah;
    (c) penautan kartu NFC = upgrade `member_type` ke `card` (POST customers
    sudah set — verifikasi jalur update/edit); (d) produk privilege
    ber-syarat `min_xp`/tier di kasir (pengganti redeem, butuh skema kolom
    syarat di produk + filter kasir).
- 2026-07-19 — **Fase C SELESAI.** Migrasi `20260719210000_crm_revamp_fase_c.sql`
  (applied+tracked):
  - **RPC `process_ark_topup` v2**: tolak member non-kartu
    (`CARD_MEMBER_ONLY` → route 403 "tautkan kartu NFC dulu"), parameter
    `p_bonus_percent`, bonus dicatat baris wallet `topup_bonus` TERPISAH
    (non-refundable, tak menambah total_spent). GOTCHA penting: signature
    lama WAJIB di-DROP — parameter baru = overload, pemanggil 6-arg akan
    tetap kena fungsi lama tanpa cek kartu (tertangkap saat verifikasi,
    DROP dimasukkan ke migrasi). Route topup membaca
    `crm_settings.topup_bonus_percent` via helper `getCrmTopupBonusPercent`.
    Diverifikasi psql (tx rollback): registered ditolak; card topup 100rb
    bonus 10% → saldo 110rb, 2 baris wallet, total_spent tetap 0.
  - **(c) penautan NFC jalur update**: diverifikasi POST /api/pos/customers
    meng-upgrade `member_type='card'` + `card_issued_at` di JALUR create
    maupun update-existing; PATCH members CRM tidak menyentuh nfc (tidak
    ada jalur lain). Tanpa perubahan kode.
  - **(d) produk privilege `min_xp`** (keputusan desain: min_tier TIDAK
    dibuat — tier = fungsi lifetime XP, min_xp sudah ekuivalen):
    kolom `pos_products.min_xp` (NULL = umum); guard server
    `checkProductPrivileges` (lib baru + 5 unit test) di TIGA titik
    pembuatan order: POST /api/pos/orders, open-bill, table-order publik
    (QR tanpa member otomatis tertolak) → 403 dgn pesan produk+syarat+XP
    member; admin: kolom "Min XP" inline-edit di halaman POS Products
    (PATCH whitelist + POST create); kasir: badge ★/🔒 "N XP" di kartu
    produk, terkunci+toast bila member belum dipilih/XP kurang.
    Diverifikasi curl: order produk privilege tanpa member → 403.
  - Gate: unit test crm hijau, next build sukses, PM2 restart dev.
  - Sisa ke Fase D: portal member (OTP WA Fonnte, profil, Free XP) — lihat
    bagian Fase; Fase E laporan/rekonsiliasi.
- 2026-07-19 — **Fase D SELESAI: Portal Member.** Migrasi
  `20260719230000_crm_revamp_fase_d_portal.sql` (applied+tracked):
  `crm.member_portal_otp` (hash sha256, TTL 5 mnt, max 5 percobaan, rate
  limit 3/10 mnt/nomor) + `crm.member_portal_sessions` (token 32-byte,
  DB simpan hash, TTL 30 hari; cookie `member_session` httpOnly TERPISAH
  dari arkiv_session).
  - **Login OTP WA**: POST /api/member-portal/otp (hanya nomor member
    terdaftar; kirim via Fonnte `sendWhatsApp`; tanpa FONNTE_API_KEY kode
    tercetak di log server utk dev) → /verify (konsumsi kode, stempel
    `wa_verified_at`, set cookie sesi). Lookup nomor toleran format
    08xx/62xx (regexp_replace digit).
  - **API member**: /me (profil+saldo+XP+tier+progres tier berikutnya+
    kelengkapan profil), PUT /profile (zod; nomor HP TIDAK bisa diubah —
    identitas login), /transactions (wallet+order milik sendiri), /logout.
  - **Free XP profil 100%**: engine `awardMemberFreeXp` (TANPA multiplier
    tier, idempotent ledger `portal:profile-complete:<id>` + kolom
    `free_xp_granted_at`). BUG tertangkap saat uji: lupa
    `syncPosCustomerAfterEarn` → ledger terisi tapi total_xp 0 — difix;
    verifikasi ulang: Free XP 100 masuk total_xp DAN tier auto-naik
    regular→bronze.
  - **Routing subdomain**: proxy.ts rewrite host `member.*` → /member
    (API & _next tak disentuh); middleware publicRoutes + `/member` +
    `/api/member-portal`. ⚠ INFRA di luar repo: tambahkan ingress
    Cloudflare Tunnel `member.suluindwounderland.com` → :3459.
  - **UI /member** (mobile-first, layout mandiri): login 2 langkah
    (nomor→OTP), kartu saldo/tier/progres XP, banner Free XP, tab
    Beranda/Profil/Riwayat, form profil + consent WA (switch), riwayat
    wallet & pembelian, logout.
  - Verifikasi end-to-end dev via curl: OTP nomor asing 404 → nomor
    member terkirim → kode salah 400 → benar = sesi → me 200 → profil
    100% = +100 Free XP (ulang = 0, tidak dobel) → logout = 401.
    Data uji dibersihkan. Gate: 63 unit test hijau, build sukses.
  - CATATAN: kolom `wa_consent` ber-default false di DB → field consent
    selalu "terisi" utk member baru (kelengkapan efektif 7 field); dinilai
    aman (default opt-out). Upload foto profil = URL dulu; file upload
    menyusul. Sisa: Fase E laporan & rekonsiliasi antar-venue.
- 2026-07-19 — **Fase E SELESAI: Laporan & Rekonsiliasi — SEMUA FASE A–E
  TUNTAS.** Migrasi `20260720000000_crm_revamp_fase_e.sql` (applied+tracked):
  - **RPC `update_ark_coin_balance` v2 stempel venue**: fix gap acceptance —
    baris wallet `payment` sebelumnya TANPA venue. Venue = eksplisit param >
    derive dari `p_order_id` (pos_orders) > default venue `crm_settings`.
    GOTCHA Fase C diulang dengan benar: signature lama 5-arg di-DROP dulu
    (anti-overload). Backfill venue baris wallet lama dari order terkait /
    default venue + index `(company_id, branch_id, created_at)` dan
    `(customer_id, payment_status, created_at)`. Diverifikasi psql (tx
    rollback): debit payment tanpa venue eksplisit → baris wallet tetap
    ber-venue (fallback settings).
  - **Gap ikutan difix**: route table-order (QR publik) tidak menstempel
    venue di pos_orders + debit wallet-nya — kini keduanya via
    `getCrmDefaultVenue`.
  - **API `GET /api/crm/reports?from&to`** (guard role super_admin/admin/
    direksi = `requireCrmReportRole`): top spender BASIS ORDER paid (semua
    metode, topup tak dihitung — keputusan #11, exclude status
    cancelled/voided), frequent visitor (hari kunjungan distinct per zona
    Asia/Jakarta + lifetime visit_count), rekonsiliasi per venue dari
    wallet (topup/bonus/spend/net = topup+bonus-spend), saldo ARK beredar
    (liabilitas platform), breakdown member kartu vs terdaftar. Helper pure
    `src/lib/crm/reports.ts` + 12 unit test (periode default bulan berjalan,
    to-eksklusif +1 hari, max 366 hari).
  - BUG tertangkap saat verifikasi SQL: `COALESCE(o.status,'')` meledak
    (enum `pos_order_status` tak menerima '') — difix jadi
    `o.status IS NULL OR o.status NOT IN ('cancelled','voided')`
    (nilai enum riil: voided, BUKAN void; refunded tidak ada).
  - **UI `/dashboard/crm/reports`** (`src/features/crm/reports/`): filter
    periode (preset Bulan ini / 30 hari), 6 kartu ringkasan, tabel
    rekonsiliasi antar-venue + total, leaderboard Top Spender & Frequent
    Visitor. Menu sidebar `crm.reports`/`crm.reports.overview` (grant
    super_admin+admin+direksi, selaras menu CRM lain).
  - **Dashboard CRM disesuaikan skema baru**: stat cards kini Customers /
    Member Kartu / Member Terdaftar / Saldo ARK Beredar / XP Rules / Tiers
    (Rewards & Partner Events dilepas dari kartu), API dashboard tambah
    `cardMembers`/`registeredMembers`/`arkOutstanding`, tierLabel fallback
    "Regular" (bukan Bronze), tombol Laporan di header.
  - Gate: 513 unit test hijau (71 file), `next build` sukses (route
    `/api/crm/reports` + `/dashboard/crm/reports` ter-generate), tsc 0 error
    baru (459 = noise lama; 1 error `server.ts:153` pre-existing dari Fase
    C). Deploy dev: build + `pm2 restart arkiv-pos-saas`; smoke: API 401
    tanpa sesi, halaman terlayani.
- 2026-07-19 — **Fix lanjutan pasca-UAT: "update tier invalid" di
  /dashboard/crm + restrukturisasi dashboard.** Akar masalah: panel
  konfigurasi tier di dashboard (legacy pra-Fase B) memaksa
  `rank: Math.max(1, ...)` + input Rank `min=1`/`|| 1` — menyimpan tier
  Regular (rank 0, Fase A) memaksa rank jadi 1 yang bentrok UNIQUE
  `crm_membership_tiers_rank_key` (rank 1 = Bronze) → 500. Panel juga
  tampil untuk admin/direksi padahal API konfigurasi super_admin-only
  (selalu 403), plus bug audit lama draft-ketimpa-refetch.
  Keputusan owner: **restrukturisasi** (bukan quick fix) — dashboard CRM
  jadi monitoring murni (stats, leaderboard, XP activity; panel
  Konfigurasi Tier & Konfigurasi XP POS DIHAPUS), satu-satunya fitur unik
  panel lama (editor XP per produk) DIPINDAH ke `/dashboard/crm/settings`
  (seksi "XP Produk" baru: pencarian nama/SKU/kategori, render max 30,
  PATCH `xp_points`). Halaman settings = satu-satunya tempat konfigurasi
  (rank 0 ditangani benar di sana — rename tier owner sebelumnya berhasil
  lewat halaman ini). Cleanup: `features/crm/dashboard` dirampingkan
  (mutations.ts dihapus, api/queries/types konfigurasi dibuang), baris
  "Reward catalog" dihapus dari Foundation Status (alur reward pensiun).
  Gate: 513 unit test hijau, build sukses, tsc 459 (0 baru), deploy dev
  PM2 restart, halaman dashboard+settings 200.
  - Status epic → **ready-for-qa**. UAT owner tersisa: (1) skenario Fase B
    (lihat entri deploy Fase B); (2) buka `/dashboard/crm/reports` sebagai
    super_admin/admin/direksi — filter periode, angka rekonsiliasi cocok
    dengan topup/belanja uji; (3) role lain tidak melihat menu Laporan; (4)
    infra di luar repo: ingress Cloudflare Tunnel
    `member.suluindwounderland.com` → :3459 masih perlu ditambahkan.
- 2026-07-19 — **Fix minor pasca-analisa: benefits jsonb + fallback tier
  regular.** (1) `POST /api/crm/tiers` mengirim array JS mentah ke kolom
  jsonb `benefits` — driver pg menserialisasinya jadi literal array
  Postgres sehingga `[]` tersimpan `{}` (objek) dan benefits non-kosong
  akan gagal insert; fix: `JSON.stringify(payload.benefits)` sebelum
  upsert + delta `20260720010000_crm_fix_tier_benefits_jsonb.sql`
  menormalkan data existing ke `[]` (sudah diterapkan ke dev DB, 4 baris
  tier kini bertipe array). (2) Fallback tier UI "bronze"/"Bronze"
  disamakan ke "regular"/"Regular" (keputusan owner #5, Regular = tier
  awal): `crm-members-page.tsx`, `crm-member-detail-page.tsx`, dan
  `topup-page.tsx` (badge class, pembuatan customer baru dari topup, 2
  label fallback). Verifikasi update tier via API sebagai super_admin:
  Regular rank 0 sukses (bug "update tier invalid" tuntas — tidak
  reproduce lagi setelah restrukturisasi c6e9f49).
  Gate: 513 unit test hijau, `next build` sukses, migrasi applied, PM2
  restart; smoke: POST tier benefits `["smoke-test"]` tersimpan sebagai
  JSON array lalu direstorasi `[]`.
- 2026-07-19 — **Fase F SELESAI: Reward redeem berbasis syarat XP (revisi
  keputusan #4).** Owner meminta reward bisa di-redeem member dengan XP
  sebagai syarat compliance, bukan biaya — konsisten dengan keputusan #2
  (XP tidak pernah berkurang). Migrasi
  `20260720020000_crm_revamp_fase_f_rewards.sql` (sudah diterapkan ke dev):
  `crm_rewards.xp_cost` → `min_xp` (+ constraint baru), kolom `quota_period`
  (total|daily|monthly|yearly), `crm_redemptions.xp_cost` →
  `min_xp_at_redeem` (snapshot audit), kolom `channel` (portal|admin),
  `total_xp_at_redeem`, `requested_by_user_id`, `processed_by_user_id`,
  `member_id` jadi nullable + `customer_id` NOT NULL (sumber kebenaran
  member sejak Fase B adalah `pos_customers`), indeks kuota
  `(customer_id, reward_id, requested_at DESC)`.
  - Mesin aturan: `src/lib/crm/rewards.ts` (fungsi murni
    `evaluateRewardEligibility` + `quotaWindowStart`) dengan 14 unit test di
    `rewards.test.ts` — menutup ambang XP inklusif, kuota per periode, stok,
    tier, status nonaktif, dan rentang tanggal.
  - Sisi server: `src/lib/crm/rewards-server.ts` — `createRedemption` memakai
    transaksi + `SELECT ... FOR UPDATE OF r` pada baris reward lalu
    mengevaluasi ulang kelayakan di dalam transaksi, sehingga dua permintaan
    konkuren tidak bisa menembus stok/kuota (acceptance criteria "atomik +
    lock"). Stok ditahan sejak status `pending` dan dikembalikan saat
    `cancel`. `evaluateCatalogForMember` menghitung kuota seluruh katalog
    dalam 1 query (hindari N+1).
  - API: `POST/PATCH /api/crm/redemptions` dihidupkan kembali (dulu 410 Gone)
    dengan guard `requireCrmOperator` (super_admin/admin/pos/pos_supervisor —
    klaim reward operasi harian, bukan konfigurasi); GET menerima filter
    `status`/`customer_id`/`member_id` dan tetap mengembalikan objek `reward`
    bersarang agar detail member lama tidak rusak. Baru:
    `GET/POST /api/member-portal/rewards` (katalog + kelayakan + riwayat, dan
    pengajuan redeem oleh member).
  - UI: `/dashboard/crm/rewards` dirombak — 2 tab (Katalog Reward &
    Permintaan Redeem dengan badge jumlah pending), form dikelompokkan jadi
    "Syarat kelayakan" (Min XP + tier) dan "Batas pengambilan" (stok, maks per
    member, periode kuota), banner penjelas "XP tidak dipotong saat redeem",
    dan aksi Setujui/Serahkan/Batalkan. Portal member dapat tab "Reward"
    (`member-rewards-card.tsx`): tiap reward menampilkan syarat XP, sisa
    jatah, alasan bila belum layak (mis. "kurang 800 XP"), plus daftar
    "Reward Saya" berstatus.
  - Detail member: kolom redemption yang dulu tampil `-XP` (menyiratkan
    potongan) diganti "syarat N XP"; tipe `CrmRedemption.xp_cost` →
    `min_xp_at_redeem`, `CrmReward.xp_cost` → `min_xp`.
  - Gate: 527 unit test hijau (72 file), `next build` sukses, tsc tanpa error
    baru (sisa 1 pre-existing di `server.ts` yang hanya bergeser barisnya),
    migrasi applied, PM2 restart (PID baru melayani :3459).
  - Verifikasi DB: query `getMemberContext` benar (member uji 12.000 XP →
    tier rank 2), insert redemption portal sukses
    (`RDM-20260719-1AAA776F`), hitung kuota bulanan = 1 sehingga jatah
    berikutnya tertutup, dan **`total_xp` tetap 12.000 setelah redeem** —
    tidak ada trigger pemotong XP di `crm_redemptions`/`crm_rewards`.
  - Data dev disiapkan untuk UAT: 3 reward contoh — `voucher-kopi` (min 0 XP,
    1x/bulan, stok 100), `merch-tumbler` (min 10.000 XP, 1x total, stok 20),
    `diskon-ultah` (min 30.000 XP + tier Gold, 1x/tahun) — plus member uji
    "Budi Uji Reward" (628111222333, 12.000 XP) dengan 1 permintaan pending
    agar tab approval bisa dicoba.
  - UAT owner: (1) `/dashboard/crm/rewards` → tab Katalog, ubah kuota/periode
    sebuah reward, pastikan tersimpan; (2) tab Permintaan Redeem → Setujui
    lalu Serahkan permintaan Budi, cek status berubah; (3) login portal
    `member.within.ventures` sebagai member ber-XP → tab Reward, pastikan
    reward di atas ambang XP terkunci dengan alasan jelas dan yang layak bisa
    ditukar; (4) redeem 2x reward berkuota 1x/bulan → percobaan kedua ditolak;
    (5) pastikan XP member TIDAK berubah setelah redeem.
- 2026-07-19 — **Fase F: gate review & security dijalankan, semua temuan
  HIGH/MEDIUM ditutup.** Dua reviewer paralel (security + typescript) menelaah
  diff Fase F. Perbaikan yang diterapkan:
  - **HIGH (security) — `GET /api/crm/redemptions` bocor PII.** Endpoint hanya
    cek `getPosSession()` sementara respons barunya memuat nama/telepon/XP
    customer, sehingga peran mana pun yang login (mis. `warehouse_staff`)
    bisa memanen kontak seluruh member. Ditambah guard `requireCrmReader`
    (`CRM_READ_ROLES` = operator + `direksi` untuk kebutuhan laporan);
    `requireCrmOperator`/`requireCrmReader` kini berbagi helper
    `requireCrmRoles`. Diverifikasi: tanpa auth → 401.
  - **HIGH (security) — tidak ada rate limit di redeem portal.** Tiap POST
    memakai 1 koneksi dari pool global (`max: 10`) yang dipakai seluruh
    aplikasi, jadi flood bisa membuat POS/HRIS ikut kehabisan koneksi.
    Ditambah `checkRedeemRateLimit` (10 percobaan/menit per member, jendela
    bergulir in-memory, pola selaras rate limit OTP Fase D) → HTTP 429 +
    header `Retry-After`. Diverifikasi live: 12 permintaan beruntun →
    `409 ×10` lalu `429 ×2`.
  - **HIGH (review) — `quotaWindowStart` bergantung TZ host.** Semula memakai
    getter `Date` lokal, padahal konvensi repo (`hris/shifts.ts`,
    `kpi/*`) memakai aritmetika UTC + `WIB_OFFSET_HOURS`. Bila di-deploy ke
    container ber-TZ UTC, batas kuota harian/bulanan meleset 7 jam. Ditulis
    ulang memakai `Date.UTC` + offset WIB eksplisit; tes diubah memakai instan
    absolut `+07:00` dan **lulus di `TZ=UTC` maupun `TZ=Asia/Jakarta`**
    (sebelumnya hanya lulus di WIB), plus kasus dini hari & pergantian bulan.
  - **HIGH (review) — riwayat redemption bisa hilang di detail member.**
    `members/api.ts` memfilter `?member_id=` padahal Fase F membuat kolom itu
    nullable (member portal tanpa profil CRM → `member_id` NULL), dan
    redemption hanya diambil bila member punya profil CRM. Diubah ke
    `?customer_id=` dan selalu diambil; inventory avatar tetap `member_id`
    (tabel terpisah).
  - **MEDIUM (security) — reward tipe `avatar` bisa diselundupkan.**
    `getRewardById` tidak memfilter tipe, sehingga id avatar yang dikirim
    langsung bisa masuk alur redemption. Ditambah blocker `not_redeemable` di
    `evaluateRewardEligibility`. Diverifikasi live: avatar tidak muncul di
    katalog portal dan POST dengan id avatar → "Reward ini tidak bisa
    ditukar".
  - **MEDIUM (review) — kanal klaim kasir tidak punya UI.** Keputusan owner
    "keduanya" baru terpenuhi di backend. Ditambah panel **Klaim Reward di
    Venue** pada tab Permintaan Redeem (cari member ber-debounce 300ms via
    `/api/crm/members`, pilih reward aktif, klaim → langsung `fulfilled`),
    hook `useClaimRedemption`/`useClaimMembers`. Pesan usang "redeem sudah
    dipensiunkan" di detail member diganti + tautan ke halaman Rewards.
  - **LOW — hardening.** Kolom timestamp pada `updateRedemptionStatus` tidak
    lagi dirangkai dari input: dipetakan lewat whitelist `TRANSITIONS`
    (`as const satisfies`) dengan penolakan aksi tak dikenal di dalam fungsi;
    param `limit` pada GET redemptions divalidasi `Number.isFinite` + batas
    bawah 1.
  - Tidak diubah (diterima sebagai risiko rendah): kemungkinan double-click
    tombol Tukar — sudah dijaga transaksi ber-lock sehingga hanya memunculkan
    error 409 duplikat, bukan double-redeem; serta pola `rows as X` pada
    akses pg yang konsisten dengan seluruh repo.
  - Gate ulang: **534 unit test hijau** (72 file, +7 test baru untuk avatar,
    rate limit, dan batas WIB), `next build` sukses, tsc tanpa error baru,
    PM2 restart, smoke `/member` `/login` 200 & kedua API 401 tanpa auth.
  - Data uji dibersihkan (member/reward/sesi avatar dihapus); tersisa 3 reward
    contoh + member "Budi Uji Reward" dengan 2 redemption pending untuk UAT.
- 2026-07-19 — **OTP WhatsApp LIVE via gateway mandiri.** Rangkaian keputusan
  provider: Fonnte (runbook dibuat, lalu ditemukan URL API-nya salah/404 dan
  kode OTP bocor ke log — keduanya di-fix `793506d`) → owner pilih Meta Cloud
  API resmi (lapisan provider + template AUTHENTICATION dibangun, `8261ee8`)
  → verifikasi bisnis Meta dinilai terlalu lama → owner putuskan **bangun
  gateway sendiri** (`dd9ce10`): `services/wa-gateway`, Baileys 6.7.23 pinned,
  proses PM2 terpisah agar sesi tahan deploy, sesi persisten, kirim serial
  berjeda acak 1,5–3,5 dtk, HTTP hanya 127.0.0.1 + token (di `.env` service,
  gitignored). Halaman pairing **Settings → WhatsApp Gateway** (super_admin
  only, QR dirender lokal qrcode.react, poll 4 dtk) di `acd5605` + migrasi
  menu `20260720030000`. Nomor sender +6285880974659 (keputusan owner,
  `f87c115`) di-pairing owner 19 Jul ± 19:11 WIB.
  - **Verifikasi live:** `/health` connected sebagai 6285880974659; kirim tes
    via gateway sukses (messageId `3EB0CA7EA2A3C0528B4344`); alur penuh
    aplikasi → provider → gateway → WhatsApp menghasilkan `wa_delivered: true`
    pada `POST /api/member-portal/otp`. Member sementara utk uji (nomor
    sender) sudah dihapus; `pm2 save` dijalankan agar gateway hidup lagi
    setelah reboot.
  - Provider aktif: `WHATSAPP_PROVIDER=gateway`. Meta & Fonnte tetap tersedia
    lewat env yang sama. Catatan risiko & batas Fase 1 (tanpa monitoring
    otomatis, tanpa inbox masuk, tanpa fallback otomatis) di
    `docs/crm/RUNBOOK-WA-GATEWAY-MANDIRI.md`.
  - Portal member kini bisa di-UAT penuh dengan nomor WhatsApp asli — ganti
    nomor member uji ke nomor asli (SQL di runbook) lalu jalankan skenario
    UAT Fase F.
- 2026-07-25 — **Verifikasi infra portal: TIDAK ADA pekerjaan tersisa.**
  Catatan lama "ingress `member.suluindwounderland.com` belum dibuat" sudah
  BASI — keputusan berjalan memakai domain dev `within.ventures`:
  - Portal member LIVE di `https://member.within.ventures` (200, judul
    "Portal Member — Sulu in Wounderland") via tunnel `within-ventures`
    → :3459; app utama di `https://sulu.within.ventures` (307 → login, normal).
  - `proxy.ts` me-rewrite semua host `member.*` ke `/member`, jadi domain
    produksi apa pun (mis. `member.suluinwounderland.com` — perhatikan ejaan
    zona Cloudflare yang benar TANPA "d") tinggal ditambah di ingress nanti
    bila owner minta; tidak diperlukan untuk QA.
  - Portal = single page `/member` (login OTP inline) — `/login` 404 itu
    by design, bukan bug.
  - wa-gateway sehat: connected sebagai 6285880974659, uptime 4 hari.
  - Kesimpulan: EPIC-011 murni tinggal **UAT owner** (skenario Fase F di
    runbook + Fase B/laporan).
