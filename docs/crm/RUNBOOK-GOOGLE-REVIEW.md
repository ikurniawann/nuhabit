# Runbook — Mengaktifkan Google Review (baca & balas)

EPIC-013 Fase A. Menarik ulasan Google Business Profile ke dashboard dan
**membalasnya langsung dari dashboard** — tanpa scraping.

---

## Status

| Komponen | Status |
|---|---|
| Skema `crm.google_reviews` + konfigurasi | ✅ Applied di dev |
| Aturan (rating, komplain, SLA, validasi balasan) | ✅ 17 unit test |
| Klien Google (OAuth refresh, tarik ulasan, kirim balasan) | ✅ Siap, menunggu kredensial |
| Sinkronisasi berkala tiap 15 menit | ✅ Terdaftar di `instrumentation.ts` |
| Halaman `/dashboard/crm/reviews` + menu | ✅ Live |
| Form kredensial di UI (Super Admin) | ✅ Live — tanpa terminal |
| **Kredensial Google** | ❌ **Belum ada — penghalang tersisa** |

Tanpa kredensial semuanya berdegradasi rapi: halaman tetap terbuka dengan
peringatan, sinkronisasi dilewati (log info sekali, tidak spam), dan tombol
balas menolak dengan pesan jelas.

---

## Kenapa bukan scraping

Permintaan awal menyebut "scraping Google review". Itu **tidak diperlukan dan
lebih buruk**:

- Google Business Profile API resmi **mendukung baca dan balas**.
- Membalas ulasan **wajib terautentikasi sebagai pengelola lokasi** — scraping
  secara teknis tidak bisa membalas sama sekali, jadi hanya memberi separuh
  fitur.
- Scraping melanggar ToS, rapuh terhadap perubahan tampilan, dan berisiko pada
  profil bisnis itu sendiri.

---

## Langkah 1 — Prasyarat *(Anda; ini jalur kritis)*

1. Pastikan **Google Business Profile** lokasi Sulu sudah **terverifikasi** dan
   akun Anda punya akses **pengelola/pemilik** lokasi.
2. Buat project di <https://console.cloud.google.com>.
3. Aktifkan API Business Profile pada project tersebut.
4. **Ajukan akses** lewat formulir permintaan Google untuk Business Profile
   APIs. Google meninjau permohonan ini — **mulai lebih awal**, ini penentu
   jadwal. Umumnya lebih ringan daripada App Review Meta, tapi tetap antre.

## Langkah 2 — OAuth

1. Buat **OAuth client ID** (tipe Web/Desktop) → catat *client ID* & *secret*.
2. Lakukan izin (consent) sekali sebagai akun pengelola lokasi dengan scope
   `https://www.googleapis.com/auth/business.manage`, minta **offline access**
   agar dapat **refresh token**.
3. Catat **refresh token** — inilah yang dipakai server; access token
   diperbarui otomatis oleh aplikasi.

## Langkah 3 — Cari account & location ID

Panggil API daftar akun & lokasi memakai access token Anda, lalu catat
keduanya dalam bentuk resource:

- `GOOGLE_BP_ACCOUNT_ID` → `accounts/1234567890`
- `GOOGLE_BP_LOCATION_ID` → `locations/9876543210`

> Format harus lengkap dengan awalan `accounts/` dan `locations/` — klien
> menggabungkannya menjadi path ulasan.

## Langkah 4 — Pasang lewat halaman *(tanpa terminal)*

1. Login Super Admin → **CRM → Google Review**.
2. Klik **Hubungkan Sekarang** (atau "Pengaturan koneksi Google").
3. Isi 5 kolom: Client ID, Client Secret, Refresh Token, Account ID,
   Location ID → **Simpan Kredensial**.

Account/Location boleh diisi **angkanya saja** — awalan `accounts/` dan
`locations/` ditambahkan otomatis.

Catatan keamanan:
- Client Secret & Refresh Token **tidak pernah dikirim balik ke browser** —
  yang tampil hanya penanda "tersimpan" dan versi tersamar.
- Mengosongkan kolom rahasia saat menyimpan berarti **"biarkan yang lama"**,
  bukan menghapus. Jadi mengubah Location ID saja tidak akan menghilangkan
  token.
- Tombol **Putuskan** menghapus seluruh kredensial (dipakai saat pindah akun
  atau lokasi).
- Halaman ini hanya bisa dibuka **Super Admin**.

