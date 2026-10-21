# EPIC-067: SOP Coach — Cuti Terencana, Keluhan & Member Perhatian Khusus

status: on-progress
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

## Keputusan client (2026-10-21)

1. **Minimal pemberitahuan per jenis cuti dikonfigurasi di pengaturan.** Default awal: tahunan & unpaid H-7,
   melahirkan & ibadah H-30; sakit, darurat & haid boleh mendadak dengan lampiran/alasan dan otomatis ditandai
   *mendadak*.
2. **Approver cuti & pengganti = role Program Director.** Role ini belum ada di sistem (`coaches.level` hanya
   `coach`/`head_coach`) → dibuat di T-067-A9. Approver cadangan (dipakai saat Program Director sendiri cuti atau
   tidak ada) dikonfigurasi di pengaturan.
3. **Sanksi cuti mendadak / tidak hadir tanpa kabar = kombinasi**: tercatat di KPI, potongan porsi insentif per
   kejadian, dan SP setelah N kejadian dalam satu periode. Persentase potongan, N, dan panjang periode dikonfigurasi.
4. **Tanggal blackout wajib ada.** Diatur oleh Program Director; pengecualian hanya oleh Program Director dengan alasan.
5. **Pengganti — ikut best practice** (diputuskan tim, lihat Keputusan desain): pengganti harus menerima; bila tidak
   ada yang menerima dalam batas waktu, Program Director boleh menunjuk langsung; bila tidak ada pengganti sama sekali,
   hanya Program Director yang boleh membatalkan kelas, dengan alasan.
6. **Member saat coach diganti / kelas dibatalkan**: dapat WA berisi info perubahan **beserta link booking**; member
   boleh membatalkan booking **tanpa penalti dan kredit kembali**, walau sudah lewat batas batal normal. Batas paling
   lambat pemberitahuan (jam sebelum kelas) dikonfigurasi.
7. **Batas waktu keluhan ikut usulan**: cedera respons 2 jam / selesai 24 jam; coach, kelas, fasilitas, billing &
   lainnya respons 24 jam / selesai 3 hari. Semua bisa diubah di pengaturan.
8. **Penanda member ikut usulan**: cedera, kondisi medis, hamil, pemula, VIP, pernah komplain (bisa ditambah).
9. **Data medis hanya terlihat oleh coach** (lihat Keputusan desain untuk batasnya).

## Keputusan desain

- **Satu sumber cuti**: pengajuan tetap disimpan di `hris.leaves` (kuota, approval, payroll tetap jalan); cuti coach
  yang disetujui otomatis membuat `studio.coach_time_off` dengan referensi ke `leave_id`. Pengajuan dari Coach Portal dan
  ESS memakai aturan yang sama.
- **Aturan H-N dihitung dari tanggal pengajuan ke tanggal mulai**, per jenis cuti; pengajuan di bawah H-N untuk jenis
  yang tidak dikecualikan ditolak, untuk jenis yang dikecualikan diterima dengan flag `is_short_notice`.
- **Cuti coach baru bisa disetujui bila semua sesi terdampak sudah tertangani**: punya pengganti yang menerima,
  ditunjuk langsung oleh Program Director, atau dibatalkan oleh Program Director dengan alasan. Kelas grup dan
  Personal Training sama-sama dicek.
- **Alur pengganti (best practice, keputusan client no. 5)**:
  1. Coach yang cuti memilih calon pengganti per sesi dari daftar yang disarankan sistem: coach aktif, bisa mengajar
     program tersebut, tidak bentrok jadwal, tidak sedang cuti; diurutkan dari beban sesi minggu itu yang paling
     ringan.
  2. Calon pengganti menerima atau menolak dari Coach Portal (WA berisi link). Batas waktu respons dikonfigurasi
     (default 24 jam). Tolak atau lewat batas waktu → sesi kembali ke status "butuh pengganti".
  3. Program Director bisa menunjuk langsung coach mana pun yang tidak bentrok; coach yang ditunjuk mendapat WA.
  4. Tanpa pengganti, hanya Program Director yang boleh membatalkan kelas, dan wajib dengan alasan. Pembatalan
     memakai alur yang sudah ada (`releaseSessionBookings`: kredit kembali) dan mengirim WA ke member.
  5. Pengganti tercatat per sesi (`class_sessions.coach_id` diganti, coach asli disimpan) supaya komisi dan KPI
     mengikuti coach yang benar-benar mengajar.
