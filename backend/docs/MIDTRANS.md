# Midtrans as a payment gateway

Midtrans is selectable next to Xendit in Settings → Payment Gateways. One
gateway is active at a time: activating one deactivates the other. Gym
package purchases (member app, public site, pass auto-renew) pay at the
active gateway through the port in `internal/platform/paygate`; the Xendit
adapter wraps the code that ran before (`gymcredits/adapters_xendit.go`),
the Midtrans adapter is `paygate/midtrans.go`.

## Settings

| Field | Column | Midtrans dashboard |
|---|---|---|
| Server key | `secret_key` | Settings → Access Keys → Server Key |
| Client key | `public_key` | Settings → Access Keys → Client Key (snap.js only) |
| Merchant ID | `metadata.merchant_id` | Settings → Access Keys → Merchant ID (reference only) |
| Environment | `environment` | sandbox keys start with `SB-Mid-`, production with `Mid-` |

Register the notification URL in the Midtrans dashboard under Settings →
Configuration → Payment Notification URL:

    https://<app host>/api/payments/midtrans/webhook

The "Test koneksi" button calls `POST /api/settings/payment-gateways/midtrans/test`,
which reads `GET {api}/v2/nuhabit-ping-<random>/status` with the stored
server key: a 404 (`Transaction doesn't exist`) means the key was accepted,
a 401 that it was not. No money moves.

Hosts (docs: https://docs.midtrans.com/docs/ip-address):

| | Sandbox | Production |
|---|---|---|
| Core API | `https://api.sandbox.midtrans.com` | `https://api.midtrans.com` |
| Snap | `https://app.sandbox.midtrans.com` | `https://app.midtrans.com` |

`MIDTRANS_API_BASE_URL` and `MIDTRANS_SNAP_BASE_URL` override them (tests
point them at a local stand-in). `MIDTRANS_MOCK=1` (local dev only) answers
every call without the network: fake QR strings, the hosted page is the
status page itself, and the first status poll reports paid.

## Which Midtrans APIs

Authentication everywhere is HTTP Basic with the server key as the user
name and an empty password (`Authorization: Basic base64(serverKey + ":")`).

1. **Hosted checkout: Snap.** `POST {snap}/snap/v1/transactions` with
   `transaction_details.order_id` (our `gymcp_` reference) and
   `gross_amount`, one `item_details` line, `customer_details`,
   `callbacks.finish` (the status page) and `expiry` (2 hours). The answer
   carries `token` and `redirect_url`; the member app redirects to
   `redirect_url` (no snap.js, so the client key is not needed by the app).
   Snap appends `order_id`, `status_code` and `transaction_status` to the
   finish URL; the status page ignores them and polls our API.
   - https://docs.midtrans.com/reference/backend-integration
   - https://docs.midtrans.com/docs/snap-snap-integration-guide
   - https://docs.midtrans.com/reference/snap-js (snap.js, `data-client-key`,
     `window.snap.pay(token)`: available if an embedded checkout is wanted later)
   - https://docs.midtrans.com/recipes/snap-how-to-utilize-query-params-in-the-finish-url-for-snap-redirection
2. **QR flow: Core API QRIS.** `POST {api}/v2/charge` with
   `payment_type: "qris"`, `qris.acquirer: "gopay"` and `custom_expiry`
   (30 minutes). The answer has `transaction_id`, `qr_string`, `expiry_time`
   (Jakarta time) and an action `generate-qr-code` whose URL serves the QR
   as PNG. A 402 means the account has no QRIS channel; the purchase then
   falls back to a Snap page and the member app shows the checkout link.
   Core API on production needs activation by Midtrans.
   - https://docs.midtrans.com/reference/charge-transactions-1
   - https://docs.midtrans.com/reference/qris
   - https://docs.midtrans.com/reference/core-api-overview
3. **Status polling (reconciliation).** `GET {api}/v2/{order_id}/status`.
   The member status page and the `gym-credits.purchase-reconcile` job
   (every 2 minutes) read it; a 404 is a Snap page the payer never picked a
   method on and counts as pending until our own expiry.
   - https://docs.midtrans.com/reference/get-transaction-status
4. **Cancel on expiry.** `POST {api}/v2/{order_id}/cancel` before a purchase
   past its expiry is closed, so a late payment cannot land on a closed
   purchase. A 412 means Midtrans will not change the status any more; the
   purchase is then read again and settled if it was paid meanwhile.
   - https://docs.midtrans.com/reference/cancel-transaction
5. **HTTP notification (webhook).** `POST /api/payments/midtrans/webhook`.
   - https://docs.midtrans.com/docs/https-notification-webhooks
   - https://docs.midtrans.com/reference/handle-notifications
   - https://docs.midtrans.com/docs/transaction-status-cycle

## Webhook

The body is verified before anything is read from it:

    signature_key == SHA-512(order_id + status_code + gross_amount + ServerKey)

`gross_amount` is compared character for character as Midtrans sent it
(`"300000.00"`), so the body is parsed with number literals kept. The server
key is read from the Midtrans row whether or not it is the active gateway,
so payments started before a gateway switch still settle. A wrong signature
is a 401; everything else is a 200, because Midtrans retries non-2xx up to
five times and nothing improves on retry.

Status mapping (`paygate.MapState`):

| `transaction_status` | `fraud_status` | Purchase |
|---|---|---|
| `settlement` | any | paid |
| `capture` | `accept` or absent | paid (cards) |
| `capture` | `challenge` | still pending (wait for the review) |
| `capture` | `deny` | failed |
| `pending`, `authorize` | | pending |
| `expire` | | expired |
| `cancel` | | expired (closed; the member starts a new purchase) |
| `deny`, `failure` | | failed |
| `refund`, `partial_refund`, `chargeback`, `partial_chargeback` | | ignored (a refund is recorded from the dashboard) |

A paid notification checks `gross_amount` against the purchase total and
settles through `SettleGymPurchase`, the same path the Xendit webhook uses;
a second notification for the same `order_id` sees the purchase already
paid (`already_paid`). Expire, cancel and deny close a still-pending gym
purchase. Non-gym references (POS top-ups, checkouts, orders) are matched
by `order_id` and queued on the same outbox topic as Xendit QR payments.

## Local dev

- No active gateway plus the dev bypass (`MEMBER_OTP_DEV_CODE`): the member
  app gets a simulated QR and "I've paid" calls `simulate-paid`, whatever
  the provider.
- Midtrans active plus `MIDTRANS_MOCK=1`: the purchase is marked simulated
  and the first status poll settles it, without reaching Midtrans.
- Midtrans sandbox for real: set the sandbox server key, environment
  sandbox, and pay the QR in the Midtrans simulator
  (https://simulator.sandbox.midtrans.com). The notification URL must be
  public; use a tunnel for the webhook, or rely on polling.

## What stays Xendit-only

- Saved cards and e-wallets for auto-renew (Xendit Payments API). The
  member app hides "Metode pembayaran" while Midtrans is active
  (`/api/member-portal/gym/payment-methods` answers `enabled: false`) and
  renewals fall back to a hosted page.
- Shop storefront, ticketing, POS QRIS, table order and ARK Coin top-ups
  still create their payments at Xendit through their own clients; the port
  is ready for them to adopt (`paygate.Gateway`).
