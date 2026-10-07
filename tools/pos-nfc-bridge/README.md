# POS NFC Bridge (Mac PC/SC → browser)

Reads contactless card UID from ACS ACR1555 (CCID mode) and pushes it to the POS web app.

## Run

From repo root:

```bash
npm run pos:nfc-bridge
```

First time only:

```bash
npm install --prefix tools/pos-nfc-bridge
```

Keep this terminal open while using POS.

## Browser

POS pages connect to `ws://127.0.0.1:8787` automatically.

## Notes

- Emits once per **insert**. Lift the card before scanning again.
- Localhost only.
- Keyboard wedge mode still works if configured.
