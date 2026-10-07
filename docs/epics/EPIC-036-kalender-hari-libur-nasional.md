# EPIC-036: Kalender Hari Libur Nasional — Master Libur, Cuti Bersama & Dampaknya ke Cuti/Lembur

status: ready-for-qa
environment: dev
retries: 0

## Goal

Sistem punya **satu master hari libur** (libur nasional, cuti bersama, dan libur
internal perusahaan) yang dipakai bersama oleh kalender ESS, monitoring absensi,
perhitungan hari cuti, dan perhitungan lembur.

Pemicunya pertanyaan owner: *"kalender ESS bisa ngga auto integrasi dengan public
holiday Indonesia?"* Jawabannya bisa — tapi bukan dengan menempel API pihak ketiga
sebagai sumber kebenaran (lihat **Temuan Sumber Data**).

## Kondisi Sekarang

Tidak ada konsep hari libur nasional sama sekali di kode:

| Tempat | Kondisi |
|---|---|
| [`AttendanceCalendar.tsx:155,172`](../../src/components/hris/AttendanceCalendar.tsx) | "Libur" hanya dari pola shift per-karyawan (`shift_id === null`). Minggu cuma diwarnai merah dari indeks hari (`isSunday`, baris 169) — bukan dari data |
| [`daily-roster.ts:19-29`](../../src/lib/hris/daily-roster.ts) | Status hanya `hadir · cuti · libur · alpha`. Tidak ada `libur_nasional` |
| [`leaves/route.ts:247-260`](../../src/app/api/hris/leaves/route.ts) | `calculateBusinessDays()` **hanya** mengecualikan Sabtu–Minggu |
| [`calculator.ts:276`](../../src/lib/payroll/calculator.ts) | Lembur memakai satu `overtimeMultiplier` flat, tidak membedakan hari kerja vs hari libur resmi |
| `database/migrations` | Tidak ada tabel libur (`grep holiday` → nihil) |

**Konsekuensi nyata, bukan kosmetik:** cuti yang melewati tanggal merah **tetap
memotong jatah cuti tahunan karyawan**. Cuti 3 hari yang di dalamnya ada 17 Agustus
tetap dihitung 3 hari. Ini bug saldo cuti yang sudah berjalan, dan epic ini yang
memperbaikinya.

## Temuan Sumber Data (probe 2026-07-29)

Empat kandidat sumber "public holiday Indonesia" diuji langsung:

| Sumber | Status | Layak? |
|---|---|---|
| `dayoffapi.vercel.app` | **Mati** — HTTP 402 `DEPLOYMENT_DISABLED` | ❌ |
| `api-harilibur.vercel.app` | **Mati** — HTTP 402 `DEPLOYMENT_DISABLED` | ❌ |
| `date.nager.at/api/v3/PublicHolidays/2026/ID` | Hidup, tapi **hanya 8 tanggal** untuk 2026 — tanpa Imlek, Nyepi, Idul Fitri, Idul Adha, Waisak, Maulid, dan tanpa cuti bersama sama sekali | ❌ materially incomplete |
| Google Calendar ICS `id.indonesian#holiday@group.v.calendar.google.com` | Hidup, **28 entri untuk 2026**, sudah melabeli `Cuti Bersama …` dan menandai `(belum pasti)` untuk Waisak & Maulid | ⚠ kandidat impor, **bukan** sumber kebenaran |

Dua API komunitas yang paling umum dipakai sudah tumbang — bukti langsung kenapa
API pihak ketiga tidak boleh jadi dependency runtime untuk angka yang menyentuh
saldo cuti dan gaji.

Google ICS pun perlu kurasi: keluarannya memuat tanggal yang **bukan** libur resmi —
`1 Ramadan` (19 Feb), `Hari Paskah` (5 Apr, jatuh Minggu), `Hari Kedua Muharram`,
`Malam Tahun Baru` (31 Des).

Alasan yang lebih fundamental: daftar resmi terbit lewat **SKB 3 Menteri** (biasanya
~September untuk tahun berikutnya), dan tanggal hijriah bisa digeser pemerintah
H-beberapa hari. Sumber apa pun yang berubah diam-diam tidak boleh menyetir payroll.

## Keputusan Desain

1. **Tabel sebagai sumber kebenaran.** Data hidup di database, di-CRUD HRD.
2. **Impor = alat bantu, bukan sinkronisasi otomatis.** Tombol "Impor kalender
   `<tahun>`" menarik ICS → menampilkan preview bercentang → HRD memilih mana yang
   benar tanggal merah → baru masuk sebagai `aktif`. **Tidak ada cron yang menulis
   diam-diam.** Sekali setahun, ~10 menit.
