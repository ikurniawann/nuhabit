# EPIC-022: Sales Funneling — Leads B2B (Corporate, Sekolah & Booking Acara Privat)

status: ready-for-qa
environment: dev
retries: 0

## Goal

Membangun modul **Sales Funneling** baru (menu terpisah dari CRM loyalty
existing) ala Freshsales/Freshworks yang disederhanakan, khusus untuk
**leads B2B**: corporate gathering, field trip sekolah, komunitas, dan booking
acara privat (ulang tahun, buyout venue). Kelola **prospek instansi + PIC-nya**,
dorong lewat **pipeline kanban** dari kontak pertama sampai acara ter-booking,
catat **aktivitas & follow-up** dengan pengingat WA, dan lihat **laporan
funnel** (conversion per tahap, win rate, nilai pipeline).

## Keputusan Owner (2026-07-21)

1. **Nama menu: "Sales Funneling".**
2. **Target lead = B2B/instansi**, bukan customer perorangan walk-in:
   corporate, sekolah, komunitas, travel agent, serta booking acara privat.
   Lead perorangan tetap bisa dicatat (jenis "perorangan") untuk acara privat
   seperti ulang tahun.
3. **Akses: Super Admin + role `sales` (baru).** Role `sales` belum ada di
   `iam.roles` → dibuat via delta di Fase A (preseden:
   `20260716150000_role_employee_ess.sql`). Catatan teknis: `sales` TIDAK
   dimasukkan ke `FULL_ACCESS_ROLES` (`src/lib/iam/access.ts`) — gerbang
   akses diperluas jadi route-aware agar `sales` boleh masuk
   `/dashboard/sales-funnel/*` (plus ESS-nya sendiri) tanpa membuka seluruh
   dashboard.
4. **Enam tahap pipeline default DISETUJUI**: `Prospek Baru → Dihubungi →
   Proposal/Penawaran → Nego/Survey Lokasi → Menang (Booked) → Kalah`
   (tetap konfigurable Super Admin).
5. **Pengingat WA dua arah**: follow-up jatuh tempo → WA ke penanggung
   jawab; owner dapat **rekap harian** ringkas (jumlah follow-up hari ini,
   deal macet, booking baru) — numpang infrastruktur EPIC-020 Notifikasi
   WA Owner.
6. **Scope per outlet** — setiap lead & deal terikat `outlet_id` (wajib,
   bukan nullable); filter outlet di semua list/kanban/laporan mengikuti
   scope bisnis user.

Referensi: https://www.freshworks.com/crm/sales/ — diambil 5 pilar intinya
(lead management, pipeline/deal kanban, 360° customer view, aktivitas, laporan),
DIBUANG semua yang enterprise: Freddy AI, email sequence, telephony bawaan,
territory management, forecasting kuartalan, workflow automation kompleks.
Pengganti otomasi = pengingat & template pesan via WA gateway existing.

## Prinsip Simplifikasi UMKM

1. **Satu pipeline default, tahap bisa diubah** — tidak ada multi-pipeline di
   MVP. Default 6 tahap mengikuti alur penawaran B2B venue:
   `Prospek Baru → Dihubungi → Proposal/Penawaran → Nego/Survey Lokasi →
   Menang (Booked) → Kalah`. Nama/urutan tahap konfigurable Super Admin.
2. **WA-first, bukan email-first** — UMKM Indonesia jualan lewat WA. Semua
   quick action & pengingat lewat WA gateway existing
   (`src/lib/whatsapp/gateway.ts` → `sendGatewayText()`), bukan email.
3. **Tanpa AI/skoring rumit** — lead "panas/hangat/dingin" cukup label manual.
4. **Nyambung ke ekosistem existing** — lead yang menang bisa ditautkan ke
   `pos.pos_customers` (member loyalty), sehingga 360° view menampilkan
   riwayat transaksi POS + status member CRM loyalty.
5. **Tenant-scoped** — beda dari member loyalty yang global by design
   (EPIC-011), semua tabel Sales CRM WAJIB `company_id` + `outlet_id`
   (leads/deals adalah aset bisnis per venue, bukan identitas platform).

## Fitur (Rincian)

### 1. Leads — Prospek B2B (Instansi + PIC)
- CRUD lead berorientasi instansi: **nama instansi**, **jenis instansi**
  (`corporate`, `sekolah`, `komunitas`, `travel-agent`, `pemerintah`,
  `perorangan`, `lainnya`), **PIC**: nama, jabatan, no. WA (wajib, kunci
  dedup), email opsional; kota/alamat, sumber (`wa`, `instagram`, `referral`,
  `google`, `pameran/canvassing`, `lainnya`), label suhu (panas/hangat/
  dingin), catatan, penanggung jawab (user sales).
- Satu instansi bisa punya lebih dari satu PIC (kontak sekunder opsional,
  cukup di catatan untuk MVP; tabel kontak terpisah menyusul jika perlu).
- Status lead: `baru → dihubungi → qualified → tidak-cocok`.
- Import CSV sederhana + deteksi duplikat by no. WA PIC / nama instansi.
- Konversi lead → deal (sekali klik, lead qualified otomatis buka deal di
  tahap pertama pipeline). Satu instansi bisa punya banyak deal (acara
  berulang: gathering tahunan, field trip per semester).

