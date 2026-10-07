# EPIC-029: Analitik & Ringkasan Percakapan

status: ready-for-qa
environment: dev
retries: 0

## Goal

Membuat isi inbox CRM (WhatsApp + Instagram) **bisa dibaca sebagai angka**. Tiap
percakapan diringkas AI menjadi satu paragraf + label topik + sentimen + penanda
komplain + kata kunci; hasilnya diagregasi jadi laporan periodik "apa yang paling
sering ditanyakan/dikeluhkan pelanggan", lengkap dengan export XLSX supaya bisa
dibuka Excel atau di-import ke Google Sheet.

Sebelum ini, kategori komplain (EPIC-012 Fase D) diisi manual oleh agent. Modul ini
menambah lapisan yang membaca isi chat apa adanya, jadi tren muncul tanpa agent
harus mengetik kategori.

## Konteks Repo (hasil scoping 2026-07-25)

Modul ini sebagian besar **merangkai** yang sudah ada:

- **Sumber data**: `crm.wa_conversations` + `crm.wa_messages` (EPIC-012 Fase A/B).
  Kolom `direction` sudah dibatasi CHECK ke `'in'|'out'` — persis union yang dipakai
  lib bersama, jadi pemetaannya lurus (tetap dinormalisasi eksplisit, lihat Keputusan #4).
- **Guard**: `requireCrmInboxAgent()` (`@/lib/crm/server`) untuk apa pun yang memuat
  isi chat; `requireCrmReportRole()` + `resolveReportPeriod()` (`@/lib/crm/reports`)
  untuk laporan agregat. Keduanya dipakai apa adanya, tanpa role baru.
- **Pola OpenAI**: `resolveOpenAiCall()` di `src/app/api/ai/assistant/route.ts` —
  `getSettings([OPENAI_API_KEY, OPENAI_BASE_URL])` dengan fallback env, `POST
  {baseUrl}/chat/completions`. Model lewat `resolveAiAssistantModel` /
  `stripOpenAiPrefix` / `modelSupportsTemperature` (`@/lib/ai-assistant-config`).
- **XLSX**: paket `xlsx` sudah terpasang (dipakai `src/lib/attachments/extract.ts`),
  diimpor dinamis mengikuti pola yang sama.
- **Laporan CS existing**: `api/crm/reports/cs/route.ts` + `cs-report-section.tsx` —
  laporan baru mengikuti bentuk, guard, dan aturan bebas-PII yang sama.
- **Greenfield sesungguhnya**: cache insight per percakapan + invalidasi lewat sidik
  jari transkrip, dan agregasi kata kunci lintas percakapan.

## Keputusan

1. **Lib bersama `src/lib/conversation-analytics/` BEBAS dependensi aplikasi.**
   Folder itu tidak mengimpor `next`, `pg`, maupun `@/lib/*` — ia dipakai dua produk
   (repo ini dan repo `wagateway`), jadi pemindahannya cukup salin folder. Semua
   sentuhan DB/HTTP/auth tinggal di lapisan pemanggil. EPIC ini **hanya memakai**
   lib itu (`buildAnalysisMessages`, `parseInsight`, `fingerprintTranscript`,
   `aggregateKeywords`, `topicDistribution`, `sentimentBreakdown`) dan tidak
   mengubah satu barisnya.
2. **Cache berbasis fingerprint untuk menekan biaya token.** Tiap insight menyimpan
   `fingerprint` transkrip (FNV-1a + jumlah pesan). Bila sidik jarinya sama, OpenAI
   **tidak dipanggil** — laporan boleh dibuka berapa kali pun tanpa menagih ulang.
   Analisa ulang hanya terjadi bila ada pesan baru / pesan berubah, atau agent
   menekan "Ringkas ulang" (`force: true`).
3. **Laporan agregat bebas PII.** Endpoint laporan tidak pernah mengambil `summary`,
   `phone`, nama customer, maupun id percakapan — hanya topic, sentiment,
   is_complaint, keywords. Ringkasan per percakapan (berpotensi ber-PII) hanya keluar
   lewat endpoint inbox di balik `requireCrmInboxAgent`. Prompt lib bersama juga
   sudah melarang model memasukkan nama/nomor/alamat ke keywords & topic.
4. **`direction` tetap dinormalisasi eksplisit** walau kolom DB sudah `'in'|'out'`:
   repo `wagateway` memakai istilah inbound/outbound, dan nilai tak dikenal
   di-default ke `out` — salah menandai pesan agen sebagai suara pelanggan akan
   membalik sentimen seluruh laporan.
5. **Hanya `message_type='chat'` yang dianalisa.** `otp` memang selalu ber-body NULL
   (aturan privasi EPIC-012), sedangkan `system`/`notification`/`broadcast` adalah
   teks yang KAMI kirim otomatis (auto-reply di luar jam kerja, permintaan CSAT,
   blast). Memasukkannya membuat model meringkas kalimat robot kami sendiri.
6. **Analisa dipicu manual, tidak otomatis.** Membuka inbox atau laporan tidak
   memanggil OpenAI; hanya tombol "Analisa percakapan baru" (batch, dibatasi default
   25 / maksimal 100) dan "Ringkas dengan AI" (satu percakapan) yang memanggil.
   Batch jalan berurutan, bukan paralel, agar tidak menabrak rate limit.
7. **Kegagalan analisa tidak menular.** Error OpenAI/parse dikembalikan sebagai
   `status: "failed"` beserta pesannya, tidak dilempar ke atas, supaya satu
   percakapan bermasalah tidak membatalkan seluruh batch. Cache lama tetap dibawa.

## Skema Baru

```
crm.wa_conversation_insights                   -- CACHE, bukan sumber kebenaran
  conversation_id uuid PK REFERENCES crm.wa_conversations(id) ON DELETE CASCADE
  summary text                                 -- berpotensi PII: jangan ke laporan
  topic text
  sentiment text CHECK (positif|netral|negatif)
  is_complaint boolean NOT NULL DEFAULT false
  keywords jsonb NOT NULL DEFAULT '[]'
  fingerprint text NOT NULL                    -- kunci invalidasi cache
  model text                                   -- pembanding mutu antar model
  analyzed_at timestamptz NOT NULL DEFAULT now()

index: analyzed_at DESC · topic · (is_complaint) WHERE is_complaint
```

Migrasi: `database/migrations/deltas/20260725170000_conversation_insights.sql`.

## Scope / Fase

**A — Skema (SELESAI)**
Migrasi + index laporan, applied di dev.

**B — Server module (SELESAI)**
- `src/lib/crm/conversation-insights.ts` — logika MURNI (tanpa DB/HTTP/React):
  `normalizeDirection`, `toTranscriptMessages`, `needsAnalysis`, `clampPendingLimit`,
  `summarizeBatch`, `buildInsightReport`, `buildReportSheets`, `reportFileName`.
- `src/lib/crm/conversation-insights-server.ts` — `fetchTranscript` (maks 300 pesan,
  urut waktu, hanya `chat`), `getStoredInsight`, `analyzeConversation` (cache-first),
  `analyzePending`, `getConversationInsightReport`.

**C — API (SELESAI)**
- `POST /api/crm/inbox/analytics` — guard inbox agent; body `{conversation_id, force?}`
  atau `{analyze_pending:true, limit?}`. Gagal analisa → HTTP 502 (bukan 500), supaya
  UI bisa membedakannya dari bug/izin.
- `GET /api/crm/inbox/analytics?conversation_id=` — baca cache, TIDAK memanggil OpenAI.
- `GET /api/crm/reports/conversations?from&to&format=json|xlsx` — guard report role +
  `resolveReportPeriod`; `xlsx` mengembalikan file 3 sheet dengan
  `Content-Disposition: attachment`.

**D — UI (SELESAI)**
- `conversation-insight-section.tsx` di halaman Laporan CRM: 4 kartu ringkasan,
  tabel Top Kata Kunci (keyword + jumlah percakapan + kemunculan), daftar topik
  berbatang, tombol "Analisa percakapan baru" (menampilkan hasil batch) dan
  "Export Excel".
- `conversation-insight-card.tsx` di panel chat inbox: ringkasan + topik + sentimen +
  penanda komplain + chip kata kunci, plus tombol kecil "Ringkas dengan AI".

## Non-Goals

- Mengubah apa pun di `src/lib/conversation-analytics/` (lib bersama, sudah teruji).
- Analisa otomatis terjadwal (cron/worker) — semua dipicu tombol.
- Menampilkan ringkasan per percakapan di laporan agregat (dilarang oleh Keputusan #3).
- Menimpa `is_complaint`/`category` manual milik EPIC-012 Fase D dengan penilaian AI;
  keduanya hidup terpisah, penilaian AI hanya dibaca sebagai angka laporan.
- Analisa media (gambar/suara/dokumen) — hanya teks.
- Terjemahan / multi-bahasa; prompt & keluaran bahasa Indonesia.

## Acceptance Criteria

1. Percakapan yang isinya tidak berubah **tidak** memanggil OpenAI lagi
   (`status: "cache"`), dan percakapan dengan pesan baru dianalisa ulang.
2. Percakapan tanpa pesan teks menghasilkan `status: "empty"` tanpa memanggil OpenAI.
3. OpenAI mati / API key kosong / jawaban tak bisa di-parse → `status: "failed"`
   dengan pesan, batch tetap lanjut, tidak ada exception yang naik ke route.
4. `analyzePending` tidak pernah memproses lebih dari `limit` (default 25, maks 100).
5. `GET /api/crm/reports/conversations` (json & xlsx) tidak memuat isi chat, ringkasan
   per percakapan, nomor telepon, maupun nama customer.
6. `format=xlsx` mengembalikan file XLSX valid bersheet `Ringkasan`, `Kata Kunci`,
   `Topik`, dengan header `Content-Disposition: attachment`.
7. Guard tegak: endpoint inbox = role inbox agent, endpoint laporan = role laporan.
8. Halaman Laporan CRM menampilkan kartu ringkasan, tabel kata kunci, daftar topik,
   dan kedua tombol; panel chat menampilkan ringkasan bila sudah ada.
9. Gate: seluruh unit test hijau, jumlah error `tsc` tidak bertambah.

## Test Plan

**Unit (`src/lib/crm/conversation-insights.test.ts`, 28 test)**
- `normalizeDirection`: nilai DB, ejaan inbound/outbound repo `wagateway`, huruf
  besar/kecil, dan nilai tak dikenal jatuh ke `out` (bukan `in`).
- `toTranscriptMessages`: pemetaan baris DB, pembuangan pesan tanpa teks (media/otp),
  `created_at` string vs `Date` invalid, transkrip kosong.
- `needsAnalysis`: cache-miss (belum ada / sidik jari beda / sidik jari kosong),
  cache-HIT (sidik jari sama), plus uji terhubung nyata dengan `fingerprintTranscript`
  (pesan baru ⇒ analisa ulang).
- `clampPendingLimit`: nilai wajar, nilai tak masuk akal → default, borongan → maks,
  pembulatan ke bawah.
- `summarizeBatch`, `buildInsightReport` (termasuk `not_analyzed` tidak pernah
  negatif dan batas keyword/topik), `buildReportSheets` (3 sheet, nama ≤ 31 char,
  header, tanpa sel ber-PII), `reportFileName`.

**Verifikasi nyata terhadap data dev (2026-07-25)**
Dijalankan lewat skrip sementara terhadap `crm.wa_*` dev + OpenAI sungguhan
(key tersedia di `configuration.app_settings` & env), lalu skripnya dihapus.

**Manual QA (sisa untuk owner)**
- Buka Laporan CRM sebagai super_admin/admin/direksi → seksi Analitik Percakapan
  terisi; tekan "Analisa percakapan baru" → notifikasi hasil batch; tekan
  "Export Excel" → file terunduh & terbuka di Excel/Google Sheet.
- Buka inbox sebagai pos_supervisor → ringkasan AI tampil di panel chat; tombol
  "Ringkas dengan AI" bekerja pada percakapan yang belum diringkas.
- Login role di luar daftar → 403 pada kedua endpoint.

## Agent Routing

- Scoping & implementasi: Claude Code (general-purpose), single-pass.
- Gate akhir (`vitest`, `tsc`, build, PM2) dijalankan owner — epic ini tidak
  menjalankan `next build`, `pm2`, maupun `git commit`.

## Done Signal

Migrasi applied di dev · unit test hijau (964 total, +28 baru) · `tsc` tidak
menambah error (482, sama dengan baseline) · jalur cache/analisa/laporan/XLSX
terverifikasi terhadap data dev sungguhan · menunggu UAT owner.

## Automation Log

- 2026-07-25 — Epic dibuat setelah scoping. Ditemukan: `wa_messages.direction` sudah
  `'in'|'out'` (CHECK constraint) = pemetaan lurus ke lib bersama; `xlsx` sudah
  terpasang; guard & pola OpenAI sudah ada. Keputusan: lib bersama tidak disentuh,
  cache lewat fingerprint, laporan bebas PII.
- 2026-07-25 — **Fase A SELESAI**: migrasi `20260725170000_conversation_insights.sql`
  applied di dev (`npm run db:migrate:apply` → 1 migrasi diterapkan).
- 2026-07-25 — **Fase B SELESAI**: logika murni dipisah ke
  `conversation-insights.ts` agar bisa diuji tanpa Postgres/OpenAI;
  `conversation-insights-server.ts` memegang DB + panggilan OpenAI.
  Catatan implementasi: setting `openai_model` menyimpan id POLOS (`gpt-4o-mini`)
  sedangkan `resolveAiAssistantModel` hanya mengenal id ber-prefix `openai:` — id
  diprefiks dulu sebelum divalidasi, jadi pilihan model di Settings benar-benar
  dipakai (bukan diam-diam jatuh ke default). `response_format: json_object` dicoba
  lebih dulu; bila base URL/model membalas HTTP 400, panggilan diulang SEKALI tanpa
  parameter itu (`parseInsight` tetap sanggup membaca jawaban ber-pagar kode).
  `temperature: 0` (bukan 0.7 seperti asisten) supaya transkrip sama menghasilkan
  label yang sama.
- 2026-07-25 — **Fase C SELESAI**: 2 route baru. Gagal analisa dibalas HTTP 502, bukan
  500, agar UI bisa memisahkan "AI tidak menjawab" dari "bug/izin".
- 2026-07-25 — **Fase D SELESAI**: seksi laporan + kartu insight di panel chat.
  Export memakai Blob (bukan `window.open`) supaya error izin/periode tetap muncul
  sebagai pesan, bukan tab kosong.
- 2026-07-25 — **VERIFIKASI NYATA (data dev + OpenAI sungguhan)**:
  - Transkrip percakapan `a3d1de09…` (9 pesan `chat`) terpetakan benar — ada
    `direction: "in"` maupun `"out"`, pesan tanpa teks terbuang.
  - Analisa sungguhan lewat `gpt-4o-mini` menghasilkan insight berbahasa Indonesia:
    topic `tanya redeem point`, sentiment `positif`, keywords
    `["redeem point","ganti profil","transferan"]`, fingerprint `9-a45667a6`.
  - **Cache terbukti**: panggilan berikutnya (bahkan di proses berbeda) mengembalikan
    `status: "cache"` tanpa memanggil OpenAI; `analyzePending` pada run kedua
    mengembalikan `requested: 0` karena tidak ada percakapan yang berubah.
  - **Fallback terbukti**: dengan `openai_api_key` dikosongkan (env + setting),
    `analyzeConversation` mengembalikan `status: "failed"` dengan pesan
    "API key OpenAI belum tersedia…", TIDAK melempar, dan tetap membawa cache lama.
    Nilai setting dipulihkan setelah uji (diverifikasi ulang: panjang 164 char).
  - Laporan agregat periode 2026-07-01..25: 4 percakapan, 4 teranalisa, 1 komplain,
    sentimen {positif 1, netral 2, negatif 1}, 7 kata kunci, 3 topik. Kunci respons
    tepat `["period","summary","keywords","topics"]` — tanpa `summary` per percakapan.
  - XLSX terbentuk 19.781 byte dengan sheet `['Ringkasan','Kata Kunci','Topik']`.
  - Skrip verifikasi sementara dihapus setelah dipakai (bukan bagian dari suite).
- 2026-07-25 — **Gate**: `npx vitest run` → 964 test / 106 file hijau (baseline 936,
  +28 test baru). `npx tsc --noEmit | grep -c "error TS"` → **482**, sama dengan
  baseline (tidak ada error baru; tidak ada error di file EPIC-029). Status
  `ready-for-qa`; `next build`/`pm2`/commit diserahkan ke owner.
