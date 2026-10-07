package salesfunnel

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// lib/sales-funnel/billing.ts and billing-server.ts (EPIC-025 Opsi B: sales
// submit invoices, finance issues them and records payments).

const paidSQL = `COALESCE(
              (SELECT SUM(p.amount) FROM crm.crm_sales_deal_payments p
               WHERE p.invoice_id = i.id AND p.deleted_at IS NULL),
              0
            )`

// referenceQuotation is loadReferenceQuotation: the newest accepted
// quotation, else the newest one.
func (h *handler) referenceQuotation(ctx context.Context, dealID string) (*pgrow.Row, error) {
	return pgrow.QueryOne(ctx, h.db, `SELECT id, quote_number, status, total, use_ppn, ppn_persen
     FROM crm.crm_sales_quotations
     WHERE deal_id = $1 AND deleted_at IS NULL
     ORDER BY (status = 'diterima') DESC, created_at DESC
     LIMIT 1`, dealID)
}

func (h *handler) loadTerms(ctx context.Context, ref *pgrow.Row) ([]*pgrow.Row, error) {
	if ref == nil {
		return []*pgrow.Row{}, nil
	}
	return pgrow.Query(ctx, h.db, `SELECT id, label, percent, due_date::text AS due_date
     FROM crm.crm_sales_quotation_terms
     WHERE quotation_id = $1
     ORDER BY sort_order`, ref.Str("id"))
}

func (h *handler) dealInvoices(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireFinance(r, true)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "deal", id, u); err != nil {
		return err
	}
	invoices, err := pgrow.Query(ctx, h.db, `SELECT i.id, i.invoice_number, i.label, i.amount,
              i.due_date::text AS due_date, i.status, i.sent_at, i.note,
              i.quotation_id, i.term_id, q.quote_number,
              `+paidSQL+` AS paid,
              i.created_at
       FROM crm.crm_sales_invoices i
       LEFT JOIN crm.crm_sales_quotations q ON q.id = i.quotation_id
       WHERE i.deal_id = $1 AND i.deleted_at IS NULL
       ORDER BY i.created_at DESC
       LIMIT 50`, id)
	if err != nil {
		return err
	}
	ref, err := h.referenceQuotation(ctx, id)
	if err != nil {
		return err
	}
	terms, err := h.loadTerms(ctx, ref)
	if err != nil {
		return err
	}
	refTotal := 0.0
	if ref != nil {
		refTotal = ref.Num("total")
	}
	percents := make([]float64, len(terms))
	for i, t := range terms {
		percents[i] = t.Num("percent")
	}
	amounts := domain.AllocateTermAmounts(refTotal, percents)
	invoiced := map[string]bool{}
	for _, inv := range invoices {
		amount, paid := inv.Num("amount"), inv.Num("paid")
		inv.Set("amount", amount)
		inv.Set("paid", paid)
		inv.Set("payment_status", domain.PaymentStatus(paid, amount))
		if t := inv.Str("term_id"); t != "" && inv.Str("status") != "batal" {
			invoiced[t] = true
		}
	}
	var reference any
	if ref != nil {
		reference = pgrow.New("quotation_id", ref.Get("id"), "quote_number", ref.Get("quote_number"),
			"is_accepted", ref.Str("status") == "diterima", "total", ref.Num("total"),
			"use_ppn", ref.Get("use_ppn"), "ppn_persen", ref.Num("ppn_persen"))
	}
	available := make([]*pgrow.Row, len(terms))
	for i, t := range terms {
		available[i] = pgrow.New("term_id", t.Get("id"), "label", t.Get("label"), "percent", t.Num("percent"),
			"amount", amounts[i], "due_date", t.Get("due_date"), "invoiced", invoiced[t.Str("id")])
	}
	return ok(w, pgrow.New("invoices", invoices, "reference", reference, "available_terms", available))
}