### 2. Pipeline & Deals — Kanban
- Papan kanban drag-and-drop per tahap (reuse pola
  `src/features/hris/pipeline/components/pipeline-page.tsx`,
  lib `@hello-pangea/dnd` sudah ada di deps).
- Kartu deal berorientasi acara: judul, **jenis acara** (`gathering`,
  `field-trip`, `ulang-tahun`, `buyout-venue`, `lainnya`), **tanggal acara
  (tentatif/fix)**, **estimasi pax**, nilai estimasi (Rp), instansi/PIC
  tertaut, penanggung jawab, umur deal di tahap (badge "macet" jika > X hari,
  X konfigurable).
- Tahap `Menang (Booked)` → wajib isi nilai final + tanggal acara fix;
  opsional tautkan PIC ke `pos_customers`. Tahap `Kalah` → wajib pilih alasan
  kalah (master konfigurable: harga, kompetitor, jadwal tidak cocok, tidak
  jadi acara, tidak respon, dll).
- Detail deal via Sheet (slide-over) berisi timeline aktivitas.

### 3. Profil Instansi 360°
- Halaman detail instansi: identitas + PIC, semua deal/acara
  (menang/kalah/berjalan) — terlihat instansi mana yang repeat order,
  timeline aktivitas, total nilai acara sepanjang riwayat, riwayat transaksi
  POS + tier member loyalty PIC (jika tertaut `pos_customers`), tombol
  Chat WA ke PIC.

### 4. Aktivitas & Follow-up
- Aktivitas per lead/deal: tipe (`telepon`, `wa`, `meeting`, `catatan`),
  due date, penanggung jawab, status selesai.
- Halaman "Follow-up Hari Ini" (agenda lintas deal, terlambat disorot).
- Pengingat WA otomatis ke penanggung jawab untuk follow-up yang jatuh
  tempo hari ini (pola cron/watcher existing ala `cs-sla-watcher.ts`).
- Template pesan WA (master sederhana) + tombol kirim cepat dari kartu deal.

### 5. Laporan Funnel
- Funnel conversion per tahap (berapa masuk, berapa lolos, % konversi).
- Win rate, total nilai pipeline berjalan, nilai menang (booking) per periode.
- Breakdown per **jenis instansi** & **jenis acara** (corporate vs sekolah vs
  privat), per sumber lead, dan per penanggung jawab (leaderboard sederhana).
- Kalender/daftar acara ter-booking ke depan (dari deal Menang + tanggal
  acara) — bahan koordinasi ke ops.
- Rekap alasan kalah.

### Non-Goals (MVP)
- Multi-pipeline, email campaign/sequence, lead scoring otomatis/AI,
  forecasting, integrasi kalender eksternal, round-robin assignment.
- Broadcast WA massal (sudah wilayah omnichannel EPIC-013).

## Desain Data (sketsa — skema `crm`, prefix `crm_sales_`)

Semua tabel: `company_id`, `outlet_id`, `created_by`, timestamps.

- `crm_sales_leads` — id, org_name, org_type (`corporate`/`sekolah`/
  `komunitas`/`travel-agent`/`pemerintah`/`perorangan`/`lainnya`), pic_name,
  pic_title, pic_phone (unik per company), pic_email, city, source,
  temperature, status, notes, owner_user_id, customer_id (nullable FK
  `pos_customers` — PIC sebagai member).
- `crm_sales_stages` — master tahap: name, sort_order, is_won, is_lost,
  stuck_threshold_days.
- `crm_sales_deals` — id, lead_id, title, event_type (`gathering`/
  `field-trip`/`ulang-tahun`/`buyout-venue`/`lainnya`), event_date,
  is_event_date_fixed, pax_estimate, stage_id, value_estimate, value_final,
  owner_user_id, lost_reason_id, entered_stage_at, closed_at.
- `crm_sales_activities` — id, deal_id/lead_id, type, due_at, done_at,
  owner_user_id, notes, reminder_sent_at.
- `crm_sales_lost_reasons` — master alasan kalah.
- `crm_sales_wa_templates` — master template pesan.

Migrasi via `database/migrations/deltas/<timestamp>_sales_crm_fase_a.sql` dst.
Menu didaftarkan via delta INSERT `iam.menus` + `iam.role_menu_permissions`
(contoh: `20260719190000_crm_settings_menu.sql`).

## Task Groups (PR-sized, 1 group = 1 branch = 1 PR)

### Fase A — Fondasi: skema DB, role `sales`, menu, Leads CRUD
- Delta migrasi: tabel + seed tahap default + **role `sales` baru di
  `iam.roles`** + menu "Sales Funneling" (group) dengan submenu Leads,
  granted ke `super_admin` + `sales`.
- Perluas gerbang akses `src/lib/iam/access.ts` (+ guard layout) jadi
  route-aware: role `sales` boleh `/dashboard/sales-funnel/*` + ESS, tanpa
  akses dashboard lain.
