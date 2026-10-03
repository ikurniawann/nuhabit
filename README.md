# BCD Coffee OS

BCD Coffee OS adalah ERP terpadu berbasis Next.js dan PostgreSQL native untuk operasional Aapex Technology. Sistem ini mencakup HRIS, rekrutmen, POS, CRM loyalty, purchasing, inventory, produksi, reporting QA, BCD Coffee OS desktop, serta beberapa self-service flow untuk customer.

Database memakai PostgreSQL biasa (driver `pg`), auth/session di-handle di application layer (bcrypt + cookie session), dan data layer memakai shim ringan di `src/lib/db-client` yang meniru subset API PostgREST.

## Tech Stack

| Layer | Teknologi |
| --- | --- |
| Framework | Next.js App Router, React |
| Database | PostgreSQL (driver `pg`), schema-per-domain |
| Auth | Custom (bcrypt + cookie session), schema `auth` |
| Styling | Tailwind CSS v4, shadcn/ui, custom BCD Coffee OS design system |
| Data & Form | React Hook Form, Zod, TanStack Query |
| Charts | Recharts |
| Drag & Drop | @hello-pangea/dnd |
| Email | Resend |
| WhatsApp | Fonnte API |
| Deployment | Vercel |
| AI | Ollama cloud models untuk BCD Coffee OS AI Assistant |

## Module Overview

### BCD Coffee OS Desktop

Route utama:
- `/arkiv-os`
- `/qa`

Fitur:
- Desktop-style launcher untuk membuka module bisnis dalam window.
- AI Assistant dengan mode context project atau general knowledge.
- Pengaturan AI Assistant di BCD Coffee OS Settings, termasuk pilihan LLM.
- QA progress dashboard sementara di `/qa` untuk ringkasan progress dan test result.

Dokumentasi terkait:
- `Arkiv_progress.md`
- `docs/qa/QA_REPORT_ARKIV_OS_PROGRESS_2026-05-24.md`

### HRIS

Route utama:
- `/dashboard/hris`
- `/dashboard/employees`
- `/dashboard/hris/attendance`
- `/dashboard/hris/leaves`
- `/dashboard/hris/payroll`
- `/dashboard/hris/performance`
- `/dashboard/hris/reports`

Fitur:
- Master karyawan, department, position, employment status.
- Attendance, leave request, leave balance, salary, payroll, payslip.
- Onboarding dan offboarding.
- Performance management, KPI templates, employee KPI, review, behavioral score, development plan.
- HRIS reporting.
- Integrasi Talent Pool ke employee.

Dokumentasi terkait:
- `docs/hris/HRIS_FASE_0_COMPLETION.md`
- `docs/hris/HRIS_FASE1_COMPLETE.md`
- `docs/hris/HRIS_FASE2_PAYROLL_COMPLETE.md`
- `docs/hris/HRIS_FASE3_KPI_PERFORMANCE.md`

### Recruitment dan Career Portal

Route utama:
- `/career`
- `/portal`
- `/dashboard/hris/candidates`
- `/dashboard/hris/pipeline`
- `/dashboard/hris/talent-pool`
- `/dashboard/hris/job-portal`

Fitur:
- Portal publik untuk kandidat.
- Candidate management.
- Pipeline rekrutmen.
- Talent pool.
- Job opening dan job portal management.
- Candidate promotion ke HRIS employee.

Dokumentasi terkait:
- `docs/recruitment/TASK_COMPLETION_REPORT.md`
- `docs/360-feedback-system.md`

### POS F&B

Route utama:
- `/dashboard/pos`
- `/dashboard/pos/cashier-new`
- `/dashboard/pos/products`
- `/dashboard/pos/open-bills`
- `/dashboard/pos/kds`
- `/dashboard/pos/orders`
- `/dashboard/pos/print-queue`
- `/dashboard/pos/printer-settings`
- `/dashboard/pos/topup`
- `/dashboard/pos/reservation`

