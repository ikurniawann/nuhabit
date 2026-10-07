# EPIC-019: Desktop Arkiv OS — Pusat Monitoring Owner

status: ready-for-qa
environment: dev
retries: 0

## Goal

Mengubah desktop `/arkiv-os` dari launcher cantik berisi angka pajangan menjadi
permukaan monitoring yang benar-benar dipakai owner/level tinggi: sekali buka
langsung terlihat denyut bisnis hari ini (omzet, tim, stok, hal yang menunggu
keputusan), setiap angka bisa diklik menuju modulnya, dan pertanyaan lanjutan
bisa langsung dilempar ke Do.

## Evidence (audit 2026-07-21)

Anchor: `src/components/arkiv/arkiv-os-desktop.tsx` (2.588 baris).

1. **Semua angka monitoring saat ini hardcoded.** `DesktopWidgets` menampilkan
   "System Health 98%" dan "Pending 8 — Approvals & reviews" sebagai string
   literal (baris 813–814). Notification Center berisi array 4 string statis
   (baris 132–137: "5 kandidat baru…", "3 PO perlu approval…"). Toast pembuka
   "3 pending approval notifications" juga literal. **Tidak ada satu pun call
   data dari desktop.** Bagi owner ini lebih buruk dari kosong — angka palsu
   menumbuhkan kebiasaan mengabaikan angka.
2. **Data aslinya sudah tersedia, tinggal disambungkan:**
   - `/api/pos/dashboard/{stats,weekly,funnel,attention,sources}` — penjualan.
   - `/api/hris/nav-badges` — jumlah pending per modul ESS/HR.
   - Logika roster harian (`deriveRosterStatus`, EPIC-007) — hadir/terlambat/belum absen.
   - Query tool Do (EPIC-017 Fase D): `stok_menipis`, `penjualan_periode`,
     `absensi_hari_ini` — sudah teruji dengan data dev.
   - `buildSystemSummary` di route Do — agregat count 8 modul (pola yang benar,
     tetapi terkubur di route asisten).
3. **Desktop dirender juga untuk pengunjung belum login** (ikon punya
   `loginHref`); widget dengan data bisnis wajib digate login + role.
4. **Preferensi user sudah ada fondasinya** — visibilitas widget & posisi ikon
   tersimpan di localStorage; tinggal diperluas.

## Prinsip Desain (kenapa, bukan hanya apa)

- **Glanceable dulu, drill-down kemudian.** Owner butuh ≤5 detik untuk tahu
  "hari ini sehat atau tidak". Detail = klik menuju modul, bukan menumpuk tabel
  di desktop.
- **Setiap angka harus bisa dipertanggungjawabkan.** Angka tanpa tautan ke
  sumbernya akan bernasib sama dengan "98%" — diabaikan. Semua kartu deep-link
  ke halaman modul terkait.
- **Perbandingan, bukan angka telanjang.** "Omzet Rp 3,2 jt" tidak bermakna;
  "Rp 3,2 jt · +18% vs kemarin" bermakna.
- **Satu fetch, bukan delapan.** Desktop memanggil SATU endpoint agregasi;
  fan-out query terjadi paralel di server. Menghindari waterfall, dan
  permukaan auth-nya satu pintu.
- **Data gagal ≠ desktop rusak.** Tiap kartu punya state gagal sendiri;
  kegagalan satu query tidak menjatuhkan yang lain (pola `safeCount` yang
  sudah dipakai Do).

## Rancangan Widget (usulan — menunggu keputusan owner)

| Widget | Isi | Sumber (sudah ada) | Deep link |
|---|---|---|---|
| **Pulsa Bisnis** | Omzet & jumlah pesanan hari ini vs kemarin, rata-rata per pesanan | query `penjualan_periode` + `/api/pos/dashboard/stats` | `/dashboard/pos/reports` |
| **Tim Hari Ini** | Hadir · terlambat · belum absen · cuti (angka roster) | logika daily-roster EPIC-007 | `/dashboard/hris/attendance` |
| **Perlu Keputusan** | Cuti/lembur/pinjaman pending, PO menunggu approval, kandidat baru | nav-badges + count per modul | halaman approval masing-masing |
| **Stok Menipis** | n bahan di bawah minimum + 3 teratas | query `stok_menipis` | `/dashboard/inventory` |
| **Member/CRM** (opsional) | Member baru minggu ini, XP terdistribusi | tabel crm_* | `/dashboard/crm` |

Notification Center memakai data "Perlu Keputusan" yang sama — satu sumber,
dua tampilan; string statis dihapus.

