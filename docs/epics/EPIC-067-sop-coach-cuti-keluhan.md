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
- [x] T-067-A5 **(Tahap 2)** Sinkron cuti HRIS yang disetujui → `studio.coach_time_off` (dengan `leave_id`), dan cek
  bentrok `coach_time_off` terhadap kelas grup saat generate sesi dan saat input manual.
- [x] T-067-A8 **(Tahap 2)** Catatan ketidakhadiran coach (tidak hadir tanpa kabar, cuti mendadak, terlambat) per
  sesi; KPI `leave_request_discipline` memakai ambang H-N; potongan porsi insentif per kejadian di `commission_lines`
  (persentase bisa diatur); SP otomatis diusulkan ke Program Director setelah N kejadian dalam periode (N & periode
  bisa diatur). Ketiganya aktif bersamaan sesuai keputusan client no. 3.
- [x] T-067-A2 **(Tahap 3)** Tanggal blackout cuti (rentang tanggal + alasan) diatur Program Director dan menolak
  pengajuan; pengecualian per pengajuan hanya oleh Program Director dengan alasan.
- [x] T-067-A7 **(Tahap 3)** Reschedule sesi Personal Training (coach/admin/member) tanpa batal-lalu-booking; kredit tetap,
  WA ke pihak lain.

### B. Keluhan pelanggan

- [x] T-067-B1 **(Tahap 2)** Tiket keluhan: sumber (WA/front desk/Member App), kategori Hyrox (coach, kelas,
  fasilitas, cedera, billing, lainnya), prioritas, tautan ke member, coach, sesi, dan percakapan WA. Buat tiket dari
  WA inbox dengan satu klik.
- [x] T-067-B2 **(Tahap 2)** Alur penyelesaian: diterima → ditangani → selesai → dikonfirmasi member; PIC, batas waktu
  respons & selesai per kategori, catatan internal, riwayat status.
- [x] T-067-B3 **(Tahap 2)** Eskalasi aktif: saat batas waktu terlewat, kirim WA ke Head Coach / Ops (pakai jalur
  notifikasi owner yang ada); juga perbaiki SLA watcher WA inbox agar mengirim alert, bukan hanya menandai.
- [x] T-067-B4 **(Tahap 3)** Form "Send feedback / Report an issue" di Member App (bahasa Inggris), opsional terkait
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

- [x] T-067-D1 **(Tahap 2)** Dokumen SOP berversi dengan konfirmasi "Saya sudah membaca dan setuju" per coach
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
- 2026-10-22 — **T-067-B1 selesai** (mulai Tahap 2).
  - Migrasi `20261022090000_studio_complaints.sql`:
    - `studio.complaints`: kode `KEL-YYMM-NNNN` berurutan per bulan WIB (advisory lock per prefix);
    - sumber wa / front_desk / member_app;
    - kategori coach, kelas, fasilitas, cedera, billing, lainnya;
    - prioritas mengikuti WA inbox (low–urgent);
    - tautan member / kontak non-member, coach, sesi, percakapan WA;
    - kolom status, PIC, `respond_by`/`resolve_by`, waktu respons/selesai/konfirmasi sudah disiapkan untuk B2;
    - unik: satu tiket aktif per percakapan WA;
    - `studio.complaint_events` (riwayat);
    - menu `studio.complaints` "Keluhan Pelanggan" (super_admin, admin, direksi, program_director).
  - Batas waktu dihitung saat tiket dibuat dari default keputusan client no. 7: cedera 2 jam / 24 jam, lainnya 24 jam /
    3 hari. Pengaturannya dibuat di B2. Prioritas otomatis: cedera = tinggi.
  - **WA inbox:** tombol "Buat tiket keluhan" di panel komplain, hanya untuk yang punya akses menu Keluhan.
    - Kontak, member, prioritas, dan pesan terakhir diambil dari percakapan; kategori `pembayaran` → billing, sisanya
      Lainnya untuk dipilah.
    - Percakapan ditandai komplain. Bila sudah ada tiket aktif → tampil tautan tiketnya (409 berisi tiket).
  - **Backoffice `/dashboard/studio/complaints`:**
    - daftar (terbuka dulu, prioritas tertinggi dulu) dengan filter status/kategori/cari, tanda "Lewat batas respons";
    - panel detail + riwayat;
    - form front desk: cari member atau isi kontak non-member, tautkan sesi member (30 hari terakhir s/d 7 hari ke
      depan) — coach otomatis mengikuti sesi.
  - Bukti:
    - 7 unit test + 4 test integrasi lulus di `nuhabit_test` (kode berurutan, coach dari sesi, batas waktu cedera,
      tiket dari WA + anti-dobel 409, urutan & filter daftar).
    - E2E headless (admin uji + Maya + percakapan WA, sudah dihapus): satu klik di inbox → `KEL-2610-0001` billing
      tinggi; tiket cedera front desk tertaut sesi → coach otomatis, prioritas tinggi. Tidak ada error dari fitur baru;
      dua 403 `/api/settings/wa-gateway` berasal dari halaman inbox lama untuk role admin.
    - `tsc` tanpa error baru (508); eslint bersih.
  - Belum di-deploy.
