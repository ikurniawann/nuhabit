# Skenario UAT & QA Manual — EPIC-011 CRM Revamp

Status epic: `ready-for-qa` · Lingkungan: **DEV**
App utama: `https://sulu.within.ventures` · Portal member: `https://member.within.ventures`

## Prasyarat

| Kebutuhan | Detail |
|---|---|
| Akun **super_admin** | Untuk konfigurasi CRM Settings, Rewards, WhatsApp Gateway |
| Akun **admin** dan/atau **direksi** | Untuk uji akses Laporan CRM |
| Akun **kasir (pos)** | Untuk transaksi POS, topup, klaim reward di venue |
| Akun role lain (mis. warehouse/HR) | Untuk uji negatif — tidak boleh lihat menu/API CRM |
| Member uji **kartu NFC** dengan saldo ARK | Bisa pakai data uji "Budi Uji Reward" (628111222333, 12.000 XP) atau buat baru + tautkan NFC |
| Member uji **terdaftar** (tanpa kartu) | Nama + HP saja, tanpa NFC |
| Nomor WhatsApp **asli** yang bisa diakses penguji | Untuk terima OTP portal (ganti nomor member uji via SQL di `RUNBOOK-WA-GATEWAY-MANDIRI.md`) |
| wa-gateway sehat | Cek Settings → WhatsApp Gateway: connected sebagai 6285880974659 |
| Data reward contoh | `voucher-kopi` (min 0 XP, 1×/bulan), `merch-tumbler` (min 10.000 XP, 1× total), `diskon-ultah` (min 30.000 XP + Gold, 1×/tahun) |

> Catatan: `/login` di portal member sengaja 404 — portal adalah single page `/member` dengan login OTP inline. Ini **bukan bug**.

Kolom **Hasil**: isi `PASS` / `FAIL` + catatan.

---

## A. Konfigurasi CRM (Super Admin) — `/dashboard/crm/settings`

| ID | Skenario | Langkah | Hasil Diharapkan | Hasil |
|---|---|---|---|---|
| A1 | Ubah konfigurasi tier | Login super_admin → CRM Settings → ubah nama/ambang XP/diskon % salah satu tier → simpan → refresh | Perubahan tersimpan dan tampil kembali setelah refresh | |
| A2 | Tier Regular rank 0 | Edit tier Regular (rank 0) → simpan | Sukses, tanpa error "update tier invalid" | |
| A3 | Ubah XP rules | Ubah besaran XP per Rp → simpan | Tersimpan; dipakai di skenario C1 | |
| A4 | Ubah bonus topup % | Ubah `topup_bonus_percent` (mis. 10 → 15) → simpan | Tersimpan; dipakai di skenario D1 | |
| A5 | Ubah Free XP profil | Ubah nominal Free XP → simpan | Tersimpan; dipakai di skenario F5 | |
| A6 | XP per produk | Seksi "XP Produk" → cari produk (nama/SKU/kategori) → edit `xp_points` | Tersimpan; pencarian berfungsi | |
| A7 | **Negatif**: non-super-admin | Login admin/direksi/kasir → akses `/dashboard/crm/settings` & POST konfigurasi | Menu tidak tampil / akses ditolak (403) | |
| A8 | Dashboard CRM = monitoring murni | Buka `/dashboard/crm` | Tidak ada lagi panel Konfigurasi Tier/XP; hanya stats, leaderboard, XP activity; stat cards: Customers, Member Kartu, Member Terdaftar, Saldo ARK Beredar, XP Rules, Tiers | |

## B. Diskon Tier di Kasir

| ID | Skenario | Langkah | Hasil Diharapkan | Hasil |
|---|---|---|---|---|
| B1 | Diskon dari konfigurasi | Catat `discount_percent` tier member uji → di kasir pilih member → cek diskon | Diskon sesuai konfigurasi tier (bukan nilai lama/hardcode) | |
| B2 | Perubahan langsung berlaku | Ubah `discount_percent` tier di Settings → kembali ke kasir, pilih ulang member | Diskon baru langsung terpakai | |

## C. Engine XP & Metode Pembayaran (Kasir)

