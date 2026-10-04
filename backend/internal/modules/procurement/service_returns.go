package procurement

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	contracts "nuhabit/backend/internal/contracts/procurement"
	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
	pscope "nuhabit/backend/internal/platform/scope"
)

// Port of lib/purchasing/purchase-return-service.ts, purchase-returns.ts and
// purchase-return-revision.ts.

// ReturnLine is one returnLineSchema item.
type ReturnLine struct {
	GrnItemID                string
	RawMaterialID, ProductID *string
	QtyReturned, UnitCost    float64
	BatchNumber, ExpiryDate  *string
	ConditionNotes           *string
}

// ReturnStockLine is one approved return line to take out of stock.
type ReturnStockLine struct {
	RawMaterialID, ProductID string
	Qty, UnitCost            float64
	ReturnID, ReturnNumber   string
	WarehouseID              *string
	UserID                   string
	ConditionNotes           *string
}

// ReturnStock reduces inventory for an approved purchase return on the
// caller's transaction: insufficient stock fails the approval (500), so the
// response depends on it.
type ReturnStock interface {
	Reduce(ctx context.Context, q database.Querier, line ReturnStockLine) error
}

// scopedQcGrnIDs is listScopedQcCompletedGrnIds.
func (s *Service) scopedQcGrnIDs(ctx context.Context, scope *pscope.Scope, moduleType string) ([]string, error) {
	w := newWhere().add("is_active = true").add("id IN (SELECT grn_id FROM grn_qc_inspections WHERE inventory_posted = true)")
	if c := pscope.CompanyFilter(scope); c != nil {
		w.add("company_id = %s::text::uuid", *c)
	}
	if b := pscope.BranchFilter(scope); b != nil {
		w.add("branch_id = %s::text::uuid", *b)
	}
	if moduleType != "" {
		ids, err := s.poIDsByModule(ctx, s.db, moduleType)
		if err != nil {
			return nil, err
		}
		if len(ids) == 0 {
			return nil, nil
		}
		w.add("purchase_order_id = ANY(%s::uuid[])", ids)
	}
	rows, err := s.db.Query(ctx, `SELECT id::text FROM grn `+w.sql(), w.args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// returnHeaderEmbeds are the supplier/vendor/grn embeds of the return lists.
const returnHeaderEmbeds = `
	(SELECT row_to_json(e) FROM (SELECT id, nama_supplier FROM purchasing.suppliers WHERE id = purchase_returns.supplier_id) e) AS supplier,
	(SELECT row_to_json(e) FROM (SELECT id, name FROM purchasing.vendors WHERE id = purchase_returns.vendor_id) e) AS vendor,
	(SELECT row_to_json(e) FROM (SELECT id, nomor_grn FROM purchasing.grn WHERE id = purchase_returns.grn_id) e) AS grn`

// enrichReturn is mapPurchaseReturnRow after enrichPurchaseReturnsWithGrn:
// grn_number is appended and grn becomes { id, nomor_grn, grn_number }.
func enrichReturn(row *Row) error {
	var grn *Row
	if raw, ok := row.Get("grn").(json.RawMessage); ok {
		var err error
		if grn, err = decodeRow(raw); err != nil {
			return err
		}
	}
	var number, id any
	if grn != nil {
		number = jsOrValues(grn.Get("nomor_grn"), grn.Get("grn_number"), nil)
	}
	id = row.Get("grn_id")
	if id == nil && grn != nil {
		id = grn.Get("id")
	}
	if (number == nil || number == "") && id == nil {
		return nil
	}
	if number == "" {
		number = nil
	}
	if grn == nil {
		grn = newRow()
	}
	row.Set("grn_number", number)
	row.Set("grn", grn.Set("id", id).Set("nomor_grn", number).Set("grn_number", number))
	return nil
}

// enrichReturns is enrichPurchaseReturnsWithGrn; the rows carry the grn
// embed already, so the TS re-read of GRN numbers adds nothing.
func enrichReturns(rows []*Row) error {
	for _, r := range rows {
		if err := enrichReturn(r); err != nil {
			return err
		}
	}
	return nil
}

// ReturnListParams are the GET /returns query params.
type ReturnListParams struct {
	Page, Limit                      int
	Status                           string
	SupplierID, VendorID, ReasonType *string
	DateFrom, DateTo, Search         *string
	SortBy, SortOrder, ModuleType    string
}

var returnSortColumns = []string{"return_date", "return_number", "total_amount", "status", "created_at"}

// ListPurchaseReturns is listPurchaseReturns.
func (s *Service) ListPurchaseReturns(ctx context.Context, p ReturnListParams, scope *pscope.Scope) (*PoList, error) {
	ids, err := s.scopedQcGrnIDs(ctx, scope, p.ModuleType)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return &PoList{Success: true, Data: []*Row{}, Pagination: PoPagination{Page: p.Page, Limit: p.Limit, TotalPages: 0}}, nil
	}
	w := newWhere().add("grn_id = ANY(%s::uuid[])", ids)
	if p.Status != "all" {
		w.add("status = %s", p.Status)
	}
	if set(p.SupplierID) {
		w.add("supplier_id = %s::text::uuid", *p.SupplierID)
	}
	if set(p.VendorID) {
		w.add("vendor_id = %s::text::uuid", *p.VendorID)
	}
	if set(p.ReasonType) {
		w.add("reason_type = %s", *p.ReasonType)
	}
	if set(p.DateFrom) {
		w.add("return_date >= %s::text::date", *p.DateFrom)
	}
	if set(p.DateTo) {
		w.add("return_date <= %s::text::date", *p.DateTo)
	}
	if set(p.Search) {
		like := strings.ReplaceAll("%"+*p.Search+"%", "*", "%")
		w.add("(return_number ILIKE %s OR reason_notes ILIKE %s OR grn_id IN (SELECT id FROM grn WHERE nomor_grn ILIKE %s))", like, like, like)
	}
	sortBy := "return_date"
	if contains(returnSortColumns, p.SortBy) {
		sortBy = p.SortBy
	}
	dir := "DESC"
	if p.SortOrder == "ASC" {
		dir = "ASC"
	}
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM purchase_returns `+w.sql(), w.args...).Scan(&total); err != nil {
		return nil, err
	}
	limit, offset := w.next(p.Limit), w.next((p.Page-1)*p.Limit)
	rows, err := s.rows.Query(ctx, s.db, `SELECT *, `+returnHeaderEmbeds+` FROM purchase_returns `+w.sql()+
		` ORDER BY `+sortBy+` `+dir+` LIMIT `+limit+` OFFSET `+offset, w.args...)
	if err != nil {
		return nil, err
	}
	if err := enrichReturns(rows); err != nil {
		return nil, err
	}
	return &PoList{Success: true, Data: rows, Pagination: PoPagination{Page: p.Page, Limit: p.Limit, Total: total, TotalPages: totalPages(total, p.Limit)}}, nil
}

// ReturnableGrns is listReturnableGrns.
func (s *Service) ReturnableGrns(ctx context.Context, scope *pscope.Scope, moduleType string) ([]*Row, error) {
	ids, err := s.scopedQcGrnIDs(ctx, scope, moduleType)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []*Row{}, nil
	}
	return s.rows.Query(ctx, s.db, `SELECT id, nomor_grn, tanggal_penerimaan, supplier_id, vendor_id,
		(SELECT row_to_json(e) FROM (SELECT nama_supplier FROM purchasing.suppliers WHERE id = grn.supplier_id) e) AS supplier,
		(SELECT row_to_json(e) FROM (SELECT name FROM purchasing.vendors WHERE id = grn.vendor_id) e) AS vendor
		FROM grn WHERE id = ANY($1::uuid[]) AND is_active = true ORDER BY tanggal_penerimaan DESC`, ids)
}

// codeName is a { kode, nama } embed from an id, kode, nama ref.
func codeName(m map[string]json.RawMessage, id string) (any, error) {
	raw, ok := m[id]
	if !ok || id == "" {
		return nil, nil
	}
	r, err := decodeRow(raw)
	if err != nil {
		return nil, err
	}
	return obj("kode", r.Get("kode"), "nama", r.Get("nama")), nil
}

// returnItems loads purchase_return_items of returnIDs with the embeds the
// detail (full=true) or the update response read.
func (s *Service) returnItems(ctx context.Context, q database.Querier, returnID string, full bool) ([]*Row, error) {
	cols := "*"
	if full {
		cols = "id, return_id, grn_item_id, raw_material_id, product_id, qty_returned, unit_cost, subtotal, batch_number, expiry_date, condition_notes, qc_status, created_at"
	}
	rows, err := s.rows.Query(ctx, q, `SELECT row_to_json(e) AS item, e.grn_item_id::text AS gi, e.raw_material_id::text AS rm, e.product_id::text AS pr,
		(SELECT warehouse_id::text FROM purchasing.grn_items WHERE id = e.grn_item_id) AS wh,
		EXISTS (SELECT 1 FROM purchasing.grn_items WHERE id = e.grn_item_id) AS has_gi
		FROM (SELECT `+cols+` FROM purchasing.purchase_return_items WHERE return_id = $1) e`, returnID)
	if err != nil {
		return nil, err
	}
	materials, err := s.ports.Catalog.Refs(ctx, q, EntityRawMaterial, "id, kode, nama", uniqueStrings(column(rows, "rm")))
	if err != nil {
		return nil, err
	}
	var products map[string]json.RawMessage
	var warehouses map[string]*string
	if full {
		if products, err = s.ports.Catalog.Refs(ctx, q, EntityProduct, "id, kode, nama", uniqueStrings(column(rows, "pr"))); err != nil {
			return nil, err
		}
		if warehouses, err = s.ports.Locations.WarehouseNames(ctx, q, uniqueStrings(column(rows, "wh"))); err != nil {
			return nil, err
		}
	}
	out := make([]*Row, len(rows))
	for i, r := range rows {
		item, err := decodeRow(r.Get("item").(json.RawMessage))
		if err != nil {
			return nil, err
		}
		var grnItem any
		if r.Bool("has_gi") {
			gi := obj("warehouse_id", r.Get("wh"))
			if full {
				var wh any
				if name, ok := warehouses[r.Str("wh")]; ok {
					wh = obj("name", name)
				}
				gi.Set("warehouse", wh)
			}
			grnItem = gi
		}
		rm, err := codeName(materials, r.Str("rm"))
		if err != nil {
			return nil, err
		}
		if full {
			item.Set("grn_item", grnItem).Set("raw_material", rm)
			product, err := codeName(products, r.Str("pr"))
			if err != nil {
				return nil, err
			}
			item.Set("product", product)
		} else {
			item.Set("raw_material", rm).Set("grn_item", grnItem)
		}
		out[i] = item
	}
	return out, nil
}

// PurchaseReturn is getPurchaseReturn.
func (s *Service) PurchaseReturn(ctx context.Context, id string, scope *pscope.Scope) (*Row, error) {
	ret, err := s.rows.One(ctx, s.db, `SELECT *, `+returnHeaderEmbeds+` FROM purchase_returns WHERE id = $1::text::uuid`, id)
	if err != nil {
		return nil, err
	}
	if ret == nil {
		return nil, notFound("Purchase return not found")
	}
	if err := s.assertReturnGrnInScope(ctx, scope, ret.Str("grn_id")); err != nil {
		return nil, err
	}
	items, err := s.returnItems(ctx, s.db, ret.Str("id"), true)
	if err != nil {
		return nil, err
	}
	ret.Set("items", items)
	return ret, enrichReturns([]*Row{ret})
}

func (s *Service) assertReturnGrnInScope(ctx context.Context, scope *pscope.Scope, grnID string) error {
	if grnID == "" {
		return nil
	}
	ids, err := s.scopedQcGrnIDs(ctx, scope, "")
	if err != nil {
		return err
	}
	if !contains(ids, grnID) {
		return notFound("Purchase return not found")
	}
	return nil
}

// validateReturnLines is validateReturnLineItems.
func (s *Service) validateReturnLines(ctx context.Context, q database.Querier, grnID string, items []ReturnLine, excludeReturnID string) error {
	if len(items) == 0 {
		return badRequest("At least one return item is required")
	}
	giveBack := map[string]float64{}
	if excludeReturnID != "" {
		lines, err := s.rows.Query(ctx, q, `SELECT grn_item_id, qty_returned FROM purchase_return_items WHERE return_id = $1`, excludeReturnID)
		if err != nil {
			return err
		}
		for _, l := range lines {
			if id := l.Str("grn_item_id"); id != "" {
				giveBack[id] += l.Num("qty_returned")
			}
		}
	}
	for _, item := range items {
		if item.QtyReturned <= 0 {
			return badRequest("Return quantity must be greater than zero")
		}
		gi, err := s.rows.One(ctx, q, `SELECT id, grn_id, raw_material_id, product_id, qty_qc_posted, qty_returned
			FROM grn_items WHERE id = $1::text::uuid AND is_active = true`, item.GrnItemID)
		if err != nil {
			return err
		}
		if gi == nil || gi.Str("grn_id") != grnID {
			return badRequest("Return item does not belong to the selected goods receipt")
		}
		available := max(0, gi.Num("qty_qc_posted")-gi.Num("qty_returned")+giveBack[item.GrnItemID])
		if item.QtyReturned > available+0.000001 {
			name := s.itemName(ctx, q, gi.Str("raw_material_id"), gi.Str("product_id"))
			return badRequest("Return quantity for " + name + " exceeds available stock (" + formatJSNumber(available) + ")")
		}
	}
	return nil
}

// itemName is `raw_material?.nama || product?.nama || "item"`.
func (s *Service) itemName(ctx context.Context, q database.Querier, rawMaterialID, productID string) string {
	for _, ref := range []struct {
		e  Entity
		id string
	}{{EntityRawMaterial, rawMaterialID}, {EntityProduct, productID}} {
		if ref.id == "" {
			continue
		}
		m, err := s.ports.Catalog.Refs(ctx, q, ref.e, "id, nama", []string{ref.id})
		if err != nil {
			continue
		}
		if r, err := decodeRow(m[ref.id]); err == nil && r.Str("nama") != "" {
			return r.Str("nama")
		}
	}
	return "item"
}

func sumReturnLines(items []ReturnLine) float64 {
	sum := 0.0
	for _, it := range items {
		sum += it.QtyReturned * it.UnitCost
	}
	return sum
}

func insertReturnItems(ctx context.Context, q database.Querier, returnID string, items []ReturnLine) error {
	for _, it := range items {
		if _, err := q.Exec(ctx, `INSERT INTO purchase_return_items
			(return_id, grn_item_id, raw_material_id, product_id, qty_returned, unit_cost, subtotal, batch_number, expiry_date, condition_notes, qc_status)
			VALUES ($1, $2, $3::text::uuid, $4::text::uuid, $5, $6, $7, $8, $9::text::date, $10, 'rejected')`,
			returnID, it.GrnItemID, nonEmpty(it.RawMaterialID), nonEmpty(it.ProductID), it.QtyReturned, it.UnitCost,
			it.QtyReturned*it.UnitCost, nonEmpty(it.BatchNumber), nonEmpty(it.ExpiryDate), nonEmpty(it.ConditionNotes)); err != nil {
			return err
		}
	}
	return nil
}

// ReturnCreate is returnCreateSchema.
type ReturnCreate struct {
	GrnID, SupplierID, VendorID, ModuleType *string
	ReturnDate, ReasonType                  *string
	ReasonNotes, Notes                      *string
	Items                                   []ReturnLine
}

// CreatePurchaseReturn is createPurchaseReturn; it answers the created
// return with supplier, vendor and items.
func (s *Service) CreatePurchaseReturn(ctx context.Context, in *ReturnCreate, scope *pscope.Scope) (*Row, error) {
	moduleType := domainModule(in.ModuleType)
	if deref(in.ReturnDate) == "" || deref(in.ReasonType) == "" || len(in.Items) == 0 {
		return nil, badRequest("Required fields are incomplete")
	}
	if moduleType == "product" && deref(in.VendorID) == "" {
		return nil, badRequest("Vendor is required for product returns")
	}
	if moduleType == "raw_material" && deref(in.SupplierID) == "" {
		return nil, badRequest("Supplier is required for purchase returns")
	}
	if deref(in.GrnID) == "" {
		return nil, badRequest("Goods receipt is required for purchase returns")
	}
	ids, err := s.scopedQcGrnIDs(ctx, scope, moduleType)
	if err != nil {
		return nil, err
	}
	if !contains(ids, *in.GrnID) {
		return nil, badRequest("Goods receipt is not eligible for return (QC incomplete or out of scope)")
	}
	grn, err := s.rows.One(ctx, s.db, `SELECT id, company_id, branch_id, supplier_id, vendor_id FROM grn WHERE id = $1::text::uuid AND is_active = true`, *in.GrnID)
	if err != nil {
		return nil, err
	}
	if grn == nil {
		return nil, notFound("Goods receipt not found")
	}
	if err := s.validateReturnLines(ctx, s.db, grn.Str("id"), in.Items, ""); err != nil {
		return nil, err
	}
	var supplier, vendor *string
	if moduleType == "product" {
		vendor = firstNonNil(nonEmpty(in.VendorID), grn.StrPtr("vendor_id"))
	} else {
		supplier = firstNonNil(nonEmpty(in.SupplierID), grn.StrPtr("supplier_id"))
	}
	var id string
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO purchase_returns
			(grn_id, supplier_id, vendor_id, return_date, reason_type, reason_notes, status, total_amount, notes, company_id, branch_id)
			VALUES ($1, $2::text::uuid, $3::text::uuid, $4::text::date, $5, $6, 'pending_approval', $7, $8, $9, $10) RETURNING id::text`,
			grn.Str("id"), supplier, vendor, *in.ReturnDate, *in.ReasonType, in.ReasonNotes, sumReturnLines(in.Items), in.Notes,
			grn.StrPtr("company_id"), grn.StrPtr("branch_id")).Scan(&id); err != nil {
			return err
		}
		return insertReturnItems(ctx, tx, id, in.Items)
	})
	if err != nil {
		return nil, err
	}
	return s.createdReturn(ctx, id)
}

