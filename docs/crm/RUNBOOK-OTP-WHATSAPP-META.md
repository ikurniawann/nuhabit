# Runbook — OTP WhatsApp via WhatsApp Business Cloud API (Meta)

Jalur **resmi**. Dipilih owner 19 Jul 2026 menggantikan rencana Fonnte, karena
hanya jalur ini yang menghilangkan risiko nomor diblokir WhatsApp.

---

## Yang sudah siap di kode

| Komponen | Status |
|---|---|
| Lapisan provider `src/lib/whatsapp/` | ✅ Meta + Fonnte, dipilih lewat env |
| Payload template AUTHENTICATION (body + tombol salin-kode) | ✅ Dibangun & diuji (11 unit test) |
| OTP portal member memakai template | ✅ `sendWhatsAppOtp()` |
| Notifikasi lain (rekrutmen dsb.) | ✅ Tetap jalan, lihat peringatan di bawah |
| Degradasi saat belum dikonfigurasi | ✅ Tidak crash; di dev kode OTP tetap muncul di log |
| **Kredensial Meta** | ❌ **Belum ada — penghalang tersisa** |

Peralihan penyedia cukup lewat env, tanpa ubah kode:

| Env | Arti |
|---|---|
| `WHATSAPP_PROVIDER` | `meta` \| `fonnte` \| kosong (deteksi otomatis, Meta didahulukan) |
| `META_WA_ACCESS_TOKEN` | Token System User (permanen) |
| `META_WA_PHONE_NUMBER_ID` | ID nomor pengirim dari dashboard Meta |
| `META_WA_OTP_TEMPLATE` | Nama template OTP (default `otp_login`) |
| `META_WA_OTP_LANG` | Kode bahasa template (default `id`) |
| `META_WA_OTP_BUTTON` | `false` bila template dibuat tanpa tombol salin-kode |

---

## Langkah 1 — Prasyarat bisnis *(Anda, dan ini bagian terlama)*

Saya tidak bisa mendaftarkan akun atau mengunggah dokumen legal atas nama Anda.

1. Siapkan **Meta Business Account** di <https://business.facebook.com>.
2. Ajukan **Verifikasi Bisnis**: butuh dokumen legal perusahaan (akta/NIB/NPWP)
   dan bukti alamat. **Proses ini bisa memakan beberapa hari sampai minggu** —
   mulai lebih awal, ini penentu jadwal keseluruhan.
3. Buat **WhatsApp Business Account (WABA)** di Business Manager.

### Nomor pengirim — sudah ditetapkan

**`+62 858-8097-4659`** (dinormalisasi sistem jadi `6285880974659`).
Ditetapkan owner 19 Jul 2026.

Sudah diperiksa:
- ✅ Format lolos normalisasi nomor di aplikasi (`normalizePhoneDigits`).
- ✅ Belum terdaftar sebagai member di `pos_customers` — tidak bentrok.

Yang **masih perlu Anda pastikan sendiri** sebelum mendaftarkannya ke Meta:

1. **Nomor ini tidak boleh sedang aktif di aplikasi WhatsApp biasa maupun
   WhatsApp Business biasa.** Kalau sekarang masih dipakai, hapus dulu akun
   WhatsApp di nomor tersebut — dan sadari **riwayat chat di nomor itu akan
   hilang**, tidak bisa dikembalikan setelah pindah ke Cloud API.
2. **Nomor harus bisa menerima SMS atau telepon** saat verifikasi Meta.
3. **Jangan daftarkan nomor ini sebagai member.** Ia akan jadi pengirim OTP;
   kalau ikut jadi member, sistem berpotensi mengirim OTP dari nomor itu ke
   dirinya sendiri.
4. Setelah tertaut ke Cloud API, nomor ini **tidak bisa lagi dipakai lewat
   aplikasi WhatsApp biasa** — semua percakapan hanya lewat API/Business
   Manager. Pastikan tidak ada operasional yang masih bergantung padanya.

## Langkah 2 — Nomor & kredensial

1. Di WABA → **Phone Numbers** → tambahkan nomor, verifikasi lewat SMS/telepon.
2. Catat **Phone Number ID** (bukan nomornya) → `META_WA_PHONE_NUMBER_ID`.
3. Buat **System User** di Business Settings dengan akses ke WABA, lalu
   terbitkan **token permanen** dengan izin `whatsapp_business_messaging` dan
   `whatsapp_business_management` → `META_WA_ACCESS_TOKEN`.

