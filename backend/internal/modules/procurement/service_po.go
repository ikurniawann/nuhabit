package procurement

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	contracts "nuhabit/backend/internal/contracts/procurement"
	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
	pscope "nuhabit/backend/internal/platform/scope"
)

// Port of lib/purchasing/po-queries.ts, po-create.ts, po-lifecycle.ts,
// po-payment-terms.ts, po-payments.ts, po.ts and pr-convert.ts.

/* ── Convert PR → PO ─────────────────────────────────────────────────── */

// ConvertPrToPo is convertPrToPo: an approved raw-material PR becomes a
// draft PO priced from the supplier's purchase history.
func (s *Service) ConvertPrToPo(ctx context.Context, prID string, in prConvertInput, userID string, scope *pscope.Scope) (*Row, error) {
	pr, err := s.rows.One(ctx, s.db, `SELECT id, status, converted_po_id, company_id, branch_id FROM purchase_requests WHERE id = $1::text::uuid`, prID)
	if err != nil || pr == nil {
		return nil, notFound("PR tidak ditemukan")
	}
	if pr.Str("status") != domain.PrApproved {
		return nil, badRequest("PR harus approved sebelum dibuatkan PO")
	}
	if pr.Str("converted_po_id") != "" {
		return nil, badRequest("PR sudah dibuatkan PO")
	}
	items, err := s.rows.Query(ctx, s.db, `SELECT id, raw_material_id, satuan_id, qty, estimated_price, description FROM pr_items WHERE pr_id = $1`, pr.Str("id"))
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, badRequest("PR tidak memiliki item")
	}
	var requests []PriceRequest
	for _, item := range items {
		if id := item.Str("raw_material_id"); id != "" {
			requests = append(requests, PriceRequest{RawMaterialID: id, SatuanID: item.StrPtr("satuan_id")})
		}
	}
	prices := map[string]float64{}
	if len(requests) > 0 {
		unitPrices, err := s.ports.Pricing.UnitPrices(ctx, s.db, requests, in.SupplierID)
		if err != nil {
			return nil, err
		}
		for i, r := range requests {
			prices[r.RawMaterialID] = unitPrices[i]
		}
	}

	var poID string
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		number, err := s.nextNumber(ctx, tx, "purchase_orders", "nomor_po", domain.DailyPrefix("PO", s.now().In(s.loc)))
		if err != nil {
			return err
		}
		tanggal := s.now().UTC().Format("2006-01-02")
		if in.TanggalPo != nil {
			tanggal = *in.TanggalPo
		}
		company := firstNonNil(pr.StrPtr("company_id"), pscope.EffectiveCompanyID(scope))
		branch := firstNonNil(pr.StrPtr("branch_id"), pscope.EffectiveBranchID(scope))
		if err := tx.QueryRow(ctx, `INSERT INTO purchase_orders
			(nomor_po, pr_id, supplier_id, company_id, branch_id, tanggal_po, tanggal_kirim_estimasi, status,
			 diskon_persen, diskon_nominal, ppn_persen, catatan, alamat_pengiriman, created_by, updated_by, is_active)
			VALUES ($1, $2, $3::text::uuid, $4, $5, $6::text::date, $7::text::date, 'draft', $8, $9, $10, $11, $12, $13, $13, true)
			RETURNING id::text`,
			number, pr.Str("id"), in.SupplierID, company, branch, tanggal, in.TanggalKirim,
			in.DiskonPersen, in.DiskonNominal, in.PpnPersen, nonEmpty(in.Catatan), nonEmpty(in.AlamatPengiriman), userID).Scan(&poID); err != nil {
			return err
		}
		lines := make([]domain.PoLine, 0, len(items))
		for _, item := range items {
			material := item.Str("raw_material_id")
			if material == "" {
				return badRequest("Item PR belum terhubung ke master bahan baku")
			}
			price := item.Num("estimated_price")
			if suggested := prices[material]; suggested > 0 {
				price = domain.JSRound(suggested)
			}
			qty := item.Num("qty")
			if _, err := tx.Exec(ctx, `INSERT INTO purchase_order_items
				(purchase_order_id, pr_item_id, raw_material_id, qty_ordered, satuan_id, harga_satuan, diskon_item, catatan, is_active)
				VALUES ($1, $2, $3, $4, $5, $6, 0, $7, true)`,
				poID, item.Str("id"), material, qty, item.StrPtr("satuan_id"), price, item.StrPtr("description")); err != nil {
				return err
			}
			lines = append(lines, domain.PoLine{Qty: qty, Price: price})
		}
		t := domain.ComputePoTotals(domain.SumPoLines(lines), &in.DiskonPersen, &in.DiskonNominal, &in.PpnPersen)
		if _, err := tx.Exec(ctx, `UPDATE purchase_orders SET subtotal = $2, diskon_nominal = $3, ppn_nominal = $4, total = $5, updated_at = $6 WHERE id = $1`,
			poID, t.Subtotal, t.DiskonNominal, t.PpnNominal, t.Total, s.now()); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE purchase_requests SET status = 'converted', converted_po_id = $2, updated_at = $3 WHERE id = $1`,
			pr.Str("id"), poID, s.now())
		return err
	})
	if err != nil {
		return nil, err
	}
	po, err := s.rows.One(ctx, s.db, `SELECT * FROM v_purchase_orders WHERE id = $1`, poID)
	if err != nil {
		return nil, err
	}
	if po == nil {
		return nil, errNoRows
	}
	return po, nil
}

// nonEmpty is `value || null` for an optional string.
func nonEmpty(v *string) *string {
	if v == nil || *v == "" {
		return nil
	}
	return v
}

/* ── List and detail ─────────────────────────────────────────────────── */

// PoListParams are the GET /po query params.
type PoListParams struct {
	Search, Status, SupplierID, VendorID *string
	ModuleType                           string
	TanggalMulai, TanggalSampai          *string
	IncludeCancelled                     bool
	Page, Limit                          int
}

// PoList is the GET /po body.
type PoList struct {
	Success    bool         `json:"success"`
	Data       []*Row       `json:"data"`
	Pagination PoPagination `json:"pagination"`
}

// PoPagination uses snake_case total_pages (unlike the PR list).
type PoPagination struct {
	Page       int `json:"page"`
	Limit      int `json:"limit"`
	Total      int `json:"total"`
	TotalPages any `json:"total_pages"`
}

func set(p *string) bool { return p != nil && *p != "" }

// ListPurchaseOrders is listPurchaseOrders.
func (s *Service) ListPurchaseOrders(ctx context.Context, p PoListParams, scope *pscope.Scope) (*PoList, error) {
	w := newWhere()
	if c := pscope.CompanyFilter(scope); c != nil {
		w.add("company_id = %s::text::uuid", *c)
	}
	if b := pscope.BranchFilter(scope); b != nil {
		w.add("branch_id = %s::text::uuid", *b)
	}
	usesVendor := p.ModuleType == "product" || p.ModuleType == "general"
	if set(p.Search) {
		party := "nama_supplier"
		if usesVendor {
			party = "vendor_name"
		}
		// .or("nomor_po.ilike.%x%,party.ilike.%x%"): "*" in the value is a wildcard too.
		pattern := strings.ReplaceAll("%"+*p.Search+"%", "*", "%")
		w.add("(nomor_po ILIKE %s OR "+party+" ILIKE %s)", pattern, pattern)
	}
	if set(p.Status) {
		w.add("status = %s", strings.ToLower(*p.Status))
	}
	if set(p.SupplierID) {
		w.add("supplier_id = %s::text::uuid", *p.SupplierID)
	}
	if set(p.VendorID) {
		w.add("vendor_id = %s::text::uuid", *p.VendorID)
	}
	if usesVendor || p.ModuleType == "raw_material" {
		w.add("module_type = %s", p.ModuleType)
	}
	if set(p.TanggalMulai) {
		w.add("tanggal_po >= %s::text::date", *p.TanggalMulai)
	}
	if set(p.TanggalSampai) {
		w.add("tanggal_po <= %s::text::date", *p.TanggalSampai)
	}
	if !p.IncludeCancelled {
		w.add("status <> %s", "cancelled")
	}
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM v_purchase_orders `+w.sql(), w.args...).Scan(&total); err != nil {
		return nil, err
	}
	limit := w.next(p.Limit)
	offset := w.next((p.Page - 1) * p.Limit)
	rows, err := s.rows.Query(ctx, s.db, `SELECT * FROM v_purchase_orders `+w.sql()+` ORDER BY created_at DESC LIMIT `+limit+` OFFSET `+offset, w.args...)
	if err != nil {
		return nil, err
	}
	poIDs := column(rows, "id")
	deliveries := map[string][]*Row{}
	if len(poIDs) > 0 {
		list, err := s.rows.Query(ctx, s.db, `SELECT id, purchase_order_id, nomor_resi, no_surat_jalan, status, created_at FROM deliveries
			WHERE purchase_order_id = ANY($1::uuid[]) AND is_active = true AND status <> 'cancelled' ORDER BY created_at DESC`, poIDs)
		if err != nil {
			return nil, err
		}
		for _, d := range list {
			deliveries[d.Str("purchase_order_id")] = append(deliveries[d.Str("purchase_order_id")], d)
		}
	}
	prNumbers := map[string]any{}
	if prIDs := uniqueStrings(column(rows, "pr_id")); len(prIDs) > 0 {
		list, err := s.rows.Query(ctx, s.db, `SELECT id, pr_number FROM purchase_requests WHERE id = ANY($1::uuid[])`, prIDs)
		if err != nil {
			return nil, err
		}
		for _, pr := range list {
			prNumbers[pr.Str("id")] = pr.Get("pr_number")
		}
	}
	for _, po := range rows {
		var prNumber any
		if id := po.Str("pr_id"); id != "" {
			prNumber = prNumbers[id]
		}
		po.Set("pr_number", prNumber)
		setDeliverySummary(po, deliveries[po.Str("id")])
	}
	return &PoList{Success: true, Data: rows, Pagination: PoPagination{Page: p.Page, Limit: p.Limit, Total: total, TotalPages: totalPages(total, p.Limit)}}, nil
}

