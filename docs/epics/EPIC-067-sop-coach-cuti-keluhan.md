# EPIC-067: SOP Coach — Cuti Terencana, Keluhan & Member Perhatian Khusus

status: backlog
environment: dev
retries: 0

## Goal

Menegakkan SOP coach lewat sistem, bukan hanya dokumen: **cuti dan ketidakhadiran tidak boleh mendadak** dan kelas
tidak pernah kosong tanpa pengganti; **keluhan pelanggan** tercatat, ada PIC, dan selesai dalam batas waktu; serta
**member yang butuh perhatian khusus** (cedera, kondisi medis, hamil, pemula, VIP) terlihat oleh coach sebelum sesi.

Permintaan client (2026-10-21): "Siapkan SOP coach yang mengatur cuti dan ketidakhadiran agar tidak dilakukan
mendadak. SOP juga perlu mencakup penanganan keluhan atau pelanggan yang membutuhkan perhatian khusus."

Referensi: [PRD](../product/PRD.md) · [BACKLOG](../BACKLOG.md) ·
[EPIC-056](./EPIC-056-komisi-coach-coach-portal.md) · [EPIC-058](./EPIC-058-job-harian-notifikasi-wa.md) ·
[EPIC-064](./EPIC-064-calon-member-waiver-trial.md) · [EPIC-012](./EPIC-012-wa-customer-service.md) ·
[EPIC-007](./EPIC-007-workforce-ess.md).

## Kondisi saat ini (audit 2026-10-21)

| Area | Sudah ada | Celah |
|------|-----------|-------|
| Cuti | `hris.leaves` + approval + WA ke atasan (`src/lib/hris/leave-wa.ts`); `studio.coach_time_off` diinput admin; `studio.coaches.employee_id` → `hris.employees` | Tidak ada minimal pemberitahuan (H-N) / blackout; coach tidak bisa ajukan dari Coach Portal; cuti HRIS tidak masuk `coach_time_off`; `coach_time_off` hanya memblok slot Personal Training, kelas grup tidak dicek |
| Pengganti | Admin ganti coach per sesi (`PATCH /api/studio/sessions/[id]`, cek bentrok `src/lib/studio/conflicts.ts`) | Tidak ada alur permintaan/penerimaan pengganti, tidak ada saran coach yang kosong |
| Notifikasi member | `studio.member_notifications` (session_reminder, waitlist_promoted, pass_low, pass_expiring) | Tidak ada WA saat kelas dibatalkan / coach diganti |
| Personal Training | Booking & batal | Tidak ada reschedule |
| Disiplin | KPI `leave_request_discipline` (`src/lib/kpi/collectors-wave2.ts`); komisi `studio.commission_lines` | Tidak ada catatan coach tidak hadir, ambang H-N di KPI, potongan insentif, atau SP |
| Keluhan | WA inbox: `crm.wa_conversations.is_complaint`, prioritas, SLA, eskalasi, CSAT (`src/lib/crm/cs-sla-watcher.ts`) | Bukan tiket resmi; kategori hanya produk/layanan/pembayaran/lainnya; tidak terkait coach/sesi; eskalasi tidak mengirim alert; tidak ada form di Member App |
| Perhatian khusus | `pos.pos_customers.notes`, `studio.bookings.notes` (teks bebas) | Tidak ada penanda terstruktur; roster Coach Portal (`/api/coach/sessions/[id]/roster`) tidak menampilkan catatan |
| Dokumen SOP | `hris.announcements` + `announcement_reads` | Tidak ada versi & konfirmasi "Saya sudah membaca dan setuju" |

## Keputusan yang menunggu client

Angka di bawah adalah **usulan default** dan semuanya harus bisa dikonfigurasi dari backoffice; konfirmasi sebelum
Tahap 1 dikerjakan.

1. **Minimal pemberitahuan per jenis cuti** — usulan: tahunan H-7, unpaid H-7, menstrual/sakit/darurat boleh
   mendadak tapi wajib lampiran atau alasan dan otomatis ditandai *mendadak*.
2. **Approver** cuti & pengganti — Head Coach, Ops Director, atau berjenjang.
3. **Konsekuensi cuti mendadak / tidak hadir tanpa kabar** — hanya tercatat di KPI, memotong porsi insentif, atau
   memicu SP setelah N kali dalam periode.
