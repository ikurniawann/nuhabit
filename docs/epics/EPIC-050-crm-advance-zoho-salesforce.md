# EPIC-050: CRM Advance — Menuju Setara Zoho / Salesforce (Bertahap) — `MODULE-CRM`

status: on-progress
environment: dev
phase: 6 (Fase 1–5 selesai, deploy dev 2026-09-13 → lanjut Fase 6 Pelengkap)
priority: P1
area: Fullstack
module: `MODULE-CRM`
retries: 0

## Goal

Menaikkan CRM BCD dari "loyalty + inbox + funnel B2B sederhana" menjadi CRM
penuh setara Zoho CRM / Salesforce Sales Cloud untuk skala UMKM-menengah:
objek **Account → Contact → Lead → Deal** yang utuh, **email dua arah** yang
otomatis tercatat di timeline, **tasks & kalender**, **lead scoring**,
**workflow automation**, **forecasting & kuota**, **custom field**, **report /
dashboard builder**, lalu pelengkap (AI prediktif, customer service cases,
web-to-lead, journey marketing, outbound webhooks).

Prinsip: **melengkapi yang sudah ada, bukan membangun ulang**. Setiap fase
memakai infrastruktur yang sudah jalan (WA gateway, Resend, watcher, notifikasi
in-app, AI provider, Open API token) dan memperluas tabel `crm.crm_sales_*`
yang ada, bukan membuat modul paralel.

Referensi benchmark: Zoho CRM (Leads/Contacts/Accounts/Deals, Blueprint,
Workflow Rules, Email-in, Scoring Rules, Forecast) dan Salesforce Sales Cloud
(Email-to-Case / Email-to-Salesforce dropbox, Process Builder/Flow, Forecast
Categories commit/best-case/pipeline, Custom Fields & Page Layout, Report &
Dashboard Builder). Diambil polanya, dibuang yang enterprise-only (territory,
CPQ penuh, Einstein full, multi-currency, multi-org).

## Audit Kondisi Saat Ini (2026-09-13)

Dua modul terpisah hari ini: **CRM** (B2C loyalty & customer care) dan
**Sales Funneling** (B2B, EPIC-022). Ringkasan apa yang sudah ada dan bisa
dipakai ulang:

### Sales Funneling (`crm.crm_sales_*`, menu `sales-funnel.*`)

| Area | Sudah ada | Catatan / gap |
|------|-----------|---------------|
| Leads | `crm_sales_leads`: org_name, org_type, PIC (nama/jabatan/telp/email inline), city, source, temperature (manual panas/hangat/dingin), status, owner, link ke `pos_customers`, import spreadsheet | Tidak ada entitas **Account** terpisah — nama instansi hanya string di lead. PIC satu per lead (bukan objek Contact). Tidak ada skor otomatis. |
| Pipeline | `crm_sales_deals` + `crm_sales_stages` (6 tahap default, konfigurable, `stuck_threshold_days`), kanban, `stage_history`, lost reasons, close dialog | **Satu pipeline** saja; tidak ada `pipeline_id`, tidak ada **probability per stage**, tidak ada deal team (hanya `owner_user_id`). |
| Aktivitas / task | `crm_sales_activities`: activity_type (call/meeting/wa/email/note), `due_at`, `done_at`, owner, pengingat WA via `followup-reminder-watcher`; halaman "Follow-up Hari Ini" | Ini sudah **cikal bakal Tasks**: tinggal ditambah prioritas, status, recurring, kalender, dan bisa nempel ke Account/Contact/Member/Case (sekarang hanya lead/deal). |
| Quotation & invoice | `crm_sales_quotations` (PPN, valid_until, BOM realisasi stok), `quotation_terms` (termin), `crm_sales_invoices`, PDF quotation & invoice | **Tidak ada approval** (0 referensi "approv"), tidak ada versi quotation, tidak ada aturan diskon. |
| Laporan | Deal baru, nilai booking, pipeline berjalan, win rate, leaderboard owner, per jenis acara / instansi / sumber lead | Tidak ada forecast/kuota, tidak ada report builder. |
| Pengaturan | Stages, template WA, resep (recipes) | Tidak ada custom field, scoring, workflow rule. |
| Akses | Role `sales` (route-aware), `marketing` (EPIC-032) sudah ada di `iam.roles` | Siap dipakai untuk permission fitur baru. |

### CRM Loyalty & Customer Care (`crm.*`, menu `crm.*`)

| Area | Sudah ada | Catatan / gap |
|------|-----------|---------------|
| Member / contact B2C | `pos.pos_customers` (phone, email, tier, XP, total_spent, visit_count, last_visit, wa_consent…) + `crm_member_profiles`, tiers, XP rules & ledger, rewards, avatars, wallpapers, badges, member portal & mobile app (EPIC-044) | Ini adalah **Contact B2C**. Data RFM mentah (recency = last_visit, frequency = visit_count, monetary = total_spent) **sudah ada di kolom**, tinggal dihitung jadi segmen. |
| Inbox omnichannel | WA 2-arah (gateway mandiri + Fonnte/Meta), Instagram DM, Google Review; kategori komplain, SLA (`cs-sla-watcher`), catatan internal, reply templates | Belum ada objek **Case/Ticket** formal, knowledge base, CSAT. |
| AI | `conversation-insights` (ringkasan, topik, sentimen, komplain) via DeepSeek/OpenAI; asisten "Do" | Fondasi untuk predictive scoring & next-best-action. |
| Kampanye | `crm_campaigns` **WA-only**, segmen: last_visit_days, tiers, min_xp; voucher batch, daily cap, jam kirim, opt-out (`crm_marketing_optouts`); EPIC-033 on-progress | Tidak ada kanal **email**, segmen belum RFM/dinamis tersimpan, tidak ada journey. |
| Integrasi masuk | `crm_integration_partners` + `crm_external_events` (webhook inbound partner → XP), Open API token (EPIC-042) | **Belum ada outbound webhook** (event → URL pelanggan). |

