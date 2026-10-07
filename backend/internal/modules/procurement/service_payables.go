package procurement

import (
	"context"
	_ "embed"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	pscope "nuhabit/backend/internal/platform/scope"
)

// Port of lib/purchasing/vendor-invoices.ts, vendor-credit-apply.ts and the
// approval half of vendor-credit-service.ts.

// returnCreditsByPo is getReturnCreditsByPoIds: approved/completed returns
// of the POs' active GRNs.
func (s *Service) returnCreditsByPo(ctx context.Context, poIDs []string) (map[string]float64, error) {
	out := map[string]float64{}
	if len(poIDs) == 0 {
		return out, nil
	}
	rows, err := s.rows.Query(ctx, s.db, `SELECT g.purchase_order_id AS po, SUM(r.total_amount)::float8 AS amount
		FROM purchase_returns r JOIN grn g ON g.id = r.grn_id
		WHERE g.purchase_order_id = ANY($1::uuid[]) AND g.is_active = true AND r.status IN ('approved', 'completed')
		GROUP BY g.purchase_order_id`, poIDs)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.Str("po")] = r.Num("amount")
	}
	return out, nil
}

// vendorCreditsByPo is getVendorCreditsByPoIds: approved credits reduce
// their own PO except what was applied elsewhere; applications reduce the
// PO they were applied to.
func (s *Service) vendorCreditsByPo(ctx context.Context, poIDs []string) (map[string]float64, error) {
	out := map[string]float64{}
	if len(poIDs) == 0 {
		return out, nil
	}
	add := func(po string, amount float64) { out[po] = domain.RoundMoney(out[po] + amount) }
	rows, err := s.rows.Query(ctx, s.db, `SELECT g.purchase_order_id AS po, (vc.total_amount - vc.applied_amount)::float8 AS amount
		FROM vendor_credits vc JOIN grn g ON g.id = vc.grn_id
		WHERE g.purchase_order_id = ANY($1::uuid[]) AND g.is_active = true AND vc.status = 'approved'`, poIDs)
	if err != nil {
		if database.IsUndefinedTable(err) {
			return out, nil
		}
		return nil, err
	}
	for _, r := range rows {
		add(r.Str("po"), r.Num("amount"))
	}
	apps, err := s.rows.Query(ctx, s.db, `SELECT purchase_order_id AS po, amount::float8 AS amount FROM vendor_credit_applications
		WHERE purchase_order_id = ANY($1::uuid[]) AND voided_at IS NULL`, poIDs)
	if err != nil {
		if database.IsUndefinedTable(err) {
			return out, nil
		}
		return nil, err
	}
	for _, r := range apps {
		add(r.Str("po"), r.Num("amount"))
	}
	return out, nil
}

