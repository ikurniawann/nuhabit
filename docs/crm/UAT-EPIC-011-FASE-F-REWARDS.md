# UAT — EPIC-011 Fase F: Redeem Reward Bersyarat XP

Panduan uji terima untuk fitur reward: admin mengelola reward mana yang bisa
ditukar dan berapa kali jatah tiap member; XP jadi **syarat kelayakan** dan
**tidak pernah dipotong**.

Lingkungan: **DEV** (commit `5d28612`). Jangan dipakai di produksi.

---

## 1. Akun & Alamat

### Dashboard admin

| Peran | Akun | Dipakai untuk |
|---|---|---|
| Super Admin | `super@arkivworld.com` | Skenario A, B, C, D, F (semua skenario dashboard) |
| HRD | `orang@sulu.com` | Skenario G (uji tolak akses) |
| Purchasing Manager | `indra@arkiv.co` | Skenario G (uji tolak akses) |

Alamat: <https://sulu.within.ventures/dashboard/crm/rewards>
(password Super Admin sudah ter-prefill otomatis di halaman login dev).

> **Catatan penting:** di DEV belum ada akun ber-peran **kasir (`pos`)**,
> **`pos_supervisor`**, maupun **`direksi`**. Peran-peran itu sebenarnya
> berhak memakai fitur ini (kasir boleh klaim & approve; direksi boleh
> membaca riwayat). Selama akun tersebut belum dibuat, **Skenario D
> (klaim kasir) dijalankan memakai Super Admin** — alurnya identik, hanya
> akunnya berbeda.

### Portal member

Alamat: <https://member.within.ventures>

**Login OTP di DEV tidak terkirim ke WhatsApp** karena `FONNTE_API_KEY` masih
kosong. Ambil kodenya dari log server:

```bash
pm2 logs arkiv-pos-saas --lines 40 --nostream | grep "kode utk debug dev"
```

Alurnya: masukkan nomor member → klik kirim OTP → jalankan perintah di atas →
salin 6 digit terakhir dari baris log terbaru → masukkan ke portal.
Kode berlaku 5 menit, maksimal 3 permintaan OTP per nomor tiap 10 menit.

### Member uji

| Member | Nomor (untuk login portal) | XP | Tier | Peran dalam uji |
|---|---|---|---|---|
| Budi Uji Reward | `628111222333` | 12.000 | The Warden | Member ber-XP cukup |
| Ani Uji Pemula | `628111222444` | 500 | The Awakened | Member ber-XP rendah (uji penolakan) |
| Citra Uji Profil | `628111222555` | 0 | The Stray | Profil kosong (uji Free XP) |

### Reward uji (sudah tersedia)

| Reward | Min XP | Syarat tier | Kuota per member | Stok |
|---|---|---|---|---|
| Snack Harian | 0 | — | 2x per hari | bebas |
| Voucher Kopi Gratis | 0 | — | 1x per bulan | 100 |
| Tumbler Eksklusif | 10.000 | — | 1x seumur hidup | 20 |
| Diskon Ulang Tahun 20% | 30.000 | The Elders | 1x per tahun | bebas |

---

## Skenario A — Admin mengatur reward & kuota
**Akun: `super@arkivworld.com` (Super Admin)** · Halaman: CRM → Rewards → tab **Katalog Reward**

1. Buka halaman Rewards. Perhatikan banner ungu di atas yang menegaskan
   "XP tidak dipotong saat redeem".
2. Klik **Edit** pada *Voucher Kopi Gratis*.
3. Ubah **Maks. per member** menjadi `2`, dan **Periode kuota** menjadi
   `Per bulan`. Klik **Update**.
4. Buat reward baru: Kode `tes-uat`, Nama `Reward Uji UAT`, Jenis `Custom`,
   **Min XP** `1000`, **Maks. per member** `1`, **Periode kuota**
   `Total (seumur hidup)`, **Stok total** `5`. Klik **Simpan**.

**Diharapkan:** reward tersimpan dan muncul di daftar; kolom tengah
menampilkan `min 1.000 XP` dengan keterangan kecil "tidak dipotong"; kolom
kanan menampilkan `5 sisa` dan `Jatah: 1x · total (seumur hidup)`.

---

## Skenario B — Admin menutup & membuka reward untuk member
**Akun: `super@arkivworld.com`** · tab **Katalog Reward**

1. Pada *Reward Uji UAT*, klik **Sembunyikan**.
2. Buka portal member sebagai **Budi** (lihat cara login di bagian 1) → tab
   **Reward**.
3. Kembali ke dashboard, klik **Aktifkan** pada reward yang sama.
4. Muat ulang tab Reward di portal.

