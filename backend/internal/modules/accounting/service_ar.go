package accounting

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Accounts receivable: AR invoices synced from sent B2B (sales-funnel)
// invoices, receipts with allocations, the receivable register and aging
// (ar-store.ts, ar-posting.ts).

// ArInvoice is ArInvoiceRow (dates in the TS "Sun Aug 09" form, see ApInvoice).
type ArInvoice struct {
	ID                string  `json:"id"`
	CompanyID         *string `json:"company_id"`
	InvoiceNo         string  `json:"invoice_no"`
	InvoiceDate       string  `json:"invoice_date"`
	DueDate           *string `json:"due_date"`
	CustomerName      *string `json:"customer_name"`
	SalesInvoiceID    *string `json:"sales_invoice_id"`
	DealID            *string `json:"deal_id"`
	Currency          string  `json:"currency"`
	Subtotal          float64 `json:"subtotal"`
	TaxAmount         float64 `json:"tax_amount"`
	TotalAmount       float64 `json:"total_amount"`
	Status            string  `json:"status"`
	Description       *string `json:"description"`
	PostedAt          *ts     `json:"posted_at"`
	PostedBy          *string `json:"posted_by"`
	CreatedAt         ts      `json:"created_at"`
	AllocatedAmount   float64 `json:"allocated_amount"`
	OutstandingAmount float64 `json:"outstanding_amount"`
	PaymentStatus     string  `json:"payment_status"`
	DealTitle         *string `json:"deal_title"`
}

type arInvoiceRow struct {
	ID             string
	CompanyID      *string
	InvoiceNo      string
	InvoiceDate    jsDate
	DueDate        *jsDate
	CustomerName   *string
	SalesInvoiceID *string
	DealID         *string
	Currency       string
	Subtotal       string
	TaxAmount      string
	TotalAmount    string
	Status         string
	Description    *string
	PostedAt       *ts
	PostedBy       *string
	CreatedAt      ts
	Allocated      string
	DealTitle      *string
	Total          int
}

// The deal title is a cross-context read of sales-funnel deals, joined as
// in the TS so search and paging stay in SQL.
const arInvoiceSelect = `SELECT i.id::text, i.company_id::text, i.invoice_no, i.invoice_date, i.due_date, i.customer_name,
       i.sales_invoice_id::text, i.deal_id::text, i.currency, i.subtotal::text, i.tax_amount::text, i.total_amount::text,
       i.status, i.description, i.posted_at, i.posted_by::text, i.created_at,
       COALESCE(alloc.allocated, 0)::text, d.title AS deal_title`

const arInvoiceFrom = `
  FROM accounting.ar_invoices i
  LEFT JOIN crm.crm_sales_deals d ON d.id = i.deal_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(a.amount), 0) AS allocated
      FROM accounting.ar_receipt_allocations a
      JOIN accounting.ar_receipts r ON r.id = a.receipt_id
     WHERE a.invoice_id = i.id AND r.deleted_at IS NULL AND r.status = 'POSTED'
  ) alloc ON true`

func (s *Service) mapArInvoice(r arInvoiceRow) ArInvoice {
	total := domain.ToNumber(r.TotalAmount)
	allocated := domain.ToNumber(r.Allocated)
	var due *string
	if r.DueDate != nil {
		due = strp(string(*r.DueDate))
	}
	currency := r.Currency
	if currency == "" {
		currency = "IDR"
	}
	return ArInvoice{ID: r.ID, CompanyID: r.CompanyID, InvoiceNo: r.InvoiceNo, InvoiceDate: string(r.InvoiceDate), DueDate: due,
		CustomerName: r.CustomerName, SalesInvoiceID: r.SalesInvoiceID, DealID: r.DealID, Currency: currency,
		Subtotal: domain.ToNumber(r.Subtotal), TaxAmount: domain.ToNumber(r.TaxAmount), TotalAmount: total, Status: r.Status,
		Description: r.Description, PostedAt: r.PostedAt, PostedBy: r.PostedBy, CreatedAt: r.CreatedAt,
		AllocatedAmount: allocated, OutstandingAmount: domain.InvoiceOutstanding(total, allocated),
		PaymentStatus: domain.PaymentStatus(total, allocated, due, s.today()), DealTitle: r.DealTitle}
}