// setDeliverySummary is summarizePoDelivery: the open delivery wins, else
// the latest (deliveries are newest first).
func setDeliverySummary(po *Row, deliveries []*Row) {
	var open, latest *Row
	for _, d := range deliveries {
		if domain.IsOpenDeliveryStatus(d.Str("status")) {
			open = d
			break
		}
	}
	if len(deliveries) > 0 {
		latest = deliveries[0]
	}
	firstStr := func(values ...string) any {
		for _, v := range values {
			if v != "" {
				return v
			}
		}
		return nil
	}
	str := func(r *Row, key string) string {
		if r == nil {
			return ""
		}
		return r.Str(key)
	}
	po.Set("active_delivery_id", firstStr(str(open, "id")))
	po.Set("active_delivery_number", firstStr(str(open, "nomor_resi"), str(open, "no_surat_jalan"), str(latest, "nomor_resi"), str(latest, "no_surat_jalan")))
	po.Set("active_delivery_status", firstStr(str(open, "status"), str(latest, "status")))
}

// PurchaseOrderDetail is getPurchaseOrderDetail.
func (s *Service) PurchaseOrderDetail(ctx context.Context, id string) (*Row, error) {
	po, err := s.rows.One(ctx, s.db, `SELECT * FROM v_purchase_orders WHERE id = $1::text::uuid`, id)
	if err != nil {
		return nil, err
	}
	if po == nil {
		return nil, notFound("PO tidak ditemukan")
	}
	items, err := s.rows.Query(ctx, s.db, `SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 AND is_active = true ORDER BY created_at ASC`, po.Str("id"))
	if err != nil {
		return nil, err
	}
	if err := s.embedPoDetailRefs(ctx, items); err != nil {
		return nil, err
	}
	deliveries, err := s.rows.Query(ctx, s.db, `SELECT id, nomor_resi, no_surat_jalan, status, created_at FROM deliveries
		WHERE purchase_order_id = $1 AND is_active = true AND status <> 'cancelled' ORDER BY created_at DESC`, po.Str("id"))
	if err != nil {
		return nil, err
	}
	credits, err := s.poCreditBreakdown(ctx, s.db, po.Str("id"))
	if err != nil {
		return nil, err
	}
	gross := firstNumber(po, "payable_amount", "grand_total", "total")
	// next_due_date reaches computePoInvoiceAmounts as a Date, which the TS
	// interpolates into an invalid date: the overdue branch never fires.
	invoice := domain.ComputePoInvoiceAmounts(gross, credits.Return, credits.Reject, po.Num("paid_amount"), "", s.today())
	progress, err := s.fulfillment(ctx, po.Str("id"), po.Str("status"), firstNumber(po, "received_percentage", "receive_percentage", "progress_pct"))
	if err != nil {
		return nil, err
	}
	setInvoice(po, invoice)
	po.Set("order_progress_pct", progress.Order)
	po.Set("qc_progress_pct", progress.QC)
	po.Set("return_progress_pct", progress.Return)
	po.Set("fulfillment_progress_pct", progress.Overall)
	po.Set("total_qty_received_grn", progress.Received)
	po.Set("total_qty_qc_posted", progress.QCPosted)
	po.Set("total_qty_returned", progress.Returned)
	setDeliverySummary(po, deliveries)
	po.Set("items", items)
	return po, nil
}