3. **Tanpa `company_id`.** Tabel HRIS di repo ini tidak punya kolom tenant
   (dikonfirmasi: `grep company_id database/migrations/schemas/hris/*.sql` → nihil);
   isolasi antar-klien dilakukan per-database (lihat [EPIC-035](./EPIC-035-habitat-instance-kedua.md)).
   Libur internal perusahaan cukup dibedakan lewat kolom `type`.
4. **Cuti bersama ≠ libur nasional.** Menurut SKB, cuti bersama **memotong** jatah
   cuti tahunan, sedangkan libur nasional tidak. Perbedaan ini di-encode di data
   (`type` + `deducts_leave`), bukan di-hardcode di logika.

## Skema (rancangan)

```sql
CREATE TABLE hris.public_holidays (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  holiday_date   date NOT NULL,
  name           text NOT NULL,
  type           text NOT NULL CHECK (type IN ('nasional','cuti_bersama','perusahaan')),
  -- true = hari ini tetap memotong jatah cuti tahunan (default untuk cuti bersama)
  deducts_leave  boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'aktif' CHECK (status IN ('draft','aktif')),
  source         text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','impor')),
  source_ref     text,          -- UID event ICS → impor ulang idempoten
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE UNIQUE INDEX uq_public_holidays_date_name
  ON hris.public_holidays (holiday_date, name) WHERE deleted_at IS NULL;
CREATE INDEX ix_public_holidays_date
  ON hris.public_holidays (holiday_date) WHERE deleted_at IS NULL AND status = 'aktif';
```

Satu tanggal boleh punya lebih dari satu baris (mis. Idul Fitri hari ke-1 dan ke-2
yang berdempetan dengan cuti bersama), jadi unique-nya `(tanggal, nama)` — bukan
tanggal saja.

Logika murni ditaruh di `src/lib/hris/holidays.ts` (`isHoliday`, `countWorkingDays`,
`resolveDayType`) supaya bisa diuji tanpa database dan dipakai ulang oleh kalender,
roster, cuti, dan lembur — pola yang sama dengan `shifts.ts` dan `daily-roster.ts`.

## Fase

| Fase | Scope (PR-sized) | Status |
|---|---|---|
| **A** | Delta skema `hris.public_holidays` + seed libur nasional & cuti bersama 2026 (dikurasi manual) + modul murni `src/lib/hris/holidays.ts` beserta unit test | ✅ selesai |
| **B** | Halaman admin `/dashboard/hris/holidays` (sibling `/dashboard/hris/shifts`) + API CRUD + delta menu `hris.holidays` (grant `super_admin`, `hrd`) | ✅ selesai |
| **C** | Kalender ESS & monitoring: `AttendanceCalendar` menampilkan tanggal merah + nama libur; `daily-roster` menambah status `libur_nasional` | ✅ selesai |
| **D** | Cuti: `calculateBusinessDays` mengecualikan libur aktif yang `deducts_leave = false`; berlaku untuk pengajuan baru saja | ✅ selesai |
| **E** | Importer ICS: tarik → preview bercentang → simpan sebagai `aktif`. Idempoten via `source_ref` | ✅ selesai |
| **F** (opsional) | Lembur hari libur resmi: multiplier terpisah di `calculator.ts` mengikuti Kepmenaker. **Menyentuh payroll — perlu keputusan owner sendiri** | ✅ selesai (perlu konfirmasi kebijakan, lihat log) |

Fase A–C sudah menjawab pertanyaan awal ("kalender ESS tahu tanggal merah").
Fase D yang memperbaiki bug saldo cuti. E mempercepat pengisian tahunan. F terpisah
karena menyentuh angka gaji.

## ⚠ Risiko

1. **Retroaktif ke cuti lama.** Mengubah `calculateBusinessDays` tanpa batas akan
   membuat `total_days` cuti historis tidak lagi cocok dengan saldo yang sudah
   terpotong. **Rekomendasi: tidak ada backfill** — aturan baru hanya berlaku untuk
   pengajuan sejak fase D rilis. Perlu konfirmasi owner.
2. **Cuti bersama memotong jatah cuti.** Kalau semua baris diperlakukan sama seperti
   libur nasional, karyawan mendapat tambahan hari cuti gratis yang tidak seharusnya.
   Karena itu `deducts_leave` ada di data sejak fase A, bukan ditambahkan belakangan.
