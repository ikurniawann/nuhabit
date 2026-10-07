# EPIC-031: Ticketing — Kuota Harian, Kapasitas & Timed-Entry

status: ready-for-qa
environment: dev
retries: 0

## Goal

Menutup gap benchmark #2 vs accesso (lihat
[`BENCHMARK-ticketing-vs-accesso.md`](./BENCHMARK-ticketing-vs-accesso.md)):
venue bisa menetapkan **kuota pengunjung per tanggal** (dan nanti per slot
waktu), booking online berhenti otomatis saat penuh (**sold-out otomatis** di
kalender wizard), dan ops bisa melihat okupansi per tanggal. Menggantikan rem
manual satu-satunya saat ini: `blok-online` per rentang tanggal.

Konteks historis: kuota harian **sengaja di-defer** saat EPIC-023 Fase D1
(komentar migrasi `20260722130000`: "Kuota harian TIDAK ikut MVP (keputusan
2026-07-22); blok-online per tanggal (R1) adalah rem manualnya"). Epic ini
adalah pelunasan defer tersebut.

## Evidence — titik sambung sistem existing (audit 2026-07-25)

- **Skema kalender per produk**: `ticketing.ticket_product_dates` — date_kind
  `high-season` | `blok-online` (+ `blackout` dipakai season pass EPIC-028).
  Rentang tanggal + label + is_active. **Tidak ada kolom kapasitas/slot.**
- **Header booking**: `ticket_bookings` (visit_date, status
  `menunggu-bayar|terbayar|digunakan|kedaluwarsa|dibatalkan` + `hangus`
  EPIC-023 lanjutan). Index **`idx_ticket_bookings_venue_date`
  (branch_id, visit_date, status)** sudah ada — siap untuk hitung okupansi.
- **Hitungan per ORANG sudah ada**: `ticket_booking_guests` = 1 baris per
  orang (paket meledak per anggota); `totalQty` di create route dihitung
  per orang (`persons_per_unit`). Kuota harus konsisten pakai basis ini.
- **Jalur create booking**: `POST /api/public/booking/[slug]`
  (`src/app/api/public/booking/[slug]/route.ts`) — harga & kelayakan
  dihitung ulang server-side dari `buildPublicCatalog()`
  (`src/lib/ticketing/booking-server.ts`), insert dalam `withTransaction`.
  Titik enforcement kuota = di dalam transaksi ini.
- **Pelepasan kuota otomatis sudah ada jalurnya**: lazy expiry
  (`expireBookingIfDue`), webhook EXPIRED → `kedaluwarsa`, pembatalan
  dashboard → `dibatalkan`, penghangus 3 lapis (`booking-forfeit-watcher`).
  Status-status ini tinggal dikecualikan dari hitungan okupansi — **tidak
  perlu mekanisme release terpisah**.
- **Config per venue**: `ticket_settings` (re_entry_policy, credit limit,
  booking_slug) — anchor natural untuk kapasitas default venue.
- **UI kalender wizard**: `booking-calendar.tsx` (custom inline, redesign
  Airbnb 23 Jul) — tinggal diberi state disabled/sold-out per tanggal.
- **Pengaturan Tiket**: `/dashboard/ticketing/settings` — tempat UI kuota.
- **Loket walk-in**: `ticket_visits` TIDAK punya konsep visit_date kuota
  (kontrol fisik di gate) — lihat Keputusan Desain #3.

## Keputusan Desain (dikunci owner 2026-07-25 — lihat Automation Log)

1. **Model kuota MVP = venue-wide per tanggal** (kapasitas taman), bukan per
   produk — **DIKONFIRMASI owner**. Default venue di
   `ticket_settings.daily_capacity` (**NULL = unlimited** → perilaku
   sekarang, nol regresi; keputusan owner: memang ada venue/stok yang
   unlimited), override per rentang tanggal di tabel baru (pola sama dengan
   `ticket_product_dates`: start/end + label, mis. "Lebaran 5.000/hari").
   Kuota per produk/event = fase lanjut.
2. **Kuota dikonsumsi per ORANG oleh booking online** dengan status yang
   "memegang" kursi: `menunggu-bayar` (reservasi sementara — otomatis lepas
   saat kedaluwarsa invoice Xendit, jalur expiry existing), `terbayar`,
   `digunakan`. Status `kedaluwarsa|dibatalkan|hangus` tidak dihitung.
   Ini sekaligus = fitur **reservasi**: seat tertahan selama menunggu bayar.
