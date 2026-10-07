# EPIC-037: Desktop Arkiv OS — Widget Report & Insight Owner

status: on-progress
environment: dev
retries: 0

## Goal

Memperluas papan `/arkiv-os` dari 5 widget operasional harian menjadi papan
**laporan & insight owner**: pendapatan dengan pembanding yang jujur, dampak
promo, pipeline B2B, produktivitas tenaga kerja, dan rekomendasi AI yang
mengutip angkanya sendiri.

Pembeda utama dari dashboard biasa: **pembanding apples-to-apples** (MTD 1–15
Juli vs 1–15 Juni, bukan vs Juni penuh) dan **satu switcher periode di level
papan** — bukan tombol per widget.

## Batasan scope (keputusan owner 2026-07-29)

**Seluruh bagian ticketing tidak dikerjakan.** Yang dicoret dari usulan awal:

| Usulan awal | Status |
|---|---|
| Visitor Traffic (gate scan, utilisasi kapasitas) | **dicoret** |
| Per-Visitor Economics (belanja/pengunjung, F&B attach rate) | **dicoret** |
| Pecahan Tickets & Season Pass di Revenue Overview | **dicoret** |
| Komposisi channel walk-in vs booking online | **dicoret** |

Keputusan ini sejalan dengan temuan data: `ticket_gate_events` dan
`ticket_visits` masih **0 baris** di produksi, jadi widget tersebut memang akan
gelap. Sisa scope justru seluruhnya bertumpu pada data yang sudah terisi.

## Fondasi yang sudah ada (audit 2026-07-29)

1. **Papan desktop** — `src/components/arkiv/desktop-monitor.tsx` (594 baris)
   dengan `MONITOR_WIDGETS`: `pulsa`, `tim`, `keputusan`, `stok`, `member`.
   Urutan & visibilitas per user sudah ada (`arkiv-widget-order`,
   `normalizeWidgetOrder`) — widget baru tinggal mendaftar, bukan bikin sistem baru.
2. **Sumber angka** — `src/lib/desktop/overview.ts` (267 baris) dengan prinsip
   yang **wajib dipertahankan**: definisi angka mengikuti modulnya, tidak ditulis
   ulang; tiap seksi gagal-aman (satu query error → seksi itu `null`, papan tetap
   hidup).
3. **Pembanding mingguan** — `SalesPulse.mingguLalu` (H-7) sudah ada sebagai
   preseden pembanding pola-mingguan; tinggal diperluas ke periode lain.
4. **Tanya Do berkonteks** — `src/lib/desktop/ask-do.ts` sudah membentuk
   pertanyaan dari ANGKA yang sedang tampil, memakai tool calling EPIC-017.
   Widget AI Insight menumpang jalur ini, bukan stack AI baru.
5. **Skema terverifikasi ada** di `db-dev-arkiv`:
   `crm_sales_stages.stuck_threshold_days`, `promo_redemptions`
   (`discount_amount`, `context_type`, `context_id`, `campaign_name`),
   `hris.attendance`, `pos.pos_orders`, `crm.crm_sales_deals`.

## Kondisi data (produksi, 2026-07-29)

| Tabel | Baris | Catatan |
|---|---|---|
| `pos.pos_orders` | 7 (20–27 Jul) | tipis, tapi nyata |
| `crm.crm_sales_deals` | 5 | cukup untuk pipeline |
| `hris.attendance` | 6 | cukup untuk labor |
| `promo.promo_redemptions` | 1 | promo mix akan sangat tipis di awal |

Papan harus tetap terbaca benar saat data tipis: **bedakan "belum ada data" dari
"nilainya nol"** di tipe data, bukan sekadar di tampilan. Nol yang salah baca
membuat owner mengambil kesimpulan yang salah.

## Usulan Arsitektur

### Switcher periode di level papan

Satu kontrol `Today | MTD | QTD | YTD` di header papan, disimpan seperti
`arkiv-widget-order`. Seluruh widget membaca periode yang sama — inilah yang
membuat papan terbaca sebagai satu laporan, bukan kumpulan kartu lepas.

Modul murni baru `src/lib/desktop/period.ts`:

```
resolvePeriod(kind, now)      → { mulai, selesai, hariBerjalan, totalHari }
resolveComparison(period)     → { mulai, selesai }  // apples-to-apples
projectRunRate(nilai, period) → proyeksi akhir periode
```

**Aturan pembanding (inti epic ini, wajib TDD):** MTD berjalan 15 hari
dibandingkan dengan **15 hari pertama bulan lalu**, bukan bulan lalu penuh. YTD
vs YTD tahun lalu pada jumlah hari yang sama. Today vs hari-yang-sama-minggu-lalu.
Salah di sini membuat setiap bulan tampak anjlok — dan salahnya tidak kelihatan.
Karena itu tesnya ditulis lebih dulu.

### Widget yang dibangun

| # | Widget | Isi | Sumber |
|---|---|---|---|
| 1 | **Revenue Overview** | Pendapatan periode berjalan, pembanding apples-to-apples, proyeksi akhir periode dari run-rate | `pos_orders` (F&B), `crm_sales_invoices` (B2B) |
| 2 | **Dampak Promo** | Diskon yang diberikan vs pendapatan yang dibawanya, per kampanye | `promo_redemptions` |
| 3 | **B2B Pipeline** | Nilai deal per tahap, perkiraan closing bulan ini, deal macet | `crm_sales_deals` × `crm_sales_stages.stuck_threshold_days` |
| 4 | **Labor vs Revenue** | Kru hadir hari ini disandingkan omzet — produktivitas per hari | `hris.attendance` + widget 1 |
| 5 | **AI Insight "Rekomendasi Do"** | 2–3 rekomendasi harian ber-angka, klik → buka Do | mesin aturan → narasi LLM |

### Widget 5 — insight berlapis (sesuai arahan owner)

Dua lapis, dan pemisahannya adalah inti keamanannya:

1. **Mesin aturan (deterministik, teruji, bisa diaudit)** —
   `src/lib/desktop/insight-rules.ts`. Ambang & tren sederhana menghasilkan
   `Finding { metrik, nilaiSekarang, nilaiPembanding, deltaPersen, arah, bukti }`.
2. **Narasi LLM** — menerima Finding yang **sudah berisi angka jadi** dan hanya
   merangkainya menjadi kalimat + saran tindakan.

**Aturan keras: LLM tidak pernah menghitung, hanya menarasikan.** Angka di
laporan owner harus bisa ditelusuri ke query. Digest dihitung sekali sehari dan
di-cache — hemat, dan konsisten sepanjang hari. Klik rekomendasi → membuka Do
dengan konteks lengkap lewat jalur `ask-do.ts` yang sudah ada.

## Fase

| Fase | Scope (PR-sized) |
|---|---|
| **A** ✅ | Fondasi periode: `period.ts` (TDD dulu), switcher di header papan, `overview.ts` jadi sadar-periode, 5 widget lama menyesuaikan tanpa berubah artinya |
| **B** ✅ | Widget 1 Revenue Overview + widget 2 Dampak Promo |
| **C** | Widget 3 B2B Pipeline + widget 4 Labor vs Revenue |
| **D** | Widget 5 AI Insight: mesin aturan + narasi + digest harian ter-cache + klik-ke-Do |

## ⚠ Risiko

1. **Pembanding periode parsial salah diam-diam.** MTD dibanding bulan penuh
   membuat setiap bulan terlihat anjlok. Mitigasi: TDD di `period.ts` sebelum UI,
   termasuk kasus batas (awal bulan, tahun kabisat, pergantian kuartal).
2. **Definisi angka menyimpang dari modul.** Omzet di papan wajib sama dengan
   halaman POS. Mitigasi: pakai kembali query modul — prinsip yang sudah tertulis
   di `overview.ts`.
3. **Angka 0 yang menyesatkan** saat data tipis. Mitigasi: bedakan "tidak ada
   data" dari "nol" di tipe data.
4. **LLM mengarang angka.** Mitigasi: pemisahan lapis di atas, plus tes yang
   memastikan setiap kalimat rekomendasi mengutip Finding yang ada.
5. **Beban query.** Widget × YTD bisa memindai setahun transaksi tiap muat.
   Mitigasi: agregasi di SQL, cache digest harian, ukur sebelum menambah indeks.
