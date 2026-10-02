# EPIC-060: Inventory Control RFID

status: backlog
environment: dev
retries: 0

## Goal

Kontrol stok dengan tag RFID (stock opname cepat, deteksi barang keluar) di atas modul Inventory yang sudah ada.

Referensi: [PRD](../product/PRD.md) · [BACKLOG](../BACKLOG.md).

## Keputusan desain

- **Menunggu keputusan owner**: jenis reader & tag RFID, serta cakupan (stok F&B, alat gym, merchandise). Dikerjakan setelah hardware diputuskan.

## Tasks

- [ ] T-060-1 Konfirmasi hardware & cakupan dengan owner.
- [ ] T-060-2 Registrasi tag ↔ item/aset.
- [ ] T-060-3 Stock opname via reader RFID.
- [ ] T-060-4 Laporan selisih & pergerakan.

## Acceptance Criteria

- [ ] Opname dengan reader RFID mencocokkan stok sistem dan menampilkan selisih.

## Automation Log

- 2026-10-02 — Didaftarkan dari daftar sisa pekerjaan setelah EPIC-056; owner: "lanjut, 5 poin dimasukkan ke task".
