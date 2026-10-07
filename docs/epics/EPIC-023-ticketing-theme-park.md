# EPIC-023: Ticketing Theme Park — NFC Postpaid, Harga Musiman & Channel Manager

status: ready-for-qa
environment: dev
retries: 0

## Goal

Membangun modul **Ticketing** untuk skenario theme park sebagai modul baru di
sistem ini (jaga-jaga bisnis berkembang membangun theme park). Tiga pilar:

1. **NFC Postpaid (bukan deposit)** — pengunjung **daftar dulu di loket**,
   diberi **gelang/kartu NFC**, lalu: tap NFC di **gate** → tagihan tiket
   masuk tercatat; di dalam area, tap NFC di kasir **F&B** → pembelian
   menumpuk di tagihan NFC; semua **dibayar sekali di akhir** saat keluar
   (settlement di POS).
2. **Ticket management proper** — master jenis tiket (**child/adult**),
   matriks harga per **musim (regular/high season)** dengan kalender musim
   yang bisa diatur owner.
3. **Channel manager** — distribusi tiket ke kanal penjualan: **walk-in**
   (loket) dan **website booking** (beli online, dapat kode booking, tukar
   gelang NFC di loket), dengan harga per kanal.

## Konteks Repo (hasil scoping 2026-07-21)

Infrastruktur existing menutup ±70% kebutuhan — modul ini lebih banyak
merangkai daripada membangun dari nol:

- **NFC layer sudah jadi**: `src/features/pos/nfc/` (PC/SC ACR1555 +
  keyboard wedge + bridge), `pos_customers.nfc_uid`
  (delta `20260713100000`), pola scan→aksi di
  `src/features/pos/cashier/nfc-scan-action.ts`.
- **POS F&B lengkap**: `pos_orders` + `pos_order_items` +
  `pos_split_payments`, katalog `pos_products` + varian/modifier, resep
  `pos_recipes` + pengurangan stok (dulu lewat RPC
  `pos_create_order_transaction`; sejak 2026-09-14 transaksi ditangani kode
  aplikasi dengan `withTransaction`, RPC-nya tidak dipakai lagi). Penjualan F&B di dalam park
  = order POS biasa, hanya metode bayarnya baru ("NFC Tab").
- **Ledger stored-value**: `pos_wallet_transactions`
  (balance_before/after) — pola ledger dicontoh untuk tab postpaid, tapi
  arah saldo terbalik (menumpuk tagihan, bukan mengurangi saldo).
- **Booking template**: `pos_reservations` + `src/features/pos/reservation/`.
- **Pembayaran online**: Xendit sudah terintegrasi (topup ARK Coin) —
  dipakai ulang untuk website booking prepaid.
- **Tenancy & migrasi**: pola `company_id` + `branch_id` + delta
  `database/migrations/deltas/YYYYMMDDHHMMSS_*.sql` (preseden sales-funnel
  F1), menu/role via delta `iam.menus`/`iam.roles`.
- **Yang benar-benar baru (greenfield)**: konsep tiket & harga musiman,
  sesi kunjungan (visit/tab) postpaid, tap-charge di gate, channel manager.

## Keputusan Owner (2026-07-21)

1. **Multi mekanisme bayar DISETUJUI** — tiga mekanisme hidup
   berdampingan: (a) **prepaid/deposit** — top-up saldo ke gelang NFC di
   awal, tap memotong saldo, sisa di-refund saat keluar; (b) **standar**
   — cash/QRIS/EDC langsung di kasir POS existing (tanpa gelang);
   (c) **postpaid** — tagihan menumpuk di gelang, bayar di akhir.
   Implementasi: `ticket_visits.payment_mode` (`postpaid`/`prepaid`) di
   atas **ledger tab yang sama** — prepaid punya baris `deposit`, saldo =
   deposit − charges; postpaid dijaga credit limit. Alur gate/F&B/
   settlement satu kode, hanya aturan validasi & akhir cerita yang beda.
2. **Gelang bisa perorangan ATAU rombongan** — untuk settlement keluarga
   / anak kecil, satu pembayar men-settle beberapa gelang sekaligus
   (visit group); gelang tunggal tetap bisa settle sendiri.
3. **Credit limit WAJIB** untuk mode postpaid (konfigurable per venue,
   default di setting) — di atas limit, tap F&B ditolak & diarahkan
   bayar parsial.
4. **High season = kalender manual** — rentang tanggal bernama yang
   diatur owner (mis. "Libur Lebaran 2027"); weekend/tanggal merah
   otomatis menyusul nanti.
5. **Re-entry = konfigurable di Ticketing Settings** (`sekali-masuk` /
   `bebas-keluar-masuk`) — masih dilema, jadi jangan di-hardcode;
   default awal ditentukan saat Fase B.

## Keputusan Menunggu Owner — SEMUA TUTUP (2026-07-22)

1. **Kategori tiket** → **DIPUTUSKAN 2026-07-22**: cukup Adult & Child,
   PLUS opsi tiket ber-**satu varian "Umum"** yang berlaku semua umur —
   dipilih per ticket saat pembuatan (`variant_preset` di Master Ticket).
2. **Website booking** → **DIPUTUSKAN 2026-07-22: Xendit prepaid**
   (bayar di muka via invoice Xendit, test mode dulu). Kuota harian
   TIDAK ikut MVP — blok-online per tanggal (R1) jadi rem manual.
   Detail di "Rencana Implementasi Fase D".
3. **Kebijakan gelang hilang** → **DIPUTUSKAN 2026-07-22: TANPA denda**;
   tagihan tetap ditagih **by data** — kasir mencari kunjungan via
   **nama / no. WA** (pencarian loket existing), settlement rombongan
   seperti biasa. Gelang ditandai `hilang` (diblokir di gate/kasir/
   registrasi); ketemu lagi → aktifkan ulang dari registry setelah
   settlement.
4. **Penempatan modul** → **DIPUTUSKAN 2026-07-22: fleksibel** — theme
   park boleh jadi branch existing ATAU venue baru; di venue baru hanya
   ada theme park (wahana ticketing + F&B di dalamnya). Tenancy
   `company_id`+`branch_id` existing sudah menutup dua-duanya — tidak
   ada perubahan kode; setup = buat branch baru + aktifkan menu
   Ticketing & POS di sana.

## Prinsip Desain

1. **Modular & opsional** — modul Ticketing berdiri sendiri (menu, skema
   DB, role); venue yang tidak punya theme park tidak melihat menu ini.
2. **Gelang NFC = aset berputar, bukan identitas member.** UID gelang
   di-assign ke sesi kunjungan (visit) saat registrasi dan dilepas saat
   settlement — beda dengan `pos_customers.nfc_uid` (kartu member
   permanen). Pengunjung boleh opsional ditautkan ke member loyalty untuk
   XP/riwayat.
3. **F&B numpang POS existing** — jangan bikin kasir kedua. Order F&B
   tetap `pos_orders` (stok/resep/laporan shift jalan otomatis), hanya
   ada metode pembayaran baru **"NFC Tab"** yang memindahkan tagihan ke
   visit, bukan menerima uang.
4. **Tab = ledger append-only** — setiap charge (tiket, F&B, penalti,
   koreksi) satu baris; total tagihan = SUM ledger. Void = baris
   pembalik, bukan delete. Settlement transaksional (`withTransaction`).
5. **Tenant-scoped** — semua tabel WAJIB `company_id` + `branch_id`
   (tiket adalah aset bisnis per venue), mengikuti preseden sales-funnel.
6. **Harga = matriks yang di-resolve saat charge**: `jenis tiket × musim
   (dari tanggal kunjungan) × kanal` → satu harga pasti. Harga yang sudah
   ter-charge di-snapshot di ledger (perubahan master tidak mengubah
   tagihan berjalan).

## Fitur (Rincian)

### 1. Master Tiket & Harga Musiman
- **Jenis tiket**: child/adult (extensible: toddler/senior/disabled),
  dengan definisi batas (umur/tinggi) sebagai teks aturan di loket.
- **Kalender musim**: daftar musim bernama dengan rentang tanggal +
  tipe (`regular`/`high`); resolusi tanggal → musim (default `regular`
  bila tak ada yang cocok; high season menang bila overlap).
- **Matriks harga**: jenis tiket × musim × kanal → harga. UI grid
  sederhana ala spreadsheet. Validasi: tidak boleh ada lubang harga untuk
  kanal aktif.

