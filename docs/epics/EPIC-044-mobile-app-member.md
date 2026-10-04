# EPIC-044: Mobile App Member — Expo/React Native (Portal Member Native)

status: on-progress
environment: dev
retries: 0

## Goal

Membawa Portal Member (`/member`, EPIC-011 + EPIC-014) menjadi **aplikasi
mobile native (iOS & Android)** berbasis **Expo/React Native** dengan fokus
membership experience yang tidak bisa diberikan web: **QR member sebagai
identitas di kasir** (pengganti kartu NFC fisik) dan **push notification**
transaksional. Kode app tinggal di folder `mobile/` dalam repo dashboard dan
mengonsumsi API `/api/member-portal/*` yang sudah ada — backend tidak ditulis
ulang, hanya diperluas untuk auth mobile.

## Keputusan Perencanaan (2026-08-25)

Hasil diskusi perencanaan dengan owner:

1. **Framework: Expo/React Native** (bukan PWA / Capacitor wrap) — kualitas
   native tertinggi; push notif, QR, biometrik, dan deep link jadi jalur
   pertama kelas.
2. **Lokasi kode: folder `mobile/` di repo dashboard.** Tanpa restrukturisasi
   monorepo/workspace; `package.json` mandiri di dalamnya. Tipe data diduplikasi
   dulu (minimal), sinkronisasi tipe menyusul bila terasa perlu.
3. **Scope V1 = paritas penuh fitur portal**: login OTP WA, beranda saldo/XP/
   tier, riwayat wallet & order, profil (+foto), reward + redeem portal,
   koleksi avatar/wallpaper/badge (EPIC-014) — plus QR member dan push notif.
4. **Fitur native inti V1: QR member + push notification.** Biometrik login dan
   scan NFC dari HP = fase lanjut (backlog dalam epic ini).
5. **Desain UI: Nox-inspired, bukan port pixel-perfect.** Glassmorphism CSS
   Nox Lab tidak dipindahkan mentah-mentah; app memakai tema gelap bernuansa
   sama (warna brand dari ThemeProvider dashboard) dengan nativewind.
6. **Auth mobile: perluasan sesi existing, bukan sistem baru.**
   - `POST /api/member-portal/verify` menambah mode klien app → token sesi
     mentah dikembalikan di body JSON (untuk disimpan di SecureStore).
   - Helper `getMemberSession()` menerima `Authorization: Bearer <token>`
     sebagai alternatif cookie `member_session`.
   - TTL, rate limit OTP, dan logout server-side tetap persis perilaku lama.
7. **QR member = kode acak statis revocable**, pola `pass_code` EPIC-028:
   kolom unik baru (mis. `pos_customers.member_qr_code`), payload TIDAK
   mengandung nama/HP/PII. Kasir scan → lookup by code → pilih member.

### Menunggu konfirmasi owner (tidak memblokir Fase A)

- Nama app di store ("Sulu Member"? "ARK Pass"?) + ikon/splash final.
- Akun Apple Developer ($99/th) & Google Play ($25 sekali) — infra di luar repo.
- Peristiwa push V1 yang disetujui (usulan: status redeem berubah + topup sukses).

## Fase

### Fase A — Fondasi app & auth mobile
- Scaffold Expo (expo-router, TypeScript, nativewind) di `mobile/`; API client
  berbasis `EXPO_PUBLIC_API_URL` (dev → tunnel `sulu.within.ventures`).
- Backend: verify kembalikan token utk klien app + `getMemberSession()` baca
  Bearer header (perilaku cookie lama tak berubah — portal web aman).
- Login 2 langkah (nomor → OTP WA via gateway existing), simpan token di
  expo-secure-store, guard rute, logout (hapus sesi server-side).

### Fase B — Beranda & wallet
- Kartu saldo ARK Coin / XP / tier + progres tier berikutnya (`GET /me`,
  konversi ark_rate di sisi app mengikuti adapter Nox).
- Riwayat wallet + order (`GET /transactions`), pull-to-refresh, state error
  riwayat ≠ portal mati (paritas perilaku `use-nox-member.ts`).

### Fase C — Profil
- Edit profil (zod-equivalent validasi; nomor HP read-only), upload foto
  (kamera/galeri → `POST /profile/photo`), progress kelengkapan + banner Free
  XP, consent WA switch, kunjungan (`GET /visits`).

### Fase D — Reward
- Katalog reward + syarat XP/tier + alasan belum layak, ajukan redeem (status
  pending → approval admin), daftar "Reward Saya", rate limit client-side
  selaras server (10/menit).

