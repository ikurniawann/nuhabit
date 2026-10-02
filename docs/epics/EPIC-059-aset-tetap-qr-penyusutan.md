# EPIC-059: Aset Tetap — QR Code & Penyusutan

status: backlog
environment: dev
retries: 0

## Goal

Register aset (alat gym, perabot, elektronik) dengan label QR per aset, penyusutan otomatis, log perawatan, dan disposal — sesuai permintaan owner.

Referensi: [PRD](../product/PRD.md) · [BACKLOG](../BACKLOG.md).

## Keputusan desain

- **Menunggu konfirmasi proses bisnis owner (2026-10-02)** — jangan dikerjakan sebelum terjawab:
  1. Nilai minimum kapitalisasi (usulan default: ≥ Rp1.000.000 & dipakai > 1 tahun; di bawahnya = biaya/stok).
  2. Umur ekonomis per kategori (usulan default: alat latihan ringan & elektronik 4 tahun; alat berat, rig & furnitur 8 tahun; renovasi ikut kelompok bangunan) — konfirmasi tim finance.
  3. Daftar aset yang sudah ada (Excel → fitur import).
- Cakupan yang dibahas: alat gym Hyrox (SkiErg, rower, sled, bike, treadmill), beban & rig, elektronik, furnitur & peralatan F&B, renovasi. Barang kecil/habis pakai (band, rope, chalk, handuk) bukan aset tetap → biaya atau inventory (EPIC-060).

- Penyusutan garis lurus bulanan, jurnal otomatis via mapping Accounting (Dr beban penyusutan / Cr akumulasi penyusutan).
- Scan QR membuka detail aset (lokasi, kondisi, riwayat perawatan).

## Tasks

- [ ] T-059-1 Master kategori aset (umur ekonomis, akun) + register aset.
- [ ] T-059-2 Cetak label QR (satuan & massal) + halaman scan.
- [ ] T-059-3 Penyusutan bulanan otomatis + laporan nilai buku.
- [ ] T-059-4 Log perawatan alat, mutasi lokasi, disposal/penjualan aset.

## Acceptance Criteria

- [ ] Setiap aset punya QR unik yang bisa dicetak & dipindai.
- [ ] Penyusutan bulanan tercatat & nilai buku sesuai.
- [ ] Riwayat perawatan & disposal tercatat.

## Automation Log

- 2026-10-02 — Owner: alat gym termasuk aset; ditunda sampai proses bisnis dikonfirmasi (kapitalisasi, umur ekonomis, daftar aset).
- 2026-10-02 — Didaftarkan dari daftar sisa pekerjaan setelah EPIC-056; owner: "lanjut, 5 poin dimasukkan ke task".
