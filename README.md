# NüHabit

Platform pengelolaan venue **Hyrox** — kelas, Personal Training, member pass, komisi coach, dan loyalitas — dalam satu
sistem dengan backoffice & accounting. Dikembangkan dari codebase BCD Coffee OS (Next.js + PostgreSQL native) dan
disesuaikan untuk kebutuhan studio fitness.

**DEV:** https://nuhabitdev.reddie.id · Brand & UI: [DESIGN.md](DESIGN.md) · Kebutuhan: [docs/product/PRD.md](docs/product/PRD.md)

## Tiga sistem

| Sistem | Rute | Pengguna | Bahasa |
| --- | --- | --- | --- |
| **Backoffice** | `/dashboard` (menu **Kelas & Coach**) | Owner, admin, front desk, finance | Indonesia |
| **Member App** | `/member` | Member (login OTP WhatsApp) | **Inggris** |
| **Coach Portal** | `/coach` | Coach & Head Coach (akun karyawan yang ditautkan ke profil coach) | Indonesia |

## Fitur utama

| Area | Ringkasan | Epic |
| --- | --- | --- |
| Coach, program & jadwal | Profil coach, program kelas, template mingguan → generate sesi, kalender kelas, cegah bentrok coach | [052](docs/epics/EPIC-052-studio-coach-program-jadwal.md) |
| Member Pass | Paket kredit Class / Class + Personal Training / + Facility, masa berlaku, utang pass (liability) & pengakuan revenue saat dipakai | [053](docs/epics/EPIC-053-member-pass.md) |
| Booking & check-in | Kredit dikunci saat booking, batal ≥ 12 jam kredit kembali, waitlist otomatis, scan check-in, no-show | [054](docs/epics/EPIC-054-booking-kelas-checkin.md) |
| Personal Training | Ketersediaan & cuti coach, slot otomatis, booking pilih coach + tanggal + jam | [055](docs/epics/EPIC-055-personal-training.md) |
| Komisi coach | Di luar payroll: pool 10% revenue kelas + 40% Personal Training, dibagi per peran, approve & bayar per coach, jurnal | [056](docs/epics/EPIC-056-komisi-coach-coach-portal.md) |
| Member App | Booking kelas & Personal Training, pass & beli paket online (QRIS / Virtual Account / kartu), profil coach, News Hyrox | [057](docs/epics/EPIC-057-member-app-nuhabit.md) |
| Otomasi | Tutup hari otomatis (selesaikan sesi, kedaluwarsakan pass) & pengingat WhatsApp member | [058](docs/epics/EPIC-058-job-harian-notifikasi-wa.md) |
| NüHabit Progress | XP dari konsistensi latihan, tier Starter/Open/Pro/Elite dengan benefit booking, leaderboard | [066](docs/epics/EPIC-066-nuhabit-progress-loyalitas.md) |

Status semua epic: [docs/epics/README.md](docs/epics/README.md) · Prioritas berikutnya: [docs/BACKLOG.md](docs/BACKLOG.md).

Modul warisan BCD yang tetap dipakai: HRIS & payroll (gaji tetap), Accounting (COA, jurnal, laporan), POS F&B,
Inventory, CRM. Menu BCD yang tidak relevan (resort, photobooth, table order, rekrutmen, dll.) disembunyikan.

## Tech stack

| Layer | Teknologi |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript |
| Database | PostgreSQL (driver `pg`), schema-per-domain — modul NüHabit di schema `studio` |
| Auth | Custom (bcrypt + cookie session) untuk staf; OTP WhatsApp untuk member |
| UI | Tailwind CSS v4, shadcn/ui, design system NüHabit (Manrope + Outfit) |
| Validasi | Zod 4 |
| Pembayaran | Xendit (QRIS); simulator untuk DEV |
| WhatsApp | WA Gateway / Meta Cloud API / Fonnte |
| Test | Vitest (unit), skrip E2E API terhadap database uji |
| Deploy DEV | Docker (standalone) + Cloudflare Tunnel |