Fitur:
- Cashier POS untuk F&B.
- Product management, category, variant, modifier, station routing.
- Dine-in, takeaway, customer search, add customer/member dari POS.
- Table management dan open bill.
- Save/open bill, bayar bill, dan status order.
- KDS station routing untuk kitchen, bar, bakery, dessert, merchandise, photobooth.
- Print queue untuk kitchen/bar/customer ticket.
- Shift open/close flow.
- ARK Coin top-up.
- Reservation.
- Sinkron produk purchasing ke POS.
- Sinkron HPP aktual produksi ke `pos_products.cost_price`.
- Snapshot profit item order: `cost_price`, `cost_total`, `gross_profit`, `gross_margin_pct`.

Dokumentasi terkait:
- `docs/pos/POS.md`
- `docs/pos/POS_DEVELOPMENT_PLAN.md`
- `docs/pos/POS-BACKEND-SETUP.md`
- `docs/pos/POS_INTEGRATION_GUIDE.md`
- `docs/pos-print-queue-worker.md`
- `SPLIT_BILL_PLAN.md`

### Table Self-Service Ordering

Route utama:
- `/table-order/[tableCode]`

Fitur:
- QR table ordering untuk customer dine-in.
- Member lookup atau guest checkout.
- Menu 2 kolom mobile dengan XP per produk.
- Variant modal saat add to cart.
- Floating order summary.
- Payment method options: QRIS, ARK Coin, VA, bayar di kasir.
- Order status dan repeat order setelah transaksi terkirim.
- Auto routing order ke kitchen/bar melalui POS/KDS backend.

Dokumentasi terkait:
- `docs/pos/TABLE_SELF_SERVICE_ORDERING_PLAN.md`

### Photobooth Self-Service POS

Route utama:
- `/photobooth/self-service`

Fitur:
- UI self-service POS khusus photobooth, terpisah dari POS F&B.
- Tap Member Card.
- Payment melalui POS payment layer.
- Disiapkan untuk integrasi partner/vendor photobooth.
- Partner callback akan dipakai untuk update XP setelah sesi photobooth sukses.

Dokumentasi terkait:
- `docs/crm/PHOTOBOOTH_SELF_SERVICE_POS_PLAN.md`
- `docs/crm/PHOTOBOOTH_PARTNER_INTEGRATION_GUIDE.md`

### CRM, Membership, Loyalty, dan Rewards

Route utama:
- `/dashboard/crm`
- `/dashboard/crm/members`
- `/dashboard/crm/members/[id]`
- `/dashboard/crm/rewards`
- `/dashboard/crm/avatars`

Fitur:
- Customer dan member database.
- Membership tiering.
- XP dan ARK Coin loyalty engine.
- XP rules dari POS products.
- Member loyal, top spender ARK Coin, top spender transaksi.
- Reward redeem: discount, merchandise, avatar collectible.
- Avatar catalog dan customer-owned avatar collection concept.
- Integrasi XP dari POS, photobooth, dan future third-party game partner.

Dokumentasi terkait:
- `docs/crm/CRM_MEMBERSHIP_LOYALTY_PLAN.md`
- `docs/crm/CRM_DEVELOPMENT_PROGRESS.md`
- `docs/xp-system/XP_SYSTEM_SUMMARY.md`
- `docs/xp-system/XP_SYSTEM_INTEGRATION.md`
- `docs/xp-system/XP_INTEGRATION_EXAMPLES.md`

### Purchasing dan Procurement

Route utama:
- `/dashboard/purchasing`
- `/dashboard/purchasing/suppliers`
- `/dashboard/items/raw-materials`
- `/dashboard/items/units`
- `/dashboard/purchasing/products`
- `/dashboard/purchasing/products/[id]/bom`
- `/dashboard/purchasing/price-list`
- `/dashboard/purchasing/pr`
- `/dashboard/purchasing/po`
- `/dashboard/purchasing/grn`
- `/dashboard/purchasing/delivery`
- `/dashboard/purchasing/qc`
- `/dashboard/purchasing/returns`
- `/dashboard/purchasing/reports`