- Route `src/app/dashboard/(dashboard)/sales-funnel/leads`, feature
  `src/features/sales-funnel/leads/`, API `src/app/api/sales-funnel/leads`
  dengan role guard `super_admin`/`sales` (pola `src/lib/crm/server.ts`).
- Leads list (filter status/jenis instansi/sumber/owner), form dialog
  instansi+PIC, import CSV, dedup no. WA PIC.

### Fase B — Pipeline Kanban Deals
- Kanban drag-drop, konversi lead→deal, aturan tahap menang/kalah,
  konfigurasi tahap di Settings, badge deal macet.

### Fase C — Aktivitas, Follow-up & Pengingat WA
- CRUD aktivitas + timeline di Sheet deal, halaman Follow-up Hari Ini,
  watcher pengingat WA jatuh tempo, template pesan + kirim cepat.

### Fase D — Profil Instansi 360° & Integrasi Loyalty
- Halaman detail instansi (riwayat semua deal/acara, repeat order), tautan
  PIC ke `pos_customers` (riwayat POS + tier member), alur
  "Menang → jadikan PIC member".

### Fase E — Laporan Funnel
- Halaman laporan: funnel per tahap, win rate, nilai pipeline, per jenis
  instansi/acara, per sumber, per owner, kalender acara ter-booking,
  rekap alasan kalah.

### Fase F — Quotation Builder & Realisasi Bahan Baku (PROPOSAL — menunggu keputusan owner)

Permintaan owner 2026-07-21: satu tombol pembuatan **Quotation** pada deal —
baris item bebas (free text: deskripsi, qty, harga, jumlah) + **Add Produk**
dari katalog (harga per pax × jumlah pax), opsi **pakai PPN atau tidak**;
produk yang dipakai nantinya **mengurangi stok bahan baku** sesuai resep.

Temuan repo (2026-07-21):
- Rantai resep KOSONG: `pos.pos_recipes` 0 baris & tak direferensikan kode;
  `manufacturing.bom_items` 0 baris; `item.products` 0 baris. Hanya
  `pos.pos_products` terisi (5 aktif, punya `base_price`). Pengurangan
  bahan baku MUSTAHIL jalan sebelum resep produk diisi → prasyarat F3.
- Preseden PPN: purchasing PO `ppn_persen` default 11, taxable = subtotal −
  diskon (`src/lib/purchasing/po-totals.ts`).
- Preseden konsumsi stok: production orders menulis
  `inventory.inventory_movements` (`/api/purchasing/production/orders`) —
  pola ledger qty_before/after + reference_type dicontoh dari sini.

Letak UI: tombol **"Buat Quotation"** di Sheet detail deal (pipeline) +
halaman profil 360° instansi; total quotation auto-isi `value_estimate`
deal; nilai final saat Menang prefill dari quotation yang diterima.

Desain data (skema `crm`):
- `crm_sales_quotations` — id, deal_id, company_id, branch_id,
  quote_number, status (`draft`/`terkirim`/`diterima`/`ditolak`),
  use_ppn, ppn_persen (default 11), subtotal, ppn_nominal, total, notes,
  valid_until, stock_deducted_at (idempotensi realisasi), created_by,
  timestamps, deleted_at. Satu deal boleh punya banyak versi quotation.
- `crm_sales_quotation_items` — id, quotation_id, item_type
  (`produk`/`bebas`), product_id (nullable FK `pos.pos_products`),
  description, qty numeric, unit_price, line_total, sort_order.

Sub-fase (PR-sized):
- **F1 — Builder + PPN**: migrasi 2 tabel, API CRUD quotation ber-scope
  (pola access.ts), dialog builder di Sheet deal (baris bebas + Add Produk
  dari pos_products dgn harga default base_price yang bisa dioverride,
  toggle PPN, total live), total → value_estimate.
- **F2 — Output & status**: nomor quotation, kirim ke PIC via WA gateway
  (teks terformat / PDF — keputusan owner), status terkirim/diterima/
  ditolak, prefill nilai final saat Menang.
- **F3 — Realisasi bahan baku**: prasyarat resep produk terisi
  (`pos_recipes`; bila belum ada UI kelola resep → sub-task); engine
  konsumsi: item produk × resep (quantity_per_unit + waste) → INSERT
  `inventory_movements` tipe keluar + update stok, transaksional &
  idempotent via `stock_deducted_at`, reference ke quotation/deal;
  bonus: daftar kebutuhan bahan per acara utk ops.

