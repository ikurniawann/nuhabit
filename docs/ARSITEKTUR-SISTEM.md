# Arkiv OS — Arsitektur Sistem (Dokumentasi Holistik)

> Peta menyeluruh seluruh modul, arsitektur lintas-modul, model data, dan
> infrastruktur repo **arkiv-pos-saas** (package `arkiv-os`). Dokumen ini bersifat
> _living_ — verifikasi terhadap kode terbaru sebelum mengambil keputusan penting.
>
> **Terakhir diperbarui:** 2026-07-25 · **Branch:** `development` · **Next.js:** 16.2.3

---

## 1. Apa Itu Arkiv OS

**Arkiv OS** adalah **SaaS POS + ERP multi-tenant** untuk grup usaha (F&B, retail,
theme park, jasa). Satu aplikasi menyatukan: SDM/HRIS + payroll + rekrutmen, CRM &
omnichannel, POS & loyalty, ticketing theme park, purchasing & inventory, serta
keuangan (AR) & accounting — dengan RBAC per-menu dan isolasi tenant
(company/branch/warehouse).

Tenant referensi di dev: grup **SULU** (SULU-Dago / SULU-Bandung).

---

## 2. Stack Teknologi

| Lapisan | Teknologi |
|---------|-----------|
| Framework | **Next.js 16.2.3** (App Router, React Server Components) |
| Routing edge | **`src/proxy.ts`** (BUKAN `middleware.ts` — konvensi Next 16 di repo ini) |
| Bahasa | TypeScript (catatan: `next build` meng-abaikan type-error → wajib `npx tsc --noEmit` untuk verifikasi runtime-safety) |
| Data | **PostgreSQL** multi-schema (akses via `src/lib/db.ts` + `src/lib/pg/`, bukan ORM) |
| State/data-fetching | TanStack Query (per-feature `queries.ts`/`mutations.ts`/`query-keys.ts`) |
| UI | Tailwind + komponen `src/components/ui` (shadcn-style) + `src/components/shared` |
| Auth | Session cookie `nuhabit_session` (sha256 token; `arkiv_session` lama masih dibaca) + IAM RBAC |
| Deploy dev | **PM2** `next start -p 3459` (production build; wajib rebuild+restart) |
| Public | **cloudflared** tunnel → `sulu.within.ventures` & `member.within.ventures` |
| Service samping | `services/wa-gateway` (Baileys, PM2 port 3471), `services/pos-nfc-bridge` |
| Pembayaran | Xendit (QRIS dinamis, mock di dev), gateway loyalty |

---

## 3. Arsitektur Lintas-Modul

### 3.1 Lapisan aplikasi (pola konsisten tiap modul)

```
src/app/**                → route fisik (App Router); wrapper tipis + route group (dashboard)
   └─ src/features/<domain>/    → UI + logika klien
        ├─ components/          → halaman & widget
        ├─ api.ts               → pemanggil endpoint
        ├─ queries.ts / mutations.ts / query-keys.ts   → TanStack Query
        └─ types.ts
   └─ src/app/api/<domain>/     → route handler (server); validasi Zod, scope tenant
        └─ src/lib/<domain>/    → logika bisnis + akses DB (src/lib/db.ts, src/lib/pg)
             └─ PostgreSQL (multi-schema)
```

Organisasi **by feature/domain**, bukan by type. File kecil-kecil (200–400 baris, maks 800).

### 3.2 Multi-tenant & IAM

- **Isolasi tenant** berlapis: `company_id` → `branch_id` → `warehouse_id`. Query list/CRUD memakai pola **fail-closed** (`isRowInBusinessScope`, `companyScopeOr`/`branchScopeOr`) — data di luar scope tak bocor.
- **RBAC per-menu**: tabel `iam.menus` (hierarki sidebar) + `iam.role_menu_permissions`. Sidebar dirender dari menu yang di-grant ke role user (`src/lib/iam/get-user-menus.ts`).
- **Role model**: `FULL_ACCESS_ROLES` (super_admin, admin, hrd) vs role ESS-only; `isEssOnlyUser(userId, role)` (IAM-based, `src/lib/iam/get-user-menus.ts`) menentukan pengguna dikunci ke Area Karyawan.
- **Guard route**: layout dashboard membaca header `x-pathname` (di-set `src/proxy.ts`) → `canAccessPath` → redirect ESS bila perlu.

### 3.3 Routing & host

- `src/proxy.ts` me-rewrite host `member.*` root → `/member` (portal karyawan) dan menyuntik `x-pathname`.
- Route group `(dashboard)` membungkus semua modul internal dengan `AppSidebar` + guard.
- Beberapa app-tree berdiri sendiri (di luar dashboard): `/pos`, `/pos/customer-display` (fullscreen), `/table-order`, `/photobooth`, `/member`, `/arkiv-os`, portal rekrutmen.

### 3.4 Basis data & migrasi

