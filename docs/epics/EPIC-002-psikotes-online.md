# EPIC-002: Psikotes Online

status: ready-for-qa
environment: dev
retries: 0

## Goal

Platform psikotes online di dalam aplikasi: HRD mengirim undangan tes ke
kandidat (link token, tanpa login), kandidat mengerjakan 6 instrumen
(PAPI Kostick, Baum, DAP, Wartegg, Aritmatika, Matematika) langsung di
browser dengan proctoring (flag perilaku + snapshot webcam), sistem
auto-score yang bisa dinilai otomatis, tes proyektif masuk antrian review
manual HR, dan hasilnya tampil di panel Psikotes kandidat (pipeline &
detail) sebagai dasar keputusan Lolos → Interview.

Menggantikan rencana lama EPIC-001 task 8a (panel jadwal + skor manual).

## Evidence

- EPIC-001 task 5 hanya memberi kartu tugas generik untuk tahap Psikotes.
- User meminta psikotes dikerjakan online di aplikasi (referensi screenshot
  WIT-OS 2026-07-15): checklist undangan/hasil/proctoring/catatan, kartu
  hasil per instrumen dengan status Selesai / Perlu review manual,
  "Kirim / jadwalkan tes", dan detail per tes.
- Keputusan scope user (2026-07-15): semua 6 instrumen; menu Psikotes
  tersendiri + manajemen per instrumen; UI kelola bank soal; proctoring
  flag + snapshot webcam; akses kandidat via link token tanpa login.

## Scope

Modul recruitment. Termasuk: schema sesi/instrumen/soal/hasil/proctoring,
menu dashboard Psikotes (manajemen instrumen & bank soal), portal tes
publik token-based, panel hasil di kandidat, review manual proyektif,
arsip proctoring. Di luar scope: norma psikometri resmi/interpretasi
otomatis tes proyektif, integrasi vendor asesmen eksternal, anti-cheat
berbasis AI, mobile app.

Catatan hak cipta: konten soal PAPI Kostick proprietary — sistem
menyediakan engine forced-choice + scoring 20 skala, konten soal diinput
sendiri oleh user via UI kelola soal (tidak di-seed).

## Task Groups

### 1. Fondasi data & sesi tes — `done`

**Goal:** Schema lengkap + IAM menu, tanpa UI.

**Scope:** Migration `2026xxxxxx_psikotes_online.sql`:
- `recruitment.psikotes_instruments` — katalog (code unik:
  `papi_kostick`/`baum`/`dap`/`wartegg`/`aritmatika`/`matematika`,
  nama, `kind` CHECK `mcq`/`forced_choice`/`drawing`, `config` jsonb:
  durasi detik, jumlah soal, acak, instruksi kandidat, aktif). Seed 6
  baris (soal PAPI kosong — lihat catatan hak cipta).
- `recruitment.psikotes_questions` — bank soal (instrument_id FK,
  `body` text, `options` jsonb, `answer_key` jsonb (MCQ) / pasangan
  pernyataan + mapping skala (PAPI), `sort_order`, `is_active`).
- `recruitment.psikotes_sessions` — 1 undangan tes (candidate_id FK,
  `token` unik ≥32 byte, `status` CHECK `draft`/`sent`/`in_progress`/
  `completed`/`expired`, `instrument_ids` uuid[], `invited_at`,
  `expires_at`, `started_at`, `completed_at`, `webcam_consent` boolean,
  created_by + created_by_name denormalisasi).
- `recruitment.psikotes_session_tests` — hasil per instrumen per sesi
  (session_id FK, instrument_id FK, `status` CHECK `pending`/
  `in_progress`/`selesai`/`perlu_review`/`reviewed`, `answers` jsonb,
  `score` numeric, `score_detail` jsonb (mis. skala PAPI / benar-salah),
  `attachment_path` (gambar proyektif), `review_notes`, reviewed_by +
  reviewed_by_name, started_at, completed_at).
- `recruitment.psikotes_proctor_events` — (session_id FK, `event_type`
  CHECK `tab_blur`/`fullscreen_exit`/`paste`/`disconnect`/
  `webcam_snapshot`, `meta` jsonb, `storage_path`, created_at). Index
  per session.
- Menu IAM `recruitment.psikotes` (menu tersendiri di sidebar).

