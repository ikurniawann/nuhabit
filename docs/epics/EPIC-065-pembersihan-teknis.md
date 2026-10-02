# EPIC-065: Pembersihan Teknis & Rilis ke Development

status: backlog
environment: dev
retries: 0

## Goal

Merapikan sisa kode BCD yang tidak terpakai dan menggabungkan branch NüHabit.

Referensi: [PRD](../product/PRD.md) · [BACKLOG](../BACKLOG.md).

## Keputusan desain

- Menu BCD yang tidak relevan sudah disembunyikan (soft-delete); kode dihapus bertahap setelah dipastikan tidak dipakai.

## Tasks

- [ ] T-065-1 Inventaris modul/rute BCD yang tidak dipakai NüHabit.
- [ ] T-065-2 Hapus/arsipkan kode mati; rapikan `src/types/ui.d.ts`.
- [ ] T-065-3 PR `feat/nuhabit-foundation` → `development`.

## Acceptance Criteria

- [ ] Build & tes tetap hijau setelah pembersihan.
- [ ] PR ke development dibuat dan direview.

## Automation Log

- 2026-10-02 — Didaftarkan dari daftar sisa pekerjaan setelah EPIC-056; owner: "lanjut, 5 poin dimasukkan ke task".
