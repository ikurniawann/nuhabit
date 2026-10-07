# EPIC-005: Live Monitoring Rekrutmen (Near-Live Cam + Live Chat)

status: ready-for-qa
environment: dev
retries: 0

## Goal

HRD & Super Admin memantau kandidat yang sedang mengerjakan psikotes on-cam
dan interview AI secara langsung: sub menu Rekrutmen → Live Monitoring berisi
thumbnail live semua sesi berjalan; klik masuk detail dgn live cam besar +
live chat dua arah dgn kandidat.

## Keputusan Desain

- **Near-live via frame polling, bukan WebRTC**: kandidat mengirim frame JPEG
  320x240 tiap 4 dtk (UPSERT 1 baris/sesi di `live_monitor_frames`); HR
  polling frame (thumbnail 4 dtk, detail 3 dtk). Tanpa infrastruktur
  SFU/TURN, cukup utk supervisi. Frame BUKAN arsip — arsip tetap snapshot
  proctoring 60 dtk.
- **Live chat via polling** (4 dtk terbuka / 12 dtk tertutup) di tabel
  `live_chat_messages`; kandidat dapat widget chat mengambang di portal
  (psikotes & interview) dgn badge unread.

## Scope

- Migrasi `20260717150000_live_monitoring.sql`: `live_monitor_frames`,
  `live_chat_messages`, menu IAM `hris.recruitment.live-monitoring`
  (grant: super_admin, admin full; hrd read).
- Lib `src/lib/recruitment/live-monitor.ts` (handler frame & chat bersama).
- Endpoint publik token: POST `live-frame` + GET/POST `chat` utk
  /api/psikotes/session/[token] dan /api/interview/session/[token].
- Endpoint HR (super_admin/admin/hrd): GET /api/recruitment/live-monitoring
  (daftar sesi in_progress kedua modul), GET .../[type]/[id]/frame
  (image/jpeg no-store), GET/POST .../[type]/[id]/chat.
- Portal kandidat: pengirim frame 4 dtk di hook proctoring (psikotes hanya
  bila consent kamera; interview selalu on-cam) + `LiveChatWidget`
  (komponen bersama, unread badge).
- Halaman HR: /dashboard/hris/live-monitoring (grid thumbnail: frame live,
  badge LIVE/OFFLINE (basi >30 dtk), tipe sesi, durasi, indikator chat) →
  detail /[type]/[id] (cam besar refresh 3 dtk + panel chat).

## Acceptance Criteria

- [x] Sub menu Live Monitoring muncul di Rekrutmen utk super_admin/admin/hrd.
- [x] Thumbnail sesi psikotes & interview in_progress tampil + auto-refresh.
- [x] Klik thumbnail → detail live cam + live chat.
- [x] Kandidat bisa chat dgn HRD dari portal (widget mengambang, dua arah).
- [x] Frame hanya terkirim saat sesi in_progress; endpoint HR ber-auth role.
- [ ] QA manual: sesi psikotes/interview riil dgn 2 browser (kandidat + HRD).

## Update: Video Smooth Real-Time (WebRTC)

- Halaman detail kini memakai **WebRTC P2P** (STUN publik, vanilla ICE
  non-trickle, signaling in-memory via
  /api/recruitment/live-monitoring/[type]/[id]/webrtc + endpoint token
  kandidat /webrtc) — video mengalir langsung kamera kandidat → browser HRD,
  termasuk audio (tombol unmute). Mendukung maks 3 viewer per sesi.
- **Fallback otomatis** ke frame polling bila P2P gagal (NAT simetris tanpa
  TURN) + tombol "Coba video langsung lagi". Thumbnail grid tetap frame 4 dtk.

## Automation Log

- 2026-07-15: Implementasi penuh; migrasi diterapkan di DEV, build hijau,
  lint+tsc bersih (error tersisa pre-existing). Smoke: list API mengembalikan
  sesi in_progress, kirim chat HR tersimpan (sender_name terisi), halaman
  monitor 200. Deploy DEV via PM2 port 3459. Status → ready-for-qa.