**AC:** migration idempotent jalan di dev; constraint ditolak utk enum
salah; seed 6 instrumen ada. **Test:** psql apply + query smoke.

### 2. Menu Psikotes: manajemen instrumen & bank soal — `done`

**Goal:** Halaman dashboard `/dashboard/recruitment/psikotes` (gated menu
IAM) untuk adjustment tiap instrumen.

**Scope:**
- Daftar 6 instrumen + edit config (durasi, jumlah soal ditarik, acak,
  instruksi, aktif/nonaktif).
- CRUD soal MCQ (Aritmatika/Matematika): body, 4-5 opsi, kunci jawaban,
  aktif. CRUD pasangan pernyataan PAPI + mapping skala. Editor instruksi
  utk tes gambar (Baum/DAP/Wartegg).
- Endpoint `GET/POST/PUT/DELETE /api/psikotes/instruments|questions`
  (requireApiRole super_admin/admin/hrd, zod, rate limit).

**AC:** soal tersimpan & termuat; soal nonaktif tak pernah tampil ke
kandidat; role selain whitelist 403. **Test:** curl CRUD round-trip +
payload salah 400; build hijau.

### 3. Portal tes kandidat (public, token) — `done`

**Goal:** Kandidat mengerjakan seluruh battery dari 1 link tanpa login.

**Scope:**
- Route publik `/psikotes/[token]`: landing (identitas kandidat, daftar
  tes, consent kamera) → runner per instrumen → selesai.
- Runner MCQ: timer per instrumen, autosave jawaban berkala, submit →
  auto-score. Runner PAPI: forced-choice A/B, auto-score 20 skala,
  tampilkan skala dominan (mis. "A — Dorongan Berprestasi"). Runner
  drawing: instruksi + upload foto/gambar (kamera/file → `lib/storage`,
  private) → status `perlu_review`.
- Proctoring client: minta fullscreen, flag `tab_blur`/`fullscreen_exit`/
  `paste`/`disconnect`; snapshot webcam berkala (interval dari config,
  hanya jika consent; tanpa consent tercatat sebagai flag) → storage
  private.
- Endpoint publik rate-limited (pola `/api/portal/*`):
  `GET /api/psikotes/session/[token]`, `POST .../start`,
  `PUT .../answers`, `POST .../proctor-event`, `POST .../finish`.
  Token expired/terpakai → halaman "link tidak berlaku". Jawaban & kunci
  tidak pernah bocor ke client (scoring server-side).

**AC:** battery selesai end-to-end di browser headless; MCQ terskor
otomatis benar; gambar tersimpan private; flag & snapshot terekam;
token kadaluarsa ditolak. **Test:** curl alur token + smoke visual
headless; unit scoring MCQ & PAPI (tabel kasus).

### 4. Panel Psikotes HRD (pipeline & detail kandidat) — `done`

**Goal:** Panel action tahap Psikotes seperti screenshot referensi,
render identik di detail kandidat & drawer pipeline (pola
`ScreeningActionPanel`).

**Scope:**
- Checklist otomatis: Undangan tes dikirim (n undangan) → Tes selesai &
  hasil tersedia (x/y) → Arsip bukti proctoring (flag & snapshot) →
  Catatan internal HR.
- Dialog "Kirim / jadwalkan tes": pilih instrumen (default semua aktif),
  masa berlaku; generate sesi + token; kirim via template WA
  `undangan_psikotes` (whitelist activities) + opsional email Resend.
- Kartu hasil per instrumen: skor/status (Selesai / Perlu review manual /
  Reviewed) + "Lihat detail" → dialog jawaban & skor per aspek; untuk
  proyektif: preview gambar + form review manual (kesimpulan + tandai
  reviewed, reviewer terekam).
- Rekomendasi keseluruhan psikotes (lolos/hold/tidak_lolos, upsert —
  pola task 7) + tombol keputusan via `/api/candidates/[id]/stage`:
  "Lolos → Interview" digate rekomendasi TERSIMPAN; Talent Pool; Tolak.
- Semua aksi (kirim undangan, review manual, rekomendasi) tercatat di
  `candidate_activities` dengan nama HR.

**AC:** sesuai checklist screenshot; keputusan digate rekomendasi;
semua aksi beratribusi di timeline. **Test:** curl endpoint baru,
smoke visual kedua permukaan, suite existing tetap hijau.

### 5. Arsip proctoring & polesan — `done`

