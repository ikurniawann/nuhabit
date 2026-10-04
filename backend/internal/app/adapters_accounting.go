package app

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/accounting"
	acctdomain "nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/modules/procurement"
	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/database"
)

// Stopgap adapters for the accounting ports: the SQL the TS stores ran on
// other contexts' tables (audit.audit_log,
// purchasing GRN/PO/vendor payments, POS orders, raw materials and the
// sales-funnel B2B invoices). Each moves to its owning module's service
// once that exposes the operation.

var (
	_ accounting.AuditLog    = accountingAudit{}
	_ accounting.Purchasing  = accountingPurchasing{}
	_ accounting.PosOrders   = accountingPos{}
	_ accounting.Materials   = accountingMaterials{}
	_ accounting.SalesFunnel = accountingSales{}
)

func noRow(err error) bool { return database.IsNoRows(err) }

/* ── Audit (lib/audit recordAudit) ───────────────────────────────────── */

type accountingAudit struct{}

func (accountingAudit) Record(ctx context.Context, q database.Querier, e accounting.AuditEntry) error {
	return audit.Write(ctx, q, audit.Entry{
		ActorID: e.ActorID, ActorName: &e.ActorName, Action: e.Action, Entity: e.Entity,
		EntityID: &e.EntityID, EntityLabel: &e.EntityLabel, Before: e.Before, After: e.After,
		Reason: &e.Reason, IP: e.IP, UserAgent: e.UserAgent,
	})
}

/* ── Purchasing (lib/purchasing/accounting-amounts.ts, po-payments.ts) ── */

// accountingPurchasing reads GRNs with the TS SQL and resolves PO payment
// terms through procurement's service.
type accountingPurchasing struct{ terms *procurement.Service }

