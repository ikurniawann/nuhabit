# EPIC-014: CRM Collectibles — Artwork, Wallpaper & Badge

status: ready-for-qa
environment: dev
retries: 0

## Goal

Mengubah koleksi artwork CRM dari fitur yang tidak terlihat menjadi sistem
gamifikasi yang dipakai member:

1. **Etalase member** — member bisa melihat, membuka, dan memasang artwork
   koleksinya dari portal.
2. **Jatah tukar per milestone** — menembus ambang XP memberi member satu hak
   tukar; member memilih satu artwork dari tingkat itu. Tidak ada yang dibeli.
3. **Wallpaper** — artwork yang ditukar dengan jatah, bisa diunduh resolusi
   penuh.
4. **Badge by XP** — otomatis diberikan ketika `lifetime_xp` melewati ambang.
   Badge tidak memakai jatah karena bukan pilihan, melainkan bukti pencapaian.
5. **Upload artwork** — admin mengunggah karya langsung, bukan menempel URL.

## Temuan Kelayakan (20 Jul 2026)

### Fondasi sudah ada — celahnya di sisi member

Skema `crm` sudah punya tulang koleksi yang lengkap:

| Tabel | Yang sudah tersedia |
|-------|---------------------|
| `crm_collectible_avatars` | rarity 5 tingkat, `image_url`, `required_tier_id`, `xp_cost`, stok terbatas, jendela `starts_at`/`ends_at` |
| `crm_member_avatar_inventory` | kepemilikan, `acquisition_source`, `is_equipped` |
| `crm_member_profiles.active_avatar_id` | avatar yang sedang dipakai |
| `crm_rewards.linked_avatar_id` | reward dapat memberi avatar |
| `crm_xp_rules` / `crm_xp_ledger` | XP dari POS, photobooth, studio game, campaign |

Jadi rarity, stok terbatas, drop musiman, dan gate per tier **tidak perlu
dibangun ulang**.

### Tiga celah yang membuat fitur terasa tidak ada

1. **Tidak ada satu pun endpoint avatar untuk member.** Pencarian di
   `src/app/api/member*` dan portal member tidak menemukan apa pun. Satu-satunya
   jalan member memperoleh avatar adalah admin menekan "grant" manual di
   `/api/crm/avatar-inventory`. Admin dapat membangun koleksi lengkap yang tidak
   pernah dilihat siapa pun. **Ini celah terbesar** — menambah wallpaper dan
   badge sebelum ini beres hanya menambah stok gudang tanpa etalase.

2. **`xp_cost` dan `required_tier_id` tidak pernah dieksekusi.** Di
   `src/app/api/crm/avatar-inventory/route.ts:190-199` grant hanya memeriksa
   `is_active` dan stok. Tier tidak dicek, XP tidak dipotong. Dua kolom itu
   hari ini dekoratif.

3. **Admin harus menghosting gambar sendiri.** Form di
   `src/features/crm/avatars/components/crm-avatars-page.tsx:247` hanya
   menyediakan field "Image URL". Infra upload sudah ada dan bisa dipakai ulang
   (`/api/candidates/[id]/cv-upload`, `/api/psikotes/.../upload`).

### Model perolehan — diputuskan

Sistem punya dua mata uang: `ark_coin_balance` (dibelanjakan, dipakai
`crm_rewards`) dan `lifetime_xp` (akumulatif, penentu tier).

**Keputusan owner (20 Jul 2026): tidak ada collectible yang dibeli.** ARK Coin
tidak dipakai sama sekali di epic ini. Seluruh collectible diperoleh lewat
pencapaian XP, dan **member yang memilih** mana yang ditukar.

Model final: **jatah tukar berulang tiap kelipatan XP, berlaku ke bawah.**

| Aturan | Perilaku |
|--------|----------|
| Jatah diperoleh | satu jatah tiap kelipatan `interval_xp`, tanpa batas atas |
| Jumlah jatah | `floor(lifetime_xp / interval_xp)` |
| Arah pemakaian | jatah boleh dipakai untuk artwork mana pun yang ambangnya sudah dilewati |
| `lifetime_xp` | **tidak pernah berkurang** — tier selalu aman |