> Alternatif lama lewat `.env` (`GOOGLE_BP_*`) tetap didukung sebagai
> cadangan. Bila keduanya terisi, **nilai dari halaman yang menang**.

## Langkah 5 — Verifikasi

1. Buka **CRM → Google Review** sebagai Super Admin.
2. Peringatan kuning "integrasi belum terhubung" harus hilang.
3. Klik **Tarik Ulasan** → muncul jumlah ulasan baru/diperbarui.
4. Pilih satu ulasan → **Balas** → **Kirim ke Google**.
5. Cek di Google Maps/Business Profile: balasan Anda tampil publik.

Kalau gagal, pesan error dari Google ditampilkan apa adanya (mis. izin kurang,
lokasi salah, atau akses API belum disetujui).

---

## Cara kerja & hal yang perlu diketahui

**Satu ulasan = satu balasan.** Google mengganti balasan lama saat dikirim
ulang, bukan menambah. UI sudah menegaskan ini; tombolnya berbunyi "Ubah
balasan" bila sudah pernah dibalas.

**Balasan disimpan setelah Google menerima**, bukan sebelumnya. Jadi dashboard
tidak akan pernah menampilkan balasan yang sebenarnya gagal terkirim —
diverifikasi: mencoba membalas tanpa kredensial menolak dengan rapi dan tidak
meninggalkan catatan balasan di database.

**Ulasan bintang rendah otomatis jadi komplain.** Ambangnya
`gr_complaint_max_rating` (default 3). SLA waktu balas `gr_sla_reply_minutes`
(default 1440 menit = 1 hari), dihitung **dari waktu ulasan terbit menurut
Google** — kalau sinkronisasi telat, SLA tidak ikut mundur.

**Sinkronisasi** berjalan tiap 15 menit, idempoten berdasarkan id ulasan
Google. Ulasan yang diedit pengulas ikut diperbarui; status kerja kita
(`diabaikan`) tidak tertimpa. Balasan yang dibuat lewat aplikasi Google (di
luar dashboard) ikut terbaca.

### Konfigurasi

| Kunci (`crm_settings`) | Arti | Default |
|---|---|---|
| `gr_complaint_max_rating` | Bintang ≤ nilai ini = komplain | 3 |
| `gr_sla_reply_minutes` | Target waktu membalas | 1440 |
| `gr_sync_enabled` | Matikan sinkronisasi sementara | true |

---

## Ganti akun Google di kemudian hari

**Boleh memakai akun Google yang ada dulu, lalu diganti nanti.** Yang penting
akun itu punya akses **pengelola/pemilik** pada Business Profile lokasi Sulu —
akun pribadi tanpa akses tidak akan bisa menarik ulasan sama sekali. Bila
perlu, tambahkan akun tersebut sebagai Manager pada lokasi lewat Business
Profile.

Menggantinya nanti cukup lewat halaman yang sama: isi ulang 5 kolom lalu
Simpan (atau **Putuskan** dulu bila ingin bersih). Token lama otomatis dibuang
dari cache — **tanpa restart, tanpa perubahan kode atau migrasi.**

Ulasan tidak akan tergandakan setelah ganti akun: kunci dedup memakai
`review_id` (segmen terakhir id ulasan Google) yang stabil lintas akun, bukan
resource path yang memuat id akun. Path lengkapnya sendiri disegarkan tiap
sinkronisasi supaya balasan tetap terkirim ke alamat yang benar.

> Yang perlu diperhatikan: riwayat balasan yang dibuat akun lama tetap
> tersimpan di dashboard. Bila lokasi yang dipantau benar-benar berbeda
> (bukan sekadar ganti akun pengelola), kosongkan tabel agar tidak bercampur.

## Membersihkan data contoh

Dev diisi 4 ulasan contoh agar UI bisa dilihat sebelum integrasi aktif.
Hapus sebelum/ sesudah integrasi nyata menyala:

```sql
DELETE FROM crm.google_reviews WHERE review_name LIKE 'accounts/1/locations/2/%';
```

## Batas Fase A

- Belum ada persetujuan supervisor untuk balasan ulasan bintang rendah
  (balasan langsung terkirim begitu agent menekan kirim).
- Belum masuk laporan CS (metrik ulasan masih di halaman Google Review saja).
- Baru satu lokasi. Multi-lokasi perlu penyimpanan kredensial per lokasi.
