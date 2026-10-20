# Saved payment methods (Xendit)

Members save a card or e-wallet once and gym pass auto-renew charges it
without them. The feature is off unless `XENDIT_SAVED_METHODS_ENABLED=1` and
the Xendit gateway is active in Settings → Payment Gateways.

## Which Xendit API

Xendit's Payments API (the v3 generation), in two parts:

1. **Linking: Payment Session, `session_type: SAVE`, `mode: PAYMENT_LINK`.**
   The API creates the session (`POST /sessions`, amount 0, country `ID`,
   currency `IDR`) and sends the member to `payment_link_url`, a page Xendit
   hosts. The member enters the card or approves the e-wallet there, so card
   numbers never reach our servers and we stay out of PCI scope. The session
   ends with a `payment_token_id`. Cards are saved with
   `channel_properties.cards.card_on_file_type: RECURRING`.
   - https://docs.xendit.co/docs/storing-payment-details
   - https://docs.xendit.co/apidocs/create-session
   - https://docs.xendit.co/apidocs/get-session
   - https://docs.xendit.co/docs/payment-sessions-overview
2. **Charging: Payment Request with the token.** A renewal calls
   `POST /v3/payment_requests` (`api-version: 2024-11-11`, `type: PAY`,
   `payment_token_id`, `request_amount`, `capture_method: AUTOMATIC`, and
   `card_on_file_type: RECURRING` for cards). The `idempotency-key` header is
   our purchase reference, so a retried HTTP call cannot charge twice.
   - https://docs.xendit.co/docs/pay-with-tokens
   - https://docs.xendit.co/apidocs/create-payment-request
   - https://docs.xendit.co/apidocs/get-payment-request
   - https://docs.xendit.co/apidocs/get-payment-token
   - https://docs.xendit.co/apidocs/cancel-payment-token

The same API covers cards and the Indonesian e-wallets that support linking
(the token docs use OVO in their examples). Xendit Recurring (plans and
cycles) was not used: renewals already run on our own schedule and rules,
and a plan would duplicate them.

We store per method: the token id, the channel code, the kind (card,
e-wallet), a masked label ("VISA •••• 1005" from `masked_card_number`, or the
wallet name) and the status. No card number, expiry, holder name or wallet
balance is kept. Logs print token ids shortened to their first 8 characters.

## Webhooks

Point these Xendit dashboard webhooks at `/api/payments/xendit/webhook` (the
QRIS callback URL):

| Dashboard product | Events we use |
|---|---|
| Payment Sessions | `payment_session.completed`, `payment_session.expired` |
| Payment Tokens v3 | `payment_token.activation`, `payment_token.expiry`, `payment_token.failure` |
| Payment Requests v3 | `payment.capture`, `payment.failure` |

- https://docs.xendit.co/apidocs/webhook-notification-sent-defined-webhook-url-updates-payment-session
- https://docs.xendit.co/apidocs/payment-token-webhook-notification
- https://docs.xendit.co/apidocs/payment-webhook-notification

Every event must carry the account's `x-callback-token`, compared in
constant time with `webhook_secret` of the gateway row; a wrong token gets
401 and changes nothing. On top of that, a completed session is read back
from Xendit (`GET /sessions/{id}`) before its token is stored, and a
`payment.capture` settles a purchase only when its amount matches the
purchase total. The 2-minute reconcile job asks Xendit about pending charges
too (`GET /v3/payment_requests/{id}`), and opening the Metode pembayaran
screen re-reads pending links, so a lost webhook only delays things.

## Flow in the app

- Member app → Profil → Metode pembayaran: link (redirect to Xendit) or
  remove. One active method per member. Removing it cancels the token at
  Xendit and moves the member's passes from `saved_method` to invoice.
- Membership card → auto-renew: "Metode tersimpan" appears only when the
  feature is on.
- Renewal sweep (`gym-credits.pass-renewals`, hourly): with
  `renew_with = 'saved_method'` and an active method it creates the purchase
  and the payment request. Success settles at once or by webhook; a decline
  closes the purchase as failed and the retry rules take over
  (`renewalRetryCount`, `renewalRetryHours`, `renewalGraceDays`). A token
  Xendit no longer accepts (`INVALID_TOKEN`) marks the method expired, tells
  the member, and later attempts use an invoice.

## Local dev and tests

Without an active gateway and with the dev OTP bypass on (local dev), the
service uses a simulated rail: linking stores a test card at once and every
charge succeeds. Tests use a fake gateway and never call Xendit.

## Still to check in a Xendit sandbox

- That the account has Payment Sessions SAVE and the wanted channels enabled
  (`INVALID_PAYMENT_CHANNEL` otherwise), and which e-wallets support linking.
- The exact webhook bodies for `payment_token.*` and `payment.failure`, and
  whether `payment_session.completed` arrives before `payment_token.activation`.
- That `card_on_file_type: RECURRING` with `recurring_frequency: 30` suits
  passes that are not monthly; `MERCHANT_UNSCHEDULED` may fit better.
- Whether Xendit asks for 3DS or e-wallet approval on a merchant-initiated
  charge (`REQUIRES_ACTION`); such a charge stays pending until it expires
  after 24 hours and then follows the retry rules.