Limitasi diketahui (temuan security F1, diterima): `pos.pos_products`
tidak punya kolom company/branch — katalog produk global untuk semua
venue (konsisten dgn seluruh endpoint POS existing, "operasi masih
single-venue"). Saat bisnis benar-benar multi-venue, picker produk
quotation & realisasi stok F3 perlu ditinjau ulang.

Keputusan owner FINAL (2026-07-21) — Fase F resmi on-progress:
1. Pengurangan stok via **tombol manual "Realisasi"** menjelang acara.
2. **PPN default 11%** (preseden purchasing), bisa dimatikan per quotation.
3. Katalog = **`pos.pos_products` + resep `pos_recipes`**.
4. Output: **PDF** + **summary order teks WA** via gateway.
5. Stok yang dikurangi = **gudang venue (branch) deal** tersebut.

## Acceptance Criteria (ringkas)

- Semua query leads/deals terfilter `company_id` (+ `outlet_id` bila relevan);
  tidak ada kebocoran antar tenant.
- Drag-drop kanban mempersist perubahan tahap dan mencatat `entered_stage_at`.
- Deal Kalah tidak bisa disimpan tanpa alasan; deal Menang tanpa nilai final.
- Pengingat WA terkirim maksimal 1x per aktivitas (idempotent,
  `reminder_sent_at`).
- Response API memakai envelope `successResponse`/`paginatedResponse`;
  role guard konsisten dengan pola `src/lib/crm/server.ts`.

## Automation Log

- 2026-07-21 — Epic dibuat (status backlog). Riset referensi Freshsales +
  eksplorasi repo: kanban reuse pola pipeline rekrutmen HRIS
  (`@hello-pangea/dnd`), WA via `sendGatewayText()`, tabel baru di skema
  `crm` prefix `crm_sales_` dengan tenant scoping `company_id`/`outlet_id`
  (beda dari member loyalty yang global by design per EPIC-011).
- 2026-07-21 — Keputusan owner: nama menu **"Sales Funneling"**; target lead
  **B2B/instansi** (corporate, sekolah, komunitas, booking acara privat).
  Model data diubah: lead = instansi + PIC (org_name, org_type, pic_*), deal
  membawa event_type + event_date + pax_estimate; tahap default jadi 6
  (tambah Proposal & Survey Lokasi); laporan breakdown per jenis
  instansi/acara + kalender acara ter-booking.
- 2026-07-21 — Keputusan owner: akses = **Super Admin + role `sales` baru**.
  Verifikasi repo: role `sales` belum ada di `iam.roles`;
  `FULL_ACCESS_ROLES = ["super_admin","hrd"]` di `src/lib/iam/access.ts:12`
  mengunci role lain ke ESS-only → Fase A wajib buat role via delta DAN
  memperluas gerbang akses jadi route-aware (sales → sales-funnel + ESS
  saja), BUKAN menambah `sales` ke FULL_ACCESS_ROLES.
- 2026-07-21 — Keputusan owner final (3 item PENDING terjawab): (1) enam
  tahap pipeline default disetujui; (2) pengingat WA ke penanggung jawab +
  rekap harian owner via infrastruktur EPIC-020; (3) scope **per outlet**
  (`outlet_id` wajib di leads & deals). Semua keputusan lengkap → status
  naik `backlog` → `on-progress`. Fase A siap dieksekusi.
- 2026-07-21 — **Fase A SELESAI & live di dev.** Konsistensi sistem: "per
  outlet" diimplementasikan sebagai `company_id` + `branch_id` (FK
  `configuration.companies/branches` — hierarki venue existing, bukan kolom
  outlet_id baru). Delta `20260721130000_sales_funnel_fase_a.sql` applied:
  6 tabel `crm.crm_sales_*`, seed 6 tahap + alasan kalah, role `sales`,
  menu `sales-funnel`/`sales-funnel.leads` (grant super_admin+sales, code
  ditambahkan ke whitelist retire `database/seeders/iam-menus.sql`).
  Gerbang akses route-aware: `ROLE_MODULE_PATHS`/`canAccessPath` di
  `src/lib/iam/access.ts` + `filterNavByPrefixes` (sales → sales-funnel +
  ESS, TIDAK masuk FULL_ACCESS_ROLES). API `/api/sales-funnel/leads`
  (list/create/update/delete/import CSV via CsvImporter+xlsx, dedup no. WA
  kanonik 62…), scope via `getApiUserScope`+`importBusinessIds`, fallback
  venue `crm_settings` default. UI `src/features/sales-funnel/leads/`.
  Gate review PASS (0 CRITICAL): temuan HIGH tenant-isolation fail-open
  (user tanpa scope company lolos filter) diperbaiki jadi fail-closed
  (`requireCompanyScope`), + validasi telepon pasca-normalisasi, UUID owner
  filter, email import. Build + typecheck bersih (0 error baru), migrasi
  terverifikasi di DB dev, PM2 restart, smoke test 200/401 OK.
  Belum: E2E login role sales (butuh akun uji — human QA).
