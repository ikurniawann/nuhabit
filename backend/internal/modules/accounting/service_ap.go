package accounting

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/accounting"
	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
)

// Accounts payable: AP invoices (one per GRN), payments with allocations,
// the payable register, aging and payment void (ap-store.ts, ap-posting.ts,
// lib/purchasing/ap-void.ts). The list joins purchasing tables for party,
// PO and GRN labels, as the TS does, so search and paging stay in SQL.

// ApInvoice is ApInvoiceRow. Dates are "YYYY-MM-DD"; payment_status and
// aging count days against the Asia/Jakarta calendar date.
type ApInvoice struct {
	ID                string  `json:"id"`
	CompanyID         *string `json:"company_id"`
	InvoiceNo         string  `json:"invoice_no"`
	InvoiceDate       string  `json:"invoice_date"`
	DueDate           *string `json:"due_date"`
	VendorID          *string `json:"vendor_id"`
	SupplierID        *string `json:"supplier_id"`
	PurchaseOrderID   *string `json:"purchase_order_id"`
	GrnID             *string `json:"grn_id"`
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
	PartyName         *string `json:"party_name"`
	PoNumber          *string `json:"po_number"`
	GrnNumber         *string `json:"grn_number"`
}

type apInvoiceRow struct {
	ID              string
	CompanyID       *string
	InvoiceNo       string
	InvoiceDate     isoDate
	DueDate         *isoDate
	VendorID        *string
	SupplierID      *string
	PurchaseOrderID *string
	GrnID           *string
	Currency        string
	Subtotal        string
	TaxAmount       string
	TotalAmount     string
	Status          string
	Description     *string
	PostedAt        *ts
	PostedBy        *string
	CreatedAt       ts
	Allocated       string
	PartyName       *string
	PoNumber        *string
	GrnNumber       *string
	Total           int
}

const apInvoiceCols = `i.id::text, i.company_id::text, i.invoice_no, i.invoice_date, i.due_date, i.vendor_id::text,
       i.supplier_id::text, i.purchase_order_id::text, i.grn_id::text, i.currency, i.subtotal::text,
       i.tax_amount::text, i.total_amount::text, i.status, i.description, i.posted_at, i.posted_by::text,
       i.created_at, COALESCE(alloc.allocated, 0)::text`