**Goal:** Bukti proctoring bisa diaudit.

**Scope:** Tab/dialog arsip per sesi: daftar flag berkelompok + galeri
snapshot (signed URL dari storage private), badge jumlah flag di kartu
hasil; kebijakan retensi sederhana (hapus snapshot saat kandidat
dihapus — CASCADE + cleanup storage).

**AC:** snapshot hanya bisa diakses role berwenang; flag count akurat.
**Test:** akses tanpa auth 401; smoke visual.

## Acceptance Criteria (epic)

- Kandidat menyelesaikan 6 instrumen dari 1 link token tanpa login;
  MCQ & PAPI terskor otomatis, proyektif masuk antrian review manual.
- HRD mengelola instrumen & bank soal dari menu Psikotes tersendiri.
- Proctoring merekam flag perilaku + snapshot webcam (dengan consent).
- Panel Psikotes menampilkan checklist + hasil per instrumen dan
  keputusan Lolos → Interview digate rekomendasi tersimpan.
- Semua aksi HR & perpindahan tahap beratribusi di timeline aktivitas.
- Kunci jawaban tidak pernah terkirim ke client; semua endpoint publik
  rate-limited; storage proctoring/gambar private.
- Tidak ada regresi suite existing (baseline 205 pass, 1 fail
  pre-existing `formatCurrency`).

## Test Plan (epic)

- Unit: scoring MCQ & PAPI (table-driven), token expiry.
- API: alur penuh via curl (buat sesi → kandidat mengerjakan → hasil →
  review → rekomendasi → stage), negative case (401/400/403/expired).
- Visual: screenshot headless portal tes + panel HRD kedua permukaan.

## Agent Routing

Implementasi langsung (main session) per task group = 1 PR. Review:
typescript-reviewer + security-reviewer wajib utk endpoint publik token
& storage proctoring; database-reviewer utk migration TG1.

## Done Signal

Semua task group `done` + AC epic terpenuhi + Automation Log terisi.

## Open Questions (default sementara)

- Interval snapshot webcam default 60 detik, kualitas rendah (hemat
  storage) — bisa diubah di config instrumen/global.
- Ambang tampilan skor MCQ mengikuti EPIC-001 8a (≥70 hijau, 50–69
  kuning, <50 merah) — visual saja.
- Email undangan via Resend opsional (WA tetap jalur utama).
- Interpretasi PAPI ditampilkan sebagai skala dominan + tabel 20 skala;
  narasi interpretasi ditulis HR (tidak digenerate otomatis di v1).

## Automation Log

- 2026-07-15 · Epic dibuat dari revisi scope EPIC-001 task 8a: user
  meminta psikotes online penuh (referensi screenshot WIT-OS). Keputusan
  scope: 6 instrumen, menu + manajemen bank soal, proctoring
  flag + webcam snapshot, akses link token tanpa login.
- 2026-07-15 · TG1 selesai. Migration `20260715120000_psikotes_online.sql`
  diterapkan & diverifikasi di dev: 5 tabel (`psikotes_instruments` seed 6,
  `psikotes_questions`, `psikotes_sessions`, `psikotes_session_tests`
  UNIQUE (session,instrument), `psikotes_proctor_events`), trigger
  `update_updated_at_column` per tabel, CHECK enum & skor 0–100 ditolak
  saat dilanggar, CASCADE session→tests OK, re-run file idempotent (seed
  tetap 6). Menu `hris.recruitment.psikotes` (order 25, level 3, parent
  `hris.recruitment`) + grant super_admin/admin (full) & hrd/
  hiring_manager (per permission_context) langsung di migration.
- 2026-07-15 · Keputusan TG1: (a) battery sesi dinormalisasi sebagai baris
  `psikotes_session_tests` saat sesi dibuat — TIDAK pakai kolom array
  `instrument_ids` (revisi kecil dari plan); (b) `answer_key` hanya boleh
  di-select server-side, endpoint publik TG3 dilarang menyentuh kolom ini;
  (c) seed instrumen `ON CONFLICT DO NOTHING` supaya adjustment user via
  UI TG2 tidak tertimpa migration re-run; (d) hygiene: seeder
  `iam-menus.sql` ditambah `settings.integrations` + `hris.recruitment.
  psikotes` (VALUES + prune list) — sebelumnya `settings.integrations`
  hanya ada di DB dev dan akan terhapus bila seeder dijalankan ulang.