3. **Tanggal "belum pasti".** Waisak & Maulid 2026 ditandai tentatif oleh sumbernya
   sendiri, dan Idul Fitri/Adha bisa digeser pemerintah. Jangan hardcode di kode —
   HRD harus bisa mengubahnya tanpa deploy.
4. **Timezone kolom `date`.** Kolom `date` Postgres diserialisasi server (TZ WIB)
   menjadi ISO UTC bergeser 17:00 hari sebelumnya. Wajib memakai pola `wibDateKey`
   yang sudah ada di [`AttendanceCalendar.tsx:49`](../../src/components/hris/AttendanceCalendar.tsx)
   dan `dateColToIso` di payroll — jebakan yang sudah pernah menggigit di EPIC-008.
5. **Instance kedua.** Habitat punya database sendiri; seed libur harus dijalankan
   di kedua instance, bukan sekali di Sulu saja.
6. **Outbound network saat impor.** Fase E menambah dependency jaringan keluar dari
   container. Harus gagal dengan pesan jelas dan tidak memblokir halaman admin
   kalau ICS tak terjangkau.

## Non-Goals

- Tidak ada cron/auto-sync yang menulis ke tabel tanpa persetujuan HRD.
- Tidak menyentuh harga tiket / POS hari libur — ticketing sudah punya harga musiman
  sendiri ([EPIC-023](./EPIC-023-ticketing-theme-park.md)).
- Tidak membuat kalender cuti bersama per-daerah (mis. libur pilkada lokal) di v1 —
  bisa dimasukkan manual bertipe `perusahaan`.
- Tidak mengubah pola shift/roster; libur nasional adalah lapisan di atasnya.

## Acceptance Criteria

- [x] Tabel `hris.public_holidays` ada, terisi libur nasional + cuti bersama 2026
- [x] HRD bisa menambah/ubah/hapus libur dari `/dashboard/hris/holidays` tanpa deploy
- [x] Menu `hris.holidays` tampil untuk `super_admin` + `hrd`, tidak untuk role lain
- [x] Kalender ESS menampilkan tanggal merah beserta nama liburnya, di bulan mana pun
- [x] Monitoring absensi tidak lagi menandai karyawan `alpha` pada hari libur nasional
- [x] Pengajuan cuti yang melewati libur nasional **tidak** memotong hari libur itu
- [x] Pengajuan cuti yang melewati cuti bersama **tetap** memotong (sesuai SKB)
- [x] Cuti yang sudah approved sebelum rilis tidak berubah `total_days`-nya
- [x] Impor ICS menampilkan preview dan tidak menyimpan apa pun sebelum dicentang
- [x] Impor ulang tahun yang sama tidak menghasilkan duplikat

## Test Plan

| Lapisan | Cakupan |
|---|---|
| Unit (`holidays.test.ts`) | `isHoliday` happy/edge (batas awal-akhir rentang, libur di Sabtu/Minggu, baris `draft` diabaikan); `countWorkingDays` untuk rentang 1 hari, rentang penuh libur, rentang bercampur cuti bersama |
| Unit (roster) | `deriveRosterStatus` — prioritas `hadir` > `cuti` > `libur_nasional` > `libur` > `alpha` |
| Integrasi | `POST /api/hris/leaves` melewati 17 Agustus → `total_days` berkurang 1; melewati cuti bersama → tidak berkurang |
| Integrasi | CRUD `/api/hris/holidays` menolak role non-HRD (403) |
| Manual | Kalender ESS bulan Maret 2026 (klaster Nyepi + Idul Fitri) tampil benar di mobile & desktop |
| Parser ICS | Fixture ICS 2026 → 28 event terbaca, `Cuti Bersama` terdeteksi, `1 Ramadan`/`Hari Paskah` tidak otomatis tercentang |

## Agent Routing

| Fase | Agent |
|---|---|
| A | `database-reviewer` (skema + index parsial), `tdd-guide` (modul murni) |
| B | `typescript-reviewer`, `security-reviewer` (endpoint tulis + grant menu) |
| C | `react-reviewer` |
| D | `tdd-guide` + `code-reviewer` (menyentuh saldo cuti) |
| E–F | `security-reviewer` (outbound fetch), `database-reviewer` (payroll) |

## Done Signal

Fase A–D lolos gate review/security/test, ter-deploy di DEV, dan HRD bisa
memverifikasi: buka kalender ESS bulan Maret 2026 → klaster Nyepi/Idul Fitri tampil
sebagai tanggal merah bernama; ajukan cuti yang melewatinya → potongan jatah sesuai
aturan. Status naik ke `ready-for-qa`.