> Hindari token sementara dari halaman *Getting Started* — masa berlakunya 24
> jam dan OTP akan mati diam-diam keesokan harinya.

## Langkah 3 — Template OTP *(wajib disetujui lebih dulu)*

Meta melarang teks bebas untuk pesan yang diinisiasi bisnis. OTP **harus**
template kategori **AUTHENTICATION**.

1. WABA → **Message Templates** → *Create Template*.
2. Kategori **Authentication**, nama `otp_login`, bahasa **Indonesian (id)**.
3. Pilih tipe kode **Copy code** (tombol salin). Meta menyusun sendiri teks
   badannya; parameter `{{1}}` diisi kode OTP.
4. Kirim untuk ditinjau. Template autentikasi biasanya disetujui cepat
   (menit sampai jam), jauh lebih cepat dari verifikasi bisnis.

Bila Anda memakai nama atau bahasa berbeda, cukup sesuaikan
`META_WA_OTP_TEMPLATE` / `META_WA_OTP_LANG` — tidak perlu ubah kode.

## Langkah 4 — Pasang ke server

```bash
nano /home/ilhamkurniawan/arkiv-pos-saas/.env
#   WHATSAPP_PROVIDER=meta
#   META_WA_ACCESS_TOKEN=<token system user>
#   META_WA_PHONE_NUMBER_ID=<phone number id>

pm2 restart arkiv-pos-saas
```

`.env` tidak masuk git. Sebaiknya Anda sendiri yang menempelkan token; setelah
terpasang saya lanjutkan verifikasi.

## Langkah 5 — Verifikasi

1. Pastikan ada member dengan nomor WhatsApp asli (nomor uji `628111222333`
   dst. fiktif dan akan ditolak):

   ```sql
   UPDATE pos.pos_customers SET phone = '<62nomor-asli>' WHERE phone = '628111222333';
   ```

2. Minta OTP dari <https://member.within.ventures>.
3. **Diharapkan:** respons memuat `"wa_delivered": true` dan pesan OTP masuk.
4. Bila gagal, alasannya tercatat lengkap dengan kode error Graph API:

   ```bash
   pm2 logs arkiv-pos-saas --lines 40 --nostream | grep "gagal terkirim"
   ```

   | Gejala | Penyebab umum |
   |---|---|
   | `Template name does not exist` (132001) | Nama/bahasa template tidak cocok dengan env |
   | `(#131030) Recipient not in allowed list` | Nomor uji belum didaftarkan saat akun masih mode sandbox |
   | `Invalid OAuth access token` | Token sementara sudah kedaluwarsa — pakai token System User |
   | `(#100) Param ... button` | Template dibuat tanpa tombol → set `META_WA_OTP_BUTTON=false` |

---

## Dampak yang perlu Anda ketahui

**Notifikasi non-OTP belum tentu terkirim.** Fitur notifikasi rekrutmen
(`/api/notifications/send`) mengirim **teks bebas** ke kandidat. Di API resmi,
teks bebas hanya lolos dalam **jendela 24 jam** setelah penerima membalas — di
luar itu ditolak. Artinya, begitu `WHATSAPP_PROVIDER=meta` aktif, notifikasi
kandidat akan gagal kecuali dibuatkan template masing-masing.

Pilihan yang tersedia, silakan tentukan:
1. **Buat template** untuk tiap jenis notifikasi (interview, offer, slip gaji).
   Paling benar, tapi tiap template perlu diajukan & disetujui.
2. **Dua penyedia berdampingan** — OTP lewat Meta, notifikasi lain tetap lewat
   Fonnte. Lapisan provider sudah mendukung ini; butuh sedikit penyesuaian agar
   pemilihan penyedia bisa per-jenis-pesan.
3. **Biarkan dulu** — notifikasi kandidat memang belum aktif dipakai di dev
   (kunci Fonnte kosong sejak awal, jadi selama ini tidak pernah terkirim).

**Biaya.** Meta menagih per percakapan; kategori *authentication* punya tarif
sendiri per negara. Perkirakan dari jumlah login member per bulan.

---

## Ringkasan pembagian tugas

| Langkah | Siapa |
|---|---|
| Lapisan provider, payload template, tes, degradasi aman | ✅ Sudah saya kerjakan |
| Verifikasi bisnis Meta & pengajuan template | **Anda** |
| Memilih nomor pengirim | **Anda** |
| Menempelkan token ke `.env` | **Anda** |
| Restart, uji kirim, telusuri error Graph API | Saya |
| Memutuskan nasib notifikasi non-OTP (3 opsi di atas) | **Anda** |