- 2026-07-15 · TG2 diimplementasikan & diverifikasi di dev
  (localhost:3459, pm2 restart setelah build):
  - Konstanta bersama `src/lib/recruitment/psikotes.ts` (20 skala PAPI +
    label ID, label/badge kind, ambang badge skor 70/50).
  - Zod `src/lib/validations/psikotes.ts`: config instrumen
    (durasi 30s–4j, soal 1–200), soal MCQ (2–6 opsi unik a–f, kunci harus
    salah satu opsi), pasangan PAPI (A/B + skala enum 20 huruf).
  - Endpoint: GET `/api/psikotes/instruments` (read: +hiring_manager),
    PUT `/api/psikotes/instruments/[id]` (nama/aktif/config; code & kind
    immutable; config di-merge `||` supaya key lain tidak hilang),
    GET/POST `.../[id]/questions` (POST ditolak 400 utk kind drawing),
    PUT/DELETE `/api/psikotes/questions/[id]` (DELETE = hard delete;
    nonaktif via PUT utk sekadar mengecualikan dari undian).
    Write roles: super_admin/admin/hrd; rate limit; zod; UUID guard.
  - UI `/dashboard/hris/psikotes` (feature `src/features/hris/psikotes/`,
    pola react-query spt talent-pool): kartu per instrumen (badge kind,
    toggle aktif, durasi, jumlah soal, warning bank kosong), dialog
    Pengaturan (nama, durasi menit, soal ditarik, acak, instruksi),
    dialog Bank Soal (list + aktif/nonaktif + hapus dgn ConfirmDialog),
    form soal MCQ (radio kunci) & PAPI (pernyataan A/B + Select skala).
  - Verifikasi: curl login → GET 6 instrumen; PUT config valid + merge OK;
    durasi 10s → 400; POST MCQ valid 201; kunci di luar opsi → 400; POST
    ke instrumen gambar → 400; POST PAPI valid 201; skala "Q" → 400; PUT
    nonaktif OK; GET round-trip memuat kunci (admin only); DELETE 200 lalu
    404; tanpa auth 401; 403 utk role non-whitelist via guard bersama
    `requireApiRole` (tidak ada user non-HR aktif di dev utk tes live).
    Build hijau; eslint & tsc bersih utk file baru; suite 205 pass
    (1 fail pre-existing `formatCurrency`); smoke visual screenshot
    headless: menu sidebar tampil, 6 kartu render benar.
- 2026-07-15 · TG2 gate review (typescript-reviewer + security-reviewer):
  0 CRITICAL/HIGH. Diperbaiki & diverifikasi live: (a) rate limit di-key
  ke `user.id` — sebelumnya `X-Forwarded-For` yang bisa dipalsukan client
  (berlaku juga utk endpoint TG3 nanti: JANGAN percaya XFF); (b) GET
  list/questions kini ikut rate-limited + 404 utk instrumen tak ada;
  (c) `permission_context` menu psikotes diturunkan ke `["read"]`
  mengikuti pola menu rekrutmen lain — write ditegakkan di route
  (WRITE_ROLES), grant hrd/hiring_manager di dev di-update live;
  (d) `papiQuestionSchema` refine skala A ≠ B (server + client);
  (e) `McqOptionKey` union bersama utk key opsi & kunci jawaban;
  (f) updater state murni di `removeLastOption`; Switch toggle disabled
  saat pending; error state punya tombol Coba Lagi.
  Diterima tanpa perbaikan (LOW kosmetik): dialog di-mount kondisional
  (pola `key={id}` utk reset draft) membuat animasi exit Base UI tidak
  sempat jalan — trade-off sadar, konsisten dgn kebutuhan reset state.