- **Cuti mendadak yang sudah berjalan** (mis. sakit pagi hari) memakai alur yang sama tetapi langsung masuk ke antrean
  Program Director dengan prioritas tinggi, tanpa menunggu persetujuan cuti lebih dulu.
- **Hak batal member saat ada perubahan**: booking pada sesi yang coach-nya diganti atau dipindah membuka jendela
  batal tanpa penalti sampai sesi dimulai, walau batas batal normal sudah lewat. Kredit kembali penuh.
- **Notifikasi member** memperluas `studio.member_notifications.kind` (mis. `session_coach_changed`,
  `session_cancelled`, `pt_rescheduled`) lewat jalur WA yang sudah ada di EPIC-058.
- **Tiket keluhan** adalah objek baru (bukan memperluas `wa_conversations`) agar bisa berasal dari WA, front desk, atau
  Member App; percakapan WA cukup ditautkan ke tiket.
- **Penanda member** adalah daftar tetap yang bisa ditambah dari backoffice, dengan tingkat (info/perhatian/kritis),
  catatan singkat, dan masa berlaku opsional. Penanda dibagi dua kelompok:
  - **Umum** (pemula, VIP, pernah komplain): bisa dibuat dan dilihat oleh front desk, admin studio, dan coach.
  - **Medis** (cedera, kondisi medis, hamil): **detailnya hanya terlihat oleh coach**, sesuai keputusan client no. 9.
    Dibuat oleh coach atau berasal dari isian member sendiri (PAR-Q, T-067-C3). Coach yang dimaksud adalah coach
    yang memegang sesi aktif atau mendatang dengan member tersebut, termasuk pengganti, dan coach yang membuat
    penanda. Front desk dan admin hanya melihat bahwa member punya penanda medis (ikon tanpa isi), supaya tahu harus
    mengarahkan ke coach. Detail medis tidak ikut export dan tidak tampil di backoffice.
- **Member App tetap berbahasa Inggris**; backoffice dan Coach Portal berbahasa Indonesia. Tulis "Personal Training"
  lengkap di UI.

## Tasks

### A. Cuti & ketidakhadiran coach

- [x] T-067-A9 **(Tahap 1)** Role **Program Director**: role IAM yang bisa di-assign ke user, dengan hak menyetujui cuti
  coach, menunjuk pengganti, membatalkan kelas, mengatur blackout, dan melihat antrean "butuh pengganti". Pengaturan
  approver cadangan. Komisi tidak berubah: peran Ops Director 0% di EPIC-056 tetap terpisah dari role ini.
- [x] T-067-A1 **(Tahap 1)** Aturan minimal pemberitahuan H-N per jenis cuti + daftar jenis yang dikecualikan; flag
  `is_short_notice`; konfigurasi di pengaturan HRIS/studio; validasi di API cuti (ESS & Coach Portal). Tes logika murni.
- [x] T-067-A3 **(Tahap 1)** Pengajuan cuti dari Coach Portal: pilih tanggal → tampil daftar kelas & sesi Personal
  Training yang terdampak → kirim. Status pengajuan terlihat di Coach Portal.
- [x] T-067-A4 **(Tahap 1)** Alur pengganti sesuai Keputusan desain: saran coach yang kosong; terima/tolak dari Coach
  Portal + WA dengan batas waktu yang bisa diatur; antrean "butuh pengganti" untuk Program Director (tunjuk langsung
  atau batalkan dengan alasan); cuti disetujui hanya bila semua sesi tertangani. Saat disetujui,
  `class_sessions.coach_id` diganti otomatis dan coach asli disimpan.