const apAllocLateral = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(a.amount), 0) AS allocated
      FROM accounting.ap_payment_allocations a
      JOIN accounting.ap_payments p ON p.id = a.payment_id
     WHERE a.invoice_id = i.id AND p.deleted_at IS NULL AND p.status = 'POSTED'
  ) alloc ON true`

const apInvoiceJoins = `
  FROM accounting.ap_invoices i
  LEFT JOIN purchasing.purchase_orders po ON po.id = i.purchase_order_id
  LEFT JOIN purchasing.grn g ON g.id = i.grn_id
  LEFT JOIN purchasing.vendors v ON v.id = i.vendor_id
  LEFT JOIN purchasing.suppliers s ON s.id = i.supplier_id` + apAllocLateral

const apLabels = `, COALESCE(v.name, s.nama_supplier) AS party_name, po.nomor_po AS po_number, g.nomor_grn AS grn_number`

func (s *Service) mapApInvoice(r apInvoiceRow) ApInvoice {
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
	return ApInvoice{ID: r.ID, CompanyID: r.CompanyID, InvoiceNo: r.InvoiceNo, InvoiceDate: string(r.InvoiceDate), DueDate: due,
		VendorID: r.VendorID, SupplierID: r.SupplierID, PurchaseOrderID: r.PurchaseOrderID, GrnID: r.GrnID, Currency: currency,
		Subtotal: domain.ToNumber(r.Subtotal), TaxAmount: domain.ToNumber(r.TaxAmount), TotalAmount: total, Status: r.Status,
		Description: r.Description, PostedAt: r.PostedAt, PostedBy: r.PostedBy, CreatedAt: r.CreatedAt,
		AllocatedAmount: allocated, OutstandingAmount: domain.InvoiceOutstanding(total, allocated),
		PaymentStatus: domain.PaymentStatus(total, allocated, due, s.jakartaToday()),
		PartyName:     r.PartyName, PoNumber: r.PoNumber, GrnNumber: r.GrnNumber}
}

// InvoiceListFilter is parseInvoiceListQuery plus the company.
type InvoiceListFilter struct {
	CompanyID, Status, PaymentStatus, Search string
	Limit, Offset                            float64 // JavaScript numbers (NaN fails in SQL like node-pg)
}

func pageArgs(args []any, limit, offset float64) (string, []any) {
	return limitOffset(args, domain.FormatNumber(domain.PageNumber(limit, 1, 100)), domain.FormatNumber(domain.PageNumber(offset, 0, 0)))
}

// ListApInvoices is listApInvoices.
func (s *Service) ListApInvoices(ctx context.Context, f InvoiceListFilter) ([]ApInvoice, int, error) {
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
		where = append(where, "(i.invoice_no ILIKE "+n+" OR po.nomor_po ILIKE "+n+" OR g.nomor_grn ILIKE "+n+" OR COALESCE(v.name, s.nama_supplier, '') ILIKE "+n+")")
	}
	page, args := pageArgs(args, f.Limit, f.Offset)
	rows, err := collect[apInvoiceRow](ctx, s.db, `SELECT `+apInvoiceCols+apLabels+`, COUNT(*) OVER()::int`+apInvoiceJoins+`
 WHERE `+strings.Join(where, " AND ")+`
 ORDER BY i.invoice_date DESC, i.created_at DESC`+page, args...)
	if err != nil {
		return nil, 0, err
	}
	out := []ApInvoice{}
	for _, r := range rows {
		inv := s.mapApInvoice(r)
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

func (s *Service) apInvoice(ctx context.Context, q database.Querier, id string) (*ApInvoice, error) {
	row, err := one[apInvoiceRow](ctx, q, `SELECT `+apInvoiceCols+apLabels+`, 0`+apInvoiceJoins+`
 WHERE i.id = $1 AND i.deleted_at IS NULL`, id)
	if err != nil || row == nil {
		return nil, err
	}
	inv := s.mapApInvoice(*row)
	return &inv, nil
}

// ApInvoice is getApInvoiceById.
func (s *Service) ApInvoice(ctx context.Context, id string) (*ApInvoice, error) {
	return s.apInvoice(ctx, s.db, id)
}

// ApPayable is listApPayableRegister: POSTED invoices with an outstanding.
func (s *Service) ApPayable(ctx context.Context, companyID string) ([]ApInvoice, error) {
	rows, _, err := s.ListApInvoices(ctx, InvoiceListFilter{CompanyID: companyID, Status: domain.StatusPosted, Limit: 100})
	if err != nil {
		return nil, err
	}
	out := []ApInvoice{}
	for _, r := range rows {
		if r.OutstandingAmount > 0.009 {
			out = append(out, r)
		}
	}
	return out, nil
}

// AgingBucket is ApAgingRow.
type AgingBucket struct {
	Bucket       string  `json:"bucket"`
	InvoiceCount int     `json:"invoice_count"`
	Amount       float64 `json:"amount"`
}

func agingBuckets(asOf string, outstanding []float64, due []*string) []AgingBucket {
	buckets := make([]AgingBucket, len(domain.AgingBuckets))
	index := map[string]int{}
	for i, b := range domain.AgingBuckets {
		buckets[i] = AgingBucket{Bucket: b}
		index[b] = i
	}
	for i, o := range outstanding {
		b := domain.BucketAging(o, due[i], asOf)
		if b == "" {
			continue
		}
		row := &buckets[index[b]]
		row.InvoiceCount++
		row.Amount = domain.Round2(row.Amount + o)
	}
	return buckets
}

// ApAging is listApAging's result.
type ApAging struct {
	AsOf     string        `json:"asOf"`
	Buckets  []AgingBucket `json:"buckets"`
	Invoices []ApInvoice   `json:"invoices"`
}

// ApAging is listApAging.
func (s *Service) ApAging(ctx context.Context, companyID, asOf string) (*ApAging, error) {
	if asOf == "" {
		asOf = s.jakartaToday()
	}
	open, err := s.ApPayable(ctx, companyID)
	if err != nil {
		return nil, err
	}
	outstanding := make([]float64, len(open))
	due := make([]*string, len(open))
	for i, inv := range open {
		outstanding[i], due[i] = inv.OutstandingAmount, inv.DueDate
	}
	return &ApAging{AsOf: asOf, Buckets: agingBuckets(asOf, outstanding, due), Invoices: open}, nil
}

// nextDailyNo is nextDocumentNo/nextNo: "<PREFIX>-YYYYMMDD-NNNN" after the
// highest number of the day (no company or deleted filter, like the TS).
func (s *Service) nextDailyNo(ctx context.Context, q database.Querier, table, col, prefix string, liveOnly bool) (string, error) {
	head := prefix + "-" + s.todayCompact()
	sql := `SELECT ` + col + ` FROM accounting.` + table + ` WHERE ` + col + ` ILIKE $1`
	if liveOnly {
		sql += ` AND deleted_at IS NULL`
	}
	last, _, err := scalar[string](ctx, q, sql+` ORDER BY `+col+` DESC LIMIT 1`, head+"-%")
	if err != nil {
		return "", err
	}
	tail := "0"
	if last != "" {
		parts := strings.Split(last, "-")
		if t := parts[len(parts)-1]; t != "" {
			tail = t
		}
	}
	seq := domain.FormatNumber(domain.ParseNumber(tail) + 1)
	for len(seq) < 4 {
		seq = "0" + seq
	}
	return head + "-" + seq, nil
}

// ApPayment is ApPaymentRow.
type ApPayment struct {
	ID              string  `json:"id"`
	CompanyID       *string `json:"company_id"`
	PaymentNo       string  `json:"payment_no"`
	PaymentDate     string  `json:"payment_date"`
	Amount          float64 `json:"amount"`
	Method          string  `json:"method"`
	ReferenceNumber *string `json:"reference_number"`
	Notes           *string `json:"notes"`
	Status          string  `json:"status"`
	VendorID        *string `json:"vendor_id"`
	SupplierID      *string `json:"supplier_id"`
	PurchaseOrderID *string `json:"purchase_order_id"`
	VendorPaymentID *string `json:"vendor_payment_id"`
	PostedAt        any     `json:"posted_at"`
	PostedBy        *string `json:"posted_by"`
	CreatedAt       ts      `json:"created_at"`
}

// ApPaymentListItem is a listed payment with its party and invoice numbers.
type ApPaymentListItem struct {
	ApPayment
	PartyName  *string  `json:"party_name"`
	InvoiceNos []string `json:"invoice_nos"`
}

// ApPaymentInput is POST /ap/payments.
type ApPaymentInput struct {
	UserID, UserName, InvoiceID string
	Amount                      float64
	PaymentDate, Method         *string
	ReferenceNumber, Notes      *string
	IP, UserAgent               *string
}

// ApPaymentResult is recordApPayment's result.
type ApPaymentResult struct {
	Payment ApPayment
	Invoice ApInvoice
	Note    string
}

// RecordApPayment is recordApPayment + the route's audit: the payment, its
// allocation and (for PO invoices) the vendor payment commit together; the
// PURCHASE_PAYMENT journal posts after, as in the TS.
func (s *Service) RecordApPayment(ctx context.Context, in ApPaymentInput) (*ApPaymentResult, error) {
	invoice, err := s.ApInvoice(ctx, in.InvoiceID)
	if err != nil {
		return nil, err
	}
	if invoice == nil {
		return nil, httpx.NotFound("AP invoice tidak ditemukan")
	}
	if invoice.Status != domain.StatusPosted {
		return nil, httpx.BadRequest("Hanya invoice POSTED yang bisa dibayar")
	}
	amount := domain.Round2(in.Amount)
	if amount <= 0 {
		return nil, httpx.BadRequest("Amount pembayaran harus > 0")
	}
	if amount > invoice.OutstandingAmount+0.01 {
		return nil, httpx.BadRequest("Amount pembayaran tidak boleh melebihi outstanding")
	}
	paymentDate := s.today()
	if in.PaymentDate != nil && *in.PaymentDate != "" {
		paymentDate = *in.PaymentDate
	}
	method := "bank_transfer"
	if in.Method != nil && *in.Method != "" {
		method = *in.Method
	}
	now := s.now()
	var paymentNo, paymentID string
	var vendorPaymentID *string
	var createdAt time.Time
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		paymentNo, err = s.nextDailyNo(ctx, tx, "ap_payments", "payment_no", "APP", false)
		if err != nil {
			return err
		}
		if invoice.PurchaseOrderID != nil {
			// Port in the same transaction: the response returns vendor_payment_id.
			id, err := s.ports.Purchasing.RecordVendorPayment(ctx, tx, VendorPaymentInput{
				PurchaseOrderID: *invoice.PurchaseOrderID, PaymentNo: paymentNo, PaymentDate: paymentDate, Amount: amount,
				Method: method, ReferenceNumber: strOrNull(in.ReferenceNumber), Notes: strOrNull(in.Notes), UserID: in.UserID,
			})
			if err != nil {
				return err
			}
			if id != "" {
				vendorPaymentID = &id
			}
		}
		if err := tx.QueryRow(ctx, `