### Infrastruktur platform yang dipakai ulang

- **Email keluar**: `src/lib/resend` (Resend) — hari ini hanya dipakai dataroom share. Resend punya webhook `email.opened` / `email.clicked` / `email.delivered` → **tracking open/click tanpa bangun pixel sendiri**.
- **WA**: `src/lib/wa/*` (notifikasi, template, watcher) + gateway; pengingat sudah lewat sini.
- **Notifikasi in-app**: `public.notifications` (user_id, title, message, type, link, is_read).
- **Watcher/cron**: `src/instrumentation.ts` mendaftarkan campaign, cs-sla, followup-reminder, notifications, booking-forfeit, topup-reconcile watcher → pola siap untuk **workflow time-based**.
- **AI provider**: DeepSeek/OpenAI di Settings → Integrasi.
- **PDF**: quotation & invoice PDF sudah ada → dasar document generation.
- **Form publik**: portal karier (`/portal`) = pola form publik + anti-spam → dasar web-to-lead.

## Masukan Saya terhadap Rencana Owner

Daftar P0/P1/P2 owner sudah tepat sasaran. Beberapa koreksi urutan dan cara
supaya tidak ada pekerjaan yang dibongkar ulang:

1. **Fondasi dulu, email kedua.** Email 2-arah, tasks, scoring, dan
   automation semuanya "nempel" ke record dan ke satu timeline. Kalau email
   dibangun sebelum ada Account/Contact dan timeline terpadu, log email harus
   dimigrasi ulang. Urutan yang saya sarankan: **Fase 1 = Account + Contact +
   Timeline terpadu + Tasks/Kalender**, baru **Fase 2 = Email**.
2. **Email 2-arah: jangan mulai dari OAuth Gmail** *(owner: DITUNDA — lihat Keputusan #2; catatan ini tetap jadi acuan saat dikerjakan)*. Scope Gmail
   `gmail.readonly/modify` termasuk *restricted scope* Google → aplikasi wajib
   lolos verifikasi + security assessment (CASA) sebelum bisa dipakai di luar
   akun tester; prosesnya berminggu-minggu dan berbiaya. Cara Salesforce
   (Email-to-Salesforce / Email-to-Case) & Zoho (Mail-in / BCC dropbox) lebih
   cepat dan cukup:
   - **Keluar**: kirim dari CRM via Resend (domain `bcdcoffee.id`
     diverifikasi), template + merge field, log otomatis, tracking open/click
     dari webhook Resend.
   - **Masuk**: alamat dropbox `crm@in.bcdcoffee.id` (Resend inbound /
     Cloudflare Email Routing → endpoint kita). Sales cukup **BCC/forward** dari
     Gmail/Outlook apa pun → email otomatis nempel ke lead/deal/contact
     berdasarkan alamat pengirim/penerima dan `In-Reply-To`.
   - **OAuth Gmail/Outlook** (sinkron mailbox penuh) jadi fase lanjutan
     opsional setelah nilai bisnisnya terbukti; Outlook via Microsoft Graph lebih
     mudah verifikasinya daripada Gmail.
3. **Tasks jangan bikin tabel baru dari nol** — generalisasi
   `crm_sales_activities` (sudah punya due, done, owner, reminder) menjadi
   objek Task/Activity polimorfik (`subject_type`, `subject_id`) yang bisa
   nempel ke lead/deal/account/contact/member/case, ditambah prioritas, status,
   recurrence, dan kalender. `hris.department_tasks` **tidak** dipakai (domain
   HR, tanpa relasi ke record CRM).
4. **Menu: satukan CRM + Sales Funneling** menjadi satu modul "CRM" dengan
   grup Sales / Customer Care / Members & Loyalty / Marketing / Reports /
   Settings (rincian di bawah). Ini mengubah keputusan owner EPIC-022 #1 (nama
   menu "Sales Funneling") → butuh persetujuan.
5. **Workflow rules dibatasi trigger/aksi yang jelas** di rilis pertama:
   trigger = record dibuat / field berubah / stage berubah / tidak ada aktivitas
   N hari / tanggal jatuh tempo; aksi = kirim WA, kirim email, buat task, assign
   owner, ubah field, notifikasi in-app, webhook keluar. Time-based = tabel
   `scheduled_actions` yang dieksekusi watcher. Approval process pertama
   dibatasi **approval diskon quotation** (kebutuhan nyata), bukan builder
   approval generik.
6. **Custom field via JSONB + registry field**, bukan kolom fisik. Page
   layout customization ditunda ke P2 karena mahal dan jarang dipakai UMKM;
   yang dibutuhkan lebih dulu adalah **urutan/visibilitas field** sederhana.
7. **Report builder bertahap**: (a) saved views + filter + group-by + export
   + kirim terjadwal (email/WA) → menutup 80% kebutuhan; (b) dashboard widget
   builder; (c) drag-drop penuh belakangan.
8. **Multi-pipeline dibuka** karena BCD punya jenis penjualan berbeda
   (acara/booking venue, B2B kopi/katering, Resort, Ticketing grup) — tiap
   pipeline punya tahap + probability sendiri; ini prasyarat weighted forecast.
9. **AI prediktif (win probability, churn) masuk P2** dan hanya bermakna
   setelah data deal/aktivitas cukup (ratusan deal). Sebelum itu pakai skor
   rule-based; churn member bisa lebih awal karena data transaksi POS sudah
   banyak.

