# PRD — Nuhabit (Platform Manajemen Hyrox)

status: draft
dibuat: 2026-10-02
basis kode: fork BCD Coffee (`bcd-upstream` → github.com/ikurniawann/bcdcoffee)

> Dokumen pegangan pengembangan Nuhabit. Modul BCD Coffee yang sudah ada **boleh
> dimodifikasi** agar sesuai kebutuhan Hyrox. Bagian "Catatan Asli" adalah
> kebutuhan dari owner (jangan diubah maknanya); bagian lain adalah turunan/analisis.

## 1. Ringkasan

Nuhabit adalah platform untuk venue Hyrox dengan **3 sistem user**:

| Sistem | Pengguna | Fungsi inti |
|--------|----------|-------------|
| **Backoffice** | Owner, admin, CS, finance | Jadwal & kelas, coach, paket, member, POS F&B, aset, inventory, accounting, payroll |
| **Member App / Portal** | Member & calon member | Daftar, beli paket, booking kelas/private, news Hyrox, profil coach |
| **Coach Portal** | Coach & Head Coach | Lihat jadwal mengajar, roster, insentif (kelas & private) |

## 2. Catatan Asli (dari owner)

### Sisi User
- Bisa mendaftar menjadi member.
- Ada paket kelas: paket = berapa kali ikut kelas, dengan masa expired (dibuat
  **konfigurable** per paket) dan harga.
- Member page: pilih jam kehadiran (booking kelas); jatah paket berkurang.
- Member page menampilkan **news tentang Hyrox** dan **profil coach**.
- Selain kelas, bisa **private (Personal Training)**: pilih coach dan tanggal.

### Kelas
- 1 hari 6–7 kelas, 3 jadwal per sesi waktu. Sore: 17–18, 18–19, 19–20.
- Minimal 6 kelas/hari, Senin–Sabtu. Minggu hanya pagi.
- **39 kelas per minggu** (di luar personal training).
  → Interpretasi: 3 pagi + 3 sore × 6 hari = 36, + 3 pagi hari Minggu = 39.
- Ada **kuota per kelas**.

### Coach
- 5 coach + 1 Head Coach → perlu **scheduling management coach**.
- Coach dapat **insentif**, dibedakan: **Class** atau **Personal Training**.
- Alur PT: member pilih program → muncul coach yang cocok + background-nya.
- **Head Coach beda rate**, dihitung **per session**.
- Perhitungan komisi mengacu ke **file Excel** (belum diterima — lihat Pertanyaan Terbuka).
- Kompensasi = **Fix salary + Insentif**; **disburse end of the month**.
- **Keputusan owner 2026-10-02:** komisi/insentif coach dihitung & dicairkan **di luar payroll**
  (modul komisi sendiri → statement → pencairan lewat Accounting). Payroll HRIS hanya fix salary.

### Member / Package Pass
- Contoh: 3x dalam 2 minggu, 7x dalam sebulan.
- Dibagi 3 tipe: **Class** · **Class + PT** · **Class + PT + Facility**.

### Operasional
- Attendance member **per class**.
- **Customer Service** punya absensi (absen karyawan).
- Ada **F&B — POS**.
- **Penyusutan aset**, ada **QR Code untuk setiap aset**.
- **RFID Tag** untuk inventory control.

### Revenue Breakdown
- Paket yang **belum di-redeem = utang** (pendapatan diterima di muka / liability).
- Saat redeem, revenue di-breakdown **ke coach** sesuai sesi yang di-redeem.
- Sisa bisa jadi **bonus** atau jadi **revenue perusahaan**.

## 3. Pemetaan ke Modul BCD Coffee