- 2026-07-21 — **Fase B SELESAI & live di dev.** Pipeline Kanban Deals:
  delta `20260721160000_sales_funnel_fase_b.sql` applied — menu
  `sales-funnel.pipeline` (grant super_admin+sales) + `sales-funnel.settings`
  (super_admin saja), keduanya masuk whitelist retire `iam-menus.sql`.
  API: `GET/POST /api/sales-funnel/deals` (kanban + konversi lead→deal;
  lead baru/dihubungi otomatis qualified; deal mewarisi venue dari lead;
  masuk tahap pertama aktif), `PATCH/DELETE /deals/[id]` dengan aturan
  tahap — Menang wajib value_final + event_date (otomatis fix, closed_at
  diisi), Kalah wajib lost_reason_id, kembali ke tahap berjalan mereset
  closed_at/lost_reason, setiap pindah mencatat `entered_stage_at`;
  `GET /stages` (+`?all=1` super_admin), `PATCH /stages/[id]` (super_admin;
  tolak nonaktifkan tahap Menang/Kalah atau tahap ber-deal berjalan);
  `GET /lost-reasons`. UI: `src/features/sales-funnel/pipeline/` (kanban
  @hello-pangea/dnd pola HRIS, optimistic update + rollback, badge macet
  per `stuck_threshold_days`, dialog wajib Menang/Kalah), tombol "Konversi
  ke Deal" di tabel Leads, `src/features/sales-funnel/settings/` halaman
  Pengaturan Funnel (guard server-side super_admin di route — role sales
  bisa capai prefix via ROLE_MODULE_PATHS).
  Gate review PASS (0 CRITICAL): HIGH unbounded deals query → LIMIT 500 +
  window closed 90 hari; MEDIUM owner_user_id client-trusted (security +
  code review, juga berlaku di leads Fase A) → `validateAssignableOwner`
  (role sales/super_admin + satu company) DAN role sales hanya boleh
  assign dirinya sendiri, diterapkan di deals & leads POST/PATCH; MEDIUM
  optimistic update tak sinkron closed_at/is_won → patch cache lengkap
  dari cache stages; MEDIUM lead picker tanpa debounce → debounce 300ms;
  + validasi tanggal kalender (tolak 9999-13-40). LOW ditunda: oracle
  403/404 (pola Fase A, keputusan produk), picker lead cap 20 baris.
  Typecheck 0 error baru, build bersih, migrasi + menu/grant terverifikasi
  di DB dev, PM2 restart, smoke test 401 fail-closed OK.
  Belum: E2E kanban role sales (butuh akun uji — human QA). Sisa: Fase C
  (aktivitas + follow-up + pengingat WA), D (360°), E (laporan).
- 2026-07-21 — **Fase C SELESAI & live di dev.** Aktivitas, Follow-up &
  Pengingat WA. Delta `20260721180000_sales_funnel_fase_c.sql`: menu
  `sales-funnel.followups` (grant super_admin+sales, masuk whitelist
  retire) + seed 3 template WA global. API: CRUD
  `/api/sales-funnel/activities` (timeline per deal/lead — akses via
  induk; agenda `view=today` = jatuh tempo hari ini + terlambat, scope
  company/branch + sales own-or-unassigned), `wa-templates` (baca semua
  role sales, tulis super_admin, hapus = nonaktifkan is_active),
  `/deals/[id]/send-wa` (render placeholder {pic}{instansi}{acara}
  {tanggal_acara}{venue} → gateway → tercatat sebagai aktivitas `wa`
  selesai; rate limit 1 kirim/deal/60 dtk; normalisasi nomor di titik
  kirim). Watcher `followup-reminder-watcher.ts` di instrumentation.ts
  (tiap 5 mnt, maks 10/tick): klaim `reminder_sent_at` atomik SEBELUM
  kirim (FOR UPDATE SKIP LOCKED) — AC "maksimal 1x" terpenuhi; nomor PJ
  dari hris.employees.phone via user_id (subquery skalar, BUKAN join —
  user_id tidak unique, join bisa fan-out dobel kirim); exception tak
  terduga melepas klaim baris yang belum diproses (finally); timeout
  gateway = klaim dipertahankan via flag terstruktur `timedOut` di
  WhatsAppResult (bukan cocok string). Refactor: findAccessibleLead/
  Deal/Activity dipusatkan di src/lib/sales-funnel/access.ts. UI: klik
  kartu deal → Sheet detail (ringkasan, kirim WA template/bebas, catat
  aktivitas, timeline sorot terlambat; snapshot fallback agar Sheet tak
  tertutup saat deal keluar hasil filter), halaman Follow-up Hari Ini
  (terlambat merah di atas, toggle selesai, chat WA PIC), kelola template
  di Pengaturan Funnel. Gate review+security PASS (0 CRITICAL; 2 HIGH
  watcher & semua MEDIUM diperbaiki). Typecheck 0 error baru, build
  bersih, migrasi+menu+seed terverifikasi DB dev, SQL watcher dry-run OK,
  PM2 restart, smoke 401 fail-closed. Ditunda sadar: rekap harian owner
  menunggu mesin pengirim EPIC-020 Fase B; regression test invariant
  venue aktivitas = venue induk (belum ada test module ini — human QA).
  Sisa: Fase D (360° + tautan pos_customers), E (laporan funnel).
