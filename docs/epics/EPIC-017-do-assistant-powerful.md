# EPIC-017: Do — Asisten yang Benar-Benar Berguna

status: ready-for-qa
environment: dev
retries: 0

## Goal

Menaikkan Do dari "chatbot yang meringkas data" menjadi asisten operasional:
jawaban terasa hidup (streaming), konteks yang dikirim tepat sasaran (bukan
seluruh ringkasan), dan Do bisa **melakukan** hal — mula-mula membaca data
spesifik, lalu menjalankan aksi dengan konfirmasi eksplisit.

## Evidence (2026-07-20)

Anchor: `src/app/api/ai/assistant/route.ts` (828 baris, monolitik),
`src/components/arkiv/arkiv-os-desktop.tsx` (komponen chat), katalog model
`src/lib/ai-assistant-config.ts`.

1. **Tidak ada streaming** — `stream` tidak pernah dikirim ke OpenAI; UI diam
   total lalu jawaban muncul sekaligus. Pertanyaan 10 detik terasa macet.
2. **Konteks dikirim borongan** — seluruh `summary` di-`JSON.stringify` ke setiap
   prompt, termasuk modul yang tidak relevan dengan pertanyaan. Mahal dan
   menumpulkan jawaban. `detectIntent` sudah ada tetapi hasilnya hanya menyempitkan
   `details`, bukan keseluruhan payload.
3. **Do tidak bisa bertindak** — hanya menerima ringkasan lalu bicara. Tidak ada
   tool calling, jadi pertanyaan spesifik ("siapa yang belum absen hari ini")
   dijawab dari ringkasan yang mungkin tidak memuatnya.
4. **Input satu baris** — `<input>`, bukan `<textarea>`; pertanyaan panjang tidak
   nyaman diketik dan `Shift+Enter` tidak ada.
5. **Tidak ada aksi per pesan** — tidak bisa menyalin jawaban atau meminta ulang.
6. **Judul sesi = 120 karakter pertama pertanyaan**, tidak bisa diganti.

## Scope (bertahap, satu fase = satu PR)

**Fase A — UX dasar chat**
- `<textarea>` auto-grow: Enter kirim, `Shift+Enter` baris baru.
- Tombol salin & minta ulang (regenerate) per jawaban.
- Ganti nama sesi.

**Fase B — Streaming**
- `stream: true` + parsing SSE di route, diteruskan ke klien.
- UI merender token bertahap; indikator "Memproses" diganti kursor mengetik.
- Fallback tetap: bila streaming gagal, jatuh ke mode sekali-jadi.

**Fase C — Konteks sesuai intent**
- Kirim hanya irisan `summary` yang relevan dengan intent terdeteksi.
- Ukur pengurangan token sebelum/sesudah dan catat di Automation Log.

**Fase D — Tool calling (read-only)**
- Definisikan tools baca: cari karyawan, status absensi hari ini, stok menipis,
  ringkasan penjualan periode, status kandidat.
- Semua query lewat helper ber-scope; tidak ada SQL bebas dari model.

**Fase E — Tool calling (aksi menulis)**
- Aksi menulis WAJIB lewat konfirmasi eksplisit user di UI sebelum dieksekusi.
- Whitelist aksi yang sempit; setiap eksekusi tercatat siapa & kapan.

## Non-Goals

- Upload file dan voice input (owner setuju ditunda; permukaan masalahnya besar
  sementara Fase A–E belum ada).
- Mengganti provider model.
- Membuka Do untuk role selain super_admin (gate yang ada dipertahankan).

## Acceptance Criteria

- [x] Fase A: Shift+Enter baris baru; salin & regenerate berfungsi; sesi bisa diganti nama.
- [x] Fase B: jawaban muncul bertahap; kegagalan streaming jatuh ke mode lama tanpa error ke user.
- [x] Fase C: prompt hanya memuat modul relevan; penghematan token tercatat.
- [x] Fase D: pertanyaan spesifik dijawab dari query langsung, bukan tebakan ringkasan.
- [x] Fase E: tidak ada aksi menulis yang jalan tanpa konfirmasi user.
- [ ] Semua fase: build hijau, test hijau, tidak ada nama vendor bocor ke UI (EPIC-016 lanjutan).

## Test Plan

- Unit: pemilihan irisan konteks per intent, parser SSE, validasi argumen tool.
- Manual: kirim pesan panjang, gulir ke atas saat streaming, batalkan aksi tulis.

## Risiko