- 2026-10-22 — **T-067-B2 selesai.**
  - Alur status (`nextStatuses`/`canTransition`): Diterima → Ditangani → Selesai → Dikonfirmasi member; Batal dari
    Diterima/Ditangani; **Selesai bisa dibuka lagi** bila member belum puas.
    - Selesai wajib catatan penyelesaian; batal & buka lagi wajib alasan.
    - Dijalankan dalam satu transaksi (`FOR UPDATE`) + riwayat.
    - Mulai tangani mengisi `first_response_at` (respons pertama) dan mengambil tiket bila belum ada PIC.
    - Selesai mengisi `resolved_at`, buka lagi mengosongkannya; dikonfirmasi mengisi `confirmed_at`.
  - **PIC:** tunjuk / ganti / lepas (hanya user backoffice aktif); PIC default per kategori di pengaturan, dipasang
    otomatis saat tiket dibuat; filter "Ditugaskan ke saya".
  - **Batas waktu bisa diatur** per kategori (respons & selesai, 1–336 jam, selesai ≥ respons) di `studio.settings`
    `complaint_sla_rules`; berlaku untuk tiket baru. Status SLA di daftar: "Lewat batas respons" (belum ditangani
    melewati batas) / "Lewat batas selesai".
  - Catatan internal sebagai event `note` (tidak dikirim ke member); riwayat menampilkan isi catatan & alasan.
  - Filter default "Belum ditutup" = Diterima, Ditangani, dan Selesai yang menunggu konfirmasi member.
  - Perbaikan B1 (belum pernah di-deploy): `complaint_events.created_at` default `clock_timestamp()` supaya event dalam
    satu transaksi tetap berurutan. Sempat terdeteksi tes yang kadang gagal; kini stabil 3× berturut-turut.
  - Bukti:
    - 10 unit test + 8 test integrasi lulus di `nuhabit_test`.
    - E2E headless (admin uji, sudah dihapus): atur PIC default Billing & respons cedera 1 jam → tiket WA mendapat PIC
      otomatis → Mulai tangani → catatan internal → Tandai selesai (dengan catatan) → Dikonfirmasi member; filter
      "Ditugaskan ke saya" menampilkannya; tanpa error dari fitur baru.
    - `tsc` tanpa error baru (508); eslint bersih.
  - Belum di-deploy.
