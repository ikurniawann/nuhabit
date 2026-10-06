# DESIGN.md — NüHabit Design System

> Sumber: **NüHabit Brand Guideline 2026** (PDF, 98 hal.). Dokumen ini adalah
> terjemahan guideline tersebut ke aturan UI untuk ketiga sistem Nuhabit:
> **Backoffice (dashboard)**, **Member App**, dan **Coach Portal**.
> Bila ragu, kembali ke prinsip brand: *Quiet Competitor* — tenang, presisi,
> percaya diri tanpa berteriak.

---

## 1. Esensi Brand (yang harus terasa di setiap layar)

| | |
|---|---|
| **Brand idea** | *Habits Start Here.* — perubahan dimulai dari satu aksi kecil yang diulang. |
| **Tagline** | *They say old habits die hard. Get a new one.* |
| **Personality** | **The Quiet Competitor** — Measured · Precise · Humble · Enduring |
| **Experience principles** | Easy to Start · Designed to Keep You Moving · Celebrate Every Progress · Built Around Community · Inspire a Better Lifestyle |

Implikasi ke produk:

- **Easy to Start** → alur daftar & booking sesingkat mungkin; satu aksi utama per layar.
- **Keep You Moving** → tampilkan *streak*, sisa sesi, sesi berikutnya — dorong kembali datang.
- **Celebrate Every Progress** → rayakan kehadiran (sesi ke-10, streak mingguan), bukan hanya performa.
- **Measured / Precise** → UI bersih, ruang lega, tanpa ornamen yang tidak berfungsi.

---

## 2. Warna

### 2.1 Main colors (porsi terbesar)

| Nama | Hex | Token CSS / Tailwind | Peran |
|------|-----|----------------------|-------|
| **White Beige** | `#f3ece2` | `--background`, `bg-nh-beige` | Kanvas utama (light mode) — fondasi netral |
| **Deep Forest Green** | `#00281a` | `--brand-primary`, `bg-nh-forest` | Warna utama: tombol primer, teks judul berbobot, item aktif |
| **Pale Lime** | `#daff59` | `--brand-accent`, `bg-nh-lime` | Aksen energi: highlight, CTA di atas latar gelap, indikator aktif |

### 2.2 Functional colors (pendukung)

| Nama | Hex | Tailwind | Peran |
|------|-----|----------|-------|
| Dark Jungle | `#1c261b` | `bg-nh-jungle` | Permukaan kartu di dark mode |
| Everglade | `#203b32` | `bg-nh-everglade` | Secondary brand, border/surface gelap |
| Lettuce | `#abde67` | `bg-nh-lettuce` | Aksen segar, status positif, chart |
| Lemon Lime | `#eeffb1` | `bg-nh-lemon` | Latar highlight lembut (accent surface) |
| Mint Cream | `#fdfff2` | `bg-nh-mint` | Latar netral terang alternatif |
| Golden Ochre | `#c9a227` | `bg-nh-ochre` | Sorotan hangat: premium/PT, warning lembut, lifestyle |
| Ink (dari slide guideline) | `#131a1c` | `bg-nh-ink` | Teks utama light mode, kanvas dark mode |

### 2.3 Proporsi

Guideline menekankan **main colors dominan, functional colors sebagai pelengkap**.
Untuk UI, kira-kira: **60% Beige/netral · 30% Forest (dan Ink untuk teks) · 10% Lime**.
Lime adalah *bumbu* — jangan jadikan latar area besar di light mode.

### 2.4 Pasangan warna yang aman (WCAG)

| Foreground di atas Background | Rasio | Status |
|-------------------------------|-------|--------|
| Pale Lime `#daff59` di atas Forest `#00281a` | 13.98:1 | ✅ AAA — kombinasi khas brand |
| Forest `#00281a` di atas Pale Lime `#daff59` | 13.98:1 | ✅ AAA — CTA lime |
| Forest `#00281a` di atas Beige `#f3ece2` | 13.58:1 | ✅ AAA |
| Beige `#f3ece2` di atas Ink `#131a1c` | 15.02:1 | ✅ AAA — dark mode |
| `pink-600` `#1e5640` di atas Beige | 7.28:1 | ✅ AAA — teks aksen |
| Muted `#5b6b60` di atas Beige | 4.82:1 | ✅ AA — teks sekunder |
| Lime / Lettuce / Lemon **sebagai teks** di atas Beige/putih | < 2:1 | ❌ **Dilarang** |