4. **Batas waktu keluhan per kategori** — usulan: cedera 2 jam respons / 24 jam selesai; lainnya 24 jam / 3 hari.
5. **Tanggal blackout** — siapa yang mengatur dan apakah boleh ada pengecualian.

## Keputusan desain

- **Satu sumber cuti**: pengajuan tetap disimpan di `hris.leaves` (kuota, approval, payroll tetap jalan); cuti coach
  yang disetujui otomatis membuat `studio.coach_time_off` dengan referensi ke `leave_id`. Pengajuan dari Coach Portal dan
  ESS memakai aturan yang sama.
- **Aturan H-N dihitung dari tanggal pengajuan ke tanggal mulai**, per jenis cuti; pengajuan di bawah H-N untuk jenis
  yang tidak dikecualikan ditolak, untuk jenis yang dikecualikan diterima dengan flag `is_short_notice`.
- **Cuti coach baru bisa disetujui bila semua sesi terdampak sudah punya pengganti yang menerima** (atau sesi
  dibatalkan secara sadar oleh approver dengan alasan). Kelas grup dan Personal Training sama-sama dicek.
- **Notifikasi member** memperluas `studio.member_notifications.kind` (mis. `session_coach_changed`,
  `session_cancelled`, `pt_rescheduled`) lewat jalur WA yang sudah ada di EPIC-058.
- **Tiket keluhan** adalah objek baru (bukan memperluas `wa_conversations`) agar bisa berasal dari WA, front desk, atau
  Member App; percakapan WA cukup ditautkan ke tiket.
- **Penanda member** adalah daftar tetap yang bisa ditambah dari backoffice, dengan tingkat (info/perhatian/kritis),
  catatan singkat, dan masa berlaku opsional. Data medis hanya terlihat oleh coach yang punya sesi dengan member
  tersebut dan oleh admin studio.
- **Member App tetap berbahasa Inggris**; backoffice dan Coach Portal berbahasa Indonesia. Tulis "Personal Training"
  lengkap di UI.

## Tasks

### A. Cuti & ketidakhadiran coach

- [ ] T-067-A1 **(Tahap 1)** Aturan minimal pemberitahuan H-N per jenis cuti + daftar jenis yang dikecualikan; flag
  `is_short_notice`; konfigurasi di pengaturan HRIS/studio; validasi di API cuti (ESS & Coach Portal). Tes logika murni.
- [ ] T-067-A3 **(Tahap 1)** Pengajuan cuti dari Coach Portal: pilih tanggal → tampil daftar kelas & sesi Personal
  Training yang terdampak → kirim. Status pengajuan terlihat di Coach Portal.
- [ ] T-067-A4 **(Tahap 1)** Alur pengganti: coach mengusulkan pengganti per sesi terdampak (sistem menyarankan coach
  yang kosong & tidak bentrok); pengganti menerima/menolak dari Coach Portal + WA; approver menyetujui cuti hanya bila
  semua sesi tertangani. Saat disetujui, `class_sessions.coach_id` diganti otomatis.
- [ ] T-067-A6 **(Tahap 1)** WA ke member yang sudah booking saat coach diganti atau kelas dibatalkan (perluas
  `member_notifications.kind`, idempoten per sesi + member).
- [ ] T-067-A5 **(Tahap 2)** Sinkron cuti HRIS yang disetujui → `studio.coach_time_off` (dengan `leave_id`), dan cek
  bentrok `coach_time_off` terhadap kelas grup saat generate sesi dan saat input manual.
- [ ] T-067-A8 **(Tahap 2)** Catatan ketidakhadiran coach (tidak hadir tanpa kabar, cuti mendadak, terlambat) per
  sesi; KPI `leave_request_discipline` memakai ambang H-N; opsi potongan porsi insentif di `commission_lines` dan/atau
  SP sesuai keputusan client.
- [ ] T-067-A2 **(Tahap 3)** Tanggal blackout cuti (rentang tanggal + alasan) yang menolak pengajuan, dengan
  pengecualian oleh approver.
- [ ] T-067-A7 **(Tahap 3)** Reschedule sesi Personal Training (coach/admin/member) tanpa batal-lalu-booking; kredit tetap,
  WA ke pihak lain.

### B. Keluhan pelanggan

- [ ] T-067-B1 **(Tahap 2)** Tiket keluhan: sumber (WA/front desk/Member App), kategori Hyrox (coach, kelas,
  fasilitas, cedera, billing, lainnya), prioritas, tautan ke member, coach, sesi, dan percakapan WA. Buat tiket dari
  WA inbox dengan satu klik.