- **Multi-schema** PostgreSQL. Schema utama: `iam`, `auth`, `hris`, `payroll`, `recruitment`, `crm`, `pos`, `ticketing`, `inventory`, `item`, `purchasing`, `finance`, `accounting`, `configuration`, `performance`, `manufacturing`, `public`.
- **DUA pola akses DB berdampingan** (gotcha penting):
  1. **Query builder** ala Supabase (`src/lib/pg/create-client.ts` → `createServerPgClient`): `db.from("raw_materials").select().eq(...)`. Nama tabel tak-berkualifikasi diresolusi lewat `search_path` connection; arg posisi kedua memilih schema, mis. `db.from("bom_items", MANUFACTURING_SCHEMA)`.
  2. **Raw SQL berparameter** (`src/lib/db.ts` → `query`, `queryOne`, `withTransaction`): dipakai bila butuh join multi-tabel / `FOR UPDATE` / transaksi; selalu schema-qualified (`inventory.stock_opnames`, `configuration.warehouses`).
- **Reads sering lewat VIEW** (prefix `v_`): `v_inventory`, `v_raw_materials_stock`, `v_products_cogs`, `v_purchase_orders`, `v_production_orders`. Costing dihitung di view. Writes ke tabel dasar.
- **Migrasi delta** di `database/migrations/deltas/*.sql` (penamaan timestamp). Runner `npm run db:migrate` (dry) / `db:migrate:apply`. Ledger `public.schema_migrations` pakai **checksum** — JANGAN edit file setelah apply. Tiap migrasi idempoten & atomik.
- Introspeksi skema: `npm run db:pull` (bisa stale — verifikasi ke DB).

### 3.5 Background watchers

Watcher latar didaftarkan **sekali per proses server** di `src/instrumentation.ts`:
`startCsSlaWatcher` (SLA inbox CS, 60s), `startGoogleReviewSync` (poll review 15 mnt),
`startWaNotifWatcher` (notif owner, 5 mnt), + watcher sales-followup & booking. Semuanya
**config-aware**: kredensial absen → no-op senyap, bukan throw.

---

## 4. Peta Modul (per Domain Bisnis)

> Status merujuk registry epik (§7). Kedalaman detail bervariasi: modul yang aktif
> dikerjakan sesi-sesi terakhir terdokumentasi paling rinci.

### A. Platform & Fondasi

| Modul | Fungsi | Kunci |
|-------|--------|-------|
| **IAM / Auth** | Login, session, RBAC per-menu, multi-tenant scope | `src/lib/iam/*`, `src/lib/auth/*`; schema `iam.*`, `auth.sessions` |
| **Configuration & Settings** | Profil company, hierarki bisnis, stall, warehouse, pengaturan integrasi | `src/features/configuration`, `/dashboard/settings`, `src/lib/configuration`; schema `configuration.*` |
| **Design System** | Katalog komponen UI internal | `src/features/design-system`, `src/components/ui`, `src/components/shared` |
| **Dashboard Eksekutif** (EPIC-021) | Ringkasan lintas modul untuk owner | `src/features/dashboard`, `/dashboard` (page.tsx) — _coding_ |
| **Arkiv OS Desktop** (EPIC-019) | Pusat monitoring owner (shell desktop) | `src/app/arkiv-os`, `src/lib/desktop` — _coding_ |
| **"Do" AI Assistant** (EPIC-017/018) | Asisten AI + lampiran/OCR dokumen | `src/lib/assistant`, `src/lib/ai-assistant-config.ts`, `src/lib/attachments` — _on-progress_ |

**Mekanik platform penting:**
- **IAM fails-OPEN**: bila schema/DB IAM tak tersedia atau role belum di-seed, jatuh ke policy kode `isEssOnlyRole` agar tak terkunci; permission kosong → sidebar kosong (bukan error). `FULL_ACCESS_ROLES` = fast-path/fallback; keputusan asli dari data permission IAM (`src/lib/iam/get-user-menus.ts`).
- **Auth**: shim native Supabase-shaped. `auth.sessions` (sha256 `token_hash`, TTL hari), cookie `nuhabit_session` (httpOnly; cookie lama `arkiv_session` masih dibaca, dihapus saat login/logout). `requireUser` redirect unauth ke `/api/auth/logout` (bukan `/login`) untuk bersihkan cookie basi. `banned_until` pakai interval 100-tahun (parity Supabase-admin).
- **Proxy (Next 16)**: `src/proxy.ts` — rewrite host `member.*`→`/member`, redirect URL legacy, gate **cookie-presence saja** (Edge, tanpa validasi DB/role), suntik header **`x-pathname`** (satu-satunya cara guard ESS di layout tahu path aktif). Enforcement role penuh di server components.
- **Exec Dashboard** (`src/lib/dashboard/executive.ts`): untuk `super_admin`/`direksi` (role `owner` belum ada di `iam.roles`, `direksi` penggantinya); tiap seksi `safe()` fail-safe → null + dicatat `gagal[]`; semua timestamp dipaksa Asia/Jakarta.
- **Arkiv OS Desktop** (`src/lib/desktop/overview.ts`): notifikasi = **diff murni** dua snapshot 60s, hanya kenaikan yang memicu; definisi angka sengaja identik dengan nav-badge & tool "Do".
- **"Do" Assistant**: model **tak pernah keluarkan SQL** — hanya pilih nama tool + arg; SQL ditulis-tangan berparameter, tiap tool `LIMIT 25`; `argDate` tolak non-`YYYY-MM-DD` (anti-injeksi). Ekstraksi lampiran (PDF/gambar-OCR/DOCX/XLSX) lazy-import. Model OpenAI-only, vendor disembunyikan di UI.
- **DB layer**: satu `pg.Pool` (max 10), timezone Asia/Jakarta. **`search_path` load-bearing** (`src/lib/db.ts`): `public,iam,configuration,hris,performance,recruitment,item,purchasing,inventory,manufacturing,pos,crm,accounting,auth` — `auth` sengaja **terakhir** agar `users` telanjang → `configuration.users` (bukan `auth.users`). Runner migrasi: urut by prefix 14-digit, tracking by **basename** (harus unik global), checksum disimpan tapi **tidak** diverifikasi ulang (drift tak ditegakkan).