Aturan guideline (*Placement*): teks gelap di atas area terang, teks terang di atas area gelap — selalu kontras tinggi.

---

## 3. Tipografi

| Peran | Font | Bobot | Catatan |
|-------|------|-------|---------|
| **Title / Display** | **Outfit** | 300 (Light) untuk judul besar, 500–700 untuk heading UI | Geometric sans. Judul halaman guideline memakai Outfit Light berwarna lime di atas gelap. |
| **Body / UI** | **Manrope** | 300 · 400 · 600 · 700 | Semua teks isi, tabel, form, label. |

Kedua font dimuat dari Google Fonts (`globals.css`). Token: `--font-sans-stack` (Manrope),
`--font-display` / kelas `font-display` (Outfit). `h1–h3` otomatis memakai Outfit.

### Skala (dashboard)

| Level | Contoh | Font | Ukuran / line-height | Case |
|-------|--------|------|----------------------|------|
| H1 — Headline | Judul halaman | Outfit 600 | 28–32 / 1.15 | Title Case atau UPPERCASE (hero saja) |
| H2 — Subtitle | Judul section/kartu | Outfit 500 | 20 / 1.3 | Title Case / Sentence case |
| H3 | Sub-section | Outfit 500 | 16–18 / 1.4 | Sentence case |
| Body | Paragraf, sel tabel | Manrope 400 | 14–16 / 1.55 | Sentence case |
| Label / caption | Label form, meta | Manrope 600 | 12–13 / 1.4 | Sentence case |
| Angka KPI | Statistik besar | Outfit 600, `tabular-nums` | 28–40 | — |

Untuk Member App/landing, headline boleh **UPPERCASE besar** (lihat *Typography Sample*),
tapi **tidak pernah ALL CAPS untuk kalimat panjang atau teriakan hype**.

---

## 4. Logo

**Logo sistem** (dari owner, 2026-10-02): wordmark **NUHABIT** geometris bergaris tipis,
huruf kapital lebar. Inilah logo yang dipakai di UI (login, sidebar, dokumen, ikon).
Sapuan script "Nü" dari PDF guideline **bukan logo UI**; ia dipakai sebagai
*graphic language* (wallpaper, panel login), lihat §5. Keputusan owner (2026-10-02):
keduanya boleh dikombinasikan dalam satu layar, **asal wordmark NUHABIT tetap logo utama**:
selalu tampil sebagai identitas, dan sapuan "Nü" hanya latar/dekorasi, tidak pernah
menggantikan logo.

### File (di `public/brand/`)

| File | Pakai untuk |
|------|-------------|
| `nuhabit-logo-white.png`, `nuhabit-logo-neon.png` | **Master dari owner** (1700×900, ada margin), jangan diubah |
| `logo-white.png` | Latar gelap (panel login forest, desktop, layar gelap) |
| `logo-neon.png` | Latar gelap, saat logo harus menonjol (hero, splash, member app) |
| `logo-forest.png` | Latar terang (sidebar beige, login mobile, dokumen, form publik) |
| `logo-ink.png` | Latar terang netral / cetak hitam |
| `nuhabit-icon-512.png`, `nuhabit-icon-180.png` | App icon / PWA / sidebar collapsed: sapuan "Nü" lime di atas forest, rounded (pilihan owner) |
| `/favicon.svg`, `src/app/favicon.ico` | Favicon (ikon "Nü", sama dengan app icon) |
| `nuhabit-mark-lime.png` | Sapuan "Nü" untuk grafis dekoratif (bukan logo) |

`logo-*.png` = master yang di-trim (1325×173, rasio **7.66 : 1**), transparan.
Versi forest/ink diwarnai ulang dari bentuk master yang sama.

