# Runbook — Gateway WhatsApp Mandiri (`services/wa-gateway`)

Engine WhatsApp milik sendiri berbasis **Baileys**, menggantikan Fonnte.
Tanpa langganan, tanpa pihak ketiga, dan pesan OTP tidak transit di server
orang lain.

Dipilih owner 19 Jul 2026 karena jalur resmi (Meta Cloud API) butuh verifikasi
bisnis yang memakan waktu lama.

---

## Yang harus Anda pahami sebelum pairing

**Risiko blokir tetap ada.** Gateway ini memakai protokol WhatsApp Web yang
tidak resmi — sama persis seperti Fonnte. Membangun sendiri menghilangkan biaya
dan ketergantungan pihak ketiga, **bukan** risiko nomor diblokir. Hanya Meta
Cloud API resmi yang menghilangkan risiko itu.

**Nomor tetap normal.** Berbeda dengan Cloud API, nomor pengirim
**`+62 858-8097-4659`** tetap menjadi akun WhatsApp biasa. Gateway hanya
menambah "perangkat tertaut" seperti WhatsApp Web — **riwayat chat tidak
hilang** dan nomor tetap bisa dipakai dari HP seperti biasa.

**HP harus tetap aktif sesekali.** Seperti WhatsApp Web, perangkat tertaut bisa
kedaluwarsa bila HP terlalu lama offline. Kalau itu terjadi, gateway minta
pairing ulang dan OTP berhenti sampai ada yang memindai QR baru.

---

## Arsitektur

```
Next.js (PM2: arkiv-pos-saas)          wa-gateway (PM2, proses terpisah)
  sendWhatsAppOtp()                      Baileys  ─────► WhatsApp
        │  HTTP + x-gateway-token          │
        └──────────► 127.0.0.1:3471 ───────┘
                                          .session/  (kredensial, gitignored)
```

Gateway sengaja **dipisah** dari aplikasi: Next.js di-restart setiap deploy,
dan kalau koneksi WhatsApp ikut di dalamnya, sesi akan putus tiap rilis.

Gateway **hanya mendengar di 127.0.0.1** dan setiap permintaan wajib membawa
header `x-gateway-token`. Jangan pernah ekspos port ini ke internet — siapa pun
yang bisa memanggilnya bisa mengirim WhatsApp atas nama bisnis Anda.

| Endpoint | Guna |
|---|---|
| `GET /health` | Status koneksi (tanpa token, untuk monitoring) |
| `GET /qr` | Ambil QR pairing (butuh token) |
| `POST /send` | Kirim pesan `{ target, message }` (butuh token) |

---

## Pairing pertama kali *(perlu Anda lakukan, sekali)*

**Cara termudah — lewat dashboard (khusus Super Admin):**

1. Login ke <https://sulu.within.ventures> sebagai Super Admin.
2. Buka **Settings → WhatsApp Gateway** (`/dashboard/settings/wa-gateway`).
3. Halaman menampilkan QR yang menyegarkan diri otomatis (QR WhatsApp berganti
   tiap ±20 detik).
4. Di HP nomor **+62 858-8097-4659**: **WhatsApp → Setelan → Perangkat
   Tertaut → Tautkan Perangkat**, pindai QR di layar.
5. Halaman berubah jadi "Terhubung sebagai +6285880974659" begitu berhasil.

> QR di halaman itu adalah kredensial sesi WhatsApp — jangan bagikan
> tangkapan layarnya. Karena itu pula halaman & API-nya dikunci super_admin.

**Cara alternatif — lewat terminal server:**

1. ```bash
   pm2 logs wa-gateway --lines 40 --nostream
   ```

   QR ASCII tampil di bawah baris *"QR pairing tersedia"*; jalankan lagi bila
   kedaluwarsa.

2. Pindai dengan cara yang sama seperti di atas.

