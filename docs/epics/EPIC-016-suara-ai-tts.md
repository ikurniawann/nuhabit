# EPIC-016: Suara AI — Provider TTS Bisa Dipilih + Preview

status: ready-for-qa
environment: dev
retries: 0

> Dokumen ini ditulis menyusul (2026-07-20). Kode, komentar, dan migrasi
> `20260720210000_settings_suara_ai_menu.sql` sudah menyebut EPIC-016 sejak
> implementasi, tetapi file epic-nya terlewat dibuat. Dicatat apa adanya.

## Goal

Suara Interview AI terdengar kaku karena seluruh voice OpenAI adalah penutur asli
Inggris yang "diminta" berbahasa Indonesia. Menyediakan pilihan provider TTS
(termasuk yang punya suara asli id-ID) lengkap dengan preview, sehingga suara
bisa diganti tanpa deploy.

## Evidence (2026-07-20)

1. 23 dari 23 turn wawancara punya `question_audio_path` terisi → fallback Web
   Speech API browser tidak pernah terpakai; suaranya memang dari OpenAI.
2. `gpt-4o-mini-tts` menjawab HTTP 200 dengan key terpasang → tidak ada fallback
   diam-diam ke `tts-1`. Konfigurasi lama sudah optimal; plafonnya memang di situ.
3. `synthesizeInterviewSpeech` lama menelan semua kegagalan di `catch {}` kosong,
   sehingga asal suara (model utama / fallback / browser) tidak bisa ditelusuri.
4. Voice & model hardcoded (`coral`, `gpt-4o-mini-tts`) — ganti suara = ubah kode.

## Scope

- `src/lib/tts/catalog.ts` — katalog provider/voice/model sebagai data murni,
  dengan penanda `nativeIndonesian`. 12 unit test.
- `src/lib/tts/synthesize.ts` — satu pintu sintesis (OpenAI · Azure · ElevenLabs),
  selalu mp3, kegagalan selalu dicatat.
- API `GET/PUT /api/settings/tts` + `POST /api/settings/tts/preview`.
- Halaman Settings → Suara AI (`/dashboard/settings/voice`) + migrasi menu.
- Interview AI memanggil lib ini; voice tidak lagi hardcoded.

## Non-Goals

- Google Cloud TTS (butuh service account, lebih berat dari key sederhana).
- Mengganti Whisper (STT) — tetap OpenAI.

## Acceptance Criteria

- [x] Provider, voice, dan model bisa dipilih dari UI dan tersimpan.
- [x] Preview memakai kalimat pembuka wawancara asli dan tidak menyimpan apa pun.
- [x] Rahasia hanya dikirim balik dalam bentuk tersamar.
- [x] Teks pertanyaan di-escape sebelum masuk SSML Azure.
- [x] Endpoint menolak akses tanpa login.
- [ ] Jalur Azure & ElevenLabs terbukti jalan dengan kredensial sungguhan.

## Test Plan

- Unit: resolusi voice/model per provider (vitest).
- Manual: tekan Preview per provider, bandingkan hasilnya, lalu Simpan.

## Automation Log

- 2026-07-20 — Implementasi selesai (commit `42618fc`), menu applied di dev.
  Jalur OpenAI dibuktikan lewat smoke sementara: `openai/coral/gpt-4o-mini-tts`
  menghasilkan mp3 45 KB valid.
- 2026-07-20 — ElevenLabs dikonfigurasi di dev (`eleven_multilingual_v2`, voice
  Sarah). Key pertama dari owner ditolak karena scope kosong (`missing the
  permission text_to_speech`); key kedua berfungsi. Catatan penting: seluruh voice
  premade di akun tersebut berlabel bahasa Inggris — kealamian id-ID bergantung
  pada model multilingual, bukan asal suaranya. Untuk hasil benar-benar lokal,
  tambahkan voice Indonesia dari Voice Library atau pakai Azure `id-ID-*`.
- 2026-07-20 — Sisa: jalur **Azure belum pernah dieksekusi** (tidak ada
  kredensial); konfigurasi TTS baru ada di dev, produksi masih OpenAI.