Ukuran minimum: tinggi **14px** di layar (garisnya tipis, jangan lebih kecil), di sidebar 14px,
di login 28px (desktop) / 24px (mobile).

### Colorways yang diizinkan

- Putih atau neon di atas Deep Forest Green / Ink / foto gelap
- Forest atau ink di atas White Beige / Mint Cream / Lemon Lime / Lettuce
- Jangan neon di atas latar terang (kontras < 2:1)

### Clear space

Minimal setinggi huruf logo di semua sisi.

### Larangan (Logo Don'ts)

Jangan: menumpuk (stack) logo · warna di luar palet · membalik/memutar · memisah bagian
logo · mengubah proporsi · drop shadow · menghapus titik umlaut · mengganti typeface ·
menekan/meregangkan · kombinasi warna yang sulit dibaca.

**Co-branding:** NüHabit di kiri, partner di kanan, dipisah garis vertikal; ukuran seimbang.

---

## 5. Graphic Language

Bahasa grafis dibangun dari **sapuan cair (fluid strokes)** turunan bentuk logo — energik,
ritmis, kontras tinggi. Varian: *pattern* berulang, *different scale* (sapuan besar
dipotong), *images & strokes* (foto di dalam bentuk sapuan), *different strokes* (garis outline).

Di produk digital:

- **Pakai** untuk: hero Member App, header Coach Portal, empty state, kartu membership,
  layar sukses (booking berhasil, sesi selesai), halaman login.
- **Jangan pakai** di area kerja padat (tabel, form panjang di backoffice) — ganggu fokus.
- Sapuan selalu memakai warna palet (lime/lettuce di atas forest/ink, atau forest di atas beige).

---

## 6. Fotografi

- **Do:** atlet nyata dalam gerak, energi & sikap, close-up detail perlengkapan, keringat
  dan usaha, cahaya kontras, komposisi dinamis; komunitas berlatih bersama.
- **Don't:** foto stok kaku/berpose, terlalu diedit, tidak relevan dengan latihan, gelap
  tanpa kontras, terasa eksklusif/elitis.
- Teks di atas foto: ikuti aturan kontras (§2.4); tambahkan overlay Forest/Ink bila perlu.

---

## 7. Voice & Copy UI

Tone: **Reserved · Purposeful · Refined · Inviting** — *casual over formal, warm over cool,
matter-of-fact over enthusiastic, respectful over irreverent.*

Enam aturan menulis: **mulai dengan aksi (kata kerja) · ringkas · percaya diri yang tenang ·
manusiawi (seperti partner latihan) · menginspirasi, bukan menggurui · inklusif untuk semua level.**

| ✅ Pakai | ❌ Hindari |
|---------|-----------|
| latihan, sesi, rutinitas, kebiasaan, progres, konsisten | *crush it, beast mode, no pain no gain, dominate* |
| komunitas, bersama, siap, mulai, lanjutkan | *ultimate, revolutionary, best ever, next-level* |
| "Sampai jumpa di sesi berikutnya." | "AYO GABUNG SEKARANG!!!" |
| "Masih ada tempat untuk satu orang." | "Hanya untuk member." |
| "Setiap atlet mulai dari suatu tempat." | "Tidak ada alasan. Kerja!" |

Istilah (keputusan owner 2026-10-02): tulis **"Personal Training"** lengkap di semua
teks UI, dokumen untuk member, dan pesan — jangan disingkat "PT". Singkatan `pt` hanya
boleh di nama variabel/kolom kode.

Contoh microcopy:

- Booking berhasil: **"Sesi kamu sudah terkunci. Sampai jumpa Sabtu, 06.30."**
- Paket hampir habis: **"Tinggal 1 sesi lagi. Lanjutkan kebiasaanmu?"**
- Notifikasi H-1: **"Sesi berikutnya menunggu."**
- Empty state: **"Belum ada sesi. Mulai dari satu."**
- Hindari tanda seru berlebihan dan ALL CAPS di kalimat.

---

## 8. Komponen UI

### Tombol

