# EPIC-069: Membership — tier loyalitas dari spending member

status: ready-for-qa
environment: dev
retries: 0

## Goal

Permintaan client 2026-10-22: "Membership digunakan sebagai tier loyalitas berdasarkan spending member. Semakin besar
pengeluaran, semakin tinggi tier dan perks yang diperoleh. Ambang spending dan perks tiap tier perlu ditentukan."
Referensi yang disebut client: membership Ismaya (ISMAYA+). Detail tier Ismaya yang berlaku sekarang tidak tersedia
publik — yang diambil adalah konsepnya: belanja lebih banyak → tier lebih tinggi → perks lebih baik.

Referensi: [EPIC-066](./EPIC-066-nuhabit-progress-loyalitas.md) (XP & tier Progress) · [PRD](../product/PRD.md).

## Keputusan (dipilih user 2026-10-22)

- **Dua jalur terpisah.** *Membership* = tier loyalitas dari spending, pemilik semua perks. *Progress* (EPIC-066) tetap
  XP konsistensi: level, saldo XP untuk tukar reward, leaderboard — tanpa benefit. Benefit yang sebelumnya menempel di
  tier XP (diskon F&B, booking lebih awal, batas cancel, prioritas waitlist) **pindah ke tier Membership**. Nilai lama
  di tier XP tidak dihapus dari DB (bisa dikembalikan), hanya tidak dipakai lagi.
- **Periode: 12 bulan berjalan.** Spending = total belanja 365 hari terakhir.
- **Ambang & perks diisi client sendiri** lewat backoffice — migrasi tidak membuat tier apa pun. Selama belum ada tier,
  member tidak punya tier Membership dan tidak mendapat benefit.
- **Sumber spending:** paket/pass kelas, paket Personal Training (keduanya `studio.member_passes`, harga dibayar), dan
  transaksi POS yang terhubung ke member.

### Aturan turunan (default yang dipilih implementasi)

- **Masa berlaku tier (anti turun mendadak):** tier berlaku sampai 12 bulan sejak terakhir kali member memenuhi ambang
  tier itu. Naik tier langsung saat spending 12 bulan mencapai ambang. Turun hanya setelah masa berlaku habis dan
  spending 12 bulan di bawah ambang — langsung ke tier yang sesuai spending saat itu.
- **Yang dihitung:** pass berstatus aktif/expired/exhausted (sudah dibayar) dengan `price_paid > 0`, bukan
  complimentary — tanggal = `paid_at` (atau `created_at`). POS: order `payment_status = 'paid'`, bukan
  void/cancelled, nilai `total_amount`. Pending payment, dibatalkan, refund, dan complimentary tidak dihitung.
- **Member diblokir/banned:** tier & benefit dibekukan (sama dengan aturan EPIC-066).
- **Perks terstruktur** (otomatis diterapkan sistem): diskon F&B/POS %, booking dibuka N hari lebih awal, batas cancel
  khusus, prioritas waitlist. **Perks lain** (mis. guest pass, merch, reward ulang tahun) berupa daftar teks yang tampil
  di Member App dan dipenuhi staf secara manual.
- **Evaluasi:** saat data member dibaca (Member App, booking) dan tiap tutup hari (job harian) untuk semua member; setiap
  perubahan tier dicatat di riwayat.

## Tasks

- [x] T-069-1 — Migrasi: `studio.membership_tiers`, `studio.member_memberships`, `studio.membership_tier_changes`;
      menu tetap `studio.loyalty`, ditambah aksi tambah/hapus untuk role yang sudah boleh mengubah.
- [x] T-069-2 — Logika murni spending & evaluasi tier (naik/turun/masa berlaku) + unit test.
- [x] T-069-3 — Server: hitung spending 12 bulan, evaluasi & simpan, benefit booking, prioritas waitlist, diskon POS &
      self-order dari tier Membership.
- [x] T-069-4 — Backoffice Program Loyalitas: tab Membership (CRUD tier: nama, ambang, warna, perks), tier XP jadi
      level Progress tanpa benefit; data membership di pencarian member.
- [x] T-069-5 — Member App: kartu Membership (tier, spending 12 bulan, sisa ke tier berikutnya, berlaku sampai, perks,
      tangga tier).
- [x] T-069-6 — Integration test + E2E di `nuhabit_test`.

## Acceptance Criteria

