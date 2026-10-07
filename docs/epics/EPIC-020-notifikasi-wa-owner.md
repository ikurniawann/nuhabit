# EPIC-020: Notifikasi WhatsApp untuk Owner

status: ready-for-qa
environment: dev
retries: 0

## Goal

Kabar penting bisnis mengejar owner lewat WhatsApp — tanpa perlu membuka
desktop. Prinsip utamanya anti-spam: desktop boleh cerewet, WA harus pelit.
Ujian setiap notifikasi: *layakkah ini menyela makan malam owner?*

## Keputusan Owner (2026-07-21)

Owner menyetujui seluruh usulan tiga tingkat, plus konfigurasi on/off per jenis
dan daftar nomor penerima, ditempatkan di Settings desktop Arkiv OS.

| Tingkat | Jenis | Kapan dikirim |
|---|---|---|
| **Kritis** | Void bernilai besar (ambang default Rp 500 rb) · stok bahan benar-benar habis · komplain pelanggan masuk (EPIC-012) · review Google ≤2 bintang (EPIC-013) | Seketika |
| **Harian** | Ringkasan jam tutup: omzet vs kemarin, kehadiran, antrean keputusan, stok menipis | 1×/hari |
| **Ambang** | Omzet hari berjalan anjlok · approval menginap >2 hari · kontrak PKWT habis ≤30 hari | Saat melewati batas |

Sengaja TIDAK dikirim: pesanan baru satu-per-satu, member baru, clock-in —
berita di desktop, sampah di WA.

## Scope

**Fase A — Konfigurasi (selesai)**
- `src/lib/wa/notifications-config.ts`: katalog 8 jenis (per tingkat), bentuk
  config, normalisasi nomor (08…/+62…/62… → 62…), parser toleran (JSON rusak/
  parsial jatuh ke default, bukan meledak). 9 unit test.
- `GET/PUT /api/settings/wa-notifications` + `POST …/test` (kirim pesan uji ke
  semua nomor tersimpan via `sendGatewayText`) — gate super_admin + direksi.
- Panel di desktop: Settings → **Notifikasi WA** (`wa-notif-settings.tsx`):
  saklar utama, toggle per jenis dikelompokkan per tingkat, ambang void bisa
  diubah, kelola nomor (tambah/hapus, maks 5), tombol Kirim Tes.
- Master switch default **mati** — notifikasi hidup hanya setelah owner sadar
  menyalakannya.

**Fase B — Mesin pengirim (selesai)**
- Ringkasan harian: penjadwal (cron PM2 / node-cron) jam tutup, format dari
  `buildDesktopOverview`.
- Void besar: kait di jalur void POS (event, bukan polling).
- Stok habis: cek saat pergerakan stok menyentuh nol.
- Dedup & cooldown: kejadian sama tidak dikirim dua kali; stok habis maks
  1×/bahan/hari. Jam tenang: non-kritis ditahan sampai pagi.

**Fase C — Sambungan omnichannel (selesai)**
- Komplain (EPIC-012) & review rendah (EPIC-013) memanggil pengirim yang sama.

**Fase D — Ambang lanjutan (selesai)**
- Omzet anjlok (perbandingan dengan rata-rata hari sejenis), approval menginap,
  kontrak habis (reuse logika `ContractExpiryBanner`).

## Non-Goals

- Notifikasi "sistem mati" — sistem yang mati tidak bisa mengirim; butuh
  watchdog eksternal, di luar epic ini.
- Balasan dua arah (owner membalas WA untuk approve) — menarik, tapi permukaan
  keamanannya besar; epic terpisah bila diminta.

## Acceptance Criteria

- [x] Fase A: konfigurasi tersimpan; nomor dinormalkan & divalidasi; endpoint
      menolak tanpa login; Kirim Tes membuktikan sambungan gateway.
- [x] Fase B: ringkasan harian terkirim terjadwal; void besar & stok habis
      terkirim seketika dengan dedup.
- [x] Fase C: komplain & review rendah terkirim.
- [x] Fase D: tiga notifikasi ambang berjalan.
- [ ] Semua: jenis yang dimatikan TIDAK PERNAH terkirim; master mati = senyap total.

## Test Plan

- Unit: normalisasi nomor, parser config, (Fase B) formatter pesan & aturan dedup.
- Manual: simpan nomor → Kirim Tes → pesan masuk WA; matikan jenis → tidak terkirim.

## Catatan Teknis

- Pengirim memakai `lib/whatsapp/gateway.ts` (`sendGatewayText`) — jalur yang
  sama dengan OTP portal member; sender +6285880974659 (services/wa-gateway).
- Config satu JSON di `app_settings.wa_notif_config`, bukan kolom-kolom
  terpisah — bentuknya masih akan berkembang di Fase B–D.

## Automation Log