// createdReturn is createPurchaseReturn's final read. The TS also asked for
// raw_materials.satuan, a column that does not exist, so the material
// carries kode and nama.
func (s *Service) createdReturn(ctx context.Context, id string) (*Row, error) {
	ret, err := s.rows.One(ctx, s.db, `SELECT *,
		(SELECT row_to_json(e) FROM (SELECT nama_supplier FROM purchasing.suppliers WHERE id = purchase_returns.supplier_id) e) AS supplier,
		(SELECT row_to_json(e) FROM (SELECT name FROM purchasing.vendors WHERE id = purchase_returns.vendor_id) e) AS vendor
		FROM purchase_returns WHERE id = $1`, id)
	if err != nil {
		return nil, err
	}
	list, err := s.rows.Query(ctx, s.db, `SELECT row_to_json(i) AS item FROM purchase_return_items i WHERE return_id = $1 ORDER BY created_at, id`, id)
	if err != nil {
		return nil, err
	}
	items := make([]*Row, len(list))
	for i, it := range list {
		if items[i], err = decodeRow(it.Get("item").(json.RawMessage)); err != nil {
			return nil, err
		}
	}
	materials, err := s.ports.Catalog.Refs(ctx, s.db, EntityRawMaterial, "id, kode, nama", uniqueStrings(column(items, "raw_material_id")))
	if err != nil {
		return nil, err
	}
	products, err := s.ports.Catalog.Refs(ctx, s.db, EntityProduct, "id, kode, nama", uniqueStrings(column(items, "product_id")))
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		rm, err := codeName(materials, it.Str("raw_material_id"))
		if err != nil {
			return nil, err
		}
		product, err := codeName(products, it.Str("product_id"))
		if err != nil {
			return nil, err
		}
		it.Set("raw_material", rm).Set("product", product)
	}
	return ret.Set("items", items), nil
}