### B. SDM / HR

| Modul | Fungsi | Status |
|-------|--------|--------|
| **Rekrutmen** (EPIC-001) | Pipeline lamaran + portal kandidat | on-progress |
| **Psikotes Online** (EPIC-002) | Tes psikologi online + portal | ready-for-qa |
| **Interview AI** (EPIC-003) | Wawancara berbantuan AI | ready-for-qa |
| **Offer** (EPIC-004) | Penawaran kerja + portal respons kandidat | ready-for-qa |
| **Live Monitoring Rekrutmen** (EPIC-005) | Pantauan real-time proses rekrutmen | ready-for-qa |
| **Kontrak Karyawan** (EPIC-006) | PKWT/PKWTT, dokumen ttd, dialog Kemnaker | ready-for-qa |
| **Kehadiran & Cuti + ESS** (EPIC-007) | Absensi, cuti, monitoring per shift, self-service | ready-for-qa |
| **Payroll & Gaji** (EPIC-008) | Payroll, lembur, kontrak, pinjaman, slip ESS | ready-for-qa |
| **Logbook** (EPIC-009) | Logbook harian dept, auth+scope server-side, template-first | ready-for-qa |
| **KPI Scorecard** (EPIC-010) | Scorecard 0–100 bulanan per role | backlog (desain final) |
| **Pensiun Modul Jadwal Lama** (EPIC-015) | Migrasi schedules/sections berbasis `staff` | ready-for-qa |
| **Pengumuman (Announcements)** | CMS HRD + feed ESS | selesai (commit f14b3a3) |
| **Beranda ESS** | `/dashboard/me` + kunci role ESS-only | live |

Kode: `src/features/hris`, `src/features/performance`, `src/features/users`, `src/features/{interview,psikotes,offer}-portal`, `src/features/member-portal`; `src/lib/{hris,payroll,recruitment,kpi}`. Schema: `hris.*` (8 tabel delta), `payroll.*`, `recruitment.*` (16 tabel delta), `performance.*` (5).

**Mekanik HR penting:**
- **Actor split** (`src/lib/hris/workforce-auth.ts`): `approved_by`/`validated_by` FK ke **`hris.employees(id)`**, BUKAN `users.id` — selalu tulis `employeeId` (nullable utk akun non-karyawan spt super_admin). `HR_ROLES = [super_admin, admin, hrd, hiring_manager]`.
- **Model jadwal lama dipensiun** (EPIC-015): `staff`/`schedules`/`sections` diganti `shifts` + `employee_shifts`. Jangan bangun di atas tabel `staff_*`.
- **Rekrutmen** (schema `recruitment`): portal publik token-gated `(public)/{portal,psikotes,interview,offer}/[token]` (tanpa login). AI via **DeepSeek** (OpenAI-compatible, key dari `app_settings`). Funnel: applied→screening→psikotes→interview→offer→hired. CV auto-parse OCR+DeepSeek; notif WA kandidat via Fonnte. Psikotes scoring = deterministik + narasi AI; interview = WebRTC proctored custom.
- **Payroll**: `payslip-pdf.ts` + `terbilang.ts` (angka→kata Indonesia); prorate mid-period; cicilan pinjaman diamortisasi saat run. AWAS: status-flow payroll masih hardcode (deviasi dari `payroll_settings`) = backlog.
- **KPI** (`src/lib/kpi/*`): `collectors.ts`+`collectors-wave2.ts` tarik metrik lintas-domain (sales, attendance); `auto-snapshot.ts` bekukan skor berkala — scorecard baca snapshot, bukan live.
- **ESS** (`me/*`) scoped ke karyawan login via `employeeId`; akun non-karyawan tak lihat apa-apa.
- **Member Portal** (`/member`) = self-service **customer/loyalty** (OTP, cookie `member_session` terpisah dari `nuhabit_session`) — domain CRM, JANGAN dikelirukan dengan ESS karyawan.