// PurchaseInvoices is listPurchaseInvoices: one payable per PO.
func (s *Service) PurchaseInvoices(ctx context.Context, moduleType string, search, status *string, scope *pscope.Scope) ([]*Row, error) {
	w := scopeFilters(newWhere(), scope).add("module_type = %s", moduleType).
		add("status IN ('approved', 'sent', 'partial', 'partially_received', 'received')").add("payable_amount > 0")
	if set(search) {
		party := "nama_supplier"
		if moduleType != "raw_material" {
			party = "vendor_name"
		}
		orIlike(w, []string{"nomor_po", party}, *search)
	}
	rows, err := s.rows.Query(ctx, s.db, `SELECT id, nomor_po, tanggal_po, status, nama_supplier, vendor_name, payable_amount, paid_amount,
		payment_term_count, next_due_date, received_percentage FROM v_purchase_orders `+w.sql()+` ORDER BY next_due_date ASC NULLS LAST`, w.args...)
	if err != nil {
		return nil, err
	}
	ids := column(rows, "id")
	returns, err := s.returnCreditsByPo(ctx, ids)
	if err != nil {
		return nil, err
	}
	credits, err := s.vendorCreditsByPo(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := []*Row{}
	for _, r := range rows {
		id := r.Str("id")
		// next_due_date is a Date in the TS, which never reads as overdue.
		a := domain.ComputePoInvoiceAmounts(r.Num("payable_amount"), returns[id], credits[id], r.Num("paid_amount"), "", s.today())
		if set(status) && *status != "all" && a.PaymentStatus != *status {
			continue
		}
		party := r.Get("nama_supplier")
		if moduleType != "raw_material" {
			party = jsOrValues(r.Get("vendor_name"), r.Get("nama_supplier"))
		}
		out = append(out, obj("purchase_order_id", id, "nomor_po", r.Get("nomor_po"), "tanggal_po", r.Get("tanggal_po"),
			"nama_supplier", party, "po_status", r.Get("status"), "gross_payable_amount", a.GrossPayable,
			"return_credit_amount", a.ReturnCredit, "reject_credit_amount", a.RejectCredit, "total_credit_amount", a.TotalCredit,
			"payable_amount", a.Payable, "paid_amount", a.Paid, "outstanding_amount", a.Outstanding,
			"payment_term_count", r.Num("payment_term_count"), "payment_progress_pct", a.PaymentProgress,
			"received_percentage", r.Num("received_percentage"), "next_due_date", r.Get("next_due_date"),
			"payment_status", a.PaymentStatus, "can_pay", a.Outstanding > 0.01))
	}
	return out, nil
}

// PoOutstanding is getPoOutstanding: nil when the PO is not in the view.
func (s *Service) PoOutstanding(ctx context.Context, poID string) (*float64, error) {
	row, err := s.rows.One(ctx, s.db, `SELECT payable_amount, paid_amount FROM v_purchase_orders WHERE id = $1::text::uuid`, poID)
	if err != nil || row == nil {
		return nil, err
	}
	returns, err := s.returnCreditsByPo(ctx, []string{poID})
	if err != nil {
		return nil, err
	}
	credits, err := s.vendorCreditsByPo(ctx, []string{poID})
	if err != nil {
		return nil, err
	}
	a := domain.ComputePoInvoiceAmounts(row.Num("payable_amount"), returns[poID], credits[poID], row.Num("paid_amount"), "", s.today())
	return &a.Outstanding, nil
}

const creditsForParty = `
	SELECT vc.id, vc.credit_number, vc.credit_date::text AS credit_date,
	       vc.total_amount::float8 AS total_amount, vc.applied_amount::float8 AS applied_amount,
	       vc.status, vc.expiry_date::text AS expiry_date,
	       po.id AS origin_po_id, po.nomor_po AS origin_po_number
	  FROM purchasing.vendor_credits vc
	  JOIN purchasing.grn g ON g.id = vc.grn_id
	  JOIN purchasing.purchase_orders po ON po.id = g.purchase_order_id
	 WHERE vc.status = 'approved'
	   AND (($1::uuid IS NOT NULL AND po.supplier_id = $1) OR ($2::uuid IS NOT NULL AND po.vendor_id = $2))
	   AND po.id <> $3
	 ORDER BY vc.credit_date, vc.created_at`

func toCredit(r *Row) domain.VendorCredit {
	return domain.VendorCredit{ID: r.Str("id"), CreditNumber: r.Str("credit_number"), CreditDate: r.Str("credit_date"),
		TotalAmount: r.Num("total_amount"), AppliedAmount: r.Num("applied_amount"), Status: r.Str("status"), ExpiryDate: r.StrPtr("expiry_date")}
}

// creditPo is loadPo of vendor-credit-apply.
func (s *Service) creditPo(ctx context.Context, q database.Querier, poID string) (*Row, error) {
	po, err := s.rows.One(ctx, q, `SELECT id, nomor_po, supplier_id, vendor_id FROM purchasing.purchase_orders WHERE id = $1::text::uuid`, poID)
	if err != nil {
		return nil, err
	}
	if po == nil {
		return nil, notFound("PO tidak ditemukan")
	}
	return po, nil
}

func (s *Service) todayJakarta() string {
	return s.now().In(Location("Asia/Jakarta")).Format("2006-01-02")
}

// CreditsForPo is listCreditsForPo: the party's credits from other POs.
func (s *Service) CreditsForPo(ctx context.Context, poID string) ([]*Row, error) {
	po, err := s.creditPo(ctx, s.db, poID)
	if err != nil {
		return nil, err
	}
	rows, err := s.rows.Query(ctx, s.db, creditsForParty, po.StrPtr("supplier_id"), po.StrPtr("vendor_id"), po.Str("id"))
	if err != nil {
		return nil, err
	}
	today := s.todayJakarta()
	for _, r := range rows {
		c := toCredit(r)
		r.Set("remaining", domain.CreditRemaining(c)).Set("expired", domain.IsCreditExpired(c, today))
	}
	return rows, nil
}

// CreditApplication is applyVendorCredits' result.
type CreditApplication struct {
	Allocations []domain.CreditAllocation `json:"allocations"`
	Remaining   float64                   `json:"remaining"`
}

// ApplyVendorCredits is applyVendorCredits: oldest usable credits cover the
// amount; a dry run only computes the allocation.
func (s *Service) ApplyVendorCredits(ctx context.Context, poID string, amount float64, dryRun bool, entry audit.Entry) (*CreditApplication, error) {
	if !(amount > 0) {
		return nil, badRequest("Jumlah kredit yang dipakai harus lebih dari 0")
	}
	po, err := s.creditPo(ctx, s.db, poID)
	if err != nil {
		return nil, err
	}
	today := s.todayJakarta()
	var out *CreditApplication
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		rows, err := s.rows.Query(ctx, tx, creditsForParty+` FOR UPDATE OF vc`, po.StrPtr("supplier_id"), po.StrPtr("vendor_id"), po.Str("id"))
		if err != nil {
			return err
		}
		credits := make([]domain.VendorCredit, len(rows))
		for i, r := range rows {
			credits[i] = toCredit(r)
		}
		allocations, remaining := domain.AllocateCredits(credits, amount, today)
		if len(allocations) == 0 {
			return httpx.Conflict("Tidak ada kredit vendor yang masih berlaku untuk pemasok ini")
		}
		out = &CreditApplication{Allocations: allocations, Remaining: remaining}
		if dryRun {
			return nil
		}
		for _, a := range allocations {
			if _, err := tx.Exec(ctx, `INSERT INTO purchasing.vendor_credit_applications (vendor_credit_id, purchase_order_id, amount, applied_by)
				VALUES ($1, $2, $3, $4)`, a.CreditID, po.Str("id"), a.Amount, entry.ActorID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE purchasing.vendor_credits SET applied_amount = applied_amount + $2, updated_at = now() WHERE id = $1`,
				a.CreditID, a.Amount); err != nil {
				return err
			}
		}
		label := po.Str("nomor_po")
		poID := po.Str("id")
		entry.Action, entry.Entity, entry.EntityID, entry.EntityLabel = "vendor_credit.apply", "purchase_order", &poID, &label
		entry.After = obj("requested", amount, "allocations", allocations, "uncovered", remaining)
		return audit.Write(ctx, tx, entry)
	})
	return out, err
}

// ApproveVendorCredit is approveVendorCredit.
func (s *Service) ApproveVendorCredit(ctx context.Context, id, approverID string, expiry *string) (*Row, error) {
	credit, err := s.rows.One(ctx, s.db, `SELECT id, status, total_amount, credit_number, source_type FROM vendor_credits WHERE id = $1::text::uuid`, id)
	if err != nil {
		return nil, err
	}
	if credit == nil {
		return nil, notFound("Vendor credit not found")
	}
	switch {
	case credit.Str("source_type") == "receive_reject" || credit.Str("source_type") == "qc_reject":
		return nil, badRequest("Kredit tolak penerimaan/QC tidak disetujui dari GRN. Kekurangan ditagihkan lewat sisa qty PO; tutup PO bila supplier tidak mengganti.")
	case credit.Str("status") != "draft" && credit.Str("status") != "pending_approval":
		return nil, badRequest("Vendor credit can only be approved from draft or pending approval")
	case credit.Num("total_amount") <= 0.0001:
		return nil, badRequest("Vendor credit has no amount to approve")
	}
	sets := "status = 'approved', approved_by = $2, approved_at = $3, updated_at = $3"
	args := []any{credit.Str("id"), approverID, s.now().UTC().Format("2006-01-02T15:04:05.000Z")}
	if deref(expiry) != "" {
		sets += ", expiry_date = $4::text::date"
		args = append(args, *expiry)
	}
	return s.rows.One(ctx, s.db, `UPDATE vendor_credits SET `+sets+` WHERE id = $1 RETURNING *`, args...)
}

//go:embed openapi.json
var openAPIDoc string

// openAPISpec is the static document of GET /api/purchasing/docs/spec with
// the servers url filled in (appOrigin() || "http://localhost:3000").
func openAPISpec(origin string) []byte {
	if origin == "" {
		origin = "http://localhost:3000"
	}
	quoted, _ := marshalJS(origin)
	return []byte(strings.Replace(openAPIDoc, `"__APP_ORIGIN__"`, string(quoted), 1))
}