- [x] T-067-A6 **(Tahap 1)** WA ke member yang sudah booking saat coach diganti atau kelas dibatalkan, berisi info
  perubahan dan **link booking** di Member App. Perluas `member_notifications.kind`, idempoten per sesi + member. Buka
  jendela batal tanpa penalti dengan kredit kembali penuh. Pengaturan "paling lambat N jam sebelum kelas"; perubahan
  yang lewat batas itu tetap dikirim dan ditandai *terlambat* di laporan Program Director.
- [ ] T-067-A5 **(Tahap 2)** Sinkron cuti HRIS yang disetujui → `studio.coach_time_off` (dengan `leave_id`), dan cek
  bentrok `coach_time_off` terhadap kelas grup saat generate sesi dan saat input manual.
- [ ] T-067-A8 **(Tahap 2)** Catatan ketidakhadiran coach (tidak hadir tanpa kabar, cuti mendadak, terlambat) per
  sesi; KPI `leave_request_discipline` memakai ambang H-N; potongan porsi insentif per kejadian di `commission_lines`
  (persentase bisa diatur); SP otomatis diusulkan ke Program Director setelah N kejadian dalam periode (N & periode
  bisa diatur). Ketiganya aktif bersamaan sesuai keputusan client no. 3.
- [ ] T-067-A2 **(Tahap 3)** Tanggal blackout cuti (rentang tanggal + alasan) diatur Program Director dan menolak
  pengajuan; pengecualian per pengajuan hanya oleh Program Director dengan alasan.
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

- [x] T-067-C1 **(Tahap 1)** Penanda member terstruktur (cedera, kondisi medis, hamil, pemula, VIP, pernah komplain;
  bisa ditambah) dengan tingkat, catatan, masa berlaku. Penanda umum dikelola dari profil member di backoffice;
  penanda medis dibuat dari Coach Portal dan detailnya tidak pernah dikirim ke API backoffice.
- [x] T-067-C2 **(Tahap 1)** Tampilkan penanda di roster kelas dan sesi Personal Training di Coach Portal (ikon + catatan
  singkat). Detail medis hanya untuk coach yang memegang sesi aktif/mendatang dengan member tersebut, dengan
  pembatasan di level query/API, bukan hanya disembunyikan di UI.
- [ ] T-067-C3 **(Tahap 3)** Integrasi waiver & PAR-Q [EPIC-064](./EPIC-064-calon-member-waiver-trial.md): jawaban
  "ya" pada pertanyaan kesehatan otomatis membuat penanda kondisi medis untuk ditinjau.
- [ ] T-067-C4 **(Tahap 3)** Catatan coach setelah sesi per member (mis. "hindari lunges") yang terbawa ke sesi
  berikutnya dan terlihat oleh coach lain.

### D. Dokumen SOP

- [ ] T-067-D1 **(Tahap 2)** Dokumen SOP berversi dengan konfirmasi "Saya sudah membaca dan setuju" per coach
  (perluas `hris.announcements` atau tabel kebijakan baru); coach yang belum konfirmasi versi terbaru diingatkan di Coach
  Portal; laporan siapa yang belum konfirmasi.

## Urutan pengerjaan

1. **Tahap 1 — inti permintaan client:** A9, A1, A3, A4, A6, C1, C2.
2. **Tahap 2:** B1, B2, B3, A5, A8, D1.
3. **Tahap 3:** A2, A7, B4, B5, C3, C4.

## Acceptance Criteria

- [ ] Coach tidak bisa mengajukan cuti tahunan di bawah minimal pemberitahuan; cuti sakit/darurat tetap bisa diajukan
  dan tercatat sebagai *mendadak*.
- [ ] Coach bisa mengajukan cuti dari Coach Portal dan melihat semua kelas & sesi Personal Training yang terdampak.
- [ ] Hanya user dengan role Program Director (atau approver cadangan) yang bisa menyetujui cuti coach, menunjuk
  pengganti, dan membatalkan kelas.
- [ ] Cuti coach tidak bisa disetujui selama masih ada sesi terdampak tanpa pengganti yang menerima, penunjukan
  langsung, atau pembatalan dengan alasan.