- 2026-07-15 · TG3 diimplementasikan & diverifikasi end-to-end di dev:
  - Scoring server-side `src/lib/recruitment/psikotes-scoring.ts` (TDD,
    11 unit test table-driven): MCQ 0–100 + snapshot per soal di
    score_detail; PAPI hitung 20 skala + skala dominan (score = null).
  - Helper sesi `psikotes-session.ts`: token regex 48–128 hex sebelum DB,
    auto-expire, sanitizer (MCQ tanpa answer_key, PAPI tanpa kode skala),
    rate limit key = session id (anonim, XFF tidak dipercaya).
  - Storage PRIVATE baru `src/lib/storage-private.ts` →
    `storage/private/psikotes/...` karena /api/files (storage/uploads)
    PUBLIK tanpa auth. Disajikan ke HR via `GET /api/psikotes/files/[...]`
    (role-gated + guard path traversal). CATATAN pre-existing di luar
    scope: /api/files publik perlu ditinjau tersendiri.
  - 7 endpoint publik `/api/psikotes/session/[token]/...`: GET ringkasan,
    start (consent kamera), start per-tes (undian soal SEKALI —
    snapshot question_ids utk resume; shuffle & question_count dari
    config), answers (autosave, hanya soal yang diundikan, deadline
    server-side + grace 30s), finish per-tes (scoring / perlu_review utk
    gambar, wajib upload dulu), upload gambar (jpeg/png/webp ≤8MB),
    proctor-event (flag + snapshot base64 ≤700KB, hanya jika consent),
    finish sesi (semua tes terminal → completed + jejak
    'psikotes_completed' atribusi "Sistem" dalam satu transaksi).
  - Middleware: `/psikotes` & `/api/psikotes/session` masuk publicRoutes;
    admin (instruments/questions/files) tetap ber-auth.
  - Portal UI `src/app/(public)/psikotes/[token]` + feature
    `src/features/psikotes-portal/`: landing + consent + tata tertib,
    daftar tes dgn resume, runner MCQ (timer, autosave per pilihan,
    auto-submit waktu habis, navigasi nomor), runner PAPI (satu pasangan
    per layar, progress, gate selesai semua terjawab), runner gambar
    (upload kamera/file + preview), auto-finish sesi, halaman
    expired/invalid/terima-kasih. Proctoring client: visibilitychange/
    fullscreen/paste/offline→online + snapshot webcam 60s (fire-and-
    forget, gagal proctoring tidak mengganggu tes).
  - Verifikasi: curl alur penuh (sent→in_progress→selesai per tes→
    completed), skor MCQ 67 utk 2/3 benar, PAPI dominan G+A sesuai
    jawaban, kunci/skala TIDAK bocor di response (dicek programatik),
    expired 410, token salah 404, jawab setelah selesai 409, finish
    gambar tanpa upload 400, upload .txt 400, snapshot tersimpan di
    storage/private, /api/files tidak bisa akses (404), /api/psikotes/
    files 401 tanpa auth / 200 admin / traversal 404, aktivitas timeline
    tercatat. Suite 216 pass (baseline+11). E2E headless: klik penuh
    landing→mulai sesi→runner MCQ→selesai (screenshot 3 layar).
- 2026-07-15 · TG3 gate review (security + typescript): 0 CRITICAL,
  5 HIGH diperbaiki & diverifikasi live:
  (a) DoS body besar — cek Content-Length SEBELUM req.json()/formData()
      di semua endpoint publik (413; verifikasi body 2MB → 413);
  (b) `meta` proctor-event dibatasi ≤20 key, key ≤50 char (21 key → 400);
  (c) disk-fill: limit per-bucket ketat (upload 6/mnt, proctor 12/mnt —
      `checkRateLimit` kini menerima param limit), kuota 300 snapshot/
      sesi, file attachment lama di-unlink saat re-upload (verifikasi:
      1 file di disk setelah re-upload; 429 setelah kuota menit);
  (d) race autosave-vs-finish — semua transisi status pakai conditional
      UPDATE (`WHERE status='in_progress'/'pending'`): autosave setelah
      selesai 409, undian soal tidak bisa ganda (TOCTOU), finish ganda
      idempoten, aktivitas 'psikotes_completed' hanya ditulis pemenang
      transisi; opsi jawaban di-disable saat finishing/timeUp + timer
      maju anti double-tap (ref + clearTimeout);
  (e) dead-end auto-finish sesi — kegagalan kini menampilkan banner
      "Coba Lagi" (retry manual), bukan diam selamanya.
  MEDIUM diperbaiki: magic-byte sniffing (byte palsu ngaku png → 400,
  ekstensi dari hasil sniff bukan klaim client), nosniff header di
  /api/psikotes/files, fallback umur sesi 14 hari bila expires_at NULL,
  deadline tes gambar ditegakkan server-side (upload ditolak setelah
  habis; finish tanpa lampiran diizinkan setelah deadline supaya sesi
  tidak menggantung), tipe `never` diganti narrowing eksplisit
  (QuestionScoringRow + type guard), keepalive di finish calls.
  Diterima sbg catatan (LOW): status-code oracle utk token valid
  (mitigasi: token 256-bit); reclamation job utk sesi in_progress yang
  ditinggal → follow-up TG4/TG5 (HR bisa lihat & tutup manual).
  Regresi pasca-fix: build hijau, tsc/eslint bersih, suite 216 pass,
  alur curl normal tetap jalan (skor 33 utk 1/3 benar), E2E headless OK.
