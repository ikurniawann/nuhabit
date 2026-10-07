# EPIC-033: CRM Lifecycle Campaign — Win-back & Kampanye WA Member

status: on-progress
environment: local
retries: 0

## Goal

Menutup gap benchmark #14 (lihat
[`BENCHMARK-ticketing-vs-accesso.md`](./BENCHMARK-ticketing-vs-accesso.md)):
CRM yang tersambung ke lifecycle tamu — owner/marketing bisa membuat
**kampanye WA tersegmentasi** (win-back member yang lama tak datang,
pengumuman promo, ajakan event) dari data member yang sudah ada, lengkap
dengan kode promo terlampir dan laporan hasil (terkirim → di-redeem).

## Kenapa ini leverage tinggi (audit 2026-07-26)

Semua bahan bakunya SUDAH ada — epic ini murni merangkai:

1. **WA gateway mandiri** (`services/wa-gateway`, Baileys, PM2 terpisah) —
   sudah dipakai OTP portal, e-tiket booking/pass, notifikasi owner.
2. **Data member lengkap**: `pos_customers` (total_xp kanonik, statistik
   order via `syncPosCustomerOrderStats`), `crm` schema (members,
   membership_tiers, redemptions), member portal.
3. **Pola anti-dobel yang terbukti**: `wa_notif_log` klaim-dulu (EPIC-020)
   + watcher jam operasional 8–21 WIB.
4. **Engine promo (EPIC-032)**: generate voucher batch → lampirkan ke
   kampanye; redemptions = ukuran konversi kampanye GRATIS (tanpa
   tracking baru).

## ⚠ Risiko utama yang menentukan desain

**Reputasi nomor WA.** Blast massal dari nomor Baileys tidak resmi berisiko
**banned oleh WhatsApp**. Desain wajib: antrian kirim PELAN (jeda antar
pesan + jitter), plafon penerima per hari, jam kirim 8–21 WIB, template
personal (nama member, bukan broadcast generik), dan opt-out dihormati.
Keputusan owner dibutuhkan soal nomor pengirim (lihat Open Questions #1).

## Usulan Arsitektur

Schema `crm` (tabel baru):

```
crm_campaigns        — nama, template pesan (placeholder {nama}, {kode}),
                       segmen (aturan tersimpan), promo_campaign_id NULL
                       (lampiran kode EPIC-032), status draft|scheduled|
                       sending|done|cancelled, jadwal, plafon harian, audit
crm_campaign_recipients — ledger per member: phone, kode voucher personal
                       (bila batch), status pending|sent|failed|skipped,
                       klaim-dulu (pola wa_notif_log), sent_at
```

- **Segmentasi = lib murni** (pola pricing/capacity, TDD): aturan →
  SQL builder aman (last order ≥ N hari, tier, min XP, pernah beli
  produk X = fase lanjut). Preview jumlah penerima SEBELUM kirim.
- **Pengirim = watcher** (pola notifications-watcher): ambil batch kecil
  recipient `pending` → klaim → kirim via gateway → jeda acak 8–20 dtk →
  berhenti di luar jam 8–21 / saat plafon harian tercapai; lanjut besok.
- **Konversi**: join `promo.promo_redemptions` per campaign → funnel
  terkirim → dipakai.

## Fase

| Fase | Scope (PR-sized) |
|---|---|
| **A** | Skema 2 tabel + lib segmentasi murni (TDD) + endpoint preview segmen (hitung & sampel penerima, TANPA kirim) |
| **B** | Admin UI `/dashboard/crm/campaigns` (super_admin + marketing): buat kampanye, pilih segmen, tulis template ber-placeholder, preview, jadwalkan/kirim; watcher pengirim pelan + klaim-dulu + plafon harian |
| **C** | Integrasi promo: lampirkan campaign EPIC-032 (kode publik ATAU voucher batch 1 kode/penerima, digenerate otomatis); laporan funnel per kampanye (sent/failed/redeemed + omzet dari redemption) |
| **D** (lanjut) | Win-back OTOMATIS berulang (segmen berjalan tiap minggu), manajemen opt-out (keyword STOP via inbox EPIC-012), A/B template |

## Non-Goals

- Email/SMS — WA dulu (kanal yang sudah dipunyai).
- Editor visual/branded template — teks + placeholder cukup di MVP.
- Marketing automation berbasis event realtime (trigger saat transaksi) —
  fase lanjut setelah pola batch terbukti aman.

## Acceptance Criteria (inti)

- [ ] Kampanye win-back: segmen "terakhir order ≥ N hari" → preview jumlah
      benar (cocok dgn query manual) → kirim → tiap member menerima 1 pesan
      personal (nama + kode), TANPA dobel walau watcher restart.
- [ ] Kirim menghormati jam 8–21 WIB + plafon harian + jeda antar pesan;
      sisa antrean lanjut hari berikutnya otomatis.
- [ ] Kampanye ber-voucher batch: tiap penerima kode UNIK sekali-pakai;
      laporan menunjukkan redeem rate.
- [ ] Marketing (role EPIC-032) bisa kelola; role lain ditolak.
- [ ] Gagal kirim per penerima tercatat (failed + alasan) tanpa
      menghentikan kampanye.

## Open Questions (TERJAWAB owner 2026-07-26)

1. ~~Nomor pengirim~~ → **Bangun fiturnya sekarang, JANGAN testing kirim
   riil** (risiko ban) — owner sedang menyiapkan WA official. Konsekuensi
   desain: master switch `enabled` default **MATI** (pola EPIC-020); semua
   verifikasi dev berhenti sebelum `sendGatewayText`; abstraksi gateway
   dipertahankan agar swap ke WA official = penggantian satu lapis.
2. ~~Plafon harian~~ → **Configurable** dari UI (global + per kampanye).
3. ~~Segmen MVP~~ → **Cukup**: terakhir kunjungan ≥ N hari + tier + min XP.
4. ~~Opt-out~~ → Owner minta best practice → **diterapkan dari MVP**:
   tabel opt-out marketing TERPISAH dari `wa_consent` portal (jangan
   overload semantik — mematikan wa_consent bisa merusak OTP login),
   footer pesan "Balas STOP untuk berhenti", daftar kelola manual di UI;
   deteksi keyword otomatis dari inbox = Fase D.

## Automation Log

- 2026-07-26 — Epic dibuat dari gap benchmark #14 (keputusan owner: garap
  Tier 2). Audit leverage: WA gateway + data member + pola klaim-dulu +
  engine promo semua siap; risiko utama = reputasi nomor WA → desain
  antrian pelan + plafon + jam operasional. Status **backlog** — menunggu
  jawaban open questions (terutama #1 nomor pengirim).
- 2026-07-26 — Owner menjawab semua OQ (lihat seksi OQ): bangun sekarang
  TANPA testing kirim riil (WA official disiapkan owner), plafon
  configurable, segmen MVP cukup, opt-out ikut best practice (tabel
  terpisah + footer STOP + kelola manual). Status → **on-progress**.
