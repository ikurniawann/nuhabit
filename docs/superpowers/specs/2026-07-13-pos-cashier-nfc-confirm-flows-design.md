# Cashier NFC member select / create / topup prompts

**Date:** 2026-07-13  
**Status:** Approved

## Behavior (cashier-new)

1. Cashier claims NFC scans (no auto-redirect to topup).
2. Member found → select on cart.
3. Member missing → English confirm create → Add customer with Card ID.
4. ARK pay + insufficient balance → English confirm topup → `/dashboard/pos/topup?card=UID`.
5. ARK pay + enough balance → select member and continue.