6. **Tenancy.** Setiap query baru wajib memfilter company/branch — papan owner
   lintas-unit adalah tempat paling mudah bocor antar tenant.

## Non-Goals

- Seluruh widget berbasis ticketing (keputusan owner — lihat Batasan scope).
- Bukan menggantikan laporan detail per modul; papan ini ringkasan + pintu masuk.
- Tidak membangun stack AI baru — menumpang EPIC-017.
- Tidak mengubah arti angka widget lama saat menambah dimensi periode.

## Open Questions

1. ~~**B2B masuk Revenue Overview** saat invoice terbit, atau saat dibayar?~~
   **Terjawab 2026-07-31: saat dibayar.** Implementasinya memakai
   `crm_sales_deal_payments.paid_on`, bukan status invoice — lihat Automation Log.
2. **Ambang insight** — berapa persen perubahan yang layak jadi rekomendasi?
   Terlalu sensitif membuat owner banjir catatan tak berguna.
3. **Labor vs Revenue** memakai jumlah kru hadir, atau jam kerja terakumulasi?
   Jam kerja lebih akurat tapi bergantung kelengkapan absensi keluar.

## Acceptance Criteria

- [ ] Switcher periode mengubah seluruh widget serentak, pilihan tersimpan per user
- [ ] MTD dibandingkan dengan rentang hari yang sama bulan lalu — dibuktikan tes, termasuk kasus batas
- [ ] Omzet di papan sama persis dengan halaman modul POS untuk periode yang sama
- [ ] Widget tanpa data menampilkan "belum ada data", bukan angka 0
- [ ] Setiap rekomendasi AI mengutip angka yang bisa ditelusuri ke query
- [ ] Satu query gagal tidak mematikan papan (prinsip gagal-aman dipertahankan)
- [ ] Seluruh query baru ter-filter tenant
- [ ] Cakupan tes ≥ 80% untuk modul murni (`period.ts`, `insight-rules.ts`)

## Automation Log

- 2026-07-29 — Epic dibuat dari usulan owner (7 widget). Audit fondasi: papan
  `desktop-monitor.tsx` + `MONITOR_WIDGETS` (5 widget), `overview.ts` dengan
  prinsip gagal-aman & definisi-ikut-modul, `ask-do.ts` berkonteks angka,
  `SalesPulse.mingguLalu` sebagai preseden pembanding. Seluruh kolom yang
  disebut owner terverifikasi ada di skema.
  Temuan data produksi: `ticket_gate_events` dan `ticket_visits` **0 baris**,
  `pos_orders` 7, `bookings` 4, `promo_redemptions` 1, `sales_deals` 5,
  `attendance` 6.
- 2026-07-29 — **Owner memangkas scope: seluruh bagian ticketing tidak
  dikerjakan.** Visitor Traffic, Per-Visitor Economics, pecahan Tickets/Season
  Pass, dan komposisi channel walk-in-vs-online dicoret. Kebetulan sejalan dengan
  temuan data — keempatnya persis yang sumbernya masih kosong. Sisa 5 widget
  seluruhnya bertumpu pada tabel yang sudah terisi. Fase disusun ulang dari 5
  menjadi 4.