func (accountingPurchasing) GrnPosting(ctx context.Context, q database.Querier, grnID string) (*accounting.GrnPosting, error) {
	g := accounting.GrnPosting{GrnID: grnID}
	var number, entryDate *string
	err := q.QueryRow(ctx, `
SELECT nomor_grn, company_id::text, tanggal_penerimaan::text, purchase_order_id::text, vendor_id::text, supplier_id::text
  FROM purchasing.grn WHERE id = $1`, grnID).Scan(&number, &g.CompanyID, &entryDate, &g.PurchaseOrderID, &g.VendorID, &g.SupplierID)
	if noRow(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	g.GrnNumber = grnID
	if number != nil && *number != "" {
		g.GrnNumber = *number
	}
	if entryDate != nil {
		g.EntryDate = *entryDate
	} else {
		g.EntryDate = time.Now().UTC().Format("2006-01-02")
	}
	rows, err := q.Query(ctx, `
SELECT COALESCE(gi.qty_qc_posted, 0)::float8, COALESCE(gi.qty_diterima, 0)::float8, COALESCE(poi.harga_satuan, 0)::float8
  FROM purchasing.grn_items gi
  LEFT JOIN purchasing.purchase_order_items poi ON poi.id = gi.purchase_order_item_id
 WHERE gi.grn_id = $1 AND gi.is_active = true`, grnID)
	if err != nil {
		return nil, err
	}
	g.Lines, err = pgx.CollectRows(rows, pgx.RowToStructByPos[acctdomain.GrnLine])
	if err != nil {
		return nil, err
	}
	if g.PurchaseOrderID != nil {
		var ppn float64
		var company, vendor, supplier, due *string
		err := q.QueryRow(ctx, `
SELECT COALESCE(ppn_persen, 0)::float8, company_id::text, vendor_id::text, supplier_id::text,
       COALESCE(tanggal_kirim_estimasi, tanggal_dibutuhkan)::text
  FROM purchasing.purchase_orders WHERE id = $1`, *g.PurchaseOrderID).Scan(&ppn, &company, &vendor, &supplier, &due)
		if err != nil && !noRow(err) {
			return nil, err
		}
		g.PpnPercent = ppn
		if g.CompanyID == nil {
			g.CompanyID = company
		}
		if g.VendorID == nil {
			g.VendorID = vendor
		}
		if g.SupplierID == nil {
			g.SupplierID = supplier
		}
		g.DueDate = due
	}
	return &g, nil
}

// RecordVendorPayment is the PO branch of recordApPayment: procurement
// resolves the payment term (resolvePaymentTermId), then the posted vendor
// payment is inserted and the term recalculated, all on the caller's tx.
func (p accountingPurchasing) RecordVendorPayment(ctx context.Context, q database.Querier, in accounting.VendorPaymentInput) (string, error) {
	term, err := p.terms.ResolvePaymentTerm(ctx, q, in.PurchaseOrderID, in.Amount, in.PaymentDate)
	if err != nil || term == nil {
		return "", err
	}
	notes := "via Accounting AP " + in.PaymentNo
	if in.Notes != nil {
		notes = *in.Notes + " (via Accounting AP " + in.PaymentNo + ")"
	}
	var id string
	if err := q.QueryRow(ctx, `
INSERT INTO purchasing.vendor_payments (
  payment_number, purchase_order_id, payment_term_id, supplier_id, vendor_id, payment_date, amount, method,
  reference_number, notes, status, created_by, updated_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'posted',$11,$11) RETURNING id::text`,
		strings.Replace(in.PaymentNo, "APP-", "VP-", 1), in.PurchaseOrderID, term.TermID, term.SupplierID, term.VendorID, in.PaymentDate,
		in.Amount, in.Method, in.ReferenceNumber, notes, in.UserID).Scan(&id); err != nil {
		return "", err
	}
	return id, recalculateTerm(ctx, q, term.TermID)
}

// recalculateTerm sets a term's paid amount and status from its posted payments.
func recalculateTerm(ctx context.Context, q database.Querier, termID string) error {
	_, err := q.Exec(ctx, `
WITH paid AS (
  SELECT COALESCE(SUM(amount), 0) AS total FROM purchasing.vendor_payments
   WHERE payment_term_id = $1 AND status = 'posted')
UPDATE purchasing.purchase_order_payment_terms t
   SET paid_amount = paid.total,
       status = CASE WHEN paid.total >= COALESCE(t.amount, 0) THEN 'paid'
                     WHEN paid.total > 0 THEN 'partial'
                     WHEN t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE THEN 'overdue'
                     ELSE 'unpaid' END,
       updated_at = now()
  FROM paid
 WHERE t.id = $1`, termID)
	return err
}

/* ── POS (lib/pos/accounting-amounts.ts buildPosAccountingAmounts) ───── */

type accountingPos struct{}

func (accountingPos) SaleSnapshot(ctx context.Context, q database.Querier, orderID string) (*accounting.PosSale, error) {
	var s accounting.PosSale
	var number *string
	err := q.QueryRow(ctx, `
SELECT o.order_number, o.company_id::text,
       (COALESCE(o.ordered_at, now()) AT TIME ZONE 'Asia/Jakarta')::date::text,
       NULLIF(o.payment_method, ''),
       COALESCE(o.subtotal, 0)::float8, COALESCE(o.discount_amount, 0)::float8, COALESCE(o.tax_amount, 0)::float8,
       COALESCE(o.service_charge_amount, 0)::float8, COALESCE(o.other_charges_amount, 0)::float8,
       COALESCE(o.total_amount, 0)::float8, COALESCE(o.amount_paid, 0)::float8,
       COALESCE((SELECT SUM(GREATEST(0, COALESCE(i.cost_total, 0))) FROM pos.pos_order_items i WHERE i.order_id = o.id), 0)::float8
  FROM pos.pos_orders o WHERE o.id = $1`, orderID).Scan(&number, &s.CompanyID, &s.EntryDate, &s.PaymentMethod,
		&s.Subtotal, &s.Discount, &s.Tax, &s.ServiceCharge, &s.OtherCharges, &s.Total, &s.AmountPaid, &s.Cogs)
	if noRow(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s.OrderNumber = orderID
	if number != nil && *number != "" {
		s.OrderNumber = *number
	}
	return &s, nil
}

/* ── Inventory (item.raw_materials) ──────────────────────────────────── */

type accountingMaterials struct{}

func (accountingMaterials) Materials(ctx context.Context, q database.Querier, ids []string) (map[string]accounting.Material, error) {
	out := map[string]accounting.Material{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `
SELECT id::text, company_id::text, coa_asset, nama FROM item.raw_materials
 WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var m accounting.Material
		var nama *string
		if err := rows.Scan(&id, &m.CompanyID, &m.CoaAsset, &nama); err != nil {
			return nil, err
		}
		if nama != nil {
			m.Nama = *nama
		}
		out[id] = m
	}
	return out, rows.Err()
}

/* ── Sales funnel (ar-store.ts, lib/finance/invoices.ts) ─────────────── */

type accountingSales struct{}

const paidSubquery = `COALESCE((SELECT SUM(p.amount) FROM crm.crm_sales_deal_payments p WHERE p.invoice_id = i.id AND p.deleted_at IS NULL), 0)`

func (accountingSales) SalesInvoice(ctx context.Context, q database.Querier, id string) (*accounting.SalesInvoiceSource, error) {
	var s accounting.SalesInvoiceSource
	var sentAt *time.Time
	err := q.QueryRow(ctx, `
SELECT i.id::text, i.company_id::text, i.branch_id::text, i.invoice_number, i.amount::float8, i.due_date::text,
       i.deal_id::text, i.sent_at, i.status, l.org_name, d.title
  FROM crm.crm_sales_invoices i
  JOIN crm.crm_sales_deals d ON d.id = i.deal_id
  JOIN crm.crm_sales_leads l ON l.id = d.lead_id
 WHERE i.id = $1 AND i.deleted_at IS NULL`, id).Scan(&s.ID, &s.CompanyID, &s.BranchID, &s.InvoiceNumber, &s.Amount, &s.DueDate,
		&s.DealID, &sentAt, &s.Status, &s.OrgName, &s.DealTitle)
	if noRow(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if sentAt != nil {
		// String(sent_at).slice(0, 10) on a UTC server.
		v := acctdomain.JSDateString(sentAt.UTC())
		s.SentAt = &v
	}
	return &s, nil
}

func (accountingSales) UnsyncedSentInvoices(ctx context.Context, q database.Querier, companyID string, limit int) ([]string, error) {
	rows, err := q.Query(ctx, `
SELECT i.id::text FROM crm.crm_sales_invoices i
 WHERE i.company_id = $1 AND i.deleted_at IS NULL AND i.status = 'terkirim'
   AND NOT EXISTS (SELECT 1 FROM accounting.ar_invoices a WHERE a.sales_invoice_id = i.id AND a.deleted_at IS NULL)
 ORDER BY i.sent_at NULLS LAST
 LIMIT $2`, companyID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (accountingSales) RecordDealPayment(ctx context.Context, q database.Querier, in accounting.DealPaymentInput) (string, error) {
	var id string
	err := q.QueryRow(ctx, `
INSERT INTO crm.crm_sales_deal_payments (company_id, branch_id, deal_id, invoice_id, amount, method, paid_on, note, created_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text`,
		in.CompanyID, in.BranchID, in.DealID, in.SalesInvoiceID, in.Amount, in.Method, in.PaidOn, in.Note, in.UserID).Scan(&id)
	return id, err
}

func (accountingSales) Deal(ctx context.Context, q database.Querier, id string) (*accounting.AccessibleDeal, error) {
	var d accounting.AccessibleDeal
	err := q.QueryRow(ctx, `SELECT company_id::text, branch_id::text, owner_user_id::text FROM crm.crm_sales_deals WHERE id = $1 AND deleted_at IS NULL`, id).
		Scan(&d.CompanyID, &d.BranchID, &d.OwnerUserID)
	if noRow(err) {
		return nil, nil
	}
	return &d, err
}

func (accountingSales) FinanceInvoices(ctx context.Context, q database.Querier, f accounting.FinanceInvoiceFilter) ([]accounting.FinanceInvoiceRow, error) {
	where := []string{"i.deleted_at IS NULL"}
	args := []any{}
	add := func(clause string, v any) {
		args = append(args, v)
		where = append(where, strings.ReplaceAll(clause, "?", "$"+acctdomain.FormatNumber(float64(len(args)))))
	}
	if f.CompanyID != nil {
		add("i.company_id = ?", *f.CompanyID)
	}
	if f.BranchID != nil {
		add("i.branch_id = ?", *f.BranchID)
	}
	if f.Status != "" {
		add("i.status = ?", f.Status)
	}
	if f.Q != "" {
		add("(i.invoice_number ILIKE ? OR l.org_name ILIKE ? OR d.title ILIKE ?)", "%"+f.Q+"%")
	}
	rows, err := q.Query(ctx, `
SELECT i.id::text, i.invoice_number, i.label, i.amount::text, i.due_date::text, i.status, i.sent_at, i.note,
       i.created_at, i.deal_id::text, d.title, l.org_name, l.pic_name, qt.quote_number, u.full_name,
       `+paidSubquery+`::text
  FROM crm.crm_sales_invoices i
  JOIN crm.crm_sales_deals d ON d.id = i.deal_id
  JOIN crm.crm_sales_leads l ON l.id = d.lead_id
  LEFT JOIN crm.crm_sales_quotations qt ON qt.id = i.quotation_id
  LEFT JOIN configuration.users u ON u.id = i.created_by
 WHERE `+strings.Join(where, " AND ")+`
 ORDER BY (i.status = 'diajukan') DESC, i.created_at DESC
 LIMIT 300`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[accounting.FinanceInvoiceRow])
}

func (accountingSales) FinanceInvoice(ctx context.Context, q database.Querier, id string) (*accounting.FinanceInvoiceDetailRow, error) {
	rows, err := q.Query(ctx, `
SELECT i.id::text, i.invoice_number, i.label, i.amount::text, i.due_date::text, i.status, i.sent_at, i.note,
       i.faktur_pajak_url, i.created_at, u.full_name,
       i.deal_id::text, d.title, d.event_type, d.event_date::text,
       l.org_name, l.pic_name, l.pic_phone, l.pic_title,
       qt.id::text, qt.quote_number, qt.status, qt.total::text, qt.use_ppn, qt.ppn_persen::text,
       t.id::text, t.label, t.percent::text, t.due_date::text,
       `+paidSubquery+`::text
  FROM crm.crm_sales_invoices i
  JOIN crm.crm_sales_deals d ON d.id = i.deal_id
  JOIN crm.crm_sales_leads l ON l.id = d.lead_id
  LEFT JOIN crm.crm_sales_quotations qt ON qt.id = i.quotation_id
  LEFT JOIN crm.crm_sales_quotation_terms t ON t.id = i.term_id
  LEFT JOIN configuration.users u ON u.id = i.created_by
 WHERE i.id = $1 AND i.deleted_at IS NULL`, id)
	if err != nil {
		return nil, err
	}
	row, err := pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByPos[accounting.FinanceInvoiceDetailRow])
	if noRow(err) {
		return nil, nil
	}
	return row, err
}

func (accountingSales) InvoiceDeal(ctx context.Context, q database.Querier, id string) (string, string, float64, error) {
	var deal, status string
	var paid float64
	err := q.QueryRow(ctx, `SELECT i.deal_id::text, i.status, `+paidSubquery+`::float8 FROM crm.crm_sales_invoices i WHERE i.id = $1 AND i.deleted_at IS NULL`, id).
		Scan(&deal, &status, &paid)
	if noRow(err) {
		return "", "", 0, nil
	}
	return deal, status, paid, err
}

func (accountingSales) ReviseInvoice(ctx context.Context, q database.Querier, id, label string, amount float64, dueDate, note *string) (*accounting.RevisedInvoice, error) {
	var r accounting.RevisedInvoice
	err := q.QueryRow(ctx, `
UPDATE crm.crm_sales_invoices
   SET label = $1, amount = $2, due_date = $3, note = $4, updated_at = now()
 WHERE id = $5 AND deleted_at IS NULL AND status <> 'batal'
RETURNING id::text, invoice_number`, label, amount, dueDate, note, id).Scan(&r.ID, &r.InvoiceNumber)
	if noRow(err) {
		return nil, nil
	}
	return &r, err
}

func (accountingSales) InvoicePayments(ctx context.Context, q database.Querier, invoiceID string) ([]accounting.InvoicePaymentRow, error) {
	rows, err := q.Query(ctx, `
SELECT p.id::text, p.amount::text, p.method, p.paid_on::text, p.note, u.full_name, p.created_at
  FROM crm.crm_sales_deal_payments p
  LEFT JOIN configuration.users u ON u.id = p.created_by
 WHERE p.invoice_id = $1 AND p.deleted_at IS NULL
 ORDER BY p.paid_on DESC, p.created_at DESC`, invoiceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[accounting.InvoicePaymentRow])
}

func (accountingSales) DealPaymentDeal(ctx context.Context, q database.Querier, paymentID string) (string, error) {
	var deal string
	err := q.QueryRow(ctx, `SELECT deal_id::text FROM crm.crm_sales_deal_payments WHERE id = $1 AND deleted_at IS NULL`, paymentID).Scan(&deal)
	if noRow(err) {
		return "", nil
	}
	return deal, err
}

func (accountingSales) SoftDeleteDealPayment(ctx context.Context, q database.Querier, paymentID, userID string) error {
	_, err := q.Exec(ctx, `UPDATE crm.crm_sales_deal_payments SET deleted_at = now(), deleted_by = $2, updated_at = now() WHERE id = $1`, paymentID, userID)
	return err
}