- 2026-10-22 — **T-067-B3 selesai.**
  - **Eskalasi tiket keluhan** (`escalateOverdueComplaints`, dipanggil watcher job tiap 10 menit):
    - tiket terbuka yang lewat batas respons (belum ditangani) atau batas selesai dieskalasi **sekali per jenis**
      (`respond_escalated_at` / `resolve_escalated_at`, klaim atomik); dua-duanya terlewat → satu pesan jenis "selesai";
    - WA lewat jalur Notifikasi WA owner (jenis baru **"Tiket keluhan lewat batas waktu"** / `eskalasiKomplain`,
      default aktif). Penerimanya nomor Head Coach/Ops yang diisi di Settings → Notifikasi WA;
    - WA langsung ke PIC tiket (nomor karyawan);
    - dicatat sebagai event `escalated` di riwayat, termasuk bila WA tidak terkirim;
    - di luar 08.00–21.00 WIB hanya tiket cedera / prioritas tinggi-mendesak yang langsung dikirim, sisanya ditahan
      sampai pagi.
  - **SLA watcher WA inbox** (EPIC-012) kini juga mengabari: jenis baru **"Chat WA belum dibalas melewati SLA"**
    (`slaInbox`), **satu pesan ringkasan per pengecekan** (maks 10 baris) ke penerima Notifikasi WA owner. Tetap tidak
    pernah mengirim apa pun ke customer, supaya aktivitas nomor bisnis rendah.
  - Refaktor: helper `sendStaffWa` (`src/lib/studio/staff-wa.ts`) dipakai bersama coach-cover & eskalasi. Timeout
    kirim kini mempertahankan klaim (at-most-once), selaras dengan pengirim owner.
  - Kolom eskalasi ditambahkan ke migrasi B1 (belum pernah di-deploy).
  - UI: tanda "Dieskalasi" di daftar & detail; riwayat menampilkan eskalasi; panel pengaturan menautkan Settings →
    Notifikasi WA.
  - Bukti:
    - 4 unit test eskalasi + test pesan SLA;
    - 4 test integrasi eskalasi (WA di-mock: sekali ke owner + PIC, tidak diulang, sudah ditangani → tak dieskalasi,
      dua-duanya terlewat → satu pesan, jam tenang);
    - 1 test integrasi SLA watcher; semua lulus 3× di `nuhabit_test`;
    - cek visual tiket dieskalasi & daftar jenis di Notifikasi WA, tanpa error;
    - `tsc` tanpa error baru (508); eslint bersih.
  - Catatan: `src/lib/dataroom/watermark.test.ts` gagal sejak rebranding NüHabit (`20eaaebb`, 2 Okt) — tidak terkait
    epic ini.
  - Belum di-deploy.
- 2026-10-22 — **T-067-A5 selesai.**
  - Migrasi `20261022100000_studio_time_off_leave_sync.sql`:
    - `coach_time_off.leave_id` (FK `hris.leaves` ON DELETE CASCADE, unik);
    - **backfill** cuti coach yang sudah disetujui dan belum berakhir.
  - **Sinkron:** persetujuan cuti coach (route approve HRIS, di transaksi yang sama dengan penerapan pengganti) membuat
    time-off "Cuti: <jenis>" bertaut cuti. Idempoten. Pembatalan cuti menghapus time-off hasil sinkron saja; time-off
    manual tidak tersentuh.
  - **Cek bentrok kelas grup:**
    - generate jadwal dari template tidak memasang coach yang sedang cuti/time-off. Sesinya dibuat tanpa coach dengan
      catatan "Coach template sedang cuti — tunjuk pengganti", dan pesan hasil menyebut jumlahnya;
    - tambah sesi manual dan ganti coach/tanggal sesi ditolak 409 bila coach sedang cuti/time-off
      (`assertCoachNotOnTimeOff`). Edit lain (mis. kuota) pada sesi lama tetap boleh;
    - input time-off manual memperingatkan kelas grup **dan** Personal Training yang masih terjadwal (sebelumnya hanya
      Personal Training).
  - Slot Personal Training otomatis tertutup selama cuti, karena `pt-server` sudah membaca `coach_time_off`.
  - Bukti:
    - 2 unit test + 3 test integrasi (sinkron idempoten, tolak penjadwalan, batal → hanya time-off sinkron hilang)
      lulus di `nuhabit_test`;
    - smoke API (coach/PD/admin uji, sudah dihapus): ajukan → setujui → time-off; generate 9–13 Nov → sesi Selasa
      tanpa coach + catatan; pasang Pras 409, Rara OK; time-off manual Rara memperingatkan 1 kelas; batalkan cuti →
      time-off hilang;
    - `tsc` tanpa error baru; eslint tanpa error baru.
  - Belum di-deploy.