| Risiko | Mitigasi |
|---|---|
| Tool calling menulis data tanpa disadari user | Fase E digate konfirmasi UI + whitelist sempit |
| Streaming menyulitkan penyimpanan pesan & meta | Simpan setelah stream selesai, dengan buffer di server |
| Route sudah 828 baris dan akan makin besar | Pecah ke `src/lib/assistant/` saat Fase C/D |

## Automation Log

- 2026-07-25 — **Fase E selesai** (tool calling aksi menulis, wajib konfirmasi).
  Prinsip: model TIDAK PERNAH mengeksekusi — tool tulis hanya membuat USULAN.
  - Whitelist sempit 2 aksi di `src/lib/assistant/write-tools.ts` (terpisah
    dari tool baca; `runTool` menolak nama aksi tulis — dijaga unit test):
    `usulkan_pengumuman_draft` (insert `hris.announcements` selalu status
    `draft`, teks polos di-escape → HTML paragraf, HRD yang publish dari CMS)
    dan `usulkan_catatan_kandidat` (append-only `recruitment.candidate_notes`;
    kandidat di-resolve saat USULAN — ambigu/tidak ketemu = ditolak, kartu
    konfirmasi selalu menampilkan orang yang pasti).
  - Alur: model memanggil tool tulis → `proposeWriteAction` memvalidasi +
    menyimpan baris `pending` di tabel baru `public.ai_assistant_actions`
    (migrasi `20260725100000`, applied+tracked) → hasil tool ke model =
    "menunggu_konfirmasi_user" + instruksi jangan mengklaim sudah jalan →
    `pending_action` ikut meta pesan (stream `done`, non-stream, dan pesan
    tersimpan — kartu tetap tampil saat sesi dibuka ulang). Satu usulan per
    giliran supaya kartu tidak menumpuk.
  - Eksekusi HANYA lewat `POST /api/ai/assistant/actions` (route baru):
    gate super_admin (selaras gate Do; POST utama cuma cek login), hanya
    pemilik usulan, klaim atomik `UPDATE … WHERE status='pending'` (klik
    ganda konkuren tidak dobel eksekusi), TTL 10 menit (basi → `expired`),
    gagal eksekusi → `failed` + pesan generik (detail hanya di log server).
  - Audit "siapa & kapan" di tabel actions: user_id+created_at (usulan),
    decided_by+decided_at (keputusan), executed_at+result (eksekusi).
  - UI `arkiv-os-desktop.tsx`: kartu konfirmasi amber di bawah jawaban Do
    (ringkasan aksi + tombol "Jalankan aksi"/"Batalkan", status chip untuk
    confirmed/cancelled/expired/failed, disable saat diproses, jaringan putus
    tetap pending agar bisa dicoba lagi).
  - Gate: 860 unit test hijau (101 file, +17 test write-tools: escape HTML,
    validasi batas, whitelist, ambiguitas kandidat, TTL, pemisahan baca/tulis),
    `next build` sukses (route `/api/ai/assistant/actions` ter-generate),
    tsc 481 = baseline (0 error baru), migrasi applied, PM2 restart, smoke:
    kedua API 401 tanpa sesi, tabel 13 kolom terverifikasi di DB dev.
  - Catatan: status kartu di sesi lama tidak di-refresh otomatis saat reload —
    klik tombol memverifikasi status asli di server (409 + status terkini).
    Sisa manual: uji browser alur konfirmasi/batal (masuk skenario UAT).
- 2026-07-25 — **Gate review keamanan Fase E dijalankan; 1 temuan HIGH ditutup.**
  Reviewer memverifikasi: tidak ada jalur eksekusi tanpa konfirmasi (`execute`
  hanya dipanggil endpoint konfirmasi), tidak ada IDOR (semua mutasi difilter
  `user_id`), SQL parameterized penuh, XSS aman berlapis (escape server +
  DOMPurify di `SafeHtml`), klaim `UPDATE … WHERE status='pending'` atomik.
  - **HIGH (ditutup): gate super_admin hilang di `POST /api/ai/assistant`.**
    Selama ini "Do khusus super_admin" hanya ditegakkan client; user login role
    lain bisa memanggil API langsung — dan sejak Fase D/E ikut mengakses tool
    pencari kandidat/karyawan (bocor data HR ke role tanpa izin rekrutmen).
    Fix: cek `profile.role === 'super_admin'` → 403 di server, menyamakan gate
    dengan UI sekaligus menutup usulan-aksi oleh non-super-admin. (Eksekusi
    aksi memang sudah digate terpisah di endpoint konfirmasi.)
  - LOW (diterima): `error.message` mentah tersimpan di kolom audit
    `ai_assistant_actions.error` (tidak pernah dikirim ke client); di-scrub
    nanti bila whitelist bertambah aksi yang menyentuh API eksternal.
  - Gate ulang: 860 test hijau, build sukses, PM2 restart, smoke 401 tanpa sesi.