- [ ] Member yang sudah booking menerima WA tepat sekali, berisi link booking, saat coach kelasnya diganti atau kelas
  dibatalkan, dan bisa membatalkan booking tanpa penalti dengan kredit kembali penuh.
- [ ] Coach melihat penanda perhatian khusus member di roster sebelum sesi. Detail medis tidak bisa diambil lewat API
  oleh coach yang tidak memegang sesi, front desk, atau admin.
- [ ] Setiap keluhan punya PIC, kategori, dan batas waktu; keluhan yang lewat batas waktu memicu WA eskalasi.
- [ ] Dashboard menampilkan coach yang belum mengonfirmasi SOP versi terbaru.
- [ ] Tes unit untuk aturan H-N, pemilihan pengganti, dan perhitungan batas waktu tiket; tes integrasi dijalankan di
  `nuhabit_test`, bukan di DB `nuhabit`.

## Automation Log

- 2026-10-21 — Epic dibuat dari permintaan client soal SOP coach (cuti tidak mendadak, keluhan, pelanggan perhatian
  khusus). Audit kode Nuhabit-dev (branch `feat/nuhabit-foundation`) mencatat yang sudah ada vs celah (tabel di atas).
  Prioritas Tahap 1/2/3 disetujui owner proyek; angka H-N, approver, konsekuensi, dan batas waktu keluhan masih menunggu
  keputusan client.
- 2026-10-21 — Keputusan client masuk (9 poin, lihat "Keputusan client"):
  - H-N dikonfigurasi di pengaturan.
  - Approver adalah role Program Director (belum ada di sistem → task baru T-067-A9 masuk Tahap 1).
  - Sanksi memakai kombinasi KPI, potongan insentif, dan SP.
  - Blackout wajib ada.
  - Member mendapat WA dengan link booking, boleh batal tanpa penalti dengan kredit kembali; batas jam dikonfigurasi.
  - Batas waktu keluhan dan daftar penanda mengikuti usulan.
  - Data medis hanya untuk coach.
  - Alur pengganti diserahkan ke best practice: pengganti menerima → Program Director menunjuk → Program Director
    membatalkan dengan alasan.
  - Tafsiran poin 9: front desk/admin hanya melihat ikon "ada penanda medis" tanpa isi.
- 2026-10-21 — **T-067-A9 selesai** (status epic → on-progress).
  - Migrasi `20261021090000_studio_program_director.sql`:
    - role `program_director`;
    - menu `studio.coach-leave` "Cuti & Pengganti Coach" (read/update);
    - grant Program Director (read/update di jadwal, kalender, ketersediaan, Personal Training, check-in; read di
      coach; area karyawan);
    - CHECK `users_role_check` dibangun ulang. Selain `program_director`, CHECK ini juga ditambah employee/sales/marketing:
      ketiganya sudah ada di UI tetapi belum ada di CHECK, jadi memberi role itu ke user gagal di DB dev.
  - Hak memutus cuti ditentukan oleh role, bukan aksi menu:
    - `resolveLeaveApprovers` memakai Program Director yang tidak cuti hari ini; bila tidak ada → approver cadangan
      (`studio.settings` key `leave_backup_approver_user_id`); bila tidak ada juga → hanya Super Admin.
    - Tidak ada yang bisa memutus pengajuannya sendiri.
    - `assertCanDecideCoachLeave` siap dipakai di T-067-A4.
    - "Sedang cuti" = cuti HRIS disetujui atau `coach_time_off` hari ini (WIB).
  - Halaman `/dashboard/studio/coach-leave` + API `/api/studio/coach-leave/settings`.
  - Bukti:
    - 9 unit test (`coach-leave.test.ts`) dan 3 test integrasi (`coach-leave-server.integration.test.ts`, hanya jalan
      di DB `*_test`, fixture dibersihkan) lulus di `nuhabit_test`.
    - Migrasi idempoten dan tidak di-prune oleh seeder `iam-menus.sql`.
    - Smoke test dengan akun uji sementara di `nuhabit_test` (sudah dihapus): Program Director GET/PATCH 200, cadangan
      tidak valid 400, menu komisi 403, halaman 200, tanpa login 401/redirect.
    - `tsc` tanpa error baru (508 error lama sebelum/sesudah); eslint bersih untuk file yang diubah.
    - Belum dicek visual di browser dan belum di-deploy ke nuhabitdev.
