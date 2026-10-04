package salesfunnel

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// lib/sales-funnel/quotations.ts and quotations-server.ts

const quoteNumberSQL = `'QT-' || to_char(now(), 'YYMM') || '-' || lpad(nextval('crm.crm_sales_quotation_number_seq')::text, 4, '0')`

// requireQuotation is requireAccessibleQuotation: access follows the deal.
func (h *handler) requireQuotation(ctx context.Context, id string, u user) (*pgrow.Row, *accessible, error) {
	row, err := pgrow.QueryOne(ctx, h.db, `SELECT id, deal_id, status, stock_deducted_at, company_id, branch_id, parent_quotation_id
     FROM crm.crm_sales_quotations WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return nil, nil, err
	}
	deal, err := h.requireDealChild(ctx, row, u, "Quotation tidak ditemukan")
	return row, deal, err
}

func (h *handler) listDealQuotations(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "deal", id, u); err != nil {
		return err
	}
	rows, err := pgrow.Query(ctx, h.db, `SELECT q.id, q.quote_number, q.status, q.use_ppn, q.ppn_persen,
            q.subtotal, q.ppn_nominal, q.total, q.notes, q.valid_until,
            q.discount_percent, q.discount_nominal, q.approval_status, q.approval_request_id,
            q.version, q.parent_quotation_id, q.superseded_at,
            q.stock_deducted_at, q.bom_status, q.created_at,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'id', i.id, 'item_type', i.item_type,
                 'product_id', i.product_id, 'description', i.description,
                 'qty', i.qty, 'unit_price', i.unit_price,
                 'line_total', i.line_total
               ) ORDER BY i.sort_order)
               FROM crm.crm_sales_quotation_items i
               WHERE i.quotation_id = q.id),
              '[]'::json
            ) AS items,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'id', t.id, 'label', t.label, 'percent', t.percent,
                 'due_date', t.due_date
               ) ORDER BY t.sort_order)
               FROM crm.crm_sales_quotation_terms t
               WHERE t.quotation_id = q.id),
              '[]'::json
            ) AS terms
     FROM crm.crm_sales_quotations q
     WHERE q.deal_id = $1 AND q.deleted_at IS NULL
     ORDER BY q.created_at DESC
     LIMIT 20`, id)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

// parseQuotationPayload is quotationPayloadSchema on f.
func parseQuotationPayload(f *validate.Form) *domain.QuotationPayload {
	p := &domain.QuotationPayload{UsePpn: f.BoolDefault("use_ppn", true), PpnPersen: 11}
	if n := f.Num("ppn_persen", validate.Rule{HasDefault: true}, numRange(0, 100)); n != nil {
		p.PpnPersen = *n
	}
	if n := f.Num("discount_percent", validate.Rule{HasDefault: true}, numRange(0, 100)); n != nil {
		p.DiscountPercent = *n
	}
	p.Notes = f.Str("notes", optNull, trimMax(2000))
	p.ValidUntil, _ = calendarOrEmpty(f, "valid_until")
	items := f.List("items", validate.Rule{}, 100, func(sub *validate.Form, i int, v any) {
		start := len(sub.Issues())
		it := sub.Item(i, v)
		item := domain.QuotationItem{ItemType: enumDefault(it, "item_type", []string{"produk", "bebas"}, "bebas")}
		item.ProductID = it.UUID("product_id", optNull)
		item.Description = str(it.Str("description", validate.Rule{}, trimRange(1, 300)))
		if n := it.Num("qty", validate.Rule{}, validate.NumOpts{Positive: true, Max: validate.Bound(100_000)}); n != nil {
			item.Qty = *n
		}
		if n := it.Num("unit_price", validate.Rule{}, numRange(0, 999_999_999)); n != nil {
			item.UnitPrice = *n
		}
		if it.Fields() != nil && !abortedSince(sub, start) {
			if item.ItemType == "produk" && str(item.ProductID) == "" {
				sub.Fail(i, "custom", "Baris produk wajib memilih produk katalog")
			}
			if float64(item.Qty*item.UnitPrice) > domain.MaxLineTotal {
				sub.Fail(i, "custom", "Jumlah baris melebihi batas nilai (12 digit)")
			}
		}
		p.Items = append(p.Items, item)
	})
	if items != nil && len(items) < 1 {
		f.Fail("items", "too_small", "Too small: expected array to have >=1 items")
	}
	start := len(f.Issues())
	p.Terms = []domain.QuotationTerm{}
	terms := f.List("terms", validate.Rule{HasDefault: true}, 12, func(sub *validate.Form, i int, v any) {
		it := sub.Item(i, v)
		term := domain.QuotationTerm{Label: str(it.Str("label", validate.Rule{}, trimRange(1, 100)))}
		if n := it.Num("percent", validate.Rule{}, validate.NumOpts{Positive: true, Max: validate.Bound(100)}); n != nil {
			term.Percent = *n
		}
		if d, _ := calendarOrEmpty(it, "due_date"); str(d) != "" {
			term.DueDate = d
		}
		p.Terms = append(p.Terms, term)
	})
	if (terms != nil || !has(f, "terms")) && !abortedSince(f, start) && !domain.TermsSumTo100(p.Terms) {
		f.Fail("terms", "custom", "Total persentase termin harus tepat 100%")
	}
	return p
}

// assertProducts is validateProducts: every catalog product must be active.
func (h *handler) assertProducts(ctx context.Context, q database.Querier, p *domain.QuotationPayload) error {
	seen := map[string]bool{}
	var ids []string
	for _, it := range p.Items {
		if it.ItemType == "produk" && str(it.ProductID) != "" && !seen[*it.ProductID] {
			seen[*it.ProductID] = true
			ids = append(ids, *it.ProductID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	n, err := h.ports.Catalog.ActiveProductCount(ctx, q, ids)
	if err != nil {
		return err
	}
	if n != len(ids) {
		return badRequest("Ada produk yang tidak ditemukan atau nonaktif di katalog")
	}
	return nil
}

// insertItems writes every line in one statement.
func insertItems(ctx context.Context, tx database.Querier, quotationID string, items []domain.QuotationItem) error {
	if len(items) == 0 {
		return nil
	}
	var values []any
	rows := make([]string, len(items))
	for i, it := range items {
		var product any
		if it.ItemType == "produk" {
			product = ptrAny(it.ProductID)
		}
		values = append(values, quotationID, it.ItemType, product, it.Description, it.Qty, it.UnitPrice, it.LineTotal, i)
		b := i * 8
		rows[i] = "($" + strconv.Itoa(b+1) + ", $" + strconv.Itoa(b+2) + ", $" + strconv.Itoa(b+3) + ", $" + strconv.Itoa(b+4) +
			", $" + strconv.Itoa(b+5) + ", $" + strconv.Itoa(b+6) + ", $" + strconv.Itoa(b+7) + ", $" + strconv.Itoa(b+8) + ")"
	}
	_, err := tx.Exec(ctx, `INSERT INTO crm.crm_sales_quotation_items
       (quotation_id, item_type, product_id, description, qty,
        unit_price, line_total, sort_order)
     VALUES `+strings.Join(rows, ", "), values...)
	return err
}

// insertTerms writes the payment terms in one statement.
func insertTerms(ctx context.Context, tx database.Querier, quotationID string, terms []domain.QuotationTerm) error {
	if len(terms) == 0 {
		return nil
	}
	var values []any
	rows := make([]string, len(terms))
	for i, t := range terms {
		values = append(values, quotationID, t.Label, t.Percent, ptrAny(t.DueDate), i)
		b := i * 5
		rows[i] = "($" + strconv.Itoa(b+1) + ", $" + strconv.Itoa(b+2) + ", $" + strconv.Itoa(b+3) + ", $" + strconv.Itoa(b+4) + ", $" + strconv.Itoa(b+5) + ")"
	}
	_, err := tx.Exec(ctx, `INSERT INTO crm.crm_sales_quotation_terms
       (quotation_id, label, percent, due_date, sort_order)
     VALUES `+strings.Join(rows, ", "), values...)
	return err
}

func (h *handler) createQuotation(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
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
	p := parseQuotationPayload(f)
	if err := validationErr(f); err != nil {
		return err
	}
	totals := domain.ComputeTotals(p)
	var row *pgrow.Row
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		if err := h.assertProducts(ctx, tx, p); err != nil {
			return err
		}
		if row, err = pgrow.QueryOne(ctx, tx, `INSERT INTO crm.crm_sales_quotations
         (company_id, branch_id, deal_id, quote_number, use_ppn,
          ppn_persen, subtotal, ppn_nominal, total, notes, valid_until,
          created_by, discount_percent, discount_nominal)
       VALUES ($1, $2, $3, `+quoteNumberSQL+`, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, quote_number, total`,
			deal.CompanyID, deal.BranchID, deal.ID, p.UsePpn, p.PpnPersen, totals.Subtotal, totals.PpnNominal, totals.Total,
			orNull(p.Notes), orNull(p.ValidUntil), u.ID, p.DiscountPercent, totals.DiscountNominal); err != nil {
			return err
		}
		qid := row.Str("id")
		if err := insertItems(ctx, tx, qid, p.Items); err != nil {
			return err
		}
		if err := insertTerms(ctx, tx, qid, p.Terms); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE crm.crm_sales_deals SET value_estimate = $1, updated_at = now() WHERE id = $2 AND closed_at IS NULL`,
			totals.Total, deal.ID); err != nil {
			return err
		}
		if err := requestApproval(ctx, tx, qid, u.ID); err != nil {
			return err
		}
		return emit(ctx, tx, crmEvent{eventType: "quotation.created", subjectType: "quotation", subjectID: qid,
			companyID: deal.CompanyID, branchID: deal.BranchID, actorID: u.ID,
			payload: map[string]any{"total": totals.Total, "discount_percent": p.DiscountPercent}})
	})
	if err != nil {
		return err
	}
	return created(w, row, "Quotation "+row.Str("quote_number")+" dibuat")
}