**Gotcha:** kolom `date` PostgreSQL = objek `Date` (pakai `dateColToIso`); jangan andalkan `RETURNING "*"` embed dari respons insert pg (EPIC-009). Push HRIS pakai `~/.git-credentials-arkiv`.

### C. CRM & Omnichannel

| Modul | Fungsi | Status |
|-------|--------|--------|
| **CRM Revamp** (EPIC-011) | Member global, XP lifetime, ARK Coin, portal member, rekonsiliasi antar-venue | ready-for-qa |
| **WA Customer Service** (EPIC-012) | Riwayat pesan, inbox, komplain | ready-for-qa |
| **Omnichannel IG/Google** (EPIC-013) | Google Review & Instagram DM | coding |
| **CRM Collectibles** (EPIC-014) | Artwork, wallpaper, badge | on-progress |
| **Notifikasi WA Owner** (EPIC-020) | Digest harian, void besar, stok habis, komplain, review ≤2★, omzet anjlok, approval menginap, kontrak ≤30 hari | ready-for-qa |
| **Suara AI / TTS** (EPIC-016) | Provider TTS bisa dipilih + preview | ready-for-qa |

Kode: `src/features/crm/*` (members, rewards, xp-rules, dashboard, settings, inbox, reviews, avatars), `src/lib/crm/*` (`loyalty-engine.ts`, `cs-server.ts`, `google-reviews*.ts`, `collectibles-server.ts`), `src/features/integration`, `src/lib/{whatsapp,fonnte,instagram,tts,resend,payments,xendit}`. Schema `crm.*` (20 tabel delta).

**Model data CRM penting:**
- **Identitas member GLOBAL** — hidup di `pos.pos_customers` (TANPA `company_id`, lintas-tenant sengaja); `total_xp` di sana = sumber XP kanonik. `crm.crm_member_profiles` menyimpan tier & avatar aktif.
- XP = **lifetime append-only** (`crm.crm_xp_ledger`), tidak pernah dikurangi; tier dari `crm.crm_membership_tiers`. ARK Coin = satu-satunya jalur earn XP, non-refundable.
- Inbox omnichannel: `crm.wa_conversations` + `crm.wa_messages` (`channel` = whatsapp|instagram, `message_type` = otp|notification|chat|broadcast|system; **body OTP TIDAK pernah disimpan** — CHECK + kode). `crm.google_reviews`, `crm.crm_external_events` (spine event omnichannel).

**Abstraksi WhatsApp** (`src/lib/whatsapp/index.ts`) = satu pintu kirim, provider dipilih `WHATSAPP_PROVIDER` (`meta` | `gateway` | `fonnte`), deteksi otomatis urutan **Meta → gateway → Fonnte**. Meta = resmi (butuh template + jendela 24 jam); Fonnte = pihak ketiga (risiko blokir).

**`services/wa-gateway`** = proses **PM2 terpisah** (Baileys `@whiskeysockets/baileys`, `127.0.0.1:3471`, `ecosystem.config.cjs`, sesi persist di `.session/`) — sengaja dipisah dari Next.js agar sesi WA tak putus tiap deploy. Bind localhost + `x-gateway-token` (constant-time), `/health` satu-satunya endpoint terbuka; pacing acak 1.5–3.5s antar pesan. Inbound gateway→app lewat `/api/wa/inbound` (hardened: token constant-time, backoff brute-force, cap 512KB/200 msg). Sender `+6285880974659` (JANGAN dijadikan member).

**Notif owner** (`src/lib/wa/notifications-*.ts`) lewat `configuration.wa_notif_log` pola **klaim-dulu** (`INSERT ... ON CONFLICT DO NOTHING RETURNING id` sebelum kirim → tak ganda antar-proses), ambang hanya jam 8–21 WIB, **master switch default MATI**. Void-besar = event (di-hook langsung di route void POS), bukan watcher.

**Xendit — DUA integrasi terpisah:** (a) QRIS gateway POS/finance (config di DB `configuration.payment_gateways`, `src/lib/payments/xendit.ts`); (b) Invoice booking publik (config env, `src/lib/xendit/client.ts`, `XENDIT_MOCK=1` di dev). Jangan campur keduanya.

**Integration Settings Hub** (`src/features/integration`) sebagian besar **presentasional** — config connector nyata ada di halaman/route per-connector (`src/app/api/settings/<connector>`); **TIDAK ada** lapisan lib `src/lib/integration` bersama.

### D. Penjualan & POS

| Modul | Fungsi | Status |
|-------|--------|--------|
| **POS Core** | Kasir, keranjang, split payment, pembayaran (Xendit/QRIS), NFC | live |
| **POS Customer Display** (EPIC-024) | Layar customer kedua (`/pos/customer-display`) via BroadcastChannel `pos-cfd` + QRIS dinamis | ready-for-qa |
| **Loyalty ARK/XP** | ARK Coin + XP lifetime, top-up, rate, gateway | live (bagian CRM) |
| **Sales Funneling B2B** (EPIC-022) | Leads corporate/sekolah/acara, quotation builder (PPN/PDF/WA), termin, realisasi BOM | ready-for-qa |
| **Table Order / Photobooth** | App-tree berdiri sendiri (`/table-order`, `/photobooth`) | — |

