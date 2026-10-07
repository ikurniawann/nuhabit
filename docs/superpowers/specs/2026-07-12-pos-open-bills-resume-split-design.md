# Open Bills Resume Split Payment — Design

- **Date:** 2026-07-12
- **Status:** Approved for implementation
- **Scope:** Surface existing order splits on Open Bills and resume `SplitPaymentScreen`

## Decision

Option A: parent order stays one open bill; badge `Split · paid/total`; primary action **Pay splits** opens existing `SplitPaymentScreen`. Hide/disable create-Split when splits already exist. Full settle **Bayar** only for orders without active splits.

## Changes

1. `GET /api/pos/orders` — select `splits:pos_order_splits(...)` 
2. Open Bills card UX + resume payment overlay
3. Optional: restaurant open-bills rail split badge