- 2026-10-22 — **T-067-A8 selesai** (keputusan client no. 3: kombinasi KPI + potongan + SP).
  - Migrasi `20261022110000_studio_coach_discipline.sql`:
    - `studio.coach_incidents`: tidak hadir tanpa kabar / cuti mendadak / terlambat, potongan % snapshot, void
      beralasan, unik per cuti;
    - `studio.coach_warnings`: usulan/terbit/abaikan SP1–SP3, maks satu usulan terbuka per coach;
    - `commission_lines.gross_amount`/`deduction_percent`/`deduction_amount`; baris lama di-backfill
      `gross_amount = amount`.
  - **Aturan (pengaturan, default menunggu konfirmasi client):**
    - potongan per kejadian: tidak hadir 15%, cuti mendadak 5%, terlambat 5%;
    - maks potongan 50%/bulan;
    - usulan SP setelah 3 kejadian dalam 90 hari.
    - SP berlaku 180 hari (level berikutnya dihitung dari SP terbit 180 hari terakhir); kejadian yang sudah masuk SP
      (terbit / diabaikan) tidak dihitung ulang.
  - Cuti mendadak yang disetujui tercatat otomatis (route approve). Tidak hadir/terlambat dicatat Program Director di
    halaman Cuti & Pengganti Coach → "Disiplin coach". Catatan bisa dibatalkan dengan alasan (mis. surat dokter).
  - **Komisi:** `computeCommission` menerima potongan per coach. Baris: kotor → potongan → bersih (amount); potongan
    menjadi sisa pool (revenue perusahaan); persentase pembagian tidak berubah. Pratinjau, persetujuan periode
    (tersimpan), halaman Komisi Coach, dan tab Komisi Coach Portal menampilkan potongannya.
  - **SP:** usulan otomatis + WA ke approver aktif; hanya Program Director (atau cadangan / Super Admin) yang
    menerbitkan; abaikan wajib alasan.
  - **KPI** `leave_request_discipline`: cuti ber-`notice_days` (cuti coach, A1) dinilai tepat waktu bila tidak
    mendadak; lainnya tetap aturan lama "sebelum H". `source_detail` menambah `short_notice_requests`.
  - Bukti:
    - 5 unit test disiplin + 1 unit test potongan komisi;
    - 4 test integrasi (snapshot potongan, cuti mendadak sekali, usulan SP1 + WA, hanya PD memutus, SP2 berikutnya,
      potongan dibatasi & void mengurangi) lulus di `nuhabit_test`;
    - E2E headless (PD + coach uji, sudah dihapus): 2 catatan via API + 1 via form → usulan SP1 → Terbitkan →
      riwayat; tanpa error;
    - `tsc` tanpa error baru; eslint tanpa error baru.
    - Tampilan potongan di halaman Komisi belum dicek visual (butuh revenue bulan berjalan); perhitungannya teruji
      unit.
  - Belum di-deploy.