| ID | Skenario | Langkah | Hasil Diharapkan | Hasil |
|---|---|---|---|---|
| C1 | Bayar full ARK Coin → XP naik | Member kartu ber-saldo → transaksi bayar penuh ARK Coin → cek detail member | `total_xp` naik sesuai XP rules; saldo ARK terpotong sebesar total; wallet tercatat baris `payment` | |
| C2 | Bayar tunai/QRIS → XP TIDAK naik | Member sama → transaksi bayar tunai atau QRIS | XP tidak berubah; visit_count/last_visit tetap ter-update | |
| C3 | **Negatif**: campur metode | Coba bayar 1 pembayaran dengan ARK + metode lain | Ditolak — 1 pembayaran = 1 metode | |
| C4 | **Negatif**: saldo ARK kurang | Bayar ARK dengan saldo < total | Ditolak; TIDAK ada order terbentuk dan saldo TIDAK berubah | |
| C5 | Split bill per-metode | Split 2 bagian: satu ARK, satu tunai | Sukses; hanya bagian ARK yang menghasilkan XP | |
| C6 | Auto-naik tier | Belanja ARK hingga lifetime XP tembus ambang tier berikutnya | Tier otomatis naik; tidak pernah turun oleh operasi apa pun | |
| C7 | XP tidak pernah berkurang | Setelah C1–C6 dan redeem (bagian G), cek `total_xp` | Tidak ada operasi yang mengurangi XP | |
| C8 | Saldo kasir segar | Setelah transaksi, panel customer di kasir | Saldo ARK/XP ter-refresh otomatis (tidak basi) | |

## D. Topup ARK Coin & Member Kartu

| ID | Skenario | Langkah | Hasil Diharapkan | Hasil |
|---|---|---|---|---|
| D1 | Topup member kartu + bonus | Topup mis. 100rb ke member kartu (bonus 10%) | Saldo +110rb; wallet 2 baris terpisah: `topup` + `topup_bonus`; struk keluar | |
| D2 | `total_spent` tidak berubah | Cek total_spent member sebelum vs sesudah topup | Tidak berubah — topup bukan spend | |
| D3 | **Negatif**: topup member terdaftar | Coba topup ke member tanpa kartu | Ditolak 403 dengan pesan "tautkan kartu NFC dulu" | |
| D4 | Penautan NFC = upgrade kartu | Tautkan kartu NFC ke member terdaftar (jalur create maupun edit) | `member_type` menjadi `card`; setelah itu topup bisa | |
| D5 | Bonus mengikuti konfigurasi | Setelah A4 (ubah %), topup lagi | Bonus terhitung dengan persentase baru | |

## E. Produk Privilege (min XP)

| ID | Skenario | Langkah | Hasil Diharapkan | Hasil |
|---|---|---|---|---|
| E1 | Set Min XP produk | Halaman POS Products → isi kolom "Min XP" sebuah produk | Tersimpan | |
| E2 | Kasir: badge terkunci | Buka kasir TANPA memilih member → lihat produk privilege | Badge 🔒 "N XP"; produk terkunci + toast bila diklik | |
| E3 | Member XP cukup | Pilih member ber-XP ≥ syarat → beli produk | Boleh dibeli, bayar normal, XP TIDAK dipotong | |
| E4 | **Negatif**: XP kurang | Pilih member ber-XP < syarat → coba beli | Ditolak (403) dengan pesan produk + syarat + XP member | |
| E5 | **Negatif**: QR table-order publik | Order produk privilege via QR meja tanpa member | Otomatis tertolak | |

## F. Portal Member — `https://member.within.ventures`

| ID | Skenario | Langkah | Hasil Diharapkan | Hasil |
|---|---|---|---|---|
| F1 | Login OTP nomor member | Masukkan nomor member (format 08xx atau 62xx) → terima OTP di WhatsApp → masukkan kode | OTP masuk WA dari 6285880974659; login sukses; tampil saldo/XP/tier/progres | |
| F2 | **Negatif**: nomor bukan member | Masukkan nomor asing | Ditolak (tidak dikirimi OTP) | |
| F3 | **Negatif**: kode salah / kedaluwarsa | Masukkan kode salah; ulangi >5×; atau tunggu >5 menit | Kode salah 400; max 5 percobaan; TTL 5 menit; rate limit 3 permintaan/10 menit per nomor | |
| F4 | Lengkapi profil | Tab Profil → isi semua field (email, tgl lahir, gender, kota, foto URL, consent WA) | Progress % naik; nomor HP TIDAK bisa diubah | |
| F5 | Free XP profil 100% | Lengkapi profil sampai 100% | Free XP masuk `total_xp` (nominal sesuai A5); tier ikut naik bila tembus ambang; banner tampil | |
| F6 | Free XP idempotent | Edit-simpan profil berulang setelah 100% | Free XP TIDAK dobel — sekali seumur hidup | |
| F7 | Free XP member terdaftar | Ulangi F1–F5 dengan member TANPA kartu | Free XP tetap masuk (satu-satunya pengecualian aturan tanpa-kartu-tanpa-XP) | |
| F8 | Riwayat transaksi | Tab Riwayat | Tampil wallet (topup/bonus/payment) & pembelian milik sendiri saja | |
| F9 | Logout | Klik logout → coba akses data | Sesi berakhir (401); harus login OTP ulang | |

## G. Reward Redeem (Fase F)

