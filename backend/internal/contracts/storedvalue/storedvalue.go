// Package storedvalue is the event contract of the stored-value context
// (ARK Coin wallet, member bills, gift cards, promo).
package storedvalue

// Topics.
const (
	// TopicMemberNotified asks the member inbox to store and push one
	// notification (notifyMember in lib/crm/engagement/server.ts), written
	// by the wallet sweep: expired balance, expiry reminder, low balance.
	TopicMemberNotified = "wallet.member.notified"
	// TopicMemberBillPaid is one member bill instalment whose payment method
	// posts a deposit journal (postJournalFromMapping in
	// lib/pos/member-bill-server.ts recordMemberBillPayment).
	TopicMemberBillPaid = "wallet.member_bill.paid"
)

// MemberNotified is crm.member_notifications' row plus the push.
type MemberNotified struct {
	CustomerID string `json:"customer_id"`
	Type       string `json:"type"`
	Title      string `json:"title"`
	Body       string `json:"body"`
}

// MemberBillPaid carries postJournalFromMapping's input for an instalment.
type MemberBillPaid struct {
	PaymentID string  `json:"payment_id"`
	CompanyID *string `json:"company_id"`
	UserID    string  `json:"user_id"`
	// EventCode is POS_MEMBER_DEPOSIT_CASH, _QRIS or _CARD.
	EventCode    string  `json:"event_code"`
	DocumentType string  `json:"document_type"`
	EntryDate    string  `json:"entry_date"`
	AmountTotal  float64 `json:"amount_total"`
	Description  string  `json:"description"`
	SourceModule string  `json:"source_module"`
}
