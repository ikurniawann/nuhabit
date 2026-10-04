package accounting

import (
	"context"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Finance B2B invoices (lib/finance/invoices.ts): the cross-deal invoice
// list, detail, revision and deal payments. The rows live in the
// sales-funnel context (not in a porting wave) and are reached through the
// SalesFunnel port; access follows the parent deal (findAccessibleDeal).

// FinanceUser is the caller of a Finance route.
type FinanceUser struct {
	ID    string
	Role  string
	Scope domain.Scope
}

// hasCompanyScope is the sales-funnel fail-closed tenant check.
func (u FinanceUser) hasCompanyScope() bool {
	return u.Role == "super_admin" || (u.Scope.CompanyID != nil && *u.Scope.CompanyID != "")
}

// ScopeMissing is SCOPE_MISSING (requireSalesScope).
const ScopeMissing = "Scope bisnis user belum dikonfigurasi — hubungi admin"

// dealForbidden is findAccessibleDeal's forbidden flag (or a missing deal).
func (s *Service) dealForbidden(ctx context.Context, dealID string, u FinanceUser) (bool, error) {
	if !u.hasCompanyScope() {
		return true, nil
	}
	deal, err := s.ports.Sales.Deal(ctx, s.db, dealID)
	if err != nil {
		return false, err
	}
	if deal == nil {
		return true, nil
	}
	sc := u.Scope
	if sc.CompanyID != nil && deal.CompanyID != *sc.CompanyID {
		return true, nil
	}
	if sc.BusinessScope != nil && *sc.BusinessScope == "branch" && sc.BranchID != nil && *sc.BranchID != "" && deal.BranchID != *sc.BranchID {
		return true, nil
	}
	if u.Role == "sales" && deal.OwnerUserID != nil && *deal.OwnerUserID != u.ID {
		return true, nil
	}
	return false, nil
}

// assertInvoiceAccess: 404 without the invoice, 403 when its deal is out of reach.
func (s *Service) assertInvoiceAccess(ctx context.Context, found bool, dealID string, u FinanceUser) error {
	if !found {
		return httpx.NotFound("Invoice tidak ditemukan")
	}
	forbidden, err := s.dealForbidden(ctx, dealID, u)
	if err != nil {
		return err
	}
	if forbidden {
		return httpx.Forbidden("")
	}
	return nil
}

// FinanceInvoice is one listed Finance invoice.
type FinanceInvoice struct {
	ID            string        `json:"id"`
	InvoiceNumber string        `json:"invoice_number"`
	Label         *string       `json:"label"`
	Amount        float64       `json:"amount"`
	DueDate       *string       `json:"due_date"`
	Status        string        `json:"status"`
	SentAt        *httpx.JSTime `json:"sent_at"`
	Note          *string       `json:"note"`
	CreatedAt     httpx.JSTime  `json:"created_at"`
	DealID        string        `json:"deal_id"`
	DealTitle     *string       `json:"deal_title"`
	OrgName       *string       `json:"org_name"`
	PicName       *string       `json:"pic_name"`
	QuoteNumber   *string       `json:"quote_number"`
	CreatedByName *string       `json:"created_by_name"`
	Paid          float64       `json:"paid"`
	PaymentStatus string        `json:"payment_status"`
	Outstanding   float64       `json:"outstanding"`
}

// InvoiceStatuses is INVOICE_STATUSES.
var InvoiceStatuses = []string{"diajukan", "draft", "terkirim", "batal"}

// ListFinanceInvoices is GET /api/finance/invoices after requireSalesScope.
func (s *Service) ListFinanceInvoices(ctx context.Context, u FinanceUser, status, q string) ([]FinanceInvoice, error) {
	if !u.hasCompanyScope() {
		return nil, httpx.Forbidden(ScopeMissing)
	}
	f := FinanceInvoiceFilter{CompanyID: u.Scope.CompanyID, Q: q}
	if u.Scope.BusinessScope != nil && *u.Scope.BusinessScope == "branch" && u.Scope.BranchID != nil && *u.Scope.BranchID != "" {
		f.BranchID = u.Scope.BranchID
	}
	for _, st := range InvoiceStatuses {
		if st == status {
			f.Status = status
		}
	}
	rows, err := s.ports.Sales.FinanceInvoices(ctx, s.db, f)
	if err != nil {
		return nil, err
	}
	out := make([]FinanceInvoice, len(rows))
	for i, r := range rows {
		amount, paid := domain.ParseNumber(r.Amount), domain.ParseNumber(r.Paid)
		ps, outstanding := domain.InvoicePaymentSummary(amount, paid)
		out[i] = FinanceInvoice{ID: r.ID, InvoiceNumber: r.InvoiceNumber, Label: r.Label, Amount: amount, DueDate: r.DueDate,
			Status: r.Status, SentAt: httpx.NewJSTime(r.SentAt), Note: r.Note, CreatedAt: httpx.JSTime(r.CreatedAt), DealID: r.DealID,
			DealTitle: r.DealTitle, OrgName: r.OrgName, PicName: r.PicName, QuoteNumber: r.QuoteNumber, CreatedByName: r.CreatedByName,
			Paid: paid, PaymentStatus: ps, Outstanding: outstanding}
	}
	return out, nil
}

// QuotationRef is the invoice's quotation.
type QuotationRef struct {
	ID          string  `json:"id"`
	QuoteNumber *string `json:"quote_number"`
	Status      *string `json:"status"`
	Total       float64 `json:"total"`
	UsePpn      *bool   `json:"use_ppn"`
	PpnPersen   float64 `json:"ppn_persen"`
}

// TermRef is the invoice's quotation term.
type TermRef struct {
	ID      string  `json:"id"`
	Label   *string `json:"label"`
	Percent float64 `json:"percent"`
	DueDate *string `json:"due_date"`
}

// FinanceInvoiceDetail is getFinanceInvoiceDetail's data.
type FinanceInvoiceDetail struct {
	ID             string        `json:"id"`
	InvoiceNumber  string        `json:"invoice_number"`
	Label          *string       `json:"label"`
	Amount         float64       `json:"amount"`
	DueDate        *string       `json:"due_date"`
	Status         string        `json:"status"`
	SentAt         *httpx.JSTime `json:"sent_at"`
	Note           *string       `json:"note"`
	CreatedAt      httpx.JSTime  `json:"created_at"`
	CreatedByName  *string       `json:"created_by_name"`
	DealID         string        `json:"deal_id"`
	DealTitle      *string       `json:"deal_title"`
	EventType      *string       `json:"event_type"`
	EventDate      *string       `json:"event_date"`
	OrgName        *string       `json:"org_name"`
	PicName        *string       `json:"pic_name"`
	PicPhone       *string       `json:"pic_phone"`
	PicTitle       *string       `json:"pic_title"`
	HasFakturPajak bool          `json:"has_faktur_pajak"`
	Quotation      *QuotationRef `json:"quotation"`
	Term           *TermRef      `json:"term"`
	Paid           float64       `json:"paid"`
	PaymentStatus  string        `json:"payment_status"`
	Outstanding    float64       `json:"outstanding"`
}

func numOrZero(s *string) float64 {
	if s == nil {
		return 0
	}
	return domain.ParseNumber(*s)
}

// FinanceInvoiceDetail is getFinanceInvoiceDetail.
func (s *Service) FinanceInvoiceDetail(ctx context.Context, id string, u FinanceUser) (*FinanceInvoiceDetail, error) {
	r, err := s.ports.Sales.FinanceInvoice(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	dealID := ""
	if r != nil {
		dealID = r.DealID
	}
	if err := s.assertInvoiceAccess(ctx, r != nil, dealID, u); err != nil {
		return nil, err
	}
	amount, paid := domain.ParseNumber(r.Amount), domain.ParseNumber(r.Paid)
	ps, outstanding := domain.InvoicePaymentSummary(amount, paid)
	d := &FinanceInvoiceDetail{ID: r.ID, InvoiceNumber: r.InvoiceNumber, Label: r.Label, Amount: amount, DueDate: r.DueDate,
		Status: r.Status, SentAt: httpx.NewJSTime(r.SentAt), Note: r.Note, CreatedAt: httpx.JSTime(r.CreatedAt),
		CreatedByName: r.CreatedByName, DealID: r.DealID, DealTitle: r.DealTitle, EventType: r.EventType, EventDate: r.EventDate,
		OrgName: r.OrgName, PicName: r.PicName, PicPhone: r.PicPhone, PicTitle: r.PicTitle, HasFakturPajak: r.FakturPajakURL != nil,
		Paid: paid, PaymentStatus: ps, Outstanding: outstanding}
	if r.QuotationID != nil && *r.QuotationID != "" {
		d.Quotation = &QuotationRef{ID: *r.QuotationID, QuoteNumber: r.QuoteNumber, Status: r.QuotationStatus,
			Total: numOrZero(r.QuotationTotal), UsePpn: r.QuotationUsePpn, PpnPersen: numOrZero(r.QuotationPpnPersen)}
	}
	if r.TermID != nil && *r.TermID != "" {
		d.Term = &TermRef{ID: *r.TermID, Label: r.TermLabel, Percent: numOrZero(r.TermPercent), DueDate: r.TermDueDate}
	}
	return d, nil
}

const alreadyCancelled = "Invoice sudah dibatalkan — tidak bisa direvisi"

// ReviseFinanceInvoice is reviseFinanceInvoice: refused once cancelled or paid.
func (s *Service) ReviseFinanceInvoice(ctx context.Context, id string, u FinanceUser, label string, amount float64, dueDate, note *string) (*RevisedInvoice, error) {
	dealID, status, paid, err := s.ports.Sales.InvoiceDeal(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if err := s.assertInvoiceAccess(ctx, dealID != "", dealID, u); err != nil {
		return nil, err
	}
	if status == "batal" {
		return nil, httpx.Conflict(alreadyCancelled)
	}
	if paid > 0 {
		return nil, httpx.Conflict("Invoice sudah menerima pembayaran — tidak bisa direvisi")
	}
	row, err := s.ports.Sales.ReviseInvoice(ctx, s.db, id, label, domain.MathRound(float64(amount*100))/100, strOrNull(dueDate), strOrNull(note))
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, httpx.Conflict(alreadyCancelled)
	}
	return row, nil
}

// InvoicePayment is one listed deal payment (amount is the numeric string).
type InvoicePayment struct {
	ID            string       `json:"id"`
	Amount        string       `json:"amount"`
	Method        *string      `json:"method"`
	PaidOn        *string      `json:"paid_on"`
	Note          *string      `json:"note"`
	CreatedByName *string      `json:"created_by_name"`
	CreatedAt     httpx.JSTime `json:"created_at"`
}

// InvoicePayments is listInvoicePayments.
func (s *Service) InvoicePayments(ctx context.Context, id string, u FinanceUser) ([]InvoicePayment, error) {
	dealID, _, _, err := s.ports.Sales.InvoiceDeal(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if err := s.assertInvoiceAccess(ctx, dealID != "", dealID, u); err != nil {
		return nil, err
	}
	rows, err := s.ports.Sales.InvoicePayments(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	out := make([]InvoicePayment, len(rows))
	for i, r := range rows {
		out[i] = InvoicePayment{ID: r.ID, Amount: r.Amount, Method: r.Method, PaidOn: r.PaidOn, Note: r.Note,
			CreatedByName: r.CreatedByName, CreatedAt: httpx.JSTime(r.CreatedAt)}
	}
	return out, nil
}

// DeleteDealPayment is softDeleteDealPayment.
func (s *Service) DeleteDealPayment(ctx context.Context, paymentID string, u FinanceUser) error {
	dealID, err := s.ports.Sales.DealPaymentDeal(ctx, s.db, paymentID)
	if err != nil {
		return err
	}
	if dealID == "" {
		return httpx.NotFound("Catatan pembayaran tidak ditemukan")
	}
	forbidden, err := s.dealForbidden(ctx, dealID, u)
	if err != nil {
		return err
	}
	if forbidden {
		return httpx.Forbidden("")
	}
	return s.ports.Sales.SoftDeleteDealPayment(ctx, s.db, paymentID, u.ID)
}