| ID | Skenario | Langkah | Hasil Diharapkan | Hasil |
|---|---|---|---|---|
| G1 | Kelola katalog | `/dashboard/crm/rewards` → tab Katalog → ubah kuota/periode reward → simpan | Tersimpan; form menampilkan "Syarat kelayakan" & "Batas pengambilan" | |
| G2 | Approval permintaan | Tab Permintaan Redeem → Setujui lalu Serahkan permintaan pending (mis. Budi) | Status berubah pending → approved → fulfilled | |
| G3 | Portal: reward layak & terkunci | Login portal sebagai member ber-XP → tab Reward | Reward di bawah ambang bisa ditukar; di atas ambang terkunci dengan alasan jelas (mis. "kurang 800 XP") | |
| G4 | **Negatif**: kuota terlampaui | Redeem reward 1×/bulan dua kali | Percobaan kedua ditolak (jatah habis) | |
| G5 | **XP tidak dipotong** | Cek `total_xp` member sebelum vs sesudah redeem | Tidak berubah — XP = syarat, bukan biaya | |
| G6 | Klaim di venue (kasir) | Tab Permintaan Redeem → panel "Klaim Reward di Venue" → cari member → pilih reward → klaim | Langsung `fulfilled` tanpa approval | |
| G7 | Batalkan permintaan | Batalkan sebuah permintaan pending | Status `cancelled`; stok reward kembali | |
| G8 | **Negatif**: role tanpa akses | Login role non-operator (mis. warehouse) → akses API/halaman redemptions | Ditolak; daftar redemption (berisi nama/HP member) tidak bisa diakses | |

## H. Laporan & Rekonsiliasi — `/dashboard/crm/reports`

| ID | Skenario | Langkah | Hasil Diharapkan | Hasil |
|---|---|---|---|---|
| H1 | Akses per role | Buka sebagai super_admin, admin, direksi | Ketiganya bisa akses; menu Laporan tampil | |
| H2 | **Negatif**: role lain | Login kasir/role lain | Menu Laporan TIDAK tampil; akses langsung URL/API ditolak | |
| H3 | Filter periode | Ganti preset Bulan ini / 30 hari / rentang manual | Angka berubah sesuai periode | |
| H4 | Rekonsiliasi cocok | Bandingkan tabel rekonsiliasi dengan transaksi uji (topup, bonus, belanja ARK dari bagian C–D) | topup/bonus/spend/net per venue cocok; saldo ARK beredar = liabilitas yang masuk akal | |
| H5 | Top spender basis order | Cek leaderboard setelah transaksi uji | Basis nilai order semua metode; **topup TIDAK menaikkan** top spender | |
| H6 | Frequent visitor | Member yang berkunjung beberapa hari berbeda | Hari kunjungan dihitung distinct per hari (zona WIB) | |

## I. QA Teknis (opsional, butuh akses DB/terminal)

| ID | Skenario | Cara Verifikasi | Hasil Diharapkan | Hasil |
|---|---|---|---|---|
| I1 | Stempel venue | Query `pos_wallet_transactions`, `crm_xp_ledger`, `pos_orders` untuk transaksi uji | Semua baris baru punya `company_id`+`branch_id` | |
| I2 | Anti double-spend | 2 request konkuren bayar/topup/redeem untuk member yang sama (curl paralel) | Salah satu ditolak; saldo/stok/kuota tidak minus (lock atomik) | |
| I3 | Rate limit redeem | ≥11 POST redeem beruntun dalam 1 menit | HTTP 429 + header `Retry-After` setelah 10 percobaan | |
| I4 | OTP tidak bocor | Cek log server saat OTP terkirim (dengan gateway aktif) | Kode OTP tidak tercetak di log produksi-mode | |
| I5 | Error tidak bocor | Picu error di endpoint CRM | Respons generik; detail hanya di log server | |

---

## Ringkasan Kriteria Lulus (Acceptance Criteria epic)

- [ ] Member tanpa kartu tidak pernah dapat XP transaksi; Free XP profil 100% tetap masuk sekali untuk semua tipe (C2, F5–F7)
- [ ] Belanja ARK menambah XP sesuai rules; metode lain tidak (C1–C2)
- [ ] XP tidak pernah berkurang (C7, G5)
- [ ] Ubah diskon tier → langsung berlaku di kasir (B1–B2)
- [ ] Topup 1jt bonus 10% → saldo 1,1jt, 2 baris wallet, total_spent tetap (D1–D2)
- [ ] Tidak bisa double-spend konkuren (I2)
- [ ] Login portal hanya dengan OTP WA valid (F1–F3)
- [ ] Semua transaksi wallet/XP tercatat venue (I1)

## Catatan Pasca-UAT

- Isi hasil tiap skenario; temuan FAIL dicatat di Automation Log `docs/epics/EPIC-011-crm-revamp.md`.
- Setelah semua PASS → status epic `ready-for-qa` → `done`.
- Bersihkan data uji (member uji, transaksi, redemption) setelah UAT selesai.