func (h *handler) createInvoice(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireFinance(r, true)
	if err != nil {
		return err
	}
	if err := h.limit(r, "sales-invoice:"+u.ID, 20, "Terlalu banyak pembuatan invoice — coba lagi sebentar"); err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	deal, err := h.require(ctx, "deal", id, u)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	termID := f.UUID("term_id", optNull)
	label := str(f.Str("label", validate.Rule{}, trimRange(1, 150)))
	amount := 0.0
	if n := f.Num("amount", validate.Rule{}, validate.NumOpts{Positive: true, Max: validate.Bound(999_999_999_999)}); n != nil {
		amount = *n
	}
	dueDate, _ := calendarOrEmpty(f, "due_date")
	note := f.Str("note", optNull, trimMax(300))
	if err := validationErr(f); err != nil {
		return err
	}
	var quotationID any
	if str(termID) != "" {
		q, err := scanID(ctx, h.db, `SELECT t.quotation_id::text
       FROM crm.crm_sales_quotation_terms t
       JOIN crm.crm_sales_quotations q ON q.id = t.quotation_id
       WHERE t.id = $1 AND q.deal_id = $2 AND q.deleted_at IS NULL`, *termID, deal.ID)
		if err != nil {
			return err
		}
		if q == nil {
			return badRequest("Termin tidak ditemukan pada quotation deal ini")
		}
		quotationID = *q
	}
	row, err := pgrow.QueryOne(ctx, h.db, `INSERT INTO crm.crm_sales_invoices
         (company_id, branch_id, deal_id, quotation_id, term_id,
          invoice_number, label, amount, due_date, note, created_by, status)
       VALUES ($1, $2, $3, $4, $5,
               'INV-' || to_char(now(), 'YYMM') || '-' ||
                 lpad(nextval('crm.crm_sales_invoice_number_seq')::text, 4, '0'),
               $6, $7, $8, $9, $10, 'diajukan')
       RETURNING id, invoice_number`,
		deal.CompanyID, deal.BranchID, deal.ID, quotationID, orNull(termID), label, domain.RoundCents(amount), orNull(dueDate), orNull(note), u.ID)
	if err != nil {
		if strings.Contains(err.Error(), "uq_crm_sales_invoices_term_active") {
			return httpx.Conflict("Termin ini sudah memiliki invoice aktif")
		}
		return err
	}
	return created(w, row, "Pengajuan invoice "+row.Str("invoice_number")+" terkirim ke Finance")
}

// requireInvoice is requireAccessibleInvoice (row: id, deal_id, status, paid).
func (h *handler) requireInvoice(ctx context.Context, id string, u user) (*pgrow.Row, error) {
	row, err := pgrow.QueryOne(ctx, h.db, `SELECT i.id, i.deal_id, i.status,
            `+paidSQL+` AS paid
     FROM crm.crm_sales_invoices i
     WHERE i.id = $1 AND i.deleted_at IS NULL`, id)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireDealChild(ctx, row, u, "Invoice tidak ditemukan"); err != nil {
		return nil, err
	}
	return row, nil
}

func (h *handler) updateInvoice(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireFinance(r, false)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	invoice, err := h.requireInvoice(ctx, id, u)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	status := str(f.Enum("status", validate.Rule{}, []string{"terkirim", "batal"}))
	if err := validationErr(f); err != nil {
		return err
	}
	if status == "batal" && invoice.Num("paid") > 0 {
		return httpx.Conflict("Invoice sudah menerima pembayaran — tidak bisa dibatalkan")
	}
	row, err := pgrow.QueryOne(ctx, h.db, `UPDATE crm.crm_sales_invoices
     SET status = $1,
         sent_at = CASE WHEN $2::text = 'terkirim' AND sent_at IS NULL THEN now() ELSE sent_at END,
         updated_at = now()
     WHERE id = $3
     RETURNING id, invoice_number, status`, status, status, id)
	if err != nil {
		return err
	}
	msg := "Invoice diperbarui"
	if status == "terkirim" && row != nil {
		// The message names the AR invoice, so accounting runs in-process
		// (rule 2); a failure is reported in the message, as in the TS.
		no, note, err := h.ports.Receivables.CreateFromSalesInvoice(ctx, h.db, id, u.ID)
		switch {
		case err != nil:
			h.log.Error("[sales-funnel] create AR invoice", "error", err)
			msg = "Invoice diperbarui (AR gagal: " + errMessage(err) + ")"
		case note != nil && *note != "":
			msg = "Invoice diperbarui (AR " + no + " (" + *note + "))"
		default:
			msg = "Invoice diperbarui (AR " + no + ")"
		}
	}
	return okMsg(w, row, msg)
}