- 2026-07-21 — **Fase D SELESAI & live di dev.** Profil Instansi 360° &
  Integrasi Loyalty — TANPA migrasi DB (customer_id ada sejak Fase A).
  Halaman `/dashboard/sales-funnel/leads/[id]`: identitas+PIC (chat WA),
  statistik riwayat (total/berjalan/menang + indikator repeat order,
  nilai menang total), daftar semua deal ber-badge tahap & alasan kalah,
  timeline aktivitas gabungan (lead + seluruh deal-nya), kartu Member
  Loyalty (tier, total belanja POS, kunjungan, Ark Coin, XP, 5 transaksi
  terakhir). API: GET 360° di `leads/[id]`, `POST/DELETE
  leads/[id]/link-customer` (link member existing ATAU create_from_pic =
  upsert pos_customers by phone race-safe + reaktivasi + enrol
  crm_member_profiles tier regular ala CRM, skip hanya bila 42P01),
  `GET /customers?q=` (pencarian member global per desain EPIC-011, min
  3 char, LIMIT 10). Alur "Menang → jadikan member": checkbox di dialog
  Menang (tersembunyi bila sudah tertaut). Navigasi: nama instansi di
  tabel Leads & Sheet deal → profil 360°.
  Gate review+security PASS (0 CRITICAL/HIGH tersisa): anti-IDOR
  penautan — customer_id eksplisit WAJIB nomor WA sama dengan PIC (tanpa
  ini role sales bisa naut-lepas member sembarang untuk baca riwayat
  belanja); rate limit pencarian member 30/menit/user (lib rate-limit
  existing); cache pipeline di-invalidate setelah link/unlink (checkbox
  "jadikan member" membaca customer_id dari join kanban); halaman detail
  membedakan error server (retry) dari 404/403.
  Known quirk (diterima): pos_customers.membership_tier default 'bronze'
  vs tier profil CRM 'regular' — quirk dual-tier existing yang sama
  dengan /api/crm/members, bukan wilayah epic ini. Statistik 360°
  terpotong bila riwayat > 100 deal (pagar disengaja, berkomentar).
  Typecheck 0 error baru, build bersih, PM2 restart, smoke 401/429
  fail-closed. Sisa: Fase E (laporan funnel) — terakhir.
- 2026-07-21 — **Fase E SELESAI & live di dev — EPIC A–E LENGKAP, status
  naik `ready-for-qa`.** Laporan Funnel. Delta
  `20260721210000_sales_funnel_fase_e.sql`: tabel
  `crm_sales_deal_stage_history` (satu baris tiap deal MASUK tahap —
  fondasi funnel conversion jujur; posisi deal existing di-backfill,
  keterbatasan sadar: riwayat historis pra-Fase E hanya tahap terakhir)
  + menu `sales-funnel.reports` (grant super_admin+sales, whitelist
  retire OK). API `/api/sales-funnel/reports?from&to` (default 90 hari,
  rentang terbalik ditukar otomatis): funnel reached per tahap (dari
  history, deal dibuat dalam periode), win rate + nilai booking (deal
  ditutup dalam periode), pipeline berjalan (snapshot), breakdown per
  jenis instansi/acara/sumber + leaderboard PJ, kalender acara
  ter-booking ke depan, rekap alasan kalah — SEMUA query ber-scope
  company/branch + sales own-or-unassigned via buildScope (offset
  placeholder terverifikasi security gate). Deal POST & PATCH kini
  mencatat riwayat tahap DALAM TRANSAKSI (withTransaction) bersama
  tulis deal + status lead — temuan HIGH gate: tanpa transaksi, deal
  bisa tersimpan tapi klien dapat 500 (retry = dobel) atau funnel
  undercount permanen. UI `src/features/sales-funnel/reports/`:
  filter periode + preset 30/90 hari, 4 kartu KPI, bar funnel dengan %
  konversi antar tahap, 4 tabel breakdown, kalender booked, bar alasan
  kalah (CSS murni ala laporan CRM). Gate: security CLEAN PASS (10
  query agregat terverifikasi scope, 0 temuan); review 1 HIGH + 1
  MEDIUM + 1 LOW semuanya diperbaiki. Typecheck 0 error baru, build
  bersih, migrasi+menu+backfill terverifikasi DB dev, PM2 restart,
  smoke 401 fail-closed.
  Catatan QA (human): (1) akun uji role sales — E2E belum ada; (2) user
  sales butuh baris hris.employees ber-phone agar pengingat WA sampai;
  (3) rekap harian owner menunggu mesin pengirim EPIC-020 Fase B;
  (4) funnel akurat penuh untuk deal yang dibuat SETELAH Fase E live.
