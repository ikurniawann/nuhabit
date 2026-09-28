# EPIC-048: Self-Order Meja via QR — Aktivasi Penuh & UI Daftar Menu — `MODULE-POS`

status: ready-for-qa
environment: dev
phase: 1
priority: P1
area: Fullstack
module: `MODULE-POS`
retries: 0

## Goal

Menjadikan `/table-order/[tableCode]` (pesan dari QR meja) fitur produksi, bukan
prototipe: menu dari katalog POS yang sama dengan kasir, harga dihitung server,
member masuk lewat OTP WhatsApp (sesi portal member), bayar QRIS langsung dari
HP pemesan (Xendit, terikat order, auto-settle via webhook + polling), ARK Coin
untuk member, atau open bill di kasir; pesanan otomatis masuk KDS per station.
Tampilan daftar menu mengikuti referensi owner (`self.jpg`, gaya GoFood): baris
nama–deskripsi–harga di kiri, foto + tombol **Tambah** di kanan, tab kategori
sticky, tombol **Menu** mengambang, bar keranjang di bawah.

## Konteks & Temuan Audit (2026-09-12)

- Produksi `https://poskopi.reddie.id/api/table-order/products` mengembalikan
  **0 produk** → halaman jatuh ke menu demo dan tombol kirim mati. Repo lokal
  tidak punya `DATABASE_URL`, jadi isi `pos.pos_products` produksi belum bisa
  dipastikan — halaman kini menampilkan diagnosa (belum ada produk POS vs semua
  ditandai tidak tersedia) agar admin tahu langkah berikutnya.
- Celah keamanan pada versi lama: `unit_price`/`xp`/`station` dipercaya dari
  klien; `customer_id` dari body dipakai untuk memotong ARK Coin tanpa
  verifikasi (siapa pun yang tahu nomor HP member bisa membelanjakan saldonya
  lewat `customers/lookup` yang juga membuat member baru tanpa OTP); PPN
  hardcode 10% tidak mengikuti profil billing venue.
- Sudah ada infra yang tinggal disambung: Xendit QRIS order-bound
  (`/api/pos/qris`, `settleOrderQrisPayment`, webhook), OTP portal member
  (`/api/member-portal/otp|verify|me`), profil billing (`pos_billing_profiles`),
  `pos_order_type` enum sudah punya `takeaway`.

## Tasks

- [x] T-1 Lib murni `src/lib/table-order/{menu,pricing,order-status}.ts` + 21 unit test.
- [x] T-2 `GET /api/table-order/products` — SQL langsung `pos_products` aktif+tersedia
      (varian aktif, kategori urut `display_order`), `categories`, `meta` diagnosa.
- [x] T-3 `GET /api/table-order/session/[tableCode]` — resolve meja (qr_code/nomor/uuid,
      meja nonaktif ditolak), profil billing venue, brand, `qris_available`, `ark_rate`,
      status login member.
- [x] T-4 `POST /api/table-order/orders` — harga/XP/station dihitung ulang dari DB,
      varian asing & produk nonaktif → 409, member dari cookie sesi (ARK Coin tanpa
      sesi → 401), pajak/service via `calculateBillCharges`, `order_type`
      dine_in/takeaway, QRIS: gateway dicek sebelum insert (503 bila belum
      dikonfigurasi) lalu QR terikat order (`pos-ord-<id>`), rate limit 20/menit/IP.
- [x] T-5 `GET /api/table-order/orders/[id]` — status + item (kitchen_status), cek
      Xendit & settle otomatis bila lunas (cadangan webhook), `?qr=1` kirim ulang
      `qr_string` setelah reload.
- [x] T-6 Hapus `POST /api/table-order/customers/lookup` (buat member tanpa OTP).
- [x] T-7 UI baru `src/features/table-order/*`: hero + kartu venue + toggle
      dine-in/bawa pulang + chip member; kartu info; sticky cari + tab kategori
      (scroll-spy); seksi per kategori dengan `MenuItemRow` gaya referensi;
      tombol Menu mengambang; sheet varian, keranjang/pembayaran, member (OTP);
      layar pelacakan (antrean, stepper status, QRIS di HP + simpan gambar,
      polling). Keranjang & order aktif tersimpan di localStorage per meja.
- [x] T-8 Admin: Dashboard → POS → Tables → tombol **QR self-order** per meja
      (QR + URL, salin, unduh PNG, cetak kartu meja).
- [x] T-9 Test route `orders/route.test.ts` (10 kasus) — total 31 test hijau.
- [ ] T-10 QA di DEV/produksi: pastikan `pos_products` terisi & tersedia, gateway
      Xendit aktif di Settings → Payment Gateways (callback URL webhook), Fonnte
      OTP aktif, meja punya `qr_code`; uji QRIS sandbox end-to-end.

## Acceptance Criteria

- Scan QR meja → daftar menu tampil dari `pos_products` (kategori nyata), tanpa
  data demo; menu kosong menampilkan diagnosa, bukan produk palsu.
- Klien tidak bisa memanipulasi harga: order tersimpan dengan harga katalog
  + varian, pajak/service sesuai profil billing venue (bukti: test route).
- ARK Coin hanya untuk member ber-sesi OTP; tanpa sesi → 401, saldo utuh.
- QRIS: QR muncul di HP pemesan; setelah bayar (webhook atau polling) status
  berubah lunas tanpa campur tangan kasir; bila gateway belum dikonfigurasi,
  opsi QRIS tidak ditawarkan (503 sebelum order dibuat).