// firstNumber is Number(a ?? b ?? c ?? 0) over row keys.
func firstNumber(r *Row, keys ...string) float64 {
	for _, k := range keys {
		if r.Get(k) != nil {
			return r.Num(k)
		}
	}
	return 0
}

func setInvoice(po *Row, in domain.InvoiceAmounts) {
	po.Set("gross_payable_amount", in.GrossPayable)
	po.Set("return_credit_amount", in.ReturnCredit)
	po.Set("reject_credit_amount", in.RejectCredit)
	po.Set("total_credit_amount", in.TotalCredit)
	po.Set("payable_amount", in.Payable)
	po.Set("paid_amount", in.Paid)
	po.Set("outstanding_amount", in.Outstanding)
	po.Set("payment_progress_pct", in.PaymentProgress)
	po.Set("payment_status", in.PaymentStatus)
}

// today is the local calendar day (new Date() with setHours(0,0,0,0)).
func (s *Service) today() time.Time { return s.now().In(s.loc) }

// embedPoDetailRefs adds raw_material (*, plus satuan_besar/satuan_kecil),
// product, satuan and supply_item to the PO detail items.
func (s *Service) embedPoDetailRefs(ctx context.Context, items []*Row) error {
	materials, err := s.ports.Catalog.Refs(ctx, s.db, EntityRawMaterial, "*", uniqueStrings(column(items, "raw_material_id")))
	if err != nil {
		return err
	}
	products, err := s.ports.Catalog.Refs(ctx, s.db, EntityProduct, "id, kode, nama, satuan_id", uniqueStrings(column(items, "product_id")))
	if err != nil {
		return err
	}
	units, err := s.ports.Catalog.Refs(ctx, s.db, EntityUnit, "*", uniqueStrings(column(items, "satuan_id")))
	if err != nil {
		return err
	}
	var unitIDs []string
	parsed := make([]*Row, len(items))
	for i, item := range items {
		if raw, ok := materials[item.Str("raw_material_id")]; ok && item.Str("raw_material_id") != "" {
			rm, err := decodeRow(raw)
			if err != nil {
				return err
			}
			parsed[i] = rm
			unitIDs = append(unitIDs, rm.Str("satuan_besar_id"), rm.Str("satuan_kecil_id"))
		}
	}
	unitIDs = uniqueStrings(unitIDs)
	if len(unitIDs) > 0 {
		small, err := s.ports.Catalog.Refs(ctx, s.db, EntityUnit, "id, nama, kode", unitIDs)
		if err != nil {
			return err
		}
		for _, rm := range parsed {
			if rm == nil {
				continue
			}
			rm.Set("satuan_besar", refOrNull(small, rm.Str("satuan_besar_id")))
			rm.Set("satuan_kecil", refOrNull(small, rm.Str("satuan_kecil_id")))
		}
	}
	supplyIDs := uniqueStrings(column(items, "supply_item_id"))
	var supplies map[string]json.RawMessage
	if len(supplyIDs) > 0 {
		if supplies, err = s.ports.Catalog.Refs(ctx, s.db, EntitySupplyItem, "id, kode, nama, satuan_id, stockable", supplyIDs); err != nil {
			return err
		}
	}
	for i, item := range items {
		if parsed[i] != nil {
			item.Set("raw_material", parsed[i])
		} else {
			item.Set("raw_material", nil)
		}
		item.Set("product", refOrNull(products, item.Str("product_id")))
		item.Set("satuan", refOrNull(units, item.Str("satuan_id")))
		if len(supplyIDs) > 0 {
			item.Set("supply_item", refOrNull(supplies, item.Str("supply_item_id")))
		}
	}
	return nil
}

// creditBreakdown is getPoCreditBreakdown.
type creditBreakdown struct{ Return, Reject float64 }

// poCreditBreakdown sums approved/completed purchase returns of the PO's
// active GRNs and the open-quantity shortage.
func (s *Service) poCreditBreakdown(ctx context.Context, q database.Querier, poID string) (creditBreakdown, error) {
	var ret float64
	if err := q.QueryRow(ctx, `SELECT COALESCE(SUM(r.total_amount), 0)::float8 FROM purchase_returns r
		WHERE r.grn_id IN (SELECT id FROM grn WHERE purchase_order_id = $1 AND is_active = true)
		  AND r.status IN ('approved', 'completed')`, poID).Scan(&ret); err != nil {
		return creditBreakdown{}, err
	}
	lines, received, err := s.poShortageLines(ctx, q, poID)
	if err != nil {
		s.log.ErrorContext(ctx, "[getPoCreditBreakdown] falling back to return credits only", "error", err)
		return creditBreakdown{Return: ret}, nil
	}
	return creditBreakdown{Return: ret, Reject: domain.ShortageAmount(lines, received)}, nil
}

func (s *Service) poShortageLines(ctx context.Context, q database.Querier, poID string) ([]domain.PoLine, []float64, error) {
	rows, err := s.rows.Query(ctx, q, `SELECT qty_ordered, qty_received, harga_satuan FROM purchase_order_items WHERE purchase_order_id = $1 AND is_active = true`, poID)
	if err != nil {
		return nil, nil, err
	}
	lines := make([]domain.PoLine, len(rows))
	received := make([]float64, len(rows))
	for i, r := range rows {
		lines[i] = domain.PoLine{Qty: r.Num("qty_ordered"), Price: r.Num("harga_satuan")}
		received[i] = r.Num("qty_received")
	}
	return lines, received, nil
}

// fulfillment is computePoFulfillmentProgress.
func (s *Service) fulfillment(ctx context.Context, poID, status string, receivingPct float64) (domain.Fulfillment, error) {
	if status == "" {
		status = domain.PoDraft
	}
	rows, err := s.rows.Query(ctx, s.db, `SELECT qty_diterima, qty_qc_posted, qty_returned FROM grn_items
		WHERE grn_id IN (SELECT id FROM grn WHERE purchase_order_id = $1 AND is_active = true) AND is_active = true`, poID)
	if err != nil {
		return domain.Fulfillment{}, err
	}
	var received, posted, returned float64
	for _, r := range rows {
		received += r.Num("qty_diterima")
		posted += r.Num("qty_qc_posted")
		returned += r.Num("qty_returned")
	}
	return domain.ComputeFulfillment(status, receivingPct, received, posted, returned), nil
}