- 2026-10-21 — **T-067-A1 selesai.**
  - Aturan H-N per jenis cuti di `studio.settings` key `leave_notice_rules` (per venue coach), diatur di halaman Cuti &
    Pengganti Coach.
    - Default: tahunan & tanpa upah H-7, menikah H-14, melahirkan & haji/umrah H-30.
    - Sakit, darurat, haid, cuti ayah, duka: H-1 dan boleh mendadak.
  - Logika murni `evaluateLeaveNotice` / `normalizeNoticeRules` (`src/lib/studio/coach-leave.ts`), dihitung dari
    tanggal pengajuan WIB.
  - Ditegakkan di `POST /api/hris/leaves`, jalur yang dipakai ESS dan nanti Coach Portal (T-067-A3):
    - **Hanya untuk karyawan yang terhubung ke coach aktif.** Staf non-coach tidak terkena aturan.
    - Di bawah H-N untuk jenis yang tidak boleh mendadak → 400 `LEAVE_NOTICE_TOO_SHORT` dengan tanggal paling cepat.
    - Jenis yang boleh mendadak → diterima dengan `is_short_notice`.
    - **HR yang mencatat untuk coach tidak ditolak, tetapi tetap ditandai mendadak.**
  - Migrasi `20261021100000_hris_leave_short_notice.sql`:
    - kolom `hris.leaves.is_short_notice` dan `notice_days` (dasar KPI T-067-A8);
    - menambah enum `leave_type` `marriage` & `bereavement`. Form ESS sudah menawarkan "Menikah"/"Duka", tetapi
      pengajuannya gagal disimpan di DB dev.
  - Badge "Mendadak" di daftar cuti backoffice & ESS; WA ke atasan diberi baris "Catatan : MENDADAK".
  - Bukti:
    - 18 unit test + 4 test integrasi + test WA lulus di `nuhabit_test`.
    - Smoke API dengan akun uji sementara (sudah dihapus):
      - coach tahunan H-2 → 400;
      - sakit H-0 → 200 mendadak;
      - tahunan H-12 → 200;
      - menikah H-12 → 400, menikah H-26 → 200;
      - staf non-coach H-2 → 200;
      - Program Director ubah tahunan ke H-2 → coach H-2 lolos;
      - nilai di luar 0–90 → 400;
      - coach ubah pengaturan → 403.
    - `tsc` tanpa error baru (508); eslint tanpa error baru (3 error lama di file yang disentuh).
    - Belum dicek visual di browser; belum di-deploy.
- 2026-10-21 — **T-067-A3 selesai.** Tab **Cuti** di Coach Portal (`src/features/studio/components/coach-leave-tab.tsx`):
  - Isi tab:
    - pilih jenis & tanggal;
    - peringatan H-N langsung di form (pakai `evaluateLeaveNotice` + aturan venue coach);
    - daftar sesi terdampak (kelas & Personal Training terjadwal, dengan jumlah member booking) sebelum mengirim;
    - riwayat pengajuan dengan status, badge Mendadak, dan alasan ditolak;
    - batalkan pengajuan yang masih menunggu.
  - Keputusan: **pengajuan memakai `POST /api/hris/leaves` (jalur ESS), bukan endpoint baru.** Aturan H-N, kuota, WA
    ke atasan, dan flag mendadak tetap satu sumber. Akun coach sudah tertaut ke karyawan, jadi `getWorkforceActor` bekerja.
  - API baru (`requireCoach`):
    - `GET /api/coach/leave` — aturan + riwayat;
    - `GET /api/coach/leave/impact?start&end` — maks 62 hari; sesi selesai/batal tidak ikut.
  - Kelas `nh-dark-input` di `globals.css` diperluas ke `select` & `textarea`. Tanpa itu, aturan global input terang
    membuat kolom form di Coach Portal tidak terbaca (terlihat saat cek visual).
  - Bukti:
    - 19 unit test + 6 test integrasi lulus di `nuhabit_test`.
    - Cek visual headless (Playwright, viewport 390 px) dengan coach uji + 4 sesi (sudah dihapus):
      - tahunan 2–5 Nov → "Sesuai SOP", 3 kelas + 1 Personal Training terdampak;
      - tahunan 23 Okt → peringatan H-7 merah & tombol nonaktif;
      - sakit hari ini → terkirim, "Tercatat sebagai cuti mendadak", muncul di riwayat dengan tombol batal;
      - tanpa error console.
    - `tsc` tanpa error baru (508); eslint bersih untuk file baru.
  - Catatan: unggah lampiran (surat dokter) belum ada di Coach Portal, masih lewat Area Karyawan. Belum di-deploy.
