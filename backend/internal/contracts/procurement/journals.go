package procurement

// Journal events accounting subscribes to. Created by the accounting agent as
// the subscriber (ERP brief rule 3) from what the TS passes to
// lib/purchasing/accounting-posting.ts; procurement owns them from here on:
// add fields, never repurpose them.

// TopicGrnPosted fires when a GRN's received value is booked: after QC
// (submitGrnQcInspection in lib/purchasing/grn-qc.ts) or, for general
// receipts not rejected, on create (createGrn in lib/purchasing/grn-create.ts).
// Accounting posts PURCHASE_GRN, creates the GRN's AP invoice and posts
// PURCHASE_AP_INVOICE (postGrnAccountingJournals). Idempotent per GRN.
const TopicGrnPosted = "procurement.grn.posted"

// GrnPosted is the TopicGrnPosted payload.
type GrnPosted struct {
	GrnID  string `json:"grn_id"`
	UserID string `json:"user_id"`
}

// TopicPurchaseReturnApproved fires when a purchase return is approved
// (approvePurchaseReturn in lib/purchasing/purchase-return-service.ts).
// Accounting posts PURCHASE_RETURN (postReturnAccountingJournal).
const TopicPurchaseReturnApproved = "procurement.purchase_return.approved"

// PurchaseReturnApproved is the TopicPurchaseReturnApproved payload.
type PurchaseReturnApproved struct {
	ReturnID     string  `json:"return_id"`
	ReturnNumber string  `json:"return_number"`
	ReturnDate   string  `json:"return_date"` // YYYY-MM-DD (today when the return has none)
	CompanyID    *string `json:"company_id"`
	UserID       string  `json:"user_id"`
	// TotalAmount is Σ qty_returned × unit_cost of the return items.
	TotalAmount float64 `json:"total_amount"`
}
