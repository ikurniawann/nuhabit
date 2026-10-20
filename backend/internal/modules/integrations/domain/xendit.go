package domain

import (
	"crypto/sha256"
	"crypto/subtle"
	"strings"

	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/validate"
)

// SafeEqual is lib/security/compare safeEqual: both sides hashed with
// SHA-256 so the comparison takes the same time whatever their length or
// common prefix. An empty side never matches.
func SafeEqual(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	da, db := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(da[:], db[:]) == 1
}

// VerifyXenditToken is verifyXenditWebhookToken: the x-callback-token must
// equal the gateway's webhook_secret (both trimmed). No secret configured
// rejects every callback (fail closed).
func VerifyXenditToken(incoming, expected string) bool {
	return SafeEqual(validate.JSTrim(incoming), validate.JSTrim(expected))
}

// QrWebhook is parseXenditQrWebhook's result.
type QrWebhook struct {
	Paid        bool
	Status      string
	QRID        string
	ReferenceID string
	Amount      float64
	PaymentID   string
}

var paidStatuses = map[string]bool{"SUCCEEDED": true, "SUCCESS": true, "COMPLETED": true, "PAID": true}

// ParseQrWebhook is parseXenditQrWebhook: the QR payment callback's fields,
// read from body.data when it is an object, else from the body itself.
func ParseQrWebhook(body map[string]any) QrWebhook {
	data := body
	switch d := body["data"].(type) {
	case map[string]any:
		data = d
	case []any:
		data = map[string]any{}
	}
	amount := jsNumber(firstPresent(data["amount"], body["amount"], 0))
	if !finite(amount) {
		amount = 0
	}
	w := QrWebhook{
		Status:      strings.ToUpper(jsString(or(data["status"], body["status"], ""))),
		QRID:        jsString(or(data["qr_id"], data["id"], data["qr_code_id"], body["qr_id"], body["id"], "")),
		ReferenceID: jsString(or(data["reference_id"], data["external_id"], body["reference_id"], body["external_id"], "")),
		Amount:      amount,
		PaymentID:   jsString(or(data["payment_id"], data["id"], body["payment_id"], "")),
	}
	w.Paid = paidStatuses[w.Status] || strings.Contains(strings.ToLower(jsString(or(body["event"], ""))), "paid")
	return w
}

// XenditEvent is a Payments API webhook (payment_session.*,
// payment_token.* or payment.*). The QR callback's event is qr.payment, so
// the two never mix.
type XenditEvent struct {
	Event       string
	Status      string
	ReferenceID string
	SessionID   string
	TokenID     string
	PaymentID   string
	FailureCode string
	// Amount is request_amount, else the captured total.
	Amount float64
	// Data is the event's data object.
	Data map[string]any
}

// Paid reports a captured payment.
func (e XenditEvent) Paid() bool { return e.Event == "payment.capture" && e.Status == "SUCCEEDED" }

var paymentsAPIEvent = []string{"payment_session.", "payment_token.", "payment."}

// ParseXenditEvent reads a Payments API webhook; ok=false for any other body.
func ParseXenditEvent(body map[string]any) (XenditEvent, bool) {
	event, _ := body["event"].(string)
	data, isObj := body["data"].(map[string]any)
	matched := false
	for _, prefix := range paymentsAPIEvent {
		matched = matched || strings.HasPrefix(event, prefix)
	}
	if !matched || !isObj {
		return XenditEvent{}, false
	}
	text := func(key string) string {
		s, _ := data[key].(string)
		return s
	}
	amount := jsNumber(data["request_amount"])
	if captures, ok := data["captures"].([]any); ok && (!finite(amount) || amount <= 0) {
		amount = 0
		for _, c := range captures {
			amount += jsNumber(Obj(c)["capture_amount"])
		}
	}
	if !finite(amount) {
		amount = 0
	}
	return XenditEvent{
		Event: event, Status: strings.ToUpper(text("status")), ReferenceID: text("reference_id"),
		SessionID: text("payment_session_id"), TokenID: text("payment_token_id"), PaymentID: text("payment_id"),
		FailureCode: text("failure_code"), Amount: amount, Data: data,
	}, true
}

// firstPresent is `a != null ? a : b != null ? b : …`.
func firstPresent(values ...any) any {
	for _, v := range values {
		if v != nil {
			return v
		}
	}
	return nil
}

// AmountMatches is xenditAmountMatches: the callback amount must equal the
// pending record's after rounding to whole rupiah; a missing or
// non-positive amount on either side never matches.
func AmountMatches(expected string, received float64) bool {
	want, got := jsmath.Round(StringNumber(expected)), jsmath.Round(received)
	if !finite(want) || !finite(got) || want <= 0 || got <= 0 {
		return false
	}
	return want == got
}

// PaidAction is what a paid QR callback settles (resolveXenditPaidWebhookAction).
type PaidAction string

const (
	ActionCreditTopup      PaidAction = "credit_topup"
	ActionNoopCheckout     PaidAction = "noop_checkout"
	ActionCompleteCheckout PaidAction = "complete_checkout"
	ActionCompleteOrder    PaidAction = "complete_order"
	ActionIgnore           PaidAction = "ignore"
)

// ResolvePaidAction is resolveXenditPaidWebhookAction: a pending top-up
// wins, then a central checkout (a no-op once its child orders exist),
// then a standalone order with its own QRIS.
func ResolvePaidAction(topupID, checkoutID string, childCount int, orderID string) PaidAction {
	switch {
	case topupID != "":
		return ActionCreditTopup
	case validate.JSTrim(checkoutID) != "" && childCount > 0:
		return ActionNoopCheckout
	case validate.JSTrim(checkoutID) != "":
		return ActionCompleteCheckout
	case validate.JSTrim(orderID) != "":
		return ActionCompleteOrder
	}
	return ActionIgnore
}
