# POS NFC Scan → Topup Redirect

**Date:** 2026-07-13  
**Status:** Approved

## Goal

When a member NFC card is tapped on any `/dashboard/pos/*` page, redirect to `/dashboard/pos/topup` and auto-select the member — unless a payment/NFC modal is open, in which case the scan stays in the payment flow.

## Prerequisites

- ACS ACR1555 (or compatible) configured as **keyboard wedge** (UID/ID + Enter).
- PC/SC-only mode is out of scope for v1.

## Behavior

1. Global key listener on POS routes buffers a fast key burst ending in Enter.
2. If payment/NFC modal claims the scan → do not redirect.
3. Otherwise → `router.push('/dashboard/pos/topup?card=<value>')`.
4. Topup reads `card`, looks up customer by `id` or `phone` (same as cashier NFC).
5. Found → select customer, step `enter_amount`; clear query param.
6. Not found → toast/error, stay on topup for manual search; clear query param.
7. Already on topup → apply card without full navigation loop.
8. Debounce ~1s against double taps.

## Components

- Pure wedge buffer helpers + unit tests
- `PosNfcProvider` context (`paymentNfcActive`)
- `PosNfcScanListener` mounted for `/dashboard/pos/*`
- Cashier sets `paymentNfcActive` when Payment/NFC modal open
- Topup consumes `?card=`

## Out of scope

- Native PC/SC bridge
- Dedicated `nfc_uid` DB column
- Listening outside `/dashboard/pos/*`
