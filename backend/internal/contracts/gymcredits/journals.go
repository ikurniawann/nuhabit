// Package gymcredits is the event contract of the gym credits context.
package gymcredits

// Journal events accounting subscribes to. Gym credits owns them: add
// fields, never repurpose them. Dates are YYYY-MM-DD, amounts rupiah.

// TopicJournal fires for every money or deferred revenue movement of a gym
// package: a sale or refund, credits used or given back at a class, credits
// expired, pass revenue released. Accounting posts EventCode from its
// journal mapping, keyed by DocumentID.
//
// Event codes and their lines:
//
//	GYM_SALE_CASH | _BANK | _QRIS | _ARK_COIN       debit CASH, BANK or WALLET, credit GYM_DEFERRED_REVENUE
//	GYM_REFUND_CASH | _BANK | _QRIS | _ARK_COIN     debit GYM_DEFERRED_REVENUE, credit CASH, BANK or WALLET
//	GYM_CREDIT_USAGE                                debit GYM_DEFERRED_REVENUE, credit GYM_CLASS_REVENUE
//	GYM_CREDIT_USAGE_REVERSAL                       debit GYM_CLASS_REVENUE, credit GYM_DEFERRED_REVENUE
//	GYM_CREDIT_BREAKAGE                             debit GYM_DEFERRED_REVENUE, credit GYM_BREAKAGE_REVENUE
//	GYM_PASS_REVENUE                                debit GYM_DEFERRED_REVENUE, credit GYM_PASS_REVENUE
//	GYM_PASS_REVENUE_REVERSAL                       debit GYM_PASS_REVENUE, credit GYM_DEFERRED_REVENUE
const TopicJournal = "gym.credits.journal"

// Journal is the TopicJournal payload.
type Journal struct {
	EventCode    string  `json:"event_code"`
	DocumentType string  `json:"document_type"`
	DocumentID   string  `json:"document_id"`
	CompanyID    *string `json:"company_id"`
	UserID       string  `json:"user_id"`
	EntryDate    string  `json:"entry_date"`
	Amount       float64 `json:"amount"`
	Description  string  `json:"description"`
}