## Keputusan Owner (2026-09-13)

1. **Menu CRM + Sales Funneling digabung** — SETUJU. Struktur di bawah dipakai;
   route lama `/dashboard/sales-funnel/*` di-redirect ke `/dashboard/crm/sales/*`.
2. **Email integration DITUNDA** (pending keputusan owner). Semua pekerjaan
   email (kirim/terima, template email, tracking, mass email, OAuth) dipindah
   ke **Fase 7** dan tidak menjadi prasyarat fase lain. Konsekuensi desain:
   - Reminder task & notifikasi workflow memakai **WA + in-app** saja dulu;
     kolom `reminder_channels` tetap menampung `email` agar tinggal diaktifkan.
   - Lead scoring rilis pertama tanpa sinyal email (open/click); sinyal = sumber,
     jenis instansi, kota, field custom, balasan WA, meeting, submit form publik.
   - Kampanye tetap **WA-only** sampai Fase 7.
3. **Pipeline awal** — owner minta penjelasan; dipakai **default sementara**
   (bisa diubah dari Pengaturan CRM tanpa migrasi):
   - *Event & Booking Venue* (tahap = 6 tahap EPIC-022 yang ada, probability
     10/25/50/75/100/0).
   - *B2B Kopi & Katering* (Prospek → Sampel/Penawaran → Nego → Kontrak →
     Menang / Kalah; 10/35/60/85/100/0).
   Resort dan Ticketing grup **belum** dibuat pipeline-nya sampai owner minta.
   Penjelasan awam: satu pipeline = satu urutan tahapan jualan; jenis jualan yang
   prosesnya berbeda mendapat pipeline sendiri supaya kanban & laporannya tidak
   campur.
4. **Kuota / target** — owner minta penjelasan; dipakai **default sementara**:
   target **per salesperson per bulan** dalam **nilai Rupiah deal menang**,
   dengan kolom target jumlah deal opsional. Penjelasan awam: kuota = angka
   yang harus dicapai tiap sales dalam satu periode; forecast membandingkan
   target itu dengan deal yang sudah menang + deal yang masih berjalan dikali
   peluangnya (weighted pipeline).
5. **Approval diskon quotation** — SETUJU. Default ambang (konfigurable):
   diskon > 10% butuh persetujuan `admin`/manajer; > 20% butuh `super_admin`
   (owner). Berjenjang: tingkat 1 dulu, lalu tingkat 2 bila melewati ambang 2.
6. **Web-to-lead** — SETUJU: **satu halaman publik** di
   `https://poskopi.reddie.id/public` (form permintaan penawaran / kontak) yang
   membuat lead otomatis + notifikasi WA ke sales. Bukan embed di WIT.ID.
   Route `/public` dan `/api/public/crm/forms` masuk daftar path publik
   middleware. Embed snippet untuk situs lain = opsional belakangan.

Item 3 dan 4 memakai default di atas; owner bisa mengubahnya kapan saja dari
Pengaturan CRM — tidak menghambat Fase 1.

## Struktur Menu Usulan

Satu top-level **CRM** (menggantikan `crm` + `sales-funnel`), kode menu baru
dengan prefix `crm.*`; menu lama diarahkan (redirect) agar bookmark tidak
putus. Semua kode WAJIB masuk daftar canonical `database/seeders/iam-menus.sql`.

```
CRM
├── Overview                      (crm.overview.dashboard — ada)
├── Sales
│   ├── Leads                     (sales-funnel.leads → crm.sales.leads)
│   ├── Accounts                  BARU (crm.sales.accounts)
│   ├── Contacts                  BARU (crm.sales.contacts — PIC lintas account)
│   ├── Pipeline                  (sales-funnel.pipeline → crm.sales.pipeline, multi-pipeline)
│   ├── Quotation & Invoice       (dari deal → crm.sales.quotations, approval, versi)
│   ├── Tasks & Kalender          (followups → crm.sales.tasks, view hari/minggu/bulan)
│   └── Forecast & Target         BARU (crm.sales.forecast)
├── Customer Care
│   ├── Inbox                     (crm.members.inbox → crm.care.inbox)
│   ├── Cases / Tiket             BARU (crm.care.cases)
│   ├── Google Review             (crm.members.reviews → crm.care.reviews)
│   ├── Knowledge Base            BARU P2 (crm.care.kb)
│   └── CSAT                      BARU P2 (crm.care.csat)
├── Members & Loyalty
│   ├── Members                   (crm.members.list)
│   ├── Rewards · Avatars · Wallpapers · Badges · XP Rules   (ada)
├── Marketing
│   ├── Kampanye WA               (crm.campaigns — kanal email menyusul Fase 7)
│   ├── Segmen                    BARU (crm.marketing.segments — dinamis + RFM)
│   ├── Form Publik (/public)     BARU (crm.marketing.forms — halaman poskopi.reddie.id/public)
│   ├── Journey                   BARU P2 (crm.marketing.journeys)
│   └── Promo                     (crm.promo — ada)
├── Reports & Dashboards
│   ├── Laporan CRM · Laporan Funnel   (ada, digabung)
│   ├── Report Builder            BARU (crm.reports.builder)
│   └── Dashboard Builder         BARU (crm.reports.dashboards)
└── Pengaturan CRM
    ├── Pipelines & Stages        (dari funnel settings)
    ├── Lead Scoring Rules        BARU
    ├── Workflow Rules            BARU
    ├── Approval Rules            BARU
    ├── Custom Fields             BARU
    ├── Template WA               (ada; template email menyusul Fase 7)
    ├── Email Accounts & Dropbox  DITUNDA (Fase 7)
    └── Webhooks Keluar           BARU
```

