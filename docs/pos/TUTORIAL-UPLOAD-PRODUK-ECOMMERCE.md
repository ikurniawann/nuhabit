# Tutorial: Upload Produk Ecommerce — dari Awal sampai Tampil di Storefront

> EPIC-039 · terakhir diverifikasi terhadap kode 2026-08-02.
> Environment contoh: DEV `https://dev-sulu.within.ventures` (login super_admin/admin).
> Storefront publik default: `https://dev-sulu.within.ventures/shop/toko`.

Alur besar:

```
Master Item (Items → Products)  ──sinkron otomatis──►  Master Produk POS
        │                                                    │
        │ PR → PO → GRN (stok masuk)                         │ Jenis = Merchandise
        ▼                                                    ▼
   Stok merchandise  ◄──────────────  Dialog "Pengaturan Merchandise"
                                      (tautan purchasing, stok, berat,
                                       varian SKU, ✔ tampil di toko online)
                                                    │
                                                    ▼
                                    Storefront /shop/toko (katalog web)
```

Ada dua jalur stok — pilih salah satu:

- **Jalur A (disarankan, lewat purchasing):** buat master item dulu → stok masuk
  via GRN (Goods Receive Note). Cocok untuk barang yang benar-benar dibeli dari
  vendor (kaos, tumbler, boneka).
- **Jalur B (cepat, stok manual):** langsung set produk POS jadi merchandise dan
  isi "Stok saat ini" di dialog. Cocok untuk uji coba / stok awal tanpa purchasing.

---

## Langkah 1 — Buat master item (Jalur A)

Menu **Items → Products** (`/dashboard/items/products`) → **Tambah Produk**.

1. Isi kode, nama (mis. "Kaos Sulu Logo"), kategori, satuan.
2. **Production Output Type = FINISHED_GOOD** (barang jadi beli-jadi-jual, tanpa BOM).
3. Isi **Harga Jual** — ini yang menjadi harga dasar di POS & storefront.
4. Simpan.

Item ini **otomatis tersinkron** ke Master Produk POS dengan SKU `PUR-<kode>`
(tidak perlu tombol sinkron manual). Kalau memakai Jalur B, langkah ini boleh
dilewati dan langsung ke Langkah 2 memakai produk POS yang sudah ada.

## Langkah 2 — Tandai produk sebagai Merchandise

Menu **Point of Sales → Products** (`/dashboard/pos/products`).

1. Cari produknya di tabel.
2. Di kolom **Jenis**, ubah dropdown dari `Regular` → `Merchandise`.
   (Gift Card tampil read-only — jangan diubah.)

Setelah jadi merchandise, muncul tombol ikon di sebelah dropdown:
**"Stok, tautan purchasing & berat"** — itu pintu ke langkah berikutnya.

## Langkah 3 — Dialog "Pengaturan Merchandise"

Klik tombol tersebut. Isi:

| Field | Keterangan |
|---|---|
| **Tautan purchasing** | Pilih master item Langkah 1. Dengan tautan ini, **GRN otomatis menambah stok** produk ini. Pilih "— Tanpa tautan —" untuk stok manual (Jalur B). |
| **Stok saat ini** | Stok on-hand. **Diabaikan bila ada varian** (stok pindah ke per-varian). |
| **Berat (gram)** | Wajib diisi wajar — dipakai menghitung **ongkir** di checkout. |
| **Varian ber-SKU** (opsional) | Untuk produk berukuran/warna (mis. kaos M/L/XL). Per varian: **kode SKU** (unik), **nama** (mis. "Merah / L"), **barcode** (opsional, untuk scan kasir), **harga override** (kosong = harga produk), **stok varian**. |
| **✔ Tampilkan di toko online (katalog web)** | **Wajib dicentang** agar produk muncul di storefront. |

Simpan → "Pengaturan merchandise tersimpan".

## Langkah 4 — Isi stok lewat purchasing (Jalur A)

Modul purchasing produk seperti biasa (module_type `product`):

1. **PR (Purchase Request)** → ajukan item Langkah 1 → approve.
2. **PO (Purchase Order)** → terbit ke vendor → approve.
3. **GRN / Receive** → terima barang.

Saat GRN diterima, stok POS produk merchandise yang tertaut **bertambah
otomatis** (non-fatal: kalau tautan tidak ada, GRN tetap jalan tanpa stok POS).

Catatan: **produk ber-varian di-SKIP oleh GRN** (GRN per varian = fase lanjut).
Untuk produk ber-varian, isi stok per varian langsung di dialog Langkah 3.

## Langkah 5 — Verifikasi di storefront

Buka `https://dev-sulu.within.ventures/shop/toko`.

Produk tampil **hanya jika semua ini terpenuhi** (sesuai query katalog):

- [ ] Jenis = **Merchandise**
- [ ] Produk **aktif** dan **available** di master POS
- [ ] Checkbox **"Tampilkan di toko online"** dicentang
- [ ] (Harga muncul dari harga jual; varian aktif tampil sebagai pilihan)

Stok yang bisa dibeli = stok riil dikurangi reservasi checkout yang masih hidup
(reservasi kedaluwarsa otomatis dirilis).

## Langkah 6 — Uji checkout sampai lunas (opsional, end-to-end)

1. Di storefront: tambah ke keranjang → checkout → isi alamat.
2. **Ongkir** muncul bila Settings → **Pengiriman (Kurir)** sudah diisi origin +
   `BITESHIP_API_KEY`/`RAJAONGKIR_API_KEY` ada di env.
3. **Bayar** via invoice Xendit (butuh `XENDIT_MOCK=1` atau key asli + webhook
   `/api/public/shop/webhook/xendit` terdaftar). Stok direservasi 2 jam sampai
   invoice dibayar/kedaluwarsa.
4. Pesanan masuk ke **Ecommerce → Pesanan** (`/dashboard/shop/orders`) dengan
   status `paid` → proses packing → kirim (Biteship atau resi manual).

## Batasan yang perlu diketahui (per 2 Agu 2026)

- **Gambar produk belum ada UI upload.** Kolom `image_url` / tabel
  `pos_product_images` sudah dibaca storefront, tapi belum ada halaman untuk
  mengunggahnya — produk tampil tanpa foto (placeholder). Kandidat fase lanjut.
- **Harga khusus channel web** (`price_override` per channel) belum ada UI —
  harga web = harga jual produk (atau harga override per varian).
- **GRN belum mendukung produk ber-varian** — stok varian dikelola manual.
- Split bill di kasir **menolak** item merchandise ber-stok (by design, MVP).
- Marketplace Shopee (menu **Ecommerce → Marketplace**) alurnya terpisah:
  mapping listing Shopee ↔ produk/SKU, push stok & pull order — lihat epic
  EPIC-039 Fase F.
