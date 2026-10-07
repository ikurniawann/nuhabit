# EPIC-001: Recruitment Pipeline Revamp

status: ready-for-qa
environment: dev
retries: 0

## Goal

Merombak modul rekrutmen menjadi pipeline 8 tahap yang actionable per tahap
(Applied → Screening → Psikotes → Interview → Offer → Hired, plus Talent Pool &
Tolak), dengan analisis CV berbasis AI (DeepSeek), jejak audit lengkap untuk
setiap perpindahan tahap & catatan HR, dan halaman detail kandidat sebagai
"meja kerja HRD".

## Evidence

- Status lama (`new`, `interview_hrd`, `interview_manager`) tidak mencerminkan
  proses rekrutmen aktual; tidak ada action per tahap.
- Tabel `candidate_notes` / `candidate_activities` diharapkan kode FE tapi tak
  pernah ada di DB (error tertelan try/catch) — jejak hilang.
- Perpindahan stage via drag pipeline tidak meninggalkan jejak audit.
- CV hanya tersimpan sebagai file; tidak ada ekstraksi/penilaian kecocokan.

## Scope

Modul recruitment (pipeline, kandidat, portal karir) + konfigurasi integrasi
AI. Di luar scope: onboarding karyawan (HRIS), notifikasi email/WA otomatis
terjadwal, portal kandidat self-service status.

## Task Groups

### 1. Fondasi status & data — `done`
- [x] Migration `20260714090000_recruitment_pipeline_revamp.sql`: remap status
      (new→applied, interview_hrd/manager→interview), tambah psikotes & offer,
      check constraint baru, tabel `candidate_ai_analysis`, `app_settings`.
- [x] Update 16+ file referensi status lama; konstanta bersama di
      `src/lib/recruitment/status.ts`.
- [x] Migration `20260714150000`: tabel `candidate_notes` &
      `candidate_activities` (dengan `created_by_name` denormalisasi).

### 2. Analisis CV AI (DeepSeek) — `done`
- [x] Ekstraksi teks lokal `src/lib/recruitment/cv-extract.ts`
      (PDF=unpdf, DOCX=mammoth, gambar/PDF scan=tesseract.js OCR;
      `serverExternalPackages` wajib di next.config).
- [x] Client DeepSeek `src/lib/recruitment/deepseek.ts` (timeout 90s,
      response_format json_object).
- [x] Endpoint `POST/GET /api/candidates/[id]/ai-analysis` → ekstrak
      Nama/Email/No HP/Sumber/Pendidikan/Pengalaman + ringkasan + skor
      kecocokan vs job description; hasil di-cache di DB.
- [x] Halaman Settings → Integrasi (`/dashboard/settings/integrations`) untuk
      API key DeepSeek (masked, bisa ganti/hapus), model, base URL; tersimpan
      di `configuration.app_settings`; menu IAM `settings.integrations`.
- [x] Verifikasi end-to-end dengan token asli: ekstraksi + skor 90/100 utk CV
      barista vs posisi Barista, ~2.3s.

### 3. UI Pipeline (kanban) — `done`
- [x] Kanban 8 kolom + progress funnel bar + counter per stage.
- [x] Drawer detail (768px) dengan StageStepper klik-untuk-pindah, panel
      action Applied (preview CV, analisis AI, checklist 4 item, catatan).
- [x] Kartu kandidat menandai yang mandek (>7 hari kuning, >14 merah).

### 4. Catatan HR & jejak audit — `done`
- [x] Endpoint `GET/POST /api/candidates/[id]/notes` — append-only, penulis
      direkam dari session server-side.
- [x] Endpoint `POST /api/candidates/[id]/stage` — SATU-SATUNYA jalur
      perpindahan status (drag, drawer, detail) → selalu tercatat di
      `candidate_activities` ("Tahap diubah: X → Y" + nama HR).
- [x] Timeline tab Catatan / Aktivitas di detail kandidat.

### 5. Halaman detail kandidat (meja kerja HRD) — `done`
- [x] Header + stage bar eksekutabel + kontak chip (WA/email langsung).
- [x] Action panel per tahap: Applied penuh (reuse drawer), tahap lain kartu
      tugas generik + tombol keputusan, Hired → PromoteCandidateButton,
      Talent Pool/Tolak → kartu re-activate.
- [x] Rail kanan: Ringkasan AI (skor), Dokumen, Timeline tab.
- [x] Verifikasi visual via screenshot headless (playwright-core + Chrome).