### Fase E — Koleksi (EPIC-014)
- Tab koleksi: avatar equip/redeem, wallpaper redeem (unduh resolusi penuh ke
  galeri HP = nilai tambah native), badge showcase maks 3.

### Fase F — QR member di kasir
- Migrasi kolom `member_qr_code` unik + backfill; expose via `/me`.
- App: kartu QR identitas member (layar siap-scan, brightness max).
- POS: tombol scan QR di pemilih member kasir → lookup by code (reuse pola
  pass-lookup EPIC-028). Identifikasi saja — tanpa jalur uang.

### Fase G — Push notification
- Tabel `crm_member_push_tokens` (customer_id, token, platform, enabled);
  register device pasca-login, unregister saat logout.
- Kirim transaksional: status redemption berubah (approved/ditolak/diserahkan),
  topup sukses. Tap notif → deep link ke layar terkait.
- Setup EAS credentials (APNs key + FCM); fallback pesan jika izin ditolak.

### Fase H — Release
- EAS Build (internal distribution dulu → UAT owner) → submission store;
  OTA updates via EAS Update untuk fix minor; crash reporting (opsional,
  Sentry) sebelum publik.

## Acceptance Criteria

- Member login di app hanya dengan OTP WA nomor terdaftar; rate limit OTP
  server berlaku identik untuk klien app (tanpa bypass).
- Token sesi tersimpan di secure storage (bukan AsyncStorage biasa); logout
  membuat sesi mati di server.
- Semua fitur portal klasik dapat diakses dari app: beranda/wallet/riwayat/
  profil/reward/koleksi (paritas fitur EPIC-011 Fase D+F + EPIC-014).
- Payload QR member tidak mengandung PII (nama/HP/email); scan kasir mengenali
  member yang benar; kode bisa dinonaktifkan/regenerate.
- Push notif diterima saat app foreground maupun background; tap membuka layar
  terkait; member yang logout berhenti menerima notif.
- Perubahan backend tidak merusak portal web existing (cookie flow tetap utuh).
- Free XP, redeem, dan topup tetap idempotent/atomik seperti acceptance
  EPIC-011 (app hanya konsumen API, tidak ada logika loyalty baru di client).

## Catatan Keterkaitan

- **EPIC-011** — sumber semua API portal (`/api/member-portal/*`) + sesi OTP;
  epic ini konsumen, bukan pengganti. Portal web tetap hidup.
- **EPIC-014** — API koleksi sudah lengkap (collectibles/equip/redeem,
  wallpapers, badges); Fase E murni UI app.
- **EPIC-028** — pola `pass_code` + pass-lookup jadi referensi desain QR member
  (Fase F).
- **EPIC-033** (lifecycle campaign, backlog) — tabel push tokens di Fase G
  menjadi kanal kampanye push di masa depan, berdampingan broadcast WA.
- **wa-gateway mandiri** (`docs/crm/RUNBOOK-WA-GATEWAY-MANDIRI.md`) — OTP app
  memakai jalur yang sama; runbook berlaku juga untuk app.
- CORS tidak dibutuhkan untuk build native (fetch RN tidak menerapkan CORS);
  baru relevan bila app juga dibuka lewat Expo Web.

## Automation Log

- 2026-08-25 — Epic dibuat dari sesi perencanaan mobile app bersama owner:
  arah Expo/RN, kode di `mobile/` dalam repo dashboard, scope V1 paritas penuh
  + QR member + push notification. Status backlog — menunggu owner menandai
  on-progress.
