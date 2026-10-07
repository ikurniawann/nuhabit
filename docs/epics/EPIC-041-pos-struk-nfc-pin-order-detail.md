# EPIC-041: POS — Struk ARK/XP, PIN Kartu NFC, & Pembenahan Order List/Detail

status: backlog
environment: dev
phase: 1
priority: P1
area: Fullstack

## Goal

Enam revisi/fitur POS dari owner (2026-08-20), dikelompokkan jadi tiga paket kerja:

1. **Struk lebih informatif untuk member** — transaksi ARK Coin menampilkan harga
   dalam ARK, jumlah ARK yang dipakai, dan sisa saldo; XP yang didapat dan total
   XP member ikut tercetak.
2. **PIN untuk kartu NFC** — pairing kartu mewajibkan customer membuat PIN
   (bisa di-enable/disable dari konfigurasi), dan pembayaran NFC Tab
   memverifikasi PIN itu.
3. **Order list & detail yang jujur** — kasir dan pelaku void terlihat, diskon
   menampilkan persennya, dan status "pending" yang membingungkan dipindah dari
   list ke detail sebagai status dapur.

## Kondisi Sekarang

| Item | Kondisi | Bukti |
|---|---|---|
| Struk ARK | Baris `Bayar (ARK_COIN)` hanya menampilkan nominal Rupiah; tidak ada harga ARK, ARK terpakai, maupun sisa saldo | `src/components/pos/PrintReceipt.tsx` — tidak ada penyebutan ARK sama sekali di builder struk |
| Struk XP | XP tidak pernah tercetak di struk; XP di-award oleh loyalty engine SETELAH order dibuat | `pos.pos_xp_transactions` punya `order_id` + `xp_earned`; dialog member portal (EPIC dialog detail) sudah membacanya |
| PIN NFC | Tidak ada. `pos.pos_customers` punya `nfc_uid` + `card_issued_at` tapi TIDAK punya kolom PIN; pembayaran `nfc_tab` jalan tanpa verifikasi apa pun dari pemilik kartu | kolom dicek langsung di DB; `isMixedUnsupportedTender` di `central-cashier.ts` |
| Kasir & void di detail | Data SUDAH ada di DB (`pos_orders.cashier_id`, `voided_by`, `voided_at`, `void_reason`) tapi tidak ditampilkan di order detail | kolom dicek langsung; UI `orders-page.tsx` + `transaction-detail-body.tsx` |
| Diskon % | Order menyimpan `manual_discount_type`/`manual_discount_value` (bisa `percent`) tapi detail hanya menampilkan nominal Rupiah | kolom `pos_orders` |
| Status "pending" | **Jawaban pertanyaan owner:** `pending` = status FULFILMENT (dapur/KDS), bukan status pembayaran. Alur kasir membuat order lunas dengan `status='pending'`; status hanya jadi `completed` setelah SEMUA item F&B di-serve lewat layar KDS (`kds-status.ts`). Venue yang tidak disiplin KDS → order lunas tampil "pending" selamanya di list. Ini akar masalah yang sama dengan bug dashboard omzet (MR !13) | `orders-page.tsx:100,202,283` memakai `status` fulfilment sebagai filter & badge utama list |

## Tasks

### 1. Struk: blok ARK Coin (harga ARK, dibayar ARK, sisa saldo)

- [ ] `ReceiptPayload` + `buildReceiptEscPosLayout`/`buildReceiptHtml`: blok baru
      utk pembayaran `ark_coin` — `Harga: N ARK` (via `idrToArkDisplay`),
      `Dibayar: N ARK`, `Sisa saldo: N ARK (≈ Rp X)`. Hanya customer copy,
      tidak di copy dapur/bar (pola EPIC-040).
- [ ] Respons API pembayaran (`/api/pos/orders`) menyertakan `ark_balance_after`
      supaya kasir tidak perlu fetch kedua sebelum cetak — saldo HARUS snapshot
      setelah potong, bukan query terpisah yang bisa balapan dengan transaksi lain.
- [ ] Rate konversi dari `pos_loyalty_settings.ark_rate` (fetch ber-cache yang
      sudah ada di PrintReceipt — `decorateReceiptPayload`).
- [ ] Test: struk ARK memuat 3 baris itu; struk non-ARK tidak berubah byte-per-byte.

### 2. Struk: XP didapat + total XP member

- [ ] Respons API pembayaran menyertakan `xp_earned` (dari award loyalty engine
      yang jalan di transaksi yang sama) dan `xp_total_after` member.
      CATATAN URUTAN: struk dicetak segera setelah bayar — XP harus sudah
      ter-award sebelum respons dikirim (sudah begitu di `create-mixed-checkout`;
      verifikasi jalur order tunggal).