## Scope (bertahap, satu fase = satu PR)

**Fase A — Fondasi data**
- `src/lib/desktop/overview.ts`: kumpulan query murni (reuse query tool Do +
  nav-badges), tiap bagian gagal-aman, teruji unit.
- `GET /api/desktop/overview`: satu endpoint agregasi, gate login + role
  (`super_admin` dulu; daftar role owner menyusul keputusan), cache server
  60 detik supaya refresh murah.

**Fase B — Widget nyata menggantikan yang palsu**
- Ganti `DesktopWidgets` + Notification Center + toast pembuka dengan data
  Fase A; hapus seluruh string hardcoded.
- Skeleton saat memuat, state gagal per kartu, auto-refresh (interval 60–120 dtk,
  berhenti saat tab tidak terlihat).
- Deep link di setiap kartu/baris notifikasi.

**Fase C — Kustomisasi & kenyamanan**
- Pilih widget mana yang tampil + urutannya (perluas mekanisme localStorage
  yang ada), layout responsif utk layar laptop kecil.
- Perbandingan periode di Pulsa Bisnis (hari ini vs kemarin vs minggu lalu).

**Fase D — Jembatan ke Do**
- Tombol "tanya Do" di tiap widget → membuka Do dengan pertanyaan berkonteks
  ("kenapa omzet hari ini turun dibanding kemarin?") — memanfaatkan tool
  calling EPIC-017 yang sudah jalan.

## Non-Goals

- Grafik/chart berat di desktop (dashboard analitik per modul sudah ada; desktop
  cukup angka + arah perubahan).
- Realtime websocket — polling 60–120 detik cukup untuk kebutuhan monitoring owner.
- Multi-tenant/branch scoping baru (mengikuti scoping data yang ada).
- Redesign visual desktop (tema, wallpaper, dock) — sudah bagus, bukan masalahnya.

## Acceptance Criteria

- [x] Tidak ada lagi angka/notifikasi hardcoded di desktop (grep "98%" dll = 0).
- [x] Sebelum login: widget data bisnis tidak dirender sama sekali (bukan
      sekadar disembunyikan di klien — endpoint menolak 401).
- [x] Satu kali buka desktop = satu call `/api/desktop/overview`; respons < 1,5
      dtk pada data dev (cache hangat < 200 ms).
- [x] Setiap kartu & notifikasi punya deep link yang benar.
- [x] Kegagalan satu sumber data hanya menandai kartunya, kartu lain tetap terisi.
- [x] Pulsa Bisnis menampilkan pembanding vs kemarin.
- [x] Widget bisa disembunyikan (toggle per widget, tersimpan localStorage) DAN diurutkan (tombol panah di WidgetSettings, tersimpan `arkiv-widget-order`).
- [x] Build hijau, test hijau; unit test menutup query overview & pemilihan role.

## Test Plan

- Unit: tiap query overview (mock db), gate role, agregasi gagal-parsial.
- Manual dev: login super_admin → semua kartu terisi angka yang cocok dengan
  halaman modulnya; logout → widget hilang & endpoint 401; matikan satu tabel
  (simulasi) → hanya kartu itu yang gagal.

## Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Query agregasi membebani DB tiap refresh | Cache server 60 dtk + count ber-LIMIT; refresh berhenti saat tab hidden |
| Angka desktop ≠ angka halaman modul (beda definisi) | Reuse query yang SAMA dengan modul/tool Do, bukan menulis ulang; selisih = bug |
| Desktop publik membocorkan data bisnis | Endpoint 401 tanpa login; komponen widget tidak dirender sebelum auth |
| File desktop 2.588 baris makin bengkak | Widget baru dipecah ke `src/components/arkiv/widgets/` |

## Keputusan Owner (2026-07-21)

- [x] **Widget: kelima-limanya dibuat**, semuanya bisa di-hide/tampilkan lewat
      konfigurasi (perluasan mekanisme visibilitas widget yang ada).
- [x] **Role: `super_admin` + owner.** Catatan implementasi: role `owner` TIDAK
      ada di `iam.roles`; yang paling dekat adalah **`direksi`**. Fase A memakai
      `super_admin` + `direksi`, dan konstanta role dibuat mudah diperluas —
      bila owner ingin role `owner` tersendiri, itu migrasi kecil terpisah.
- [x] **Interval refresh: 60 detik** (berhenti saat tab tidak terlihat).
- [x] **Arah visual: gaya widget macOS**, tema mengikuti desktop sekarang
      (glassmorphism gelap, aksen pink) — mockup di
      `docs/design/epic-019-desktop-mockup.html`.