**Diharapkan:** saat disembunyikan, *Reward Uji UAT* **tidak muncul sama
sekali** di portal; setelah diaktifkan, reward muncul kembali. Inilah kendali
"reward mana yang bisa di-redeem member".

---

## Skenario C — Member menukar reward (inti: XP tidak berkurang)
**Akun: portal member sebagai Budi (`628111222333`, 12.000 XP)**

1. **Catat dulu XP Budi** yang tampil di kartu ungu atas portal → harus `12.000 XP`.
2. Buka tab **Reward**.
3. Perhatikan *Diskon Ulang Tahun 20%*: tombol Tukar mati, tertulis
   **"XP kamu belum mencukupi — kurang 18.000 XP"**.
4. Pada *Tumbler Eksklusif* (min 10.000 XP), klik **Tukar**.
5. Perhatikan pesan hijau berisi kode `RDM-...`, lalu lihat blok
   **Reward Saya** di bawah.
6. **Periksa ulang XP Budi di kartu atas.**

**Diharapkan:**
- Redeem berhasil, muncul kode redemption dan status **"Menunggu diproses"**.
- **XP Budi tetap `12.000`** — tidak berkurang sepeser pun. *Ini kriteria
  terpenting dari fitur ini.*
- *Tumbler Eksklusif* kini terkunci dengan alasan **"Jatah redeem kamu untuk
  reward ini sudah habis"** (kuota 1x seumur hidup sudah terpakai).

---

## Skenario D — Kasir menyerahkan reward di venue
**Akun: `super@arkivworld.com`** (lihat catatan akun kasir di bagian 1) ·
tab **Permintaan Redeem**

**D1 — Memproses pengajuan dari portal:**
1. Buka tab **Permintaan Redeem** (badge oranye menunjukkan jumlah menunggu).
2. Cari permintaan Tumbler dari Skenario C, klik **Setujui**.
3. Ubah filter status ke `Disetujui`, lalu klik **Serahkan**.

**Diharapkan:** status berpindah Menunggu → Disetujui → Diserahkan; baris
menampilkan waktu penyerahan; di portal Budi, blok Reward Saya berubah jadi
**"Sudah diambil"**.

**D2 — Klaim langsung tanpa pengajuan portal:**
1. Di panel **Klaim Reward di Venue** (bagian atas tab yang sama), ketik
   `Budi` pada kolom cari member → pilih dari daftar yang muncul.
2. Pilih reward **Snack Harian** → klik **Klaim**.
3. Ulangi klaim *Snack Harian* untuk Budi **dua kali lagi**.

**Diharapkan:** klaim ke-1 dan ke-2 berhasil (langsung berstatus
**Diserahkan**, tanpa perlu approve); klaim **ke-3 ditolak** dengan pesan
jatah habis, karena kuota Snack Harian = 2x per hari.

---

## Skenario E — Syarat XP menolak member yang belum layak
**Akun: portal member sebagai Ani (`628111222444`, 500 XP)**

1. Login portal sebagai Ani, buka tab **Reward**.
2. Amati keempat reward.

**Diharapkan:**
- *Snack Harian* dan *Voucher Kopi Gratis* (min 0 XP) → **bisa** ditukar.
- *Tumbler Eksklusif* → terkunci, **"kurang 9.500 XP"**.
- *Diskon Ulang Tahun 20%* → terkunci, **"kurang 29.500 XP"**.
- *Reward Uji UAT* (min 1.000 XP) → terkunci, **"kurang 500 XP"**.

---

## Skenario F — Kuota bulanan benar-benar membatasi
**Akun: portal member sebagai Ani** lalu **`super@arkivworld.com`**

1. Sebagai Ani, tukar *Voucher Kopi Gratis*. Berhasil.
2. Tukar lagi *Voucher Kopi Gratis* (kuota sudah diubah jadi 2x/bulan di
   Skenario A). Berhasil — sisa jatah 0.
3. Coba tukar untuk ketiga kalinya.
4. Sebagai Super Admin, buka tab Permintaan Redeem, **Batalkan** salah satu
   permintaan Ani.
5. Kembali ke portal Ani, muat ulang tab Reward.

**Diharapkan:** percobaan ke-3 ditolak "Jatah redeem kamu untuk reward ini
sudah habis"; setelah admin membatalkan satu permintaan, jatah Ani kembali
tersedia 1x dan reward bisa ditukar lagi.

---

## Skenario G — Peran lain tidak boleh melihat data redeem
**Akun: `orang@sulu.com` (HRD)** — ulangi juga dengan `indra@arkiv.co`