- [ ] Baris struk (customer copy, hanya bila member terpasang & xp_earned > 0):
      `XP +N · Total: M XP`.
- [ ] Non-member / XP 0: baris tidak muncul, struk lama tidak berubah.

### 3. Kartu NFC ber-PIN (konfigurasi + pairing + verifikasi bayar)

- [ ] Migrasi: `pos_customers.nfc_pin_hash` (nullable) — hash bcrypt, BUKAN
      plaintext, pola yang sama dengan `hashSecret` OTP portal.
- [ ] Konfigurasi enable/disable: kolom `nfc_pin_required boolean` di
      `pos.pos_loyalty_settings` (master POS yang sudah ada) + toggle di halaman
      ARK & XP settings. Default OFF supaya kartu lama tidak mendadak terkunci.
- [ ] Pairing kartu (alur penerbitan kartu di kasir): bila konfigurasi ON,
      customer WAJIB set PIN 6 digit saat kartu di-pair; kartu lama tanpa PIN
      diminta set PIN pada transaksi pertama berikutnya.
- [ ] Pembayaran `nfc_tab`: bila konfigurasi ON dan customer punya PIN →
      prompt PIN di PaymentModal, verifikasi server-side sebelum saldo dipotong;
      salah 5x → tolak & minta ke kasir (jangan lockout permanen tanpa jalan
      keluar). Bila konfigurasi OFF → alur lama persis.
- [ ] Test: hash tidak pernah bocor ke respons API; verifikasi salah tidak
      memotong saldo; toggle OFF = perilaku lama.

### 4. Order detail: kasir & pelaku void

- [ ] API order detail menyertakan nama kasir (`cashier_id` → join karyawan)
      dan, bila ada void, `voided_by` (nama), `voided_at`, `void_reason`.
- [ ] UI detail (orders-page + transaction-detail-body): baris "Kasir: X";
      blok void merah "Di-void oleh Y · waktu · alasan" bila ada.

### 5. Order detail: diskon tampil dengan %

- [ ] Bila `manual_discount_type='percent'` → label `Diskon (10%) −Rp X`;
      `fixed` → tetap nominal saja. Berlaku juga utk diskon per-item yang
      menyimpan `discount_type`/`discount_value` di `pos_order_items`.

### 6. Order list: pisahkan status pembayaran dari status dapur

- [ ] Badge utama di list = STATUS PEMBAYARAN (Lunas / Belum bayar / Void) —
      bukan status fulfilment. Order lunas tidak boleh tampil "pending" di list.
- [ ] Status dapur (`pending/preparing/served/completed`) pindah ke order
      detail saja, dilabeli jelas "Status dapur".
- [ ] Filter status di list ikut disesuaikan (hapus filter `pending` yang
      ambigu; ganti dengan filter pembayaran + filter "belum selesai dapur"
      bila masih dibutuhkan operasional).
- [ ] Sinkron dengan definisi omzet (MR !29): void/cancelled/merged tetap
      terlihat di list dengan badge-nya, tapi jangan pernah berlabel "Lunas".

## Acceptance Criteria

- Struk transaksi ARK memuat harga ARK, ARK dibayar, sisa saldo ARK; struk
  non-ARK tidak berubah sama sekali.
- Struk member yang dapat XP memuat `XP +N · Total M`; struk non-member tidak.
- Dengan `nfc_pin_required=ON`: pairing tanpa PIN tidak bisa selesai; bayar
  NFC tanpa PIN benar ditolak sebelum saldo tersentuh. Dengan OFF: identik
  dengan sekarang.
- Order detail menampilkan kasir; order void menampilkan siapa/kapan/kenapa.
- Diskon persen tampil dengan angka %-nya.
- Tidak ada lagi order LUNAS berbadge "pending" di order list; status dapur
  tetap bisa dilihat di detail.

## Dependencies

- EPIC-040 (pola dekorasi struk & fetch settings ber-cache) — sudah selesai.
- Definisi pembayaran-lunas dari MR !13/!29 — sudah di production.
- Task 3 (NFC PIN) butuh migrasi DB di semua lingkungan; task lain tidak.

## Catatan Implementasi

- Task 1–2 menyentuh file yang sama (`PrintReceipt.tsx` + `/api/pos/orders`),
  kerjakan sebagai satu MR. Task 4–6 satu MR (semuanya orders UI/API).
  Task 3 MR terpisah — satu-satunya yang bawa migrasi & risiko alur bayar.
- Jangan cetak PIN, hash, atau nfc_uid di struk maupun log.