const frozenQuotation = "Quotation sudah direalisasi — isi tidak bisa diubah"

// releaseBlocked is releaseBlockedMessage.
func releaseBlocked(approvalStatus, action string) string {
	if approvalStatus == "pending" {
		return "Quotation menunggu approval diskon — belum boleh " + action
	}
	return "Approval diskon quotation DITOLAK — ubah diskon lalu ajukan lagi"
}

// canRelease is canReleaseQuotation.
func canRelease(status string) bool { return status == "none" || status == "approved" }

func (h *handler) updateQuotation(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	quotation, _, err := h.requireQuotation(ctx, id, u)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	status := str(f.Enum("status", opt, domain.QuotationStatuses))
	var p *domain.QuotationPayload
	if has(f, "payload") {
		if c := f.Child("payload"); c.Fields() != nil {
			p = parseQuotationPayload(c)
		}
	}
	if err := validationErr(f); err != nil {
		return err
	}
	if status == "" && p == nil {
		return badRequest(domain.NoFieldsChanged)
	}
	if p != nil && quotation.Get("stock_deducted_at") != nil {
		return httpx.Conflict(frozenQuotation)
	}
	var row *pgrow.Row
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		if p != nil {
			if err := h.assertProducts(ctx, tx, p); err != nil {
				return err
			}
			t := domain.ComputeTotals(p)
			tag, err := tx.Exec(ctx, `UPDATE crm.crm_sales_quotations
         SET use_ppn = $1, ppn_persen = $2, subtotal = $3,
             ppn_nominal = $4, total = $5, notes = $6,
             valid_until = $7, discount_percent = $9, discount_nominal = $10,
             updated_at = now()
         WHERE id = $8 AND stock_deducted_at IS NULL`,
				p.UsePpn, p.PpnPersen, t.Subtotal, t.PpnNominal, t.Total, orNull(p.Notes), orNull(p.ValidUntil), id, p.DiscountPercent, t.DiscountNominal)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return httpx.Conflict(frozenQuotation)
			}
			if _, err := tx.Exec(ctx, `DELETE FROM crm.crm_sales_quotation_items WHERE quotation_id = $1`, id); err != nil {
				return err
			}
			if err := insertItems(ctx, tx, id, p.Items); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM crm.crm_sales_quotation_terms WHERE quotation_id = $1`, id); err != nil {
				return err
			}
			if err := insertTerms(ctx, tx, id, p.Terms); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE crm.crm_sales_deals SET value_estimate = $1, updated_at = now() WHERE id = $2 AND closed_at IS NULL`,
				t.Total, quotation.Str("deal_id")); err != nil {
				return err
			}
		}
		if status != "" {
			if status == "terkirim" || status == "diterima" {
				approval, err := scanNullable(ctx, tx, `SELECT approval_status FROM crm.crm_sales_quotations WHERE id = $1`, id)
				if err != nil {
					return err
				}
				state := "none"
				if approval != nil {
					state = *approval
				}
				if !canRelease(state) {
					return httpx.Conflict(releaseBlocked(state, "dikirim/diterima"))
				}
			}
			if _, err := tx.Exec(ctx, `UPDATE crm.crm_sales_quotations SET status = $1, updated_at = now() WHERE id = $2`, status, id); err != nil {
				return err
			}
			if status == "diterima" {
				if _, err := tx.Exec(ctx, `UPDATE crm.crm_sales_deals d
           SET value_estimate = q.total, updated_at = now()
           FROM crm.crm_sales_quotations q
           WHERE q.id = $1 AND d.id = q.deal_id AND d.closed_at IS NULL`, id); err != nil {
					return err
				}
			}
		}
		if row, err = pgrow.QueryOne(ctx, tx, `SELECT id, quote_number, status, total FROM crm.crm_sales_quotations WHERE id = $1`, id); err != nil {
			return err
		}
		if p != nil {
			if err := requestApproval(ctx, tx, id, u.ID); err != nil {
				return err
			}
		}
		eventType, statusPayload := "quotation.updated", any(nil)
		if status != "" {
			eventType, statusPayload = "quotation.status_changed", status
		}
		return emit(ctx, tx, crmEvent{eventType: eventType, subjectType: "quotation", subjectID: id,
			companyID: quotation.Str("company_id"), branchID: quotation.Str("branch_id"), actorID: u.ID,
			payload: map[string]any{"status": statusPayload}})
	})
	if err != nil {
		return err
	}
	return okMsg(w, row, "Quotation diperbarui")
}