- 2026-08-25 — **Fase A SELESAI: fondasi app & auth mobile.**
  - **Backend (perluasan minimal, portal web tak berubah):** `session.ts`
    kini menerima `Authorization: Bearer <token>` via helper
    `bearerTokenFromAuthHeader` (pure, 3 unit test) — Bearer diprioritaskan
    di atas cookie agar klien app eksplisit tidak tersandung cookie sisa
    browser; `getMemberSession`/`destroyMemberSession` otomatis ikut, jadi
    logout Bearer mematikan sesi server-side. `POST /verify` mengembalikan
    `data.token` di body HANYA bila klien mengirim header `x-app-client: 1`
    (portal web tanpa header itu tetap menerima jawaban lama tanpa token).
  - **App:** scaffold `create-expo-app` template default (Expo SDK 57,
    RN 0.86, React 19.2, expo-router di `src/app/`, typed routes) di
    `mobile/`; demo template dihapus. Struktur baru: `lib/session.ts`
    (SecureStore: iOS Keychain/Android Keystore), `lib/api.ts` (client
    `/api/member-portal/*`: base URL `EXPO_PUBLIC_API_URL`, Bearer otomatis,
    normalisasi jawaban), `hooks/use-auth.tsx` (state loading/authed/guest;
    token divalidasi ke /me saat app dibuka — sesi mati → guest),
    `app/login.tsx` (2 langkah nomor→OTP), grup `(app)` dengan guard layout,
    `app/(app)/home.tsx` (bukti /me hidup: nama/tier/XP/saldo). `app.json`:
    nama "Sulu Member", scheme `sulumember`. `.env` lokal gitignored.
  - **Catatan deviasi kecil:** nativewind DITUNDA — template SDK 57 membawa
    theming sendiri (ThemedText/ThemedView + token warna); StyleSheet cukup
    utk Fase A dan nativewind bisa menyusul saat UI Fase B menuntut.
  - **Gotcha tertangkap:** tsconfig dashboard (include `**/*.ts`) ikut
    membaca `mobile/src` → +65 error tsc palsu (alias `@/` & tipe RN tak
    dikenal). Fix: `"mobile"` masuk exclude tsconfig dashboard; mobile punya
    tsconfig sendiri (`npx tsc --noEmit` bersih).
  - **Gate:** unit test dashboard 1687 hijau (197 file, +3 bearer parser);
    tsc dashboard 510 = identik baseline sebelum perubahan (0 baru);
    `next build` sukses. Verifikasi end-to-end via curl pada dev server
    lokal (:3459, dev bypass OTP aktif): verify+`x-app-client:1` → token di
    body → GET /me Bearer 200 (member uji "Uji ARK Coin", Bronze, 554 XP)
    → tanpa auth 401 → logout Bearer sukses → token lama 401. Sesi uji
    terhapus via logout.
  - LANJUTKAN DARI SINI → **Fase C**: profil — edit field (HP read-only),
    upload foto dari kamera/galeri (`POST /profile/photo`), progress
    kelengkapan + banner Free XP, consent WA, kunjungan (`GET /visits`).
- 2026-08-25 — **Fase B SELESAI: beranda & riwayat.**
  - `lib/loyalty.ts`: port murni `idrToArkDisplay` (pembulatan ≥0,5 ke atas,
    nilai mutlak utk negatif) + `CREDIT_TXN_TYPES` + label txn + formatter
    id-ID (angka/Rp/tanggal Asia/Jakarta) + `tierProgressPercent`
    (progres dihitung ANTARA tier kini dan berikutnya dari array `tiers`,
    bukan dari nol platform).
  - `hooks/use-member-data.ts`: /me + /transactions paralel; riwayat gagal ≠
    portal mati (profil tetap tampil + flag `historyError`) — paritas
    perilaku adapter Nox dashboard.
  - Home dirombak: kartu saldo ARK (+≈ Rp), badge tier + kunjungan, kartu XP
    dengan bar progres antar-tier ("N XP lagi menuju Silver"), dua section
    riwayat (Transaksi Koin maks 10, Riwayat Belanja maks 10 — order ARK
    tampil berdampingan "Rp … / … ARK"), pull-to-refresh, empty/error state.
  - **BUG paritas tertangkap via data dev riil:** DB menyimpan amount wallet
    `payment` sebagai angka POSITIF — arah debit ditentukan TIPE
    (`CREDIT_TXN_TYPES.has(type)`), sama dengan `isCreditEntry` di
    `src/lib/wallet/ledger.ts` (dipakai portal member web). Implementasi awal
    mewarnai dari tanda angka → payment tampil hijau "+23 ARK" (terbalik).
    Fix: helper `txnSignedArk`/`isCreditTxn` (kredit "+" abs, debit "−" abs)
    + test kasus data riil (payment +23000 → −23 ARK).
  - Test mobile: vitest ditambahkan ke `mobile/` (config node minimal);
    11 test konversi loyalty hijau — kasus pembulatan disalin dari
    `loyalty-settings.test.ts` dashboard agar kedua sisi senada.
  - Gate: vitest mobile 11 hijau; `tsc --noEmit` mobile bersih; tsc
    dashboard tetap 510 = baseline. Verifikasi live: login Bearer member uji
    → `/transactions` mengembalikan 20 wallet + 25 order dan ter-mapping ke
    model tampilan; sesi uji di-logout setelahnya.
  - LANJUTKAN DARI SINI → **Fase C**: profil — edit field (HP read-only),
    upload foto dari kamera/galeri (`POST /profile/photo`), progress
    kelengkapan + banner Free XP, consent WA, kunjungan (`GET /visits`).
