# Tax & Service Settings UI (Approach A)

Date: 2026-08-13

## Goal

Konfigurasi Tax (PPN) dan Service Charge terpisah dari alur kasir POS: menu di **Settings**, UI ringkas dua kartu utama. Backend billing profile tetap.

## Scope

- Reskin `/dashboard/settings/billing` → judul **Tax & Service**
- Kartu Tax + Service: aktif, rate %, optional di kasir, label nama
- Fee/rounding di **Pengaturan lanjutan** (collapsed)
- Rename menu `settings.billing` → `Tax & Service`
- Legacy `/dashboard/pos/billing-settings` tetap redirect

## Out of scope

- Schema/API baru, COA, perubahan kalkulasi kasir

## Behavior

- Scope sistem / cabang / stall tidak berubah
- Save mengirim full `charges[]` (tax + service + advanced)
- Jika profil tanpa baris TAX/SERVICE, UI inject default dari `DEFAULT_BILLING_CHARGES`