func (h *handler) deleteQuotation(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	quotation, _, err := h.requireQuotation(ctx, id, u)
	if err != nil {
		return err
	}
	const frozen = "Quotation sudah direalisasi — tidak bisa dihapus"
	if quotation.Get("stock_deducted_at") != nil {
		return httpx.Conflict(frozen)
	}
	deleted := false
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE crm.crm_sales_quotations
       SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND stock_deducted_at IS NULL`, id)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		deleted = true
		_, err = tx.Exec(ctx, `UPDATE crm.crm_sales_deals d
       SET value_estimate = (
             SELECT q.total FROM crm.crm_sales_quotations q
             WHERE q.deal_id = d.id AND q.deleted_at IS NULL
             ORDER BY q.created_at DESC LIMIT 1
           ),
           updated_at = now()
       WHERE d.id = $1 AND d.closed_at IS NULL`, quotation.Str("deal_id"))
		return err
	})
	if err != nil {
		return err
	}
	if !deleted {
		return httpx.Conflict(frozen)
	}
	return noContent(w)
}

func (h *handler) reviseQuotation(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	src, deal, err := h.requireQuotation(ctx, id, u)
	if err != nil {
		return err
	}
	if src.Str("status") == "superseded" {
		return httpx.Conflict("Versi ini sudah digantikan — buat revisi dari versi terbaru")
	}
	rootID := src.Str("parent_quotation_id")
	if rootID == "" {
		rootID = id
	}
	var row *pgrow.Row
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		var latest int
		if err := tx.QueryRow(ctx, `SELECT COALESCE(max(version), 1) FROM crm.crm_sales_quotations WHERE (id = $1 OR parent_quotation_id = $1) AND deleted_at IS NULL`,
			rootID).Scan(&latest); err != nil {
			return err
		}
		if row, err = pgrow.QueryOne(ctx, tx, `INSERT INTO crm.crm_sales_quotations
         (company_id, branch_id, deal_id, quote_number, use_ppn, ppn_persen, subtotal, ppn_nominal, total,
          notes, valid_until, created_by, discount_percent, discount_nominal, version, parent_quotation_id, status)
       SELECT company_id, branch_id, deal_id, `+quoteNumberSQL+`,
              use_ppn, ppn_persen, subtotal, ppn_nominal, total, notes, valid_until, $2, discount_percent, discount_nominal,
              $3, $4, 'draft'
       FROM crm.crm_sales_quotations WHERE id = $1
       RETURNING id, quote_number, version`, id, u.ID, latest+1, rootID); err != nil {
			return err
		}
		newID := row.Str("id")
		if _, err := tx.Exec(ctx, `INSERT INTO crm.crm_sales_quotation_items (quotation_id, item_type, product_id, description, qty, unit_price, line_total, sort_order)
       SELECT $2, item_type, product_id, description, qty, unit_price, line_total, sort_order
       FROM crm.crm_sales_quotation_items WHERE quotation_id = $1`, id, newID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO crm.crm_sales_quotation_terms (quotation_id, label, percent, due_date, sort_order)
       SELECT $2, label, percent, due_date, sort_order FROM crm.crm_sales_quotation_terms WHERE quotation_id = $1`, id, newID); err != nil {
			return err
		}
		if src.Get("stock_deducted_at") == nil {
			if _, err := tx.Exec(ctx, `UPDATE crm.crm_sales_quotations SET status = 'superseded', superseded_at = now(), updated_at = now() WHERE id = $1`, id); err != nil {
				return err
			}
		}
		if err := requestApproval(ctx, tx, newID, u.ID); err != nil {
			return err
		}
		return emit(ctx, tx, crmEvent{eventType: "quotation.created", subjectType: "quotation", subjectID: newID,
			companyID: deal.CompanyID, branchID: deal.BranchID, actorID: u.ID,
			payload: map[string]any{"revised_from": id, "version": row.Get("version")}})
	})
	if err != nil {
		return err
	}
	return created(w, row, "Revisi v"+strconv.FormatInt(row.Get("version").(int64), 10)+" dibuat")
}