Akses: `super_admin`/`admin` penuh; `sales` → grup Sales + Tasks + laporan
funnel; `marketing` → Marketing + Members; agent CS → Customer Care. Detail
per menu di `iam.role_menu_permissions` saat Fase 1.

## Fitur per Prioritas (pemetaan ke daftar owner)

### 🔴 P0

**Account / Company (B2B)** — tabel `crm_accounts` (name, type, industry,
address, city, phone, email, website, npwp, owner, custom JSONB) dan
`crm_contacts` (account_id, name, title, phone, email, wa, is_primary,
customer_id → link member B2C). `crm_sales_leads` mendapat `account_id`,
`contact_id`; migrasi data: `org_name` unik per company → account, PIC → contact.
Account 360°: deals, quotation, invoice, tasks, email, WA, contacts, revenue.

**Tasks & Kalender** — generalisasi `crm_sales_activities` → tambah kolom
`subject_type/subject_id`, `priority`, `status` (open/in_progress/done/
cancelled), `recurrence` (RRULE sederhana: daily/weekly/monthly + until),
`reminder_at`, `reminder_channels` (wa/email/in_app). Kalender hari/minggu/
bulan (drag untuk ubah tanggal). Reminder lewat watcher yang sudah ada
(`followup-reminder-watcher` diperluas) + `public.notifications`.

**Email Integration** *(DITUNDA ke Fase 7 — keputusan owner 2026-09-13)* — (a) `crm_email_accounts` (alamat pengirim per user,
signature), `crm_email_templates` (merge field `{{contact.name}}`,
`{{account.name}}`, `{{deal.title}}`, `{{user.name}}`…), `crm_emails`
(direction, message_id, in_reply_to, subject, body_html, subject_type/id,
sent_by, status, opened_at, clicked_at), `crm_email_events` (webhook Resend);
(b) kirim dari record + timeline; (c) inbound dropbox: endpoint
`POST /api/integrations/email/inbound/[token]` → parse → cocokkan alamat ke
contact/lead → tempel ke record; (d) mass email: kanal `email` di
`crm_campaigns` + throttling + unsubscribe link (`crm_marketing_optouts`
sudah ada). OAuth Gmail/Outlook = task opsional terakhir.

**Lead Scoring (rule-based)** — `crm_scoring_rules` (kondisi: source, org_type,
city, field custom, aktivitas email dibuka / WA dibalas / meeting, kunjungan
form publik `/public`; poin ±; sinyal email menyusul Fase 7), kolom `score` + `score_breakdown` di lead, recalculation
oleh watcher tiap ada event, badge "Hot ≥ 70" di list & kanban, urut default
berdasarkan skor.

**Workflow Automation Rules** — `crm_workflow_rules` (object, trigger,
conditions JSON, actions JSON, is_active), `crm_workflow_runs` (log),
`crm_scheduled_actions` (untuk delay/time-based). Event bus internal
(`emitCrmEvent(type, payload)`) dipanggil dari server action yang sudah ada
(create/update lead, stage change, email opened, dll). Approval: `crm_approval_
rules` + `crm_approval_requests`, rilis pertama untuk diskon quotation
(multi-level berurutan), notifikasi WA/in-app ke approver, tombol Setujui/Tolak.

### 🟡 P1

**Forecasting & Quota** — `crm_sales_targets` (user/team, periode, target
nilai/jumlah), `probability` per stage per pipeline, `forecast_category`
per deal (pipeline/best_case/commit/closed), halaman Forecast: target vs
aktual vs weighted pipeline per salesperson/periode, tren.

**Custom Fields & Layout** — `crm_custom_fields` (object, key, label, type:
text/number/date/picklist/multipicklist/lookup/boolean, options, required,
validation regex/min/max, order, visible), data di kolom `custom JSONB` tiap
objek; form renderer generik; filter & report bisa memakai custom field.
Layout: urutan section + sembunyikan field (bukan drag-drop penuh).

**Custom Report & Dashboard** — `crm_reports` (object, columns, filters,
group_by, chart), `crm_dashboards` (widget grid), `crm_report_schedules`
(cron, penerima, kanal email/WA, format XLSX/PDF). Builder berbasis form
(pilih objek → kolom → filter → group → chart), export XLSX (pola EPIC-029).

**Quotation & Approval** — versi quotation (`version`, `parent_id`, status
superseded), expiry tracking + reminder H-3, approval diskon (dari P0),
aturan diskon maksimum per role.

**Deal / Pipeline enhancement** — `crm_pipelines` (per company), stages
punya `pipeline_id` + `probability`, deal punya `pipeline_id`; `crm_deal_
members` (user, role: owner/support/pre-sales, split %); kanban per pipeline.

**Marketing** — kanal email di kampanye (dari P0), `crm_segments` (definisi
filter dinamis tersimpan, termasuk RFM: hitung skor R/F/M 1–5 dari
`pos_customers` + `pos_orders`, kelompok Champions/Loyal/At-risk/Lost),
attribution: `source` + `utm_*` di lead & contact, laporan lead per sumber →
deal → revenue.

### 🟢 P2

**AI / Predictive** — predictive lead score (fitur: skor rule + histori
aktivitas + insight percakapan), deal win probability (model sederhana dari
histori stage & durasi), churn member (RFM tren + last_visit), next-best-action
(saran: follow-up, kirim promo, eskalasi) di kartu lead/deal/member — pakai
provider AI yang sudah ada, batch harian oleh watcher.

**Customer Service** — `crm_cases` (dari percakapan inbox, review, email
inbound, atau manual; kategori, prioritas, SLA, assignee, status, linked
contact/account/member), knowledge base (`crm_kb_articles`, dipakai agent &
publik), CSAT (kirim survei WA/email setelah case ditutup, skor 1–5 + komentar).

