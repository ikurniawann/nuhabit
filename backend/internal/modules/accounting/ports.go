package accounting

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
)

// Ports are what accounting reads or writes in other bounded contexts.
// internal/app/adapters_accounting.go implements them with the SQL the TS
// stores ran; each moves to its owning module's service when that exists.
type Ports struct {
	Audit      AuditLog
	Purchasing Purchasing
	PosOrders  PosOrders
	Materials  Materials
	Sales      SalesFunnel
}

// AuditEntry is one audit.audit_log row (lib/audit recordAudit).
type AuditEntry struct {
	ActorID     string
	ActorName   string
	Action      string
	Entity      string
	EntityID    string
	EntityLabel string
	Before      any
	After       any
	Reason      string
	IP          *string
	UserAgent   *string
}

// AuditLog writes the platform audit trail on the caller's querier, so the
// row commits or rolls back with the action.
type AuditLog interface {
	Record(ctx context.Context, q database.Querier, e AuditEntry) error
}

/* ── Procurement ─────────────────────────────────────────────────────── */

// GrnPosting is what the GRN journal and the AP invoice need from a GRN
// (buildGrnAccountingAmounts + createApInvoiceFromGrn).
type GrnPosting struct {
	GrnID           string
	GrnNumber       string  // nomor_grn, or the id
	CompanyID       *string // grn.company_id, else the PO's
	EntryDate       string  // tanggal_penerimaan (YYYY-MM-DD), else today
	PurchaseOrderID *string
	VendorID        *string // GRN party, else the PO's
	SupplierID      *string
	DueDate         *string // PO tanggal_kirim_estimasi, else tanggal_dibutuhkan
	Lines           []domain.GrnLine
	PpnPercent      float64
}

// VendorPaymentInput is the purchasing.vendor_payments row an AP payment
// against a PO creates.
type VendorPaymentInput struct {
	PurchaseOrderID string
	PaymentNo       string // the AP payment number (APP-…); the vendor payment is VP-…
	PaymentDate     string
	Amount          float64
	Method          string
	ReferenceNumber *string
	Notes           *string
	UserID          string
}

// Purchasing reads GRNs and records vendor payments for AP payments.
type Purchasing interface {
	// GrnPosting returns nil when the GRN does not exist.
	GrnPosting(ctx context.Context, q database.Querier, grnID string) (*GrnPosting, error)
	// RecordVendorPayment mirrors recordApPayment's PO branch: resolve the
	// payable context and payment term, insert the posted vendor payment and
	// recalculate the term. It returns "" when the PO does not exist. It runs
	// on the caller's transaction because the response carries the id.
	RecordVendorPayment(ctx context.Context, q database.Querier, in VendorPaymentInput) (string, error)
}

/* ── POS ─────────────────────────────────────────────────────────────── */

// PosSale is an order as buildPosAccountingAmounts reads it.
type PosSale struct {
	OrderNumber   string
	CompanyID     *string
	EntryDate     string // ordered_at as a Jakarta calendar date
	PaymentMethod *string
	Subtotal      float64
	Discount      float64
	Tax           float64
	ServiceCharge float64
	OtherCharges  float64
	Total         float64
	AmountPaid    float64
	Cogs          float64 // Σ max(0, pos_order_items.cost_total)
}

// PosOrders reads POS orders for sale journals.
type PosOrders interface {
	// SaleSnapshot returns nil when the order does not exist.
	SaleSnapshot(ctx context.Context, q database.Querier, orderID string) (*PosSale, error)
}

/* ── Inventory ───────────────────────────────────────────────────────── */

// Material is a raw material's company, inventory COA code and name.
type Material struct {
	CompanyID *string
	CoaAsset  *string
	Nama      string
}

// Materials reads item.raw_materials for stock journals.
type Materials interface {
	Materials(ctx context.Context, q database.Querier, ids []string) (map[string]Material, error)
}

/* ── Sales funnel (B2B invoices; not in a porting wave) ──────────────── */

// SalesInvoiceSource is a crm_sales_invoices row with its deal and lead, as
// createArInvoiceFromSalesInvoice reads it.
type SalesInvoiceSource struct {
	ID            string
	CompanyID     string
	BranchID      *string
	InvoiceNumber string
	Amount        float64
	DueDate       *string
	DealID        string
	SentAt        *string // String(sent_at).slice(0, 10) as the TS computes it
	Status        string
	OrgName       *string
	DealTitle     *string
}