### 6. Pendukung — `done`
- [x] Dropdown outlet = Business level Branch: `item.brands` jadi mirror
      otomatis `configuration.branches` (trigger + backfill, migration
      `20260714120000`); endpoint publik `/api/portal/options` utk portal anon.
- [x] Fix sistemik Select (Base UI): wrapper auto-derive `items` dari children
      supaya label terpilih tampil (regression test `select.test.tsx`).
- [x] Fix modal/drawer sempit (`sm:max-w-*` vs default variant Base UI).

### 7. Panel Screening — `done`

**Goal:** Panel action tahap Screening di detail kandidat & drawer pipeline.

**Evidence:** Task group 5 hanya memberi kartu tugas generik untuk Screening;
HRD butuh form hasil screening call terstruktur + keputusan berjejak.

**Scope:** Tabel `recruitment.candidate_screenings` (1 baris/kandidat),
endpoint GET/PUT, komponen `ScreeningActionPanel` (form kontak, minat &
ketersediaan, konfirmasi gaji, kesediaan shift/penempatan, catatan,
rekomendasi Lolos/Hold/Tidak Lolos), checklist otomatis, template WA
(undangan screening, lolos→psikotes, penolakan halus; nada formal-ramah),
tombol keputusan (Lolos→Psikotes hanya aktif jika rekomendasi terisi).

**Acceptance Criteria:**
- Form tersimpan & termuat ulang; setiap simpan tercatat di timeline
  Aktivitas dengan nama HR.
- Selisih gaji konfirmasi vs ekspektasi awal >20% diberi tanda visual.
- Tombol "Lolos → Psikotes" disabled sebelum rekomendasi terisi.
- Template WA membuka wa.me dengan placeholder nama/posisi terisi + tercatat
  di aktivitas.
- Panel tampil identik di detail kandidat dan drawer pipeline.

**Test Plan:** API round-trip (PUT→GET) via curl; validasi payload salah
ditolak 400; build hijau; smoke visual via screenshot headless.

**Agent Routing:** implementasi langsung (main session); review:
typescript-reviewer + security-reviewer utk endpoint baru.

**Done Signal:** AC terpenuhi + Automation Log terisi + status task `done`.

**Open question (default sementara):** field form memakai daftar di atas;
nada template WA formal-ramah — konfirmasi user bisa mengubah keduanya.

### 8a. Panel Psikotes — dipindah ke [EPIC-002](./EPIC-002-psikotes-online.md)

Rencana awal (panel jadwal + skor manual) direvisi 2026-07-15: user meminta
psikotes online penuh (6 instrumen dikerjakan kandidat via link token,
proctoring webcam, manajemen bank soal). Scope terlalu besar untuk satu task
group — diangkat jadi epic tersendiri **EPIC-002: Psikotes Online**.

### 8b. Panel Interview — `done` (scope revisi → EPIC-003)
- Integrasi tabel `interviews` + scorecard existing di panel action.

### 8c. Panel Offer — `done` (delegated → EPIC-004)
- Nominal penawaran, tanggal kirim, keputusan kandidat (terima/tolak).

## Acceptance Criteria (epic)

- Semua perpindahan tahap dari UI mana pun meninggalkan jejak beratribusi.
- Analisis AI berjalan dgn API key yang dikelola dari dashboard (bukan env).
- Panel action tersedia minimal untuk Applied & Screening; tahap lain punya
  kartu tugas + keputusan.
- Tidak ada regresi test suite (baseline: 205 pass, 1 fail pre-existing
  `formatCurrency` — di luar scope epic ini).

## Test Plan (epic)

- Unit: `select.test.tsx` (4 test) + suite existing.
- API: login → CRUD master data, notes, stage, ai-analysis, settings
  integrations (semua sudah diverifikasi via curl 2026-07-14).
- Visual: screenshot headless halaman detail (scratchpad `shot.mjs`).

## Automation Log

- 2026-07-25 · Audit penutupan task 8b & 8c. 8c (Panel Offer) TERPENUHI oleh
  EPIC-004: `OfferActionPanel` + `OfferSendDialog` dirender identik di detail
  kandidat & drawer pipeline — nominal (`base_salary`), tanggal kirim
  (`sent_at`) + mulai/kedaluwarsa, keputusan kandidat (accepted/negotiating/
  declined + responded_at/response_ip/response_source), offer berversi,
  referensi gaji, portal `/offer/[token]`. Status 8c → done.
