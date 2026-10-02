# EPIC-063: Siklus Paket — Freeze, Perpanjang, Upgrade

status: backlog
environment: dev
retries: 0

## Goal

Mengelola paket member setelah terjual.

Referensi: [PRD](../product/PRD.md) · [BACKLOG](../BACKLOG.md).

## Keputusan desain

- Freeze menggeser masa berlaku; upgrade memindahkan sisa nilai ke paket baru tanpa merusak perhitungan utang pass.

## Tasks

- [ ] T-063-1 Freeze/cuti paket (batas hari, alasan).
- [ ] T-063-2 Perpanjangan berbayar.
- [ ] T-063-3 Upgrade paket (sisa nilai dikreditkan).

## Acceptance Criteria

- [ ] Freeze, perpanjangan, dan upgrade tercatat di ledger dan liability tetap benar.

## Automation Log

- 2026-10-02 — Didaftarkan dari daftar sisa pekerjaan setelah EPIC-056; owner: "lanjut, 5 poin dimasukkan ke task".