- 2026-07-21 — **Fase D selesai** (tool calling read-only). Lima tool di
  `src/lib/assistant/tools.ts`: `cari_karyawan`, `absensi_hari_ini`,
  `stok_menipis`, `penjualan_periode`, `status_kandidat`. Model hanya memilih
  nama tool + argumen; SQL ditulis di server, selalu parameterized, selalu
  ber-LIMIT (25 baris).
  Alur: putaran tool dijalankan NON-stream lebih dulu (maks 3 putaran), hasilnya
  dilampirkan ke percakapan, lalu jawaban final tetap dialirkan streaming —
  sehingga tool_calls tidak perlu dirakit dari potongan delta yang rapuh.
  Kegagalan tahap tool tidak menggagalkan jawaban: lanjut memakai konteks
  ringkasan seperti Fase C. Mode General Chat sengaja TIDAK diberi akses tool.
  Diuji dengan data dev sungguhan: kelima tool mengembalikan hasil tanpa error
  (18 karyawan cocok, 19 belum absen, 8 kandidat), dan model memilih
  `absensi_hari_ini` dengan tepat untuk "Siapa saja yang belum absen hari ini?".
  Unit test (10) menutup parsing argumen rusak, tool tak dikenal, dan penjagaan
  bahwa tidak ada tool bernama aksi menulis di fase ini.
  Gates: 668 test hijau, build sukses.
- 2026-07-21 — **Fase C selesai** (konteks sesuai intent). `selectContextForIntent`
  di `src/lib/assistant/context.ts` (9 unit test) hanya mengirim modul yang relevan
  dengan intent, plus modul tetangga yang sering dibutuhkan bersama (mis.
  inventory ⇄ procurement, karena "stok menipis" biasanya berlanjut ke "sudah
  dipesan belum").
  **Temuan tak terduga:** `summary` mengirim setiap metrik DUA KALI — di
  top-level (`summary.hris`) dan di `summary.modules.hris.metrics`, objek yang
  persis sama. Duplikasi itu ikut hilang.
  Penghematan terukur pada payload berbentuk sama dengan produksi (8 modul, 5
  baris rincian per modul): intent spesifik **77–88%** lebih kecil (5.720 → 1.325
  char untuk `pos`, → 709 char untuk `integration`), dan bahkan intent `all`
  tetap turun 10% berkat hilangnya duplikasi.
  Ukuran nyata per permintaan dicatat runtime lewat log `[do:context]` sehingga
  bisa diverifikasi dengan data sungguhan, bukan sekadar klaim.
  Gates: 658 test hijau, build sukses.
- 2026-07-21 — **Fase B selesai** (streaming). `stream: true` + parser SSE di
  route, diteruskan ke browser sebagai event `delta`/`done`/`error`. Penyimpanan
  pesan, log markdown, dan audit dipindah ke satu helper `persistAndAudit` yang
  dipakai jalur stream & non-stream, lalu dijalankan SETELAH stream tuntas
  memakai teks utuh dari server — bukan rakitan klien.
  Fallback berlapis: streaming gagal → coba sekali-jadi → ringkasan internal.
  Klien juga memeriksa `content-type`; bila server menjawab non-SSE ia kembali ke
  jalur lama tanpa error.
  Header `X-Accel-Buffering: no` dipasang karena tanpa itu proxy (nginx/
  cloudflared) menahan buffer sampai stream tuntas, sehingga jawaban tetap
  muncul sekaligus meski sudah streaming.
  Parsing SSE diekstrak ke `src/lib/assistant/sse.ts` (dipakai server & klien)
  dengan 12 unit test — termasuk kasus event terbelah antar chunk, yang bila
  salah gejalanya cuma "jawaban terpotong sesekali" dan sulit terlihat di UI.
  Gates: 649 test hijau, build sukses. Sisa: uji interaksi di browser.
- 2026-07-20 — **Fase A selesai** (commit `1131560`): textarea multi-baris
  (Enter kirim, Shift+Enter baris baru, aman terhadap IME), tombol salin &
  ulangi, ganti nama sesi lewat PATCH ber-guard kepemilikan.
- 2026-07-20 — Epic dibuat. Owner meminta seluruh fitur yang diusulkan dikerjakan;
  upload file & voice input tetap di luar scope sesuai rekomendasi. Bug UX
  auto-scroll (ditemukan owner) sudah diperbaiki lebih dulu di commit `b813f49`.