| Kebutuhan | Modul existing | Aksi |
|-----------|----------------|------|
| Daftar member, profil, login OTP WA | CRM member (`crm.crm_member_profiles`), Member Portal `/member`, mobile `mobile/` (EPIC-011/014/044) | **Modifikasi** — rebrand, tambah tab Paket/Booking/News/Coach |
| Paket pass berkuota + expired | Ticketing Season Pass (EPIC-028) — masih entry-unlimited | **Modifikasi** — tambah kredit sesi per tipe (class/PT/facility), masa berlaku, harga |
| Jadwal kelas + kuota + sold-out | Ticketing kapasitas & timed-entry (EPIC-031) | **Modifikasi** — dari kuota per tanggal → per slot kelas |
| Pembayaran online | Xendit (ticketing/booking) | **Reuse** |
| Check-in member (QR/NFC) | Gate tap `ticket_gate_events`, `ticket_bands`, QR member mobile | **Reuse** + kaitkan ke attendance kelas |
| Liability paket belum redeem | Pola Gift Card stored value (EPIC-034) | **Reuse pola** — terapkan ke paket |
| Absensi CS, shift, payroll fix salary | HRIS attendance/shifts/payroll (`src/lib/payroll`) | **Reuse** — fix salary saja; komisi coach di modul terpisah |
| POS F&B | POS + KDS | **Reuse** |
| Accounting (COA, jurnal, AR/AP, laporan) | `src/lib/accounting` | **Reuse** + mapping jurnal baru |
| Inventory | Inventory (stok, opname, transfer) | **Reuse** + RFID |
| Jadwal & insentif coach, Coach Portal | — | **Baru** |
| Fixed asset + penyusutan + QR aset | — | **Baru** |
| News Hyrox / CMS konten | — | **Baru** |
| Tidak relevan | table-order, photobooth, resort, recruitment/psikotes, gobiz | **Sembunyikan** dari menu (jangan dihapus dulu) |

## 4. Rekomendasi Tambahan Backoffice

Lihat ringkasan di percakapan 2026-10-02; poin yang perlu dikonfirmasi owner ada di §5.

1. **Master Program & Template Jadwal** — tipe kelas/program, template mingguan (39 slot), generate jadwal otomatis per periode, kuota per slot, libur/override.
2. **Aturan booking** — jendela booking (mis. H-7), batas cancel (kredit kembali vs hangus), no-show, waitlist otomatis.
3. **Manajemen coach** — profil & sertifikasi, rate per tipe sesi (coach vs head coach), ketersediaan, cegah bentrok, tukar/pengganti coach.
4. **Engine komisi (di luar payroll)** — aturan dari Excel, akrual per sesi, tutup periode bulanan, statement per coach, pencairan via Accounting (hutang komisi → kas/bank), slip di Coach Portal.
5. **Revenue recognition** — jual paket → liability; redeem → revenue per sesi (harga/jumlah sesi); expired → breakage; laporan saldo liability & aging.
6. **Waiver / health declaration (PAR-Q)** saat daftar — umum di fitness, melindungi venue.
7. **Freeze/cuti paket, perpanjangan, upgrade** paket.
8. **Trial class / lead** untuk calon member + reminder WA (perpanjangan, H-1 kelas, paket mau habis).
9. **Fixed asset** — register, cetak label QR, penyusutan garis lurus otomatis, maintenance log alat, disposal.
10. **Dashboard** — okupansi per slot, utilisasi coach, member aktif/churn, penjualan paket, liability vs revenue diakui.

## 5. Pertanyaan Terbuka

- [ ] File Excel perhitungan komisi coach.
- [ ] Jam kelas pagi (Senin–Sabtu & Minggu).
- [ ] Insentif kelas: flat per sesi atau tergantung jumlah peserta?
- [ ] PT: dikurangi dari paket (Class + PT) saja, atau juga bisa beli sesi PT terpisah?
- [ ] "Facility" mencakup apa (open gym, loker, sauna)? Dibatasi kuota atau unlimited selama masa aktif?
- [ ] Kredit expired: masuk bonus pool coach atau revenue perusahaan? Aturannya?
- [ ] Aturan cancel & no-show.
- [ ] Hardware RFID (reader & jenis tag) dan cakupan (stok F&B, alat gym, merchandise?).
- [ ] Single branch atau multi-branch?