INSERT INTO accounting.ap_payments (
  company_id, payment_no, payment_date, amount, method, reference_number, notes, status,
  vendor_id, supplier_id, purchase_order_id, vendor_payment_id, posted_at, posted_by, created_by, updated_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,'POSTED',$8,$9,$10,$11,$12,$13,$13,$13)
RETURNING id::text, created_at`,
			invoice.CompanyID, paymentNo, paymentDate, amount, method, strOrNull(in.ReferenceNumber), strOrNull(in.Notes),
			invoice.VendorID, invoice.SupplierID, invoice.PurchaseOrderID, vendorPaymentID, now, in.UserID).Scan(&paymentID, &createdAt); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO accounting.ap_payment_allocations (payment_id, invoice_id, amount) VALUES ($1,$2,$3)`,
			paymentID, invoice.ID, amount)
		return err
	})
	if err != nil {
		return nil, err
	}

	note := ""
	amounts := domain.PaymentAmounts(amount)
	if amounts["PAID"] > 0 {
		result, err := PostFromMapping(ctx, s.db, MappingPost{
			CompanyID: invoice.CompanyID, UserID: in.UserID, EventCode: "PURCHASE_PAYMENT", DocumentType: "ap_payment",
			DocumentID: paymentID, EntryDate: paymentDate, Amounts: amounts, Description: "Pembayaran AP " + paymentNo,
			SourceModule: "PURCHASING",
		})
		if err != nil {
			return nil, postErrorAs500(err)
		}
		note = domain.Summarize(result)
	}

	refreshed, err := s.ApInvoice(ctx, invoice.ID)
	if err != nil {
		return nil, err
	}
	if refreshed == nil {
		refreshed = invoice
	}
	payment := ApPayment{ID: paymentID, CompanyID: invoice.CompanyID, PaymentNo: paymentNo, PaymentDate: paymentDate, Amount: amount,
		Method: method, ReferenceNumber: strOrNull(in.ReferenceNumber), Notes: strOrNull(in.Notes), Status: domain.StatusPosted,
		VendorID: invoice.VendorID, SupplierID: invoice.SupplierID, PurchaseOrderID: invoice.PurchaseOrderID,
		VendorPaymentID: vendorPaymentID, PostedAt: httpx.JSTime(now), PostedBy: &in.UserID, CreatedAt: ts(createdAt)}

	// recordAuditAfterCommit: a failure is logged, never surfaced.
	if err := s.ports.Audit.Record(ctx, s.db, AuditEntry{
		ActorID: in.UserID, ActorName: in.UserName, Action: "ap_payment.create", Entity: "ap_payment",
		EntityID: paymentID, EntityLabel: paymentNo,
		After: auditAfterPayment{Status: domain.StatusPosted, Amount: amount, InvoiceID: in.InvoiceID, Method: method,
			PaymentDate: paymentDate, VendorPaymentID: vendorPaymentID},
		IP: in.IP, UserAgent: in.UserAgent,
	}); err != nil {
		s.log.ErrorContext(ctx, "[audit] gagal mencatat ap_payment.create", "entity_id", paymentID, "error", err)
	}
	return &ApPaymentResult{Payment: payment, Invoice: *refreshed, Note: note}, nil
}