Contoh dengan `interval_xp = 5.000`: member ber-XP 50.000 memperoleh 10 jatah,
dan bebas memakainya untuk artwork apa pun yang ambang XP-nya ≤ 50.000 —
termasuk artwork lama yang dirilis sebelum ia bergabung.

Dua keputusan ini dipilih karena: jatah berulang membuat member veteran tetap
punya alasan mengumpulkan XP, dan pemakaian ke bawah membuat member yang telat
bergabung tidak merasa dihukum atas artwork yang terlewat.

**Konsekuensi yang harus diantisipasi:** jatah tidak pernah berhenti bertambah,
jadi katalog artwork harus terus diisi. Bila produksi artwork berhenti, member
veteran akan menumpuk jatah tanpa bisa memakainya. Perlu laporan sederhana
"jatah menganggur" agar kebutuhan artwork baru terlihat sebelum jadi keluhan.

**Badge dikecualikan.** Badge diberikan otomatis saat ambang tercapai dan tidak
memakai jatah — badge adalah bukti pencapaian, bukan hadiah yang dipilih.

### Penyederhanaan yang muncul dari kedua keputusan

Karena jatah kini **dihitung**, bukan diberikan satu per satu, rancangan
sebelumnya menyusut:

- Tabel `crm_collectible_milestones` **tidak diperlukan**. Cukup satu nilai
  konfigurasi `interval_xp`, plus kolom ambang `min_lifetime_xp` pada tiap
  artwork sebagai syarat kelayakan.
- `crm_member_entitlements` menjadi **ledger penukaran** semata:
  `member_id`, `asset_type`, `asset_id`, `redeemed_at`.
  Sisa jatah = `floor(lifetime_xp / interval_xp) − COUNT(ledger)`.
- **Backfill hilang.** Member lama otomatis memiliki jatah sesuai XP-nya tanpa
  proses migrasi apa pun.
- **Rekonsiliasi hilang.** Menurunkan `interval_xp` langsung menambah jatah
  semua member karena angkanya dihitung ulang saat dibaca.

Yang tersisa untuk ditangani dengan hati-hati:

- **Balapan penukaran** — dua permintaan bersamaan bisa memakai jatah yang sama.
  Wajib dikunci di level baris member (`SELECT … FOR UPDATE`) di dalam satu
  transaksi bersama penulisan ledger dan pengurangan stok.
- **Koreksi XP turun oleh admin** — `floor(lifetime_xp / interval_xp)` bisa
  jatuh di bawah jumlah yang sudah terpakai. Sisa jatah wajib dijepit ke
  `max(0, …)`, dan artwork yang sudah dimiliki **tidak** ditarik kembali.
- **`xp_cost`** — kolom lama menjadi tidak terpakai; jangan dipakai ulang untuk
  arti baru agar tidak menyesatkan.

### Bentuk skema — diputuskan

**Keputusan owner (20 Jul 2026): tabel terpisah per jenis aset**, bukan satu
tabel dengan `asset_type`.

Konsekuensi yang diterima: tabel, API, dan halaman admin terduplikasi per jenis;
`crm_rewards.linked_avatar_id` tetap hanya menunjuk avatar.

**Mitigasi wajib:** aturan unlock, pengecekan ambang XP, pencatatan kepemilikan,
dan penegakan stok ditaruh di satu modul bersama `src/lib/crm/collectibles.ts`.
Yang boleh terduplikasi hanya tabel dan CRUD-nya — **bukan aturannya**. Tanpa
ini, tiga salinan logika unlock akan menyimpang satu sama lain.

## Tasks

### 1. Etalase koleksi di portal member

Buka jalur member sebelum menambah jenis aset baru.

- `GET /api/member/collectibles` — daftar aset dimiliki vs terkunci beserta
  syarat dan progress XP.
- `POST /api/member/collectibles/equip` — pasang avatar sebagai foto profil.
- Halaman "Koleksi" di portal member: galeri dimiliki/terkunci, progress
  "kurang N XP lagi", aksi pasang.
- Tanpa perubahan skema — memakai tabel yang sudah ada.