Fitur:
- Supplier master data.
- Raw material master data, termasuk material type `PURCHASED` dan `WIP`.
- Unit management.
- Product master untuk produk yang diproduksi atau disinkronkan ke POS.
- Recipe/BOM editor dengan support WIP sebagai bahan BOM.
- Price list supplier.
- Purchase Request.
- Purchase Order.
- Barang Masuk workspace: delivery dan receiving digabung berbasis status.
- QC dan return.
- Inventory adjustment dan movement.
- Reports: inventory valuation, PO summary, PO detail, supplier performance, stock card.

Dokumentasi terkait:
- `docs/purchasing/README.md`
- `docs/purchasing/PURCHASING_DEVELOPMENT_PLAN.md`
- `docs/purchasing/PURCHASING_PRODUCTION_PROGRESS_2026-05-24.md`
- `docs/purchasing/GRN-LOGIC-REVIEW.md`

### Production, WIP, HPP, dan COGS

Route utama:
- `/dashboard/purchasing/production`
- `/dashboard/purchasing/production/orders/[id]`
- `/dashboard/purchasing/production/recipes`
- `/dashboard/purchasing/reports/hpp-breakdown`
- `/dashboard/purchasing/reports/stock-card`

Fitur:
- List produk yang bisa diproduksi.
- Production order lifecycle: draft, release, start, complete, cancel.
- Cek ulang stok bahan.
- Complete production mengurangi stok bahan baku.
- Output produk jadi masuk finished goods inventory.
- Output WIP masuk stok bahan sebagai raw material type `WIP`.
- WIP bisa dipakai sebagai komponen BOM produk final.
- HPP WIP terbawa ke HPP produk final melalui average cost inventory.
- HPP aktual produk jadi tersinkron ke POS `cost_price`.
- Stock card untuk audit movement raw material dan WIP.

### Inventory

Route utama:
- `/dashboard/inventory`
- `/dashboard/inventory/low-stock`
- `/dashboard/inventory/[id]`
- `/dashboard/purchasing/reports/stock-card`

Fitur:
- Stok bahan baku.
- Low stock.
- Inventory movement.
- Stock adjustment.
- Stock card per material.
- Valuation report.
- Integrasi receiving, return, production consumption, dan WIP output.

Dokumentasi terkait:
- `docs/inventory/INVENTORY-ANALYSIS.md`
- `docs/inventory/INVENTORY-TEST-PLAN.md`
- `docs/inventory/QUICK-INVENTORY-TEST.md`

### Reporting dan QA

Route utama:
- `/qa`
- `/dashboard/purchasing/reports`
- `/dashboard/hris/reports`
- `/dashboard/pos`

Fitur:
- QA progress page.
- Purchasing reports.
- HRIS reports.
- POS dashboard.
- Profit-ready POS data via item-level cost snapshot.

### Master Data dan Settings

Route utama:
- `/dashboard/master/departments`
- `/dashboard/master/positions`
- `/dashboard/master/employment-statuses`
- `/dashboard/settings`

Fitur:
- Department.
- Position.
- Employment status.
- Global settings.
- BCD Coffee OS settings.

## API Surface

### HRIS

| Method | Endpoint | Deskripsi |
| --- | --- | --- |
| GET/POST | `/api/hris/employees` | Employee list dan create |
| GET/PUT/DELETE | `/api/hris/employees/[id]` | Detail, update, soft delete employee |
| GET/POST | `/api/hris/attendance` | Attendance |
| GET/POST | `/api/hris/leaves` | Leave request |
| POST | `/api/hris/leaves/approve` | Approve/reject leave |
| GET/POST | `/api/hris/payroll` | Payroll |
| GET/POST | `/api/hris/performance/reviews` | Performance review |
| GET/POST | `/api/hris/performance/employee-kpis` | Employee KPI |
| GET | `/api/hris/reports` | HRIS report |
| POST | `/api/hris/promote` | Promote kandidat ke employee |

### Recruitment

| Method | Endpoint | Deskripsi |
| --- | --- | --- |
| GET/POST | `/api/candidates` | Candidate list dan create |
| GET/PUT/DELETE | `/api/candidates/[id]` | Candidate detail dan update |
| POST | `/api/candidates/[id]/cv-upload` | Upload CV |
| POST | `/api/portal/submit` | Submit lamaran publik |

### POS