- 2026-07-21 — **Fase F1 SELESAI & live di dev.** Quotation Builder +
  PPN. Delta `20260721230000_sales_funnel_fase_f1.sql`:
  `crm_sales_quotations` (quote_number unik dari sequence QT-YYMM-XXXX,
  status draft/terkirim/diterima/ditolak, use_ppn + ppn_persen default
  11 ber-CHECK 0-100, stock_deducted_at utk idempotensi realisasi F3) +
  `crm_sales_quotation_items` (item_type produk/bebas, CHECK produk
  wajib product_id, CASCADE). API: GET/POST
  `/deals/[id]/quotations` (total SELALU dihitung server, item batch
  1 INSERT, semua dalam withTransaction, total → value_estimate deal
  berjalan), PATCH/DELETE `/quotations/[id]` (replace items + status;
  guard beku `stock_deducted_at IS NULL` DI DALAM SQL — anti-TOCTOU
  dgn tombol Realisasi F3; DELETE menghitung ulang value_estimate dari
  quotation tersisa terbaru), GET `/products` (katalog pos_products).
  UI `src/features/sales-funnel/quotations/`: section Quotation di
  Sheet deal + builder dialog (Add Produk isi nama+harga dari
  base_price bisa dioverride, Item Bebas, toggle PPN + persen, total
  live; SEMUA baris wajib lengkap — baris setengah jadi tidak dibuang
  diam-diam, temuan HIGH gate). Gate: security 0 CRITICAL/HIGH
  (TOCTOU + batas numeric(14,2) + kalender valid_until diperbaiki);
  review 2 HIGH (value_estimate basi pasca-hapus; baris hilang senyap)
  diperbaiki, LOW sequence nomor global lintas tenant = diterima
  (operasi single-venue, dicatat). Typecheck 0 error baru, build
  bersih, migrasi + CHECK ppn applied di DB dev, PM2 restart, smoke
  401 fail-closed. Sisa Fase F: F2 (PDF + summary WA + transisi
  status), F3 (tombol Realisasi → potong stok gudang venue dari resep;
  prasyarat pos_recipes terisi).
- 2026-07-21 — **Fase F2 SELESAI & live di dev.** PDF + summary WA +
  transisi status quotation. `src/lib/sales-funnel/quotation-pdf.ts`
  (pdfkit A4 pola payslip-pdf: kop company/venue, info instansi/PIC/
  acara, tabel item ber-"pax", subtotal/PPN/total, catatan, ttd;
  pindah halaman MANUAL per baris via heightOfString — page-break
  implisit pdfkit di tengah baris membuat kolom tercecer, temuan HIGH
  gate). Route GET `/quotations/[id]/pdf` (attachment, filename
  tersanitasi) + POST `/quotations/[id]/send-wa` (summary teks item+
  total+masa berlaku ke PIC via gateway, rate limit 1/deal/60dtk,
  sukses → status draft→terkirim ber-guard WHERE status='draft' +
  aktivitas wa di timeline, satu transaksi). Keduanya cek akses dgn
  fetch minimal SEBELUM materialisasi PII (temuan MEDIUM). PATCH
  status 'diterima' menyinkronkan value_estimate deal (prefill nilai
  final saat Menang = angka kesepakatan). UI: ikon unduh PDF, kirim
  WA, tombol ✓ Diterima / ✗ Ditolak saat status terkirim. Gate: 0
  CRITICAL; 1 HIGH (layout PDF) + 1 MEDIUM (urutan fetch) diperbaiki;
  LOW isPending bersama antar baris = diterima (UX minor). Typecheck
  0 error baru, build bersih, PM2 restart, smoke 401 fail-closed.
  Sisa: F3 Realisasi bahan baku (prasyarat pos_recipes terisi).
- 2026-07-22 — **Fase F3 SELESAI & live di dev — FASE F (QUOTATION)
  LENGKAP F1+F2+F3.** Realisasi bahan baku + modifikasi owner: stok
  kurang → boleh lanjut TANPA potong BOM, ditandai bom_status
  'tidak-terpotong'. Delta `20260722010000_sales_funnel_fase_f3.sql`:
  kolom bom_status + realized_by di crm_sales_quotations. POST
  `/quotations/[id]/realize` (rate limit 10/mnt/user): kunci quotation
  FOR UPDATE (idempoten, wajib status diterima), kebutuhan = qty pax ×
  pos_recipes.quantity_per_unit × (1+waste%), kunci stok gudang venue
  branch deal ORDER BY id (DETERMINISTIK — order by qty punya seri =
  deadlock, temuan HIGH; greedy gudang-terbesar di aplikasi setelah
  terkunci), banding presisi 3dp numeric(15,3) (anti drift float),
  kurang → 409 rincian {bahan, butuh, tersedia}; cukup → potong
  all-or-nothing via inventory_movements tipe 'out' reference
  'sales_realization' qty_before/after; force → tanpa movement,
  bom_status 'tidak-terpotong'. Resep: GET/PUT `/recipes`
  super_admin-only (temuan CRITICAL: GET semula terbuka utk role sales
  padahal join raw_materials ber-tenant), satuan resep DITURUNKAN
  server dari satuan kecil bahan (kolom NOT NULL varchar(20) + resep
  beda satuan dari stok = hitungan meleset senyap — temuan HIGH+MEDIUM);
  `/raw-materials?q=` difilter company/branch scope (temuan HIGH
  security: semula bocor katalog bahan lintas tenant ke role sales).
  UI: tombol Realisasi (status diterima & belum realisasi), dialog
  kekurangan stok dgn "Lanjut Tanpa Potong BOM", badge hijau "BOM
  terpotong" / kuning "BOM tidak terpotong", editor Resep Produk di
  Pengaturan Funnel (cari bahan ber-scope, qty+waste, satuan
  read-only). Gate: CRITICAL+2 HIGH+2 MEDIUM+LOW semua diperbaiki;
  stok negatif mustahil (take=min), ledger lengkap, all-or-nothing
  terverifikasi. Typecheck 0 error baru, build bersih, migrasi applied,
  PM2 restart, smoke 401 fail-closed.
  Catatan ops: stok nyata sudah ada (113 baris inventory dari GRN
  purchasing) — isi resep via Pengaturan Funnel lalu Realisasi langsung
  berfungsi. QA manusia: uji alur lengkap quotation → kirim → diterima
  → menang → realisasi (potong & tanpa-potong) dgn akun sales.
