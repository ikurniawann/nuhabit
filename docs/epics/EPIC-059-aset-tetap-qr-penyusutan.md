# EPIC-059: Aset Tetap — QR Code & Penyusutan

status: backlog
environment: dev
retries: 0

## Goal

Register aset (alat gym, perabot, elektronik) dengan label QR per aset, penyusutan otomatis, log perawatan, dan disposal — sesuai permintaan owner.

Referensi: [PRD](../product/PRD.md) · [BACKLOG](../BACKLOG.md).

## Keputusan desain

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

- 2026-10-02 — Didaftarkan dari daftar sisa pekerjaan setelah EPIC-056; owner: "lanjut, 5 poin dimasukkan ke task".
