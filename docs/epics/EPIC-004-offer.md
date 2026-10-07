# EPIC-004: Offer (Penawaran Kerja + Portal Respons)

status: ready-for-qa
environment: dev
retries: 0

## Goal

HRD menyusun & mengirim penawaran kerja dengan konteks gaji lengkap
(ekspektasi lamaran + ekspektasi saat interview AI + budget posisi), kandidat
merespons online (terima / nego / tolak) via link token — respons + timestamp
+ IP tercatat sebagai bukti digital. Kandidat masuk Hired hanya setelah offer
diterima.

## Scope

- Migrasi `20260717090000_candidate_offers.sql`: `recruitment.candidate_offers`
  (versi per revisi; revisi baru meng-expire offer terbuka sebelumnya) +
  `hris.positions.salary_min/salary_max` (nullable, referensi budget).
- Lib: `offer-session.ts` (token, auto-expire), `validations/offer.ts`.
- API publik `/api/offer/session/[token]`: GET rincian (tanpa catatan internal),
  POST respond (accept final / negotiate bisa diperbarui / decline final).
- API HR: GET+POST `/api/candidates/[id]/offers` (referensi gaji ikut dikirim),
  PUT `/api/offers/[id]/response` (catat respons manual via WA/telepon).
- Portal kandidat `/offer/[token]` (`src/features/offer-portal/`): rincian
  gaji/benefit/tanggal mulai + tombol Terima / Ajukan Nego / Tolak.
- Panel HR `offer-action-panel.tsx` (pipeline drawer + halaman detail
  kandidat): checklist, kartu referensi gaji, buat/revisi offer (peringatan
  lunak bila melebihi salary_max), riwayat versi + respons, keputusan
  "Diterima → Hired" digate offer accepted.
- `StageTaskPanel` generik utk tahap offer di halaman detail digantikan panel penuh.

## Acceptance Criteria

- [x] Offer dibuat per versi; revisi otomatis membatalkan offer terbuka lama.
- [x] Kandidat merespons via portal tanpa login; accept/decline final, nego bisa diulang.
- [x] Respons portal terekam dgn timestamp + IP + source; manual ditandai `manual`.
- [x] Referensi gaji tampil: lamaran + interview AI + budget posisi.
- [x] "Diterima → Hired" hanya aktif setelah ada offer accepted.
- [ ] QA manual: alur end-to-end offer → respons portal → hired di DEV.

## Catatan

- `salary_min/max` posisi belum punya UI kelola — isi via DB/admin; panel
  menampilkan "belum diatur" bila kosong. Fase 3 (offering letter PDF +
  e-sign) belum dikerjakan.

## Automation Log

- 2026-07-15: Implementasi Fase 1+2 penuh (migrasi diterapkan di DEV, build
  hijau, lint+tsc bersih; smoke: portal offer publik 200, token palsu 404,
  API HR 401 tanpa login, GET offers ber-auth mengembalikan referensi gaji
  termasuk ekspektasi interview AI). Deploy DEV via PM2 port 3459. Status →
  ready-for-qa.