**Web-to-Lead Form** — `crm_forms` (field builder dari custom fields, tema,
redirect, notifikasi), endpoint publik `POST /api/public/crm/forms/[slug]`
(rate limit + honeypot/Turnstile), snippet embed `<script>`/iframe, UTM
otomatis, auto-create lead + scoring + workflow.

**Integrations** — outbound webhooks (`crm_webhook_subscriptions`: event,
url, secret; retry; log) di atas Open API EPIC-042; document generation dari
template (quote/invoice/kontrak DOCX/PDF dengan merge field).

**Marketing Journey** — builder visual: trigger → wait → kondisi → aksi
(WA/email/task/tag), berjalan di atas engine workflow + scheduled actions.

## Non-Goals

- Telephony/dialer bawaan, SMS, territory management, multi-currency,
  multi-org, CPQ penuh, Salesforce-style Apex/scripting, marketplace app.
- Sinkron mailbox OAuth penuh di rilis pertama (lihat Masukan #2).
- Page layout drag-drop penuh (P2, jika masih dibutuhkan setelah custom field).

## Desain Data (sketsa — skema `crm`)

```
crm_accounts(id, company_id, branch_id, name, type, industry, address, city,
  phone, email, website, npwp, owner_user_id, score, custom jsonb, …)
crm_contacts(id, company_id, account_id, name, title, phone, email, wa,
  is_primary, customer_id→pos_customers, custom jsonb, …)
crm_sales_leads(+ account_id, contact_id, score, score_breakdown jsonb,
  utm_source/medium/campaign, custom jsonb)
crm_pipelines(id, company_id, name, is_default) ; crm_sales_stages(+ pipeline_id, probability)
crm_sales_deals(+ pipeline_id, forecast_category, custom jsonb) ; crm_deal_members
crm_sales_activities → tasks (+ subject_type, subject_id, priority, status,
  recurrence, reminder_at, reminder_channels, parent_task_id)
crm_email_accounts, crm_email_templates, crm_emails, crm_email_events, crm_email_inbound_tokens
crm_scoring_rules ; crm_workflow_rules, crm_workflow_runs, crm_scheduled_actions
crm_approval_rules, crm_approval_requests, crm_approval_steps
crm_sales_targets ; crm_custom_fields
crm_reports, crm_dashboards, crm_dashboard_widgets, crm_report_schedules
crm_segments ; crm_forms, crm_form_submissions ; crm_webhook_subscriptions, crm_webhook_deliveries
crm_cases, crm_case_events, crm_kb_articles, crm_csat_responses
```

Semua tabel B2B tenant-scoped (`company_id` + `branch_id`) mengikuti EPIC-022;
member B2C tetap global (EPIC-011). Timeline terpadu = view/union
(`crm_timeline`) atas tasks, emails, wa_messages, stage_history, quotation,
invoice, case events — satu komponen `<RecordTimeline subject=…/>`.

## Task Groups (PR-sized, 1 group = 1 branch = 1 PR)

Urutan final setelah keputusan owner 2026-09-13 (email ditunda ke akhir).

### Fase 1 — Fondasi objek & menu (P0-a)
- [x] T-1.1 Migrasi `crm_accounts`, `crm_contacts`, kolom `account_id/contact_id`
      di leads; skrip migrasi data org_name/PIC → account/contact (idempoten).
- [x] T-1.2 Restrukturisasi menu (struktur di atas), redirect route lama,
      permission per role, update daftar canonical seeder.
- [x] T-1.3 Halaman Accounts & Contacts (list, form, 360° view). Import CSV account
      ditunda — lead import yang ada sudah otomatis membuat account/contact.
- [x] T-1.4 Timeline terpadu `<RecordTimeline>` dipakai di lead/deal/account/contact/member.
- [x] T-1.5 Tasks & Kalender: generalisasi activities, prioritas/status/recurring,
      view kalender, reminder WA + in-app; halaman "Tasks Saya".
- [x] T-1.6 Test: migrasi data, timeline union, recurrence, reminder watcher.

### Fase 2 — Scoring, Automation & Approval (P0-b)
- [x] T-2.1 Event bus `emitCrmEvent` + tabel event log; hook di server action yang ada.
- [x] T-2.2 Lead scoring rules (tanpa sinyal email) + recalculation + UI badge/urutan.
- [x] T-2.3 Workflow rules (trigger/kondisi/aksi WA, task, assign, ubah field,
      notif in-app, webhook) + scheduled actions watcher + log run.
- [x] T-2.4 Approval diskon quotation berjenjang (default 10% / 20%, konfigurable)
      + notifikasi WA/in-app + UI approver.

### Fase 3 — Pipeline, Forecast, Custom Field (P1-a)
- [x] T-3.1 Multi-pipeline (default: Event & Booking Venue, B2B Kopi & Katering)
      + probability per tahap + deal team; kanban per pipeline.
- [x] T-3.2 Target per salesperson per bulan (Rupiah, opsional jumlah deal) +
      target perusahaan per bulan (user_id NULL) + indikator alokasi +
      halaman Forecast (weighted, kategori commit/best-case/pipeline).
- [x] T-3.3 Custom fields registry + renderer + validasi + dipakai filter/report.
- [x] T-3.4 Versi quotation + expiry reminder (WA).

### Fase 4 — Reports & Dashboards (P1-b)
- [x] T-4.1 Report builder (objek → kolom → filter → group → chart) + export XLSX.
- [x] T-4.2 Dashboard builder (widget dari report) + set sebagai Overview.
- [x] T-4.3 Report terjadwal (WA; email menyusul) via watcher.

### Fase 5 — Marketing & Form Publik (P1-c)
- [x] T-5.1 Segmen dinamis tersimpan + RFM + preview jumlah; dipakai kampanye WA.
- [x] T-5.2 Attribution UTM & laporan sumber → deal → revenue.
- [x] T-5.3 Halaman publik `poskopi.reddie.id/public`: form permintaan penawaran/
      kontak (field dari custom fields, anti-spam honeypot + rate limit),
      endpoint `POST /api/public/crm/forms/[slug]`, auto-create lead + scoring +
      workflow + WA ke sales; branding BCD Coffee.

### Fase 6 — Pelengkap (P2)
- [ ] T-6.1 Cases/Tiket dari inbox/review + SLA + KB + CSAT.
- [ ] T-6.2 Outbound webhooks + document generation dari template.
- [ ] T-6.3 AI prediktif (lead/deal/churn/next-best-action) batch harian.
- [ ] T-6.4 Marketing journey builder di atas workflow engine.

### Fase 8 — Kemampuan Salesforce di luar rencana awal (disetujui owner 2026-09-13)
- [ ] T-8.1 Lead assignment rules & round-robin (wilayah / jenis instansi / giliran) — dipakai form publik & WA masuk.
- [ ] T-8.2 Duplicate management & merge (lead/contact/account) dengan riwayat ikut tergabung.
- [ ] T-8.3 Field history / audit trail per record (nilai deal, tahap, owner, diskon).
- [ ] T-8.4 Products & price book B2B (harga per segmen: korporat/sekolah/…) terhubung quotation.
- [ ] T-8.5 Sharing rules & hirarki (manajer melihat deal anak buah; sales hanya miliknya).
- [ ] T-8.6 Activity capture otomatis: WA masuk/keluar & telepon tertaut ke lead/deal tanpa input manual.
- [ ] T-8.7 Import wizard (account/contact/deal dari Excel, pemetaan kolom, pratinjau duplikat).

### Fase 7 — Email (DITUNDA — dikerjakan saat owner memberi lampu hijau)
- [ ] T-7.1 Verifikasi domain Resend + webhook events (delivered/opened/clicked/bounced).
- [ ] T-7.2 Template email + merge field + preview; kirim dari record; log ke timeline.
- [ ] T-7.3 Inbound dropbox (BCC/forward) + pencocokan ke record + lampiran.
- [ ] T-7.4 Kanal email di kampanye (throttling, unsubscribe, laporan open/click);
      sinyal email masuk ke scoring rules; reminder task via email.
- [ ] T-7.5 (opsional) OAuth Outlook/Gmail sinkron mailbox.

## Acceptance Criteria (ringkas, per fase)

- F1: satu instansi punya satu Account dengan banyak Contact; lead/deal/task
  terlihat di Account 360°; task punya prioritas/status/recurring, muncul di
  kalender, pengingatnya sampai via WA + in-app pada waktunya; menu CRM baru
  aktif dan route lama ter-redirect.
- F2: skor lead berubah otomatis sesuai aturan dan tampil di list/kanban;
  workflow rule "lead tanpa aktivitas 3 hari → buat task + WA owner" berjalan
  tanpa intervensi; quotation diskon > ambang tidak bisa dikirim sebelum
  disetujui berjenjang.
- F3: dua pipeline dengan tahap berbeda; forecast per salesperson menampilkan
  target vs weighted pipeline vs closed; custom field tampil di form, filter,
  dan report.
- F4: user non-teknis membuat report + chart sendiri, menaruhnya di dashboard,
  dan menerima kirimannya terjadwal via WA.
- F5: halaman `/public` bisa diakses tanpa login, kiriman form menjadi lead
  dengan sumber & UTM tercatat, sales menerima WA; segmen RFM bisa dipakai
  kampanye.
- F6/F7: sesuai deskripsi fitur; setiap fase menambah test unit untuk logika
  murni (scoring, workflow evaluator, RFM, recurrence, merge field) dan test
  route untuk endpoint publik (form publik, webhook, inbound email).

## Automation Log

- 2026-09-13 — Epic dibuat dari rencana owner (benchmark Zoho/Salesforce) +
  audit kode & DB deploy BCD. Temuan kunci: Sales Funneling sudah punya
  leads/deals/activities/quotation/invoice/laporan (EPIC-022) tapi tanpa
  Account, scoring, multi-pipeline, forecast, approval, email; CRM loyalty
  punya inbox omnichannel + AI insight + kampanye WA + data RFM mentah.
  Rekomendasi: fondasi objek & tasks dulu, email lewat dropbox/BCC + Resend
  (bukan OAuth Gmail), menu CRM + Sales Funneling digabung. Status `backlog`
  sampai 6 keputusan owner terjawab.
- 2026-09-13 — Keputusan owner: (1) menu digabung SETUJU; (2) email DITUNDA →
  dipindah ke Fase 7, reminder/kampanye WA + in-app dulu; (3)(4) pipeline &
  kuota memakai default sementara (2 pipeline; target per sales per bulan
  dalam Rupiah) karena owner minta penjelasan; (5) approval diskon SETUJU,
  default 10%/20%; (6) web-to-lead = halaman publik poskopi.reddie.id/public.
  Status → on-progress, mulai Fase 1.
- 2026-09-13 — **Fase 1 selesai (deploy dev).** Keputusan implementasi:
  (a) KODE menu & route Sales Funneling TIDAK diganti (`sales-funnel.*`,
  `/dashboard/sales-funnel/*`) — hanya pohon/label yang dipindah ke bawah CRM,
  sehingga gate IAM prefix, role `sales` route-aware, dan bookmark tetap berlaku;
  `/followups` → redirect ke `/tasks`. (b) Tasks = generalisasi
  `crm_sales_activities` (subject_type/subject_id, title, priority, status,
  recurrence, reminder_at, reminder_channels) — klien lama (deal dialog) tetap
  jalan lewat kolom lead_id/deal_id. (c) Lead create/update/import otomatis
  meng-upsert Account (by nama, case-insensitive) & Contact (by nomor WA) lewat
  `syncLeadAccountContact`, logika sama dengan migrasi data. (d) Timeline
  terpadu = endpoint `/api/sales-funnel/timeline` + `<RecordTimeline>` (task,
  tahap deal, quotation, invoice, WA by nomor, lead/deal dibuat) dipakai di lead
  detail, account 360°, contact (dialog), member detail (hideOnForbidden).
  (e) Reminder: watcher lama diperluas → `COALESCE(reminder_at, due_at)`,
  kanal WA + in-app (`public.notifications`, deep-link `?task=`). Bukti: 34 tes
  unit lulus (tasks, timeline, kalender, quotation), tsc & eslint bersih untuk
  file yang disentuh, migrasi data diuji dengan sampel di transaksi rollback.
- 2026-09-13 — Owner menyetujui penambahan Fase 8 (assignment rules, duplicate
  merge, field history, price book, sharing rules, activity capture, import
  wizard). Fase 2 dimulai.
- 2026-09-13 — **Fase 2 selesai (deploy dev).** (a) Event bus `emitCrmEvent`
  (crm_events) dipanggil dari route lead/deal/task/quotation yang ada; setiap
  event menghitung ulang skor lead terdampak dan menjalankan workflow rules;
  perubahan skor memancarkan `lead.score_changed` (trigger score_reached).
  (b) Scoring rule-based: 13 aturan default (sumber, jenis instansi, suhu,
  email PIC, balasan WA, meeting/telepon selesai, deal dibuat, quotation
  terkirim); sinyal email ditunda sesuai keputusan owner. Kolom skor + urut
  di daftar lead, rincian di detail. (c) Workflow: trigger created/updated/
  stage_changed/status_changed/score_reached/inactive_days/due_soon, kondisi
  AND (eq/in/contains/gt/…/changed_to), aksi send_wa/create_task/assign_owner
  (fixed/round-robin)/update_field (whitelist)/notify_in_app/webhook (HMAC)/
  wait → crm_scheduled_actions + watcher 5 menit; log di crm_workflow_runs.
  (d) Approval diskon quotation: kolom discount_percent/discount_nominal (PPN
  dari DPP setelah diskon), aturan default >10% admin & >20% super_admin
  (konfigurable), request+steps berjenjang, notifikasi in-app + WA approver,
  kirim WA / tandai terkirim-diterima diblokir saat pending/rejected, inbox
  Approval di Sales. Bukti: 18 tes unit baru (scoring, workflow, approvals) +
  192 total lulus; tsc & eslint bersih pada file yang disentuh; E2E API di
  deploy (skor 40→60 setelah meeting, rule referral memicu notif+task+wait,
  approval 15% satu tingkat & 25% dua tingkat).
- 2026-09-13 — **Fase 3 selesai (deploy dev).** (a) Multi-pipeline: tabel
  crm_pipelines, stages.pipeline_id + probability, deals.pipeline_id +
  forecast_category (otomatis dari probability tahap: commit ≥75, best_case
  ≥50), deal team (crm_deal_members); dua pipeline default (Event & Booking
  Venue; B2B Kopi & Katering) — tab di kanban, pipeline dipilih saat buat deal,
  pipeline & tahap baru dari Pengaturan Funnel. (b) Target per salesperson per
  bulan (crm_sales_targets, Rupiah + jumlah deal opsional) + halaman Forecast:
  target vs menang vs weighted (Σ nilai × probability), kategori commit/best
  case/pipeline, attainment & gap, filter pipeline. (c) Custom fields: registry
  crm_custom_fields (10 tipe, wajib, validasi min/max/regex, picklist), nilai di
  kolom custom jsonb lead/deal/account/contact, validasi server pada
  create/update, render otomatis di semua form, halaman Pengaturan CRM → Custom
  Fields; page layout drag-drop tetap ditunda (P2). (d) Versi quotation
  (revise → v+1, lama = superseded) + pengingat kedaluwarsa H-3 (watcher per
  jam, WA + in-app). Bukti: 9 tes unit baru (custom fields, forecast) — 201
  total lulus; tsc & eslint bersih untuk file yang disentuh; E2E API di deploy.
- 2026-09-13 — **Target perusahaan (lanjutan T-3.2, permintaan owner).**
  crm_sales_targets.user_id jadi nullable: NULL = target perusahaan per
  bulan/pipeline; unique index ber-COALESCE(user_id) + constraint UNIQUE
  bawaan (nama terpotong) dibuang. Forecast: bila target perusahaan diisi,
  baris Total memakai target perusahaan dan menampilkan alokasi Σ target
  salesperson (% teralokasi, sisa/melebihi); bila kosong, total = Σ
  salesperson (perilaku lama). Input "Target perusahaan" di mode Atur target.
  Sales hanya melihat target sendiri + target perusahaan. Bukti: tes unit
  splitTargets/sumForecast; E2E API: simpan 80jt perusahaan + 30jt sales →
  total 80jt, allocated 30jt; upsert ulang tetap 1 baris; 0 → kembali Σ sales.
- 2026-09-13 — **Fase 4 selesai (deploy dev).** (a) Report builder generik
  (src/lib/crm/report-builder.ts): registry 6 dataset (lead, deal, quotation,
  task, account, contact) berisi label + ekspresi SQL; pengguna hanya memilih
  KUNCI field sehingga tidak ada string pengguna yang masuk ke SQL, nilai filter
  selalu lewat parameter. Mode tabel & agregasi (count/count_distinct/sum/avg/
  min/max), group by termasuk bucket tanggal (harian s/d tahunan), 12 operator
  filter, 11 preset periode yang dihitung saat report DIJALANKAN (bukan saat
  disimpan), 7 tipe tampilan. Role sales otomatis dibatasi ke record miliknya.
  Halaman Report Builder + simpan/bagikan report + ekspor XLSX (sheet Data +
  Info). (b) Dashboard CRM: crm_dashboards + crm_dashboard_widgets, widget
  chart/tabel/KPI dengan lebar 1–3 kolom, satu dashboard bisa ditandai Overview
  (unique index per company). Report yang tidak boleh dilihat pemakai tampil
  kosong, tidak menggagalkan dashboard. (c) Laporan terjadwal:
  crm_report_schedules + watcher tiap 15 menit dengan klaim atomik
  (next_run_at digeser dulu) supaya tidak terkirim ganda; harian/mingguan/
  bulanan pada jam WIB, kanal WA + notifikasi aplikasi, tombol "Kirim sekarang"
  tidak menggeser jadwal rutin. Email tetap ditunda ke Fase 7.
  Menu baru: crm.reports.builder, crm.reports.dashboards, crm.reports.schedules
  (allowlist seeder ikut diperbarui). Bukti: 20 tes unit baru (237 total lulus);
  tsc & eslint bersih untuk file yang disentuh; E2E API di deploy — injeksi
  kolom/sort ditolak (hanya field registry yang lolos, tabel tetap utuh),
  dataset asing 400, XLSX 2 sheet terunduh, widget report palsu 400, jadwal
  mingguan tanpa hari 400, kirim uji coba terkirim tanpa menggeser next_run_at.
  Cacat yang ditemukan & diperbaiki saat verifikasi: (1) nilai enum registry
  ditulis dalam bahasa Inggris padahal CHECK constraint memakai bahasa
  Indonesia (panas/hangat/dingin dst.) — kini ada tes penjaga; (2) opsi
  ApexCharts `labels: undefined` membuat grafik gagal digambar; (3) seri rupiah
  dan cacah pada satu sumbu membuat batang cacah tak terlihat — kini sumbu
  ganda; (4) batang horizontal menampilkan label kategori NaN; (5) kartu KPI
  memilih kolom cacah, kini mengutamakan kolom rupiah.
- 2026-09-13 — **Fase 5 selesai (deploy dev).** (a) Segmen dinamis
  (crm_segments): registry 3 sumber (member/lead/contact) bergaya report-builder
  — pengguna hanya memilih kunci field, nilai lewat parameter. RFM memakai
  NTILE(5) atas populasi terpilih sehingga skor relatif (5 = terbaik) dan tetap
  masuk akal saat basis pelanggan tumbuh; 6 preset siap pakai (Champions, Loyal,
  Belanja Besar, Berisiko Hilang, Tidur, Baru). Pratinjau jumlah + contoh
  anggota. Kampanye WA kini bisa memakai segmen tersimpan lewat kolom
  crm_campaigns.segment_id; segmen inline lama tetap jalan (segment_id NULL),
  dan segmen yang hilang/nonaktif otomatis jatuh balik ke segmen inline agar
  kampanye tidak diam-diam mengirim ke seluruh basis pelanggan. (b) Atribusi
  UTM: 7 kolom baru di lead (utm_source/medium/campaign/content/term,
  landing_page, referrer), terisi otomatis dari tautan iklan ke form publik;
  utm_source dipetakan ke daftar sumber yang sah (nilai asing jatuh ke default,
  tidak pernah masuk mentah). Halaman Atribusi Sumber menampilkan lead dan
  nilai deal per sumber/UTM, blok "Asal Lead" muncul di detail lead. (c) Form
  publik (crm_forms + crm_form_submissions) di poskopi.reddie.id/public: field
  builder, validasi ulang di server (kunci tak terdaftar dibuang), honeypot +
  ambang waktu pengisian + rate limit 5 per 5 menit per IP, kiriman selalu
  dicatat (ok/duplicate/rejected + alasan), lead otomatis dengan scoring &
  workflow, notifikasi WA + aplikasi ke sales. Kiriman berulang dari nomor &
  instansi sama digabung ke lead lama sebagai catatan, bukan ditolak.
  Menu baru: crm.marketing.{segments,forms,attribution}; path publik /public dan
  /api/public/crm/forms ditambahkan ke PUBLIC_AUTH_PREFIXES (berkas middleware
  bernama src/proxy.ts sejak Next 16). Bukti: 26 tes unit baru (243 total
  lulus); tsc & eslint bersih untuk file yang disentuh; E2E di deploy —
  /public 200 tanpa login, slug berbahaya 404, kiriman sah membuat lead dengan
  UTM & skor 30, honeypot dan kiriman terlalu cepat tidak membuat lead,
  isian tak lengkap 400, kiriman ke-6 kena 429, sumber segmen asing & skor RFM
  di luar 1–5 ditolak 400. Cacat yang ditemukan & diperbaiki saat verifikasi:
  (1) isian angka "abc" diam-diam jadi 0; (2) galat kontak terduplikasi;
  (3) stempel waktu dari masa depan dilaporkan sebagai "terlalu cepat" padahal
  payload dipalsukan; (4) kolom UTM tersimpan tapi tidak dipilih API detail
  lead sehingga tak terlihat sales; (5) aturan global `.flex.min-h-screen` di
  globals.css menimpa latar halaman publik dengan page-mesh terang — diganti
  min-h-dvh; (6) daftar form menampilkan "0 field" karena field bawaan hanya
  dipakai saat render.
