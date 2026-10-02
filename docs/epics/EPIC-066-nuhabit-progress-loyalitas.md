# EPIC-066: NüHabit Progress — XP, Tier, Reward, Leaderboard & CRM Retensi

status: on-progress
environment: dev
retries: 0

## Goal

Loyalitas berbasis **konsistensi latihan** (bukan belanja): member mendapat XP dari hadir, streak, dan perpanjang
paket; naik tier dengan benefit nyata di booking; menukar XP dengan reward; bersaing sehat di leaderboard; dan CRM
memakai data kehadiran untuk retensi.

Referensi: [PRD](../product/PRD.md) · [BACKLOG](../BACKLOG.md) · [EPIC-054](./EPIC-054-booking-kelas-checkin.md) · [EPIC-057](./EPIC-057-member-app-nuhabit.md).

## Keputusan owner (2026-10-02)

1. **Tier dihitung dari XP seumur hidup** (tidak turun), **kecuali member diblokir/banned** → tier & benefit gugur.
2. **Nilai XP per aktivitas & nilai tukar reward bisa dikonfigurasi** dari backoffice.
3. **ARK Coin dimatikan** (saklar `ark_coin_enabled`), bisa diaktifkan lagi kapan saja tanpa kehilangan data.
4. **Leaderboard** dibuat.

## Keputusan desain

- **Dua angka XP**: *XP lifetime* (tier; kanonik `pos_customers.total_xp`, mirror `crm_member_profiles.lifetime_xp`) dan
  *saldo XP* (`crm_member_profiles.xp_balance`, berkurang saat ditukar). Menggantikan model BCD EPIC-011 (XP tidak
  pernah dibelanjakan) khusus untuk NüHabit; ledger tetap `crm.crm_xp_ledger` dengan `source_channel = 'studio'`.
- **Aturan XP** memakai `crm.crm_xp_rules` (`source_channel = 'studio'`), idempoten per kejadian (`idempotency_key`).
  XP hanya dari sesi yang benar-benar hadir; tanpa XP negatif sebagai hukuman.
- **Tier** memakai `crm.crm_membership_tiers` (kode BCD dipertahankan karena dipakai tampilan lama; nama diganti
  Starter/Open/Pro/Elite). Benefit booking di `metadata`: booking lebih awal (hari), batas batal (jam), prioritas waitlist.
  Diskon F&B memakai `discount_percent` yang sudah ada.
- **Status member**: `active` · `suspended` (diblokir — tier/benefit/XP/reward dibekukan, pulih saat dibuka) ·
  `banned` (permanen — juga tidak bisa booking).
- **Benefit booking hanya untuk kelas grup** (jendela booking & batas batal); booking Personal Training tetap mengikuti
  jendela slot coach. Prioritas waitlist diterapkan saat kursi kosong diisi otomatis.
- **Streak** dihitung di tutup hari (EPIC-058): bonus mingguan sekali per minggu ISO bila ≥ N sesi hadir; bonus 4 minggu
  pada setiap kelipatan 4 minggu berturut-turut.
- **Leaderboard** opt-in (member memilih tampil), peringkat bulanan berdasarkan **sesi hadir** (konsistensi, bukan
  performa); nama ditampilkan "Maya K.".

## Tasks

### Fase 1 — Mesin XP, tier & leaderboard
- [x] T-066-1 Migrasi: source_channel `studio`, `xp_balance`, status `banned`, aturan XP default, tier Starter/Open/Pro/Elite + benefit, ARK Coin mati, preferensi leaderboard, menu Program Loyalitas.
- [x] T-066-2 Logika murni `loyalty.ts` (tier efektif, benefit booking, streak mingguan, jam sepi, alias) + tes.
- [x] T-066-3 Mesin XP: hadir kelas/Personal Training (+ bonus jam sepi) saat sesi selesai, streak mingguan & 4 minggu di tutup hari, beli paket & perpanjang sebelum habis.
- [x] T-066-4 Benefit tier di booking: booking lebih awal, batas batal, prioritas waitlist; banned tidak bisa booking.
- [x] T-066-5 Member App tab Progres: tier, XP, saldo, benefit, streak, riwayat XP, leaderboard (opt-in).
- [x] T-066-6 Backoffice Program Loyalitas: aturan XP, tier & benefit, status member (blokir/banned/aktifkan).

### Fase 2 — Reward & badge
- [ ] T-066-7 Katalog reward dengan nilai tukar XP yang bisa diatur (kelas gratis, guest pass, F&B, diskon perpanjangan, merchandise) + penukaran dari Member App.
- [ ] T-066-8 Badge & milestone (kelas pertama, 10/50/100 sesi, streak 4 minggu, Early Bird).

### Fase 3 — CRM retensi
- [ ] T-066-9 Profil member 360° & skor risiko churn; segmen otomatis.
- [x] T-066-10 Otomasi WhatsApp: win-back, onboarding, ulang tahun, ajakan perpanjang; rekap bulanan.
- [x] T-066-11 Rating kelas 1–5 di Member App (ke Coach Portal); program referral; dashboard retensi.

## Acceptance Criteria

- [x] XP tercatat otomatis dari hadir, streak, dan pembelian paket — tidak dobel, sesuai nilai yang dikonfigurasi.
- [x] Tier naik dari XP lifetime dan memberi benefit nyata di booking; member diblokir/banned kehilangan benefit.
- [x] Member melihat progres, saldo XP, dan leaderboard di Member App; bisa memilih tampil/tidak di leaderboard.
- [x] Admin mengubah nilai XP, ambang & benefit tier, dan status member dari backoffice.

## Automation Log

- 2026-10-02 — Konsep "NüHabit Progress" diajukan; owner memutuskan 4 poin di atas. Fase 1 mulai.
- 2026-10-02 — Fase 1 selesai (T-066-1..6). Migrasi `20261003100000_loyalty_progress.sql` (tier Starter/Open/Pro/Elite, 7 aturan XP default, `xp_balance`, status `banned`, ARK Coin mati, opt-in leaderboard, menu Program Loyalitas). Gate: vitest studio 71/71 (loyalty 6); typecheck file terkait bersih; E2E `loyalty-e2e` di `nuhabit_test` 37/37 (XP beli/perpanjang/komplimen, hadir + jam sepi, Personal Training, no-show, streak mingguan & 4 minggu idempoten, naik tier, progres, leaderboard opt-in & alias, booking lebih awal, batas batal tier, prioritas waitlist, blokir/banned/aktifkan, konfigurasi aturan & tier + resync); regresi pass 27/27, booking 32/32, Personal Training 25/25, komisi 36/36. Berikutnya Fase 2 (reward & badge).