- 2026-10-22 — **T-067-D1 selesai — Tahap 2 lengkap** (B1, B2, B3, A5, A8, D1).
  - Migrasi `20261022120000_studio_sop.sql`:
    - `studio.sop_documents` / `sop_versions` (setiap terbitan = versi baru, isi tidak diubah setelah terbit) /
      `sop_acknowledgements` (per coach per versi);
    - menu `studio.sop` "SOP Coach" (super_admin, admin, direksi, program_director).
  - **Template SOP coach** (`buildSopCoachTemplate`) disusun dari pengaturan venue yang berlaku sekarang, supaya isi
    dokumen sama dengan perilaku sistem:
    - H-N per jenis cuti, jenis yang boleh mendadak;
    - alur & batas jawaban pengganti, kabar ke member;
    - potongan & ambang SP, batas waktu keluhan per kategori, eskalasi, penanganan cedera;
    - member perhatian khusus & kerahasiaan data medis.
    Tombol "Isi dari template" di editor. Ini menjawab permintaan awal client "Siapkan SOP coach".
  - **Backoffice `/dashboard/studio/sop`:**
    - buat SOP (terbit v1), terbitkan versi baru (wajib ringkasan perubahan → semua coach konfirmasi ulang),
      arsipkan/aktifkan;
    - laporan konfirmasi per coach ("Setuju <waktu>" / "Belum konfirmasi" / "Belum punya akun Coach Portal");
    - riwayat versi;
    - "Kirim pengingat WA" hanya ke coach ber-akun yang belum konfirmasi (dedup per coach/versi/hari).
  - **Coach Portal:** banner "Ada N SOP yang perlu dibaca & dikonfirmasi" di semua tab, ikon SOP di header untuk
    membaca kapan pun, centang "Saya sudah membaca dan setuju" + Konfirmasi. Konfirmasi versi lama ditolak (409).
  - Bukti:
    - 3 unit test template + 4 test integrasi (versi & konfirmasi idempoten, versi baru meminta ulang & versi lama
      ditolak, laporan, pengingat hanya coach ber-akun, arsip) lulus di `nuhabit_test`;
    - E2E headless (PD + coach uji, sudah dihapus): PD membuat SOP dari template → terbit v1 → coach melihat banner,
      membaca, mengonfirmasi → banner hilang → laporan PD menandai coach setuju → PD terbitkan v2 → banner muncul lagi;
      tanpa error;
    - `tsc` tanpa error baru; eslint bersih.
  - Belum di-deploy.