- 2026-07-22 — **Satu PIC boleh membawa banyak leads** (masukan owner:
  PIC travel agent/EO kerap membawa beberapa instansi). Delta
  `20260722030000_sales_funnel_pic_multi_leads.sql`: indeks unik
  (company, pic_phone) diganti (company, pic_phone, lower(org_name)) —
  duplikat sungguhan saja yang ditolak; data lama dijamin valid (aturan
  lama lebih ketat). Dedup konsisten di POST/PATCH/import (pesan baru
  "Lead instansi ini dengan PIC yang sama sudah ada"; race 23505 →
  409, bukan 500). Endpoint baru GET `/leads/by-phone` (scope ala list
  + sales own-or-unassigned, rate limit 30/mnt/user): form menampilkan
  panel "PIC sudah terdaftar — membawa N lead" + tombol "Gunakan Data
  PIC Ini" (prefill nama/jabatan/email; banding nomor bentuk kanonik
  62… via normalizePhoneClient), profil 360° menampilkan "PIC ini juga
  membawa: [link instansi lain]". Tabel kontak ternormalisasi penuh =
  evolusi nanti bila perlu (sesuai catatan MVP epic). Gate: APPROVE
  (0 CRITICAL/HIGH; MEDIUM rate-limit + LOW 23505 diperbaiki).
  Typecheck 0 error baru, build bersih, migrasi applied, PM2 restart.
- 2026-07-21 — **Fase F (Quotation) diusulkan** atas permintaan owner:
  builder quotation di deal (item bebas + Add Produk per pax + opsi PPN)
  dan realisasi pengurangan bahan baku dari resep produk. Eksplorasi
  repo: rantai resep kosong total (pos_recipes/bom_items/item.products
  0 baris — prasyarat F3), preseden PPN 11% purchasing & ledger
  inventory_movements production orders siap dicontoh. Rencana rinci +
  5 pertanyaan keputusan owner ditulis di Task Groups Fase F — status
  epic tetap ready-for-qa utk A–E; F menunggu jawaban owner.
- 2026-07-23 — **Fase G SELESAI: termin pembayaran quotation + pencatatan
  pembayaran deal** (permintaan owner hari ini; status tetap
  ready-for-qa). Delta `20260723110000` applied:
  `crm_sales_quotation_terms` (label + PERSEN Σ wajib 100 — validasi zod
  server & UI, toleransi 0.01 utk 33.33×3; due_date opsional; CASCADE
  ikut quotation) + `crm_sales_deal_payments` (append-only + soft delete
  deleted_at/by utk koreksi salah catat). Nominal termin TIDAK disimpan —
  dialokasikan saat baca dari total × persen dgn pembulatan KUMULATIF 2dp
  (`allocateTermAmounts`, Σ = total persis; pola allocateBundlePrice
  ticketing) sehingga edit item/PPN tidak membuat termin basi. Progress
  per termin = **waterfall** (`termProgress`): pembayaran bebas nominal
  mengisi termin berurutan → status lunas/sebagian/belum diturunkan,
  kasir tidak memilih termin manual. Acuan tagihan (prioritas): quotation
  DITERIMA terbaru → value_final deal → quotation terbaru → estimasi.
  API: terms ikut payload create/update quotation (replace-all) + GET
  list; `GET/POST /deals/[id]/payments` (summary + progress; rate limit
  20/mnt) + `DELETE /payments/[id]` (soft). PDF quotation kini memuat
  tabel "TERMIN PEMBAYARAN" (label, persen, nominal alokasi, jatuh
  tempo). UI: builder quotation ber-section Termin (tombol "Pakai
  Termin" preset DP 50/Pelunasan 50, live nominal per termin, guard Σ
  100% sebelum submit — validasi sama dgn server); deal detail sheet
  ber-section Pembayaran (progress bar terbayar/total + sisa, status per
  termin ber-badge + jatuh tempo, form catat nominal/metode/tanggal/
  catatan, riwayat ber-hapus koreksi). Verifikasi: 818 unit test lulus
  (10 baru: skema termin, alokasi kumulatif, waterfall), eslint bersih
  di semua file yang disentuh, build lulus, migrasi applied, PM2
  restart, smoke: payments 401 tanpa auth. CATATAN pre-existing (bukan
  dari fase ini): 7 file dialog sales-funnel lama kena rule lint baru
  `react-hooks/set-state-in-effect` (pola setState-dlm-effect dari fase
  B–F) — kandidat rapikan terpisah, terverifikasi sudah error di HEAD
  sebelum Fase G. QA owner: buka deal → buat/edit quotation → "Pakai
  Termin" → simpan → unduh PDF (tabel termin tampil) → catat pembayaran
  parsial → status termin berubah lunas/sebagian.