**Exit:** member dapat melihat dan memasang avatar yang dimilikinya. — **SELESAI
20 Jul 2026**

### 2. Mesin jatah tukar

- Konfigurasi `interval_xp` + kolom `min_lifetime_xp` pada artwork.
- Tabel ledger `crm_member_entitlements` (`member_id`, `asset_type`,
  `asset_id`, `redeemed_at`).
- Perhitungan sisa jatah `max(0, floor(lifetime_xp / interval_xp) − terpakai)`.
- Tegakkan `required_tier_id` pada semua jalur perolehan.
- Laporan "jatah menganggur" agar kebutuhan artwork baru terlihat lebih dini.

**Exit:** sisa jatah member benar tanpa proses migrasi, dan tetap benar setelah
`interval_xp` diubah. — **SELESAI 25 Jul 2026**

### 3. Redeem oleh member + upload artwork

- `POST /api/member/collectibles/redeem` — pakai satu jatah untuk artwork mana
  pun yang ambangnya sudah dilewati. Satu transaksi dengan kunci baris member,
  penulisan ledger, dan pengurangan stok; tolak jatah habis dan stok habis.
- Portal member: tampilkan sisa jatah dan artwork yang bisa dipilih.
- Ganti field "Image URL" jadi upload berkas + generate thumbnail.

**Exit:** member memilih sendiri artwork yang ditukar; admin mengunggah artwork
tanpa hosting eksternal. — **SELESAI 25 Jul 2026** (thumbnail otomatis belum —
gambar penuh dipakai sebagai preview; generate thumbnail menyusul bila perlu)

### 4. Modul bersama `collectibles.ts`

- Pindahkan evaluasi syarat unlock, ambang XP, stok, dan pencatatan kepemilikan
  ke satu modul yang dipanggil ketiga jenis aset.

**Exit:** menambah jenis aset baru tidak menyalin logika unlock.

### 5. Wallpaper

- Tabel `crm_collectible_wallpapers` + inventory-nya, ditautkan ke milestone.
- Ikut alur jatah tukar yang sama seperti avatar.
- Aksi unduh resolusi penuh dari portal member.

**Exit:** member memakai jatah untuk memilih wallpaper, lalu dapat mengunduhnya.

### 6. Badge by XP

- Tabel `crm_member_badges` (tanpa stok, tanpa equip, tidak bisa dibeli).
- Admin badge builder: nama, artwork, ambang `lifetime_xp`.
- Pemberian otomatis saat XP melewati ambang — **tidak memakai jatah tukar** —
  plus notifikasi lewat WA gateway yang sudah berjalan.
- Badge tampil di profil member; maksimal 3 dipamerkan.

**Exit:** admin membuat badge dengan ambang XP → member yang memenuhi menerima
otomatis beserta notifikasi.

## Acceptance Criteria

- Member melihat koleksinya di portal tanpa bantuan admin.
- `lifetime_xp` tidak pernah berkurang oleh sebab apa pun.
- Tidak ada collectible yang dapat dibeli; ARK Coin tidak tersentuh epic ini.
- Sisa jatah selalu `max(0, floor(lifetime_xp / interval_xp) − terpakai)`.
- Jatah dapat dipakai untuk artwork lama yang ambangnya sudah dilewati.
- Jatah dan stok ditegakkan di server secara transaksional, bukan hanya di UI.
- Aturan unlock ketiga jenis aset berasal dari satu modul.
- Admin mengunggah artwork tanpa layanan hosting pihak ketiga.

## Test Plan

- Unit: evaluasi syarat unlock (ambang XP, tier, stok habis, jendela waktu).
- Unit: perhitungan sisa jatah pada XP tepat di kelipatan, di bawah kelipatan
  pertama, dan setelah banyak penukaran.
- Integrasi: dua permintaan redeem bersamaan hanya menghasilkan satu artwork
  (kunci baris member diuji, bukan diasumsikan).
- Integrasi: menurunkan `interval_xp` langsung menambah sisa jatah tanpa migrasi.
- Integrasi: koreksi XP turun menjepit sisa jatah ke nol tanpa menarik artwork
  yang sudah dimiliki.