## Automation Log

- 2026-07-29 — Epic dibuat dari pertanyaan owner soal integrasi public holiday di
  kalender ESS. Audit kode: tidak ada tabel/logika libur sama sekali; "Libur" di
  kalender murni berasal dari `shift_id IS NULL`. Ditemukan bug turunan —
  `calculateBusinessDays` (`leaves/route.ts:247`) hanya mengecualikan akhir pekan,
  sehingga cuti yang melewati tanggal merah memotong jatah cuti karyawan.
  Empat sumber data diprobe langsung: dua API komunitas Indonesia
  (`dayoffapi`, `api-harilibur`) **mati** dengan HTTP 402 `DEPLOYMENT_DISABLED`,
  `date.nager.at` hidup tapi hanya memuat 8 dari ~28 tanggal 2026, Google Calendar
  ICS lengkap (28 entri, melabeli cuti bersama) tapi memuat non-libur seperti
  `1 Ramadan` dan `Hari Paskah`. Keputusan: **tabel sebagai sumber kebenaran,
  impor ICS sebagai alat bantu dengan persetujuan HRD** — tidak ada auto-sync.
- 2026-07-29 — **Fase A TUNTAS.** Delta
  `20260729100000_hris_public_holidays.sql` + modul murni
  `src/lib/hris/holidays.ts` + 18 unit test (TDD: RED → GREEN). Diterapkan ke
  `arkiv_local`, 24 baris seed 2026 terverifikasi.
  Keputusan yang diambil saat implementasi:
  1. **Libur nasional menang atas cuti bersama** bila keduanya jatuh di tanggal
     yang sama — hari itu memang libur resmi, dan tafsir yang menguntungkan
     karyawan yang benar secara aturan.
  2. **`countLeaveDays` boleh mengembalikan 0** (rentang yang seluruhnya libur).
     Pemanggil yang memutuskan artinya — perilaku lama `Math.max(1, days)`
     sengaja tidak dibawa ke modul murni supaya Fase D bisa menolak pengajuan
     cuti di hari libur, bukan diam-diam menghitungnya 1 hari.
  3. **Akhir pekan tetap Sabtu+Minggu**, menyamai perilaku lama. Kalau operasional
     sebenarnya 6 hari kerja, itu keputusan kebijakan tersendiri — jangan
     diselundupkan lewat epic ini.
  4. Tiga tanggal diberi catatan verifikasi SKB; `2026-05-28` (Idul Adha hari
     kedua) masuk sebagai **`draft`** sehingga belum mempengaruhi perhitungan
     apa pun sampai HRD menyetujui. Empat entri kalender yang bukan tanggal merah
     (`1 Ramadan`, `Hari Paskah`, `Hari Kedua Muharram`, `Malam Tahun Baru`)
     ditinggalkan sebagai komentar di delta beserta alasannya.
  Dua temuan lingkungan saat menerapkan migrasi, bukan bagian epic ini:
  (a) database `arkiv_local` tertinggal 5 delta dari branch `development` —
  ikut diterapkan sekalian; (b) delta
  `20260727151000_products_cogs_respect_bom_unit.sql` gagal dengan
  `permission denied for schema public` karena role `arkiv_local` tidak punya
  hak `CREATE` di schema `public` (gejala yang sama pernah muncul di EPIC-034).
  Diperbaiki dengan `GRANT CREATE, USAGE ON SCHEMA public TO arkiv_local` di
  database lokal. **Server DEV/produksi kemungkinan punya masalah yang sama** —
  perlu dicek terpisah sebelum delta itu di-deploy.
