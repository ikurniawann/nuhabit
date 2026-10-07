# EPIC-030: Arkiv OS Native Desktop App (Ide)

status: backlog
environment: local
retries: 0

## Goal

Membungkus halaman `/arkiv-os` (desktop simulasi OS untuk monitoring owner,
lihat EPIC-019) menjadi aplikasi desktop native (bukan lagi diakses lewat tab
browser), dengan referensi UX seperti Spotify desktop app: shell native tipis
yang me-load web app yang sudah ada.

**Masih tahap ide — belum di-scope jadi fase/task, belum ada keputusan
teknologi final.** Dicatat di sini supaya tidak hilang dan bisa jadi titik
mulai diskusi berikutnya.

## Kenapa `/arkiv-os` yang dipilih (bukan halaman lain)

Berbeda dari halaman lain, `/arkiv-os` memang sudah didesain meniru desktop
OS di dalam browser (wallpaper, dock, widget, notification center, popup,
sound — lihat `src/components/arkiv/arkiv-os-desktop.tsx`, 2671 baris).
Chrome browser (address bar/tab) justru mengurangi ilusi "ini desktop
sungguhan". Native shell dianggap salah satu kasus paling masuk akal untuk
dibungkus native dibanding halaman lain di proyek ini.

## Evidence / Anchor Kode

- `src/app/arkiv-os/page.tsx` — entry route; juga jadi **landing page publik**
  untuk pengunjung belum login (baris 7–8: "Pengunjung belum login tetap
  boleh melihat desktop"), akun ESS-only di-redirect ke `/dashboard/me`.
- `src/components/arkiv/arkiv-os-desktop.tsx` — komponen utama simulasi
  desktop: wallpaper, dock, widget order, notification center/popup, sound,
  semua state persist di `localStorage` (`arkiv-wallpaper`,
  `arkiv-widget-visibility`, `arkiv-widget-order`, `arkiv-sound-enabled`).
  Modul lain dibuka via `window.open(href, "_blank")`.
- `src/components/arkiv/desktop-monitor.tsx` (594 baris) — terkait, belum
  diaudit detail untuk epic ini.
- Data live tampaknya berbasis polling/diff (`diffOverviewNotifications`),
  bukan websocket — perlu diverifikasi ulang saat scoping teknis.

## Opsi Teknologi (belum diputuskan)

| Opsi | Plus | Minus |
|---|---|---|
| **Tauri** | Binary kecil (~10–20MB), hemat RAM, cocok wrap web app existing | Butuh toolchain Rust, ekosistem lebih muda |
| **Electron** | Matang, banyak referensi, plug-and-play | Berat (~150MB+), boros RAM |

Pendekatan dasar (mirip Spotify): shell native cuma me-load URL yang sudah
live / build web yang sudah ada, ditambah fitur native (tray, notifikasi OS,
auto-launch saat boot, kios/full-screen mode) — bukan menulis ulang UI.

## Pros

- Immersion lebih nyata — chrome browser hilang, dock/wallpaper kerasa
  seperti desktop sungguhan.
- Notification center & popup bisa jadi notifikasi OS asli, tetap hidup saat
  di-minimize/background (sekarang cuma jalan selama tab terbuka).
- Auto-launch saat PC owner boot — pengalaman "desktop pengganti".
- Reuse hampir 100% kode — halaman ini sudah pure client-side React yang
  fetch API yang sama seperti web biasa.

## Cons / Risiko

- `window.open(..., "_blank")` untuk buka modul dari dock butuh penyesuaian
  di webview native (bisa kebuka browser eksternal atau gagal kalau tidak
  di-handle).
- Halaman ini dwifungsi: juga landing publik untuk pengunjung belum login.
  Perlu diputuskan apakah versi web tetap hidup untuk landing sementara
  native cuma untuk owner yang sudah login, atau kedua mode digabung.
- Auth/session di native shell (cookie persistence) beda dari browser biasa
  — perlu dipastikan owner tidak perlu login ulang tiap buka app.
- Data live berbasis polling; app yang nyala 24 jam butuh reconnect/backoff
  yang lebih tahan lama dibanding tab yang biasa di-refresh manual.
- Distribusi & auto-update ke PC owner tetap butuh installer, walau overhead
  lebih kecil dibanding skenario multi-toko (kasir).

## Open Questions (harus dijawab sebelum jadi on-progress)

1. Landing publik `/arkiv-os` tetap di web, atau native menggantikan
   sepenuhnya untuk owner?
2. Tauri atau Electron — siapa yang akan pegang toolchain-nya?
3. Auth/session strategy di webview native (persist login antar sesi)?
4. Apakah perlu fitur native tambahan (tray, notifikasi OS, auto-launch),
   atau cukup wrap polos dulu (MVP)?
5. Siapa target pengguna: hanya 1 owner (single machine) atau berpotensi
   di-rollout ke lebih dari satu perangkat?

## Non-Goals (untuk versi ide ini)

- Bukan pengganti aplikasi kasir/POS terminal (kebutuhan hardware printer/
  cash drawer/scanner itu topik terpisah, di luar scope ide ini).
- Belum ada komitmen migrasi seluruh dashboard lain ke native — scope awal
  murni `/arkiv-os`.

## Automation Log

- 2026-07-25 — Dicatat sebagai ide dari diskusi dengan owner: usulan
  membungkus `/arkiv-os` jadi native desktop app ala Spotify (web-based
  wrapped shell). Status **backlog** — menunggu keputusan open questions di
  atas sebelum discope jadi fase/task konkret.