- 2026-07-15 · TG4 diimplementasikan & diverifikasi di dev:
  - Migration `20260715180000_candidate_psikotes_summary.sql` —
    rekomendasi keseluruhan (1 baris/kandidat, pola task 7).
  - Endpoint: GET `/api/candidates/[id]/psikotes` (summary + semua sesi +
    hasil per tes + rekap proctoring; token ikut utk salin link/WA),
    POST `.../psikotes/sessions` (buat undangan: token 256-bit + baris tes
    + jejak 'psikotes_invited' dalam satu tx; limit 20/mnt/user),
    PUT `.../psikotes/summary` (upsert + jejak, tx), PUT
    `/api/psikotes/session-tests/[id]/review` (review manual proyektif →
    reviewed + reviewer + jejak, tx). Whitelist WA + `undangan_psikotes`
    & `lolos_interview`.
  - UI `PsikotesActionPanel` (pipeline feature, pola screening panel):
    checklist 4 langkah (undangan/hasil/proctoring/rekomendasi), dialog
    Kirim/Jadwalkan Tes (pilih instrumen aktif + masa berlaku → link +
    salin + WA), kartu hasil per sesi/instrumen (skor MCQ berwarna,
    skala dominan PAPI, review notes), dialog detail (rincian per soal /
    tabel 20 skala / preview gambar + form review manual), rekomendasi
    (gate "Lolos → Interview"), template WA, keputusan via /stage.
    Dirender identik di detail kandidat & drawer pipeline
    (`key={candidate.id}`); kartu generik psikotes lama diganti.
  - Verifikasi: curl (pindah stage, GET panel, buat sesi, summary,
    review, payload kosong 400), smoke visual detail kandidat — layout
    sepadan screenshot referensi WIT-OS.
  - Email undangan via Resend DITUNDA (scope "opsional") — WA + salin
    link sudah memenuhi alur utama; catat sbg follow-up bila diminta.
- 2026-07-15 · TG5 diimplementasikan & diverifikasi di dev:
  - GET `/api/psikotes/sessions/[id]/proctor-events` (role-gated, limit
    1000) + `PsikotesProctorDialog`: rekap flag berkelompok (pindah tab /
    keluar fullscreen / paste / disconnect + durasi offline), timeline
    ber-jam, galeri snapshot webcam (via /api/psikotes/files ber-auth),
    keterangan consent. Badge "n flag · n snapshot" di baris sesi jadi
    tombol pembuka arsip.
  - Retensi: DELETE kandidat kini menghapus folder
    `storage/private/psikotes/<sessionId>` (deletePrivateFolder dgn guard
    containment; baris DB via CASCADE). Diverifikasi dgn kandidat sekali
    pakai: file dibuat → DELETE → folder hilang, baris sesi 0.
  - Verifikasi: endpoint 401 tanpa auth / 404 sesi fiktif / data benar;
    smoke visual dialog arsip. Suite tetap 216 pass.
- 2026-07-15 · TG4+TG5 gate review (security + typescript): 0 CRITICAL.
  Diperbaiki & diverifikasi live:
  (a) HIGH — DELETE /api/candidates/[id] TANPA AUTH (bug pre-existing;
      purge bukti psikotes memperbesar dampak) → kini requireApiRole
      super_admin/admin/hrd + log server beratribusi sebelum purge
      (tanpa auth → 401 ✓). CATATAN: route kandidat lain (PUT dsb.) masih
      pola lama tanpa role check — di luar scope, perlu audit tersendiri;
  (b) MED — token sesi = kredensial pengerjaan tes: GET panel kini
      mengembalikan token hanya utk super_admin/admin/hrd (null utk
      hiring_manager; tombol salin link ikut disembunyikan);
  (c) MED — rate limit /activities di-key ke user.id (regresi pola XFF);
  (d) HIGH — PsikotesSendDialog di-mount kondisional (state segar tiap
      buka; undangan kedua tidak terjebak layar hasil undangan pertama);
  (e) HIGH — PsikotesSessionTest jadi discriminated union pada
      instrument_kind (McqScoreDetail | PapiScoreDetail | null), cast
      `as [PapiScaleCode,...]` dihapus;
  (f) MED — useSavePsikotesSummary menulis cache sinkron (setQueryData)
      supaya gate "Lolos → Interview" tidak flicker; LOW — query
      instrumen di dialog kirim di-gate `enabled: open`.
  Regresi: build hijau, tsc/eslint bersih, suite 216 pass, panel GET +
  bank soal + alur kandidat tetap jalan.
