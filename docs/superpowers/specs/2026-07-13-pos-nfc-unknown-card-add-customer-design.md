# POS NFC Unknown Card → Add Customer

**Date:** 2026-07-13  
**Status:** Approved

## Goal

When an NFC card UID is scanned and no member matches, open Add customer on the current page with Card ID prefilled. Persist UID as `pos_customers.nfc_uid`.

## Behavior

1. Lookup by `nfc_uid`, then `id`, then `phone`.
2. Not found → open create customer UI with `nfc_uid` filled (readonly when from scan).
3. Save → store `nfc_uid`, enroll member default on, select customer and continue (topup amount / cashier cart).

## Scope

- Migration `nfc_uid`
- API customers GET/POST
- `CustomerSearchModal` Card ID field
- Topup + cashier unknown-card flows