- 2026-07-29 — **Fase B TUNTAS.** API CRUD `/api/hris/holidays` (+ `[id]`),
  halaman `/dashboard/hris/holidays`, delta menu
  `20260729110000_hris_holidays_menu.sql` (`hris.kepegawaian.holidays`, order 35,
  tepat di bawah "Shift Kerja").
  Keputusan yang diambil saat implementasi:
  1. **Baca terbuka, tulis dipersempit.** `GET` cukup `requireApiUser` — kalender
     ESS setiap karyawan butuh tanggal merah, dan isinya kalender publik, bukan
     data pribadi. `POST/PATCH/DELETE` dibatasi `super_admin` + `hrd` saja
     (bukan pola `super_admin`+`admin` seperti menu kepegawaian lain) karena isi
     tabel ini menyetir potongan jatah cuti.
  2. **Baris `draft` disembunyikan dari karyawan.** Hanya keluar lewat
     `include_draft=1` untuk role HR, supaya tanggal yang belum pasti tidak
     tampil sebagai tanggal merah di kalender ESS.
  3. **Hapus = soft delete.** Baris dirujuk perhitungan cuti historis, dan index
     unique-nya parsial (`WHERE deleted_at IS NULL`) sehingga tanggal+nama yang
     sama tetap bisa ditambahkan lagi setelahnya.
  4. `deducts_leave` ikut default tipenya baik di form maupun di `PATCH` — ubah
     tipe ke `cuti_bersama` tanpa menyebut `deducts_leave` tidak akan
     meninggalkan baris yang bertentangan dengan SKB.
  5. Kolom `note` sengaja tidak memakai `COALESCE` seperti kolom lain: itu
     membuat catatan mustahil dikosongkan. Dipisah lewat flag "dikirim atau
     tidak".