| Varian | Light mode | Dark mode / di atas foto |
|--------|-----------|---------------------------|
| **Primary** | bg Forest `#00281a`, teks Beige | bg Lime `#daff59`, teks Forest |
| **Accent CTA** (aksi utama Member App) | bg Lime, teks hitam, **kotak (sudut tajam), UPPERCASE** — lihat §10 Member App | sama |
| **Secondary** | border `--border`, teks Ink, bg transparan | border lime/16%, teks Beige |
| **Destructive** | `--destructive` | sama |

Tombol CTA di Member App memakai **kotak bersudut tajam, UPPERCASE, tracking lebar** (keputusan owner 2026-10-06, lihat §10).
Pill (`rounded-full`) di Member App hanya untuk chip/tag kecil.

### Kartu & permukaan

- Kanvas: Beige `#f3ece2`; kartu: `#fffdf9` (`--card`) dengan border `#e2d8c8`, radius 12px.
- Hindari bayangan berat; cukup border tipis + bayangan halus (gaya *measured*).
- Kartu highlight (mis. paket aktif, sesi berikutnya): bg Forest + teks Beige + aksen Lime.

### Navigasi backoffice

- Sidebar: bg `#ebe3d6`, teks Ink, item aktif **bg Forest + teks Lime**.
- Navbar: bg Beige, border `#e2d8c8`.
- Logo sidebar: `logo-forest.png` tinggi 14px (expanded), `nuhabit-icon-180.png` (collapsed).

### Status & badge

| Status | Warna |
|--------|-------|
| Aktif / hadir / lunas | Lettuce bg `#abde67`/20% + teks `pink-600` |
| Menunggu / hampir habis | Ochre `#c9a227`/20% + teks `#7a5f0f` |
| Expired / batal / gagal | `--destructive`/10% + teks destructive |
| Netral / draft | `--muted` + `--muted-foreground` |

### Form

- Label Manrope 600 13px di atas field; field bg `--card`, border `--input`, radius 10–12px.
- Focus ring: `--ring` `#4e8a6e` (kontras 3.45:1 terhadap Beige).

---

## 9. Data Visualization

Urutan warna seri (light mode):

1. Forest `#1e5640` (pink-600) 2. Lettuce `#abde67` 3. Ochre `#c9a227`
4. Everglade-light `#4e8a6e` 5. Lime `#daff59` (beri outline Forest bila di atas Beige) 6. Ink `#131a1c`

- Sequential (okupansi, intensitas): `pink-50 → pink-700` (lime-mint → forest).
- Angka KPI: Outfit, `tabular-nums`.
- Pastikan chart terbaca di light & dark (di dark, ganti Forest dengan Lettuce/Lime).

---

## 10. Pedoman per Sistem

### Backoffice (owner, admin, CS, finance)

- Prioritas: **kepadatan informasi yang tetap tenang**. Light mode default.
- Graphic language minimal; warna brand lewat sidebar aktif, tombol primer, header KPI.
- Dashboard utama: kartu KPI (member aktif, okupansi hari ini, penjualan paket, liability paket),
  jadwal kelas hari ini, utilisasi coach.

### Member App (member & calon member)

- **Bahasa: Inggris** (keputusan owner 2026-10-02) — seluruh teks Member App, pesan error yang tampil ke member,
  format tanggal ("Saturday, 4 Oct") dan jam 24-jam ("06:30"). Backoffice & Coach Portal tetap bahasa Indonesia.
  Pesan server dari mesin bersama diterjemahkan di `src/features/member-app/i18n.ts`. Tone tetap sama:
  "You're locked in. See you tomorrow at 06:30.", "Only 1 session left. Keep the habit going?",
  "No sessions yet. Start with one." Istilah "Personal Training" tetap ditulis lengkap.
  Pesan WhatsApp ke member (pengingat H-1, waitlist, paket) juga berbahasa Inggris (`src/lib/studio/jobs.ts`).