- Pesanan muncul di KDS sesuai station produk dan di daftar order kasir
  sebagai open bill (bayar di kasir) dengan nomor antrean.
- Tampilan daftar menu sesuai `self.jpg`: baris list (bukan grid), foto kanan
  dengan tombol Tambah menumpang, "Bisa custom" untuk produk ber-varian.

## Keputusan

- **Sumber katalog tetap `pos.pos_products`** (bukan `item.products`) — supaya
  `pos_order_items.product_id`, KDS, laporan, dan privilege `min_xp` konsisten
  dengan kasir. Produk Items masuk POS lewat sinkronisasi yang sudah ada.
- **Member = sesi portal member** (cookie `member_session`, path `/`) — tidak
  ada registrasi dari self-order (kebijakan EPIC-011 Fase D: daftar di kasir);
  nomor yang belum terdaftar diarahkan lanjut sebagai tamu.
- **Virtual Account dihilangkan** dari pilihan: belum ada integrasi VA di repo;
  menampilkan opsi mati lebih buruk daripada tidak ada.
- **`order_type` = `dine_in`/`takeaway`** (bukan `self_order`) agar semantik
  meja/KDS/laporan tetap; asal pesanan ditandai di `notes`/`special_requests`
  (`Self-service table order <kode>`).
- **Aksen warna memakai token brand** (`bg-primary` → `--brand-primary` dari
  Appearance) — layout mengikuti referensi, warna mengikuti brand BCD; ubah
  ke hijau referensi cukup lewat setting brand.
- Kode meja tak terdaftar tetap boleh memesan (`table_id` null, kode di
  catatan) — mode strict/signed token ditunda sampai QA menilai perlu.

## Automation Log

- 2026-09-12 — Epic dibuat dari permintaan owner ("kerjakan dan full diaktifkan
  fiturnya self order … UI menu list samakan dengan self.jpg"). Audit: API produk
  produksi kosong; 3 celah keamanan di route lama (harga dari klien, ARK Coin
  tanpa sesi, lookup membuat member tanpa OTP).
- 2026-09-12 — T-1…T-9 selesai. Gate: lint PASS (eslint 0 error di
  `src/{features,lib,app/api,app}/table-order` + `pos/tables`), type-check PASS
  (tsc 0 error di berkas terkait; 2 error lama di `tables-page.tsx` — prop
  ganda `searchPlaceholder` & `FLOOR_PRESETS` readonly — ikut diperbaiki),
  test PASS (vitest 4 berkas / 31 test). Status → `ready-for-qa`; T-10 butuh
  akses DB/gateway produksi yang tidak tersedia di workspace ini.
- 2026-09-12 11:09 WIB — Deploy produksi (`docker compose build/up wwwcoffee-app`
  di `/home/wit/docker-infra/bcdcoffee`, image `bcdcoffee:local`, container healthy).
  Verifikasi: `GET /api/table-order/session/TBL-501-SEED` → meja resolve
  (Table 5-01, Indoor), brand BCD Coffee, `qris_available=false` (Xendit
  belum aktif); `GET /api/table-order/products` → `meta.total_products=0`
  (katalog POS produksi kosong — menu baru tampil setelah produk diisi).
  Halaman `/table-order/TBL-501-SEED` HTTP 200. T-10 tersisa: isi
  `pos_products`, aktifkan Xendit + callback webhook, Fonnte OTP.
- 2026-09-12 — Seeder demo `database/seeders/bcdcoffee-self-order-demo.{sql,js}`
  (`npm run db:seed:bcdcoffee-self-order`): 4 kategori, 12 produk BCD-* ber-varian
  /XP/station/foto (1 khusus member `min_xp=100`), 2 member demo
  (081200000001 bronze · 081200000002 gold). Dijalankan di DB produksi
  (`docker exec wwwcoffee-db psql --single-transaction`) → API publik 12 produk
  (Kopi 5 · Non-Kopi 2 · Makanan 3 · Dessert & Pastry 2). Sisa T-10: Xendit
  + callback webhook, Fonnte OTP.
- 2026-09-12 — Foto produk: seeder diringkas ke 8 produk = 8 foto yang sudah
  ada di `public/products/*.png` (permintaan owner "ambil yang ada aja");
  produk BCD-* lama tanpa foto lokal dihapus (belum pernah dipesan). Temuan:
  `/products/*` dan `/qris/*` di-redirect ke /login oleh middleware auth →
  ditambahkan ke `PUBLIC_AUTH_PREFIXES` (+ test). Perlu rebuild container
  agar foto & logo QRIS tampil di halaman publik.
- 2026-09-12 — Bug QA owner: setelah memilih 1 menu lalu scroll ke bawah,
  halaman tidak bisa di-scroll kembali ke atas (HP). Penyebab: kunci scroll
  `body.style.overflow="hidden"` di BottomSheet rawan tidak pulih di Chrome
  Android/Safari iOS. Fix: `lockPageScroll()` (position fixed + simpan/pulihkan
  scrollY, efek hanya bergantung `open`, onClose via ref) + `overscroll-contain`;
  3 test jsdom (lock/unlock, tidak re-lock saat re-render, unmount). Vitest
  self-order 6 berkas / 38 test hijau. Perlu rebuild container.