func (s *Service) arInvoiceWhere(ctx context.Context, q database.Querier, where string, args ...any) (*ArInvoice, error) {
	row, err := one[arInvoiceRow](ctx, q, arInvoiceSelect+`, 0`+arInvoiceFrom+` WHERE `+where, args...)
	if err != nil || row == nil {
		return nil, err
	}
	inv := s.mapArInvoice(*row)
	return &inv, nil
}

// ArInvoiceBySalesInvoice is getArInvoiceBySalesInvoiceId.
func (s *Service) ArInvoiceBySalesInvoice(ctx context.Context, salesInvoiceID string) (*ArInvoice, error) {
	return s.arInvoiceWhere(ctx, s.db, `i.sales_invoice_id = $1 AND i.deleted_at IS NULL`, salesInvoiceID)
}

// ListArInvoices is listArInvoices.
func (s *Service) ListArInvoices(ctx context.Context, f InvoiceListFilter) ([]ArInvoice, int, error) {
	args := []any{}
	where := []string{"i.deleted_at IS NULL"}
	if f.CompanyID != "" {
		args = append(args, f.CompanyID)
		where = append(where, "i.company_id = $"+itoa(len(args)))
	}
	if f.Status != "" {
		args = append(args, f.Status)
		where = append(where, "i.status = $"+itoa(len(args)))
	}
	if t := jsTrim(f.Search); t != "" {
		args = append(args, "%"+t+"%")
		n := "$" + itoa(len(args))
		where = append(where, "(i.invoice_no ILIKE "+n+" OR COALESCE(i.customer_name,'') ILIKE "+n+" OR COALESCE(d.title,'') ILIKE "+n+")")
	}
	page, args := pageArgs(args, f.Limit, f.Offset)
	rows, err := collect[arInvoiceRow](ctx, s.db, arInvoiceSelect+`, COUNT(*) OVER()::int`+arInvoiceFrom+`
 WHERE `+strings.Join(where, " AND ")+`
 ORDER BY i.invoice_date DESC, i.created_at DESC`+page, args...)
	if err != nil {
		return nil, 0, err
	}
	out := []ArInvoice{}
	for _, r := range rows {
		inv := s.mapArInvoice(r)
		if f.PaymentStatus != "" && f.PaymentStatus != "all" && inv.PaymentStatus != f.PaymentStatus {
			continue
		}
		out = append(out, inv)
	}
	if f.PaymentStatus != "" && f.PaymentStatus != "all" {
		return out, len(out), nil
	}
	if len(rows) > 0 {
		return out, rows[0].Total, nil
	}
	return out, len(out), nil
}

// ArReceivable is listArReceivable.
func (s *Service) ArReceivable(ctx context.Context, companyID string) ([]ArInvoice, error) {
	rows, _, err := s.ListArInvoices(ctx, InvoiceListFilter{CompanyID: companyID, Status: domain.StatusPosted, Limit: 100})
	if err != nil {
		return nil, err
	}
	out := []ArInvoice{}
	for _, r := range rows {
		if r.OutstandingAmount > 0.009 {
			out = append(out, r)
		}
	}
	return out, nil
}

// ArAging is listArAging's result.
type ArAging struct {
	AsOf     string        `json:"asOf"`
	Buckets  []AgingBucket `json:"buckets"`
	Invoices []ArInvoice   `json:"invoices"`
}

// ArAging is listArAging.
func (s *Service) ArAging(ctx context.Context, companyID, asOf string) (*ArAging, error) {
	if asOf == "" {
		asOf = s.today()
	}
	open, err := s.ArReceivable(ctx, companyID)
	if err != nil {
		return nil, err
	}
	outstanding := make([]float64, len(open))
	due := make([]*string, len(open))
	for i, inv := range open {
		outstanding[i], due[i] = inv.OutstandingAmount, inv.DueDate
	}
	return &ArAging{AsOf: asOf, Buckets: agingBuckets(asOf, outstanding, due), Invoices: open}, nil
}