## Done Signal

Semua Acceptance Criteria tercentang + Automation Log terisi + status
`ready-for-qa`.

## Automation Log

- 2026-07-21 — **Akses ponsel** (butir #1 rencana optimalisasi lanjutan, diminta
  owner). Sebelumnya papan `hidden lg:grid` — di bawah 1024px owner tidak dapat
  apa-apa, padahal monitoring paling sering dilakukan dari HP. Kini kartu-kartu
  yang sama dirender dua wadah: laptop tetap papan kanan 2 kolom (tidak
  berubah), layar kecil mendapat panel satu kolom yang menutup area desktop dan
  TERBUKA DEFAULT (monitoring adalah alasan utama membuka /arkiv-os dari HP).
  Menubar tetap terlihat, dock tetap bisa ditekan (z panel di bawah dock),
  "Tutup" menampilkan desktop, pil "Monitoring" membukanya lagi. Kartu hero
  memecah dua kolomnya menjadi satu di layar < 430px; `col-span-2` diganti
  `col-span-full` supaya aman di grid satu kolom. Satu sumber JSX untuk kedua
  wadah — tidak ada duplikasi kartu.
  Gates: 691 test hijau, build sukses. Belum diverifikasi di perangkat nyata —
  QA di HP sungguhan tetap diperlukan (safe-area, gulir momentum iOS).

- 2026-07-21 — **Revisi owner atas Fase B** (empat permintaan):
  (1) semua ikon di widget baru dihapus — header kartu jadi teks saja, tombol
  aksi jadi teks "Tanya Do" / "Buka ›", baris keputusan tanpa ikon;
  (2) permukaan kartu disamakan dengan Calendar Widget (`bg-slate-950/55
  border-white/18`) — lebih gelap dari glass putih sebelumnya;
  (3) Calendar Widget default nonaktif, dan paksaan `calendar: true` saat memuat
  preferensi lama ikut dihapus;
  (4) **fungsi notifikasi aktivitas dibuat**: `lib/desktop/notifications.ts`
  membandingkan dua snapshot overview per poll 60 dtk — setiap KENAIKAN
  (pesanan baru, pengajuan cuti/lembur/pinjaman baru, PO draft baru, kandidat
  baru, bahan jatuh di bawah minimum, member baru) melahirkan popup di kanan
  atas (auto-hilang 7 dtk, klik = buka modulnya) sekaligus masuk riwayat
  Notification Center. Snapshot pertama melaporkan antrean yang sudah menunggu;
  penurunan sengaja diam (antrean berkurang = hasil kerja, bukan berita);
  seksi yang gagal dimuat tidak mengarang delta. Toast boot "Arkiv OS siap"
  dihapus; tombol/ikon Notification Center (menubar & dock) hanya muncul bila
  riwayat tidak kosong, dengan penghitung. 9 unit test untuk diff.
  Gates: 691 test hijau (85 file), build sukses.

- 2026-07-25 — **Fase C + D selesai — semua fase tuntas, status → ready-for-qa.**
  - **Fase C (kustomisasi & kenyamanan):**
    (1) *Pengurutan widget* — tombol panah naik/turun per widget monitoring di
    WidgetSettings, tersimpan localStorage `arkiv-widget-order`;
    `normalizeWidgetOrder` membuang key basi & menyisipkan widget baru di
    belakang supaya urutan lama tidak menghilangkan widget rilis berikutnya.
    Kartu dirender dari `cardNodes` map mengikuti urutan (berlaku juga di panel
    mobile). Dipilih panah, bukan drag-and-drop — sederhana, accessible, dan
    menghindari jebakan dnd `<button>` (pelajaran EPIC-022).
    (2) *Responsif laptop kecil* — papan `lg` kini satu kolom 340px (ikon
    desktop tidak tertutup), dua kolom 560px baru mulai `xl`.
    (3) *Pembanding periode Pulsa Bisnis* — `SalesPulse.mingguLalu` (hari yang
    sama H-7; rentang query diperlebar ke -7 hari, sparkline tetap 7 titik
    terakhir) + stat "Minggu lalu" ber-`MiniDelta` persen di samping "Kemarin".
    Fixture `SalesPulse` di test notifications & WA ikut disesuaikan.
  - **Fase D (jembatan ke Do):** prompt "Tanya Do" kini dibentuk dari ANGKA
    yang tampil, bukan template statis — `src/lib/desktop/ask-do.ts`
    (`buildAskDoPrompt`, 11 unit test): omzet turun → "turun N% dibanding
    kemarin… kenapa turun?", naik → "apa pendorongnya?" (+ pembanding minggu
    lalu), tim → sebut jumlah belum-absen / fokus telat, stok → jumlah + bahan
    paling kritis + "sudah dipesan belum", keputusan & member (baru diberi
    tombol Tanya Do) → rincian item pending / angka 7 hari. Tetap lewat
    mekanisme `queuedAssistantPrompt` + tool calling EPIC-017.
  - Gate: 872 unit test hijau (+12: mingguLalu & ask-do), `next build` sukses,
    tsc 481 = baseline (0 baru), PM2 restart, smoke `/api/desktop/overview`
    401 tanpa sesi.
  - Sisa QA manual (di luar kode): browser — urutan widget berubah & bertahan
    setelah reload, badge Minggu lalu, klik Tanya Do di kelima kartu
    menghasilkan pertanyaan sesuai angka; HP sungguhan — safe-area & gulir
    momentum iOS panel mobile.