/* ── Stock realisation (Fase F3) ─────────────────────────────────────── */

// shortage is Shortage: the shortfall plus the material labels.
type shortage struct {
	RawMaterialID string  `json:"raw_material_id"`
	Needed        float64 `json:"needed"`
	Available     float64 `json:"available"`
	Kode          *string `json:"kode"`
	Nama          string  `json:"nama"`
	Satuan        *string `json:"satuan"`
}

// insufficientStock is InsufficientStockError: a 409 with the shortages
// and warnings at the top level of the body.
type insufficientStock struct {
	Shortages []shortage
	Warnings  []string
}

func (e *insufficientStock) Error() string { return "Stok bahan baku tidak mencukupi" }

func (h *handler) realizeQuotation(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	if !h.limiter.allow("sales-funnel-realize:"+u.ID, 10, h.now()) {
		return tooMany("Terlalu banyak percobaan realisasi — coba lagi sebentar")
	}
	ctx, id := r.Context(), r.PathValue("id")
	_, deal, err := h.requireQuotation(ctx, id, u)
	if err != nil {
		return err
	}
	body, present := validate.ReadBody(r)
	if !present {
		body = map[string]any{}
	}
	f := validate.New(body, true)
	force := f.BoolDefault("force_skip_bom", false)
	if err := validationErr(f); err != nil {
		return err
	}
	var result *pgrow.Row
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		result, err = h.realize(ctx, tx, u, id, deal.BranchID, force)
		return err
	})
	var stockErr *insufficientStock
	if errors.As(err, &stockErr) {
		return httpx.JSON(w, http.StatusConflict, struct {
			Success   bool       `json:"success"`
			Error     string     `json:"error"`
			Shortages []shortage `json:"shortages"`
			Warnings  []string   `json:"warnings"`
		}{false, stockErr.Error(), stockErr.Shortages, stockErr.Warnings})
	}
	if err != nil {
		return err
	}
	msg := "Realisasi dicatat TANPA memotong BOM"
	if result.Str("bomStatus") == "terpotong" {
		msg = "Realisasi selesai — " + strconv.Itoa(result.Get("movedCount").(int)) + " pergerakan stok dicatat"
	}
	return okMsg(w, result, msg)
}