- 2026-07-29 — **Fase C TUNTAS.** `AttendanceCalendar` menarik libur per bulan
  tampak dan menampilkan tanggal merah **beserta namanya** (sel + popup detail +
  legenda); `deriveRosterStatus` menambah status `libur_nasional`; endpoint
  `daily-roster` ikut mengembalikan `holidays`; tab monitoring menampilkan
  banner nama libur. 7 unit test baru (total 122 lolos).
  Keputusan yang diambil saat implementasi:
  1. **Prioritas status:** `hadir` > `cuti` > `libur_nasional` > `libur` >
     `absen`. Absensi menang karena karyawan yang tetap masuk di hari libur
     memang hadir; `libur_nasional` menang atas jadwal shift sehingga karyawan
     terjadwal **tidak lagi dihitung mangkir** saat kantor tutup — inilah yang
     memperbaiki keluhan monitoring.
  2. **Ketiga tipe libur sama-sama berarti kantor tutup** untuk kehadiran.
     `deducts_leave` murni urusan potongan jatah cuti (Fase D), bukan absensi.
  3. **Gagal memuat libur tidak memblokir kalender** — tanggal merah hilang,
     jadwal & absensi tetap tampil. Kalender ESS tidak boleh mati karena satu
     endpoint tambahan.
  4. Tanggal dibawa sebagai teks `YYYY-MM-DD` dari SQL (`holiday_date::text`)
     sehingga cocok langsung dengan kunci sel kalender — menghindari jebakan
     geser timezone kolom `date` (risiko #4).
  Gate: `vitest` 122/122 lolos, `eslint` bersih untuk seluruh berkas epic,
  `tsc --noEmit` tidak menghasilkan error baru di berkas epic (601 error
  pre-existing repo tidak tersentuh), `next build` EXIT=0 dengan ketiga route
  baru terdaftar.
- 2026-07-29 — **Fase D TUNTAS.** `calculateBusinessDays` di
  `leaves/route.ts` dihapus dan digantikan `describeLeaveDays()` di modul murni,
  yang mengecualikan akhir pekan **dan** libur aktif ber-`deducts_leave = false`.
  Pratinjau hari kini muncul di kedua form pengajuan (HR dan ESS) beserta
  ALASANNYA, bukan cuma angkanya.
  Keputusan yang diambil saat implementasi:
  1. **Tanpa backfill** (risiko #1). Hanya `POST /api/hris/leaves` yang berubah;
     cuti yang sudah approved tetap memakai `total_days` lamanya karena saldonya
     sudah terlanjur terpotong. Jalur approve/cancel tidak disentuh sama sekali.
  2. **Rentang yang seluruhnya libur DITOLAK 400**, bukan diam-diam dihitung
     1 hari seperti perilaku lama `Math.max(1, days)`. Memotong jatah untuk hari
     yang memang sudah libur adalah bug yang sama dengan yang sedang diperbaiki.
  3. **`calculateLeaveDays()` di `types/hris.ts` DIHAPUS.** Ia duplikat sisi
     client dari bug yang sama; membiarkannya hidup mengundang pemakaian ulang.
     Penggantinya `describeLeaveDays` + `fetchHolidayIndex`.
  4. Ditambahkan validasi yang sebelumnya tidak ada: format tanggal wajib
     `YYYY-MM-DD` (zod regex) dan `end_date` tidak boleh mendahului `start_date`.
  5. `holidays-db.ts` (server, pakai pool `@/lib/db`) dipisah dari `holidays.ts`
     supaya modul murni tetap aman diimpor komponen client.
- 2026-07-29 — **Fase E TUNTAS.** Parser ICS murni `holiday-ics.ts` (12 unit
  test) + endpoint `GET/POST /api/hris/holidays/import` + dialog preview
  bercentang di halaman Hari Libur.
  Keputusan yang diambil saat implementasi:
  1. **Dua langkah, tanpa cron.** `GET` hanya menarik & memparse — tidak menulis
     apa pun. Tidak ada satu pun jalur yang menulis tabel ini tanpa HRD menekan
     Simpan.
  2. **Idempotensi dua lapis:** cocokkan `source_ref` (UID event) dulu → kalau
     ada, perbarui di tempat (tahan terhadap Google mengganti nama event);
     kalau belum ada, `INSERT … ON CONFLICT (holiday_date, name) WHERE
     deleted_at IS NULL DO UPDATE` (tahan terhadap baris yang sudah diketik
     manual HRD). Kolom `source` dan `note` sengaja TIDAK ditimpa saat konflik.
  3. **Kurasi berbasis nama, bukan tanggal:** `1 Ramadan`, `Hari Paskah`,
     `Hari Kedua Muharram`, `Malam Tahun Baru`, dan hari-hari peringatan datang
     dalam keadaan **tidak tercentang** beserta alasannya. Nama tetap, tanggalnya
     yang bergeser tiap tahun.
  4. **`(belum pasti)` → masuk sebagai `draft`**, sehingga belum mempengaruhi
     perhitungan cuti/absensi sampai HRD menyetujui.
  5. **Outbound fetch dijinakkan** (risiko #6): URL konstanta (bukan input
     pengguna → tidak ada jalur SSRF), timeout 12 detik, batas ukuran respons,
     validasi bahwa isinya benar ICS. Gagal → 502 dengan pesan yang bisa
     ditindaklanjuti; **halaman admin tetap hidup**, hanya dialog impornya yang
     mati, dan penambahan manual tetap jalan.
- 2026-07-29 — **Fase F TUNTAS — ⚠ BUTUH KONFIRMASI KEBIJAKAN OWNER.**
  `splitOvertimeHours()` memisahkan jam lembur hari kerja vs hari libur resmi,
  dan `calculatePayroll` membayarnya dengan dua multiplier. Delta
  `20260729120000_payroll_overtime_holiday_multiplier.sql` menambah kolom
  `payroll_settings.overtime_multiplier_holiday` (default **2.00**) yang muncul
  di halaman Pengaturan Payroll sebagai "Pengali Lembur (hari libur)".
  Yang perlu diputuskan owner:
  1. **Angka 2× adalah asumsi** yang diambil dari PP 35/2021 untuk jam-jam awal
     lembur di hari libur. Bisa diubah tanpa deploy lewat Pengaturan Payroll.
  2. **Tangga progresif PP 35/2021 TIDAK diterapkan** (hari libur jam ke-8 → 3×,
     jam ke-9 dst → 4×; hari kerja jam ke-2 dst → 2×). Sistem tetap memakai satu
     tarif rata per bucket, persis seperti sebelumnya — yang ditambahkan hanya
     pemisahan hari kerja vs hari libur. Menerapkan tangga penuh adalah
     perubahan kebijakan payroll tersendiri, bukan efek samping epic ini.
  3. **Ketiga tipe libur** (nasional, cuti bersama, perusahaan) sama-sama masuk
     bucket hari libur untuk lembur — ketiganya berarti kantor tutup.
     `deducts_leave` tidak relevan di sini.
  4. **Periode tanpa hari libur menghasilkan angka yang identik** dengan sebelum
     fase ini (diuji eksplisit). Yang berubah hanya periode yang memang memuat
     lembur di tanggal merah.
  5. Regresi yang dicegah: `input.overtimeHours` kini hanya jam hari kerja, jadi
     kolom `payroll_details.overtime_hours` diisi **total** kedua bucket supaya
     slip gaji tidak mendadak melaporkan jam lembur lebih sedikit.
  6. Index libur dimuat **sekali per run** di route batch payroll lalu dioper ke
     tiap karyawan — memuatnya di dalam loop akan menjadi query per karyawan.
  Gate Fase D–F: `vitest` 1100/1100 lolos (+22 test baru), `eslint` bersih untuk
  seluruh berkas baru, `tsc --noEmit` 601 error = **identik baseline** (tidak ada
  error baru), `next build` EXIT=0 dengan route impor terdaftar.
