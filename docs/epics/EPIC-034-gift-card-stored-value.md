# EPIC-034: Gift Card / Stored Value — Saldo Prepaid Lintas Kanal

status: ready-for-qa
environment: local
retries: 0

## Goal

Menutup gap benchmark #8 (lihat
[`BENCHMARK-ticketing-vs-accesso.md`](./BENCHMARK-ticketing-vs-accesso.md)):
**gift card ber-saldo** — dibeli sekali (kasir/online), berisi nominal,
dipakai membayar berkali-kali sampai saldonya habis (partial redeem).
Berbeda dari voucher EPIC-032 (potongan sekali pakai): gift card adalah
UANG TITIPAN — liability yang diakui jadi revenue saat dipakai.

## Fondasi yang sudah ada (audit 2026-07-26)

1. **Pola kode unik bearer + CSPRNG** — `generateVoucherCode` EPIC-032
   (charset anti-ambigu); gift card = kode 10–12 char + PIN? (lihat OQ).
2. **Pola saldo + ledger append-only** — ARK Coin (`update_ark_coin_balance`
   RPC, debit atomik, guard insufficient) dan tab ticketing (ledger dua
   arah, `FOR UPDATE`, settlementPlan) — gift card mengikuti pola yang sama.
3. **Metode bayar kasir**: preseden `ark_coin` — "1 transaksi 1 metode",
   order pending → paid setelah debit sukses, kompensasi delete bila gagal.
   Gift card = metode bayar baru `gift_card` meniru alur ini persis.
4. **Jual online + kirim kode via WA**: pola pass/booking (Xendit invoice
   prefix baru + webhook branch + `sendXxxPaidWa`).
5. **Akuntansi titipan**: owner sudah menetapkan pola ini di EPIC-023
   (booking = titipan sampai redeem) — gift card identik: penjualan =
   liability, pemakaian = revenue.

## Usulan Arsitektur

Schema baru `giftcard` (tenancy penuh):

```
gift_cards      — code UNIQUE (bearer, CSPRNG), pin (opsional, hash),
                  initial_value, balance, status (pending|active|
                  disabled|exhausted|expired), expires_at NULL,
                  sumber jual (kasir order_id | xendit invoice), pembeli
                  (nama/WA utk kirim ulang), audit
gift_card_ledger — append-only: card_id, direction (isi|pakai|koreksi),
                  amount, context (pos_order|ticket_booking|manual),
                  context_id, saldo_setelah (snapshot), created_by
```

Kunci desain (mengikuti preseden yang terbukti):
- **Saldo = SUM ledger, kolom balance hanya cache** yang diverifikasi —
  atau balance + ledger dgn `FOR UPDATE` saat debit (pola tab). Pilih:
  `FOR UPDATE` + balance kolom + asersi vs SUM di smoke test.
- Debit atomik: `UPDATE ... SET balance = balance - $x WHERE id = $1 AND
  balance >= $x RETURNING` — gagal = saldo kurang (pola klaim-dulu).
- **Partial redeem**: dipakai sebagian → sisa tetap di kartu;
  `exhausted` saat 0.
- Kasir: metode bayar `gift_card` — **keputusan owner**: ikut preseden
  "1 transaksi 1 metode" (sama seperti ark_coin). Gift card menutup
  SELURUH total transaksi atau ditolak (saldo kurang → tidak bisa
  dipakai, kasir minta metode lain). Tidak ada split cash+gift_card
  dalam satu transaksi di MVP.

## Fase

| Fase | Scope (PR-sized) |
|---|---|
| **A** ✅ | Skema + lib murni (validasi kode/pin, matematika saldo, TDD) + terbit & kelola kartu di admin (menu Promo EPIC-032 diperluas: tab "Gift Card" — terbit manual/batch, lihat saldo & riwayat, disable) |
| **B** ✅ | Jual di kasir POS: produk khusus "Gift Card" (nominal preset/bebas) → kartu terbit `active` + struk berisi kode; uang masuk tercatat sebagai penjualan gift card (liability) |
| **C** ✅ | **Pakai di kasir POS**: metode bayar `gift_card` (input kode → tampil saldo → debit atomik ikut alur ark_coin: pending → paid, kompensasi bila gagal); koreksi saldo ber-audit (revisi 27 Jul — lihat Automation Log) |
| **D** | Jual & pakai ONLINE: beli gift card dari halaman publik (Xendit, kode dikirim WA — reuse pola pass) + redeem sebagai pembayaran booking online (mengurangi tagihan Xendit / menutup penuh) |
| **E** (lanjut) | Expiry + laporan liability (saldo mengendap per venue, breakage), top-up ulang kartu, kartu fisik NFC (reuse ticket_bands) |