### 2. Registrasi & Gelang NFC (Loket Masuk)
- **Registry gelang**: stok gelang per venue (uid, label fisik, status
  `tersedia`/`dipakai`/`hilang`/`rusak`) — scan sekali untuk mendaftarkan
  gelang baru ke sistem.
- **Registrasi kunjungan (walk-in)**: petugas loket input komposisi
  rombongan (X adult + Y child), nama & no. WA penanggung jawab
  (opsional tautkan member), **pilih mode bayar**: `postpaid` (bayar di
  akhir, credit limit aktif) atau `prepaid` (top-up saldo sekarang —
  terima cash/QRIS di loket, tercatat sebagai baris `deposit` di tab),
  lalu **tap gelang satu per satu** → tiap gelang terikat 1 tiket
  (kategori tertentu) dalam 1 **visit group**. Top-up ulang di dalam
  area bisa dilakukan di kasir mana pun (mode prepaid).
- **Redeem booking online**: input/scan kode booking → data rombongan &
  tiket prepaid terisi otomatis → tinggal tap gelang.
- Visit berstatus `open` sejak registrasi; belum ada charge sampai tap
  gate (keputusan #7 menentukan detail).

### 3. Gate — Tap Masuk (Charge Tiket)
- **Mode Gate**: halaman fullscreen khusus (tablet + reader NFC di gate,
  reuse `pos-nfc-shell`) — tap gelang → tampil hijau/merah + kategori
  tiket + nama rombongan.
- Tap pertama → **charge tiket** ke tab visit dengan harga hasil resolve
  matriks (kecuali tiket prepaid online → tandai `digunakan` tanpa
  charge). Tap ulang → sesuai kebijakan re-entry (keputusan #7).
- Gelang tak dikenal / visit sudah `settled` / gelang `hilang` → merah +
  alasan. Semua tap tercatat di log gate (audit & hitung traffic).

### 4. F&B di Dalam — Tap Bayar ke Tab
- Di kasir POS existing: metode pembayaran baru **"NFC Tab"** — tap
  gelang di layar pembayaran → order lunas secara kasir (masuk
  `pos_split_payments` method `nfc_tab`), tagihannya pindah jadi baris
  charge di tab visit (referensi `order_id`).
- Guard per mode: visit harus `open`; **postpaid** → total tab setelah
  order ≤ credit limit; **prepaid** → saldo (deposit − charges) cukup.
  Gagal guard → tolak dengan pesan jelas + arahkan bayar
  parsial/top-up. Pengunjung tanpa gelang tetap bisa bayar
  cash/QRIS/EDC/Ark Coin seperti biasa (mekanisme standar, nol perubahan).
- Stok/resep/KDS/laporan shift jalan seperti order biasa — nol perubahan
  di alur dapur.

### 5. Settlement — Kasir Keluar
- Tap gelang (atau cari by nama/WA) → tampil **rincian tagihan**: tiket
  per kepala + daftar order F&B + penalti (+ deposit yang sudah masuk,
  untuk prepaid); settle **per gelang** atau **satu rombongan
  sekaligus** (satu pembayar untuk keluarga/anak kecil).
- **Postpaid**: bayar total via layar pembayaran POS (cash/QRIS/EDC,
  split payment existing). **Prepaid**: sisa saldo di-**refund**
  (baris `refund-deposit` di ledger); kurang saldo → bayar selisih.
  Sukses → visit `settled`, gelang kembali `tersedia`, struk gabungan.
- Kasus khusus: gelang hilang (denda + settle by data), visit menginap
  >1 hari operasional (daftar "tab menggantung" untuk ops), void charge
  oleh supervisor (baris pembalik + alasan).

### 6. Channel Manager
- **Master kanal**: `walk-in` & `website` (MVP), extensible ke OTA/agen
  (harga per kanal sudah disiapkan di matriks; alokasi kuota per kanal =
  fase lanjutan).
- **Website booking (public page)**: pilih tanggal kunjungan → sistem
  resolve musim & tampilkan harga per jenis tiket → isi jumlah adult/
  child + data pemesan → bayar Xendit (reuse pola topup) → **kode
  booking + QR** dikirim via WA/email; halaman status booking.
- **Kuota harian** (kapasitas venue per tanggal, opsional MVP): booking
  online berhenti saat kuota penuh; walk-in warning saja.
- Kelola booking di dashboard: daftar per tanggal, status
  (`menunggu-bayar`/`terbayar`/`digunakan`/`kedaluwarsa`/`dibatalkan`),
  refund manual = catatan status (uang dikembalikan di luar sistem, MVP).

### 7. Laporan & Monitoring
- **Traffic**: pengunjung per hari/jam (dari log gate), breakdown
  child/adult, occupancy vs kuota.
- **Revenue**: tiket vs F&B, per kanal, per musim; ATV per pengunjung.
- **Tab monitor (live)**: visit open saat ini, total tagihan berjalan,
  tab menggantung/lewat jam operasional.
- **Gelang**: stok per status, riwayat gelang hilang/denda.
- Rekonsiliasi kasir keluar nyambung ke closing report shift existing.

### Non-Goals (MVP)
- Integrasi OTA nyata (Traveloka/tiket.com) — struktur kanal disiapkan,
  koneksi API menyusul.
- Dynamic pricing otomatis (surge), paket bundling tiket+F&B, annual
  pass/season pass, akses wahana per-tiket (semua tiket = general
  admission dulu).
- Hardware turnstile terintegrasi (gate = petugas + tablet + reader dulu).
- Refund otomatis Xendit.

## Desain Data (sketsa — skema `ticketing`, prefix `ticket_`)

Semua tabel: `company_id`, `branch_id`, `created_by`, timestamps.

- `ticket_types` — code (`adult`/`child`/…), name, rule_note (batas
  umur/tinggi), sort_order, is_active.
- `ticket_seasons` — name, season_kind (`regular`/`high`), start_date,
  end_date, is_active. (Resolusi: high menang bila overlap; default
  regular.)
- `ticket_channels` — code (`walk-in`/`website`/…), name, is_active,
  is_online (butuh pembayaran di muka).
- `ticket_prices` — ticket_type_id × season_kind × channel_id → price.
  Unique constraint per kombinasi.
- `ticket_bands` — nfc_uid (unique per venue), label, status
  (`tersedia`/`dipakai`/`hilang`/`rusak`).
- `ticket_bookings` — booking_code (unique), channel_id, visit_date,
  contact_name/phone/email, status, total_amount,
  xendit_transaction_id, expires_at; child `ticket_booking_items`
  (ticket_type_id, qty, unit_price).
- `ticket_settings` — konfigurasi per venue: re_entry_policy
  (`sekali-masuk`/`bebas-keluar-masuk`), default_credit_limit,
  default_payment_mode, dsb. (satu baris per branch).
- `ticket_visits` — visit group: contact_name/phone, customer_id
  (nullable FK `pos_customers`), booking_id (nullable),
  **payment_mode (`postpaid`/`prepaid`)**, status
  (`open`/`settled`/`void`), credit_limit (postpaid), opened_at,
  settled_at, settled_order_ref.
- `ticket_visit_bands` — visit_id × band_id + ticket_type_id +
  entered_at (tap gate pertama), status per gelang.
- `ticket_visit_charges` — **ledger tab dua arah**: visit_id, band_id
  (nullable), charge_type (`tiket`/`fnb`/`denda`/`koreksi` = debit;
  `deposit`/`refund-deposit`/`pembayaran` = kredit), direction
  (`debit`/`kredit`), description, amount (snapshot), pos_order_id
  (nullable FK `pos_orders`), price_context (jsonb: type/season/channel
  saat resolve), voided_by_charge_id. Saldo/total tagihan = agregat
  ledger; prepaid: kredit − debit ≥ 0, postpaid: debit − kredit ≤ limit.
- `ticket_gate_events` — band_uid, visit_id (nullable), gate_label,
  result (`masuk`/`ditolak-…`), created_at. Append-only.

Integrasi POS: nilai baru `nfc_tab` di `pos_split_payments.payment_method`
+ kolom/referensi `visit_id` pada pembayaran tersebut (atau cukup
`reference_number` = visit id — putuskan saat Fase C).

Migrasi via `database/migrations/deltas/<timestamp>_ticketing_fase_a.sql`
dst. Menu + role (`ticketing` / reuse kasir) via delta `iam.*`.

## Revisi Manage Ticket — Ticket sebagai Produk (owner, 2026-07-21)

Owner meluruskan model manage ticket setelah Fase A–C jadi: master
berbasis **produk Ticket**, bukan master flat per venue. Fase A lama
(jenis tiket flat + kalender venue + matriks harga venue) DIGANTI.

### Model baru

1. **Ticket = produk, bisa dibuat banyak** (`ticket_products`):
   Ticket ID (kode auto per venue, mis. `TKT-0001`), Nama, **Kategori**
   (master `ticket_categories` — submit via autocomplete, belum ada →
   auto-add), Status (`draft`/`active`), Base Price (Rp, tampilan/acuan),
   Thumbnail (reuse infra upload existing), Description.
2. **Varian per ticket** (`ticket_product_variants`): Adult & Child
   (extensible), tiap varian punya **dua kolom harga: Regular & High
   Season** (keputusan owner — eksplisit, tanpa hitungan tersembunyi).
3. **Konfigurasi per ticket = Tabs** di halaman ticket:
   - **Info & Varian** — field utama + harga per varian.
   - **Kalender** (`ticket_product_dates`) — rentang tanggal
     `high-season` (harga high berlaku) dan `blok-online` (tanggal
     tidak dijual di website booking; walk-in tetap jalan).
   - **Kebijakan Operasional** — re-entry per ticket (keputusan owner;
     credit limit & default mode bayar TETAP per venue di
     `ticket_settings` karena melekat ke tab kunjungan, bukan produk).
4. **Channel Manager = sub-menu sendiri** (`/ticketing/channel-manager`):
   distribusi tiap ticket ke **POS (walk-in)** dan/atau **Website
   Booking** (`ticket_product_channels`), plus **harga override per
   kanal per varian** (keputusan owner — `ticket_variant_channel_prices`,
   kosong = ikut harga varian). Hanya ticket `active` ber-harga lengkap
   yang bisa didistribusi.

### Resolver harga v2 (`pricing.ts` ditulis ulang)

`(ticket, varian, tanggal, kanal)` → musim dari kalender ticket (high
menang overlap, default regular) → harga = override kanal[musim] ??
harga varian[musim]; tanggal `blok-online` + kanal website → ditolak;
harga kosong → null (WAJIB tolak transaksi, jangan menebak).

### Penegasan owner: rombongan & master pembayar (2026-07-21)

Rombongan (mis. ber-3): **1 orang jadi master** yang bisa membayarkan
billing seluruh rombongan, TAPI tiap member juga bisa bayar
masing-masing. Ini sudah persis dipetakan oleh desain Fase B yang
berjalan: 1 visit = 1 rombongan dengan penanggung jawab (master);
kasir keluar mendukung **settle satu rombongan sekaligus** (master
membayar semua gelang) DAN **settle per gelang** (member bayar
tagihannya sendiri, gelangnya dilepas, visit tetap open untuk sisanya).
Tidak ada perubahan skema yang dibutuhkan.

### Dampak ke Fase B/C yang sudah jadi

- Registrasi loket: pilih **Ticket** (aktif + distribusi walk-in) →
  per gelang pilih **varian**; `ticket_visit_bands.ticket_type_id`
  diganti `variant_id` (FK `ticket_product_variants`).
- Gate tap-charge: resolve via resolver v2; `price_context` jadi
  `{ticket_product_id, variant_id, season_kind, channel}`; kebijakan
  re-entry dibaca dari ticket (bukan settings venue).
- Settlement, F&B on tab, ledger: TIDAK berubah (ledger agnostik).
- Data dev lama: **wipe & mulai bersih** (keputusan owner) — master
  lama + visit uji dihapus; registry gelang & pengaturan venue
  dipertahankan.
- `ticket_settings`: `re_entry_policy` menjadi *default venue* untuk
  ticket baru; halaman Pengaturan Tiket menyusut (kalender & matriks
  pindah ke masing-masing ticket).

### Fase revisi (PR-sized)

- **Fase R1 — Skema & Master Ticket**: delta migrasi (tabel baru +
  wipe + restructure `ticket_visit_bands` + menu "Master Ticket");
  halaman `/ticketing/tickets` (list + create/edit ber-Tabs), kategori
  autocomplete auto-add, upload thumbnail, resolver harga v2 + unit
  test lengkap.
- **Fase R2 — Channel Manager & adaptasi operasional**: sub-menu
  Channel Manager (toggle distribusi + override harga per kanal),
  adaptasi Loket (pilih ticket + varian) dan Gate (resolver v2 +
  re-entry per ticket); Pengaturan Tiket dirampingkan.

Fase D (website booking) menyusul di atas model ini — memakai
distribusi website, harga kanal website, dan tanggal blok-online.

## Task Groups (PR-sized, 1 group = 1 branch = 1 PR)

### Fase A — Fondasi: skema, menu, master tiket & harga
- Delta migrasi: skema `ticketing` + tabel master (`ticket_types`,
  `ticket_seasons`, `ticket_channels`, `ticket_prices`, `ticket_bands`,
  `ticket_settings`) + seed default (adult/child, kanal walk-in/website)
  + menu "Ticketing" granted `super_admin`.
- Route `src/app/dashboard/(dashboard)/ticketing/settings`, feature
  `src/features/ticketing/masters/`: CRUD jenis tiket, kalender musim,
  grid matriks harga, registry gelang (scan-untuk-daftar), dan
  **Ticketing Settings** (kebijakan re-entry, default credit limit,
  default mode bayar).
- Resolver harga `src/lib/ticketing/pricing.ts` (tanggal+tipe+kanal →
  harga) — unit test lengkap (edge: overlap musim, lubang harga).

### Fase B — Visit Core: registrasi, gate tap-charge, settlement
- Delta: `ticket_visits`, `ticket_visit_bands`, `ticket_visit_charges`,
  `ticket_gate_events`.
- Loket masuk: form registrasi rombongan + **pilih mode bayar
  (postpaid/prepaid + top-up awal)** + tap-assign gelang
  (reuse `src/features/pos/nfc/`).
- Mode Gate fullscreen: tap → charge tiket (idempotent per kebijakan
  re-entry dari `ticket_settings`), layar hijau/merah, log gate.
- Kasir keluar: rincian tab per gelang/rombongan, settlement
  transaksional reuse layar pembayaran POS (postpaid: bayar total;
  prepaid: refund sisa saldo), gelang release, struk. Top-up ulang
  saldo prepaid di kasir.

### Fase C — F&B on Tab
- Metode pembayaran "NFC Tab" di kasir POS: tap gelang → validasi visit
  open + credit limit → tulis `pos_split_payments` (`nfc_tab`) + baris
  charge di tab (satu transaksi DB).
- Void order ber-nfc_tab → baris pembalik di tab.
- Tab monitor live di dashboard ticketing.

### Fase D — Website booking (public, Xendit prepaid)

Rencana implementasi rinci (disepakati 2026-07-22; kuota harian
di-skip MVP). 4 task group PR-sized, urut:

**D1 — Skema & fondasi booking**
- Delta `ticket_bookings`: tenant (`company_id`+`branch_id`),
  `booking_code` (pendek, human-friendly, unik per venue — untuk loket),
  `access_token` (acak 32-byte, capability URL status page — pola
  `/api/files`), `visit_date`, `customer_name`, `customer_phone` (WA),
  status (`menunggu-bayar`/`terbayar`/`digunakan`/`kedaluwarsa`/
  `dibatalkan`), `total` snapshot, `xendit_invoice_id` (unik) +
  `xendit_invoice_url`, `paid_at`, `expires_at`, `used_at`,
  `visit_id` NULL (diisi saat redeem).
- `ticket_booking_items`: booking_id, ticket_product_id, variant_id,
  qty, `unit_price` + `season_kind` snapshot (resolver v2 kanal
  website), subtotal.
- `ticket_settings.booking_slug` (unik) — resolusi venue di URL publik
  `/booking/[slug]` (multi-venue-proof tanpa bocor id internal).
- Menu "Booking" di dashboard Ticketing granted `super_admin`.

**D2 — API publik + Xendit (satu PR dgn D1)**
- `GET /api/public/booking/[slug]/catalog?date=` → hanya produk Active
  + distribusi website ON + `price_complete` kanal website (guard R2
  kepake); harga per varian di-resolve utk tanggal itu; tanggal
  blok-online / masa lalu ditolak. Tanpa data internal.
- `POST /api/public/booking/[slug]` → zod (tanggal hari-ini..+90 hari,
  qty 1..20/booking, normalisasi nomor WA); harga dihitung ulang
  server-side (jangan percaya klien); insert `menunggu-bayar` +
  create Xendit invoice (external_id = booking id, expiry 2 jam,
  success_redirect → status page); rate limit per IP.
- `POST /api/public/booking/webhook/xendit` → verifikasi
  `x-callback-token` (`XENDIT_WEBHOOK_TOKEN`), transisi idempotent
  `menunggu-bayar→terbayar` (sekali saja), `paid_at`, kirim WA kode
  booking + link status ber-QR via `sendGatewayText` (gateway live);
  invoice expired → `kedaluwarsa`.
- `GET /api/public/booking/status/[token]` → by access_token saja
  (404 generik, anti-enumerasi).
- Unit test: snapshot harga booking, mesin status idempotent,
  webhook token salah ditolak.

**D3 — UI publik `src/app/(public)/booking/[slug]/`**
- Wizard mobile-first tanpa login: kalender (blok-online disabled) →
  pilih ticket & qty per varian (harga live per tanggal) → data
  pemesan (nama + WA) → ringkasan → redirect invoice Xendit.
- Halaman status `/booking/status/[token]`: menunggu-bayar (link bayar
  ulang), terbayar (QR `qrcode.react` + kode + instruksi), digunakan /
  kedaluwarsa / dibatalkan.

**D4 — Redeem loket + gate**
- Loket: scan QR / input kode → rincian booking → assign gelang →
  buat visit `prepaid`: charge tiket snapshot harga booking + baris
  pembayaran booking senilai sama di ledger (net 0; revenue tiket per
  kanal website kebaca dari ledger existing). Booking → `digunakan`
  idempotent (AC: tidak bisa dipakai 2x), `visit_id` terisi.
- Guard: hanya booking `terbayar` dgn `visit_date` = hari ini; gate
  tap tidak men-charge (charge sudah ada), re-entry per ticket tetap.

**D5 — Dashboard kelola booking**
- List per tanggal + filter status; detail; aksi: batalkan, tandai
  refund manual (catatan — uang di luar sistem, MVP), resend WA.

**Prasyarat (owner/user):** akun Xendit + `XENDIT_SECRET_KEY`
(test mode) & `XENDIT_WEBHOOK_TOKEN` di `.env` (jangan commit);
set webhook URL di dashboard Xendit →
`https://sulu.within.ventures/api/public/booking/webhook/xendit`.

**Non-MVP (ditunda):** kuota harian, refund via API Xendit, email,
multi-hari/paket, pembatalan mandiri oleh pemesan.

### Fase P — Ticket Bundling (Paket)
- Paket = `ticket_product` ber-`product_kind='bundle'` dgn satu varian
  "Paket" (harga Regular/High + override kanal + kalender ikut infra
  existing); komposisi `ticket_bundle_items` (varian komponen SATUAN ×
  qty, paket-dalam-paket ditolak, FK RESTRICT).
- Saat dijual, paket meledak per ORANG: gelang/guest menunjuk varian
  KOMPONEN (re-entry ikut tiket komponen) + `allocated_price` prorata
  harga paket (kumulatif 2dp, Σ per unit = harga paket → net-0 redeem
  aman; bobot = harga satuan komponen, bolong → bagi rata).
- Loket: tambah unit paket → tap N gelang urut anggota; gate tap
  men-charge `allocated_price` snapshot tanpa resolve matriks.
- Website: paket tampil di katalog (blok-online komponen ikut memblok),
  guest per anggota ber-nama; redeem pakai `allocated_price` guest.
- Scope: bundle SESAMA tiket saja; tiket+F&B (voucher) = epic terpisah.

### Fase E — Laporan & Ops
- Laporan traffic, revenue tiket vs F&B per kanal/musim, rekap gelang,
  tab menggantung; sambungan ke closing report shift.

## Acceptance Criteria (ringkas)

- Semua query ticketing terfilter `company_id` + `branch_id`; tidak ada
  kebocoran antar venue.
- Resolver harga deterministik: satu tanggal+tipe+kanal selalu → tepat
  satu harga; charge men-snapshot harga (ubah master ≠ ubah tab berjalan).
- Tap gate idempotent sesuai kebijakan re-entry; tidak mungkin double
  charge tiket untuk gelang yang sama di visit yang sama.
- Charge F&B + `pos_split_payments` ditulis dalam satu transaksi;
  gagal salah satu → rollback keduanya.
- Settlement menutup visit secara atomik; gelang kembali `tersedia`;
  visit `settled` menolak charge baru.
- Guard mode bayar ditegakkan di server (bukan hanya UI): postpaid
  tidak bisa melewati credit limit; prepaid tidak bisa bersaldo
  negatif; refund sisa saldo tercatat sebagai baris ledger.
- Settlement rombongan (multi-gelang, satu pembayar) dan settlement
  per gelang dua-duanya didukung dan atomik.
- Booking online tidak bisa digunakan 2x (status `digunakan` idempotent).
- Response API memakai envelope `successResponse`/`paginatedResponse`;
  role guard pola `src/lib/crm/server.ts`.

## Automation Log

- 2026-07-21 — Epic dibuat (status **backlog**, masih rencana owner).
  Scoping repo: NFC layer (`src/features/pos/nfc/`), ledger wallet,
  katalog F&B + resep + RPC stok, reservation template, dan Xendit topup
  semuanya reusable; greenfield = harga musiman, visit/tab postpaid,
  gate tap-charge, channel manager. 8 keputusan owner tercatat sebagai
  blocker sebelum on-progress.
- 2026-07-21 — Owner memutuskan 5 hal: (1) multi mekanisme bayar
  disetujui — prepaid/deposit + standar cash/QRIS + postpaid, via
  `payment_mode` per visit di atas ledger dua arah yang sama;
  (2) gelang bisa perorangan atau rombongan (settlement keluarga/anak);
  (3) credit limit wajib untuk postpaid; (4) high season = kalender
  manual; (5) re-entry konfigurable di Ticketing Settings (masih
  dilema, jangan hardcode). Sisa 4 keputusan menunggu: kategori tiket
  tambahan, prepaid-nya website booking, kebijakan gelang hilang,
  penempatan venue di hierarki.
- 2026-07-21 — **Fase A SELESAI** (status `coding`). Delta
  `20260722060000_ticketing_fase_a.sql` applied: skema `ticketing` +
  6 tabel master (`ticket_types`, `ticket_seasons`, `ticket_channels`,
  `ticket_prices`, `ticket_bands`, `ticket_settings`) + menu
  "Ticketing → Pengaturan Tiket" granted `super_admin`. Halaman
  `/dashboard/ticketing/settings` (section: jenis tiket, kalender
  musim, matriks harga, registry gelang, kebijakan operasional).
  Resolver harga murni `src/lib/ticketing/pricing.ts` — 13 unit test
  lulus (overlap musim high menang, lubang harga → null wajib tolak).
  Keputusan implementasi: seed master TIDAK di migrasi (tabel
  ber-tenant) — bootstrap adult/child + kanal walk-in/website terjadi
  saat pertama buka `/api/ticketing/settings`; guard role pola
  `requireTicketingContext` (super_admin, venue fallback
  `crm_settings`); UID NFC dinormalisasi hex uppercase
  (`normalizeNfcUid`, min 8 hex).
- 2026-07-21 — **Fase B SELESAI** (status `coding`). Delta
  `20260722070000_ticketing_fase_b.sql` applied: `ticket_visits`,
  `ticket_visit_bands` (unique index parsial — satu gelang tak bisa
  aktif di 2 visit), `ticket_visit_charges` (ledger append-only + CHECK
  `chk_charge_direction`), `ticket_gate_events`; menu Loket & Kasir +
  Mode Gate granted super_admin/pos_supervisor/pos. **Keputusan arah
  ledger**: `refund-deposit` = DEBIT (sketsa epic menulis kredit, tapi
  refund mengurangi titipan — visit settled selalu berakhir debit =
  kredit). Lib murni `tab.ts` (16 unit test): computeTabSummary,
  canCharge (guard saldo prepaid / plafon postpaid), settlementPlan.
  API: register visit (kunci gelang FOR UPDATE ORDER BY id), top-up
  prepaid, settle rombongan + settle per gelang (postpaid saja;
  prepaid wajib settle rombongan utk refund), gate tap idempotent
  (entered_at + kebijakan re-entry; harga 0 = tiket comp sah, masuk
  tanpa baris ledger); semua ber-rate-limit (`checkRateLimit`) dan
  serialisasi via `ticket_visits FOR UPDATE`. UI: Loket (registrasi
  tap-beruntun, tabel visit + settle/top-up dialog) & Mode Gate
  fullscreen (PC/SC bridge + keyboard wedge, layar hijau/merah).
  Gate hasil: security review 0 CRITICAL/HIGH (2 MEDIUM ditutup:
  company_id di cek duplikat gelang, rate limit; pembulatan 2dp per
  baris ledger), code review 0 CRITICAL/HIGH (log gate branch tanpa
  kanal, guard due=0 settle per-gelang, active_band_count di list —
  semua ditutup). Verifikasi: build lulus, lint bersih, 29 unit test,
  smoke test SQL end-to-end (register → tap → settle → ledger seimbang
  → gelang release) lulus dgn rollback. **Hutang teknis dicatat**:
  belum ada integration test route ber-uang (butuh infra mock auth —
  konsisten dgn preseden sales-funnel, unit + smoke SQL dulu).
- 2026-07-21 — **Fase C SELESAI** (status `coding`). Delta
  `20260722080000_ticketing_fase_c.sql` applied: enum `nfc_tab` di
  `pos_payment_method`, CHECK arah dilonggarkan (`koreksi` boleh dua
  arah utk baris pembalik void), + index unik parsial
  `uq_ticket_visit_charges_fnb_order` (1 order = 1 charge fnb aktif,
  lapis DB). **Keputusan implementasi** (opsi di sketsa epic): order
  single-payment menyimpan metode di `pos_orders.payment_method`
  langsung — TIDAK menulis `pos_split_payments`; tautan ke tab =
  `ticket_visit_charges.pos_order_id`. Jembatan
  `src/lib/ticketing/tab-server.ts`: `chargeFnbOrderToTab`
  (transaksional, lock visit, guard saldo/plafon dicek ulang di dalam
  lock, idempotent per order, `markOrderPaid` menandai order
  completed/paid DI transaksi yang sama — charge & status tak mungkin
  terpisah) + `checkTabForCharge` (pratinjau PaymentModal). Kasir:
  metode "NFC Tab" di PaymentModal (panel tap + pratinjau nama/mode/
  sisa; opsi tersembunyi tanpa prop `onCheckNfcTab`), dukung checkout
  langsung & bayar open bill; nilai dioper eksplisit ke
  `handleCreateOrder` (setState + panggilan setick = stale closure).
  Void supervisor: endpoint `charges/[chargeId]/void` (super_admin/
  pos_supervisor, baris pembalik `koreksi` kredit, sekali per baris)
  + tombol Void di dialog (disembunyikan utk kasir). Tab monitor:
  `tab/stats` + 4 kartu di Loket (refresh 30 dtk); closing shift
  menampilkan bucket `nfc_tab` di method_breakdown (bukan uang masuk
  shift — ditagih saat settlement). Gate hasil: security review
  1 CRITICAL ditutup (**PATCH /api/pos/orders/[id] tanpa gerbang
  auth — celah lama, kini 401 + rate limit**), audit log percobaan
  gagal, index unik DB; code review 2 HIGH ditutup (nominal charge
  nfc_tab = turunan server bukan total_amount klien; atomisitas
  charge+paid satu transaksi), order partial ditolak, kompensasi
  delete dicek error + fallback cancelled. Catatan disengaja: void
  charge fnb TIDAK mengubah `pos_orders.payment_status` (order tetap
  paid; pembalikan hidup di ledger tab — rekonsiliasi lewat ledger).
  Verifikasi: 33 unit test, build lulus, smoke SQL Fase C (enum,
  charge ber-referensi order, dup-check, baris pembalik, ledger
  netral pasca void, fnb-kredit ditolak) lulus dgn rollback.
- 2026-07-21 — **Revisi Manage Ticket direncanakan** (owner meluruskan
  model): Ticket = produk (master + kategori auto-add + status
  draft/active + base price + thumbnail + description), varian
  Adult/Child ber-harga Regular & High Season per varian, konfigurasi
  per ticket via Tabs (kalender high season + blok-online, kebijakan
  re-entry per ticket), Channel Manager = sub-menu distribusi POS/
  Website + harga override per kanal. 4 keputusan owner: (1) dua kolom
  harga per varian; (2) harga BISA beda per kanal (override);
  (3) data dev lama wipe & mulai bersih (registry gelang + pengaturan
  venue dipertahankan); (4) re-entry per ticket, credit limit & mode
  bayar tetap per venue. Rencana: Fase R1 (skema + Master Ticket +
  resolver v2) lalu R2 (Channel Manager + adaptasi Loket/Gate).
  Detail di bagian "Revisi Manage Ticket". Menunggu go owner sebelum
  dev.
- 2026-07-21 — **Fase R1 SELESAI** (status `coding`). Delta
  `20260722100000_ticketing_fase_r1.sql` applied: wipe data dev
  (keputusan owner; registry gelang + pengaturan venue dipertahankan),
  drop master flat Fase A, tabel baru `ticket_categories` (unik
  case-insensitive lower(name)), `ticket_products` (kode auto TKT-####,
  draft/active, base price, thumbnail, re-entry per ticket),
  `ticket_product_variants` (Adult/Child × harga Regular & High),
  `ticket_product_dates` (high-season + blok-online),
  `ticket_product_channels` (distribusi, default walk-in ON),
  `ticket_variant_channel_prices` (override per kanal);
  `ticket_visit_bands.variant_id` NOT NULL. Master Ticket di
  `/ticketing/tickets` (list + editor Tabs: Info & Varian / Kalender /
  Kebijakan; kategori autocomplete auto-add; upload thumbnail reuse
  `lib/storage`). Resolver v2 murni (19 unit test) + server
  `resolveVariantPriceOnDate`. Loket & Gate langsung diadaptasi
  (registrasi pilih Ticket—Varian dari produk Active ber-distribusi
  POS; gate baca re-entry per ticket, price_context baru
  {ticket_product_id, variant_id, season_kind, channel_id,
  visit_date}); settlement/F&B/ledger tak tersentuh. Pengaturan Tiket
  menyusut (kebijakan venue + registry gelang; re-entry venue = default
  ticket baru). Gate hasil — code review APPROVE (2 MEDIUM ditutup:
  retry tabrakan kode 23505 → 409, kategori unik lower(name));
  security review menemukan **CRITICAL PRE-EXISTING di
  `/api/files/[bucket]/[...path]`: path traversal + tanpa nosniff —
  ditutup (containment path.resolve + startsWith, dotfile ditolak,
  nosniff, tipe tak dikenal dipaksa attachment; akses anonim ke URL
  persis dipertahankan krn nama file ber-komponen acak = capability
  URL, dipakai lintas konteks sesi)**; H1 ekstensi file kini dari MIME
  tervalidasi bukan filename klien (anti stored-XSS svg/html); H2
  category_id divalidasi milik venue (anti-IDOR); M1 lookup kanal
  resolver di-scope tenant. Verifikasi: 35 unit test, build lulus,
  smoke SQL R1 end-to-end (kategori → TKT-0001 → varian+kalender+
  distribusi → opsi loket → registrasi varian → join gate re-entry per
  ticket → harga high benar → override kanal → varian draft tertolak)
  lulus dgn rollback. Penegasan owner tercatat: rombongan master-bayar
  = settle rombongan Fase B; member bayar sendiri = settle per gelang.
  Sisa R2: Channel Manager UI (toggle distribusi + override harga per
  kanal + guard harga lengkap).
- 2026-07-22 — **Fase R2 SELESAI** (status `coding`). Delta
  `20260722110000_ticketing_fase_r2.sql` applied (hanya menu — skema
  distribusi/override sudah ada sejak R1): menu "Channel Manager"
  (`/dashboard/ticketing/channel-manager`, anak menu Ticketing, granted
  `super_admin`). API baru: GET `/api/ticketing/channel-manager` (papan
  semua ticket × kanal venue — status distribusi, override per varian,
  `price_complete` dihitung server supaya UI jujur), PATCH
  `/api/ticketing/products/[id]/channels` (toggle distribusi dalam
  `withTransaction` + `FOR UPDATE`; guard nyalakan: produk wajib Active,
  punya varian aktif, dan SEMUA varian lengkap harga Regular & High —
  langsung di varian atau tertutup override kanal via
  `isVariantPriceComplete`; mematikan selalu boleh), PUT
  `/api/ticketing/products/[id]/channel-prices` (upsert override per
  varian; NULL+NULL → baris dihapus; varian divalidasi milik ticket &
  masih aktif — anti baris hantu). UI `channel-manager-page.tsx`:
  papan per ticket, Switch per kanal (blocked + alasan bila draft/harga
  belum lengkap — hanya blokir nyalakan), dialog harga kanal (input
  kosong = ikut varian; terisi wajib angka ≥ 0, "0" sah tidak dipaksa
  null). Ikutan: PATCH produk turun-ke-Draft mematikan semua distribusi
  (papan tidak menampilkan toggle menyala yang bohong); editor ticket
  kini nge-link ke Channel Manager. Verifikasi: 35 unit test lulus,
  build lulus, smoke API live (papan OK; toggle ON produk draft ditolak
  400 dgn pesan jelas). Catatan minor disengaja: produk BARU (draft)
  tetap default walk-in ON dari R1 — by design agar langsung siap jual
  saat diaktifkan; loket hanya menawarkan produk Active jadi tidak
  bocor. Insiden pagi 22 Jul ("dashboard terjadi kesalahan") = server
  start di tengah build kemarin (ChunkLoadError, route table stale) —
  ditutup dgn build ulang penuh + restart PM2; aturan: build selesai
  dulu, baru restart.
- 2026-07-22 — **Fase D direncanakan** (blocker keputusan #2 TUTUP:
  Xendit prepaid; kuota harian di-skip MVP — blok-online R1 jadi rem
  manual). Rencana rinci D1–D5 ditulis di bagian "Fase D — Website
  booking": skema `ticket_bookings`+items ber-snapshot harga, API
  publik ber-slug venue + webhook Xendit idempotent ber-token, wizard
  publik mobile-first, redeem loket → visit prepaid net-0 di ledger
  (revenue kanal website kebaca laporan existing), dashboard kelola.
  Temuan scoping: Xendit BELUM pernah terintegrasi nyata (topup cuma
  TODO + kolom) — butuh akun & key dari owner sebelum D2 bisa diuji
  end-to-end; WA gateway & qrcode.react siap reuse. Status: menunggu
  review plan user sebelum koding D1.
- 2026-07-22 — **Fase D1+D2+D3 SELESAI** (status `coding`). Delta
  `20260722130000_ticketing_fase_d1_booking.sql` applied:
  `ticket_bookings` (booking_code BK-XXXXXX charset anti-ambigu unik
  per venue, access_token 64-hex capability, status CHECK 5 nilai,
  total snapshot, xendit_invoice_id unik, expires_at) +
  `ticket_booking_items` (snapshot product/variant_name + unit_price +
  season_kind) + `ticket_settings.booking_slug` (index unik parsial;
  input di Pengaturan Tiket, super_admin). Lib: `booking.ts` murni
  (mesin status — `terbayar` tak bisa mundur, terminal buntu; kode/token
  generator; jendela tanggal hari-ini..+90 WIB) + `booking-server.ts`
  (resolusi slug anti-enumerasi, katalog publik hitung-ulang resolver
  v2 — varian bolong harga disembunyikan, tanggal blok-online →
  produk hilang; lazy expiry tanpa cron) + `xendit/client.ts` (invoice
  API, mock `XENDIT_MOCK=1`, webhook token fail-closed) +
  `public/rate-limit.ts` (sliding window in-memory, kunci
  `cf-connecting-ip` dulu — XFF bisa dipalsukan). API publik:
  catalog / POST create (harga DIHITUNG ULANG server, zod, retry 23505
  kode, invoice gagal → booking `dibatalkan` rapi 502) / webhook
  Xendit (401 token salah, idempotent via UPDATE-WHERE-status, WA
  best-effort) / status by-token (404 generik). D3: wizard publik
  mobile-first `/booking/[slug]` (tanggal → tiket ber-qty → pemesan →
  ringkasan → redirect invoice) + `/booking/status/[token]` (poll 10
  dtk saat menunggu; QR `booking_code` saat terbayar) — wrapper tipis
  pola offer-portal, robots noindex. Middleware: prefix publik
  `/booking` + `/api/public/booking`. Gate hasil — security review
  0 CRITICAL, 1 HIGH ditutup (rate limit kini kunci `cf-connecting-ip`
  pola offer-respond; XFF-only bypass tertutup), 2 MEDIUM ditutup
  (webhook cek silang `amount` vs total — toleransi 1 rupiah utk
  pembulatan; `XENDIT_MOCK` di production teriak di log), webhook kini
  ber-rate-limit 120/mnt. Code review 0 CRITICAL, 1 HIGH ditutup
  (**race lazy-expiry vs webhook telat: PAID kini juga membangkitkan
  `kedaluwarsa` — uang menang atas tebakan expiry; `dibatalkan` TIDAK
  dibangkitkan, di-log "perlu refund manual"**), MEDIUM ditutup:
  pembulatan 2dp per baris + total (konvensi ledger B), invoice Xendit
  rupiah bulat, denylist slug reserved (status/webhook/catalog/api) di
  server+UI. Verifikasi: 763 unit test lulus (11 booking + 6 xendit
  baru; token webhook salah ditolak fail-closed), lint bersih, tsc
  bersih (error pre-existing purchasing/xp tak tersentuh), build lulus,
  smoke SQL D1 8/8 (idempotensi PAID, unique code/invoice, CHECK, expiry
  tak sentuh terbayar) rollback, smoke API LIVE end-to-end di dev
  (katalog → booking mock 135rb → 401 token salah → PAID nominal
  kurang di-ignore → PAID sah → terbayar → dobel no-op → 404 token
  ngawur; halaman wizard & status 200) — booking smoke dihapus.
  Catatan dev: `XENDIT_MOCK=1` + `XENDIT_WEBHOOK_TOKEN` dev sudah di
  `.env`; slug venue `sulu`; distribusi website TKT-0001 dinyalakan
  utk QA. PRASYARAT PRODUKSI tetap: key Xendit asli + set webhook URL
  di dashboard Xendit. Sisa: D4 redeem loket → visit prepaid net-0,
  D5 dashboard kelola booking.
- 2026-07-22 — **Fase D4+D5 SELESAI — Fase D TUNTAS** (status `coding`;
  sisa epic = Fase E Laporan & Ops). D4 redeem loket: tombol "Redeem
  Booking" di loket → dialog scan/ketik kode (`normalizeBookingCode`
  memaafkan huruf kecil/prefix hilang, charset anti-ambigu tetap
  ditegakkan) → lookup ber-tenant + lazy expiry → tap gelang per varian
  (auto-assign ke jatah yang belum penuh, progress N/M per item;
  `matchRedeemBands` murni menolak kurang/lebih/varian asing — 10 unit
  test baru) → `POST bookings/[id]/redeem`: booking dikunci FOR UPDATE,
  hanya `terbayar` + `visit_date` = hari-H WIB, gelang dikunci ORDER BY
  id, visit PREPAID kanal website tanpa plafon, ledger = debit `tiket`
  per gelang (snapshot `unit_price` booking, price_context ber-
  `booking_id`) + kredit `pembayaran` metode `xendit` senilai total →
  net 0; asersi Σdebit = total (selisih >1 sen → 409, tolak ledger
  pincang); transisi `terbayar→digunakan` + `used_at` + `visit_id`
  atomik. Gate tap dipatch: visit ber-asal booking (cek `ticket_bookings
  .visit_id` ber-tenant) TIDAK di-charge — tap pertama hanya menandai
  masuk (master berubah ≠ tagihan berubah); re-entry per ticket tetap.
  Index unik parsial `uq_ticket_bookings_visit` menegakkan 1 booking =
  1 visit sekaligus meng-indeks lookup gate. D5: menu "Booking"
  (`ticketing.booking`, super_admin, delta
  `20260722150000_ticketing_fase_d5_booking_menu.sql` applied) →
  halaman `/dashboard/ticketing/booking`: filter tanggal/status/cari,
  dialog rincian (items snapshot, timeline dibuat/dibayar/dipakai, link
  invoice saat menunggu), aksi: batalkan (atomik UPDATE-WHERE-status,
  `terbayar` WAJIB catatan refund), tandai refund manual (PATCH
  `refund_note`, uang di luar sistem), kirim ulang WA (hanya
  `terbayar`, helper `booking-wa.ts` diekstrak dari webhook — satu
  sumber pesan). Gate hasil — security review 0 CRITICAL/HIGH; MEDIUM
  ditutup (rate limit cancel/refund-note 20/mnt; GET list/detail sengaja
  tanpa limit, konsisten route ticketing lain), LOW ditutup (query
  booking di gate tap kini ber-filter tenant). Code review APPROVE 0
  CRITICAL/HIGH; MEDIUM ditutup (index unik visit_id), LOW ditutup
  (asersi ledger). Catatan tindak lanjut (LOW, disengaja): (1) event
  "PAID utk booking dibatalkan / nominal kurang" masih hanya
  console.error — kandidat surfacing di dashboard Booking nanti;
  (2) rate limiter in-memory per proses (util lama) — kandidat Redis
  bila multi-instance; (3) role: pos/pos_supervisor bisa redeem tapi
  kelola booking (batal/refund/resend) khusus super_admin — by design
  MVP, konfirmasi owner bila loket perlu resend WA. Verifikasi: 773
  unit test lulus, lint bersih, tsc bersih (error pre-existing tak
  tersentuh), build lulus, migrasi applied (menu + index terverifikasi
  di DB), PM2 restart, smoke live: app 200, API booking 401 tanpa auth
  (fail-closed), halaman dashboard redirect login, menu ter-grant
  super_admin. QA manual owner: buat booking mock → bayar (XENDIT_MOCK)
  → redeem di loket hari-H → tap gate (tanpa charge ganda) → cek
  dashboard Booking.
- 2026-07-22 — **Rombongan bernama** (revisi owner, status `coding`).
  Tiap unit tiket dalam booking = satu anggota (`ticket_booking_guests`,
  delta `20260722170000` applied: posisi global unik per booking,
  denormalisasi variant_id, backfill booking hidup via LATERAL
  generate_series). Nama boleh diisi pemesan per unit di wizard
  (langkah pemesan, tampil bila qty > 1); kosong → default server
  `buildGuestNames`: posisi 1 = nama pemesan, sisanya "Group {pemesan}
  - N" (murni + unit test; smoke live BK-VSPEZN: "Ilham", "Budi
  Santoso" (diisi), "Group Ilham - 3"). Redeem D4 diubah dari
  per-varian ke PER-ANGGOTA: kontrak `bands[{nfc_uid, guest_id}]`,
  `matchRedeemGuests` (bijeksi penuh — kurang/dobel/guest asing
  ditolak; `matchRedeemBands` dihapus), harga debit dari snapshot item
  guest ybs (net-0 + asersi tetap), nama menempel ke
  `ticket_visit_bands.guest_name` → tampil di rincian visit loket dan
  layar gate ("Budi Santoso · Ticket — Adult (rombongan Ilham)").
  Dialog redeem: daftar anggota ber-ceklis + tap gelang auto-assign ke
  anggota berikutnya, select pindah pasangan hanya menawarkan anggota
  yang belum dapat. Status page publik + dashboard Booking menampilkan
  daftar anggota. Gate hasil — code+security review APPROVE 0
  CRITICAL/HIGH; MEDIUM ditutup (batas bands redeem disamakan
  `BOOKING_MAX_QTY` 20, bukan 50); LOW dicatat (bulk insert guests bila
  latensi jadi isu; key index di status page publik). Verifikasi: 776
  unit test lulus (+3), lint/tsc bersih, build lulus, migrasi applied +
  backfill terverifikasi (BK-X5QJHG), smoke live end-to-end: create
  booking rombongan 3 nama parsial → status guests benar → webhook
  PAID → terbayar (BK-VSPEZN siap QA redeem hari-H).
- 2026-07-22 — **Fase P SELESAI** (Ticket Bundling / Paket, status
  `coding`). Delta `20260722180000` applied: `product_kind`
  (single/bundle) di `ticket_products`, tabel `ticket_bundle_items`
  (komponen = varian tiket satuan × qty, UNIQUE per paket, FK
  RESTRICT), kolom jejak paket di `ticket_visit_bands` +
  `ticket_booking_guests` (`bundle_product_id`, `bundle_unit_no`,
  `allocated_price`, `member_label`). Lib murni `bundle.ts`:
  `expandBundleMembers` + `allocateBundlePrice` (prorata pembulatan
  KUMULATIF 2dp — Σ per unit selalu tepat = harga paket, tak ada bagian
  negatif; bobot bolong → bagi rata; 8 unit test). Master Ticket: buat
  ticket ber-jenis (paket → satu varian "Paket", wajib Draft), tab
  Komposisi (replace-all `PUT bundle-items`, kandidat = varian satuan
  Active, pembanding harga satuan vs paket), guard aktivasi
  (komposisi kosong/komponen nonaktif → tolak); Channel Manager &
  katalog otomatis ikut karena paket = produk. Loket: opsi paket ber-
  `members_per_unit`, dialog registrasi "+ Tambah unit paket" (tap
  mengisi slot anggota berurutan), server memetakan gelang → varian
  komponen + `allocated_price` snapshot saat REGISTRASI; gate tap
  men-charge alokasi tanpa resolve matriks (branch `allocated_price
  IS NOT NULL`). Website: katalog memuat `members` per varian paket
  (bobot override-aware), blok-online KOMPONEN ikut memblok paket,
  kuota & nama rombongan dihitung per ORANG (1 unit paket = N nama),
  create meledakkan guest per anggota ber-alokasi; redeem D4 memakai
  `allocated_price` guest (fallback `unit_price`) — asersi net-0 tetap.
  Keputusan desain: bundle sesama tiket saja (tiket+F&B ditunda,
  bentuknya nanti voucher entitlement); harga paket fixed manual, bukan
  diskon terhitung; musim alokasi ikut kalender PAKET. Verifikasi: 67
  unit test ticketing lulus (742+ total), tsc/eslint bersih, build
  lulus, migrasi applied, PM2 restart, smoke katalog publik OK
  (`product_kind` tampil, produk lama utuh). Belum ada data paket di
  dev — QA owner: buat paket via Master Ticket → Komposisi → aktifkan →
  distribusi kanal → uji loket & booking.
- 2026-07-22 — **Fase E SELESAI (laporan) + tampilan hemat paket** (status
  `coding`). (1) Laporan Ticketing: delta `20260722190000` applied (menu
  `ticketing.reports` → `/dashboard/ticketing/reports`, akses super_admin
  + pos_supervisor; kasir 'pos' tidak dapat). API `GET
  /api/ticketing/reports?from&to` (default 7 hari, maks 92, hari
  operasional WIB): SEMUA angka uang NET dari ledger — baris void
  (`koreksi` kredit) di-atribusikan ke jenis & price_context baris ASAL
  via `voided_by_charge_id`, jadi revenue yang di-void tidak
  menggelembung. Isi: ringkasan (kunjungan, orang masuk/re-entry/tap
  ditolak dari gate_events, tiket/F&B/denda net, uang masuk, refund
  keluar), deret harian, rincian tiket per produk/kanal/musim/paket
  (dari `price_context`: variant_id → nama via master; baris alokasi
  paket ber-`bundle_product_id` masuk tabel "Kontribusi Paket", musim
  tampil "alokasi paket"), uang masuk per metode
  (deposit/pembayaran/refund − rekonsiliasi kasir), rekap gelang
  (keadaan kini), tab menggantung (visit open ber-outstanding > 0,
  keadaan kini, limit 50). UI `features/ticketing/reports` (stat cards +
  tabel harian + 4 tabel agregat + metode + gelang/menggantung).
  Sambungan closing report shift POS = BELUM (uang masuk per metode per
  hari sudah cukup utk rekonsiliasi manual; integrasi shift menyusul
  bila owner minta). (2) Wizard booking publik: kartu paket kini
  menampilkan harga coret total satuan + badge "Hemat RpX" — hanya bila
  SEMUA bobot anggota terisi dan totalnya > harga paket (tidak
  menampilkan klaim hemat dari data bolong). Verifikasi: 67 unit test
  ticketing lulus, tsc/eslint bersih, build lulus, migrasi applied, PM2
  restart, SQL laporan tervalidasi langsung ke DB dev (ledger masih
  kosong pasca-wipe R1 — angka baru muncul setelah ada transaksi).
- 2026-07-22 — **Gelang Karyawan (free access) SELESAI** (Fase E ops,
  status `coding`). Keputusan desain (pertanyaan owner "pengaturan di
  karyawan atau di mana?"): pairing hidup di modul TICKETING (Pengaturan
  Tiket → seksi "Gelang Karyawan"), BUKAN di profil karyawan HRIS —
  gelang = aset venue (scoping branch), wewenang pairing di ops venue
  bukan HRD, siklus hidup gelang lepas dari kepegawaian; tabel
  `ticket_staff_passes` hanya MENUNJUK `hris.employees`. Delta
  `20260722200000` applied: status gelang baru `karyawan` (CHECK
  diperluas), tabel pass ber-riwayat (revoke = is_active false; unique
  parsial: 1 gelang aktif per karyawan per venue & sebaliknya). API:
  GET/POST `/api/ticketing/staff-passes` (pair: gelang wajib `tersedia`,
  karyawan wajib aktif → status gelang `karyawan`), DELETE
  `/[id]` (cabut → gelang balik `tersedia`); picker karyawan numpang
  `/api/hris/employees?is_active=true`. Gate tap: cek staff pass SEBELUM
  lookup kunjungan → `masuk-karyawan` (ok, tanpa charge, bebas
  keluar-masuk, layar gate "SELAMAT BEKERJA") atau
  `ditolak-karyawan-nonaktif` bila karyawan resign tapi pairing lupa
  dicabut (fail-closed). Registrasi loket/redeem otomatis menolak gelang
  karyawan (syarat status `tersedia` existing). Registry gelang: badge
  ungu `Karyawan`, ubah status manual ke `karyawan` ditolak (diatur
  pairing), gelang karyawan tak bisa diubah dari registry sebelum
  pairing dicabut. Laporan: `masuk_karyawan` dihitung terpisah (tidak
  mencemari "tap ditolak"). Verifikasi: 67 unit test lulus, tsc/eslint
  bersih, build lulus, migrasi applied, PM2 restart. QA owner: Pengaturan
  Tiket → Gelang Karyawan → Pasangkan Gelang (tap gelang tersedia + pilih
  karyawan) → tap di Gate.
- 2026-07-22 — **Penutupan keputusan owner + task medium SELESAI**
  (status **ready-for-qa** — sisa dev = Xendit produksi, menyusul).
  Semua commit EPIC-022/023 di-push ke origin/development. Keputusan
  owner ditutup: (1) gelang hilang TANPA denda, ditagih by data
  (nama/WA); (2) kategori cukup Adult/Child + opsi varian tunggal
  "Umum"; (3) penempatan fleksibel branch/venue baru (tenancy existing
  cukup, nol kode). Implementasi delta `20260722210000` applied:
  (a) **Flow gelang hilang** — endpoint
  `POST /visits/[id]/bands/[bandId]/lost` (lock visit+band, visit_band
  & registry → 'hilang'; gate/F&B/registrasi otomatis menolak karena
  guard `status='aktif'`/'tersedia' existing; tagihan tetap di ledger →
  tertagih saat settlement rombongan; TIDAK ada baris denda) + tombol
  "Hilang" ber-konfirmasi di rincian kunjungan loket, badge merah.
  Ketemu lagi → registry set 'tersedia' (jalur existing, setelah
  settlement). (b) **Varian tunggal** — `variant_preset`
  (`adult-child`/`umum`) di create product; pilihan "Umum — satu harga
  semua umur" di dialog Buat Ticket; downstream (harga/kanal/loket/
  gate/booking) generik, nol perubahan (paket sudah 1 varian).
  (c) **Anomali webhook di-surface** — kolom `ticket_bookings
  .webhook_alert` diisi saat PAID-nominal-janggal / PAID-utk-dibatalkan
  (tetap console.error); dashboard Booking: badge "⚠ perlu perhatian"
  di list + kotak merah di rincian + tombol "Sudah Ditindaklanjuti"
  (PATCH `clear_webhook_alert`). Catatan: rate limiter Redis TIDAK
  dikerjakan (kondisi multi-instance belum ada — prasyarat scale-out);
  integration test route ber-uang tetap hutang teknis (butuh infra mock
  auth); role kelola booking tetap super_admin (konfirmasi owner belum
  ada). Verifikasi: 67 unit test lulus, eslint bersih, tsc bersih
  (error pre-existing .next/purchasing tak tersentuh), build lulus,
  migrasi applied, PM2 restart. **SISA EPIC: Xendit produksi saja** —
  key asli + webhook URL di dashboard Xendit + matikan `XENDIT_MOCK`
  (owner: "menyusul").
