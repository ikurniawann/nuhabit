# NüHabit OS Desktop: Jendela, Preferensi, Spotlight & Panel Hari Ini

Halaman `/os` (`src/app/os/page.tsx`); alamat lama `/arkiv-os` dialihkan ke sini dengan
query utuh (`src/lib/desktop/deep-link.ts`). Kode UI ada di `src/features/os-desktop/`.
Ditulis 2026-09-17 saat 15 perbaikan pengalaman & fungsi dikerjakan.

## Jendela (window manager)

Logika murni di `src/lib/desktop/window-manager.ts` (teruji), perekatan React di
`src/features/os-desktop/hooks/use-window-manager.ts` dan
`src/features/os-desktop/components/windows/window-shell.tsx`, dirangkai di
`src/features/os-desktop/components/os-desktop.tsx`.

| Perilaku | Catatan |
|---|---|
| Urutan tumpukan | Satu daftar `order`; jendela baru / diklik pindah ke belakang daftar, z-index = 40 + posisi. Hanya jendela teratas ber-ring pink. |
| Minimize | Turun ke **dock** (chip di ujung kanan dock), bukan melipat di tempat. Jendela tetap ter-mount (`display:none`) supaya isi iframe tidak hilang. |
| Isi dock | Hanya Launchpad, Do, Apps, Notifikasi, Files, Settings: pintasan per-modul dihapus (2026-09-17, permintaan owner) karena daftar lengkapnya sudah ada di Launchpad/folder Applications. |
| Daftar jendela | Jendela yang terbuka muncul sebagai chip di ujung dock: aktif diberi cincin, yang dikecilkan diredupkan. Klik = fokus/munculkan. |
| Lapisan | Dock & menubar `z-75`, di ATAS jendela (`z-40..69`) supaya tidak tertutup jendela tinggi, tapi di bawah modal (`z-80`) dan kunci layar (`z-200`). |
| Posisi & ukuran | Diingat per jendela di localStorage (`nuhabit.desktop.window-geometry`, kunci lama `arkiv-window-geometry` dipindah sekali; maks 24). Geometri dari layar lebih besar **diabaikan**, tidak dipaksakan. |
| Snap | Seret ke tepi kiri/kanan/atas → pratinjau lalu tempel setengah/penuh layar. Klik dua kali bilah judul = layar penuh. |
| Multi-instance | `WindowShell` menerima `windowId`; jendela deep link/Spotlight memakai id unik sehingga halaman sama bisa dibuka lebih dari satu. |

### Pintasan

Sengaja **menghindari** kombinasi yang dirampas browser (⌘W menutup tab, ⌘M
mengecilkan jendela browser, ⌘Tab pindah aplikasi OS): karena itu dipakai varian
`+Shift` dan `⌘\``. Daftar lengkap ada di System Settings → Pintasan Papan Ketik.

| Pintasan | Aksi |
|---|---|
| ⌘/Ctrl K | Spotlight |
| ⌘/Ctrl ⇧ W · ⌘/Ctrl ⇧ M | Tutup · kecilkan jendela aktif |
| ⌘/Ctrl ` (+⇧) | Pindah jendela berikutnya (sebelumnya) |
| ⌘/Ctrl ←/→ · ↑/↓ | Tempel setengah layar · layar penuh/pulihkan |
| ⌘/Ctrl ⇧ J · ⌘/Ctrl ⇧ L | Panel Hari Ini · kunci layar |
| Esc | Tutup: panel Hari Ini → menu konteks → palet → jendela teratas |

## Preferensi ikut akun

`configuration.user_desktop_prefs` (migrasi `20260917100000`) + `/api/desktop/preferences`.
Wallpaper, tampilan & urutan widget, dan suara mengikuti **akun**; localStorage tinggal
cache render pertama. Server hanya menimpa bagian yang memang pernah tersimpan di sana
(`mergeDesktopPreferences`), supaya akun baru tidak menghapus pilihan yang baru dibuat.
Payload dinormalkan di server: klien tidak bisa menitipkan key sembarangan ke jsonb.

## Mode tamu & kunci layar

- Belum login: menubar menandai "Mode tamu" + tombol Masuk; desktop tetap bisa dilihat.
- Kunci layar (⌘⇧L / menu akun): membuka kunci = **login ulang ke server**, bukan
  mencocokkan string di klien, jadi sesi kedaluwarsa ikut ketahuan. Ada "Ganti user"
  untuk perangkat kasir yang dipakai bergantian.

## Spotlight & deep link

- `/api/desktop/search` mencari **data**: transaksi, member, produk, bahan baku,
  karyawan, dokumen. Sumber dibatasi prefiks menu IAM pengguna (`allowedSources`),
  wildcard `%`/`_` dari pengguna di-escape, satu tabel bermasalah tidak menggagalkan
  seluruh pencarian.
- Memilih hasil membuka halamannya sebagai jendela.
- `/os?open=/dashboard/...&title=...` membuka jendela langsung: dipakai
  notifikasi/tautan luar. Hanya path `/dashboard` internal diterima (open redirect
  ditolak); parameter dibersihkan dari URL setelah dibuka.

## Notifikasi langsung (SSE)

`/api/desktop/stream` mengirim Server-Sent Events. `src/lib/desktop/overview-broadcast.ts`
menjaga **satu** interval polling untuk semua pelanggan dan hanya menyiarkan bila isi
papan benar-benar berubah (dibanding lewat hash, `dibuatPada` dibuang). Polling 60 detik
di klien tetap jalan sebagai jaring pengaman bila proxy memutus aliran.

> Catatan uji: karena SSE menahan koneksi terbuka, `waitUntil: "networkidle"` tidak
> pernah tercapai di halaman ini: pakai `domcontentloaded` + tunggu selektor.

## Status operasional & panel Hari Ini

- `/api/desktop/status`: database, antrian cetak, WhatsApp gateway. Lampu menubar
  memakai kondisi **terburuk**; pemeriksaan yang gagal jadi "belum diketahui", bukan
  disamarkan jadi normal.
- Panel **Hari Ini** (⌘⇧J, atau tombol "Tangani sekarang" di kartu Perlu Keputusan):
  ringkasan omzet/pesanan/tamu/tim + kotak keputusan dari `/api/desktop/inbox`.
  - **Cuti** bisa disetujui/ditolak langsung: memakai API approval resmi
    (`/api/hris/leaves/approve`, potong kuota + notifikasi).
  - **PO** dan **stok menipis** sengaja hanya membuka halaman yang tepat: keputusannya
    butuh konteks penuh dan tidak ada API approval satu-tombol yang aman.
  - Seksi dibatasi menu IAM: HR tidak melihat PO, gudang tidak melihat cuti.

## Do untuk semua role

Dulu Do dikunci `super_admin` karena alatnya membaca data karyawan/penjualan. Sekarang
yang dibatasi **alatnya**, bukan orangnya: `src/lib/assistant/tool-scope.ts` memetakan
tiap alat ke prefiks menu IAM, server hanya menawarkan alat yang boleh dipakai, dan ada
pertahanan kedua yang menolak eksekusi bila model mengarang nama alat. Kasir bisa
bertanya soal stok/penjualan tanpa bisa menarik data HRIS.