/* ── Form data ───────────────────────────────────────────────────────── */

// PoFormData is loadPoFormData.
func (s *Service) PoFormData(ctx context.Context, moduleType string, scope *pscope.Scope) (any, error) {
	company, branch := pscope.CompanyFilter(scope), pscope.BranchFilter(scope)
	units, err := s.ports.Catalog.ActiveUnits(ctx, s.db, "id, nama, kode")
	if err != nil {
		units = []*Row{}
	}
	switch moduleType {
	case "product":
		vendors := s.vendorsForUsage(ctx, company, branch, "fnb")
		products, err := s.productsWithSkus(ctx, company, branch)
		if err != nil {
			return nil, err
		}
		return struct {
			Vendors  []*Row `json:"vendors"`
			Products []*Row `json:"products"`
			Units    []*Row `json:"units"`
		}{vendors, products, units}, nil
	case "general":
		vendors := s.vendorsForUsage(ctx, company, branch, "operasional")
		supplies, err := s.ports.Catalog.FormSupplies(ctx, s.db, company, branch)
		if err != nil {
			supplies = []*Row{}
		}
		return struct {
			Vendors  []*Row `json:"vendors"`
			Supplies []*Row `json:"supplies"`
			Units    []*Row `json:"units"`
		}{vendors, supplies, units}, nil
	}
	suppliers, err := s.rows.Query(ctx, s.db, `SELECT id, kode, nama_supplier FROM suppliers WHERE is_active = true ORDER BY nama_supplier ASC`)
	if err != nil {
		suppliers = []*Row{}
	}
	materials, err := s.ports.Catalog.FormMaterials(ctx, s.db)
	if err != nil {
		materials = []*Row{}
	}
	return struct {
		Suppliers []*Row `json:"suppliers"`
		Materials []*Row `json:"materials"`
		Units     []*Row `json:"units"`
	}{suppliers, materials, units}, nil
}

// vendorsForUsage is loadVendorsForUsage (errors read as an empty list).
func (s *Service) vendorsForUsage(ctx context.Context, company, branch *string, usage string) []*Row {
	w := newWhere().add("is_active = %s", true).add("usage_scope IN (%s, %s)", usage, "keduanya")
	if company != nil {
		w.add("company_id = %s::text::uuid", *company)
	}
	if branch != nil {
		w.add("branch_id = %s::text::uuid", *branch)
	}
	rows, err := s.rows.Query(ctx, s.db, `SELECT id, code, name FROM vendors `+w.sql()+` ORDER BY name ASC`, w.args...)
	if err != nil {
		return []*Row{}
	}
	return rows
}

// productsWithSkus is loadProductsWithSkus: scoped products with their
// active merchandise SKUs under pos_skus.
func (s *Service) productsWithSkus(ctx context.Context, company, branch *string) ([]*Row, error) {
	products, err := s.ports.Catalog.FormProducts(ctx, s.db, company, branch)
	if err != nil {
		return []*Row{}, nil
	}
	ids := column(products, "id")
	skus := map[string][]*Row{}
	if len(ids) > 0 {
		rows, err := s.ports.Catalog.MerchandiseSkus(ctx, s.db, ids)
		if err != nil {
			rows = nil
		}
		for _, sku := range rows {
			if !sku.Bool("is_active") {
				continue
			}
			skus[sku.Str("source_product_id")] = append(skus[sku.Str("source_product_id")],
				obj("id", sku.Get("id"), "product_id", sku.Get("product_id"), "sku", sku.Get("sku"),
					"name", sku.Get("name"), "options", sku.Get("options"), "stock_quantity", sku.Get("stock_quantity")))
		}
	}
	for _, p := range products {
		list := skus[p.Str("id")]
		if list == nil {
			list = []*Row{}
		}
		p.Set("pos_skus", list)
	}
	return products, nil
}

/* ── Create ──────────────────────────────────────────────────────────── */