// CreateArFromSalesInvoice is createArInvoiceFromSalesInvoice: one POSTED
// AR invoice per B2B invoice, then SALE_AR_INVOICE. Both dates keep the TS
// String(date).slice(0, 10) form ("Sun Aug 09"), which PostgreSQL rejects:
// a sent invoice (sent_at set) fails on insert, and a ready SALE_AR_INVOICE
// mapping fails the journal after the invoice is stored, as in the TS.
func (s *Service) CreateArFromSalesInvoice(ctx context.Context, db database.DB, salesInvoiceID, userID string) (*ArInvoice, error) {
	existing, err := s.arInvoiceWhere(ctx, db, `i.sales_invoice_id = $1 AND i.deleted_at IS NULL`, salesInvoiceID)
	if err != nil || existing != nil {
		return existing, err
	}
	src, err := s.ports.Sales.SalesInvoice(ctx, db, salesInvoiceID)
	if err != nil {
		return nil, err
	}
	if src == nil {
		return nil, httpx.NotFound("Sales invoice tidak ditemukan")
	}
	if src.Status == "batal" {
		return nil, httpx.BadRequest("Invoice batal — tidak membuat AR")
	}
	total := domain.Round2(src.Amount)
	if total <= 0 {
		return nil, httpx.BadRequest("Nilai invoice 0")
	}
	invoiceDate := s.today()
	if src.SentAt != nil {
		invoiceDate = *src.SentAt
	}
	customer := "Customer"
	switch {
	case src.OrgName != nil && *src.OrgName != "":
		customer = *src.OrgName
	case src.DealTitle != nil && *src.DealTitle != "":
		customer = *src.DealTitle
	}
	var row *arInvoiceRow
	err = database.WithTx(ctx, db, func(tx pgx.Tx) error {
		invoiceNo, err := s.nextDailyNo(ctx, tx, "ar_invoices", "invoice_no", "AR", true)
		if err != nil {
			return err
		}
		// RETURNING * has no deal title; the TS maps it with allocated 0.
		row, err = one[arInvoiceRow](ctx, tx, `
INSERT INTO accounting.ar_invoices (
  company_id, invoice_no, invoice_date, due_date, customer_name, sales_invoice_id, deal_id, currency,
  subtotal, tax_amount, total_amount, status, description, posted_at, posted_by, created_by, updated_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,'IDR',$8,0,$8,'POSTED',$9,$10,$11,$11,$11)
RETURNING id::text, company_id::text, invoice_no, invoice_date, due_date, customer_name, sales_invoice_id::text,
          deal_id::text, currency, subtotal::text, tax_amount::text, total_amount::text, status, description,
          posted_at, posted_by::text, created_at, '0', NULL::text, 0`,
			src.CompanyID, invoiceNo, invoiceDate, src.DueDate, customer, src.ID, src.DealID, total,
			"AR dari B2B "+src.InvoiceNumber, s.now(), userID)
		return err
	})
	if err != nil {
		return nil, err
	}
	invoice := s.mapArInvoice(*row)
	amounts := domain.Amounts{"SUBTOTAL": invoice.Subtotal, "TAX": invoice.TaxAmount, "TOTAL": invoice.TotalAmount}
	if amounts["TOTAL"] > 0 {
		if _, err := PostFromMapping(ctx, db, MappingPost{CompanyID: &src.CompanyID, UserID: userID, EventCode: "SALE_AR_INVOICE",
			DocumentType: "ar_invoice", DocumentID: invoice.ID, EntryDate: invoice.InvoiceDate, Amounts: amounts,
			Description: "B2B " + src.InvoiceNumber + " / " + invoice.InvoiceNo + " — piutang", SourceModule: "SALES"}); err != nil {
			return nil, err
		}
	}
	return &invoice, nil
}

// SyncArFromSales is syncArFromOpenSalesInvoices: lazily create AR rows for
// sent B2B invoices, skipping individual failures (each write commits on its
// own, like the TS autocommit calls).
func (s *Service) SyncArFromSales(ctx context.Context, companyID, userID string, limit int) error {
	ids, err := s.ports.Sales.UnsyncedSentInvoices(ctx, s.db, companyID, limit)
	if err != nil {
		return err
	}
	for _, id := range ids {
		_, _ = s.CreateArFromSalesInvoice(ctx, s.db, id, userID)
	}
	return nil
}

// ArReceipt is ArReceiptRow.
type ArReceipt struct {
	ID              string   `json:"id"`
	CompanyID       *string  `json:"company_id"`
	ReceiptNo       string   `json:"receipt_no"`
	ReceiptDate     string   `json:"receipt_date"`
	Amount          float64  `json:"amount"`
	Method          string   `json:"method"`
	ReferenceNumber *string  `json:"reference_number"`
	Notes           *string  `json:"notes"`
	Status          string   `json:"status"`
	DealPaymentID   *string  `json:"deal_payment_id"`
	PostedAt        any      `json:"posted_at"`
	PostedBy        *string  `json:"posted_by"`
	CreatedAt       ts       `json:"created_at"`
	CustomerName    *string  `json:"customer_name"`
	InvoiceNos      []string `json:"invoice_nos"`
}

