// Package integrations is the event contract of the integrations context
// (inbound webhooks of payment and messaging providers).
package integrations

// TopicXenditQrPaid is a verified, amount-checked Xendit QRIS payment for a
// pending record another context owns. The Xendit webhook
// (POST /api/payments/xendit/webhook) publishes it once per callback after
// checking the callback token and the amount; subscribers settle the record
// and must be idempotent (Xendit retries, and a cashier poll may settle the
// same record first).
const TopicXenditQrPaid = "payments.xendit_qr.paid"

// Xendit QR payment actions (resolveXenditPaidWebhookAction).
const (
	// ActionCreditTopup credits a pending ARK Coin top-up:
	// creditPendingTopup(db, { transactionId, xenditPaymentId, notes }) in
	// lib/pos/topup-credit.ts, then its top-up XP. Owner: stored-value.
	ActionCreditTopup = "credit_topup"
	// ActionCompleteCheckout completes a central (multi-stall) checkout
	// paid by QRIS: completeMixedCheckout(checkoutId, {},
	// { paymentAlreadyConfirmed: true }). Owner: pos-sales.
	ActionCompleteCheckout = "complete_checkout"
	// ActionCompleteOrder settles one open-bill order bound to its own
	// QRIS: settleOrderQrisPayment(db, orderId) (paid, queue number,
	// journals, member stats and XP). Owner: pos-sales.
	ActionCompleteOrder = "complete_order"
)

// XenditQrPaid is the paid callback, already matched to its target.
type XenditQrPaid struct {
	Action string `json:"action"`
	// TargetID is pos_wallet_transactions.id (credit_topup),
	// pos_checkouts.id (complete_checkout) or pos_orders.id (complete_order).
	TargetID    string  `json:"target_id"`
	ReferenceID string  `json:"reference_id"`
	QRID        string  `json:"qr_id"`
	PaymentID   string  `json:"payment_id"`
	Amount      float64 `json:"amount"`
	// XenditPaymentID is what the TS stored on a credited top-up
	// (paymentId || qrId).
	XenditPaymentID string `json:"xendit_payment_id"`
	// Notes is the top-up ledger note ("Top-up QRIS").
	Notes string `json:"notes,omitempty"`
}