Dependensi: A → B → C → D. B+C = MVP bermakna (jual & pakai di kasir).

## ⚠ Risiko

- **Jalur uang murni** — setiap fase B–D wajib review + smoke SQL + race
  test (dua kasir memakai kartu yang sama bersamaan → saldo tak boleh
  minus; pola advisory/FOR UPDATE EPIC-031/032).
- Bearer code = uang: kode wajib CSPRNG, tampil sekali di struk/WA,
  lookup di kasir TIDAK menampilkan kode lain (anti-enumerasi), audit
  siapa menerbitkan.
- Akuntansi: penjualan gift card TIDAK boleh dobel-hitung sebagai revenue
  saat dijual DAN saat dipakai — laporan POS perlu membedakan (fase E
  merapikan; MVP minimal tandai order penjualan gift card).

## Non-Goals

- Refund saldo ke uang tunai (kebijakan umum: tidak).
- Transfer saldo antar kartu.
- Integrasi ARK Coin (dua sistem saldo berbeda — jangan dilebur).

## Keputusan Owner (2026-07-26) — resolusi Open Questions

1. **Media MVP**: digital dulu (kode di struk + kirim WA). Kartu fisik
   NFC ditunda ke Fase E (reuse `ticket_bands`).
2. **PIN**: kode saja (bearer murni), tanpa PIN. Panjang 12 char CSPRNG
   charset anti-ambigu (reuse `generateVoucherCode` EPIC-032).
3. **Pembayaran kasir**: ikut preseden "1 transaksi 1 metode" (sama
   seperti ark_coin) — gift card menutup SELURUH total atau ditolak.
   Tidak ada split cash/QRIS + gift_card di MVP.
4. **Nominal & expiry**: keduanya **dapat dikonfigurasi** (bukan hardcode
   preset) — admin set nominal preset/bebas dan masa berlaku (atau tanpa
   expiry) per pengaturan tenant/produk, bukan angka tetap di kode.
5. **Jalur jual**: lewat produk POS biasa — gift card muncul sebagai item
   di laporan penjualan seperti produk lain. Fase E tetap perlu merapikan
   akuntansi liability supaya penjualan gift card tidak dobel-hitung
   sebagai revenue saat dijual (harus ditandai beda dari produk biasa
   sejak MVP, meski tampil di laporan penjualan yang sama).

## Automation Log