3. **Walk-in loket IKUT mengurangi kuota** — **KEPUTUSAN OWNER 25 Jul**
   (mengubah usulan awal). Rincian:
   - 1 orang walk-in = 1 gelang terdaftar di visit (`ticket_visit_bands`);
     tanggal = `opened_at` dalam WIB. Visit `void` tidak dihitung; gelang
     dilepas/hilang tetap dihitung (orangnya sudah masuk).
   - **Anti dobel-hitung redeem**: visit hasil redeem booking
     (`ticket_bookings.visit_id` menunjuk visit itu) DIKECUALIKAN dari
     hitungan walk-in — orangnya sudah dihitung sebagai booking.
   - Loket saat kuota penuh: registrasi visit/tambah gelang **ditolak**
     dengan pesan jelas (enforcement server, bukan cuma UI). Override
     supervisor = tidak ada di MVP (fail-closed, konsisten gate).
   - Entry season pass (EPIC-028, `ticket_pass_entries`) BELUM dihitung di
     MVP — dicatat sebagai fase lanjut (lihat Open Questions).
4. **Anti-oversell: hitung ulang di bawah kunci, bukan counter.** Di dalam
   `withTransaction` (create booking DAN create visit/tambah gelang loket):
   `pg_advisory_xact_lock` per (branch_id, tanggal) → `COUNT` orang live
   dari bookings+guests dan visits+bands (index venue_date sudah ada) →
   tolak bila `terpakai + qty > kapasitas`. Konsisten dengan filosofi
   codebase ("jangan percaya state — hitung ulang"); counter reserved_count
   ditolak karena rawan drift dengan banyak jalur pelepasan status.
5. **Kapasitas boleh diturunkan di bawah okupansi berjalan** — booking
   existing tidak dibatalkan, hanya transaksi baru tertolak; UI pengaturan
   menampilkan peringatan bila okupansi > kapasitas baru.
6. **Timed-entry slot = fase terpisah di epic yang sama** (Fase D), di atas
   fondasi kuota harian — bukan digabung, supaya kuota harian bisa rilis
   duluan (pola horizontal EPIC-027).
7. **Publik hanya melihat penuh/tersedia** — **KEPUTUSAN OWNER 25 Jul**:
   tidak ada angka sisa kuota / badge "tersisa N" di halaman booking publik.
   Angka detail (booked/capacity) hanya di dashboard ops (Fase C).

## Fase

### Fase A — Skema + pengaturan kuota

| Task group | Scope (PR-sized) |
|---|---|
| **A1 Skema** | Migrasi: `ticket_settings.daily_capacity int NULL CHECK (>0)`; tabel baru `ticketing.ticket_capacity_dates` (company/branch, label, start_date, end_date, capacity int CHECK (>=0; 0 = tutup online), is_active, audit; CHECK end>=start; index (branch_id, start_date, end_date)). Capacity 0 = tanggal tutup penjualan online (superset blok-online venue-wide). |
| **A2 Resolver murni + test** | `src/lib/ticketing/capacity.ts`: `resolveDailyCapacity(date, settings, overrides)` — override menang atas default, overlap → capacity TERKECIL menang (konservatif; beda dari high-season). Unit test pola `pricing.test.ts`. |
| **A3 UI Pengaturan** | Seksi "Kapasitas Harian" di `/dashboard/ticketing/settings`: input default venue + CRUD rentang override (pola UI kalender high-season existing); peringatan bila okupansi tanggal berjalan > kapasitas baru. API `GET/PUT /api/ticketing/settings` diperluas + endpoint CRUD capacity-dates. |

### Fase B — Enforcement (online + loket) + sold-out di booking publik

