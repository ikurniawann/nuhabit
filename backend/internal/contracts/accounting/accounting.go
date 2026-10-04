// Package accounting holds the events the accounting module publishes.
package accounting

// TopicApPaymentVoided: a POSTED AP payment was voided. Procurement voids
// the linked purchasing.vendor_payments row (status 'void', voided_at,
// voided_by, void_reason, updated_at, updated_by; only when not already
// void) so the PO payment term is recalculated, as lib/purchasing/ap-void.ts
// did inline.
const TopicApPaymentVoided = "accounting.ap_payment.voided"

// ApPaymentVoided is the payload of TopicApPaymentVoided.
type ApPaymentVoided struct {
	PaymentID       string `json:"payment_id"`
	PaymentNo       string `json:"payment_no"`
	VendorPaymentID string `json:"vendor_payment_id"`
	UserID          string `json:"user_id"`
	Reason          string `json:"reason"`
}