Kode: `src/features/pos`, `src/lib/pos/*`, `src/lib/xp.ts`, `src/features/sales-funnel`, `src/lib/sales-funnel`; app `src/app/pos`, `src/app/dashboard/pos`, `src/app/table-order`, `src/app/photobooth`. Schema `pos.*`, loyalty/payment-gateway.

**Mekanik POS & Sales penting:**
- Tabel `pos_*` di schema **public** (bukan `pos.`); sales funnel isolasi di `crm.*`.
- **Cashier = monolith** `cashier-page.tsx` (~1963 baris) sekaligus **publisher CFD** (publish state cart/bayar/done via `useEffect`); `storeResultPayload` = satu sink sukses semua jalur bayar. Shift open/close feature-flagged OFF default.
- **CFD** (`src/lib/pos/cfd.ts`): transport **BroadcastChannel** `pos-cfd` antar-tab satu browser (zero-latency, offline) + **snapshot localStorage** agar refresh tak blank; done ditahan `CFD_DONE_HOLD_MS`=6000ms; **privasi: hanya nama depan** member ke layar publik, tak pernah no HP. Kontrak sengaja transport-agnostik (SSE bridge tablet bisa reuse payload).
- **QRIS dinamis** (`api/pos/qris`): 503 bila `XENDIT_SECRET_KEY` kosong (fallback QRIS statis), rate-limit 30/window, MVP **manual confirm** (webhook auto-confirm ditunda ke produksi), dev `XENDIT_MOCK=1`.
- **NFC**: `nfc_uid` di `pos_customers`; bila dipakai bayar & saldo ARK kurang → arahkan `topup` (bukan select); UID tak dikenal → `create`; muncul sbg `nfc_tab` di CFD.
- **Loyalty**: `pos_loyalty_settings` singleton (id `a0000000-…-0001`, `ark_rate` default 1000); XP diberi saat **credit topup** (`creditPendingTopup`→`awardCrmXpForTopup`), bukan saat request. AWAS split-pay: tiap split award XP sendiri (risiko double-award bila dibayar dua kali).
- **`src/lib/xp.ts` ≠ POS XP** — itu sistem XP **HR/TalentPool** (kandidat/interview, `level=floor(sqrt(xp/1000))+1`). Jangan dikelirukan dengan loyalty XP POS.
- **Sales Funnel B2B** (EPIC-022): role `sales` **route-aware** (bukan FULL_ACCESS) → hanya `/dashboard/sales-funnel/*` + ESS. Tiap lead/deal wajib `outlet_id` (non-null, scope). **Termin quotation** = persen wajib Σ=100 (toleransi 0.01). PDF quotation/invoice **server-side pdfkit** (deterministik, bukan `window.print()`). Reminder follow-up numpang infra notif EPIC-020. 6 stage default: Prospek Baru→Dihubungi→Proposal→Nego/Survey→Menang→Kalah.
- **Table-order** (`/table-order/[tableCode]`, EPIC-048) = self-order QR meja **produksi**: katalog `pos_products` (sama dengan kasir), harga/pajak dihitung server (`lib/table-order`, profil billing), member via sesi OTP portal (`member_session`), QRIS Xendit terikat order (`pos-ord-<id>`, webhook + polling `GET /api/table-order/orders/[id]`), ARK Coin (wajib sesi), open bill kasir. QR meja dicetak dari Dashboard → POS → Tables. **Photobooth** (`/photobooth/self-service`) masih prototipe.

**Gotcha (sales funnel):** lock inventory `ORDER BY id`, `raw_materials` ber-tenant, pdfkit page-break manual, dnd jangan `<button>`, multi-write `withTransaction`. **Customer display** ditahan 6 dtk saat "done" (storeResultPayload); buka DI LUAR layout dashboard (fullscreen) → monitor 2 → F11.

### E. Ticketing Theme Park (EPIC-023) — _ready-for-qa_

Tiga pilar: **NFC postpaid**, **harga musiman**, **channel manager**. Reuse infra POS/NFC/Xendit (~70%). Schema `ticketing.*` (**21 tabel** — domain terbesar). Kode: `src/features/ticketing/*`, `src/lib/ticketing/*`, `/dashboard/ticketing`. **Didokumentasikan penuh terpisah:** [`EPIC-023-ticketing-theme-park-SISTEM.md`](./epics/EPIC-023-ticketing-theme-park-SISTEM.md) (model produk R1, tab ledger dua arah, batas Ticketing↔POS, forfeit revenue).

