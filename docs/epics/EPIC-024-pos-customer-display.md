# EPIC-024: POS Customer Display — Layar Menghadap Customer + QRIS Dinamis

status: ready-for-qa
environment: dev
retries: 0

## Goal

Layar kedua di PC kasir yang menghadap customer: melihat item yang
dimasukkan ke cart secara realtime, subtotal/diskon/pajak/total, QR
QRIS ber-nominal terkunci saat bayar QRIS, kembalian saat tunai, dan
layar terima kasih. Kepercayaan customer = melihat angka yang sama
dengan yang diketik kasir.

## Keputusan Owner (2026-07-23)

1. **Hardware: monitor kedua PC kasir** (bukan perangkat terpisah) →
   transport **BroadcastChannel** antar-tab satu browser: latensi ~0,
   nol infra server, jalan offline. Kontrak state (`CfdState`) dibuat
   mandiri supaya jembatan SSE (perangkat terpisah) bisa menyusul
   membawa payload yang sama.
2. **QRIS dinamis via Xendit** (QR Codes API, nominal terkunci per
   transaksi) — dibangun sekarang di atas `XENDIT_MOCK=1` (pola
   ticketing D2); key produksi menyusul bersama ticketing.

## Desain

- **Kontrak & transport** `src/lib/pos/cfd.ts`: `CfdState`
  (idle/cart/payment/done + items/subtotal/discount/tax/ark_used/total/
  payment/member_name/done_change), `publishCfdState` (BroadcastChannel +
  snapshot localStorage — refresh display tidak kosong; event `storage`
  jadi fallback), `subscribeCfdState`, `firstNameOnly` (privasi: layar
  publik hanya nama depan member, tanpa nomor telepon).
- **Publisher**: cashier-page meng-publish state cart via useEffect
  (sinkronisasi ke sistem eksternal — guna sah effect); PaymentModal
  memancarkan state pembayaran via prop opsional `onCfdPayment`
  (metode/tunai-diterima/kembalian/QR); `storeResultPayload` = titik
  tunggal SEMUA jalur sukses bayar → publish `done` + kembalian.
  Display menahan layar done `CFD_DONE_HOLD_MS` (6 dtk) sebelum
  menerima idle (clearCart kasir langsung memancarkan idle).
- **Display** `/dashboard/pos/customer-display`
  (`features/pos/cfd/customer-display-page.tsx`): gelap fullscreen —
  idle (sambutan), cart (daftar item auto-scroll + salam member + panel
  total besar), payment (QRIS: QR 256px `qrcode.react` + nominal
  terkunci; tunai: diterima + kembalian besar), done (terima kasih +
  kembalian). Cara pakai: buka URL dari PC kasir, drag ke monitor
  kedua, F11.
- **QRIS dinamis**: `createQrisCode` di `lib/xendit/client.ts`
  (QR Codes API v2 `api-version: 2022-07-31`, DYNAMIC, expiry 30 mnt;
  mock = payload `MOCK-XENDIT-QRIS|...` yang tetap bisa dirender QR) +
  `POST /api/pos/qris` (sesi POS, rate limit 30/mnt, 503 rapi bila
  Xendit belum dikonfigurasi). PaymentModal membuat QR saat metode
  QRIS dipilih (sekali per nominal); gagal ≠ memblokir bayar — kasir
  lanjut QRIS statis di meja (panel status di modal).

## Non-Goals (fase ini)

- Auto-konfirmasi pembayaran QRIS via webhook Xendit (kasir masih
  konfirmasi manual seperti QRIS statis) — menyusul bersama key
  produksi + callback token.
- Jembatan SSE untuk perangkat display terpisah (kontrak sudah siap).
- Slideshow promo di layar idle (sambutan statis dulu).
- Split payment & self-order di display.

## Acceptance Criteria

- [x] Display menampilkan item + qty + harga + subtotal/diskon/pajak/
      ARK/total secara realtime saat kasir mengetik.
- [x] Metode QRIS → QR dinamis ber-nominal tampil besar di display;
      Xendit gagal/belum dikonfigurasi → degrade rapi tanpa memblokir.
- [x] Tunai → uang diterima + kembalian; sukses bayar → layar terima
      kasih ditahan ±6 dtk.
- [x] Member ter-tap → salam nama depan saja (privasi).
- [x] Display read-only murni; refresh tidak kosong (snapshot).

## Test Plan

- Unit: `firstNameOnly`, `parseCfdSnapshot` (data korup), pola state.
- Manual QA: buka `/dashboard/pos/cashier-fullscreen` + window kedua
  `/dashboard/pos/customer-display` → tambah item (muncul realtime) →
  pilih member → bayar QRIS (QR mock tampil) → bayar tunai (kembalian)
  → layar terima kasih.

## Automation Log

- 2026-07-23 — **Epic dibuat + MVP SELESAI satu sesi** (status
  ready-for-qa). Implementasi sesuai desain di atas. Verifikasi: unit
  test lulus, eslint bersih di file yang disentuh, build lulus, PM2
  restart, smoke: `/api/pos/qris` 401 tanpa sesi POS, halaman display
  ter-build. Catatan integrasi: publisher menumpang `storeResultPayload`
  (semua jalur sukses bayar online/offline/open-bill lewat situ — satu
  titik publish done); state pembayaran diangkat dari PaymentModal via
  prop opsional `onCfdPayment` sehingga pemakaian PaymentModal lain
  tidak terpengaruh. QRIS dinamis teruji dgn `XENDIT_MOCK=1`; saat key
  asli terpasang otomatis memakai API sungguhan. Fase lanjut yang
  disiapkan kontraknya: SSE bridge (tablet terpisah), webhook
  auto-confirm QRIS, promo slideshow idle.
- 2026-07-23 — **Akses menu ditambahkan** (pertanyaan owner "menunya di
  mana?"): (1) menu sidebar **POS → Operasional → Layar Customer**
  (delta `20260723150000`, grant menyalin persis pemegang menu Kasir:
  super_admin/admin/pos/pos_supervisor/demo); (2) tombol **"Layar
  Customer"** di header halaman kasir — window.open popup 1024×640
  supaya gampang di-drag ke monitor kedua lalu F11 (BroadcastChannel
  butuh sesama browser; window baru dari kasir = jalur paling pasti).
  Verifikasi: migrasi applied + grant dicek query DB, lint bersih (4
  error any pre-existing tak berubah), build lulus, PM2 restart.
- 2026-07-23 — **Fullscreen murni** (revisi owner: "tanpa navbar"):
  route pindah ke `/pos/customer-display` — DI LUAR layout
  /dashboard/pos (App Router tidak bisa opt-out layout induk, jadi
  halaman lama selalu kebungkus AppSidebar). Guard role server-side
  sendiri (pemegang menu Kasir); menu sidebar & tombol kasir menunjuk
  URL baru (delta `20260723160000` update route_path). Verifikasi:
  migrasi applied, build lulus, PM2 restart, smoke 307 login tanpa
  sesi.