// realize is realizeQuotation: lock the quotation, compute the material
// needs from the recipes, lock the venue stock, deduct it (largest warehouse
// first) and freeze the quotation. The stock writes run through the Stock
// port on this transaction: the 409 and the frozen quotation depend on them.
func (h *handler) realize(ctx context.Context, tx pgx.Tx, u user, quotationID, branchID string, force bool) (*pgrow.Row, error) {
	q, err := pgrow.QueryOne(ctx, tx, `SELECT status, stock_deducted_at, quote_number
     FROM crm.crm_sales_quotations
     WHERE id = $1 AND deleted_at IS NULL
     FOR UPDATE`, quotationID)
	if err != nil {
		return nil, err
	}
	switch {
	case q == nil:
		return nil, httpx.Conflict("Quotation tidak ditemukan")
	case q.Get("stock_deducted_at") != nil:
		return nil, httpx.Conflict("Quotation sudah direalisasi sebelumnya")
	case q.Str("status") != "diterima":
		return nil, httpx.Conflict("Hanya quotation berstatus Diterima yang bisa direalisasi")
	}
	quoteNumber := q.Str("quote_number")
	lines, err := pgrow.Query(ctx, tx, `SELECT product_id::text AS product_id, qty::text AS qty FROM crm.crm_sales_quotation_items
     WHERE quotation_id = $1 AND item_type = 'produk' AND product_id IS NOT NULL`, quotationID)
	if err != nil {
		return nil, err
	}
	var products []ProductQty
	var productIDs []string
	for _, l := range lines {
		products = append(products, ProductQty{ProductID: l.Str("product_id"), Qty: l.Str("qty")})
		productIDs = append(productIDs, l.Str("product_id"))
	}
	var requirements []domain.MaterialRequirement
	warnings := []string{}
	if len(products) > 0 {
		if requirements, err = h.ports.Catalog.MaterialNeeds(ctx, tx, products); err != nil {
			return nil, err
		}
		names, err := h.ports.Catalog.ProductsWithoutRecipe(ctx, tx, productIDs)
		if err != nil {
			return nil, err
		}
		for _, name := range names {
			warnings = append(warnings, `Produk "`+name+`" belum punya resep — tidak ada bahan yang dipotong untuknya`)
		}
	}
	bomStatus, moved := "tidak-terpotong", 0
	if !force {
		if len(requirements) == 0 {
			return nil, &insufficientStock{Shortages: []shortage{},
				Warnings: append(warnings, "Tidak ada resep produk yang bisa dipotong — lanjutkan tanpa potong BOM?")}
		}
		ids := make([]string, len(requirements))
		for i, req := range requirements {
			ids[i] = req.RawMaterialID
		}
		stock, err := h.ports.Stock.LockStock(ctx, tx, branchID, ids)
		if err != nil {
			return nil, err
		}
		if shortfalls := domain.FindShortfalls(requirements, stock); len(shortfalls) > 0 {
			shortages := []shortage{}
			for _, sf := range shortfalls {
				info, err := h.ports.Stock.Material(ctx, tx, sf.RawMaterialID)
				if err != nil {
					return nil, err
				}
				name := sf.RawMaterialID
				if info.Found {
					name = info.Nama
				}
				shortages = append(shortages, shortage{RawMaterialID: sf.RawMaterialID, Needed: sf.Needed, Available: sf.Available,
					Kode: info.Kode, Nama: name, Satuan: info.Satuan})
			}
			return nil, &insufficientStock{Shortages: shortages, Warnings: warnings}
		}
		for _, step := range domain.PlanDeductions(requirements, stock) {
			if err := h.ports.Stock.Deduct(ctx, tx, StockMove{Step: step, QuotationID: quotationID, QuoteNumber: quoteNumber,
				UserID: u.ID, BranchID: branchID}); err != nil {
				return nil, err
			}
			moved++
		}
		bomStatus = "terpotong"
	}
	if _, err := tx.Exec(ctx, `UPDATE crm.crm_sales_quotations
     SET stock_deducted_at = now(), bom_status = $1, realized_by = $2, updated_at = now()
     WHERE id = $3`, bomStatus, u.ID, quotationID); err != nil {
		return nil, err
	}
	return pgrow.New("bomStatus", bomStatus, "movedCount", moved, "warnings", warnings), nil
}

