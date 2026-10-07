# EPIC-040: Konfigurasi Struk POS — Header & Footer Bisa Dikonfigurasi

status: ready-for-qa
environment: dev
phase: 1
priority: P1
area: Fullstack

## Goal

Informasi header dan footer struk POS (nama usaha, alamat, kontak, ucapan
penutup, catatan promo/WiFi) bisa dikonfigurasi dari menu bisnis
(`/dashboard/settings/business`) tanpa mengubah kode atau deploy.

Pemicunya permintaan owner: struk harus bisa membawa identitas usaha yang
dikelola sendiri. Saat ini identitas itu **tidak ada sama sekali** — lihat
Kondisi Sekarang.

## Kondisi Sekarang

Struk tidak mencetak identitas usaha apa pun, dan tidak ada tempat untuk
mengaturnya:

| Tempat | Kondisi |
|---|---|
| [`PrintReceipt.tsx:367`](../../src/components/pos/PrintReceipt.tsx) | Header HTML print hanya `--- CUSTOMER COPY ---` + tipe order + meja + antrian + jam. Tidak ada nama usaha, alamat, atau kontak |
| [`PrintReceipt.tsx:75`](../../src/components/pos/PrintReceipt.tsx) | `buildReceiptLines()` (jalur print worker ESC/POS via print queue) — sama: tanpa identitas usaha, tanpa footer |
| [`receipt-wa.ts:87,113`](../../src/lib/pos/receipt-wa.ts) | Struk WhatsApp: footer `"Terima kasih atas kunjungan Anda 🙏"` **hardcode** |
| `/dashboard/settings/business` | Hub pengaturan bisnis ada (menu `settings.business`), tapi tidak punya bagian struk |
| `database/migrations` | Tidak ada tabel konfigurasi struk (`grep receipt.*settings` → nihil) |

Tiga jalur cetak harus konsisten: HTML window-print, ESC/POS print worker,
dan struk WhatsApp. Konfigurasi di satu tempat harus mengalir ke ketiganya.

Pola yang sudah mapan untuk ditiru:
- `pos.pos_loyalty_settings` + [`loyalty-settings.ts`](../../src/lib/pos/loyalty-settings.ts) — settings singleton + normalize + default aman.
- [`billing-settings`](../../src/features/pos/billing-settings/) — profil per branch/warehouse dengan fallback, UI form + API upsert.

## Tasks

### 1. Backend: tabel `pos.pos_receipt_settings` + API GET/PUT

- [x] Migrasi delta: tabel `pos.pos_receipt_settings` — kolom minimal:
      `header_lines jsonb` (array string: nama usaha, alamat, telepon/IG),
      `footer_lines jsonb` (array string: ucapan penutup, WiFi, promo),
      `show_stall_name boolean`, `branch_id uuid null`, `warehouse_id uuid null`,
      `is_active`, timestamps. Baris global = branch/warehouse NULL;
      resolusi fallback: warehouse → branch → global (pola billing-settings).
- [x] `src/lib/pos/receipt-settings.ts`: loader + `normalizeReceiptSettings()`
      + `DEFAULT_RECEIPT_SETTINGS` (default = perilaku sekarang: tanpa header
      identitas, footer WA "Terima kasih atas kunjungan Anda 🙏") + unit test.
- [x] Route `GET/PUT /api/settings/receipt` — guard menu `settings.business`.
      Sanitasi: batasi jumlah baris (mis. ≤ 6 per bagian) dan panjang per baris
      (lebar kertas 80mm ≈ 42 kolom; potong/validasi di server).

### 2. UI: bagian "Konfigurasi Struk" di Settings → Business

- [x] Section baru di `/dashboard/settings/business`: editor baris header dan
      footer (tambah/hapus/urut), pilih scope (global / per stall),
      toggle tampilkan nama stall.
- [x] Preview struk live di samping form (pakai renderer yang sama dengan
      cetak asli, bukan mock terpisah — supaya preview = hasil print).
- [x] Grant permission: menu `settings.business` sudah ada; pastikan role
      admin mendapat akses section ini tanpa migrasi menu baru.

### 3. Integrasi cetak: ketiga jalur membaca konfigurasi

- [x] `ReceiptPayload` ditambah `receiptHeader?: string[]` dan
      `receiptFooter?: string[]`; pemanggil (cashier-page, restaurant,
      preview-bill, topup) memuat settings via query TanStack + meneruskannya.
- [x] HTML print (`printThermalReceipt`): header identitas dicetak di atas
      `--- {COPY} ---`, footer di bawah total — hanya bila dikonfigurasi;
      payload tanpa konfigurasi mencetak persis seperti sekarang.
- [x] ESC/POS (`buildReceiptLines`): baris header/footer masuk output worker
      (center via `formatReceiptRow`); update `PrintReceipt.test.ts` dan
      `print-receipt-layout.test.ts`.
- [x] Struk WhatsApp (`receipt-wa.ts`): footer hardcode diganti baca
      konfigurasi, fallback ke teks sekarang.

## Acceptance Criteria

- Owner mengubah nama usaha/alamat/footer dari UI dan struk berikutnya
  mencetak nilai baru — tanpa deploy, tanpa restart.
- Ketiga jalur (HTML print, print worker ESC/POS, WA) menampilkan header dan
  footer yang sama dari satu sumber konfigurasi.
- Konfigurasi kosong = tampilan struk hari ini, byte-per-byte (regresi nol
  untuk venue yang belum mengatur apa pun).
- Scope per-stall menimpa global; stall tanpa konfigurasi jatuh ke global.
- Baris lebih panjang dari lebar kertas tidak merusak layout ESC/POS
  (dipotong/di-wrap di `formatReceiptRow`, ada unit test-nya).
- Copy dapur/bar TIDAK ikut memuat header identitas & footer (hemat kertas,
  dapur hanya butuh isi order) — hanya customer copy.

## Dependencies

- None (pola dari billing-settings & loyalty-settings sudah tersedia).
- Bersinggungan ringan dengan EPIC-030/EPIC-032 bila menyentuh struk —
  koordinasikan bila ada MR aktif di `PrintReceipt.tsx`.
