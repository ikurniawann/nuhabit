# Runbook — Mengaktifkan OTP WhatsApp Portal Member (Fonnte)

Tujuan: login `member.within.ventures` lewat OTP WhatsApp benar-benar terkirim
ke HP member, bukan lagi dibaca dari log server.

---

## Status saat ini

| Komponen | Status |
|---|---|
| Alur OTP (buat kode, simpan hash, verifikasi, sesi) | ✅ Sudah jalan |
| Rate limit & kedaluwarsa | ✅ 3 permintaan/10 menit per nomor, kode berlaku 5 menit, maks 5 percobaan |
| Batas penerima | ✅ Hanya nomor yang terdaftar sebagai member yang bisa minta OTP |
| Endpoint Fonnte | ✅ Sudah diperbaiki (lihat catatan di bawah) |
| **Kredensial Fonnte** | ❌ **Belum ada — ini satu-satunya penghalang tersisa** |

### Yang sudah diperbaiki lebih dulu (commit `793506d`)

1. **URL Fonnte salah.** Kode memakai `https://api.fonnte.com/api/send-message`
   yang mengembalikan **HTTP 404**. Endpoint resminya
   `https://api.fonnte.com/send`. Artinya: seandainya token diisi tanpa
   perbaikan ini, OTP **tetap tidak akan terkirim** dan gejalanya
   membingungkan (API menjawab sukses, pesan tidak pernah sampai). Perbaikan
   ini juga menyembuhkan notifikasi WA lain (mis. slip gaji) yang selama ini
   gagal diam-diam.
2. **Kode OTP tertulis di log.** Saat pengiriman gagal, kode 6 digit dicatat ke
   log — berguna di dev, berbahaya di produksi (pembaca log bisa masuk sebagai
   member mana pun). Sekarang hanya dicatat di `NODE_ENV` non-produksi.

---

## Langkah 1 — Akun & perangkat Fonnte *(harus Anda kerjakan sendiri)*

Saya tidak bisa mendaftarkan akun atau memasukkan kredensial atas nama Anda.
Langkah ini dilakukan manual:

1. Daftar di <https://fonnte.com> lalu masuk ke dashboard.
2. Aktifkan paket. Fonnte berbayar; ada masa uji coba terbatas. **Perkirakan
   kuota** dari jumlah login member per bulan — 1 login = 1 pesan.
3. Menu **Device** → **Add Device**. Isi nama device (mis. `Sulu Wonderland`).
4. Fonnte menampilkan **QR code**. Buka WhatsApp di HP nomor bisnis →
   *Perangkat Tertaut* → *Tautkan Perangkat* → pindai QR.
5. Setelah status device **connected**, salin **Token** device tersebut.

> **Keputusan yang perlu Anda ambil di langkah ini:** nomor WhatsApp mana yang
> jadi pengirim. Nomor itu akan tertaut ke Fonnte dan menjadi identitas yang
> dilihat member. Sebaiknya nomor bisnis khusus, **bukan** nomor pribadi
> pemilik/karyawan.

## Langkah 2 — Pasang token ke server *(saya bisa bantu, tapi token jangan dikirim lewat chat)*

Token adalah kredensial. Cara paling aman: Anda sendiri yang menempelkannya.

```bash
# di server dev, dari root repo
nano /home/ilhamkurniawan/arkiv-pos-saas/.env
# ubah baris:  FONNTE_API_KEY=
# menjadi:     FONNTE_API_KEY=<token-device-dari-fonnte>

pm2 restart arkiv-pos-saas
```

`.env` tidak masuk git, jadi token tidak akan ikut ter-commit.
Kalau Anda lebih suka saya yang menjalankan restart-nya, cukup isi tokennya
lalu bilang — saya lanjutkan verifikasinya.

## Langkah 3 — Verifikasi

1. Pastikan ada member dengan **nomor WhatsApp asli** (nomor Anda sendiri).
   Nomor uji `628111222333` dst. adalah nomor fiktif — Fonnte akan menolaknya.
   Daftarkan lewat kasir, atau ubah nomor member uji:

   ```sql
   UPDATE pos.pos_customers SET phone = '<62nomor-asli-anda>'
    WHERE phone = '628111222333';
   ```

2. Buka <https://member.within.ventures>, masukkan nomor itu, minta OTP.
3. **Yang diharapkan:** respons API memuat `"wa_delivered": true`, dan pesan
   OTP masuk ke WhatsApp dalam beberapa detik.
4. Bila `wa_delivered: false`, lihat alasannya di log:

   ```bash
   pm2 logs arkiv-pos-saas --lines 40 --nostream | grep "gagal terkirim"
   ```

   Alasan yang umum: `invalid token` (token salah/expired), device
   **disconnected** di dashboard Fonnte, atau kuota habis.

---

## Hal yang perlu dipertimbangkan sebelum produksi

**Risiko pemblokiran nomor.** Fonnte adalah gateway **tidak resmi** — ia
menjalankan WhatsApp Web di balik layar. WhatsApp bisa memblokir nomor yang
mengirim pesan otomatis dalam volume besar. Untuk OTP yang volumenya naik
seiring jumlah member, ini risiko nyata: kalau nomor kena blokir, **seluruh
login portal mati**. Mitigasi: pakai nomor khusus (bukan nomor operasional
utama), dan siapkan rencana cadangan.

**Alternatif resmi.** WhatsApp Business API via Meta (atau penyedia seperti
Twilio) jauh lebih tahan blokir dan memang dirancang untuk OTP, tetapi butuh
verifikasi bisnis dan template pesan yang disetujui lebih dulu, serta biayanya
per-percakapan. Untuk jangka panjang dengan volume besar, ini pilihan yang
lebih aman.

**Device harus tetap terhubung.** HP yang dipakai memindai QR sebaiknya tetap
menyala dan online. Kalau sesi WhatsApp Web putus, device jadi *disconnected*
dan OTP berhenti terkirim tanpa pemberitahuan. Ada baiknya memantau status
device secara berkala.

**Jalan keluar saat darurat.** Bila Fonnte bermasalah di produksi, member tidak
bisa login sama sekali. Pertimbangkan jalur cadangan — misalnya admin bisa
membuatkan sesi/OTP manual dari dashboard untuk member yang komplain. Fitur ini
**belum ada**; beri tahu bila ingin dibuatkan.

---

## Ringkasan pembagian tugas

| Langkah | Siapa |
|---|---|
| Perbaikan endpoint & keamanan log | ✅ Sudah saya kerjakan |
| Daftar akun Fonnte, beli paket, scan QR device | **Anda** (saya tidak boleh membuat akun/memasukkan kredensial) |
| Menempelkan token ke `.env` | **Anda** (atau saya, setelah token terpasang) |
| Restart, uji kirim, telusuri kegagalan | Saya |
| Memutuskan nomor pengirim & Fonnte vs API resmi | **Anda** |