- 2026-07-22 — **Akses loket ke menu Booking** (keputusan owner: poin 3
  daftar tindak lanjut — loket boleh bantu pengunjung). Delta
  `20260722220000` applied: menu `ticketing.booking` granted `pos` +
  `pos_supervisor` (read; super_admin tetap read+update). Server: GET
  list/detail booking + POST resend-wa kini `TICKETING_OPERATOR_ROLES`;
  **cancel + PATCH (refund_note / clear_webhook_alert) TETAP
  super_admin** (ditegakkan server, bukan cuma UI). UI: page guard
  operator + prop `canManage` — loket melihat daftar/rincian & tombol
  "Kirim Ulang WA"; tombol Batalkan, editor catatan refund, dan tombol
  tutup alert webhook disembunyikan (alert tetap tampil + instruksi
  "laporkan ke admin"; catatan refund tampil read-only bila ada).
  Verifikasi: eslint bersih, build lulus (BUILD_ID dicek), migrasi
  applied (grant terverifikasi query DB), PM2 restart, smoke: app 307
  login, API booking 401 tanpa auth. Daftar tindak lanjut medium kini
  TUTUP SEMUA kecuali yang berkondisi: Redis limiter (tunggu
  multi-instance) & integration test ber-uang (task infra terpisah).