type auditAfterPayment struct {
	Status          string  `json:"status"`
	Amount          float64 `json:"amount"`
	InvoiceID       string  `json:"invoice_id"`
	Method          string  `json:"method"`
	PaymentDate     string  `json:"payment_date"`
	VendorPaymentID *string `json:"vendor_payment_id"`
}

// ListApPayments is listApPayments.
func (s *Service) ListApPayments(ctx context.Context, companyID, search string, limit, offset float64) ([]ApPaymentListItem, int, error) {
	args := []any{}
	where := []string{"p.deleted_at IS NULL"}
	if companyID != "" {
		args = append(args, companyID)
		where = append(where, "p.company_id = $"+itoa(len(args)))
	}
	if t := jsTrim(search); t != "" {
		args = append(args, "%"+t+"%")
		n := "$" + itoa(len(args))
		where = append(where, "(p.payment_no ILIKE "+n+" OR COALESCE(v.name, s.nama_supplier, '') ILIKE "+n+")")
	}
	page, args := pageArgs(args, limit, offset)
	rows, err := collect[struct {
		ID              string
		CompanyID       *string
		PaymentNo       string
		PaymentDate     isoDate
		Amount          string
		Method          string
		ReferenceNumber *string
		Notes           *string
		Status          string
		VendorID        *string
		SupplierID      *string
		PurchaseOrderID *string
		VendorPaymentID *string
		PostedAt        *ts
		PostedBy        *string
		CreatedAt       ts
		PartyName       *string
		InvoiceNos      *string
		Total           int
	}](ctx, s.db, `
SELECT p.id::text, p.company_id::text, p.payment_no, p.payment_date, p.amount::text, p.method, p.reference_number, p.notes,
       p.status, p.vendor_id::text, p.supplier_id::text, p.purchase_order_id::text, p.vendor_payment_id::text,
       p.posted_at, p.posted_by::text, p.created_at,
       COALESCE(v.name, s.nama_supplier) AS party_name,
       (SELECT string_agg(i.invoice_no, ', ' ORDER BY i.invoice_no)
          FROM accounting.ap_payment_allocations a JOIN accounting.ap_invoices i ON i.id = a.invoice_id
         WHERE a.payment_id = p.id) AS invoice_nos,
       COUNT(*) OVER()::int
  FROM accounting.ap_payments p
  LEFT JOIN purchasing.vendors v ON v.id = p.vendor_id
  LEFT JOIN purchasing.suppliers s ON s.id = p.supplier_id
 WHERE `+strings.Join(where, " AND ")+`
 ORDER BY p.payment_date DESC, p.created_at DESC`+page, args...)
	if err != nil {
		return nil, 0, err
	}
	out := make([]ApPaymentListItem, len(rows))
	total := 0
	for i, r := range rows {
		var posted any
		if r.PostedAt != nil {
			posted = *r.PostedAt
		}
		out[i].ApPayment = ApPayment{ID: r.ID, CompanyID: r.CompanyID, PaymentNo: r.PaymentNo, PaymentDate: string(r.PaymentDate),
			Amount: domain.ToNumber(r.Amount), Method: r.Method, ReferenceNumber: r.ReferenceNumber, Notes: r.Notes, Status: r.Status,
			VendorID: r.VendorID, SupplierID: r.SupplierID, PurchaseOrderID: r.PurchaseOrderID, VendorPaymentID: r.VendorPaymentID,
			PostedAt: posted, PostedBy: r.PostedBy, CreatedAt: r.CreatedAt}
		out[i].PartyName, out[i].InvoiceNos = r.PartyName, splitInvoiceNos(r.InvoiceNos)
		if i == 0 {
			total = r.Total
		}
	}
	return out, total, nil
}