- **Gaya editorial** (keputusan owner 2026-10-06, referensi UI/UX theyardgym.com dari `referensiapp.pdf`) —
  pola layout & interaksinya diadopsi, identitas NüHabit dipertahankan (logo, palet, font):
  - Kanvas **hitam**; **beige** sebagai "krem" (tombol sekunder, strip CTA, label vertikal); **lime** aksen aksi utama.
  - **Sudut tajam** di semua kartu/tombol/panel; pill hanya untuk chip (mis. kategori, level).
  - Judul **UPPERCASE besar & rapat** (Outfit bold, tracking negatif); label kecil uppercase berjarak (eyebrow).
  - **Garis tipis (hairline)** untuk daftar & tabel; **accordion bernomor** "01. Title  +".
  - **Label vertikal** di tepi blok (Next up, Your tier, Coaches); foto **hitam-putih**.
  - **Panel geser dari kanan** (detail sesi, beli paket, coach, news) — layar penuh di HP, Esc/klik luar menutup.
  - **Timetable**: navigasi minggu "‹ 5 Oct – 11 Oct ›", strip hari (aktif = blok lime), baris jam dengan garis
    vertikal + kartu sesi abu-abu kotak; sesi di jam sama dihubungkan "+".
  - **Pass options**: daftar kotak bergaris — nama UPPERCASE kiri, harga aksen kanan (pola "Membership Options").
  - Header: wordmark + menu hamburger layar penuh (daftar besar bernomor); strip CTA beige di atas
    ("Book a class | Buy a pass"); bottom nav kotak; kaki halaman: blok CTA beige + wordmark berjalan (marquee).
  - Implementasi: primitif di `src/features/member-app/ui.tsx`; animasi di `globals.css` (`nh-slide-in`,
    `nh-marquee`, menghormati `prefers-reduced-motion`).
- **Mobile-first**; rayakan progres: streak mingguan, milestone kehadiran, leaderboard konsistensi.

### Coach Portal (coach & head coach)

- Fokus: **jadwal mengajar** (kalender minggu), **roster kelas** (siapa yang booking/hadir),
  **insentif berjalan** bulan ini (kelas vs PT), slip end-of-month.
- Gaya di antara backoffice dan member app: bersih seperti backoffice, header bergrafis ringan.

---

## 11. Dark Mode

| Token | Nilai |
|-------|-------|
| Background | Ink `#131a1c` |
| Card / popover | Dark Jungle `#1c261b` |
| Secondary / muted | Everglade `#203b32` |
| Foreground | Beige `#f3ece2` |
| Muted foreground | `#a9b5a7` |
| Border | Lettuce 16% |
| Primary action | Lime `#daff59` + teks Forest |

Catatan: komponen warisan yang memakai `text-pink-600/700` (forest) belum otomatis
menyesuaikan di dark mode; tambahkan varian `dark:text-nh-lime`/`dark:text-nh-lettuce`
saat menyentuh komponen tersebut.

---

## 12. Implementasi di Kode

| Lokasi | Isi |
|--------|-----|
| `src/app/globals.css` | Token `:root` (light) & `[data-theme="dark"]`, skala `pink-*` = hijau NüHabit, token `nh-*`, `--font-display` |
| `src/lib/theme/presets.ts` | Preset default `nuhabit` (Forest + Everglade) |
| `src/lib/theme/appearance-tokens.ts` | `DEFAULT_APPEARANCE` — kanvas, sidebar, navbar, font Manrope |
| `src/lib/branding.ts` | `DEFAULT_BRAND_NAME = "NüHabit"` (override via `NEXT_PUBLIC_APP_NAME` / DB) |
| `public/brand/` | Aset logo (`logo-*.png`), ikon, wallpaper |

Aturan untuk kode baru:

1. **Halaman baru** (Member App, Coach Portal) pakai token semantik (`bg-background`,
   `bg-card`, `text-foreground`, `bg-primary`) atau token brand `nh-*`. **Jangan** menambah
   pemakaian `pink-*` — itu hanya jembatan untuk komponen warisan BCD.
2. Jangan menulis hex langsung di komponen; tambahkan token di `globals.css` bila perlu.
3. Jangan menulis nama merek langsung; pakai `brandName()`.
4. Setiap layar baru dicek di light & dark, dan di lebar 375px (mobile).