func domainModule(v *string) string {
	switch deref(v) {
	case "product", "general":
		return *v
	}
	return "raw_material"
}

// ReturnUpdate is returnUpdateSchema.
type ReturnUpdate struct {
	ReturnDate, ReasonType string
	ReasonNotes, Notes     *string
	Items                  []ReturnLine
}

// UpdatePurchaseReturn replaces header and lines of a draft/pending return.
func (s *Service) UpdatePurchaseReturn(ctx context.Context, id string, in *ReturnUpdate, scope *pscope.Scope) (*Row, error) {
	current, err := s.rows.One(ctx, s.db, `SELECT id, grn_id, status FROM purchase_returns WHERE id = $1::text::uuid`, id)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, notFound("Purchase return not found")
	}
	if err := s.assertReturnGrnInScope(ctx, scope, current.Str("grn_id")); err != nil {
		return nil, err
	}
	if st := current.Str("status"); st != "draft" && st != "pending_approval" {
		return nil, badRequest("Purchase return can only be edited before approval")
	}
	if current.Str("grn_id") == "" {
		return nil, badRequest("Goods receipt is required")
	}
	if err := s.validateReturnLines(ctx, s.db, current.Str("grn_id"), in.Items, current.Str("id")); err != nil {
		return nil, err
	}
	var out *Row
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE purchase_returns SET return_date = $2::text::date, reason_type = $3, reason_notes = $4, notes = $5,
			total_amount = $6, status = 'pending_approval', updated_at = $7 WHERE id = $1`,
			current.Str("id"), in.ReturnDate, in.ReasonType, in.ReasonNotes, in.Notes, sumReturnLines(in.Items), s.now()); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM purchase_return_items WHERE return_id = $1`, current.Str("id")); err != nil {
			return err
		}
		if err := insertReturnItems(ctx, tx, current.Str("id"), in.Items); err != nil {
			return err
		}
		ret, err := s.rows.One(ctx, tx, `SELECT *,
			(SELECT row_to_json(e) FROM (SELECT id, nama_supplier FROM purchasing.suppliers WHERE id = purchase_returns.supplier_id) e) AS supplier,
			(SELECT row_to_json(e) FROM (SELECT id, nomor_grn FROM purchasing.grn WHERE id = purchase_returns.grn_id) e) AS grn
			FROM purchase_returns WHERE id = $1`, current.Str("id"))
		if err != nil || ret == nil {
			return err
		}
		items, err := s.returnItems(ctx, tx, current.Str("id"), false)
		if err != nil {
			return err
		}
		ret.Set("items", items)
		out = ret
		return nil
	})
	if err != nil || out == nil {
		return out, err
	}
	return out, enrichReturns([]*Row{out})
}