- 2026-07-15 · Bank soal Matematika diisi 20 soal psikotes penalaran
  numerik (via API admin, atas permintaan user): 6 deret angka,
  4 persentase/diskon/laba, 4 pecahan-desimal-akar, 1 aljabar,
  2 perbandingan/rata-rata, 3 soal cerita (kerja-waktu, kecepatan,
  kalender). Kunci diverifikasi end-to-end: sesi matematika-only,
  10 soal diundi acak, dijawab sesuai kunci → skor 100.
- 2026-07-15 · SEMUA task group selesai → status epic `ready-for-qa`.
  Belum di-commit (mengikuti keputusan user di EPIC-001: commit setelah
  fase development selesai). Follow-up di luar scope: audit auth route
  kandidat lama; email undangan via Resend; reclamation job sesi
  in_progress terbengkalai.
- 2026-07-15 · Follow-up (permintaan user): Insight AI DeepSeek utk tes
  gambar Baum/DAP/Wartegg — indikatif utk HRD/super admin, BUKAN
  keputusan final. Keputusan desain: API DeepSeek text-only (input
  gambar ditolak, diverifikasi 2026-07-15) → alur "HRD tulis observasi
  gambar → AI susun insight per kerangka instrumen". Komponen:
  migrasi `ai_insight jsonb` di psikotes_session_tests (cache, bisa
  digenerate ulang); lib `psikotes-ai.ts` (prompt per instrumen, output
  JSON {ringkasan, indikasi[], perhatikan_saat_interview[],
  keterbatasan}); POST /api/psikotes/session-tests/[id]/ai-insight
  (role super_admin/admin/hrd/hiring_manager, hanya kind=drawing +
  status perlu_review/reviewed, rate limit 10/menit per user, observasi
  20–4000 char); UI di PsikotesTestDetailDialog: textarea observasi +
  tombol "Minta Insight AI"/"Generate Ulang", render insight + meta
  (model, peminta, waktu) + disclaimer indikatif di atas form review
  manual (review manual tetap satu-satunya jalur keputusan).
  Regresi: tsc bersih utk file terdampak, eslint bersih, migrasi
  sudah diterapkan (db:migrate: semua sudah applied).
- 2026-07-15 · Insight AI jadi SEKALI KLIK (permintaan user): observasi
  kini opsional — bila dikosongkan, gambar dibaca OpenAI vision
  (gpt-4o-mini, key di Settings → Integrasi) menjadi deskripsi objektif
  (prompt: deskripsi saja, dilarang menafsirkan), lalu deskripsi itu
  diinsight-kan DeepSeek spt biasa. ai_insight kini menyimpan
  observation_source ("ai"|"manual") + vision_model. Settings
  integrations di-refactor jadi multi-provider (PUT: field flat =
  DeepSeek utk kompat lama, objek `openai` utk OpenAI; UI jadi
  ProviderCard reusable). UI dialog: tombol "Analisa Gambar oleh AI"
  (kosong) / "Analisa Observasi oleh AI" (terisi), observasi hasil
  vision diisikan balik ke textarea agar bisa diedit lalu dianalisa
  ulang. Verifikasi e2e di server 3459: Wartegg Indra tanpa observasi →
  vision mendeskripsikan gambar dgn jujur (foto ruangan, bukan gambar
  tes — tidak mengarang) → insight DeepSeek tersimpan. tsc/eslint
  bersih, build hijau. CATATAN: dev server = PM2 `arkiv-pos-saas`
  (next start -p 3459, perlu rebuild+restart utk lihat perubahan);
  instance lain di port 3004 memakai kredensial DB lama (user `arkiv`),
  bukan bagian repo ini.