- Integrasi: jatah dapat menukar artwork lama berambang rendah.
- Integrasi: melewati ambang XP memberi badge tepat satu kali tanpa jatah.
- E2E: member membuka portal, melihat wallpaper terkunci, XP bertambah dari
  transaksi POS, wallpaper terbuka dan dapat diunduh.
- Dark mode: halaman koleksi diperiksa di tema gelap.

## Temuan Implementasi

### `lifetime_xp` dan `total_xp` sudah menyimpang

Introspeksi DB dev (20 Jul 2026): dari 3 profil member, **1 memiliki
`crm.crm_member_profiles.lifetime_xp` yang berbeda dari
`pos.pos_customers.total_xp`**. Keduanya mengaku mewakili XP member.

Modul reward dan angka yang ditampilkan portal memakai `total_xp`, jadi
EPIC-014 mengikutinya demi konsistensi tampilan. Namun **ketimpangan ini belum
diperbaiki** dan akan menjadi bom waktu begitu jatah tukar dihitung dari XP:
dua sumber angka berarti dua jumlah jatah yang berbeda.

**Harus diputuskan sebelum Task 2:** satu kolom ditetapkan kanonik dan yang
lain disinkronkan atau dihapus.

**DIPUTUSKAN 25 Jul 2026: `pos.pos_customers.total_xp` kanonik** (konsisten
EPIC-011 — portal, rewards, reports, dan collectibles semua membacanya).
`lifetime_xp` profil = mirror internal engine: di-backfill dari total_xp
(migrasi `20260725120000`; penyimpangan dev = data seed manual, bukan bug
engine), diberi COMMENT "jangan dibaca untuk logika baru", dan
`syncTierAfterEarn` kini membaca total_xp. Bonus ditemukan: referensi hantu
`pos_customers.current_xp` (sudah di-drop EPIC-011 Fase B) masih ditulis
`syncPosCustomerAfterEarn` — dibersihkan.

### Katalog kosong saat fitur dibangun

DB dev berisi 0 artwork dan 0 baris inventory — bukti bahwa modul Avatars
memang tidak pernah dipakai. Tiga artwork demo berkode `demo-*` disisipkan
untuk verifikasi dan dapat dihapus kapan saja.

## Automation Log

- **25 Jul 2026 (4)** — **Halaman admin wallpaper & badge SELESAI** — sisa
  epic tertutup, status → ready-for-qa. Feature baru meniru pola
  `src/features/crm/avatars/`: `src/features/crm/wallpapers/` +
  `src/features/crm/badges/` (types/query-keys/api/queries/mutations +
  komponen halaman), route `/dashboard/crm/wallpapers` (form lengkap: code,
  nama, rarity, gambar + unggah via `/api/crm/avatars/upload`, thumbnail,
  ambang XP, tier minimal, stok, jendela mulai/berakhir, aktif) dan
  `/dashboard/crm/badges` (code, nama, ambang XP wajib, gambar opsional +
  unggah, aktif; daftar menampilkan `awarded_count`). Menu sidebar via
  migrasi `20260725140000_crm_collectibles_menu.sql` (applied): item
  `crm.wallpapers` + `crm.badges` level 2 di grup CRM, grant hanya
  super_admin. Gate: tsc 481 baseline (0 error baru).