| Task group | Scope (PR-sized) |
|---|---|
| **B1 Helper hitung + enforcement online** | Helper server `countCapacityUsed(branch, date)` (di `capacity` lib server): SUM guests booking status memegang-kuota + SUM gelang visit walk-in hari itu (WIB, exclude void & visit hasil redeem via `ticket_bookings.visit_id`). Dipakai di `POST /api/public/booking/[slug]` dalam transaksi: advisory lock (branch, visit_date) → hitung → `409` "kuota tanggal ini sudah penuh" bila melebihi. |
| **B2 Enforcement loket (walk-in)** | Enforcement yang sama di jalur loket: `POST /api/ticketing/visits` (registrasi visit + gelang) dan endpoint tambah gelang ke visit berjalan — advisory lock (branch, hari ini WIB) → hitung → tolak dengan pesan jelas bila `terpakai + jumlah gelang baru > kapasitas`. Redeem booking TIDAK kena cek ini (kuota sudah dipegang bookingnya). |
| **B3 Availability API** | `GET /api/public/booking/[slug]/availability?from&to` (maks 92 hari, pola reports): per tanggal → `{status: available\|sold_out\|closed}` — **tanpa angka sisa** (keputusan owner #7). 1 query agregat GROUP BY tanggal, BUKAN N+1. Rate-limit publik pola catalog. |
| **B4 Wizard sold-out** | `booking-calendar.tsx`: konsumsi availability → tanggal sold_out/closed disabled + label "Penuh"; guard langkah ringkasan re-check sebelum submit (pesan ramah bila keburu penuh). Tanpa badge angka sisa. |

### Fase C — Ops & visibilitas

| Task group | Scope (PR-sized) |
|---|---|
| **C1 Kalender okupansi** | Halaman/panel di dashboard Booking (`/dashboard/ticketing/booking`): kalender bulanan okupansi per tanggal (booked/capacity, %; warna); drill-down ke daftar booking tanggal itu (filter existing). |
| **C2 Laporan** | Kartu okupansi di `/dashboard/ticketing/reports` (rata-rata okupansi, tanggal penuh, potensi hilang saat sold-out) — pola net-void tidak relevan di sini (basis = bookings, bukan ledger). |

### Fase D — Timed-entry slot (lanjut, boleh rilis terpisah)

| Task group | Scope (PR-sized) |
|---|---|
| **D1 Skema slot** | `ticket_time_slots` (template per venue: label, start_time, end_time, capacity, is_active) + `ticket_bookings.slot_id NULL` (NULL = tiket sepanjang hari — backward compatible). Kuota slot ⊂ kuota harian. |
| **D2 Wizard + enforcement** | Langkah pilih jam di wizard (hanya bila venue punya slot aktif); enforcement pola B1 per (date, slot); availability per slot. |
| **D3 Gate window** | `gate/tap` & redeem loket validasi jam slot (grace period configurable, mis. ±30 menit; di luar → denied dengan alasan jelas, override supervisor = keputusan owner). |

**Dependensi:** A1 → A2 → A3; B setelah A2 (B1 → B2 & B3 paralel → B4);
C setelah B1; D setelah B stabil. Rilis bisa bertahap: A+B saja sudah menutup
"kuota harian + sold-out otomatis" untuk online sekaligus walk-in.

## Non-Goals (epic ini)

- Dynamic/demand-based pricing (gap #5 — epic terpisah).
- Kuota per produk/varian (fase lanjut bila ada kebutuhan event khusus).
- Hitung entry season pass ke kuota (fase lanjut — lihat Open Questions).
- Reserved seating peta kursi (gap #10), virtual queuing (gap #3).
- Waitlist / notifikasi "tanggal kembali tersedia".
- Override supervisor saat loket penuh (fail-closed di MVP).

## Acceptance Criteria

- [ ] Venue tanpa `daily_capacity` & tanpa override (= **unlimited**,
      keputusan owner) → perilaku identik sekarang (nol regresi; katalog,
      harga, blok-online, loket tetap).
- [ ] Booking online ditolak 409 saat orang terpakai + qty > kapasitas
      tanggal itu; dua booking bersamaan tidak bisa oversell (uji race:
      advisory lock terbukti serialisasi per tanggal).
- [ ] **Walk-in loket** ditolak (registrasi visit / tambah gelang) saat
      kapasitas hari ini penuh; walk-in yang masuk mengurangi sisa kuota
      online tanggal yang sama.
- [ ] **Tidak ada dobel hitung**: booking di-redeem jadi visit → total
      terpakai tanggal itu TIDAK bertambah (visit ber-`visit_id` booking
      dikecualikan dari hitungan walk-in).
- [ ] Booking `kedaluwarsa`/`dibatalkan`/`hangus` dan visit `void` otomatis
      melepas kuota (tanpa aksi tambahan — hilang dari hitungan).
- [ ] Kalender wizard menandai Penuh/closed (disabled) — **tanpa angka
      sisa** di publik; submit saat keburu penuh → pesan ramah, bukan 500.
- [ ] Override rentang tanggal menang atas default venue; overlap → kapasitas
      terkecil; capacity 0 menutup penjualan online + walk-in tanggal itu.
- [ ] Kalender okupansi dashboard menampilkan (booking + walk-in)/capacity
      per tanggal sesuai data.
- [ ] (Fase D) Booking ber-slot ditolak di gate di luar jendela slot+grace;
      booking tanpa slot tetap berlaku sepanjang hari.

## Test Plan

- **Unit** (`capacity.test.ts`): resolver default/override/overlap/0/NULL
  (unlimited); formula hitung: status memegang-kuota vs melepas, exclude
  visit redeem & void.
- **Integration/SQL smoke** (pola rollback EPIC-023): create booking sampai
  penuh → 409; walk-in saat penuh → ditolak; expiry → kuota terbuka lagi;
  redeem booking → hitungan tetap; race 2 transaksi paralel (online vs
  online, online vs loket).
- **API**: availability agregat konsisten dengan daftar booking + visits;
  rate limit.
- **UI**: wizard tanggal penuh disabled tanpa angka; loket pesan penuh;
  settings warning okupansi > kapasitas baru.
- **E2E happy path**: set kapasitas 3 → booking online 2 orang → walk-in 1
  → tanggal Penuh di kalender & loket tolak orang ke-4 → void visit →
  tersedia lagi.

## Open Questions (terjawab 2026-07-25, sisa yang terbuka di bawah)

1. ~~Venue-wide atau per produk?~~ → **Venue-wide dulu** (owner).
2. ~~Walk-in ikut mengurangi kuota?~~ → **Ya, dihitung** (owner; usulan awal
   "tidak" dibatalkan).
3. ~~Angka sisa ke publik?~~ → **Cukup penuh/tersedia**, tanpa angka; dan
   harus support venue/stok **unlimited** (daily_capacity NULL) (owner).
4. ~~Ambang "limited"~~ → gugur (tidak ada badge angka/limited di publik).
5. ~~Fase D langsung atau tunggu?~~ → **Langsung digarap** (owner 25 Jul,
   "push dulu langsung fase D") — SELESAI hari yang sama.
6. **MASIH TERBUKA** (muncul dari keputusan #2): entry **season pass**
   (EPIC-028) ikut dihitung ke kuota harian? MVP: tidak — pass holder tak
   lewat loket/booking. Kalau taman sering penuh oleh pass holder, perlu
   fase lanjut hitung `ticket_pass_entries` granted.

## Halaman & Endpoint Baru (Fase A–D)

Halaman (dev: `sulu.within.ventures` / `127.0.0.1:3459`; slug booking = `sulu`):

| Link | Baru/berubah | Fase |
|---|---|---|
| `/dashboard/ticketing/settings` | Seksi BARU **Kapasitas Harian** + **Slot Waktu (Timed-Entry)** | A3, D |
| `/dashboard/ticketing/booking` | Panel BARU **Okupansi Harian** (kalender bulanan, klik = filter) | C1 |
| `/dashboard/ticketing/reports` | Kartu BARU **Okupansi Kuota Harian** (muncul bila ada kuota) | C2 |
| `/booking/sulu` | Kalender mencoret tanggal penuh/tutup + langkah BARU **Jam kunjungan** (bila venue ber-slot) | B4, D |

Endpoint API baru:

| Endpoint | Akses | Fase |
|---|---|---|
| `GET/POST /api/ticketing/capacity-dates` · `PATCH/DELETE .../[id]` | super_admin | A3 |
| `GET /api/public/booking/[slug]/availability?from&to` | publik | B3 |
| `GET /api/ticketing/occupancy?from&to` | operator | C |
| `GET/POST /api/ticketing/time-slots` · `PATCH/DELETE .../[id]` | super_admin | D |
| `GET /api/public/booking/[slug]/slots?date=` | publik | D |
| `PUT /api/ticketing/settings` | +field `daily_capacity`, `slot_grace_minutes` | A3, D |

## QA Checklist (step-by-step)

Prasyarat: login **super_admin** venue SULU di dev; mulai dari keadaan
kuota MATI (Kapasitas Default kosong, tanpa override, tanpa slot).

**A. Pengaturan kapasitas** (`/dashboard/ticketing/settings`)
1. Seksi Kapasitas Harian tampil; default kosong = teks "Kuota BELUM aktif".
2. Isi default (mis. 5) → Simpan → teks berubah "Maksimum 5 orang/hari".
3. Tambah override rentang tanggal (label + tanggal + kapasitas) → muncul
   di daftar ber-badge angka; kapasitas **0** → badge merah **Tutup**.
4. Validasi: tanggal akhir < mulai → pesan merah, tombol mati.
5. Toggle nonaktif & hapus override → hilang dari perhitungan.

**B. Sold-out booking online** (`/booking/sulu`)
6. Set kapasitas kecil (mis. 2). Booking 2 orang → bayar (Xendit MOCK).
7. Buka ulang wizard → tanggal tsb **dicoret** di kalender + legend
   "Tanggal dicoret sudah penuh"; memilihnya → notice merah, **Lanjut mati**.
8. Race: 2 tab, isi form sama-sama saat sisa 1 kursi → submit hampir
   bersamaan → tepat 1 sukses, 1 dapat pesan "Kuota tanggal ini sudah
   penuh" (bukan error 500).
9. Batalkan booking di `/dashboard/ticketing/booking` → tanggal tersedia
   lagi (kuota lepas otomatis; juga berlaku bila invoice kedaluwarsa).
10. Override kapasitas 0 → tanggal dicoret; paksa POST → "Tanggal ini
    ditutup untuk kunjungan".

**C. Walk-in loket ikut kuota** (`/dashboard/ticketing/loket`)
11. Sisa kuota 1 → registrasi visit 2 gelang → DITOLAK "kuota penuh";
    1 gelang → sukses; setelah itu booking online tanggal ini penuh.
12. Redeem booking terbayar jadi visit → angka okupansi TIDAK bertambah
    (anti dobel-hitung — cek panel Okupansi sebelum/sesudah).
13. Void visit → kuota lepas lagi.

**D. Visibilitas ops**
14. `/dashboard/ticketing/booking` panel Okupansi: angka `terpakai/kap`,
    warna hijau→amber(≥70%)→merah(penuh)/abu(tutup); klik tanggal →
    daftar booking terfilter; navigasi bulan jalan.
15. `/dashboard/ticketing/reports`: kartu Okupansi muncul (avg %, hari
    penuh/tutup); venue tanpa kuota → kartu TIDAK muncul.
16. Pengaturan: ketik kapasitas default DI BAWAH okupansi tertinggi 90
    hari ke depan → warning amber menyebut tanggal & jumlah orang.

**E. Timed-entry slot** (`/dashboard/ticketing/settings` + `/booking/sulu`)
17. Tambah 2 slot (mis. "Sesi Pagi" 08:00–12:00 kuota 2; "Sesi Sore"
    13:00–17:00 tanpa kuota); validasi jam selesai ≤ mulai ditolak.
18. Wizard kini menampilkan langkah **Jam kunjungan**; tanpa memilih →
    Lanjut mati; pilih slot → ringkasan menampilkan jam.
19. Habiskan kuota Sesi Pagi (2 orang) → pill-nya dicoret "Penuh";
    booking ketiga ke slot itu (paksa via tab lama) → 409 "Slot ... sudah
    penuh"; Sesi Sore tetap bisa.
20. **Redeem jam**: set grace 0 → redeem booking ber-slot DI LUAR jam
    slot → ditolak dengan pesan jam & toleransi; dalam jam → sukses.
    Kembalikan grace 30 setelah uji.
21. Nonaktifkan semua slot → wizard kembali tanpa langkah jam; booking
    lama ber-slot tetap menyimpan jamnya (snapshot).

**F. Regresi (paling penting)**
22. Matikan semua: kapasitas default kosong + tanpa override + tanpa slot
    → seluruh alur (booking online, loket, redeem, gate, laporan) harus
    berperilaku PERSIS seperti sebelum epic ini.

**Known limitation (bukan bug):** halaman status publik `/booking/status/
[token]` & pesan WA belum menampilkan jam slot — pengunjung melihat jamnya
di ringkasan saat memesan. Kandidat polish bila owner minta.

## Automation Log

- 2026-07-25 — Epic dibuat dari gap benchmark #2 (accesso timed-entry &
  capacity). Audit titik sambung selesai: enforcement di transaksi create
  booking publik; pelepasan kuota menumpang jalur status existing (lazy
  expiry/webhook/hangus); hitung-di-bawah-kunci dipilih atas counter.
- 2026-07-25 — Owner menjawab open questions: (1) venue-wide dulu,
  (2) **walk-in DIHITUNG** (revisi desain: enforcement juga di loket
  `POST /visits` + tambah gelang, anti dobel-hitung visit redeem via
  `ticket_bookings.visit_id`, fail-closed tanpa override supervisor),
  (3) publik cukup penuh/tersedia tanpa angka + wajib support unlimited
  (daily_capacity NULL). Fase B dipecah B1–B4. Status → **on-progress**;
  siap mulai Fase A1.
- 2026-07-25 — **A1 SELESAI**: migrasi `20260725180000_ticketing_daily_capacity.sql`
  applied di dev — `ticket_settings.daily_capacity int NULL` (CHECK NULL/>0)
  + tabel `ticketing.ticket_capacity_dates` (label, start/end, capacity
  CHECK >=0, is_active, audit; index partial venue+range WHERE is_active).
  Verifikasi DB: kolom/tabel/index ada, kedua CHECK menolak nilai invalid.
- 2026-07-25 — **A2 SELESAI** (TDD red→green): `src/lib/ticketing/capacity.ts`
  — `resolveDailyCapacity` (override menang atas default, overlap → TERKECIL,
  0 = tutup, non-aktif diabaikan, tanggal invalid throw; reuse
  `isValidCalendarDate` pricing), `isCapacityExceeded` (null = unlimited
  tak pernah melebihi), konstanta `CAPACITY_HOLDING_BOOKING_STATUSES`
  (menunggu-bayar|terbayar|digunakan). 16 unit test `capacity.test.ts`
  hijau; regresi lib ticketing 87/87 hijau; nol error TS baru.
- 2026-07-25 — **A3 SELESAI (Fase A TUNTAS), live dev**: seksi "Kapasitas
  Harian" di Pengaturan Tiket (`capacity-section.tsx`, terpasang di
  `ticketing-settings-page.tsx`) — input default venue (kosong = unlimited)
  + CRUD override rentang tanggal (label/start/end/capacity, 0 = badge
  Tutup, toggle aktif, hapus). API: `GET/PUT /api/ticketing/settings`
  diperluas `daily_capacity` (partial update aman — kolom lain tak
  tersentuh); route baru `GET/POST /api/ticketing/capacity-dates` +
  `PATCH/DELETE /api/ticketing/capacity-dates/[id]` (super_admin via
  requireTicketingContext default; PATCH validasi rentang pakai nilai FINAL
  gabungan lama+patch; hard delete sah — baris murni konfigurasi). Feature
  layer masters: types/api/queries + query key `capacityDates`. CATATAN:
  peringatan "okupansi > kapasitas baru" versi LIVE ditunda ke Fase C
  (butuh `countCapacityUsed` B1) — A3 pakai teks statis penjelas
  konsekuensi. Verifikasi: tsc bersih di file tersentuh, 87 test hijau,
  build OK (BUILD_ID ada) → pm2 restart, smoke 307/401 normal, kedua route
  muncul di manifest build.
- 2026-07-25 — **Fase A di-commit** (69210aec feat; fac1bd10 docs EPIC-030+
  benchmark+registry). Baris registry EPIC-029 sengaja TIDAK ikut
  (kode EPIC-029 milik sesi lain masih uncommitted — patch parsial README).
- 2026-07-25 — **B1 SELESAI, live dev**: `src/lib/ticketing/capacity-server.ts`
  — `acquireCapacityLock` (pg_advisory_xact_lock hashtext(branch)+
  hashtext(date)), `loadEffectiveCapacity` (settings + override aktif →
  resolver murni), `countCapacityUsed` (1 query 2 subcount: guest booking
  status memegang-kuota + gelang visit non-void hari itu WIB dengan NOT
  EXISTS bookings.visit_id = anti dobel-hitung redeem),
  `assertCapacityAvailable` (cek murah tanpa lock bila unlimited → lock →
  resolve ULANG → hitung → `CapacityFullError` 409; pesan beda utk
  capacity 0 "tanggal ditutup"). Wiring `POST /api/public/booking/[slug]`:
  guard di AWAL withTransaction (sebelum insert, kompatibel retry 23505);
  catch route kini menerjemahkan statusCode → 409 (pola staff-passes).
  Verifikasi: tsc bersih; smoke SQL rollback 7 asersi OK (pending memegang
  kuota, walk-in terhitung, redeem TIDAK dobel, kedaluwarsa/void melepas,
  override terkecil menang); RACE test riil 2 transaksi paralel kapasitas 1
  → tepat 1 LOLOS 1 PENUH (advisory lock terbukti serialisasi), cleanup 0
  sisa. Build OK → pm2 restart, /booking/sulu 200. CATATAN penemuan: dev DB
  ternyata TIDAK punya ticket_types & registry gelang kosong — visit_bands
  kini ber-`variant_id` (revisi R1), smoke pakai gelang temp in-txn.
- 2026-07-25 — **B2 SELESAI, live dev**: guard kuota di `POST
  /api/ticketing/visits` — `assertCapacityAvailable` di AWAL withTransaction
  (sebelum lock gelang FOR UPDATE; urutan lock konsisten dgn jalur booking →
  bebas deadlock antar-jalur), tanggal = `todayJakartaDate()`, additional =
  `uids.length` (satuan + anggota paket, 1 gelang = 1 orang). Catch route
  sudah ber-pola statusCode → 409 otomatis. Scope temuan: TIDAK ada endpoint
  tambah-gelang mid-visit (registrasi one-shot) — guard cukup di POST;
  redeem booking insert visit sendiri di route redeem (line ~268) → bebas
  guard sesuai desain. Verifikasi: tsc bersih, build OK → pm2 restart,
  smoke 401/200 normal. Commit f7847cd1.
- 2026-07-25 — **B3+B4 SELESAI (Fase B TUNTAS), live dev**:
  - B3 `buildAvailability` di capacity-server (read-only tanpa lock,
    indikatif — kebenaran final tetap guard create): fast path {} bila
    kuota non-aktif; 2 query agregat GROUP BY tanggal (bukan N+1); HANYA
    tanggal bermasalah dikembalikan `{date: sold_out|closed}` — angka
    sisa/kapasitas TIDAK pernah bocor (keputusan owner #7). Route publik
    `GET /api/public/booking/[slug]/availability?from&to` (≤92 hari,
    rate-limit 30/mnt pola catalog, 404 generik anti-enumerasi slug).
  - B4 `booking-calendar.tsx` prop `unavailable` — tanggal penuh/tutup
    DICORET (beda dari abu luar-rentang) + aria-label (penuh/tutup) +
    legend; `booking-wizard.tsx` fetch availability sekali utk jendela
    90 hari (gagal fetch = diam, guard server tetap jaga), notice merah di
    bawah picker bila tanggal terpilih penuh/tutup + tombol Lanjut
    disabled; 409 saat submit → pesan server + refresh peta availability.
  - Verifikasi live dev (bukan cuma unit): availability {} saat kuota
    non-aktif; override cap 0 → `closed`, cap 1 + 1 guest → `sold_out`;
    **E2E POST booking publik**: tanggal sold_out → 409 "Kuota tanggal ini
    sudah penuh", tanggal closed → 409 "Tanggal ini ditutup" (guard
    sebelum insert — tidak ada booking yatim); cleanup 0 sisa; rentang
    invalid 400, slug asing 404. tsc bersih, 87 test, build OK.
    Commit c3645bab.
- 2026-07-25 — **Fase C SELESAI (C1+C2+utang A3) → epic READY-FOR-QA,
  live dev**:
  - Refactor capacity-server: `loadCapacityConfig` + `loadUsedByDate`
    di-share; BARU `buildOccupancy` (angka SELALU dihitung walau kuota
    non-aktif — dashboard tetap perlu lihat jumlah) — buildAvailability
    kini turunan (fast path {} dipertahankan; diverifikasi ulang live).
  - Endpoint `GET /api/ticketing/occupancy?from&to` (≤92 hari,
    TICKETING_OPERATOR_ROLES — selaras akses baca loket ke Booking).
  - C1 `occupancy-calendar.tsx` di dashboard Booking: grid bulanan
    (booking+walk-in)/kapasitas per tanggal, warna hijau/amber(≥70%)/
    merah(penuh)/abu(tutup)/biru(terisi tanpa kuota) + legend; klik
    tanggal → set filter daftar booking existing.
  - C2 kartu "Okupansi Kuota Harian" di Laporan (avg %, total orang,
    hari penuh, hari tutup) — HANYA tampil bila ada tanggal ber-kuota
    dalam rentang (venue tanpa kuota = nol perubahan tampilan).
  - Utang A3 LUNAS: peringatan LIVE di seksi Kapasitas — okupansi
    tertinggi 90 hari ke depan vs kapasitas yang akan disimpan (amber,
    menyebut tanggal + jumlah orang).
  - Verifikasi: tsc bersih, 87 test hijau, build OK → pm2 restart, smoke
    401/307 normal; fungsional availability pasca-refactor diuji ulang
    live (closed terdeteksi, tanggal berkapasitas-kosong diomit),
    cleanup bersih. Commit 3bc1f32c; A–C di-PUSH 25 Jul
    (36f5b877..3bc1f32c).
- 2026-07-25 — **Fase D SELESAI (EPIC TUNTAS A–D), live dev** — owner
  jawab OQ#5: "langsung fase D". Keputusan desain: slot = template level
  VENUE; booking tanpa slot tetap sah (NULL = sepanjang hari, venue tanpa
  slot nol perubahan); kuota slot ⊂ kuota harian (slot.capacity NULL =
  jendela jam saja); walk-in loket TIDAK ber-slot; jam ditegakkan saat
  REDEEM (gelang baru ada setelah redeem) HANYA pada hari-H (redeem H+N
  kebijakan hangus bebas jam — slot sudah lewat total); grace configurable
  `ticket_settings.slot_grace_minutes` (default 30, 0–240).
  - D1 migrasi `20260725190000`: `ticket_time_slots` (label unik per venue,
    start<end, capacity NULL/>0, sort_order) + `ticket_bookings.slot_id`
    (FK SET NULL) + **SNAPSHOT slot_label/start/end** (edit template ≠ ubah
    booking lama) + index partial (branch,visit_date,slot_id) + grace.
  - Lib: `slotWindowStatus` murni (± grace inklusif, HH:MM/HH:MM:SS; 5 test
    baru → 21 capacity, total lib 92). capacity-server: `loadActiveSlots`/
    `loadActiveSlot`/`countSlotUsedByDate`/`assertSlotCapacity` (advisory
    lock re-entrant dgn guard harian) + `nowJakartaTime`.
  - API: publik `GET /[slug]/slots?date` (available|sold_out TANPA angka);
    create booking terima `slot_id` — venue ber-slot WAJIB slot (400),
    venue tanpa slot menolak slot_id, validasi ulang slot via client di
    dalam transaksi + guard kuota slot; redeem menolak di luar jendela ±
    grace (pesan sebut jam & toleransi); CRUD admin
    `/api/ticketing/time-slots` (+/[id]) super_admin.
  - UI: seksi "Slot Waktu (Timed-Entry)" di Pengaturan (grace + CRUD slot);
    wizard: picker jam muncul hanya bila venue ber-slot (pill, sold_out
    dicoret "Penuh", ganti tanggal reset pilihan, Lanjut ter-gate), slot
    tampil di ringkasan, 409 → refresh slot+availability.
  - Verifikasi: tsc bersih, 92 test, build OK → pm2 restart. **E2E live**:
    slots kosong utk venue tanpa slot; slot cap 1 → tanpa slot_id 400
    "Pilih slot waktu"; dengan slot → booking sukses + slots jadi
    sold_out; booking kedua → 409 "Slot ... sudah penuh"; snapshot
    label/jam terisi di booking; cleanup 0 sisa.