| Method | Endpoint | Deskripsi |
| --- | --- | --- |
| GET/POST | `/api/pos/products` | POS product list dan create |
| GET/PUT/DELETE | `/api/pos/products/[id]` | POS product detail dan update |
| POST | `/api/pos/products/sync-purchasing` | Sync purchasing product ke POS |
| GET/POST | `/api/pos/orders` | POS order list dan create paid order |
| PATCH | `/api/pos/orders/[id]` | Update order/payment |
| POST | `/api/pos/orders/open-bill` | Create open bill |
| GET | `/api/pos/kds` | Kitchen display data |
| GET/POST | `/api/pos/print-jobs` | Print queue |
| GET/POST | `/api/pos/shifts` | POS shift |
| POST | `/api/pos/shifts/[id]/close` | Close shift |
| GET/POST | `/api/pos/topup` | ARK Coin top-up |

### Table Order

| Method | Endpoint | Deskripsi |
| --- | --- | --- |
| GET | `/api/table-order/session/[tableCode]` | Resolve table order session |
| GET | `/api/table-order/products` | Product list untuk table order |
| POST | `/api/table-order/orders` | Submit customer table order |
| POST | `/api/table-order/customers/lookup` | Lookup member/customer |

### CRM

| Method | Endpoint | Deskripsi |
| --- | --- | --- |
| GET | `/api/crm/dashboard` | CRM dashboard summary |
| GET/POST | `/api/crm/members` | Member list dan create |
| GET/PUT/DELETE | `/api/crm/members/[id]` | Member detail dan update |
| GET/POST | `/api/crm/tiers` | Membership tier |
| GET/POST | `/api/crm/xp-rules` | XP rules |
| GET/POST | `/api/crm/rewards` | Reward catalog |
| GET/POST | `/api/crm/redemptions` | Reward redemption |
| GET/POST | `/api/crm/avatars` | Avatar catalog |
| GET | `/api/crm/avatar-inventory` | Avatar ownership inventory |
| GET/POST | `/api/pos/topup` | ARK Coin integration |
| GET/POST | `/api/pos/products` | XP per product integration |

Catatan: sebagian logic CRM berada di `src/lib/crm/loyalty-engine.ts` dan dipanggil dari POS order flow.

### Purchasing, Inventory, Production

| Method | Endpoint | Deskripsi |
| --- | --- | --- |
| GET/POST | `/api/purchasing/suppliers` | Supplier |
| GET/POST | `/api/purchasing/raw-materials` | Raw material |
| GET/POST | `/api/purchasing/units` | Unit |
| GET/POST | `/api/purchasing/products` | Purchasing product |
| GET/POST | `/api/purchasing/products/[id]/bom` | Product BOM |
| GET/POST | `/api/purchasing/price-list` | Supplier price list |
| GET/POST | `/api/purchasing/pr` | Purchase Request |
| GET/POST | `/api/purchasing/po` | Purchase Order |
| GET/POST | `/api/purchasing/delivery` | Supplier delivery |
| GET/POST | `/api/purchasing/grn` | Receiving / Barang Masuk |
| GET/POST | `/api/purchasing/qc` | Quality Control |
| GET/POST | `/api/purchasing/returns` | Return |
| GET/POST | `/api/purchasing/inventory/adjustment` | Inventory adjustment |
| GET | `/api/purchasing/inventory/movements` | Inventory movement |
| GET | `/api/purchasing/cogs/product/[id]` | Product COGS |
| GET/POST | `/api/purchasing/production/orders` | Production order |
| PATCH | `/api/purchasing/production/orders/[id]` | Release, start, complete, cancel, recheck stock |
| GET | `/api/purchasing/production/wip` | WIP inventory |
| GET | `/api/purchasing/reports/stock-card` | Inventory stock card |
| GET | `/api/purchasing/reports/inventory-valuation` | Inventory valuation |
| GET | `/api/purchasing/reports/po-summary` | PO summary |
| GET | `/api/purchasing/reports/supplier-performance` | Supplier performance |

### AI Assistant

| Method | Endpoint | Deskripsi |
| --- | --- | --- |
| POST | `/api/ai/assistant` | BCD Coffee OS AI Assistant |