- 2026-07-21 — **Fase A + B selesai satu sesi** (owner meminta langsung tampil di
  /arkiv-os, bukan hanya mockup). Fase A: `src/lib/desktop/overview.ts` (5 seksi,
  gagal-aman per seksi, 6 unit test — termasuk tanggal WIB, `belum` tak pernah
  negatif, rata-rata 0 bukan NaN, sparkline selalu 7 titik) + endpoint
  `/api/desktop/overview` (gate super_admin+direksi, cache in-memory 60 dtk;
  hasil dengan seksi gagal tidak di-cache agar cepat pulih). Fase B:
  `desktop-monitor.tsx` menggantikan DesktopWidgets palsu — Pulsa Bisnis hero
  (sparkline 7 hari + delta vs kemarin), Tim, Perlu Keputusan, Stok, Member;
  Notification Center ditulis ulang dari data yang sama (baris hanya muncul bila
  count > 0, ber-deep-link); toast "3 pending approval" palsu → "Arkiv OS siap";
  chip "Tanya Do" (cicilan Fase D) memakai mekanisme queuedAssistantPrompt yang
  sudah ada. Refresh 60 dtk berhenti saat tab hidden DAN saat 401/403 (tidak
  spam). WidgetSettings kini 6 toggle (kalender + 5 monitor).
  Verifikasi data dev sungguhan: kelima seksi terisi tanpa gagal (tim 19 aktif/
  1 cuti/18 belum; member 5 baru/609 XP/1 tukar; penjualan 0 — memang belum ada
  transaksi hari ini). Gates: 682 test hijau (84 file), build sukses, endpoint
  401 tanpa login, string palsu tergrep 0.
  **Insiden tercatat:** penyisipan pertama menduplikasi ~700 baris karena salah
  asumsi urutan fungsi (NotificationCenter ternyata SETELAH ToastNotification);
  file dipulihkan dari git dan seluruh langkah diulang dengan batas fungsi yang
  diverifikasi lebih dulu. Pelajaran: `grep "^function "` dulu sebelum menyisipkan
  berbasis indeks pada file 2.500 baris.
  Sisa: QA manual di browser; Fase C (pengurutan widget + pembanding periode) &
  Fase D penuh belum dimulai.

- 2026-07-21 — Epic dibuat dari audit desktop: seluruh angka monitoring ternyata
  hardcoded (System Health 98%, Pending 8, 4 notifikasi statis) dan desktop
  tidak memanggil satu pun endpoint data — padahal sumber datanya sudah lengkap
  (pos/dashboard, nav-badges, daily-roster, query tool Do EPIC-017). Rencana:
  satu endpoint agregasi ber-cache → widget nyata ber-deep-link → kustomisasi →
  jembatan ke Do. Menunggu keputusan owner (pilihan widget, role, interval).
  Status → backlog.
- 2026-07-21 — Owner memutuskan: kelima widget dibuat (semuanya dapat
  dikonfigurasi tampil/sembunyi), role super_admin + owner (dipetakan ke
  `direksi` karena role `owner` belum ada di iam), refresh 60 detik. Mockup
  desain gaya macOS dengan tema glass Arkiv OS dibuat di
  `docs/design/epic-019-desktop-mockup.html` — memuat kelima widget, popover
  "Atur Widget" (toggle + urutan), contoh state memuat/gagal per kartu, chip
  "Tanya Do" per widget, dan deep-link di tiap kartu. Status → on-progress.