- 2026-10-21 — **T-067-A4 selesai.**
  - Migrasi `20261021110000_studio_coach_leave_cover.sql`:
    - tabel `studio.coach_leave_covers`, satu baris per (cuti, sesi terdampak). Status: open → requested (dengan
      `respond_by`) → accepted / assigned / cancel; void bila cuti ditolak/dibatalkan atau sesi tidak lagi terdampak;
    - kolom `class_sessions.original_coach_id`.
  - Logika murni `src/lib/studio/coach-cover.ts`, query & aksi `coach-cover-server.ts`:
    - **Saran pengganti:** coach aktif venue yang tidak bentrok (termasuk dengan permintaan pengganti lain yang masih
      berjalan) dan tidak cuti/time-off. Personal Training hanya coach yang membawakan program itu. Urutan: yang
      membawakan program dulu, lalu beban minggu itu paling ringan.
    - **Batas jawaban:** pengaturan "Batas jawaban calon pengganti" (default 24 jam), tetapi tidak melewati 1 jam
      sebelum sesi mulai. Lewat batas → kembali open (diperiksa saat data dibaca).
  - **Persetujuan cuti coach lewat `POST /api/hris/leaves/approve` yang sama.**
    - Untuk karyawan yang terhubung ke coach, hak memutus = `assertCanDecideCoachLeave` (Program Director / approver
      cadangan / Super Admin), **bukan HRD/atasan lagi**.
    - Approve ditolak 409 selama ada sesi open/requested.
    - Dalam transaksi yang sama: coach sesi diganti (coach asli disimpan) atau sesi dibatalkan. Setelah commit, kredit
      member di sesi batal dikembalikan (`releaseSessionBookings`).
    - Tolak / batalkan cuti → baris pengganti void. Pengganti yang sudah diterapkan tidak dikembalikan otomatis.
  - WA staf (dedup `configuration.wa_notif_log` tipe `coach_cover`), dengan link `/coach?tab=leave`:
    - ke calon pengganti (diminta / ditunjuk);
    - ke peminta (permintaan ditolak);
    - ke approver aktif saat coach mengajukan cuti, judul "CUTI MENDADAK" bila mendadak.
  - UI:
    - **Coach Portal:** status pengganti per sesi + "Pilih pengganti", kartu "Permintaan menggantikan" (Terima/Tolak).
    - **Backoffice:** "Antrean cuti coach" (mendadak paling atas), tunjuk / ganti pengganti, batalkan kelas dengan
      alasan, Setujui (nonaktif sampai semua tertangani) / Tolak.
  - Bukti:
    - 9 unit test + 7 test integrasi alur lengkap di `nuhabit_test`: sinkron, saran, minta → tolak → minta → terima,
      kedaluwarsa, hanya PD yang menunjuk (admin 403), approve 409 lalu terapkan.
    - E2E headless dengan coach Pras/Rara/Budi + PD uji (sudah dihapus): Pras mengajukan & meminta Rara → Rara
      menerima → PD menunjuk Budi untuk Selasa & membatalkan Rabu → Setujui aktif → disetujui. DB: Senin → Rara,
      Selasa → Budi (original Pras), Rabu cancelled; tanpa error console.
    - `tsc` tanpa error baru (508); eslint bersih untuk file baru.
  - Belum:
    - WA ke member saat coach diganti / kelas dibatalkan (T-067-A6);
    - badge jumlah permintaan di tombol tab Cuti;
    - belum di-deploy.