## Database Highlights

Tabel diorganisir per **schema PostgreSQL** sesuai domain. Referensi tabel di app layer diakses "bare" dan diresolve lewat `search_path` global (`public, iam, configuration, hris, performance, recruitment, item, purchasing, inventory, manufacturing, pos, crm, auth`).

| Schema | Domain |
| --- | --- |
| `auth` | Identitas login & session (`auth.users`, `auth.sessions`) |
| `configuration` | Profil user app, audit, activity log |
| `iam` | Role, menu, permission, user-role |
| `hris` | Karyawan, attendance, leave, payroll, dll. |
| `performance` | KPI, review, 360 feedback |
| `recruitment` | Kandidat, interview, job opening |
| `item` | Master material/produk/satuan |
| `purchasing` | Supplier, PR/PO, GRN, QC, return |
| `inventory` | Stok, movement, finished goods |
| `manufacturing` | Production order, BOM, batch |
| `pos` | POS order, produk, shift, KDS |
| `crm` | Member, tier, reward, XP |
| `public` | Lintas domain (notifications, AI assistant) |

> File migrasi & pipeline ada di `database/` — lihat `database/README.md` untuk detail.

### HRIS
- `employees`
- `departments`
- `employment_statuses`
- `employee_salaries`
- `attendance`
- `leaves`
- `payroll`
- `employee_kpis`
- `performance_reviews`
- `development_plans`

### Recruitment
- `candidates`
- `job_openings`
- `feedback_cycles`
- `feedback_assignments`
- `feedback_responses`

### POS
- `pos_products`
- `pos_categories`
- `pos_product_variants`
- `pos_modifier_groups`
- `pos_modifiers`
- `pos_orders`
- `pos_order_items`
- `pos_tables`
- `pos_print_jobs`
- `pos_shifts`
- `pos_customers`

Profit-related POS order item fields:
- `cost_price`
- `cost_total`
- `gross_profit`
- `gross_margin_pct`

### CRM
- `crm_members`
- `crm_xp_rules`
- `crm_xp_transactions`
- `crm_rewards`
- `crm_reward_redemptions`
- `crm_avatars`
- `crm_member_avatars`

### Purchasing, Inventory, Production
- `suppliers`
- `raw_materials`
- `units`
- `supplier_price_lists`
- `products`
- `bom_items`
- `purchase_requests`
- `purchase_orders`
- `po_items`
- `deliveries`
- `grn`
- `gr_items`
- `qc_inspections`
- `returns`
- `inventory`
- `inventory_movements`
- `production_orders`
- `production_order_materials`
- `production_batches`
- `finished_goods_inventory`

## Environment Variables

```env
# Database (PostgreSQL native)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/arkiv
MIGRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/arkiv

# AI Assistant (Ollama)
OLLAMA_API_BASE=http://localhost:11434
OLLAMA_API_KEY=
OLLAMA_MODEL=

# Integrasi opsional
FONNTE_API_KEY=
RESEND_API_KEY=
NEXT_PUBLIC_APP_URL=

# Web push portal member /member (opsional; tanpa kunci, push diam).
# Buat sepasang per lingkungan: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:ops@example.com
```

| Variabel | Dipakai oleh | Keterangan |
| --- | --- | --- |
| `DATABASE_URL` | App Next.js (`pg`) | Koneksi utama aplikasi |
| `MIGRATE_DATABASE_URL` | `db:migrate*`, seeder | Target migrasi (Postgres lokal) |

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Environment

