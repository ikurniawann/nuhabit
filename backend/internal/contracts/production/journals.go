// Package production is the event contract of the production context.
package production

// Journal events accounting subscribes to. Production owns them: add
// fields, never repurpose them. Dates are YYYY-MM-DD, amounts rupiah.

// TopicMaterialsIssued fires when materials leave stock for an order.
// Accounting posts PRODUCTION_MATERIAL_ISSUE (debit WIP, credit inventory).
const TopicMaterialsIssued = "production.materials.issued"

// MaterialsIssued is the TopicMaterialsIssued payload.
type MaterialsIssued struct {
	IssueID     string  `json:"issue_id"`
	IssueNumber string  `json:"issue_number"`
	OrderID     string  `json:"order_id"`
	OrderNumber string  `json:"order_number"`
	CompanyID   *string `json:"company_id"`
	UserID      string  `json:"user_id"`
	EntryDate   string  `json:"entry_date"`
	Total       float64 `json:"total"`
}

// TopicOutputReceived fires when a batch is received. Accounting posts
// PRODUCTION_CONVERSION_COST (debit WIP, credit applied overhead) for
// ConversionCost + AbnormalConversionCost, PRODUCTION_OUTPUT_RECEIPT (debit
// inventory, credit WIP) for MaterialCost + ConversionCost,
// PRODUCTION_SCRAP (debit COGS, credit WIP) for ScrapCost and
// PRODUCTION_ABNORMAL_SCRAP (debit production loss, credit WIP) for
// AbnormalScrapCost, each keyed by BatchID.
const TopicOutputReceived = "production.output.received"

// OutputReceived is the TopicOutputReceived payload.
type OutputReceived struct {
	BatchID        string  `json:"batch_id"`
	BatchNumber    string  `json:"batch_number"`
	OrderID        string  `json:"order_id"`
	OrderNumber    string  `json:"order_number"`
	CompanyID      *string `json:"company_id"`
	UserID         string  `json:"user_id"`
	EntryDate      string  `json:"entry_date"`
	MaterialCost   float64 `json:"material_cost"`
	ConversionCost float64 `json:"conversion_cost"`
	ScrapCost      float64 `json:"scrap_cost"`
	// AbnormalScrapCost is the scrap above the tolerance, material and
	// conversion; AbnormalConversionCost is its conversion part.
	AbnormalScrapCost      float64 `json:"abnormal_scrap_cost"`
	AbnormalConversionCost float64 `json:"abnormal_conversion_cost"`
}