// DealPaymentInput is the crm_sales_deal_payments row an AR receipt writes.
type DealPaymentInput struct {
	CompanyID      string
	BranchID       *string
	DealID         string
	SalesInvoiceID string
	Amount         float64
	Method         string
	PaidOn         string
	Note           string
	UserID         string
}

// AccessibleDeal is the sales-funnel deal access row.
type AccessibleDeal struct {
	CompanyID   string
	BranchID    string
	OwnerUserID *string
}

// FinanceInvoiceFilter filters the Finance invoice list.
type FinanceInvoiceFilter struct {
	CompanyID *string
	BranchID  *string
	Status    string // "" = all
	Q         string
}

// FinanceInvoiceRow is one listFinanceInvoices row as PostgreSQL returns it.
type FinanceInvoiceRow struct {
	ID            string
	InvoiceNumber string
	Label         *string
	Amount        string
	DueDate       *string
	Status        string
	SentAt        *time.Time
	Note          *string
	CreatedAt     time.Time
	DealID        string
	DealTitle     *string
	OrgName       *string
	PicName       *string
	QuoteNumber   *string
	CreatedByName *string
	Paid          string
}

// FinanceInvoiceDetailRow is getFinanceInvoiceDetail's row.
type FinanceInvoiceDetailRow struct {
	ID                 string
	InvoiceNumber      string
	Label              *string
	Amount             string
	DueDate            *string
	Status             string
	SentAt             *time.Time
	Note               *string
	FakturPajakURL     *string
	CreatedAt          time.Time
	CreatedByName      *string
	DealID             string
	DealTitle          *string
	EventType          *string
	EventDate          *string
	OrgName            *string
	PicName            *string
	PicPhone           *string
	PicTitle           *string
	QuotationID        *string
	QuoteNumber        *string
	QuotationStatus    *string
	QuotationTotal     *string
	QuotationUsePpn    *bool
	QuotationPpnPersen *string
	TermID             *string
	TermLabel          *string
	TermPercent        *string
	TermDueDate        *string
	Paid               string
}

// RevisedInvoice is the revise route's data.
type RevisedInvoice struct {
	ID            string `json:"id"`
	InvoiceNumber string `json:"invoice_number"`
}

// InvoicePaymentRow is one deal payment of an invoice (amount stays the
// numeric string node-pg returns).
type InvoicePaymentRow struct {
	ID            string
	Amount        string
	Method        *string
	PaidOn        *string
	Note          *string
	CreatedByName *string
	CreatedAt     time.Time
}

// SalesFunnel is the sales-funnel side of AR and the Finance API.
type SalesFunnel interface {
	// SalesInvoice returns nil when the invoice is missing or deleted.
	SalesInvoice(ctx context.Context, q database.Querier, id string) (*SalesInvoiceSource, error)
	// UnsyncedSentInvoices lists sent invoices of a company without an AR row.
	UnsyncedSentInvoices(ctx context.Context, q database.Querier, companyID string, limit int) ([]string, error)
	// RecordDealPayment inserts a deal payment and returns its id.
	RecordDealPayment(ctx context.Context, q database.Querier, in DealPaymentInput) (string, error)

	// Deal returns nil when the deal is missing or deleted.
	Deal(ctx context.Context, q database.Querier, id string) (*AccessibleDeal, error)
	FinanceInvoices(ctx context.Context, q database.Querier, f FinanceInvoiceFilter) ([]FinanceInvoiceRow, error)
	FinanceInvoice(ctx context.Context, q database.Querier, id string) (*FinanceInvoiceDetailRow, error)
	// InvoiceDeal returns the deal id and paid total of a live invoice ("" when missing).
	InvoiceDeal(ctx context.Context, q database.Querier, id string) (dealID, status string, paid float64, err error)
	ReviseInvoice(ctx context.Context, q database.Querier, id, label string, amount float64, dueDate, note *string) (*RevisedInvoice, error)
	InvoicePayments(ctx context.Context, q database.Querier, invoiceID string) ([]InvoicePaymentRow, error)
	// DealPaymentDeal returns the deal of a live deal payment ("" when missing).
	DealPaymentDeal(ctx context.Context, q database.Querier, paymentID string) (string, error)
	SoftDeleteDealPayment(ctx context.Context, q database.Querier, paymentID, userID string) error
}