// ArReceiptInput is POST /ar/receipts.
type ArReceiptInput struct {
	UserID, InvoiceID      string
	Amount                 float64
	ReceiptDate, Method    *string
	ReferenceNumber, Notes *string
}

// ArReceiptResult is recordArReceipt's result.
type ArReceiptResult struct {
	Receipt ArReceipt
	Invoice ArInvoice
	Note    string
}

// RecordArReceipt is recordArReceipt: the deal payment (B2B invoices), the
// receipt and its allocation commit together; SALE_AR_RECEIPT posts after.
func (s *Service) RecordArReceipt(ctx context.Context, in ArReceiptInput) (*ArReceiptResult, error) {
	invoice, err := s.arInvoiceWhere(ctx, s.db, `i.id = $1 AND i.deleted_at IS NULL`, in.InvoiceID)
	if err != nil {
		return nil, err
	}
	if invoice == nil {
		return nil, httpx.NotFound("AR invoice tidak ditemukan")
	}
	if invoice.Status != domain.StatusPosted {
		return nil, httpx.BadRequest("Hanya invoice POSTED yang bisa diterima")
	}
	amount := domain.Round2(in.Amount)
	if amount <= 0 {
		return nil, httpx.BadRequest("Amount harus > 0")
	}
	if amount > invoice.OutstandingAmount+0.01 {
		return nil, httpx.BadRequest("Amount tidak boleh melebihi outstanding")
	}
	receiptDate := s.today()
	if in.ReceiptDate != nil && *in.ReceiptDate != "" {
		receiptDate = *in.ReceiptDate
	}
	method := "transfer"
	if in.Method != nil && *in.Method != "" {
		method = *in.Method
	}
	now := s.now()
	var receiptNo, receiptID string
	var dealPaymentID *string
	var createdAt time.Time
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		no, err := s.nextDailyNo(ctx, tx, "ar_receipts", "receipt_no", "ARR", true)
		if err != nil {
			return err
		}
		receiptNo = no
		if invoice.SalesInvoiceID != nil && invoice.DealID != nil {
			src, err := s.ports.Sales.SalesInvoice(ctx, tx, *invoice.SalesInvoiceID)
			if err != nil {
				return err
			}
			if src != nil {
				note := "via Accounting AR " + receiptNo
				if n := strOrNull(in.Notes); n != nil {
					note = *n + " (via Accounting AR " + receiptNo + ")"
				}
				// Port in the same transaction: the response returns deal_payment_id.
				id, err := s.ports.Sales.RecordDealPayment(ctx, tx, DealPaymentInput{CompanyID: src.CompanyID, BranchID: src.BranchID,
					DealID: src.DealID, SalesInvoiceID: *invoice.SalesInvoiceID, Amount: amount, Method: method, PaidOn: receiptDate,
					Note: note, UserID: in.UserID})
				if err != nil {
					return err
				}
				if id != "" {
					dealPaymentID = &id
				}
			}
		}
		if err := tx.QueryRow(ctx, `
INSERT INTO accounting.ar_receipts (
  company_id, receipt_no, receipt_date, amount, method, reference_number, notes, status, deal_payment_id,
  posted_at, posted_by, created_by, updated_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,'POSTED',$8,$9,$10,$10,$10) RETURNING id::text, created_at`,
			invoice.CompanyID, receiptNo, receiptDate, amount, method, strOrNull(in.ReferenceNumber), strOrNull(in.Notes),
			dealPaymentID, now, in.UserID).Scan(&receiptID, &createdAt); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO accounting.ar_receipt_allocations (receipt_id, invoice_id, amount) VALUES ($1,$2,$3)`,
			receiptID, invoice.ID, amount)
		return err
	})
	if err != nil {
		return nil, err
	}
	note := ""
	amounts := domain.PaymentAmounts(amount)
	if amounts["PAID"] > 0 {
		result, err := PostFromMapping(ctx, s.db, MappingPost{CompanyID: invoice.CompanyID, UserID: in.UserID, EventCode: "SALE_AR_RECEIPT",
			DocumentType: "ar_receipt", DocumentID: receiptID, EntryDate: receiptDate, Amounts: amounts,
			Description: "AR Receipt " + receiptNo, SourceModule: "SALES"})
		if err != nil {
			return nil, postErrorAs500(err)
		}
		note = domain.Summarize(result)
	}
	refreshed, err := s.arInvoiceWhere(ctx, s.db, `i.id = $1 AND i.deleted_at IS NULL`, invoice.ID)
	if err != nil {
		return nil, err
	}
	if refreshed == nil {
		refreshed = invoice
	}
	receipt := ArReceipt{ID: receiptID, CompanyID: invoice.CompanyID, ReceiptNo: receiptNo, ReceiptDate: receiptDate, Amount: amount,
		Method: method, ReferenceNumber: strOrNull(in.ReferenceNumber), Notes: strOrNull(in.Notes), Status: domain.StatusPosted,
		DealPaymentID: dealPaymentID, PostedAt: httpx.JSTime(now), PostedBy: &in.UserID, CreatedAt: ts(createdAt),
		CustomerName: invoice.CustomerName, InvoiceNos: []string{invoice.InvoiceNo}}
	return &ArReceiptResult{Receipt: receipt, Invoice: *refreshed, Note: note}, nil
}

// ListArReceipts is listArReceipts.
func (s *Service) ListArReceipts(ctx context.Context, companyID, search string, limit, offset float64) ([]ArReceipt, int, error) {
	args := []any{}
	where := []string{"r.deleted_at IS NULL"}
	if companyID != "" {
		args = append(args, companyID)
		where = append(where, "r.company_id = $"+itoa(len(args)))
	}
	if t := jsTrim(search); t != "" {
		args = append(args, "%"+t+"%")
		where = append(where, "r.receipt_no ILIKE $"+itoa(len(args)))
	}
	page, args := pageArgs(args, limit, offset)
	rows, err := collect[struct {
		ID              string
		CompanyID       *string
		ReceiptNo       string
		ReceiptDate     jsDate
		Amount          string
		Method          string
		ReferenceNumber *string
		Notes           *string
		Status          string
		DealPaymentID   *string
		PostedAt        *ts
		PostedBy        *string
		CreatedAt       ts
		CustomerName    *string
		InvoiceNos      *string
		Total           int
	}](ctx, s.db, `
SELECT r.id::text, r.company_id::text, r.receipt_no, r.receipt_date, r.amount::text, r.method, r.reference_number,
       r.notes, r.status, r.deal_payment_id::text, r.posted_at, r.posted_by::text, r.created_at,
       (SELECT i.customer_name FROM accounting.ar_receipt_allocations a JOIN accounting.ar_invoices i ON i.id = a.invoice_id
         WHERE a.receipt_id = r.id LIMIT 1) AS customer_name,
       (SELECT string_agg(i.invoice_no, ', ' ORDER BY i.invoice_no)
          FROM accounting.ar_receipt_allocations a JOIN accounting.ar_invoices i ON i.id = a.invoice_id
         WHERE a.receipt_id = r.id) AS invoice_nos,
       COUNT(*) OVER()::int
  FROM accounting.ar_receipts r
 WHERE `+strings.Join(where, " AND ")+`
 ORDER BY r.receipt_date DESC, r.created_at DESC`+page, args...)
	if err != nil {
		return nil, 0, err
	}
	out := make([]ArReceipt, len(rows))
	total := 0
	for i, r := range rows {
		var posted any
		if r.PostedAt != nil {
			posted = *r.PostedAt
		}
		out[i] = ArReceipt{ID: r.ID, CompanyID: r.CompanyID, ReceiptNo: r.ReceiptNo, ReceiptDate: string(r.ReceiptDate),
			Amount: domain.ToNumber(r.Amount), Method: r.Method, ReferenceNumber: r.ReferenceNumber, Notes: r.Notes, Status: r.Status,
			DealPaymentID: r.DealPaymentID, PostedAt: posted, PostedBy: r.PostedBy, CreatedAt: r.CreatedAt,
			CustomerName: r.CustomerName, InvoiceNos: splitInvoiceNos(r.InvoiceNos)}
		if i == 0 {
			total = r.Total
		}
	}
	return out, total, nil
}