/* ── Quotation summary over WhatsApp (Fase F2) ───────────────────────── */

func (h *handler) sendQuotationWa(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	_, deal, err := h.requireQuotation(ctx, id, u)
	if err != nil {
		return err
	}
	q, err := pgrow.QueryOne(ctx, h.db, `SELECT q.deal_id, q.quote_number, q.status, q.use_ppn,
            q.ppn_persen, q.subtotal, q.ppn_nominal, q.total, q.notes,
            q.valid_until::text AS valid_until, q.approval_status,
            d.title AS deal_title, d.event_date::text AS event_date,
            l.org_name, l.pic_name, l.pic_phone, b.name AS branch_name
     FROM crm.crm_sales_quotations q
     JOIN crm.crm_sales_deals d ON d.id = q.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN configuration.branches b ON b.id = q.branch_id
     WHERE q.id = $1 AND q.deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if q == nil {
		return httpx.NotFound("Quotation tidak ditemukan")
	}
	approval := q.Str("approval_status")
	if approval == "" {
		approval = "none"
	}
	if !canRelease(approval) {
		return httpx.Conflict(releaseBlocked(approval, "dikirim"))
	}
	gw := h.ports.Gateway.LoadGateway(ctx, h.db)
	if gw == nil {
		return httpx.Status(http.StatusServiceUnavailable, "WA gateway belum dikonfigurasi")
	}
	if err := h.assertWaCooldown(ctx, q.Str("deal_id")); err != nil {
		return err
	}
	target, err := requireValidPhone(q.Str("pic_phone"), "No. WA PIC tidak valid")
	if err != nil {
		return err
	}
	items, err := pgrow.Query(ctx, h.db, `SELECT description, item_type, qty, unit_price, line_total
     FROM crm.crm_sales_quotation_items
     WHERE quotation_id = $1 ORDER BY sort_order ASC`, id)
	if err != nil {
		return err
	}
	waItems := make([]domain.QuotationWaItem, len(items))
	for i, it := range items {
		waItems[i] = domain.QuotationWaItem{Description: it.Str("description"), ItemType: it.Str("item_type"),
			Qty: domain.ToNumber(it.Get("qty")), UnitPrice: domain.ToNumber(it.Get("unit_price")), LineTotal: domain.ToNumber(it.Get("line_total"))}
	}
	text := domain.BuildQuotationWaMessage(domain.QuotationWaSummary{
		QuoteNumber: q.Str("quote_number"), BranchName: q.StrPtr("branch_name"), PicName: q.Str("pic_name"),
		DealTitle: q.Str("deal_title"), OrgName: q.Str("org_name"), UsePpn: q.Bool("use_ppn"),
		PpnPersen: q.Num("ppn_persen"), Subtotal: domain.ToNumber(q.Get("subtotal")), PpnNominal: domain.ToNumber(q.Get("ppn_nominal")),
		Total: domain.ToNumber(q.Get("total")), EventDate: q.StrPtr("event_date"), ValidUntil: q.StrPtr("valid_until"), Notes: q.StrPtr("notes"),
	}, waItems)
	messageID, err := h.sendWaText(ctx, gw, target, text)
	if err != nil {
		return err
	}
	picName := q.Str("pic_name")
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO crm.crm_sales_activities
         (company_id, branch_id, deal_id, activity_type, notes, done_at, owner_user_id, created_by)
       VALUES ($1, $2, $3, 'wa', $4, now(), $5, $5)`, deal.CompanyID, deal.BranchID, deal.ID,
			"Kirim quotation "+q.Str("quote_number")+" ("+domain.FormatRupiah(domain.ToNumber(q.Get("total")))+") ke "+picName, u.ID); err != nil {
			return err
		}
		if q.Str("status") == "draft" {
			_, err := tx.Exec(ctx, `UPDATE crm.crm_sales_quotations SET status = 'terkirim', updated_at = now() WHERE id = $1 AND status = 'draft'`, id)
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}
	return okMsg(w, pgrow.New("message_id", messageID), "Quotation terkirim ke "+picName)
}
