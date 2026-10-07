# Benchmark Ticketing — Sistem Kamu vs accesso (Passport/Siriusware/dst.)

> Dicatat ulang dari analisis sesi 2026-07-24 (sempat tak tersimpan, cuma ada di
> transcript sesi lama). Referensi untuk cluster epic Ticketing:
> [`EPIC-023`](./EPIC-023-ticketing-theme-park.md) (fondasi),
> [`EPIC-028`](./EPIC-028-ticketing-season-pass.md) (Season Pass — menutup gap #1),
> [`EPIC-024`](./EPIC-024-pos-customer-display.md).
>
> Catatan sumber: disusun dari pengetahuan portofolio produk accesso (Passport,
> Siriusware, LoQueue/Qband/Qsmart, Prism/TE2, ShoWare), bukan dari akses live ke
> accesso.com — penamaan produk bisa sedikit meleset, tapi cakupan solusi akurat.

## Yang SUDAH ada (dibanding lini produk accesso)

| Area accesso | Status kamu | Bukti di sistem |
|---|---|---|
| **Passport** (eCommerce tiket online) | ✅ dasar | booking publik + katalog + Xendit + status/webhook |
| **Siriusware** (POS on-site / box office) | ✅ dasar | menu loket, loket-options |
| Produk, varian, paket/bundle | ✅ | `ticket_products/variants/bundle_items` |
| Harga musiman/tanggal (regular/high) | ✅ | `ticket_product_dates`, season kind |
| Channel manager + harga per channel | ✅ dasar | `ticket_channels`, `variant_channel_prices` |
| Access control: gelang RFID + gate scan | ✅ | `ticket_bands`, `gate_events`, gate/tap |
| **Cashless in-park** (tab belanja gelang) | ✅ *(kuat!)* | `ticket_visits/visit_charges`, deposit/settle/lost band |
| Staff pass, laporan, WA e-tiket, customer display | ✅ | staff-passes, reports, resend-wa, EPIC-024 |
| **Season Pass & Membership** (gap #1 di bawah) | ✅ MVP | EPIC-028 — entry-only, ready-for-qa 25 Jul |

Cashless wristband tab + access control adalah bagian yang banyak sistem lain
belum punya — ini kekuatan yang sudah dimiliki.

## Yang BELUM ADA — gap vs accesso (prioritas untuk theme park)

### 🔴 Prioritas tinggi (paling dicari operator taman)

1. ~~**Season Pass & Membership**~~ — **SUDAH DIGARAP** (EPIC-028, MVP entry-only:
   pass tahunan, perpanjangan, entry_policy configurable, QR+NFC opsional). Sisa
   backlog dari EPIC-028: cicilan/payment plan, harga member penuh (wiring
   cashier defer PR), foto verifikasi, guest pass, portal pemegang.
2. **Timed-entry & manajemen kapasitas / reservasi** — kapasitas per slot waktu,
   kuota harian, sold-out otomatis. `ticket_product_dates` tak punya kolom
   kapasitas/slot. accesso kuat di sini (reservations & capacity).
   **→ Direncanakan di [EPIC-031](./EPIC-031-ticketing-kapasitas-timed-entry.md)
   (backlog, 25 Jul).**
3. **Virtual Queuing / skip-the-line berbayar** (accesso LoQueue / Qband/Qsmart)
   — antrian virtual, reservasi wahana, upgrade fast-track. Nol di sistemmu.
4. **Mobile guest app** (accesso Prism / TE2) — peta/wayfinding, wait-time
   wahana, pesan F&B dari HP di dalam taman, dompet digital, itinerary, push.
   Belum ada (baru ada customer display).
5. **Dynamic / demand-based pricing & yield management** — harga naik-turun
   mengikuti permintaan. Baru statis (regular/high per tanggal).

### 🟠 Prioritas menengah

6. **Engine promosi**: promo code, voucher tiket, diskon, gifting ("kirim
   sebagai hadiah"). Tak ada di ticketing (POS punya voucher sendiri, terpisah).
   **→ SELESAI di [EPIC-032](./EPIC-032-promo-engine.md) (ready-for-qa,
   26 Jul): engine bersama booking online + kasir POS F&B + voucher batch +
   gifting. Koreksi audit: `pos_vouchers` legacy MATI.**
7. **Upsell/cross-sell + keranjang multi-produk** saat checkout (tambah parkir,
   F&B, merch, loker, add-on). Sengaja 1 produk/transaksi saat ini.
8. **Gift card / stored value / e-gift**. Belum ada.
   **→ Direncanakan di [EPIC-034](./EPIC-034-gift-card-stored-value.md)
   (backlog, 26 Jul).**
9. **Group sales / B2B / reseller & distribusi OTA** (Klook, GetYourGuide,
   Viator). Baru channel internal, belum konektivitas OTA/wholesale.
10. **Reserved/assigned seating** (accesso ShoWare) — peta kursi untuk
    pertunjukan/teater/event. Belum ada.
11. **Self-service kiosk** (beli/tukar tiket mandiri, print-your-ticket). Belum
    ada.

### 🟡 Niche / pelengkap

12. **Rental/lesson/activity booking** (Siriusware: sewa alat, kelas, loker,
    cabana) + **e-waiver** tanda tangan digital.
13. **BI/analytics lanjutan** — forecasting kehadiran, yield dashboard (baru
    laporan dasar).
14. **CRM/marketing automation & loyalty tersambung ke lifecycle tamu taman**
    (win-back, personalisasi, kampanye email/SMS). CRM ada tapi belum terjahit
    ke ticketing.
    **→ Direncanakan di [EPIC-033](./EPIC-033-crm-lifecycle-campaign.md)
    (backlog, 26 Jul).**
15. **Ride photo / PhotoPass**, **donasi/fundraising** (untuk kebun binatang/
    nonprofit).

## Rekomendasi urutan garap (per 2026-07-24, sebagian sudah berubah)

Urutan asli: (1) Season Pass & Membership → (2) Timed-entry & kapasitas →
(3) Promo/voucher + upsell add-on → (4) Virtual queue → (5) Mobile guest app.

**Update 2026-07-25:** #1 sudah TUNTAS MVP (EPIC-028). Kandidat berikutnya yang
paling berdampak ke revenue/over-crowding: **#2 Timed-entry & kapasitas**,
disusul **#6 Promo/voucher + #7 upsell add-on** (lebih cepat digarap, tak
sebesar #3 virtual queue/#4 mobile app).

## Status

Dokumen ini murni **daftar ide/backlog benchmark**, belum ada epic dibuat untuk
item selain #1 (Season Pass). Belum discope jadi fase/task — tunggu keputusan
owner item mana yang mau digarap berikutnya.