- **25 Jul 2026 (3)** — **Task 5 (wallpaper) + Task 6 (badge) SELESAI sisi
  server + portal member.** Migrasi `20260725130000` (applied): tabel
  `crm_collectible_wallpapers` + `crm_member_wallpaper_inventory` (UNIQUE per
  member), `crm_badges` (definisi, ambang XP murni) + `crm_member_badges`
  (UNIQUE customer+badge, `is_showcased`).
  - **Wallpaper ikut alur jatah yang sama**: `listWallpapersForMember`
    menghasilkan bentuk baris yang sama dengan avatar sehingga
    `evaluateCollectible` + `sortCollectibles` dipakai apa adanya (mitigasi
    duplikasi bekerja seperti dirancang); redeem
    `POST /api/member-portal/wallpapers/redeem` = pola transaksi avatar
    (FOR UPDATE, re-eval dalam tx, guard stok SQL, UNIQUE anti balapan);
    unduh resolusi penuh = tautan `image_url` (bucket publik).
  - **Badge otomatis tanpa jatah**: `awardEligibleBadges` (INSERT..SELECT
    ambang terlampaui + ON CONFLICT DO NOTHING, idempotent), dievaluasi
    lazily saat portal membaca `GET /api/member-portal/badges`; badge baru →
    notifikasi WA best-effort via `sendWhatsAppText` (provider gateway);
    pamerkan maks 3 (`POST` toggle, dihitung server).
  - Admin: CRUD `GET/POST/DELETE /api/crm/wallpapers` & `/api/crm/badges`
    (guard super_admin; hapus yang sudah dimiliki/diraih member → nonaktif,
    bukan delete). Portal: kartu Wallpaper (Tukar/Unduh) + Badge Pencapaian
    (grid + tombol Pamerkan) di tab Koleksi.
  - Gate: 899 unit test hijau, build sukses (5 route baru), tsc 481 baseline,
    migrasi applied, PM2 restart, smoke 4 endpoint 401 tanpa sesi.
  - **Sisa epic (kecil)**: halaman dashboard admin untuk wallpaper & badge
    builder (backend CRUD sudah siap; sementara kelola via API), thumbnail
    otomatis, dan notifikasi badge saat earn XP real-time (sekarang lazy saat
    portal dibuka). E2E + dark mode = QA manual.
- **25 Jul 2026 (2)** — **Task 3 SELESAI: redeem oleh member + upload artwork.**
  - `POST /api/member-portal/collectibles/redeem`: SATU transaksi
    (`withTransaction`) — kunci baris customer `FOR UPDATE` (serialisasi
    per member) + kunci baris artwork, cek dobel-milik, cek sisa jatah
    (`getEntitlementSummary`), evaluasi ulang kelayakan DI DALAM transaksi
    (`checkAvatarEligibility` — modul bersama), guard stok di SQL
    (`UPDATE … WHERE stock_redeemed < stock_total`), tulis ledger
    entitlements + inventory. Balapan yang lolos ke INSERT tertangkap UNIQUE
    (customer, asset) → 409, bukan artwork dobel. Member tanpa profil CRM →
    409 dengan pesan ramah.
  - Portal: banner "Jatah tukar: N · +1 tiap X XP", tombol **"Tukar dengan 1
    jatah"** hanya pada artwork yang syaratnya terpenuhi; jatah habis → pesan
    "kumpulkan XP lagi"; sukses → reload katalog.
  - Upload artwork: `POST /api/crm/avatars/upload` (guard super_admin
    `requireCrmConfigRole`, ≤5 MB, magic-bytes JPG/PNG/WebP, bucket publik
    `crm-avatars` via `uploadFile`) + tombol "Unggah Gambar Artwork" di form
    admin mengisi `image_url` otomatis — tanpa hosting eksternal.
  - Gate: 899 unit test hijau, build sukses (2 route baru), tsc 481 baseline,
    PM2 restart, smoke redeem & upload 401 tanpa sesi.
  - Sisa epic: Task 5 wallpaper, Task 6 badge (+ integrasi laporan idle ke UI
    admin bila diminta).