// CreatePurchaseOrder is createPurchaseOrder: a draft PO with its lines; a
// linked PR is marked converted.
func (s *Service) CreatePurchaseOrder(ctx context.Context, moduleType string, in *poCreateInput, scope *pscope.Scope) (*Row, error) {
	if moduleType == "raw_material" && in.PrID == nil {
		return nil, badRequest("Purchase order must be created from an approved purchase request")
	}
	company, branch, err := s.resolvePoBusinessIDs(ctx, in, scope)
	if err != nil {
		return nil, err
	}
	if moduleType == "product" {
		if err := s.assertProductSkuLines(ctx, in.Items); err != nil {
			return nil, err
		}
	}
	lines := make([]domain.PoLine, len(in.Items))
	for i, l := range in.Items {
		lines[i] = domain.PoLine{Qty: l.Qty, Price: l.Price}
	}
	t := domain.ComputePoTotals(domain.SumPoLines(lines), &in.DiskonPersen, &in.DiskonNominal, &in.PpnPersen)
	var po *Row
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		number, err := s.nextNumber(ctx, tx, "purchase_orders", "nomor_po", domain.MonthlyPrefix("PO", s.now().In(s.loc)))
		if err != nil {
			return err
		}
		po, err = s.rows.One(ctx, tx, `INSERT INTO purchase_orders
			(pr_id, tanggal_kirim_estimasi, catatan, alamat_pengiriman, diskon_persen, diskon_nominal, ppn_persen, source_type,
			 tanggal_po, production_order_id, source_reference, nomor_po, company_id, branch_id, module_type,
			 supplier_id, vendor_id, status, subtotal, ppn_nominal, total, is_active)
			VALUES ($1, $2::text::date, $3, $4, $5, $6, $7, $8, $9::text::date, $10, $11, $12, $13, $14, $15, $16, $17,
			        'draft', $18, $19, $20, true) RETURNING *`,
			in.PrID, in.TanggalKirimEstimasi, in.Catatan, in.AlamatPengiriman, in.DiskonPersen, t.DiskonNominal, in.PpnPersen, in.SourceType,
			in.TanggalPo, in.ProductionOrderID, in.SourceReference, number, company, branch, moduleType,
			in.SupplierID, in.VendorID, t.Subtotal, t.PpnNominal, t.Total)
		if err != nil {
			return err
		}
		for _, l := range in.Items {
			if _, err := tx.Exec(ctx, `INSERT INTO purchase_order_items
				(purchase_order_id, pr_item_id, satuan_id, qty_ordered, harga_satuan, catatan, is_active,
				 product_id, raw_material_id, supply_item_id, pos_sku_id)
				VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10)`,
				po.Str("id"), nonEmpty(l.PrItemID), nonEmpty(l.SatuanID), l.Qty, l.Price, nonEmpty(l.Notes),
				l.ProductID, l.RawMaterialID, l.SupplyItemID, nonEmpty(l.PosSkuID)); err != nil {
				return err
			}
		}
		if in.PrID != nil {
			_, err = tx.Exec(ctx, `UPDATE purchase_requests SET status = 'converted', converted_po_id = $2, updated_at = $3
				WHERE id = $1 AND status = 'approved' AND converted_po_id IS NULL`, *in.PrID, po.Str("id"), s.now())
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return po, nil
}

// resolvePoBusinessIDs is resolvePoBusinessIds: user scope, then the source
// PR (must be approved and unconverted), then the supplier/vendor row.
func (s *Service) resolvePoBusinessIDs(ctx context.Context, in *poCreateInput, scope *pscope.Scope) (*string, *string, error) {
	company, branch := pscope.EffectiveCompanyID(scope), pscope.EffectiveBranchID(scope)
	if in.PrID != nil {
		pr, err := s.rows.One(ctx, s.db, `SELECT id, status, converted_po_id, company_id, branch_id FROM purchase_requests WHERE id = $1::text::uuid`, *in.PrID)
		if err != nil {
			pr = nil
		}
		if pr == nil {
			return nil, nil, notFound("PR tidak ditemukan")
		}
		if pr.Str("status") != domain.PrApproved {
			return nil, nil, badRequest("PR harus approved sebelum dibuatkan PO")
		}
		if pr.Str("converted_po_id") != "" {
			return nil, nil, badRequest("PR sudah dibuatkan PO")
		}
		company = firstNonNil(pr.StrPtr("company_id"), company)
		branch = firstNonNil(pr.StrPtr("branch_id"), branch)
	}
	if company != nil && branch != nil {
		return company, branch, nil
	}
	table, id := "suppliers", in.SupplierID
	if in.VendorID != nil {
		table, id = "vendors", in.VendorID
	}
	party, err := s.rows.One(ctx, s.db, `SELECT company_id, branch_id FROM `+table+` WHERE id = $1::text::uuid`, *id)
	if err != nil {
		return nil, nil, err
	}
	var partyCompany, partyBranch *string
	if party != nil {
		partyCompany, partyBranch = party.StrPtr("company_id"), party.StrPtr("branch_id")
	}
	var scopeCompany, scopeBranch *string
	if scope != nil {
		scopeCompany = scope.CompanyID
		if scope.BusinessScope != nil && *scope.BusinessScope == "branch" {
			scopeBranch = scope.BranchID
		}
	}
	return firstNonNil(company, partyCompany, scopeCompany), firstNonNil(branch, partyBranch, scopeBranch), nil
}

// assertProductSkuLines checks variant products name a SKU they own.
func (s *Service) assertProductSkuLines(ctx context.Context, items []poLineInput) error {
	var ids []string
	lines := make([]domain.SkuLine, len(items))
	for i, item := range items {
		ids = append(ids, *item.ProductID)
		lines[i] = domain.SkuLine{ProductID: *item.ProductID, PosSkuID: item.PosSkuID}
	}
	rows, err := s.ports.Catalog.MerchandiseSkus(ctx, s.db, uniqueStrings(ids))
	if err != nil {
		return err
	}
	owners := make([]domain.SkuOwner, len(rows))
	variants := map[string]bool{}
	for i, r := range rows {
		owners[i] = domain.SkuOwner{ID: r.Str("id"), SourceProductID: r.Str("source_product_id"), IsActive: r.Bool("is_active")}
		if owners[i].IsActive {
			variants[owners[i].SourceProductID] = true
		}
	}
	if msg := domain.ValidatePoLinesAgainstSkus(lines, owners, variants); msg != "" {
		return badRequest(msg)
	}
	return nil
}

/* ── Lifecycle ───────────────────────────────────────────────────────── */

// findPurchaseOrder is findPurchaseOrderOr404 (any lookup error is a 404).
func (s *Service) findPurchaseOrder(ctx context.Context, q database.Querier, id string) (*Row, error) {
	po, err := s.rows.One(ctx, q, `SELECT * FROM purchase_orders WHERE id = $1::text::uuid`, id)
	if err != nil || po == nil {
		return nil, notFound("PO tidak ditemukan")
	}
	return po, nil
}

// UpdateDraftPurchaseOrder is updateDraftPurchaseOrder.
func (s *Service) UpdateDraftPurchaseOrder(ctx context.Context, id string, in *poUpdateInput) (*Row, error) {
	po, err := s.findPurchaseOrder(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if po.Str("status") != domain.PoDraft {
		return nil, badRequest("PO hanya bisa diedit saat status draft")
	}
	items, err := s.rows.Query(ctx, s.db, `SELECT qty_ordered, harga_satuan, diskon_item FROM purchase_order_items WHERE purchase_order_id = $1 AND is_active = true`, po.Str("id"))
	if err != nil {
		return nil, err
	}
	lines := make([]domain.PoLine, len(items))
	for i, item := range items {
		lines[i] = domain.PoLine{Qty: item.Num("qty_ordered"), Price: item.Num("harga_satuan"), Discount: item.Num("diskon_item")}
	}
	pick := func(override *float64, key string) *float64 {
		if override != nil {
			return override
		}
		if po.Get(key) == nil {
			return nil
		}
		return domain.Ptr(po.Num(key))
	}
	t := domain.ComputePoTotals(domain.SumPoLines(lines), pick(in.DiskonPersen, "diskon_persen"), pick(in.DiskonNominal, "diskon_nominal"), pick(in.PpnPersen, "ppn_persen"))
	values := map[string]any{"subtotal": t.Subtotal, "diskon_nominal": t.DiskonNominal, "ppn_nominal": t.PpnNominal, "total": t.Total, "updated_at": s.now()}
	cols := []string{}
	for _, k := range in.fields {
		if _, overridden := values[k]; !overridden {
			cols = append(cols, k)
		}
	}
	cols = append(cols, "subtotal", "diskon_nominal", "ppn_nominal", "total", "updated_at")
	args := []any{po.Str("id")}
	sets := make([]string, len(cols))
	for i, c := range cols {
		v, ok := values[c]
		if !ok {
			v = in.values[c]
		}
		args = append(args, v)
		sets[i] = c + " = $" + strconv.Itoa(len(args)) + poColumnCast(c)
	}
	return s.rows.One(ctx, s.db, `UPDATE purchase_orders SET `+strings.Join(sets, ", ")+` WHERE id = $1 RETURNING *`, args...)
}

// poColumnCast lets PostgreSQL parse user strings for typed columns.
func poColumnCast(col string) string {
	switch col {
	case "supplier_id":
		return "::text::uuid"
	case "tanggal_po", "tanggal_kirim_estimasi":
		return "::text::date"
	}
	return ""
}

// openLines reads the active raw material lines whose open quantity feeds
// qty_on_order.
func (s *Service) openLines(ctx context.Context, q database.Querier, poID string) ([]contracts.OnOrderLine, int, error) {
	rows, err := s.rows.Query(ctx, q, `SELECT raw_material_id, satuan_id, qty_ordered, qty_received FROM purchase_order_items WHERE purchase_order_id = $1 AND is_active = true`, poID)
	if err != nil {
		return nil, 0, err
	}
	var lines []contracts.OnOrderLine
	for _, r := range rows {
		open := domain.OpenQty(r.Num("qty_ordered"), r.Num("qty_received"))
		if r.Str("raw_material_id") != "" && open > 0 {
			lines = append(lines, contracts.OnOrderLine{RawMaterialID: r.Str("raw_material_id"), SatuanID: r.StrPtr("satuan_id"), OpenQty: open})
		}
	}
	return lines, len(rows), nil
}

func publishOnOrder(ctx context.Context, tx pgx.Tx, poID string, direction int, lines []contracts.OnOrderLine) error {
	if len(lines) == 0 {
		return nil
	}
	return outbox.Publish(ctx, tx, contracts.TopicPurchaseOrderOnOrderChanged, poID, contracts.PurchaseOrderOnOrderChanged{
		PurchaseOrderID: poID, Direction: direction, Lines: lines,
	})
}

// VoidPurchaseOrder is voidPurchaseOrder (DELETE /po/:id).
func (s *Service) VoidPurchaseOrder(ctx context.Context, id string) error {
	po, err := s.findPurchaseOrder(ctx, s.db, id)
	if err != nil {
		return err
	}
	status := strings.ToLower(po.Str("status"))
	if status == domain.PoReceived {
		return badRequest("PO yang sudah diterima tidak bisa dibatalkan")
	}
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var lines []contracts.OnOrderLine
		if domain.HoldsOnOrderQty(status) {
			if lines, _, err = s.openLines(ctx, tx, po.Str("id")); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE purchase_orders SET status = 'cancelled', is_active = false, cancelled_at = $2 WHERE id = $1`, po.Str("id"), s.now()); err != nil {
			return err
		}
		return publishOnOrder(ctx, tx, po.Str("id"), -1, lines)
	})
}

// CancelPurchaseOrder is cancelPurchaseOrder; it returns the row before and after.
func (s *Service) CancelPurchaseOrder(ctx context.Context, id, reason string) (*Row, *Row, error) {
	before, err := s.findPurchaseOrder(ctx, s.db, id)
	if err != nil {
		return nil, nil, err
	}
	switch before.Str("status") {
	case domain.PoReceived:
		return nil, nil, badRequest("PO yang sudah diterima sepenuhnya tidak bisa dibatalkan")
	case domain.PoCancelled:
		return nil, nil, badRequest("PO sudah dibatalkan sebelumnya")
	}
	after, err := s.rows.One(ctx, s.db, `UPDATE purchase_orders SET status = 'cancelled', is_active = false, cancelled_at = $2,
		cancellation_reason = $3, updated_at = $2 WHERE id = $1 RETURNING *`, before.Str("id"), s.now(), reason)
	return before, after, err
}

// ApprovePurchaseOrder is approvePurchaseOrder.
func (s *Service) ApprovePurchaseOrder(ctx context.Context, id string) (*Row, *Row, error) {
	before, err := s.findPurchaseOrder(ctx, s.db, id)
	if err != nil {
		return nil, nil, err
	}
	if before.Str("status") != domain.PoDraft {
		return nil, nil, badRequest("PO hanya bisa diapprove saat status draft")
	}
	var n int
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM purchase_order_items WHERE purchase_order_id = $1 AND is_active = true`, before.Str("id")).Scan(&n); err != nil || n == 0 {
		return nil, nil, badRequest("PO tidak memiliki item. Tambahkan item terlebih dahulu.")
	}
	after, err := s.rows.One(ctx, s.db, `UPDATE purchase_orders SET status = 'approved', approved_at = $2, updated_at = $2 WHERE id = $1 RETURNING *`, before.Str("id"), s.now())
	return before, after, err
}

// SendPurchaseOrder is sendPurchaseOrder: open raw material quantity goes
// on order (outbox, applied by inventory).
func (s *Service) SendPurchaseOrder(ctx context.Context, id, sentVia string) (*Row, error) {
	po, err := s.findPurchaseOrder(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if po.Str("status") != domain.PoApproved {
		return nil, badRequest("PO harus diapprove terlebih dahulu sebelum dikirim")
	}
	var out *Row
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		lines, count, err := s.openLines(ctx, tx, po.Str("id"))
		if err != nil {
			return err
		}
		if count == 0 {
			return badRequest("PO tidak memiliki item untuk dikirim")
		}
		out, err = s.rows.One(ctx, tx, `UPDATE purchase_orders SET status = 'sent', sent_via = $2, sent_at = $3, updated_at = $3 WHERE id = $1 RETURNING *`,
			po.Str("id"), sentVia, s.now())
		if err != nil {
			return err
		}
		return publishOnOrder(ctx, tx, po.Str("id"), 1, lines)
	})
	return out, err
}

// ClosePurchaseOrder is closePurchaseOrder.
func (s *Service) ClosePurchaseOrder(ctx context.Context, id, reason, userID string) (*Row, error) {
	trimmed := strings.TrimSpace(reason)
	if trimmed == "" {
		return nil, badRequest("Alasan penutupan wajib diisi")
	}
	po, err := s.rows.One(ctx, s.db, `SELECT id, status FROM purchase_orders WHERE id = $1::text::uuid`, id)
	if err != nil || po == nil {
		return nil, notFound("Purchase order tidak ditemukan")
	}
	if msg := domain.PoTransitionError(po.Str("status"), domain.PoClosed); msg != "" {
		return nil, badRequest(msg)
	}
	if err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error { return s.cancelDraftRejectCredits(ctx, tx, po.Str("id")) }); err != nil {
		s.log.ErrorContext(ctx, "[closePurchaseOrder] cancel draft credits (non-fatal)", "error", err)
	}
	updated, err := s.rows.One(ctx, s.db, `UPDATE purchase_orders SET status = 'closed', closed_at = $2, closed_by = $3, close_reason = $4,
		updated_at = $2, updated_by = $3 WHERE id = $1 RETURNING id, status`, po.Str("id"), s.now(), userID, trimmed)
	if err != nil {
		return nil, plainError(err)
	}
	if updated == nil {
		return nil, plainError(errNoRows)
	}
	return updated, nil
}

