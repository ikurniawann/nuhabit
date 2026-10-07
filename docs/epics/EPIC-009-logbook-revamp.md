# EPIC-009: Logbook Department — Amankan Backend + Revamp UI/UX

status: ready-for-qa
environment: dev
retries: 0

## Goal

Merombak modul Logbook Department (KPI checklist per department) yang backend-nya
tidak memiliki auth guard sama sekali dan UI-nya terpecah di dua halaman yang
tumpang tindih (`/hris/logbook` dan `/hris/logbook-list`) dengan pola usang.
Hasil akhir: satu halaman ber-Tabs yang alurnya dimulai dari template (master
data), backend ber-guard penuh dengan enforcement department di server, dan
catatan checklist yang aman dari XSS.

## Evidence (hasil audit 2026-07-18, Explore agent)

Anchor kode: route `src/app/api/hris/logbook/route.ts` (GET/POST/PATCH monolitik),
`src/features/hris/logbook/` + `src/features/hris/logbook-list/` (dua feature
tumpang tindih), skema `database/migrations/schemas/hris/0000000000015{2,3,4,5}_*.sql`,
trigger KPI `update_hris_logbook_entry_score` (functions.sql:2662).

1. **Auth bolong total (CRITICAL)** — semua resource GET selain `me`, plus SEMUA
   POST/PATCH, bisa dipanggil tanpa autentikasi. `getUser()` hanya pengisi kolom
   audit (boleh null), bukan gerbang. Siapa pun bisa buat template, generate
   entry, centang, submit, bahkan review/reject.
2. **Enforcement department kosmetik** — API selalu mengirim data SEMUA
   department; pembatasan hanya filter klien. PATCH tidak memeriksa kepemilikan
   department/role.
3. **XSS** — catatan Quill dirender `dangerouslySetInnerHTML` tanpa sanitasi
   (`logbook-list-page.tsx:234`). Proyek sudah punya `SafeHtml` + allowlist
   DOMPurify (modul announcements) yang tinggal direuse.
4. **Guard status hanya di UI** — submit tidak cek status draft di server;
   review tidak cek status submitted.
5. **Tidak ada DELETE** — template/entry salah tidak bisa dikoreksi.
6. **UI usang** — native `<select>` hand-styled, banner string alih-alih toast,
   tanpa pagination/skeleton, Quill overlay fullscreen, dua halaman duplikatif.
7. **Yang sehat** — skema DB rapi, trigger KPI otomatis (completion & kpi_score
   dari bobot), tidak kena bug RETURNING embed, tidak ada endpoint hantu.
8. **Relasi ke Performance hanya kosmetik** — menu di-namespace
   `hris.performance.*` tapi data KPI logbook berdiri sendiri.

## Keputusan Owner (2026-07-18)

- **Satu halaman ber-Tabs** di `/dashboard/hris/logbook`; template adalah master
  data dan **step pertama alur**: pilih template yang ada ATAU buat baru, baru
  generate entry harian. Menu/halaman `logbook-list` di-redirect & dinonaktifkan.
- **Review/Reject**: `super_admin` + `hrd` sekarang; disiapkan mudah diperluas ke
  head department lain nanti (konstanta `LOGBOOK_REVIEW_ROLES`).
- **DELETE**: ya — hapus entry draft; template dihapus permanen bila belum punya
  entry, selain itu diarsipkan (`is_active=false`).

## Scope

- `src/lib/hris/logbook.ts` (baru): konstanta role, guard status, resolusi scope
  department — murni & teruji.
- Rewrite `src/app/api/hris/logbook/route.ts`: guard semua method + DELETE baru,
  filter department/tanggal/pagination server-side.
- Rewrite UI jadi satu halaman ber-Tabs (Checklist | Riwayat | Template | KPI);
  komponen `ui/select`, toast, skeleton, Badge, `SafeHtml` utk notes.
- Redirect `/dashboard/hris/logbook-list` → `/dashboard/hris/logbook`; migrasi
  nonaktifkan menu `hris.performance.logbook-list`.

## Non-Goals

- Integrasi data KPI logbook ke modul Performance review (epic terpisah bila
  dibutuhkan).
- Role `department_head` formal di iam (review roles cukup konstanta dulu).
- Multi-tenant/brand scoping tabel logbook (tabel belum punya kolom tenant —
  selaras epic multi-tenant payroll yang ditunda owner).

## Acceptance Criteria

- [ ] Tanpa login: semua method `/api/hris/logbook` → 401.
- [ ] Login non-full-access: hanya melihat & memutasi data department sendiri
      (dipaksa di server, bukan filter klien); akses department lain → 403.
- [ ] Submit hanya bisa dari status `draft`; review/reject hanya dari
      `submitted` dan hanya oleh `LOGBOOK_REVIEW_ROLES`.
- [ ] Catatan checklist dirender lewat `SafeHtml` (tersanitasi).
- [ ] DELETE: entry `draft` bisa dihapus; template tanpa entry terhapus
      permanen, yang punya entry terarsip.
- [ ] Satu halaman ber-Tabs dengan alur template-first; halaman logbook-list
      redirect; menu lama nonaktif.
- [ ] Unit test helper murni hijau; build hijau; smoke dev OK.

## Test Plan

- Unit: guard status, resolusi scope department, role review (vitest).
- Manual dev: login kepala dept non-full-access → hanya dept sendiri; login
  hrd → review/reject; coba akses tanpa login via curl → 401.

## Agent Routing

- Explore (audit) ✔ → implementasi utama sesi Claude → code-reviewer +
  security-reviewer gate → build & deploy dev.

## Done Signal

Semua Acceptance Criteria tercentang + Automation Log terisi + status
`ready-for-qa`.

## Automation Log

- 2026-07-18 — Epic dibuat dari audit menyeluruh (Explore agent): auth bolong
  total di route logbook, enforcement department kosmetik, XSS notes Quill,
  dua halaman UI tumpang tindih. Keputusan owner: satu halaman ber-Tabs dgn
  alur template-first, review roles super_admin+hrd (extensible head dept),
  DELETE ya. Status → coding.
- 2026-07-18 — Fase A+B selesai satu sesi. Backend: `lib/hris/logbook.ts`
  (role/status/scope, 9 unit test) + route rewrite (semua method 401 tanpa
  login — diverifikasi curl; scope department server-side; DELETE
  entry-draft/template arsip-cerdas; pagination entries). UI: satu halaman
  ber-Tabs (Checklist template-first | Riwayat | Template | KPI), ui/select +
  toast + skeleton + SafeHtml; logbook-list redirect + menu nonaktif (migrasi
  `20260718180000`, applied+tracked). Review gates: security-reviewer — 0
  CRITICAL/HIGH, 2 MEDIUM diperbaiki (scope dept di review-entry; normalizeNote
  utk notes/review_notes di 3 jalur tulis); code-reviewer — 1 HIGH diperbaiki
  (bobot 0 dikoersi jadi 1 → KPI korup; kini 0 dipertahankan), 2 MEDIUM
  diperbaiki (create-entry tolak template arsip 409; error-state per tab via
  LogbookQueryError), 1 LOW dikomentari (resource=departments memang tanpa
  scope). Deferred (LOW): pagination templates/summary, batas atas param page.
  Gates final: unit test hijau, tsc bersih (error tersisa pre-existing modul
  lain), build sukses, PM2 restart, smoke 401/200 OK. Status → ready-for-qa.
  Sisa QA manusia: login kepala dept non-full-access (hanya dept sendiri),
  hrd review/reject, alur template→generate→isi→submit→review end-to-end.