- 2026-07-29 — **Fase A TUNTAS.** `src/lib/desktop/period.ts` (modul murni) +
  17 tes yang **ditulis lebih dulu dan gagal dulu**: `resolvePeriod`,
  `resolveComparison`, `projectRunRate`, `summarizePeriod`. Kasus batas yang
  ditegakkan tes: 31 Maret vs Februari (jendela dipotong → `penuh: false`),
  29 Februari kabisat vs Januari, QTD di Q1 mundur ke Q4 tahun lalu, YTD kabisat
  mundur ke 28 Feb, pergeseran WIB (23:30 UTC = besok), dan penjaga pembagian nol
  agar papan tidak pernah menampilkan `NaN`.
  `overview.ts` menerima `PeriodKind` (default `today` — pemanggil lama tidak
  berubah artinya) dan menambah `periode` + `omzetPeriode`. Route
  `/api/desktop/overview?periode=` dengan **cache dikunci per periode** — satu
  slot bersama akan menyajikan angka YTD kepada pengguna yang memilih MTD selama
  60 detik, salah yang tidak terlihat karena angkanya tetap masuk akal.
  UI: `PeriodSwitcher` di atas papan (`col-span-full`) memakai
  `useSyncExternalStore`, bukan useEffect+setState — snapshot server dikunci
  `today` sehingga bebas hydration mismatch, lolos aturan lint
  `react-hooks/set-state-in-effect` yang disiasati kode lama lewat `setTimeout`,
  dan sebagai efek samping menyerempakkan pilihan antar tab.
  **Keputusan sengaja:** `timHariIni`, `perluKeputusan`, dan `stokMenipis` TIDAK
  mengikuti periode — ketiganya menggambarkan keadaan sekarang, dan "stok
  menipis YTD" bukan pertanyaan yang punya arti.
  **Temuan:** query desktop tidak memfilter tenant sama sekali. Itu memang
  disengaja (papan digate `super_admin`/`direksi`, lintas-unit), jadi query baru
  mengikuti konvensi yang sama alih-alih menambal setengah — AC "query
  ter-filter tenant" perlu dibaca sebagai "mengikuti gate role papan".
  Gate: lint bersih, typecheck tetap **475** (baseline, nol error baru — 3 error
  sempat muncul di fixture tes yang membangun `DesktopOverview` literal, sudah
  diperbaiki lewat `summarizePeriod`), **1117 tes lolos**.
- 2026-07-31 — **Fase B TUNTAS.** Dua widget baru terdaftar di
  `MONITOR_WIDGETS` (`omzet`, `promo`) sehingga bisa disembunyikan & diurutkan
  seperti widget lain; prompt Tanya Do berkonteks angka ditambahkan untuk
  keduanya. Modul murni `revenue.ts` + 9 tes ditulis lebih dulu.
  **Keputusan owner "B2B dihitung saat dibayar" tidak bisa diterapkan harfiah:**
  `crm_sales_invoices.status` hanya mengizinkan `diajukan|draft|terkirim|batal`
  — **tidak ada status lunas**, dan tabelnya tidak punya kolom tanggal bayar.
  Sumber kebenaran pembayaran adalah `crm_sales_deal_payments` (`amount`,
  `paid_on`). Dipakai itu, dan hasilnya lebih tepat: pelunasan sebagian
  menyumbang sebesar yang dibayar, bukan nol atau seratus persen. Pembayaran
  tanpa `invoice_id` (level deal) tetap dihitung — di dev ada 1 dari 2
  pembayaran seperti itu senilai Rp 5.000.000; menyaratkan invoice akan
  menghilangkannya dari laporan.
  **Promo hanya menghitung status `captured`** — `held` masih reservasi yang
  bisa batal, `released` sudah batal; menjumlahkan ketiganya melebih-lebihkan
  diskon yang benar-benar keluar. Konteks dibatasi `pos_order` karena ticketing
  di luar scope.
  Detail penyajian yang ditegakkan tes: porsi sumber dibulatkan lalu selisihnya
  dititipkan ke porsi terbesar agar **berjumlah tepat 100** (33+33+33=99 membuat
  owner mencari angka yang hilang); total ≤ 0 mengembalikan porsi 0, bukan
  persentase negatif; efisiensi promo `null` saat diskon nol (bukan `Infinity`)
  tapi `0` saat diskon keluar tanpa membawa omzet — yang pertama "belum ada
  data", yang kedua kabar buruk.
  **Perbaikan kerapuhan:** penambahan `dampakPromo` kembali memecahkan tiga
  fixture tes, persis seperti `periode` di Fase A. Ditambahkan
  `emptyDesktopOverview()` sebagai nilai-kosong resmi dan ketiga fixture
  diringkas memakainya, sehingga seksi berikutnya tidak mengulang masalah ini.
  Angka nyata dev saat implementasi: F&B Rp 1.076.600 vs B2B Rp 12.500.000 —
  B2B dominan, jadi komposisi sumber memang layak ditampilkan.
  Gate: lint 0 error, typecheck **475** (baseline), **1145 tes lolos**.