// cancelDraftRejectCredits is cancelDraftRejectCreditsForPo: editable
// reject credits of the PO's GRNs are emptied and cancelled.
func (s *Service) cancelDraftRejectCredits(ctx context.Context, q database.Querier, poID string) error {
	rows, err := q.Query(ctx, `SELECT id::text FROM vendor_credits
		WHERE grn_id IN (SELECT id FROM grn WHERE purchase_order_id = $1 AND is_active = true)
		  AND source_type IN ('receive_reject', 'qc_reject') AND status IN ('draft', 'pending_approval')`, poID)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := q.Exec(ctx, `DELETE FROM vendor_credit_items WHERE vendor_credit_id = $1`, id); err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `UPDATE vendor_credits SET status = 'cancelled', total_amount = 0,
			reason_notes = 'Dibatalkan saat PO ditutup — kekurangan dihitung dari sisa qty', updated_at = $2 WHERE id = $1`, id, s.now()); err != nil {
			return err
		}
	}
	return nil
}

/* ── Items ───────────────────────────────────────────────────────────── */

// ListPurchaseOrderItems is listPurchaseOrderItems.
func (s *Service) ListPurchaseOrderItems(ctx context.Context, poID string, withSku bool) ([]*Row, error) {
	items, err := s.rows.Query(ctx, s.db, `SELECT * FROM purchase_order_items WHERE purchase_order_id = $1::text::uuid AND is_active = true ORDER BY created_at ASC`, poID)
	if err != nil {
		return nil, err
	}
	refs := []struct {
		key, idCol string
		entity     Entity
		cols       string
	}{
		{"raw_material", "raw_material_id", EntityRawMaterial, "id, nama, kode"},
		{"product", "product_id", EntityProduct, "id, nama, kode"},
		{"satuan", "satuan_id", EntityUnit, "id, nama, kode"},
	}
	if withSku {
		refs = append(refs, struct {
			key, idCol string
			entity     Entity
			cols       string
		}{"pos_sku", "pos_sku_id", EntityPosSku, "id, sku, name"})
	}
	for _, ref := range refs {
		m, err := s.ports.Catalog.Refs(ctx, s.db, ref.entity, ref.cols, uniqueStrings(column(items, ref.idCol)))
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			item.Set(ref.key, refOrNull(m, item.Str(ref.idCol)))
		}
	}
	return items, nil
}