- **Produk & harga** — `ticket_types`, `ticket_seasons` (regular/high; high menang saat overlap, range tanggal manual bernama, TANPA auto-weekend), `ticket_channels`, `ticket_prices` (UNIQUE tipe×season×channel — harga per-channel walk-in vs website). Engine `src/lib/ticketing/pricing.ts`. UI `/dashboard/ticketing/{tickets,channel-manager}`.
- **Kunjungan / NFC tab** — `ticket_visits` (mode postpaid/prepaid), `ticket_visit_charges`, `ticket_bands` (nfc_uid, aset venue berputar — BEDA dari identitas member). Postpaid = tab akrual dengan **credit limit** (tap ditolak bila lewat); prepaid = deposit (saldo = deposit − charge). Loket registrasi + gate tap-charge; settle sekali di exit (satu pembayar bisa lunasi banyak band). `src/lib/ticketing/tab.ts`.
- **Booking publik** — `ticket_bookings` (status menunggu-bayar/terbayar/dibatalkan/**hangus**, `visit_id`, `booking_slug`) → bayar Xendit → redeem gelang di loket. Webhook `src/app/api/public/booking/webhook/xendit/route.ts` verifikasi `x-callback-token`, idempoten `UPDATE ... WHERE status='menunggu-bayar'`, cek nominal. **Forfeit configurable**: `booking_forfeit_days` per venue (NULL=tak hangus); `booking-forfeit-watcher.ts` jalan tiap jam → `hangus` + `forfeited_at` untuk pengakuan revenue.

- **Season Pass** (EPIC-028) — pass masuk berlaku (annual/membership) via jenis produk ke-3 `season_pass`. Jalur **terpisah** dari booking harian: header `ticket_season_passes`, config `ticket_pass_configs` (validity rolling + entry_policy `once_per_day`/`unlimited`/`limited_visits`), log `ticket_pass_entries`. Gate tersendiri `gate/pass-tap` (once/day dijamin unique partial index anti-race). Jual loket + online (Xendit prefix `tkt-pass-` + QR via WA). Renewal + reminder ≤14 hari. `src/lib/ticketing/season-pass.ts`.

**Gotcha:** revenue booking = titipan-sampai-redeem + hangus configurable. Sisa: Xendit produksi. `build|tail` bisa menelan exit code — cek `.next/BUILD_ID` sebelum `pm2 restart`.

> **Season Pass didokumentasikan penuh terpisah:** lihat
> [`EPIC-028-ticketing-season-pass-SISTEM.md`](./epics/EPIC-028-ticketing-season-pass-SISTEM.md)
> (jenis produk `season_pass`, jalur pass terpisah, entry_policy 3-tipe, anti-race once/day, gate `pass-tap`).

### F. Items, Inventory & Purchasing

| Modul | Fungsi | Status |
|-------|--------|--------|
| **Items Master** | 3 master terpisah: `item.raw_materials` (F&B+BOM), `item.products` (jual), `item.supply_items` (operasional, flag stockable) | live |
| **Inventory** | 3 domain stok paralel: `inventory.inventory` (raw), `finished_goods_inventory` (produk), `inventory.supply_inventory` (operasional). Stock, opname, adjustment, transfer, movements | live |
| **Purchasing Barang Operasional** (EPIC-026) | PR→PO→GRN→Approval→Invoice→Bayar untuk barang operasional via `module_type` ketiga `general` | **ready-for-qa** |
| **Items & POS Master Stock** (EPIC-027) | Master bersih, stok akurat, katalog POS = mirror `item.products` | backlog |
| **Manufacturing** | Produksi, resep, konsumsi BOM | `src/lib/manufacturing` |

Kode: `src/features/{items,inventory,master-data,purchasing}`, `src/modules/purchasing`, `src/lib/{inventory,manufacturing,purchasing}`. Schema `item.*`, `inventory.*` (6 tabel delta), `purchasing.*` (5), `manufacturing.*`.

**Mekanik penting (mudah terlewat):**
- **CRUD item-master ada di bawah namespace `src/app/api/purchasing/`** (raw-materials, products, units, bom, supply-items, production) — BUKAN `api/items` (tak ada). UI di `/dashboard/items/*` dengan split 3-arah `RM_ROUTES`/`PRODUCT_ROUTES`/`GENERAL_BASE` di `src/modules/purchasing/constants/item-routes.ts`.
- **Gudang = "Stall".** `configuration.warehouses` di-relabel jadi "Stall" di UI (`src/lib/configuration/stall-labels.ts`); kode `MAIN` = Main Storage, `STALL-0N` = stall. Menentukan jenis transfer.
- **Costing rata-rata tertimbang** diterapkan di 2 tempat: agregat cabang (`src/lib/inventory/warehouse-stock.ts`, `Σ(qty·cost)/Σqty`) & penerimaan transfer (`stock-transfer.ts`, cost tujuan dihitung ulang). **AWAS: penyelesaian opname TIDAK menghitung ulang rata-rata** — ia pakai `unit_cost` tersimpan.
- **Ledger `inventory.inventory_movements`** = satu jejak audit; tiap mutasi qty menulis baris before/after + valuasi (`tipe`: in/out/adjustment/transfer; `reference_type`: grn/stock_opname/stock_transfer/…).
- **Opname** (`inventory.stock_opnames` + `_lines`) jalan dalam `withTransaction` + `SELECT ... FOR UPDATE`; overwrite qty ke hasil hitung, post varian jadi movement. Ada versi RM & produk (`product_stock_opnames`).
- **Stok RM per-gudang** vs stok produk (`finished_goods_inventory`) di-key berbeda; **transfer produk masih placeholder** (`src/features/items/product/placeholder-config.ts`).
- **Manufacturing** (`manufacturing.production_orders` + BOM `bom_items`/`raw_material_bom_items`): hitung kebutuhan material `qty_required·(1+waste_factor)·planned_qty`, HPP per unit dari material+overhead+labor+packaging. `src/lib/manufacturing/bom-helpers.ts` sengaja **menelan error 42P01** (relasi belum dimigrasi) agar fitur degrade mulus.

> **Purchasing didokumentasikan penuh terpisah:** lihat
> [`EPIC-026-purchasing-barang-operasional-SISTEM.md`](./epics/EPIC-026-purchasing-barang-operasional-SISTEM.md)
> (arsitektur `module_type`, XOR diskriminan 3-arah, pola shared vs klon, vendor `usage_scope`, GRN→stok non-fatal).

### G. Keuangan

| Modul | Fungsi | Status |
|-------|--------|--------|
| **Finance — Invoice & Pembayaran (AR)** (EPIC-025) | Sales ajukan invoice → finance terbitkan/tolak/catat bayar; pipeline read-only | ready-for-qa |
| **Accounting** | Chart of Accounts + Account Types (masters) | baru (dari merge branch bersama) |

**Finance (Opsi B — pemisahan tugas ketat):** Sales hanya **mengajukan** invoice (dipaksa status `diajukan`, DELETE hanya miliknya yang belum diproses); Finance yang menerbitkan/batal/catat-bayar (403 utk sales). Invoice **fisik hidup di `crm.*`** (`crm_sales_invoices` asal sales-funnel) — modul finance = guard + UI relayer, bukan schema baru. Role: `FINANCE_ROLES = [super_admin, finance_staff]`; `finance_staff` ESS-only kecuali `/dashboard/finance` (`ROLE_MODULE_PATHS`). Pipeline popup pembayaran read-only, sumber tunggal status pelunasan (belum/sebagian/lunas). Kode `src/features/finance/*`, `src/lib/finance/server.ts`.

**Accounting (COA):** schema `accounting.*` (satu migrasi `20260720120000`). `account_types` (code UNIQUE, `normal_balance` DEBIT/CREDIT), `chart_of_accounts` (hierarki `parent_id` self-FK `ON DELETE RESTRICT`, `account_type_id` FK RESTRICT, `is_postable` bedakan leaf posting vs grouping). Tree/flatten `src/lib/accounting/coa-tree.ts`, import spreadsheet `coa-spreadsheet.ts`. Kode `src/features/accounting/*`, `/dashboard/accounting/{chart-of-accounts,account-types}`.

QA finance butuh akun `finance_staff` ber-scope company.

---

## 5. Model Data (ringkas per schema)

| Schema | Cakupan |
|--------|---------|
| `iam` | menus, roles, role_menu_permissions (RBAC per-menu) |
| `auth` | sessions (cookie `nuhabit_session`) |
| `hris` / `payroll` | karyawan, kehadiran, cuti, kontrak, payroll, lembur, pinjaman, slip |
| `recruitment` | job openings, kandidat, psikotes, interview, offer (16 tabel) |
| `crm` | member global, XP/ARK coin, loyalty, collectibles, omnichannel/inbox (20 tabel) |
| `pos` | transaksi, meja, pembayaran, loyalty settings |
| `ticketing` | tiket, gelang NFC, booking, harga musiman, channel manager (21 tabel) |
| `item` | raw_materials, products, supply_items, units, categories |
| `inventory` | inventory, finished_goods_inventory, supply_inventory, movements, opname |
| `purchasing` | vendors, purchase_requests, purchase_orders, pr_items, po_items, grn, supply_usages |
| `finance` / `accounting` | invoice/pembayaran AR; chart_of_accounts, account_types |
| `configuration` | company, branch, warehouse, business hierarchy, stall (8 tabel) |
| `performance` | KPI scorecard (5 tabel) |
| `manufacturing` | produksi, resep |

> Angka "tabel" = hitungan `CREATE TABLE` di migrasi delta; tabel inti lama (pos/hris/item/iam)
> dibuat sebelum era delta sehingga tidak terhitung penuh di sini.

---

## 6. Infrastruktur & Deployment

- **App dev:** PM2 `arkiv-pos-saas` → `next start -p 3459` (**production build**). Ubah kode ⇒ `npm run build` **lalu** `pm2 restart arkiv-pos-saas`. Cek `.next/BUILD_ID` ada sebelum restart (build|tail menelan exit code).
- **Service samping:** `services/wa-gateway` (Baileys, PM2, `127.0.0.1:3471`), `services/pos-nfc-bridge` (jembatan NFC POS).
- **Public URL:** `sulu.within.ventures` (tunnel within-ventures) & `member.within.ventures` (dev-tunnel) → cloudflared → `localhost:3459`. Ubah config ⇒ `systemctl restart cloudflared-*`.
- **Port lookalike yang harus DIHINDARI:** 3000 (Express Basic-Auth lain), 3004 (Docker `arkiv` stale, kredensial DB lama), 3005 (`~/Arkiv` repo lain).
- **Migrasi:** `npm run db:migrate:apply`; ledger checksum; idempoten.
- **Push:** `git -c credential.helper='store --file=~/.git-credentials-arkiv' push origin development`.

---

## 7. Registry Epik (lengkap)

| Epic | Judul | Status |
|------|-------|--------|
| EPIC-001 | Recruitment Pipeline Revamp | on-progress |
| EPIC-002 | Psikotes Online | ready-for-qa |
| EPIC-003 | Interview AI | ready-for-qa |
| EPIC-004 | Offer (Penawaran + Portal Respons) | ready-for-qa |
| EPIC-005 | Live Monitoring Rekrutmen | ready-for-qa |
| EPIC-006 | Kontrak Karyawan (PKWT/PKWTT) | ready-for-qa |
| EPIC-007 | Kehadiran & Cuti — Perombakan + ESS | ready-for-qa |
| EPIC-008 | Payroll & Gaji | ready-for-qa |
| EPIC-009 | Logbook Revamp | ready-for-qa |
| EPIC-010 | KPI Scorecard | backlog |
| EPIC-011 | CRM Revamp — Member Global, XP, ARK Coin, Portal | ready-for-qa |
| EPIC-012 | WhatsApp Customer Service | ready-for-qa |
| EPIC-013 | Omnichannel — Google Review & Instagram DM | coding |
| EPIC-014 | CRM Collectibles | on-progress |
| EPIC-015 | Pensiun Modul Jadwal Lama | ready-for-qa |
| EPIC-016 | Suara AI — TTS | ready-for-qa |
| EPIC-017 | Do — Asisten AI | on-progress |
| EPIC-018 | Lampiran & OCR | on-progress |
| EPIC-019 | Desktop Arkiv OS — Monitoring Owner | coding |
| EPIC-020 | Notifikasi WhatsApp Owner | ready-for-qa |
| EPIC-021 | Dashboard Eksekutif Lintas Modul | coding |
| EPIC-022 | Sales Funneling — Leads B2B | ready-for-qa |
| EPIC-023 | Ticketing Theme Park | ready-for-qa |
| EPIC-024 | POS Customer Display + QRIS | ready-for-qa |
| EPIC-025 | Finance — Invoice & Pembayaran (AR) | ready-for-qa |
| EPIC-026 | Purchasing Barang Operasional | ready-for-qa |
| EPIC-027 | Items & POS — Master Stock | backlog |

---

## 8. Konvensi & Gotcha Lintas-Modul

1. **`next build` abaikan type-error** (`ignoreBuildErrors`) → build hijau ≠ runtime aman. Setelah merge/perubahan besar, jalankan `npx tsc --noEmit` & diff error BARU vs baseline; error tipe bocor jadi ReferenceError/undefined di runtime.
2. **Urutan build→restart**: `pm2 restart` hanya SETELAH `npm run build` selesai (hindari ChunkLoadError dari chunk lama).
3. **Multi-tenant fail-closed**: selalu scope query per company/branch/warehouse; jangan bocorkan data lintas tenant.
4. **RBAC menu-driven**: halaman baru butuh entri `iam.menus` + grant role (migrasi pola idempoten 4-langkah).
5. **Next 16 = `src/proxy.ts`** (bukan `middleware.ts`); guard role via header `x-pathname` di layout.
6. **ui/dialog** default sempit (`sm:max-w-sm`) — override lebar wajib prefix `sm:`.
7. **pg**: kolom `date` = objek `Date`; hati-hati `RETURNING "*"` embed; multi-write pakai `withTransaction`.
8. **Migrasi**: idempoten, checksum ledger, JANGAN edit setelah apply.

---

## 9. Referensi

- Epic detail: `docs/epics/EPIC-0XX-*.md` + registry `docs/epics/README.md`.
- Purchasing barang operasional (mendalam): `docs/epics/EPIC-026-purchasing-barang-operasional-SISTEM.md`.
- Ticketing theme park (mendalam): `docs/epics/EPIC-023-ticketing-theme-park-SISTEM.md`.
- Season Pass ticketing (mendalam): `docs/epics/EPIC-028-ticketing-season-pass-SISTEM.md`.
- Instruksi workflow agentik: `docs/AGENTIC-WORKFLOW.md` / `AGENTS.md` (bila ada).

> **Catatan penyusunan:** dokumen ini disintesis dari registry epik, ringkasan proyek
> internal, dan survei struktur kode langsung. Kedalaman per modul mengikuti ketersediaan
> catatan; modul ber-status `coding`/`on-progress` bisa berubah cepat — verifikasi ke kode
> terbaru sebelum dijadikan acuan keras.