- 2026-07-26 — Epic dibuat dari gap benchmark #8 (keputusan owner: garap
  Tier 2). Audit fondasi: pola kode CSPRNG (EPIC-032), saldo atomik
  (ARK Coin), ledger dua-arah (tab EPIC-023), jual online + WA (pass
  EPIC-028), akuntansi titipan (EPIC-023). Status **backlog** — menunggu
  jawaban 5 open questions (paling menentukan: #3 full-cover vs split).
- 2026-07-26 — Owner jawab 5 OQ: (1) digital dulu, NFC ditunda Fase E;
  (2) kode saja tanpa PIN; (3) 1 transaksi 1 metode, full-cover only,
  tidak ada split pembayaran; (4) nominal & expiry keduanya
  **configurable**, bukan hardcode; (5) dijual lewat produk POS biasa,
  masuk laporan penjualan seperti produk lain (akuntansi liability tetap
  wajib ditandai beda sejak MVP). Status → **on-progress**, siap mulai
  Fase A.
- 2026-07-26 — **Fase A TUNTAS.** Schema `giftcard` (migrasi
  `20260726180000_gift_card_schema.sql`): `gift_cards` (code unik per
  branch, balance ≤ initial_value, status pending/active/disabled/
  exhausted/expired, expires_at configurable) + `gift_card_ledger`
  (append-only isi/pakai/koreksi, balance_after snapshot). Lib murni
  `src/lib/giftcard/giftcard.ts` (generateGiftCardCode 12 char CSPRNG
  reuse charset promo, evaluateGiftCardRedeem, computeBalanceAfterIssue/
  Correction) — TDD 18 test, RED→GREEN dulu sebelum implementasi. Admin
  UI: tab "Gift Card" di `/dashboard/promo` (in-page Tabs, bukan menu
  sidebar baru) — terbit single (dgn data pembeli) & batch (stok, maks
  500/panggilan), lihat saldo & riwayat per kartu (dialog), toggle
  aktif/nonaktif (guard: hanya dari status active/disabled, tidak bisa
  menyentuh pending/exhausted/expired). Guard route reuse
  `requirePromoContext` (peran + venue sama dgn Promo EPIC-032).
  Diverifikasi: 18/18 test lib lulus, smoke SQL manual (unique code,
  balance≤initial constraint, alur isi→pakai→exhausted, semua
  di-ROLLBACK), full typecheck (0 error baru), lint bersih, seluruh
  suite vitest 110 file/1027 test hijau, dan uji end-to-end nyata di
  browser (login super_admin, issue single+batch, toggle disable, buka
  riwayat) — semua data uji sudah dibersihkan dari DB dev. Catatan
  infra: role `arkiv_local` sempat tidak punya privilege `CREATE` di
  database (schema baru gagal dibuat) — sudah di-GRANT via superuser
  `postgres` supaya migrasi berikutnya tidak kena masalah yang sama.
  Siap lanjut **Fase B** (jual gift card sbg produk di kasir POS).
- 2026-07-27 — **KEPUTUSAN OWNER (revisi rencana Fase C).** Temuan saat
  membaca kode: `POST /api/pos/orders/[id]/void` MENOLAK void untuk order
  berstatus `completed`, sedangkan order berbayar gift card selalu jadi
  `completed` — artinya baris rencana "void order → saldo kembali" TIDAK
  bisa jalan tanpa melonggarkan guard yang melindungi semua metode bayar
  (ark_coin pun hari ini tidak pernah dikembalikan saat void). Owner
  memilih: **(1) kompensasi otomatis + koreksi manual admin** — order
  `completed` tetap tidak bisa di-void (konsisten cash/QRIS/ark_coin),
  saldo otomatis kembali HANYA bila debit sukses tapi langkah checkout
  berikutnya gagal, dan kasus lapangan diperbaiki lewat aksi **Koreksi
  Saldo** ber-audit di tab Gift Card (alasan wajib, tercatat di ledger +
  log server). Owner juga memilih **(2) kode gift card dikirim via WA
  otomatis bila kasir mengisi nomor pembeli**, struk tetap jalur utama.
- 2026-07-27 — **Fase B TUNTAS** (jual gift card di kasir).
  Skema: `pos.pos_products.product_kind` (`regular|gift_card`, migrasi
  `20260727100000`) — penanda liability sejak MVP sesuai keputusan owner
  #5, mengikuti preseden `ticket_products.product_kind`. Konfigurasi
  nominal & masa berlaku (keputusan owner #4) disimpan di
  `configuration.app_settings` key `giftcard_config` (pola
  `crm_campaign_config` EPIC-033) + UI "Konfigurasi Penjualan di Kasir" di
  tab Gift Card. Kasir: memilih produk gift card membuka dialog nominal
  (preset/bebas + jumlah kartu + data pembeli), kartu terbit `active`
  SETELAH order lunas — idempoten per order (retry tidak menggandakan
  kartu = uang). Kode tercetak di struk pelanggan (TIDAK di copy
  dapur/bar) dan dikirim via WA bila nomor pembeli diisi (best-effort,
  gateway mati tidak menggagalkan penjualan). Guard: gift card tidak boleh
  dibeli memakai saldo (`gift_card`/`nfc_tab`/`ark_coin`) — uang berputar
  tanpa kas masuk; belum didukung split bill.
- 2026-07-27 — **Fase C TUNTAS** (bayar pakai gift card).
  Enum `pos_payment_method` + `gift_card` (migrasi `20260727110000`,
  berdiri sendiri sesuai batasan PG). Debit di
  `src/lib/giftcard/giftcard-server.ts`: `SELECT ... FOR UPDATE` +
  evaluasi lib murni + ledger `pakai`, dalam satu transaksi — pola tab
  ticketing. Full-cover only; saldo kurang ditolak. Ditegakkan di KETIGA
  jalur pembayaran: order baru (`/api/pos/orders`), open bill
  (`PATCH /api/pos/orders/[id]`), dan split bill (ditolak rapi — satu
  kartu tidak bisa dibagi ke beberapa pembayar). Order dibuat `pending`
  dulu, `paid` setelah debit sukses; gagal → order dikompensasi (hapus /
  `cancelled`) + promo di-release. Baris `koreksi` ledger dilonggarkan
  jadi dua arah (migrasi `20260727120000`, preseden
  `ticket_visit_charges` EPIC-023) supaya refund (+) dan koreksi admin (−)
  tidak ambigu. Endpoint kasir `POST /api/pos/gift-card-check` (rate-limit
  20/menit, hanya kode persis — anti-enumerasi). UI: opsi "Gift Card" di
  PaymentModal dgn input kode + tombol Cek; hasil cek otomatis batal saat
  total keranjang berubah supaya saldo basi tidak lolos.
  **Diverifikasi:** 36/36 test lib murni (18 baru: config, expiry akhir
  bulan, status setelah refund, validasi nominal) — RED→GREEN;
  seluruh suite 110 file/1045 test hijau; typecheck 482 error (baseline
  HEAD 483 — nol error baru, satu malah terperbaiki); eslint bersih di
  semua file baru (baseline cashier-page identik 6 masalah). Smoke SQL
  ber-ROLLBACK: constraint balance ≤ initial_value, balance ≥ 0, kode
  ganda per branch, `pakai` negatif — semuanya MENOLAK; koreksi dua arah
  diterima. Uji integrasi DB dev (9 skenario, file sementara sudah
  dihapus, semua data uji bersih — `gift_cards` & ledger kembali 0 baris):
  terbit idempoten per order, debit full-cover → `exhausted`, saldo kurang
  ditolak tanpa mengubah saldo, **RACE dua kasir memakai kartu yang sama
  bersamaan → tepat SATU berhasil, saldo tidak minus**, debit dobel untuk
  order sama ditolak 409, kompensasi mengembalikan saldo & idempoten,
  koreksi admin menolak melebihi nilai terbit / saldo negatif, pratinjau
  `covers` benar & kartu tak dikenal tidak bocor. Keempat endpoint baru
  menolak akses tanpa sesi (401).
  **Sisa untuk QA owner (butuh login, tidak bisa diverifikasi otomatis):**
  klik-jual gift card di kasir → cetak struk → bayar transaksi lain dgn
  kode itu. Produk uji `GIFTCARD-01` sudah dibuat di DB dev.
  **Fase D+E belum digarap** (jual/pakai online via Xendit; expiry
  otomatis, laporan liability/breakage, top-up, kartu fisik NFC).
- 2026-07-27 — **Gerbang review keamanan (jalur uang) + perbaikannya.**
  - **HIGH DIPERBAIKI — dua kartu berbeda membayar satu order yang sama.**
    Debit mengunci baris KARTU (`FOR UPDATE`), lalu memeriksa "order ini
    sudah didebit?" lewat SELECT biasa. Dua permintaan bersamaan untuk
    order sama tapi kartu BERBEDA tidak pernah berebut lock yang sama →
    di READ COMMITTED keduanya lolos dan kartu kedua terkuras tanpa
    imbalan. Lock aplikasi tidak bisa menutupnya (kunci beda baris), jadi
    invarian dipindah ke DB: unique index parsial
    `gift_card_ledger_one_debit_per_pos_order` (migrasi `20260727130000`);
    `unique_violation` (23505) diterjemahkan jadi penolakan 409 dan
    transaksinya ROLLBACK sehingga saldo kartu kedua utuh. Diverifikasi
    dgn uji balapan nyata: dua kartu → tepat satu berhasil, saldo
    `[0, 100.000]`, hanya SATU baris `pakai` untuk order itu.
  - **MEDIUM DIPERBAIKI — jumlah kartu per transaksi.** Batas 20 hanya ada
    di dialog kasir (bisa dilewati dgn memanggil API langsung; qty raksasa
    = transaksi panjang + pesan WA raksasa). Plafon `MAX_CARDS_PER_ORDER`
    kini ditegakkan di `prepareGiftCardSale`.
  - **DITERIMA & DITUNDA (bukan regresi epic ini) — `body.branch_id`
    dipercaya mentah.** Sesi POS tidak terikat ke branch mana pun
    (`getPosSession` hanya memvalidasi JWT), jadi klien bisa mengirim
    `branch_id` sembarang; scope gift card di rute order baru ikut nilai
    itu. Ini pola LAMA yang sudah dipakai NFC Tab & promo di rute yang
    sama — memperbaikinya = mengikat sesi↔branch di lapisan auth, di luar
    cakupan epic ini. Jalur open bill TIDAK terpengaruh (scope diambil
    dari `company_id`/`branch_id` milik order). Dicatat sebagai pekerjaan
    auth tersendiri.
  - **LOW diterima sadar**: pesan cek kartu membedakan "tidak ditemukan"
    vs "kedaluwarsa/nonaktif" (kasir butuh bedanya; keyspace 12 char
    CSPRNG ~2^60 + rate limit 20/menit membuatnya tidak praktis
    dieksploitasi), dan rate limiter masih in-memory per proses
    (topologi PM2 satu instans).