- [ ] T-067-B2 **(Tahap 2)** Alur penyelesaian: diterima → ditangani → selesai → dikonfirmasi member; PIC, batas waktu
  respons & selesai per kategori, catatan internal, riwayat status.
- [ ] T-067-B3 **(Tahap 2)** Eskalasi aktif: saat batas waktu terlewat, kirim WA ke Head Coach / Ops (pakai jalur
  notifikasi owner yang ada); juga perbaiki SLA watcher WA inbox agar mengirim alert, bukan hanya menandai.
- [ ] T-067-B4 **(Tahap 3)** Form "Send feedback / Report an issue" di Member App (bahasa Inggris), opsional terkait
  sesi yang pernah diikuti → masuk sebagai tiket.
- [ ] T-067-B5 **(Tahap 3)** Laporan keluhan: per kategori, per coach, waktu penyelesaian rata-rata; masuk ke KPI coach.

### C. Member perhatian khusus

- [ ] T-067-C1 **(Tahap 1)** Penanda member terstruktur (cedera, kondisi medis, hamil, pemula, VIP, pernah komplain;
  bisa ditambah) dengan tingkat, catatan, masa berlaku; kelola dari profil member di backoffice.
- [ ] T-067-C2 **(Tahap 1)** Tampilkan penanda di roster kelas dan sesi Personal Training di Coach Portal (ikon + catatan
  singkat), dibatasi ke coach yang memegang sesi tersebut.
- [ ] T-067-C3 **(Tahap 3)** Integrasi waiver & PAR-Q [EPIC-064](./EPIC-064-calon-member-waiver-trial.md): jawaban
  "ya" pada pertanyaan kesehatan otomatis membuat penanda kondisi medis untuk ditinjau.
- [ ] T-067-C4 **(Tahap 3)** Catatan coach setelah sesi per member (mis. "hindari lunges") yang terbawa ke sesi
  berikutnya dan terlihat oleh coach lain.

### D. Dokumen SOP

- [ ] T-067-D1 **(Tahap 2)** Dokumen SOP berversi dengan konfirmasi "Saya sudah membaca dan setuju" per coach
  (perluas `hris.announcements` atau tabel kebijakan baru); coach yang belum konfirmasi versi terbaru diingatkan di Coach
  Portal; laporan siapa yang belum konfirmasi.

## Urutan pengerjaan

1. **Tahap 1 — inti permintaan client:** A1, A3, A4, A6, C1, C2.
2. **Tahap 2:** B1, B2, B3, A5, A8, D1.
3. **Tahap 3:** A2, A7, B4, B5, C3, C4.

## Acceptance Criteria

- [ ] Coach tidak bisa mengajukan cuti tahunan di bawah minimal pemberitahuan; cuti sakit/darurat tetap bisa diajukan
  dan tercatat sebagai *mendadak*.
- [ ] Coach bisa mengajukan cuti dari Coach Portal dan melihat semua kelas & sesi Personal Training yang terdampak.
- [ ] Cuti coach tidak bisa disetujui selama masih ada sesi terdampak tanpa pengganti yang menerima (atau pembatalan
  dengan alasan).
- [ ] Member yang sudah booking menerima WA saat coach kelasnya diganti atau kelas dibatalkan, tepat sekali.
- [ ] Coach melihat penanda perhatian khusus member di roster sebelum sesi; coach lain yang tidak memegang sesi tidak
  melihat data medisnya.
- [ ] Setiap keluhan punya PIC, kategori, dan batas waktu; keluhan yang lewat batas waktu memicu WA eskalasi.
- [ ] Dashboard menampilkan coach yang belum mengonfirmasi SOP versi terbaru.
- [ ] Tes unit untuk aturan H-N, pemilihan pengganti, dan perhitungan batas waktu tiket; tes integrasi dijalankan di
  `nuhabit_test`, bukan di DB `nuhabit`.

## Automation Log

- 2026-10-21 — Epic dibuat dari permintaan client soal SOP coach (cuti tidak mendadak, keluhan, pelanggan perhatian
  khusus). Audit kode Nuhabit-dev (branch `feat/nuhabit-foundation`) mencatat yang sudah ada vs celah (tabel di atas).
  Prioritas Tahap 1/2/3 disetujui owner proyek; angka H-N, approver, konsekuensi, dan batas waktu keluhan masih menunggu
  keputusan client.