// ApprovePurchaseReturn is approvePurchaseReturn: stock leaves the receipt
// warehouse, GRN lines count the return, and accounting posts the journal.
func (s *Service) ApprovePurchaseReturn(ctx context.Context, id, userID string) (*Row, error) {
	var out *Row
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		ret, err := s.rows.One(ctx, tx, `SELECT id, return_number, status, company_id, return_date::text AS return_date
			FROM purchase_returns WHERE id = $1::text::uuid`, id)
		if err != nil {
			return err
		}
		if ret == nil {
			return notFound("Purchase return not found")
		}
		if ret.Str("status") != "pending_approval" {
			return badRequest("Only pending returns can be approved")
		}
		items, err := s.rows.Query(ctx, tx, `SELECT ri.grn_item_id, ri.raw_material_id, ri.product_id, ri.qty_returned::float8 AS qty,
			ri.unit_cost::float8 AS cost, ri.condition_notes, gi.warehouse_id
			FROM purchase_return_items ri LEFT JOIN grn_items gi ON gi.id = ri.grn_item_id WHERE ri.return_id = $1`, ret.Str("id"))
		if err != nil {
			return err
		}
		if len(items) == 0 {
			return badRequest("Purchase return has no items")
		}
		number := ret.Str("return_number")
		for _, it := range items {
			if it.Str("product_id") == "" && it.Str("raw_material_id") == "" {
				return badRequest("Return item is missing material reference")
			}
			if err := s.ports.ReturnStock.Reduce(ctx, tx, ReturnStockLine{
				RawMaterialID: it.Str("raw_material_id"), ProductID: it.Str("product_id"), Qty: it.Num("qty"), UnitCost: it.Num("cost"),
				ReturnID: ret.Str("id"), ReturnNumber: number, WarehouseID: it.StrPtr("warehouse_id"), UserID: userID,
				ConditionNotes: it.StrPtr("condition_notes"),
			}); err != nil {
				return err
			}
		}
		total := 0.0
		for _, it := range items {
			total += it.Num("qty") * it.Num("cost")
			if it.Str("grn_item_id") == "" {
				continue
			}
			if _, err := tx.Exec(ctx, `UPDATE grn_items SET qty_returned = COALESCE(qty_returned, 0) + $2, updated_at = $3 WHERE id = $1`,
				it.Str("grn_item_id"), it.Num("qty"), s.now()); err != nil {
				return err
			}
		}
		out, err = s.rows.One(ctx, tx, `UPDATE purchase_returns SET status = 'approved', approved_at = $2, updated_at = $2 WHERE id = $1 RETURNING *`,
			ret.Str("id"), s.now())
		if err != nil {
			return err
		}
		date := ret.Str("return_date")
		if date == "" {
			date = s.now().UTC().Format("2006-01-02")
		}
		return outbox.Publish(ctx, tx, contracts.TopicPurchaseReturnApproved, ret.Str("id"), contracts.PurchaseReturnApproved{
			ReturnID: ret.Str("id"), ReturnNumber: number, ReturnDate: date, CompanyID: ret.StrPtr("company_id"), UserID: userID, TotalAmount: total,
		})
	})
	return out, err
}