1. Login sebagai HRD.
2. Buka <https://sulu.within.ventures/dashboard/crm/rewards>.
3. Klik tab **Permintaan Redeem**.

**Diharapkan:** tab **Katalog Reward** tetap bisa dilihat, tetapi saat tab
**Permintaan Redeem** dibuka muncul pesan merah *"Insufficient permissions"*
dan daftar permintaan tidak tampil. Data itu memuat nama & nomor HP member,
jadi sengaja dibatasi ke peran CRM (super admin, admin, kasir, supervisor)
dan direksi.

> Jika menurut Anda **direksi tidak perlu** melihat nama/nomor HP member,
> beri tahu — cukup satu baris di `CRM_READ_ROLES` (`src/lib/crm/server.ts`)
> untuk mencabutnya.

---

## Skenario H — Free XP saat profil 100% lengkap (fitur Fase D)
**Akun: portal member sebagai Citra (`628111222555`, 0 XP, profil kosong)**

1. Login portal sebagai Citra. Di beranda akan muncul spanduk kuning
   *"Lengkapi profil Anda (…%) dan dapatkan 100 Free XP!"*.
2. Buka tab **Profil**. Isi **semua** kolom: Nama, Email, Tanggal lahir,
   Jenis kelamin, Kota, **Foto profil (URL)**, dan aktifkan Promo WhatsApp.
3. Klik simpan.
4. Kembali ke tab Beranda, perhatikan kartu XP di atas.
5. Simpan profil **sekali lagi** tanpa mengubah apa pun.

**Diharapkan:**
- Muncul pesan *"Profil lengkap! Selamat, Anda mendapat 100 Free XP 🎉"*.
- XP Citra berubah `0 → 100`, dan spanduk kuning hilang.
- Penyimpanan kedua **tidak** menambah XP lagi (pesan hanya "Profil
  tersimpan") — Free XP sekali seumur hidup.

> **Kendala yang perlu Anda putuskan:** kolom **Foto profil masih berupa
> input URL teks**, bukan tombol unggah. Member yang membuka portal dari HP
> praktis tidak bisa mengisinya, sehingga profil sulit mencapai 100% dan Free
> XP jadi tidak terjangkau di dunia nyata. Untuk UAT, isi manual dengan URL
> apa pun (mis. `https://example.com/foto.jpg`). Repo sudah punya helper
> unggah berkas (`src/lib/storage.ts`, dipakai CV kandidat & portal karier)
> yang bisa dipasang di sini bila Anda setuju.

---

## Ringkasan kriteria lulus

- [ ] A — Kuota & periode bisa diatur admin dan tersimpan
- [ ] B — Toggle aktif menentukan reward muncul/tidak di portal member
- [ ] C — **XP member TIDAK berubah setelah redeem** *(kriteria utama)*
- [ ] D1 — Pengajuan portal bisa disetujui lalu diserahkan
- [ ] D2 — Kasir bisa klaim langsung; kuota harian menahan klaim ke-3
- [ ] E — Reward di atas ambang XP terkunci dengan kekurangan XP yang tepat
- [ ] F — Kuota bulanan menahan; pembatalan mengembalikan jatah
- [ ] G — Peran non-CRM ditolak melihat data redemption
- [ ] H — Free XP masuk sekali saat profil 100%, tidak dobel saat disimpan ulang

## Mengulang UAT dari nol

```sql
-- Hapus seluruh redemption uji & kembalikan stok
DELETE FROM crm.crm_redemptions;
UPDATE crm.crm_rewards SET stock_redeemed = 0;

-- Kembalikan Citra agar Skenario H bisa diulang dari nol
DELETE FROM crm.crm_xp_ledger l USING crm.crm_member_profiles p, pos.pos_customers c
 WHERE l.member_id = p.id AND p.customer_id = c.id AND c.phone = '628111222555';
UPDATE pos.pos_customers
   SET total_xp = 0, email = NULL, birth_date = NULL, gender = NULL, city = NULL,
       photo_url = NULL, wa_consent = false,
       profile_completed_at = NULL, free_xp_granted_at = NULL
 WHERE phone = '628111222555';
```

## Membersihkan data uji setelah selesai

```sql
DELETE FROM crm.crm_redemptions;
DELETE FROM crm.crm_rewards
 WHERE code IN ('snack-harian','voucher-kopi','merch-tumbler','diskon-ultah','tes-uat');
DELETE FROM crm.member_portal_sessions
 WHERE customer_id IN (SELECT id FROM pos.pos_customers
                        WHERE phone IN ('628111222333','628111222444','628111222555'));
DELETE FROM pos.pos_customers
 WHERE phone IN ('628111222333','628111222444','628111222555');
```