3. Pastikan berhasil:

   ```bash
   curl -s http://127.0.0.1:3471/health
   ```

   Diharapkan `"connected": true` dan `"phone": "6285880974659"`.

4. Agar gateway otomatis hidup setelah server reboot:

   ```bash
   pm2 save
   ```

Setelah pairing, kredensial tersimpan di `services/wa-gateway/.session/` dan
**bertahan melewati restart** — tidak perlu scan ulang tiap kali.

## Uji kirim

```bash
# ganti dengan nomor WhatsApp asli Anda
curl -s -X POST http://127.0.0.1:3471/send \
  -H "x-gateway-token: $(grep -oP '^WA_GATEWAY_TOKEN=\K.*' services/wa-gateway/.env)" \
  -H "Content-Type: application/json" \
  -d '{"target":"628xxxxxxxxxx","message":"Tes gateway Arkiv"}'
```

Lalu uji lewat aplikasi: minta OTP di <https://member.within.ventures> dengan
nomor member yang asli. Diharapkan respons memuat `"wa_delivered": true`.

> Nomor member uji (`628111222333` dst.) fiktif. Ganti dulu ke nomor asli:
> ```sql
> UPDATE pos.pos_customers SET phone = '<62nomor-asli>' WHERE phone = '628111222333';
> ```

---

## Operasional

**Konfigurasi** ada di dua tempat:

| File | Isi |
|---|---|
| `services/wa-gateway/.env` (gitignored) | `WA_GATEWAY_TOKEN`, port, level log |
| `.env` aplikasi | `WHATSAPP_PROVIDER=gateway`, `WA_GATEWAY_URL`, `WA_GATEWAY_TOKEN` (harus sama) |

**Pacing.** Gateway mengirim serial dengan jeda acak 1,5–3,5 detik antar pesan
(`WA_MIN_GAP_MS` / `WA_MAX_GAP_MS`). Ini disengaja: mengirim beruntun tanpa
jeda adalah pola paling khas yang memicu pemblokiran. Jangan dikecilkan tanpa
alasan kuat.

**Pindah penyedia** cukup lewat env aplikasi, tanpa ubah kode:
`WHATSAPP_PROVIDER` = `gateway` | `meta` | `fonnte`. Bila dikosongkan, deteksi
otomatis memilih berurutan: Meta → gateway → Fonnte.

### Diagnosa

| Gejala | Tindakan |
|---|---|
| `wa_delivered: false`, log `WhatsApp belum terhubung` | Cek `/health`; kalau `needsPairing: true`, ulangi pairing |
| `Gateway tidak merespons (timeout)` | `pm2 restart wa-gateway`, lalu cek `pm2 logs wa-gateway` |
| Log `Sesi dicabut` | Perangkat dilepas dari HP. Hapus `services/wa-gateway/.session/` lalu pairing ulang |
| Terputus berulang | Cek koneksi internet server & apakah HP nomor pengirim terlalu lama offline |

```bash
pm2 restart wa-gateway
pm2 logs wa-gateway --lines 50 --nostream
curl -s http://127.0.0.1:3471/health
```

---

## Batas Fase 1 (yang belum ada)

- **Belum ada pemantauan otomatis.** Kalau gateway terputus, tidak ada yang
  memberi tahu — OTP diam-diam berhenti. Sebaiknya ditambah alarm yang
  memeriksa `/health` berkala.
- **Belum menerima pesan masuk.** Fondasi untuk inbox dua arah & broadcast
  (epic Omnichannel CRM) belum dibangun; Baileys mendukungnya, tinggal
  ditambahkan di fase berikutnya.
- **Belum ada antrean tahan-restart.** Pesan yang sedang mengantre hilang bila
  proses restart. Untuk OTP dampaknya kecil (member bisa minta ulang), tapi
  untuk broadcast nanti perlu antrean persisten.
- **Belum ada jalur cadangan otomatis.** Bila gateway mati, sistem tidak
  otomatis pindah ke penyedia lain.
