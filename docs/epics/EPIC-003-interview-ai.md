# EPIC-003: Interview AI (Voice, On-Cam, Proctored)

status: ready-for-qa
environment: dev
retries: 0

## Goal

HRD terbantu pertanyaan basic screening: AI interviewer menanyakan hal dasar ke
kandidat (perkenalan/pengalaman, keahlian, motivasi, ketersediaan, ekspektasi
gaji) lewat portal token tanpa login, **wajib on-cam**, tanya-jawab dengan
**suara dua arah** (TTS untuk pertanyaan, rekaman mikrofon → transkrip Whisper
untuk jawaban), lalu AI menyimpulkan relevansi kandidat terhadap posisi —
indikatif, keputusan tetap di HRD.

## Scope

- Migrasi: `interview_ai_sessions`, `interview_ai_turns`, `interview_ai_proctor_events`
  (delta `20260716090000_interview_ai.sql`).
- Lib server: `src/lib/recruitment/interview-ai.ts` (DeepSeek pertanyaan adaptif +
  kesimpulan; OpenAI Whisper + TTS `gpt-4o-mini-tts`→`tts-1` fallback),
  `interview-session.ts` (token, rate limit, expiry), `storage-private.ts`
  (+ audio webm/ogg/mp3/m4a dgn magic-byte sniffing).
- API publik (`/api/interview/session/[token]`): GET, start (consent kamera wajib),
  answer (multipart voice/text → Whisper → turn berikutnya / kesimpulan),
  proctor-event (superset psikotes + `face_not_detected`/`multiple_faces`/`camera_off`).
- API HR: GET `/api/candidates/[id]/interview`, POST `.../interview/sessions`,
  GET `/api/interview/sessions/[id]/proctor-events`, GET `/api/interview/files/[...path]`.
- Portal kandidat `/interview/[token]` (`src/features/interview-portal/`):
  landing consent → percakapan (TTS autoplay + rekam jawaban MediaRecorder,
  fallback ketik & Web Speech) + self-view kamera + proctoring realtime
  (snapshot 60s, deteksi wajah via Shape Detection API bila tersedia, tab/fullscreen/paste).
- Panel HR di pipeline (`interview-action-panel.tsx`): checklist, kirim undangan
  (+ WA), kartu kesimpulan AI (skor relevansi, keahlian, ekspektasi gaji, red
  flags), transkrip + pemutar rekaman suara, analitik proctoring, keputusan
  (Lolos → Offer digate minimal 1 sesi selesai).

## Acceptance Criteria

- [x] Kandidat bisa interview via link token tanpa login; kamera+mikrofon wajib.
- [x] Pertanyaan dibacakan suara (TTS) dan jawaban suara ditranskrip otomatis.
- [x] Fallback: ketik jawaban bila mikrofon bermasalah; pertanyaan statis bila LLM down.
- [x] Topik gaji selalu tertanya sebelum sesi ditutup.
- [x] Kesimpulan AI: skor relevansi, keahlian, ekspektasi gaji, red flags, keterbatasan.
- [x] Proctoring: tab_blur/fullscreen_exit/paste/disconnect + snapshot berkala +
      face_not_detected/multiple_faces/camera_off (deteksi wajah best-effort, Chrome).
- [ ] QA manual: alur end-to-end dengan kandidat sungguhan di DEV.

## Keputusan Desain

- **Asinkron, bukan video-call dua arah** — tanpa WebRTC; kandidat mengerjakan
  kapan saja, biaya = Whisper + beberapa call LLM per sesi.
- **Analisis ekspresi TIDAK diimplementasikan** (fase 3 opsional): emotion
  recognition tidak reliabel & sensitif secara etika/UU PDP. Analitik dibatasi
  ke sinyal objektif (on-cam, keluar frame, tab, durasi).
- Kunci AI dari `configuration.app_settings` (Settings → Integrasi), sama
  dengan psikotes; TTS gagal → interview tetap jalan (teks + Web Speech).

## Automation Log

- 2026-07-15: Implementasi penuh (migrasi diterapkan di DEV, build hijau,
  lint+tsc bersih, smoke test: portal publik 200, API token 404 utk token
  palsu, API HR 401 tanpa login). Deploy DEV via PM2 port 3459. Status →
  ready-for-qa.