// AddPurchaseOrderItem is addPurchaseOrderItem.
func (s *Service) AddPurchaseOrderItem(ctx context.Context, poID string, in *poItemCreateInput) (*Row, error) {
	po, err := s.findPurchaseOrder(ctx, s.db, poID)
	if err != nil {
		return nil, err
	}
	if po.Str("status") != domain.PoDraft {
		return nil, badRequest("Item hanya bisa ditambahkan saat PO status draft")
	}
	existing, err := s.rows.One(ctx, s.db, `SELECT id FROM purchase_order_items WHERE purchase_order_id = $1 AND raw_material_id = $2::text::uuid AND is_active = true`,
		po.Str("id"), in.RawMaterialID)
	if err == nil && existing != nil {
		return nil, badRequest("Bahan ini sudah ada di PO. Silakan update item yang ada.")
	}
	return s.rows.One(ctx, s.db, `INSERT INTO purchase_order_items
		(raw_material_id, pr_item_id, qty_ordered, satuan_id, harga_satuan, diskon_item, catatan, purchase_order_id, is_active)
		VALUES ($1::text::uuid, $2::text::uuid, $3, $4::text::uuid, $5, $6, $7, $8, true) RETURNING *`,
		in.RawMaterialID, in.PrItemID, in.Qty, in.SatuanID, in.Price, in.Diskon, in.Catatan, po.Str("id"))
}

/* ── Payment terms ───────────────────────────────────────────────────── */

// PoPaymentTerms is listPoPaymentTerms.
func (s *Service) PoPaymentTerms(ctx context.Context, poID string) (any, error) {
	terms, err := s.rows.Query(ctx, s.db, `SELECT * FROM purchase_order_payment_terms WHERE purchase_order_id = $1::text::uuid AND is_active = true ORDER BY term_no ASC`, poID)
	if err != nil {
		return nil, err
	}
	payments, err := s.rows.Query(ctx, s.db, `SELECT * FROM vendor_payments WHERE purchase_order_id = $1::text::uuid AND status <> 'void' ORDER BY payment_date DESC`, poID)
	if err != nil {
		return nil, err
	}
	return struct {
		Terms    []*Row `json:"terms"`
		Payments []*Row `json:"payments"`
	}{terms, payments}, nil
}

// payableContext is getPoPayableContext.
type payableContext struct {
	SupplierID, VendorID *string
	Payable, Outstanding float64
}

func (s *Service) poPayableContext(ctx context.Context, q database.Querier, poID string) (*payableContext, error) {
	po, err := s.rows.One(ctx, q, `SELECT id, supplier_id, vendor_id, total, subtotal, diskon_nominal, ppn_nominal FROM purchase_orders WHERE id = $1::text::uuid`, poID)
	if err != nil || po == nil {
		return nil, err
	}
	view, err := s.rows.One(ctx, q, `SELECT payable_amount, paid_amount, outstanding_amount, next_due_date FROM v_purchase_orders WHERE id = $1`, po.Str("id"))
	if err != nil {
		return nil, err
	}
	if view == nil {
		view = newRow()
	}
	gross := view.Num("payable_amount")
	if view.Get("payable_amount") == nil {
		gross = firstNumber(po, "total", "subtotal")
	}
	credits, err := s.poCreditBreakdown(ctx, q, po.Str("id"))
	if err != nil {
		return nil, err
	}
	amounts := domain.ComputePoInvoiceAmounts(gross, credits.Return, credits.Reject, view.Num("paid_amount"), "", s.today())
	return &payableContext{SupplierID: po.StrPtr("supplier_id"), VendorID: po.StrPtr("vendor_id"), Payable: amounts.Payable, Outstanding: amounts.Outstanding}, nil
}