func splitInvoiceNos(s *string) []string {
	if s == nil || *s == "" {
		return []string{}
	}
	return strings.Split(*s, ", ")
}

// VoidInput is POST /ap/payments/{id}/void.
type VoidInput struct {
	PaymentID, Reason, UserID, UserName string
	IP, UserAgent                       *string
}

// VoidedPayment is the void route's data.
type VoidedPayment struct {
	ID        string `json:"id"`
	PaymentNo string `json:"payment_no"`
	Status    string `json:"status"`
}

type voidRow struct {
	ID, Status      string
	Deleted         bool
	PaymentNo       string
	CompanyID       *string
	Amount          string
	PaymentDate     string
	VendorPaymentID *string
}

type voidAllocation struct {
	InvoiceID string `json:"invoice_id"`
	Amount    string `json:"amount"`
}

// VoidApPayment is voidApPayment: VOID with a reason, allocations kept as
// history but no longer counted, the linked vendor payment voided through
// procurement (outbox), audit in the same transaction, then the payment
// journal reversed. It returns the journal note.
func (s *Service) VoidApPayment(ctx context.Context, in VoidInput) (*VoidedPayment, string, error) {
	reason := jsTrim(in.Reason)
	var payment voidRow
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		row, err := one[voidRow](ctx, tx, `
SELECT id::text, status, deleted_at IS NOT NULL, payment_no, company_id::text, amount::text,
       payment_date::text, vendor_payment_id::text
  FROM accounting.ap_payments WHERE id = $1 FOR UPDATE`, in.PaymentID)
		if err != nil {
			return err
		}
		found := row != nil && !row.Deleted
		status := ""
		if row != nil {
			status = row.Status
		}
		if r := domain.EvaluateApPaymentVoid(found, status, reason); r != nil {
			return httpx.Status(r.Status, r.Message)
		}
		payment = *row
		allocations, err := collect[voidAllocation](ctx, tx, `SELECT invoice_id::text, amount::text FROM accounting.ap_payment_allocations WHERE payment_id = $1`, in.PaymentID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
UPDATE accounting.ap_payments
   SET status = 'VOID', voided_at = now(), voided_by = $2, void_reason = $3, updated_at = now(), updated_by = $2
 WHERE id = $1`, in.PaymentID, in.UserID, reason); err != nil {
			return err
		}
		if payment.VendorPaymentID != nil {
			if err := outbox.Publish(ctx, tx, accounting.TopicApPaymentVoided, payment.ID, accounting.ApPaymentVoided{
				PaymentID: payment.ID, PaymentNo: payment.PaymentNo, VendorPaymentID: *payment.VendorPaymentID,
				UserID: in.UserID, Reason: reason,
			}); err != nil {
				return err
			}
		}
		return s.ports.Audit.Record(ctx, tx, AuditEntry{
			ActorID: in.UserID, ActorName: in.UserName, Action: "ap_payment.void", Entity: "ap_payment",
			EntityID: in.PaymentID, EntityLabel: payment.PaymentNo,
			Before: struct {
				Status      string           `json:"status"`
				Amount      float64          `json:"amount"`
				Allocations []voidAllocation `json:"allocations"`
			}{payment.Status, domain.ToNumber(payment.Amount), allocations},
			After: struct {
				Status             string `json:"status"`
				AllocationsCounted bool   `json:"allocations_counted"`
			}{domain.StatusVoid, false},
			Reason: reason, IP: in.IP, UserAgent: in.UserAgent,
		})
	})
	if err != nil {
		return nil, "", err
	}
	note := s.reversePaymentJournal(ctx, payment, in.UserID, reason)
	return &VoidedPayment{ID: payment.ID, PaymentNo: payment.PaymentNo, Status: domain.StatusVoid}, note, nil
}

// reversePaymentJournal: a draft PURCHASE_PAYMENT journal is deleted, a
// posted one gets a reversing AUTO entry. Failures become the note.
func (s *Service) reversePaymentJournal(ctx context.Context, p voidRow, userID, reason string) string {
	note, err := func() (string, error) {
		entry, err := findEntryBySource(ctx, s.db, p.CompanyID, "PURCHASE_PAYMENT", p.ID)
		if err != nil {
			return "", err
		}
		if entry == nil {
			return "tidak ada jurnal pembayaran untuk dibalik", nil
		}
		if entry.Status != domain.StatusPosted {
			if err := s.DeleteJournalEntry(ctx, entry.ID, userID); err != nil {
				return "", err
			}
			return "jurnal draft pembayaran dihapus", nil
		}
		sides := make([]string, len(entry.Lines))
		for i, l := range entry.Lines {
			sides[i] = l.EntrySide
		}
		flipped := domain.ReverseLines(sides)
		memo := "Pembalik " + entry.EntryNo
		lines := make([]domain.Line, len(entry.Lines))
		for i, l := range entry.Lines {
			order := i
			lines[i] = domain.Line{AccountID: l.AccountID, Side: flipped[i], Amount: l.Amount, Memo: &memo, SortOrder: &order}
		}
		module, event, docType := "PURCHASING", "PURCHASE_PAYMENT_VOID", "ap_payment"
		_, err = createEntry(ctx, s.db, NewEntry{
			UserID: userID, CompanyID: p.CompanyID, EntryDate: s.today(),
			Description: strp("Void pembayaran AP " + p.PaymentNo + ": " + reason), Post: true, EntryType: domain.EntryAuto,
			SourceModule: &module, SourceEventCode: &event, SourceDocumentType: &docType, SourceDocumentID: &p.ID, Lines: lines,
		})
		if err != nil {
			return "", err
		}
		return "jurnal pembalik diposting", nil
	}()
	if err != nil {
		s.log.ErrorContext(ctx, "[ap-void] jurnal pembalik gagal", "error", err)
		return "jurnal pembalik gagal: " + errMessage(err)
	}
	return note
}