## Menjalankan secara lokal

```bash
npm install
```

Buat `.env.local` minimal:

```env
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<db>
MIGRATE_DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<db>
NEXT_PUBLIC_APP_NAME=NüHabit
```

```bash
npm run db:migrate          # lihat migrasi pending (dry-run)
npm run db:migrate:apply    # terapkan migrasi
npm run db:seed:super-admin # akun Super Admin (atur SUPER_USER_EMAIL / SUPER_USER_PASSWORD)
npm run dev                 # http://localhost:3000
```

Migrasi baru: `database/migrations/deltas/YYYYMMDDHHMMSS_<nama>.sql` (idempoten). Menu IAM baru wajib ditambahkan
ke keep-list di `database/seeders/iam-menus.sql`. Panduan lengkap: [database/README.md](database/README.md).

## Pengujian

```bash
npm test                              # semua unit test
npx vitest run src/lib/studio         # logika studio (booking, pass, komisi, loyalitas, job)
```

E2E dijalankan ke database terpisah **`nuhabit_test`** — jangan pernah ke database DEV yang berisi data owner.
Resep lengkap ada di [docs/DEPLOY-DEV.md](docs/DEPLOY-DEV.md).

## Deploy DEV

Container `nuhabitdev-app` (port 8141) di belakang Cloudflare Tunnel → https://nuhabitdev.reddie.id. Resep build &
redeploy: [docs/DEPLOY-DEV.md](docs/DEPLOY-DEV.md).

Pengaturan **khusus DEV** (wajib dihapus sebelum produksi):

| Variabel | Fungsi |
| --- | --- |
| `MEMBER_OTP_FIXED_CODE=123456` | Login Member App memakai kode tetap selama WA Gateway belum terhubung |
| `MEMBER_PREVIEW_ENABLED=1` | Tombol **Buka Member App** di backoffice (staf membuka Member App tanpa OTP) |
| `PAYMENT_SIMULATOR=1` | Beli paket dengan QRIS / Virtual Account / kartu diperlakukan sukses tanpa uang sungguhan |

## Struktur kode NüHabit

```text
src/
├── app/
│   ├── dashboard/(dashboard)/studio/   # halaman backoffice Kelas & Coach
│   ├── member/                         # Member App
│   ├── coach/                          # Coach Portal
│   └── api/
│       ├── studio/                     # API backoffice
│       ├── member-portal/studio/       # API Member App
│       └── coach/                      # API Coach Portal
├── features/
│   ├── studio/                         # UI backoffice studio
│   └── member-app/                     # UI Member App (+ i18n.ts: terjemahan pesan server)
└── lib/studio/                         # logika murni (*.ts + *.test.ts) & server (*-server.ts)
```

Konvensi: logika murni tanpa DB di `src/lib/studio/*.ts` beserta tes; akses DB di `*-server.ts`; route hanya
mengekspor handler (schema Zod di `src/lib/studio/schemas.ts`). Tulis **"Personal Training"** lengkap di semua teks
UI (jangan "PT").

## Dokumen penting

- [DESIGN.md](DESIGN.md) — brand guideline, warna, tipografi, aturan copy
- [docs/product/PRD.md](docs/product/PRD.md) — kebutuhan owner & pertanyaan terbuka
- [docs/epics/README.md](docs/epics/README.md) — status epic (sumber kebenaran)
- [docs/BACKLOG.md](docs/BACKLOG.md) — prioritas & checklist di luar development
- [docs/DEPLOY-DEV.md](docs/DEPLOY-DEV.md) — deploy DEV & database uji
- [docs/design/nuhabit-ui/NUHABIT-UI-STYLING.md](docs/design/nuhabit-ui/NUHABIT-UI-STYLING.md) — panduan styling UI untuk tim
- [AGENTS.md](AGENTS.md) — panduan untuk agen/kontributor
