# POS NFC PC/SC Bridge (Mac)

**Date:** 2026-07-13  
**Status:** Approved  
**Extends:** `2026-07-13-pos-nfc-topup-redirect-design.md`

## Goal

On macOS, read ACS ACR1555 (CCID/PC/SC) card UIDs locally and push them to the POS browser without requiring HID keyboard wedge mode.

## Architecture

1. Local Node agent (`tools/pos-nfc-bridge`) uses PC/SC to watch readers.
2. On **card insert** (edge trigger), send APDU `FF CA 00 00 00` to read UID.
3. Broadcast `{ type: "card", uid: "..." }` over `ws://127.0.0.1:8787`.
4. POS `PosNfcShell` connects to the bridge; on card event, reuse existing topup/payment routing.
5. While card stays on the reader, do **not** re-emit until remove + insert again.

## Ops

- Cashier Mac runs: `npm run pos:nfc-bridge`
- Bridge binds localhost only
- If bridge is down, POS keeps working; keyboard wedge path still available

## Out of scope

- Windows HID config tooling
- Multi-machine remote bridge
- Mapping UID → customer DB column (still match id/phone; ops may register UID as phone/id later)