- 2026-10-21 — **T-067-A6 selesai.**
  - Migrasi `20261021120000_studio_session_change_notices.sql`:
    - `member_notifications.kind` + `session_coach_changed`/`session_cancelled`, kolom `session_id`;
    - `class_sessions.coach_changed_at`, `changed_at`, `change_kind`, `change_notice_late`.
  - Pemicu:
    - Persetujuan cuti coach (`finalizeAppliedCovers`): sesi batal diantrekan **sebelum** booking dilepas & kredit
      kembali; sesi yang coach-nya diganti diantrekan langsung.
    - Juga perubahan manual di Kalender/Jadwal (`PATCH /api/studio/sessions/[id]`): ganti coach (coach asli disimpan
      di `original_coach_id`) atau batalkan sesi.
  - Pesan:
    - Bahasa Inggris seperti pesan member lain, dengan link `/member`; dedup per booking (+ coach baru).
    - Penerima: member booked & waitlist.
    - Pesan layanan → **tetap dikirim walau member mematikan pengingat WA**, dan tidak ikut saklar pengingat.
  - Jam tenang:
    - di 08.00–21.00 langsung dikirim;
    - di luar itu ditahan sampai 08.00, **kecuali** kelas mulai kurang dari 3 jam setelah 08.00 (mis. coach sakit
      pukul 05.30 untuk kelas 07.00) → dikirim saat itu juga;
    - yang ditahan dikirim watcher job (`flushChangeNotices` tiap tick);
    - kelas yang sudah mulai → skipped.
  - **Batal gratis:** booking yang dibuat sebelum `coach_changed_at` bisa dibatalkan member sampai kelas mulai dengan
    kredit kembali (`cancelBooking`). Member App menampilkan "Coach changed · free cancel" dan penjelasannya.
  - Pengaturan "Kabar perubahan ke member paling lambat (jam sebelum kelas)", default 12. Di bawahnya perubahan
    ditandai **Terlambat** di laporan baru "Kabar perubahan jadwal ke member" (halaman Cuti & Pengganti Coach).
  - Bukti:
    - 7 unit test + 4 test integrasi (WA di-mock) lulus di `nuhabit_test`. Test integrasi menemukan bug tipe parameter
      SQL di `queueSessionChangeNotices` — sudah diperbaiki.
    - E2E headless (alur A4 + member Maya booking Senin & Rabu, sudah dihapus):
      - setelah disetujui, Maya dapat 1 kabar ganti coach + 1 kabar batal, status pending karena pukul ±22.20 WIB
        (ditahan jam tenang, sesuai aturan);
      - laporan PD menampilkan ketiga perubahan;
      - Member App menampilkan "Coach changed · free cancel" dan catatan batal gratis;
      - tanpa error console.
    - `tsc` tanpa error baru (508); eslint tanpa error baru.
  - Belum di-deploy.