- 2026-07-25 · Task 8b (Panel Interview) — scope DIREVISI: rencana "integrasi
  tabel `interviews` + scorecard existing" DIBATALKAN, digantikan interview AI
  asinkron (EPIC-003): `InterviewActionPanel` di kedua permukaan (sesi,
  kesimpulan AI, transkrip+rekaman, proctoring, template WA, gate Lolos→Offer
  min. 1 sesi selesai). Status 8b → done (scope revisi).
- 2026-07-25 · Dead code legacy DIHAPUS (temuan audit, prioritas keamanan
  ringan): `src/app/api/interviews/route.ts` (tanpa guard auth/zod, menulis
  `candidates.status` langsung — membypass `/api/candidates/[id]/stage` tanpa
  jejak audit) dan `src/components/scorecard-dialog.tsx` (tidak di-import di
  mana pun). Keputusan tersisa utk owner (bukan blocker): nasib tabel yatim
  `recruitment.interviews` (drop vs arsip) dan perlu-tidaknya task 8d
  "interview tatap muka + scorecard manual HRD". Semua task selesai → status
  epic ready-for-qa (QA manual mengikuti EPIC-003/004).

- 2026-07-16 · Laporan pipeline kandidat PDF (commit `d1103fc`): GET
  /api/candidates/[id]/report — profil, analisis AI CV, screening, psikotes
  (+insight AI gambar), interview AI, offer, data hired (NIP/onboarding),
  timeline; tersedia mulai tahap Offer dari halaman detail kandidat. Fix
  penyerta: redirect loop logout (cookie session tidak valid, commit
  `cd870d7`). Integrasi hilir: promote kandidat hired kini otomatis membuat
  draft kontrak (lihat EPIC-006 Fase D).
- 2026-07-14 · Semua task group 1–6 selesai & terverifikasi di dev
  (localhost:3459 / omnipos.suluinwounderland.com). Belum di-commit atas
  permintaan user — commit menyusul setelah fase development selesai.
- 2026-07-14 · Keputusan arsitektur: (a) perpindahan status wajib lewat
  `/api/candidates/[id]/stage`; (b) `item.brands` = mirror `configuration.
  branches`, jangan tulis manual ke brands; (c) API key AI di
  `configuration.app_settings`, bukan .env; (d) Base UI: pakai `render=`
  (bukan `asChild`), Tabs perlu `flex-col` eksplisit, override lebar
  Dialog/Sheet perlu variant persis (`sm:max-w-*` / `data-[side=right]:...`).
- 2026-07-14 · DeepSeek API key milik user tersimpan via Settings →
  Integrasi; disarankan rotate karena sempat lewat chat.
- 2026-07-15 · Task group 7 (Panel Screening) selesai & terverifikasi di dev.
  Migration `20260715090000_candidate_screenings.sql` (1 baris/kandidat,
  upsert). Endpoint `GET/PUT /api/candidates/[id]/screening` (zod
  `screeningSchema`, rate limit, upsert + jejak `screening_updated` dalam SATU
  transaksi `withTransaction`) dan `POST /api/candidates/[id]/activities`
  (whitelist template WA saja). Komponen `ScreeningActionPanel` dirender
  identik di detail kandidat & drawer pipeline (`key={candidate.id}` untuk
  reset draft antar kandidat). Verifikasi: PUT→GET round-trip, payload salah
  400, non-UUID 400, tanpa auth 401, body null 400, build hijau, tes 205 pass
  (1 fail pre-existing `formatCurrency`), smoke visual kedua permukaan.
- 2026-07-15 · Keputusan task 7: (a) state form = serverDraft + override
  (hindari `setState` dalam effect / lint `react-hooks/set-state-in-effect`);
  (b) nomor WA dinormalisasi 0→62 via helper `src/lib/recruitment/wa.ts`
  (pola reservation-page POS) — dipakai juga utk tombol WA header detail;
  (c) tombol "Lolos → Psikotes" digate rekomendasi TERSIMPAN (bukan draft).
- 2026-07-15 · Open items dari review (perlu keputusan produk, di luar scope
  task 7): (a) IDOR lintas-brand sistemik — SEMUA sub-resource kandidat
  (notes/stage/screening/activities) & daftar kandidat tidak scoping
  `brand_id` user; konsisten dgn perilaku produk saat ini (HR lihat semua
  brand) tapi perlu diputuskan bila multi-tenant per brand diinginkan;
  (b) gate rekomendasi screening hanya di panel — StageStepper/kanban drag
  masih bisa pindah screening→psikotes tanpa rekomendasi (enforcement
  server-side akan mengubah UX drag kanban, tunda ke keputusan produk).