- Given belum ada tier Membership, When member membuka Member App, Then kartu Membership menjelaskan program belum
  tersedia dan booking memakai aturan standar.
- Given tier "Gold" ambang Rp10 jt, When spending 12 bulan member mencapai Rp10 jt, Then tier member menjadi Gold saat
  itu juga dan perks Gold berlaku (booking lebih awal, batas cancel, prioritas waitlist, diskon POS).
- Given member Gold yang belanjanya turun di bawah ambang, When masa berlaku belum habis, Then tetap Gold; When masa
  berlaku habis, Then turun ke tier sesuai spending 12 bulan.
- Given pass complimentary / pending payment / dibatalkan, Then tidak menambah spending.
- Given member diblokir, Then tidak mendapat perks Membership.
- Tier XP Progress tidak lagi memberi benefit booking/diskon; XP, reward, leaderboard tetap jalan.

## Automation Log

- 2026-10-22 — Epic dibuat dari permintaan client; keputusan di atas dipilih user lewat pertanyaan pilihan.
- 2026-10-22 — T-069-1..6 selesai di `nuhabit_test`:
  - Migrasi `20261024090000_studio_membership_tiers.sql` (tabel tier, status per member, riwayat; indeks spending POS;
    aksi create/delete menu Program Loyalitas untuk super_admin/admin/direksi). Tidak ada tier bawaan.
  - Logika murni `src/lib/studio/membership.ts` (15 unit test): naik langsung, masa berlaku 12 bulan sejak terakhir
    memenuhi ambang, turun ke tier sesuai spending setelah masa berlaku habis, tier terhapus dievaluasi ulang.
  - Server `membership-server.ts`: spending 12 bulan (pass dibayar non-complimentary + order POS lunas non-void),
    evaluasi terkunci per member + riwayat, evaluasi semua member saat tutup hari & setelah tier diubah.
  - Benefit pindah ke Membership: `memberBenefits` (booking dibuka lebih awal & batas batal), urutan waitlist,
    diskon daftar pelanggan POS, diskon self-order meja & `/me`. Tier XP tidak lagi memberi benefit (data lama tetap).
  - Backoffice Program Loyalitas: bagian Membership (kartu tier, tambah/ubah/hapus, perks teks, perubahan tier
    terakhir), "Level Progress (XP)" tanpa kolom benefit, kolom Membership + spending di Status member.
  - Member App (Progress): kartu Membership (tier, spending 12 bulan, berlaku sampai, sisa ke tier berikutnya, sisa
    agar tier bertahan, perks, tangga tier); "Coming soon" bila belum ada tier; bagian XP menjadi "Your level".
  - Bukti: integration test `membership-server.integration.test.ts` 5/5; suite studio/POS/self-order/Member App
    335 lulus (4 gagal = baseline lama ARK Coin & dev-bypass); typecheck baseline 508; E2E di `nuhabit_test` —
    Member App "Coming soon" → admin menambah Silver/Gold → Member App Silver, "Rp 2,350,000 to Gold", perks; backoffice
    390px tanpa overflow; tanpa error console. Izin create awalnya 403 (menu hanya read/update) → diperbaiki di migrasi.
- 2026-10-22 23.50 WIB — **Deploy ke dev** (nuhabitdev.reddie.id) dari commit `da643ca7`:
  - Backup: `~/backups/nuhabitdev/nuhabit-20261022-233838-pre-epic069.sql.gz` (dump lengkap, jumlah baris cocok).
  - Migrasi `20261024090000_studio_membership_tiers.sql` diterapkan (dry-run 1 pending → apply ok); tier Membership
    kosong; izin `studio.loyalty` super_admin & admin kini read/create/update/delete.
  - Rollback: image `nuhabitdev:pre-epic069` (= Add to Google Calendar). Tabel baru tidak perlu di-drop untuk rollback.
  - Smoke test (hanya baca): `/member` 200; API Membership member 401 tanpa sesi; chunk Member App memuat kartu
    Membership; API backoffice (Membership 0 tier, Program Loyalitas, pencarian member, sesi, payroll, pemantauan
    task) 200; halaman Program Loyalitas 200; log bersih. Tidak login sebagai member di live.
  - Mulai deploy ini member tidak mendapat benefit tier (diskon F&B, booking lebih awal, prioritas waitlist) sampai
    client mengisi tier Membership.