Buat `.env` (atau `.env.local`) dan set minimal `DATABASE_URL` + `MIGRATE_DATABASE_URL` ke Postgres lokal, plus konfigurasi AI/email/WhatsApp sesuai kebutuhan. Lihat tabel [Environment Variables](#environment-variables).

### 3. Database Setup

Pastikan database target sudah ada di Postgres lokal (mis. `CREATE DATABASE arkiv;`).

```bash
# Lihat migrasi pending (dry-run, read-only)
npm run db:migrate

# Terapkan migrasi ke database
npm run db:migrate:apply

# Seed akun Super Admin (idempoten)
npm run db:seed:super-admin
```

Kredensial default Super Admin: `super@arkivworld.com` / `Arkiv2026*#` (override via `SUPER_USER_EMAIL`, `SUPER_USER_PASSWORD`).

Panduan lengkap pipeline migrasi: [database/README.md](database/README.md)

### 4. Run Development Server

```bash
npm run dev
```

Buka:

```text
http://localhost:3000
http://localhost:3000/arkiv-os
http://localhost:3000/dashboard/pos/products
http://localhost:3000/dashboard/purchasing
```

## Project Structure

App Router hanya berisi routing + layout shell (thin wrapper); logic UI ada di `src/features/` per domain.

```text
database/
├── migrations/                 # baseline + incremental (schema-per-domain)
│   ├── bootstrap/              # app_auth, prelude, functions, FK, views, triggers
│   ├── schemas/<domain>/       # satu file per tabel (public = schema PostgreSQL public)
│   ├── deltas/                 # migrasi incremental YYYYMMDD…
│   └── ...
├── seeders/                    # super-admin.js, dll.
└── scripts/                    # generate-from-db, apply-migrations, ...

src/
├── app/
│   ├── arkiv-os
│   ├── dashboard/              # routing + layout (thin-wrap ke @/features)
│   │   ├── (dashboard)/        # shell AppSidebar (hris, crm, purchasing, ...)
│   │   ├── employees           # pindah dari hris/employees
│   │   └── pos
│   ├── photobooth/self-service
│   ├── table-order/[tableCode]
│   ├── (public)/career
│   ├── (public)/portal
│   └── api/
├── features/                   # UI domain (pola: index.ts + components/*-page.tsx)
│   ├── users/                  # employee/user (data layer + pages)
│   ├── hris/  performance/  recruitment-related/
│   ├── purchasing/  inventory/  master-data/
│   ├── crm/  pos/  configuration/  design-system/
│   └── finance/  accounting/  integration/
├── components/
│   ├── ui/  pos/  layout/
├── hooks/
├── lib/
│   ├── db.ts                   # pool pg + search_path global
│   ├── db-client/              # shim data layer (PostgREST-like)
│   ├── pg/                     # query-builder PostgREST-like
│   ├── auth/                   # session + password (bcrypt)
│   ├── api/  crm/  inventory/  pos/  purchasing/
├── modules/
│   └── purchasing/             # shared UI legacy purchasing
└── types/
```

## Roles

Role valid mengikuti constraint `configuration.users.role`:

| Role | Akses Utama |
| --- | --- |
| `super_admin` / `admin` | Semua module |
| `hrd` / `hiring_manager` | HRIS, recruitment, employee, performance |
| `direksi` | Dashboard dan report |
| `purchasing_admin` | Purchasing, procurement, inventory, production |
| `purchasing_manager` | Approval, purchasing report, production |
| `purchasing_staff` | PR/PO, purchasing operasional |
| `warehouse_admin` / `warehouse_staff` | Receiving, inventory, QC, stock card |
| `qc_staff` | Quality control |
| `finance_staff` | COGS, report, finance-related approval |
| `pos` / `pos_supervisor` | POS cashier, order, payment, shift |

## Design Notes

- BCD Coffee OS memakai aksen pink sebagai primary action.
- Dashboard operasional dibuat padat, scannable, dan action-oriented.
- POS dan self-service flow mengutamakan touch-friendly controls.
- Purchasing memakai istilah operasional Indonesia seperti Barang Masuk, Produksi, dan Recipe/BOM.
- Dropdown dan clickable UI harus memiliki cursor/action affordance yang jelas.

## Important Docs

- `docs/purchasing/README.md`
- `docs/purchasing/PURCHASING_PRODUCTION_PROGRESS_2026-05-24.md`
- `docs/crm/CRM_DEVELOPMENT_PROGRESS.md`
- `docs/pos/POS_DEVELOPMENT_PLAN.md`
- `docs/qa/QA_REPORT_ARKIV_OS_PROGRESS_2026-05-24.md`
- `docs/purchasing/PROJECT_STANDARDS.md`
- `docs/AGENTS.md`