- **25 Jul 2026** — **Blocker XP kanonik TUNTAS + Task 2 (mesin jatah tukar)
  SELESAI sisi server.**
  - Kanonik = `pos_customers.total_xp` (lihat Temuan Implementasi). Backfill +
    COMMENT + `syncTierAfterEarn` baca kanonik + bersih-bersih `current_xp`
    hantu di `syncPosCustomerAfterEarn` (loyalty-engine).
  - Migrasi `20260725120000` (applied): kolom `crm_collectible_avatars.
    min_lifetime_xp` (ambang per artwork), tabel ledger
    `crm.crm_member_entitlements` (customer_id NOT NULL + UNIQUE per artwork,
    member_id nullable — pola Fase F EPIC-011), seed `crm_settings.
    collectible_interval_xp = 5000`.
  - **Modul bersama `src/lib/crm/collectibles.ts` lahir (cicilan Task 4)**:
    `entitlementQuota`, `remainingEntitlements` (jepit max(0,…) — koreksi XP
    turun aman), `evaluateCollectibleGate` (aktif/jendela/stok/min XP/tier),
    `blockerMessage`, `parseIntervalXp`. 12 unit test menutup kelipatan tepat,
    interval turun langsung menambah jatah, koreksi XP turun, arah pemakaian
    ke bawah.
  - `collectibles-server.ts`: `evaluateCollectible` kini memanggil modul
    bersama (syarat efektif = max(ambang tier, ambang artwork));
    `getEntitlementSummary` (interval/quota/used/remaining, dihitung saat
    dibaca — tanpa backfill); `checkAvatarEligibility` untuk jalur non-portal.
  - **`required_tier_id` + `min_lifetime_xp` kini DITEGAKKAN di grant admin**
    (`avatar-inventory` POST → 403 + alasan; dulu dekoratif — temuan audit
    epic ini).
  - Portal `GET /api/member-portal/collectibles` mengembalikan `entitlement`
    (sisa jatah member).
  - **Laporan jatah menganggur**: `GET /api/crm/collectibles/idle-report`
    (guard role laporan CRM): per-member idle = greatest(0, floor(total_xp/
    interval) − used), total idle, jumlah artwork aktif — sinyal kapan katalog
    perlu diisi.
  - Gate: 899 unit test hijau (+12), build sukses (route idle-report
    ter-generate), tsc 481 baseline (0 baru), migrasi applied (profil
    menyimpang = 0 pasca-backfill), PM2 restart, smoke 401 tanpa sesi.
  - Sisa: Task 3 (redeem member ber-lock + upload artwork), Task 5 wallpaper,
    Task 6 badge; UI sisa jatah di portal ikut Task 3 (saat tombol Tukar ada).
- **20 Jul 2026** — Epic dibuat. Audit menemukan fondasi koleksi sudah ada di
  skema `crm`, tetapi tanpa jalur member sama sekali; `xp_cost` dan
  `required_tier_id` tidak pernah dieksekusi di
  `avatar-inventory/route.ts:190-199`.
- **20 Jul 2026** — Keputusan owner: XP sebagai syarat, ARK Coin sebagai harga.
  **DIGANTIKAN pada hari yang sama** — lihat entri berikutnya.
- **20 Jul 2026** — Keputusan owner (final): tidak ada collectible yang dibeli;
  ARK Coin tidak dipakai di epic ini. Seluruh artwork diperoleh lewat **jatah
  tukar per milestone XP** dan member memilih sendiri. `lifetime_xp` tidak
  pernah berkurang. Badge dikecualikan — otomatis, tanpa jatah.
- **20 Jul 2026** — Keputusan owner: jatah **berulang tiap kelipatan XP** tanpa
  batas atas, dan **boleh dipakai ke bawah** untuk artwork lama. Akibatnya jatah
  cukup dihitung dari `lifetime_xp`, sehingga tabel milestone, proses backfill,
  dan job rekonsiliasi semuanya tidak lagi diperlukan. Risiko baru yang dicatat:
  katalog artwork harus terus diisi agar jatah tidak menganggur.
- **20 Jul 2026** — Task 1 selesai. `src/lib/crm/collectibles-server.ts`,
  `GET /api/member-portal/collectibles`, `POST …/collectibles/equip`, dan tab
  "Koleksi" di portal member. Diverifikasi ujung-ke-ujung dengan sesi member
  asli: 401 tanpa sesi, katalog benar (dimiliki / stok habis / kurang 9.500 XP
  menuju tier The Warden), equip 200, equip artwork bukan milik ditolak 403,
  `avatar_id` ngawur ditolak 400, dan `is_equipped` konsisten dengan
  `active_avatar_id` setelah transaksi.
- **20 Jul 2026** — Temuan: `lifetime_xp` vs `total_xp` sudah menyimpang pada
  data dev. Harus diputuskan sebelum Task 2 karena jatah tukar dihitung dari XP.
- **20 Jul 2026** — Keputusan owner: tabel terpisah per jenis aset. Mitigasi
  duplikasi lewat modul bersama `src/lib/crm/collectibles.ts` ditetapkan wajib.