- 2026-07-23 — **Pengakuan revenue booking + kebijakan hangus SELESAI**
  (keputusan owner hari ini: uang booking terbayar = titipan, revenue
  diakui saat redeem — SUDAH sesuai desain net-0 D4; kebijakan hangus
  CONFIGURABLE, diisi nanti sesuai SOP). Delta `20260723090000` applied:
  `ticket_settings.booking_forfeit_days` (0-365; NULL = kebijakan belum
  diisi → perilaku lama: redeem hanya hari-H, tidak ada yang hangus) +
  status booking baru `hangus` (CHECK diperluas) + `forfeited_at`
  (tanggal pengakuan pendapatan hangus). Semantik masa berlaku: redeem
  boleh hari-H s/d H+N (`redeemWindowStatus`/`isForfeitDue` murni di
  booking.ts, unit test lintas bulan); lewat itu → hangus. Mesin status:
  `terbayar → hangus`; hangus TERMINAL, tidak dibangkitkan (uang sudah
  lama masuk — koreksi manual). Penghanguskan 3 lapis idempotent
  (UPDATE-WHERE-status='terbayar' AND visit_id IS NULL): watcher per jam
  (`booking-forfeit-watcher.ts` via instrumentation, forfeited_at
  deterministik) + lazy di lookup loket (kebenaran terkini) + saat
  redeem ditolak karena lewat jendela (booking terkunci FOR UPDATE).
  Laporan Ticketing: kartu **Titipan Booking** (terbayar belum redeem —
  keadaan kini, pendapatan diterima di muka) + **Pendapatan Hangus**
  (by forfeited_at dalam rentang). UI ikutan: input masa berlaku di
  Pengaturan Tiket (kosong = belum aktif + penjelasan), label/badge
  Hangus di dashboard Booking & status page publik. Catatan akuntansi
  utk finance: baris `pembayaran xendit` di ledger tercatat tanggal
  REDEEM (revenue), tanggal uang fisik masuk = `paid_at` booking
  (rekonsiliasi kas Xendit pakai itu). Verifikasi: 808 unit test lulus
  (71 ticketing, +4 jendela redeem), eslint bersih, build lulus, migrasi
  applied (kolom + CHECK diverifikasi query DB), PM2 restart, app
  online. QA owner: isi "Masa Berlaku Redeem Booking" di Pengaturan
  Tiket (mis. 0) → booking terbayar kemarin otomatis hangus ≤1 jam
  (atau seketika saat di-lookup loket) → cek kartu laporan.