- 2026-10-22 06.30 WIB — **Tahap 2 di-deploy ke DEV (https://nuhabitdev.reddie.id)** dari commit `553785ad`.
  - Backup sebelum migrasi: `~/backups/nuhabitdev/nuhabit-20261022-062455-pre-epic067-t2.sql.gz` (dump lengkap; jumlah
    baris coach/program/sesi/member/pass/penanda cocok dengan DB live).
  - Migrasi: 4 delta (20261022090000 keluhan, 100000 sinkron time-off, 110000 disiplin, 120000 SOP); tidak ada migrasi
    lain yang pending. Backfill tidak menyentuh data (belum ada cuti coach disetujui / baris komisi di live).
  - Image: `nuhabitdev:local` baru. Image Tahap 1 disimpan sebagai `nuhabitdev:pre-epic067-t2` untuk rollback.
    Container dibuat ulang dengan env yang sama persis. Cek CSS `#00281a` OK.
  - Smoke test (hanya baca, super admin):
    - halaman publik & redirect login OK;
    - API baru 200: keluhan & pengaturannya, disiplin, SOP & template, cuti coach, member flags;
    - halaman Keluhan Pelanggan, SOP Coach, Cuti & Pengganti Coach (dengan Disiplin coach), Komisi, Inbox WA,
      Notifikasi WA 200, tampil benar, tanpa error console;
    - komisi Oktober dengan data asli tampil kotor/potongan 0%/bersih;
    - regresi 200: studio settings, automation, sessions, coaches, passes, cuti HRIS, notifikasi WA;
    - container healthy, log bersih.
  - Perlu disiapkan di live supaya fitur berguna:
    1. nomor Head Coach/Ops di Settings → Notifikasi WA (eskalasi keluhan & alert SLA);
    2. role Program Director di Manajemen User;
    3. terbitkan SOP pertama dari template.
    WA Gateway DEV masih belum terhubung (WA tercatat gagal kirim).
  - Rollback:
    1. jalankan ulang container dengan image `nuhabitdev:pre-epic067-t2`;
    2. migrasi hanya menambah, jadi image lama tetap jalan dengan skema baru;
    3. restore dump di atas bila perlu.
- 2026-10-22 — **T-067-A2 selesai** (tanggal blackout cuti coach).
  - Migrasi `20261023090000_studio_coach_leave_blackouts.sql`:
    - tabel `studio.coach_leave_blackouts` (rentang tanggal inklusif + alasan per venue, maks 31 hari);
    - `hris.leaves.blackout_exception_requested`, `blackout_override_reason/_by/_at`.
  - Keputusan desain:
    - **Jenis cuti yang kena blackout** diatur per jenis (kolom "Kena blackout" di tabel minimal pemberitahuan,
      `leave_notice_rules.*.blackout`). Default: Cuti Tahunan, Tanpa Upah, Pernikahan. Sakit, darurat, haid, ayah,
      duka (tidak bisa direncanakan) dan melahirkan, haji/umrah (hak normatif) tidak, kecuali diubah.
    - **Pengajuan coach** yang beririsan ditolak (`LEAVE_BLACKOUT`), kecuali coach mencentang "Minta pengecualian
      ke Program Director" di Coach Portal. ESS menolak dan mengarahkan ke Coach Portal. HR yang mencatat tetap bisa.
    - **Pengecualian per pengajuan** hanya oleh approver cuti coach (Program Director / cadangan / Super Admin)
      dengan alasan minimal 10 karakter (`LEAVE_BLACKOUT_OVERRIDE_REQUIRED`). Blackout dicek ulang saat persetujuan,
      jadi blackout yang dibuat setelah pengajuan juga berlaku.
    - **Cuti yang sudah ada** di rentang blackout baru tidak dibatalkan otomatis; daftarnya ditampilkan ke Program
      Director saat blackout dibuat.
    - Template SOP menyebut jenis cuti yang kena blackout dari pengaturan.
  - UI: seksi "Tanggal blackout cuti" di Cuti & Pengganti Coach (tambah/hapus); pill "Masa blackout" + kolom alasan
    pengecualian di antrean; daftar blackout, peringatan, dan centang pengecualian di tab Cuti Coach Portal; badge
    Blackout + alasan pengecualian di riwayat.
  - Bukti:
    - unit test `blackoutConflicts` (tepi rentang inklusif, jenis yang dikecualikan, pesan) + test integrasi DB
      (konflik per jenis, cuti terdampak dilaporkan, blackout lewat tidak tampil, simpan sebagian kolom, hapus 404)
      lulus di `nuhabit_test`; 410 test studio/HRIS/KPI lulus;
    - E2E headless (PD, coach uji; fixture dihapus): PD tambah blackout → coach ditolak (tombol mati, API paksa 400)
      → minta pengecualian → PD tidak bisa setujui tanpa alasan (UI & API 400) → setujui dengan alasan → coach melihat
      alasan; tanpa error console;
    - `tsc` tetap 508 (baseline), eslint tanpa error baru.
  - Belum di-deploy.
- 2026-10-22 — **T-067-A7 selesai** (reschedule sesi Personal Training tanpa batal-lalu-booking).
  - Migrasi `20261023100000_studio_pt_reschedule.sql`:
    - tabel `studio.pt_reschedules` (riwayat dari → ke, siapa, alasan);
    - `class_sessions.studio_rescheduled_at`;
    - `member_notifications.kind` + `session_rescheduled`, `class_sessions.change_kind` + `rescheduled`.
  - Keputusan desain:
    - **Sesi dipindah di tempat** (tanggal/jam, dan coach bila oleh admin). Booking, kredit pass, check-in, dan komisi
      tetap menempel ke sesi yang sama, jadi kredit tidak berubah dan tidak ada ledger batal/booking baru.
    - **Member** (Member App): hanya ke jam kosong coach yang sama, paling lambat batas batal sebelum jadwal lama,
      maksimal N kali per booking (Aturan Booking `pt_member_reschedule_max`, default 2; 0 = hanya lewat studio).
      Coach dikabari WA.
    - **Coach** (Coach Portal, tombol "Pindah jadwal"): ke jam kosongnya sendiri selama sesi belum mulai. Member dikabari
      WA (dengan alasan bila diisi).
    - **Admin** (Personal Training → Jadwal → "Jadwal ulang"): boleh ganti coach. WA ke member, coach lama ("slot Anda
      kosong"), dan coach baru. Dialog menampilkan riwayat jadwal ulang.
    - Slot dicek dengan aturan booking baru: jam ketersediaan, cuti/time-off, bentrok jadwal coach (sesi itu sendiri
      tidak dihitung), bentrok jadwal member, dan masa berlaku pass.
    - Dipindah coach/admin → member boleh **batal tanpa penalti** sampai sesi mulai (sama dengan coach diganti di A6).
    - WA member lewat antrean A6 (jam tenang, tanda Terlambat, laporan "Kabar perubahan jadwal" dengan label
      Reschedule). Kabar reschedule lama yang belum terkirim dilewati supaya member hanya menerima jadwal terbaru.
      Pengingat H-1 dibuka lagi untuk jadwal baru.
  - Bukti:
    - 7 unit test (`checkReschedule`, batal gratis, pesan member/coach) + 4 test integrasi DB (member, kuota,
      bentrok, masa pass, coach lain 404, coach memindah → antrean WA member, admin ganti coach → WA keluar/masuk,
      riwayat, batal telat tetap kredit kembali) lulus di `nuhabit_test`;
    - E2E headless (member, coach, admin uji; fixture dihapus): member 07:00 → 09:00 → coach ke besoknya 10:00 dengan
      alasan → admin ke Coach Rara 11:00 → member melihat "Moved by studio · free cancel". Ledger tetap 1 `redeem`,
      riwayat 3 baris, 1 kabar pending (yang lama dilewati). Console hanya 404 gambar media fixture lama;
    - `tsc` tetap 508, eslint tanpa error baru. Kegagalan `table-order` (ARK Coin) sudah ada sebelumnya.
  - Belum di-deploy.
- 2026-10-22 — **T-067-B4 selesai** (Send feedback / Report an issue di Member App).
  - Migrasi `20261023110000_studio_complaint_member_feedback.sql`: `studio.complaints.kind` (`complaint` | `feedback`)
    + indeks tiket Member App per member.
  - Keputusan desain:
    - **Halaman "Help & feedback"** (bahasa Inggris), dibuka dari tab Progress ("Send feedback / Report an issue") dan
      menu "Feedback". Dua jenis:
      - *Report an issue* → tiket keluhan biasa (batas waktu & eskalasi per kategori);
      - *Send feedback* → `kind = feedback`, prioritas rendah, tanpa batas waktu, jadi tidak pernah dieskalasi dan
        nanti tidak dihitung di laporan keluhan B5.
    - **Kategori** sama dengan tiket (label Inggris di Member App). **Sesi opsional** hanya dari sesi yang sudah
      diikuti member 30 hari terakhir; coach tiket diambil dari sesi.
    - **Kabar ke staf:**
      - cedera → langsung WA ke penerima Notifikasi WA "eskalasiKomplain" (Head Coach/Ops), kapan pun;
      - keluhan lain → WA ke PIC default kategori, hanya di jam layak;
      - masukan → tanpa WA.
    - **Batas 5 laporan per member per 24 jam** (429) untuk mencegah spam.
    - **Member hanya melihat tiket Member App miliknya**, dengan status ringkas (Received / In progress / Resolved —
      please confirm / Closed). Catatan internal & catatan penyelesaian staf tidak pernah ditampilkan.
    - **Konfirmasi member** menutup alur B2: "Yes, all good" → Dikonfirmasi member; "Not yet" + komentar → dibuka
      lagi (Ditangani), PIC dikabari WA. Riwayat di backoffice menampilkan aktor "Member".
    - Backoffice: badge "Masukan" + filter jenis di Keluhan Pelanggan.
  - Bukti:
    - 3 unit test (status member, prioritas, pesan WA) + 5 test integrasi DB (sesi yang bisa ditautkan, cedera →
      Head Coach/Ops, masukan tanpa batas waktu, PIC default, daftar hanya milik member, batas 24 jam, konfirmasi
      buka lagi/tutup, bukan pemilik 404) lulus di `nuhabit_test`;
    - suite studio/API/HRIS/KPI/CRM/WA: 1022 lulus; 3 gagal `table-order` (ARK Coin) sudah ada sebelumnya;
    - E2E headless (member & admin uji; fixture dihapus): laporan cedera tertaut sesi + masukan coach → admin melihat
      tiket Member App, menandai selesai → member "Not yet" dengan komentar → tiket kembali Ditangani dengan riwayat
      "Member: belum selesai — …"; tanpa error console. Select/textarea memakai `nh-dark-input` supaya terbaca di
      latar gelap;
    - `tsc` tetap 508, eslint tanpa error baru.
  - Belum di-deploy.