- 2026-07-23 — **Fase C+D selesai — epic TUNTAS, status ready-for-qa.**
  Keputusan owner: omzet anjlok dihitung **month-to-date** (bukan intraday
  per-jam) — MTD tanggal 1..kemarin dibanding **pace target bulanan**
  (`sales_target_config` EPIC-021, prorata hari berjalan) bila target
  diisi, **fallback MTD bulan lalu** di titik hari yang sama (bulan pendek
  di-cap); anjlok bila < `omzetAnjlokPct` (config baru, default 80%, input
  di panel). Pagar: evaluasi mulai tanggal 5, baseline min Rp500rb, maks
  1 pesan/minggu (dedup key = minggu ISO WIB). Fase C: komplain → kait di
  aksi `set_complaint` inbox CRM (dedup per percakapan — toggle
  bolak-balik tidak spam); review rendah → kait di `syncGoogleReviews`
  hanya utk review BARU ber-bintang ≤2 (dedup per review id). Fase D
  lainnya: approval menginap (pending >2 hari: cuti/lembur/pinjaman/PO
  draft — definisi nav-badges + filter umur; 1 pesan/hari) & kontrak PKWT
  habis ≤30 hari (definisi route contracts/expiring, jaring -7 hari utk
  yang terlewat; sekali per kontrak per end_date — perpanjangan = kejadian
  baru; klaim-gabungan satu pesan). Semua ambang hanya dikirim jam 8-21
  WIB (jam tenang ditahan — non-kritis tidak menyela tidur). Verifikasi:
  804 unit test lulus (29 di lib wa), eslint bersih, build lulus (gagal
  sekali fetch font Google — transient, retry OK), PM2 restart, app
  online. Tidak ada migrasi baru (reuse wa_notif_log Fase B). QA owner:
  nyalakan master switch + nomor di Settings desktop; uji komplain
  (tandai percakapan inbox), omzet anjlok (kosongkan/isi target lalu cek
  log `[wa-notif]`), kontrak (buat PKWT dummy end_date <30 hari).
- 2026-07-22 — **Fase B selesai** (mesin pengirim). Delta `20260722230000`:
  tabel `configuration.wa_notif_log` = jejak + kunci dedup (UNIQUE
  notif_type+dedup_key); pengirim MENGKLAIM baris dulu (INSERT ON CONFLICT
  DO NOTHING) sebelum kirim — pola at-most-once followup-watcher
  sales-funnel: gagal jelas → klaim dilepas (retry), timeout → klaim
  dipertahankan. `notifications-sender.ts` (guard master/jenis/penerima/
  gateway + primitives claim/deliver/release + `fireOwnerNotification`
  tembak-dan-lupakan), `notifications-messages.ts` murni (formatter digest/
  void/stok + kunci dedup + waktu WIB; 12 unit test), `notifications-
  watcher.ts` (tick 5 mnt via instrumentation, pola watcher lain):
  (1) **digest harian** — terkirim sekali/hari WIB begitu jam ≥
  `digestHour` (field config baru, default 22, input di panel Settings,
  dedup key = tanggal → restart server tidak kirim ulang; cek murah ke log
  sebelum membangun overview), isi dari `buildDesktopOverview` EPIC-019
  (seksi gagal dilewati, bukan angka nol palsu; kemarin=0 → tanpa persen
  pembanding); (2) **stok habis** — qty_available ≤ 0 (definisi fetchLowStock
  dipersempit ke nol), klaim per bahan (1×/bahan/hari) tapi SATU pesan WA
  gabungan berisi bahan yang terklaim; bahan baru habis siang hari =
  pesan susulan. (3) **void besar** = event di route void POS (bukan
  polling): total ≥ `voidThresholdRp` → fire-and-forget (notifikasi tak
  boleh menggagalkan void), dedup by order id; ikutan: `catch(any)` lama
  di route void dirapikan ke unknown. Verifikasi: 796 unit test lulus
  (21 di lib wa), eslint bersih, build lulus (BUILD_ID dicek), migrasi
  applied (tabel diverifikasi), PM2 restart, app online. Catatan QA:
  master switch masih default MATI — nyalakan di Settings desktop +
  simpan nomor, lalu uji: void ≥ ambang → WA masuk; set digestHour ke
  jam sekarang → tunggu tick ≤5 mnt. Sisa: Fase C (komplain + review
  rendah) & Fase D (3 ambang).

- 2026-07-21 — **Fase A selesai.** Lib config + 9 unit test, API GET/PUT/test
  ber-gate super_admin+direksi (401 tanpa login terverifikasi), panel Settings →
  Notifikasi WA di desktop (saklar utama default mati, toggle per jenis per
  tingkat, ambang void, maks 5 nomor ternormalisasi, Kirim Tes per-nomor dengan
  hasil per baris). 700 test hijau, build sukses. Sisa QA: buka panel dari
  Settings desktop, simpan nomor sungguhan, tekan Kirim Tes — pesan harus masuk
  WA (butuh wa-gateway hidup di server dev).