// paymentParty is resolvePoPaymentParty: vendor wins, then supplier.
func paymentParty(c *payableContext) (supplier, vendor *string, err error) {
	switch {
	case c.VendorID != nil:
		return nil, c.VendorID, nil
	case c.SupplierID != nil:
		return c.SupplierID, nil, nil
	}
	return nil, nil, badRequest("Purchase order has no supplier or vendor assigned")
}

// CreatePoPaymentTerm is createPoPaymentTerm.
func (s *Service) CreatePoPaymentTerm(ctx context.Context, poID string, in *poPaymentTermInput) (*Row, error) {
	c, err := s.poPayableContext(ctx, s.db, poID)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, notFound("Purchase order not found")
	}
	supplier, vendor, err := paymentParty(c)
	if err != nil {
		return nil, err
	}
	terms, err := s.rows.Query(ctx, s.db, `SELECT amount, term_no FROM purchase_order_payment_terms WHERE purchase_order_id = $1::text::uuid AND is_active = true ORDER BY term_no DESC`, poID)
	if err != nil {
		return nil, err
	}
	amounts := make([]float64, len(terms))
	for i, t := range terms {
		amounts[i] = t.Num("amount")
	}
	schedulable := domain.RemainingSchedulable(c.Payable, amounts)
	if in.Amount > schedulable+domain.QtyEpsilon {
		return nil, badRequest("Payment term amount cannot exceed remaining schedulable amount (" + formatJSNumber(schedulable) + ")")
	}
	termNo := 1
	if len(terms) > 0 {
		termNo = int(terms[0].Num("term_no")) + 1
	}
	if in.TermNo != nil && *in.TermNo != 0 {
		termNo = *in.TermNo
	}
	status := "unpaid"
	if in.Amount <= 0 {
		status = "paid"
	}
	return s.rows.One(ctx, s.db, `INSERT INTO purchase_order_payment_terms
		(purchase_order_id, supplier_id, vendor_id, term_no, description, due_date, amount, notes, status)
		VALUES ($1::text::uuid, $2, $3, $4, $5, $6::text::date, $7, $8, $9) RETURNING *`,
		poID, supplier, vendor, termNo, domain.NormalizeTermDescription(in.Description, in.Amount, c.Payable, termNo),
		in.DueDate, in.Amount, nonEmpty(in.Notes), status)
}

// CancelPoPaymentTerm is cancelPoPaymentTerm.
func (s *Service) CancelPoPaymentTerm(ctx context.Context, poID, termID string) error {
	term, err := s.rows.One(ctx, s.db, `SELECT id, purchase_order_id, paid_amount, status, is_active FROM purchase_order_payment_terms
		WHERE id = $1::text::uuid AND purchase_order_id = $2::text::uuid`, termID, poID)
	if err != nil || term == nil {
		return notFound("Termin pembayaran tidak ditemukan")
	}
	if !term.Bool("is_active") {
		return badRequest("Termin pembayaran sudah tidak aktif")
	}
	if term.Num("paid_amount") > 0 || term.Str("status") == "partial" || term.Str("status") == "paid" {
		return badRequest("Termin yang sudah memiliki pembayaran tidak bisa dihapus")
	}
	var n int
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM vendor_payments WHERE payment_term_id = $1 AND status <> 'void'`, term.Str("id")).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return badRequest("Termin yang sudah memiliki riwayat pembayaran tidak bisa dihapus")
	}
	_, err = s.db.Exec(ctx, `UPDATE purchase_order_payment_terms SET is_active = false, status = 'cancelled', updated_at = $3
		WHERE id = $1 AND purchase_order_id = $2`, term.Str("id"), term.Str("purchase_order_id"), s.now())
	return err
}

// PaymentTerm is the term and party a PO payment lands on.
type PaymentTerm struct {
	TermID               string
	SupplierID, VendorID *string
	Outstanding          float64
}

// ResolvePaymentTerm is resolvePaymentTermId without an explicit term, on
// the caller's querier: the first unpaid active term with room for amount,
// else a new "Paid in Full"/"Installment N" term due on paymentDate. It
// returns nil when the PO does not exist. Accounting's AP payment route can
// call it instead of repeating the rule.
func (s *Service) ResolvePaymentTerm(ctx context.Context, q database.Querier, poID string, amount float64, paymentDate string) (*PaymentTerm, error) {
	c, err := s.poPayableContext(ctx, q, poID)
	if err != nil || c == nil {
		return nil, err
	}
	supplier, vendor, err := paymentParty(c)
	if err != nil {
		return nil, err
	}
	if amount > c.Outstanding+domain.QtyEpsilon {
		return nil, errors.New("Payment amount cannot exceed outstanding balance (" + formatJSNumber(c.Outstanding) + ")")
	}
	terms, err := s.rows.Query(ctx, q, `SELECT id, amount, paid_amount, status, term_no FROM purchase_order_payment_terms
		WHERE purchase_order_id = $1::text::uuid AND is_active = true ORDER BY term_no ASC`, poID)
	if err != nil {
		return nil, err
	}
	next := 0
	for _, t := range terms {
		if t.Str("status") != "paid" && max(0, t.Num("amount")-t.Num("paid_amount"))+domain.QtyEpsilon >= amount {
			return &PaymentTerm{TermID: t.Str("id"), SupplierID: supplier, VendorID: vendor, Outstanding: c.Outstanding}, nil
		}
		next = max(next, int(t.Num("term_no")))
	}
	next++
	termAmount := amount
	if amount >= c.Outstanding-domain.QtyEpsilon {
		termAmount = c.Outstanding
	}
	var id string
	if err := q.QueryRow(ctx, `INSERT INTO purchase_order_payment_terms
		(purchase_order_id, supplier_id, vendor_id, term_no, description, due_date, amount, notes, status)
		VALUES ($1::text::uuid, $2, $3, $4, $5, $6::text::date, $7, NULL, 'unpaid') RETURNING id::text`,
		poID, supplier, vendor, next, domain.PaymentTermLabel(amount, c.Outstanding, next), paymentDate, termAmount).Scan(&id); err != nil {
		return nil, err
	}
	return &PaymentTerm{TermID: id, SupplierID: supplier, VendorID: vendor, Outstanding: c.Outstanding}, nil
}