func (h *handler) deleteInvoice(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireFinance(r, true)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	invoice, err := h.requireInvoice(ctx, id, u)
	if err != nil {
		return err
	}
	if u.Role == "sales" && invoice.Str("status") != "diajukan" {
		return httpx.Forbidden("Invoice sudah diproses Finance — hubungi finance untuk pembatalan")
	}
	if invoice.Num("paid") > 0 {
		return httpx.Conflict("Invoice sudah menerima pembayaran — tidak bisa dihapus")
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_sales_invoices
     SET deleted_at = now(), deleted_by = $2, updated_at = now()
     WHERE id = $1`, id, u.ID); err != nil {
		return err
	}
	return noContent(w)
}

/* ── Deal payments (Fase G) ──────────────────────────────────────────── */

var paymentMethods = []string{"cash", "transfer", "qris", "edc", "lainnya"}

func (h *handler) dealPayments(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireFinance(r, true)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "deal", id, u); err != nil {
		return err
	}
	payments, err := pgrow.Query(ctx, h.db, `SELECT p.id, p.amount, p.method, p.paid_on::text AS paid_on, p.note,
              p.invoice_id, inv.invoice_number,
              u.full_name AS created_by_name, p.created_at
       FROM crm.crm_sales_deal_payments p
       LEFT JOIN crm.crm_sales_invoices inv ON inv.id = p.invoice_id
       LEFT JOIN configuration.users u ON u.id = p.created_by
       WHERE p.deal_id = $1 AND p.deleted_at IS NULL
       ORDER BY p.paid_on DESC, p.created_at DESC`, id)
	if err != nil {
		return err
	}
	ref, err := h.referenceQuotation(ctx, id)
	if err != nil {
		return err
	}
	deal, err := pgrow.QueryOne(ctx, h.db, `SELECT value_final, value_estimate FROM crm.crm_sales_deals WHERE id = $1`, id)
	if err != nil {
		return err
	}
	sum := 0.0
	for _, p := range payments {
		sum += p.Num("amount")
		p.Set("amount", p.Num("amount"))
	}
	totalPaid := domain.RoundCents(sum)
	var refStatus string
	var refTotal any
	if ref != nil {
		refStatus, refTotal = ref.Str("status"), ref.Get("total")
	}
	reference := domain.ReferenceTotal(refStatus, refTotal, ref != nil, rowVal(deal, "value_final"), rowVal(deal, "value_estimate"))
	terms, err := h.loadTerms(ctx, ref)
	if err != nil {
		return err
	}
	inputs := make([]domain.TermInput, len(terms))
	for i, t := range terms {
		inputs[i] = domain.TermInput{Label: t.Str("label"), DueDate: t.StrPtr("due_date"), Percent: t.Num("percent")}
	}
	var refNumber any
	if ref != nil {
		refNumber = ref.Get("quote_number")
	}
	summary := pgrow.New("reference_total", domain.RoundCents(reference), "reference_quote_number", refNumber,
		"reference_is_accepted", refStatus == "diterima", "total_paid", totalPaid,
		"outstanding", max(0, domain.RoundCents(reference-totalPaid)))
	return ok(w, pgrow.New("payments", payments, "summary", summary, "terms", domain.TermProgressOf(inputs, reference, totalPaid)))
}

func (h *handler) createPayment(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireFinance(r, false)
	if err != nil {
		return err
	}
	if err := h.limit(r, "sales-payment:"+u.ID, 20, "Terlalu banyak pencatatan — coba lagi sebentar"); err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	deal, err := h.require(ctx, "deal", id, u)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	amount := 0.0
	if n := f.Num("amount", validate.Rule{}, validate.NumOpts{Positive: true, Max: validate.Bound(999_999_999_999)}); n != nil {
		amount = *n
	}
	method := enumDefault(f, "method", paymentMethods, "transfer")
	var paidOn string
	if v, _, done := f.Take("paid_on", "string", validate.Rule{}); !done {
		paidOn, _ = calendarDate(f, "paid_on", v)
	}
	note := f.Str("note", optNull, trimMax(300))
	invoiceID := f.UUID("invoice_id", optNull)
	if err := validationErr(f); err != nil {
		return err
	}
	if str(invoiceID) != "" {
		inv, err := scanID(ctx, h.db, `SELECT id::text FROM crm.crm_sales_invoices
       WHERE id = $1 AND deal_id = $2 AND deleted_at IS NULL AND status <> 'batal'`, *invoiceID, deal.ID)
		if err != nil {
			return err
		}
		if inv == nil {
			return badRequest("Invoice tidak ditemukan pada deal ini")
		}
	}
	row, err := pgrow.QueryOne(ctx, h.db, `INSERT INTO crm.crm_sales_deal_payments
       (company_id, branch_id, deal_id, amount, method, paid_on, note, invoice_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`, deal.CompanyID, deal.BranchID, deal.ID, domain.RoundCents(amount), method, paidOn, orNull(note), orNull(invoiceID), u.ID)
	if err != nil {
		return err
	}
	return created(w, row, "Pembayaran tercatat")
}

func (h *handler) deletePayment(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireFinance(r, false)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "deal", id, u); err != nil {
		return err
	}
	deleted, err := scanID(ctx, h.db, `UPDATE crm.crm_sales_deal_payments
     SET deleted_at = now(), deleted_by = $3, updated_at = now()
     WHERE id = $1 AND deal_id = $2 AND deleted_at IS NULL
     RETURNING id::text`, r.PathValue("paymentId"), id, u.ID)
	if err != nil {
		return err
	}
	if deleted == nil {
		return httpx.NotFound("Catatan pembayaran tidak ditemukan")
	}
	return noContent(w)
}

// errMessage is error.message as node-postgres and ApiError carry it.
func errMessage(err error) string {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return pg.Message
	}
	return err.Error()
}