// RejectPurchaseReturn is rejectPurchaseReturn.
func (s *Service) RejectPurchaseReturn(ctx context.Context, id string, reason *string, userID string) (*Row, error) {
	if deref(reason) == "" {
		return nil, badRequest("Alasan penolakan wajib diisi")
	}
	current, err := s.rows.One(ctx, s.db, `SELECT id, status FROM purchase_returns WHERE id = $1::text::uuid`, id)
	if err != nil || current == nil {
		return nil, notFound("Return tidak ditemukan")
	}
	if current.Str("status") != "pending_approval" {
		return nil, badRequest("Return tidak dalam status pending approval")
	}
	return s.rows.One(ctx, s.db, `UPDATE purchase_returns SET status = 'rejected', rejection_reason = $2, approved_by = $3, approved_at = $4
		WHERE id = $1 RETURNING *`, current.Str("id"), *reason, userID, s.now())
}

var revisionSuffix = regexp.MustCompile(`-R\d+$`)

// RevisionNumber is revisionNumber: RET-1 → RET-1-R1, RET-1-R1 → RET-1-R2.
func RevisionNumber(number string, revision int) string {
	return revisionSuffix.ReplaceAllString(number, "") + "-R" + strconv.Itoa(revision)
}

// RevisePurchaseReturn is revisePurchaseReturn: a rejected return gets a
// new draft copy; the audit row commits with it.
func (s *Service) RevisePurchaseReturn(ctx context.Context, id string, entry audit.Entry) (*Row, error) {
	var out *Row
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		cur, err := s.rows.One(ctx, tx, `SELECT id, return_number, status, superseded_by, revision_no, rejection_reason
			FROM purchasing.purchase_returns WHERE id = $1::text::uuid FOR UPDATE`, id)
		if err != nil {
			return err
		}
		switch {
		case cur == nil:
			return httpx.NotFound("Retur tidak ditemukan")
		case cur.Str("superseded_by") != "":
			return httpx.Conflict("Retur ini sudah pernah direvisi")
		case cur.Str("status") != "rejected":
			return httpx.Conflict("Hanya retur yang ditolak yang bisa direvisi")
		}
		revision := int(cur.Num("revision_no")) + 1
		number := RevisionNumber(cur.Str("return_number"), revision)
		var newID string
		if err := tx.QueryRow(ctx, `INSERT INTO purchasing.purchase_returns (
			  return_number, grn_id, supplier_id, vendor_id, return_date, reason_type, reason_notes,
			  status, total_amount, notes, company_id, branch_id, created_by, revision_no, revision_of)
			SELECT $2, grn_id, supplier_id, vendor_id, CURRENT_DATE, reason_type, reason_notes,
			       'draft', total_amount, notes, company_id, branch_id, created_by, $3, id
			FROM purchasing.purchase_returns WHERE id = $1 RETURNING id::text`, cur.Str("id"), number, revision).Scan(&newID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO purchasing.purchase_return_items (
			  return_id, grn_item_id, raw_material_id, product_id, qty_returned, unit_cost, subtotal,
			  batch_number, expiry_date, condition_notes, qc_status)
			SELECT $2, grn_item_id, raw_material_id, product_id, qty_returned, unit_cost, subtotal,
			       batch_number, expiry_date, condition_notes, qc_status
			FROM purchasing.purchase_return_items WHERE return_id = $1`, cur.Str("id"), newID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE purchasing.purchase_returns SET superseded_by = $2, updated_at = now() WHERE id = $1`, cur.Str("id"), newID); err != nil {
			return err
		}
		label := cur.Str("return_number")
		returnID := cur.Str("id")
		entry.Action, entry.Entity, entry.EntityID, entry.EntityLabel = "purchase_return.revise", "purchase_return", &returnID, &label
		entry.Before = obj("status", cur.Get("status"), "rejection_reason", cur.Get("rejection_reason"))
		entry.After = obj("revision_id", newID, "revision_number", number, "status", "draft")
		entry.Reason = cur.StrPtr("rejection_reason")
		if err := audit.Write(ctx, tx, entry); err != nil {
			return err
		}
		out = obj("id", newID, "return_number", number, "revision_no", revision)
		return nil
	})
	return out, err
}