- 2026-10-21 — **T-067-C1 & C2 selesai — Tahap 1 lengkap** (A9, A1, A3, A4, A6, C1, C2).
  - Migrasi `20261021130000_studio_member_flags.sql`:
    - `studio.member_flag_types` (bawaan: Cedera, Kondisi medis, Hamil = medis; Pemula, VIP, Pernah komplain = umum;
      bisa ditambah/nonaktifkan);
    - `studio.member_flags` (tingkat info/perhatian/kritis, catatan ≤ 200, masa berlaku, `removed_at`);
    - menu `studio.member-flags` "Member Perhatian Khusus" (super_admin, admin, direksi, program_director).
  - **Aturan akses medis ditegakkan di SQL** (`member-flags-server.ts`):
    - jalur backoffice tidak pernah men-SELECT baris medis, hanya `medical_count`;
    - backoffice tidak bisa menambah/menghapus penanda medis (403);
    - coach melihat detail medis hanya bila memegang sesi (tidak batal) hari ini/mendatang yang dibooking member itu
      (termasuk pengganti setelah diterapkan), atau dia pembuatnya;
    - mencatat penanda butuh relasi mengajar 30 hari terakhir s/d mendatang.
  - **Tafsiran keputusan client no. 9:** Super Admin/admin pun tidak melihat detail medis. Ini sesuai rancangan epic;
    bila client ingin admin melihat, cukup ubah satu aturan.
  - UI:
    - backoffice `/dashboard/studio/member-flags`: cari member → tambah penanda umum, daftar member dengan penanda
      aktif (medis tampil "n catatan medis · hanya coach"), kelola jenis;
    - Coach Portal: roster sesi menampilkan penanda (ikon medis/umum, warna per tingkat), "+ Catatan", dan hapus.
  - Bukti:
    - 6 unit test + 6 test integrasi akses (Pras sesi besok melihat medis, Rara pembuat melihat, Budi tidak; backoffice
      hanya jumlah & tidak bocor; kedaluwarsa tersembunyi; hapus sesuai hak) lulus di `nuhabit_test`.
    - E2E headless (PD + Coach Pras + 2 member uji, sudah dihapus):
      - PD menandai Maya VIP; form backoffice tidak menawarkan jenis medis;
      - Pras melihat VIP di roster & menambah Cedera kritis;
      - PD melihat "1 catatan medis · hanya coach", dan HTML halaman maupun respons API backoffice tidak memuat
        catatan medis;
      - tanpa error console.
    - `tsc` tanpa error baru (508); eslint tanpa error baru.
  - Belum:
    - penanda di layar Check-in & Booking front desk;
    - pengisian otomatis dari PAR-Q (T-067-C3);
    - belum di-deploy.
- 2026-10-21 23.15 WIB — **Tahap 1 di-deploy ke DEV (https://nuhabitdev.reddie.id)** dari commit `79bd589f`.
  - Backup sebelum migrasi: `~/backups/nuhabitdev/nuhabit-20261021-230556-pre-epic067.sql.gz` (dump lengkap,
    jumlah baris coach/program/sesi/member/pass cocok dengan DB live).
  - Migrasi: 5 delta EPIC-067 (090000–130000) diterapkan ke DB `nuhabit`; tidak ada migrasi lain yang pending.
  - Image: `nuhabitdev:local` baru. Image lama disimpan sebagai `nuhabitdev:pre-epic067` untuk rollback. Container
    dibuat ulang dengan env yang sama persis (6 variabel), `--network host`, volume `nuhabitdev-storage`.
    Cek CSS `color-pink-700:#00281a` OK.
  - Smoke test (hanya baca, super admin):
    - `/login` & `/member` 200; `/coach` & halaman dashboard tanpa login → redirect login;
    - API baru 200 (coach-leave settings/queue/changes, member-flags);
    - halaman Cuti & Pengganti Coach dan Member Perhatian Khusus 200, tampil benar, tanpa error console;
    - regresi 200: studio settings, automation, sessions, coaches, passes, HRIS leaves, kalender, check-in,
      cuti HRIS, manajemen user;
    - container healthy, tanpa error di log.
  - Kondisi data live:
    - **belum ada user ber-role Program Director**, jadi cuti coach sementara hanya bisa diputus Super Admin;
    - 2 coach aktif (Fahmi Syaban, Coach Pras) sudah tertaut karyawan, akun login, dan nomor HP.
  - Catatan: WA Gateway DEV belum terhubung, jadi WA staf/member tercatat gagal kirim, bukan terkirim.
  - Rollback bila perlu:
    1. `docker rm -f nuhabitdev-app`;
    2. jalankan ulang dengan image `nuhabitdev:pre-epic067`;
    3. restore dump di atas — migrasinya hanya menambah, jadi image lama tetap jalan dengan skema baru.
