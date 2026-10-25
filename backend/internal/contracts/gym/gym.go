// Package gym is the event contract of the gym contexts (scheduling and
// credits).
package gym

// TopicMemberNotified is a gym notification that the publisher already
// stored in the member inbox (crm.member_notifications, same transaction).
// The CRM subscriber delivers it outside the app: web push to the member's
// devices, and WhatsApp or email where the member has not opted out.
const TopicMemberNotified = "gym.member.notified"

// MemberNotified is the inbox row's content.
type MemberNotified struct {
	CustomerID string `json:"customer_id"`
	Type       string `json:"type"`
	Title      string `json:"title"`
	Body       string `json:"body"`
}

// TopicCommissionJournal fires when coach revenue-share commission moves
// money in the books: a statement approved (the accrual) or a coach's line
// paid. Accounting posts EventCode from its journal mapping, keyed by
// DocumentID. Dates are YYYY-MM-DD, amounts rupiah.
//
//	GYM_COMMISSION_ACCRUAL        debit GYM_COMMISSION_EXPENSE, credit GYM_COMMISSION_PAYABLE
//	GYM_COMMISSION_PAYROLL        debit GYM_COMMISSION_PAYABLE, credit GYM_COMMISSION_EXPENSE
//	GYM_COMMISSION_PAYMENT_CASH   debit GYM_COMMISSION_PAYABLE, credit CASH
//	GYM_COMMISSION_PAYMENT_BANK   debit GYM_COMMISSION_PAYABLE, credit BANK
//
// GYM_COMMISSION_PAYROLL hands a line to payroll, whose run books it again
// as salary expense.
const TopicCommissionJournal = "gym.commission.journal"

// CommissionJournal is the TopicCommissionJournal payload.
type CommissionJournal struct {
	EventCode    string  `json:"event_code"`
	DocumentType string  `json:"document_type"`
	DocumentID   string  `json:"document_id"`
	CompanyID    *string `json:"company_id"`
	UserID       string  `json:"user_id"`
	EntryDate    string  `json:"entry_date"`
	Amount       float64 `json:"amount"`
	Description  string  `json:"description"`
}
