package procurement

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Legacy routes that pass the request body straight to a table, and the
// GRN read helpers around them.

// passThrough renders a JSON body value as the query builder sent it:
// objects and arrays JSON-encoded, everything else as its text.
func passThrough(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case string, bool:
		return x
	case json.Number:
		return x.String()
	}
	raw, _ := json.Marshal(v)
	return string(raw)
}

// quoteIdent is qid in the query builder.
func quoteIdent(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }

// sortedKeys keeps generated SQL deterministic (column order does not
// change the result).
func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// insertBody is `.insert(body).select().single()`: values go as untyped
// literals (simple protocol) so PostgreSQL parses them, as node-postgres'
// text parameters did, and unknown columns fail with 42703.
func (s *Service) insertBody(ctx context.Context, q database.Querier, table string, values map[string]any) (*Row, error) {
	keys := sortedKeys(values)
	cols := make([]string, len(keys))
	args := []any{pgx.QueryExecModeSimpleProtocol}
	ph := make([]string, len(keys))
	for i, k := range keys {
		cols[i] = quoteIdent(k)
		args = append(args, passThrough(values[k]))
		ph[i] = "$" + itoa(i+1)
	}
	return s.rows.One(ctx, q, `INSERT INTO `+table+` (`+strings.Join(cols, ", ")+`) VALUES (`+strings.Join(ph, ", ")+`) RETURNING *`, args...)
}

// updateBody is `.update(body).eq("id", id).select().single()`.
func (s *Service) updateBody(ctx context.Context, q database.Querier, table, id string, values map[string]any) (*Row, error) {
	keys := sortedKeys(values)
	args := []any{pgx.QueryExecModeSimpleProtocol}
	sets := make([]string, len(keys))
	for i, k := range keys {
		args = append(args, passThrough(values[k]))
		sets[i] = quoteIdent(k) + " = $" + itoa(i+1)
	}
	args = append(args, id)
	return s.rows.One(ctx, q, `UPDATE `+table+` SET `+strings.Join(sets, ", ")+` WHERE id = $`+itoa(len(keys)+1)+` RETURNING *`, args...)
}

/* ── Legacy /deliveries ──────────────────────────────────────────────── */

// CreateLegacyDelivery: the delivery inherits supplier and scope from the
// PO; the whole body (po_id included) goes to the insert.
func (s *Service) CreateLegacyDelivery(ctx context.Context, body map[string]any) (*Row, error) {
	poID, _ := body["po_id"].(string)
	po, err := s.rows.One(ctx, s.db, `SELECT supplier_id, company_id, branch_id FROM purchase_orders WHERE id = $1::text::uuid`, poID)
	if err != nil || po == nil {
		return nil, notFound("Purchase order not found")
	}
	values := map[string]any{}
	for k, v := range body {
		values[k] = v
	}
	values["supplier_id"] = po.Get("supplier_id")
	values["company_id"] = po.Get("company_id")
	values["branch_id"] = po.Get("branch_id")
	values["status"] = "IN_TRANSIT"
	row, err := s.insertBody(ctx, s.db, "deliveries", values)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, errNoRows
	}
	return row, nil
}

// UpdateLegacyDelivery writes the body as columns.
func (s *Service) UpdateLegacyDelivery(ctx context.Context, id string, body map[string]any) (*Row, error) {
	values := map[string]any{}
	for k, v := range body {
		values[k] = v
	}
	values["updated_at"] = s.now().UTC().Format("2006-01-02T15:04:05.000Z")
	row, err := s.updateBody(ctx, s.db, "deliveries", id, values)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, errNoRows
	}
	return row, nil
}

// CancelLegacyDelivery sets status 'CANCELLED' (upper case, as the TS does).
func (s *Service) CancelLegacyDelivery(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `UPDATE deliveries SET status = 'CANCELLED', updated_at = $2 WHERE id = $1::text::uuid`, id, s.now())
	return err
}

/* ── GRN items, returnable items, credits ────────────────────────────── */

// GrnItems is GET /grn/[id]/items: active lines with raw_material (*),
// satuan (*), purchase_order_item (*) and pos_sku.
func (s *Service) GrnItems(ctx context.Context, grnID string) ([]*Row, error) {
	items, err := s.rows.Query(ctx, s.db, `SELECT *,
		(SELECT row_to_json(e) FROM (SELECT * FROM "purchasing"."purchase_order_items" WHERE "id" = "grn_items"."purchase_order_item_id") e) AS purchase_order_item
		FROM grn_items WHERE grn_id = $1::text::uuid AND is_active = true ORDER BY created_at ASC`, grnID)
	if err != nil {
		return nil, err
	}
	materials, err := s.ports.Catalog.Refs(ctx, s.db, EntityRawMaterial, "*", uniqueStrings(column(items, "raw_material_id")))
	if err != nil {
		return nil, err
	}
	units, err := s.ports.Catalog.Refs(ctx, s.db, EntityUnit, "*", uniqueStrings(column(items, "satuan_id")))
	if err != nil {
		return nil, err
	}
	skus, err := s.ports.Catalog.Refs(ctx, s.db, EntityPosSku, "id, sku, name", uniqueStrings(column(items, "pos_sku_id")))
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		poItem := item.Get("purchase_order_item")
		item.Set("raw_material", refOrNull(materials, item.Str("raw_material_id")))
		item.Set("satuan", refOrNull(units, item.Str("satuan_id")))
		item.Set("purchase_order_item", poItem)
		item.Set("pos_sku", refOrNull(skus, item.Str("pos_sku_id")))
	}
	return items, nil
}

// AddGrnItem is POST /grn/[id]/items: the body goes to grn_items as is
// (bahan_baku_id aliases raw_material_id); only a pending GRN accepts lines.
func (s *Service) AddGrnItem(ctx context.Context, grnID string, body map[string]any) (*Row, error) {
	var status *string
	if err := s.db.QueryRow(ctx, `SELECT status FROM grn WHERE id = $1::text::uuid`, grnID).Scan(&status); err != nil || deref(status) != "pending" {
		return nil, badRequest("Cannot add items to GRN that is not pending")
	}
	values := map[string]any{}
	for k, v := range body {
		values[k] = v
	}
	values["grn_id"] = grnID
	rm := body["raw_material_id"]
	if rm == nil || rm == "" || rm == false {
		rm = body["bahan_baku_id"]
	}
	values["raw_material_id"] = rm
	values["satuan_id"] = body["satuan_id"]
	row, err := s.insertBody(ctx, s.db, "grn_items", values)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, errNoRows
	}
	return row, nil
}

// ReturnableGrnItems is listReturnableGrnItems.
func (s *Service) ReturnableGrnItems(ctx context.Context, grnID string, excludeReturnID *string) ([]*Row, error) {
	var posted bool
	err := s.db.QueryRow(ctx, `SELECT inventory_posted FROM grn_qc_inspections WHERE grn_id = $1::text::uuid LIMIT 1`, grnID).Scan(&posted)
	if err != nil && !database.IsNoRows(err) {
		return nil, err
	}
	if !posted {
		return []*Row{}, nil
	}
	giveBack := map[string]float64{}
	if excludeReturnID != nil && *excludeReturnID != "" {
		lines, err := s.rows.Query(ctx, s.db, `SELECT grn_item_id, qty_returned FROM purchase_return_items WHERE return_id = $1::text::uuid`, *excludeReturnID)
		if err != nil {
			return nil, err
		}
		for _, l := range lines {
			if id := l.Str("grn_item_id"); id != "" {
				giveBack[id] += l.Num("qty_returned")
			}
		}
	}
	items, err := s.rows.Query(ctx, s.db, `SELECT gi.id, gi.grn_id, gi.raw_material_id, gi.product_id, gi.qty_diterima, gi.qty_returned,
		gi.qty_qc_posted, gi.batch_number, gi.expiry_date, gi.qc_status, gi.warehouse_id, gi.satuan_id,
		g.supplier_id AS grn_supplier_id, g.vendor_id AS grn_vendor_id, s.nama_supplier, v.name AS vendor_name, poi.harga_satuan
		FROM grn_items gi
		LEFT JOIN grn g ON g.id = gi.grn_id
		LEFT JOIN suppliers s ON s.id = g.supplier_id
		LEFT JOIN vendors v ON v.id = g.vendor_id
		LEFT JOIN purchase_order_items poi ON poi.id = gi.purchase_order_item_id
		WHERE gi.grn_id = $1::text::uuid AND gi.is_active = true`, grnID)
	if err != nil {
		return nil, err
	}
	refs := func(e Entity, cols, key string) (map[string]*Row, error) {
		m, err := s.ports.Catalog.Refs(ctx, s.db, e, cols, uniqueStrings(column(items, key)))
		if err != nil {
			return nil, err
		}
		out := map[string]*Row{}
		for id, raw := range m {
			if out[id], err = decodeRow(raw); err != nil {
				return nil, err
			}
		}
		return out, nil
	}
	materials, err := refs(EntityRawMaterial, "id, kode, nama", "raw_material_id")
	if err != nil {
		return nil, err
	}
	products, err := refs(EntityProduct, "id, kode, nama", "product_id")
	if err != nil {
		return nil, err
	}
	units, err := refs(EntityUnit, "id, nama", "satuan_id")
	if err != nil {
		return nil, err
	}
	warehouses, err := s.ports.Locations.WarehouseNames(ctx, s.db, uniqueStrings(column(items, "warehouse_id")))
	if err != nil {
		return nil, err
	}
	truthy := func(v any) bool { return v != nil && v != "" }
	field := func(r *Row, key string) any {
		if r == nil {
			return nil
		}
		return r.Get(key)
	}
	out := []*Row{}
	for _, it := range items {
		available := max(0, it.Num("qty_qc_posted")-it.Num("qty_returned")+giveBack[it.Str("id")])
		if available <= 0 {
			continue
		}
		rm, product := materials[it.Str("raw_material_id")], products[it.Str("product_id")]
		row := obj("grn_item_id", it.Get("id"), "grn_id", it.Get("grn_id"), "raw_material_id", orEmpty(it.Get("raw_material_id")))
		if truthy(it.Get("product_id")) {
			row.Set("product_id", it.Get("product_id"))
		}
		row.Set("raw_material_kode", orEmpty(field(rm, "kode"), field(product, "kode")))
		row.Set("raw_material_nama", orEmpty(field(rm, "nama"), field(product, "nama")))
		if product != nil {
			row.Set("product_kode", product.Get("kode")).Set("product_nama", product.Get("nama"))
		}
		row.Set("qty_diterima", it.Num("qty_diterima")).Set("qty_returned", it.Num("qty_returned")).
			Set("qty_available_to_return", available).Set("unit_price", it.Num("harga_satuan")).
			Set("batch_number", it.Get("batch_number")).Set("expiry_date", it.Get("expiry_date")).Set("qc_status", it.Get("qc_status")).
			Set("supplier_id", orEmpty(it.Get("grn_supplier_id"), it.Get("grn_vendor_id")))
		if truthy(it.Get("grn_vendor_id")) {
			row.Set("vendor_id", it.Get("grn_vendor_id"))
		}
		row.Set("nama_supplier", orEmpty(it.Get("nama_supplier"), it.Get("vendor_name")))
		if name := field(units[it.Str("satuan_id")], "nama"); truthy(name) {
			row.Set("satuan", name)
		}
		row.Set("warehouse_id", it.Get("warehouse_id"))
		if name := warehouses[it.Str("warehouse_id")]; name != nil && *name != "" {
			row.Set("warehouse_name", *name)
		}
		out = append(out, row)
	}
	return out, nil
}

// GrnVendorCredits is getVendorCreditsByGrnId (cancelled credits hidden).
func (s *Service) GrnVendorCredits(ctx context.Context, grnID string) ([]*Row, error) {
	credits, err := s.rows.Query(ctx, s.db, `SELECT id, credit_number, grn_id, purchase_order_id, supplier_id, source_type, credit_date,
		status, total_amount, reason_notes, notes, approved_at, created_at
		FROM vendor_credits WHERE grn_id = $1::text::uuid AND status <> 'cancelled' ORDER BY created_at ASC`, grnID)
	if err != nil {
		if database.IsUndefinedTable(err) {
			return []*Row{}, nil
		}
		return nil, err
	}
	if len(credits) == 0 {
		return credits, nil
	}
	items, err := s.rows.Query(ctx, s.db, `SELECT vendor_credit_id::text AS credit_id, row_to_json(e) AS item FROM (
		SELECT vendor_credit_id, id, grn_item_id, raw_material_id, qty, unit_price, line_amount, notes
		FROM vendor_credit_items WHERE vendor_credit_id = ANY($1::uuid[])) e`, column(credits, "id"))
	if err != nil {
		return nil, err
	}
	var materialIDs []string
	parsed := make([]*Row, len(items))
	for i, it := range items {
		raw, _ := it.Get("item").(json.RawMessage)
		if parsed[i], err = decodeRow(raw); err != nil {
			return nil, err
		}
		materialIDs = append(materialIDs, parsed[i].Str("raw_material_id"))
	}
	materials, err := s.ports.Catalog.Refs(ctx, s.db, EntityRawMaterial, "id, kode, nama", uniqueStrings(materialIDs))
	if err != nil {
		return nil, err
	}
	byCredit := map[string][]*Row{}
	for i, it := range items {
		p := parsed[i]
		var rm any
		if raw, ok := materials[p.Str("raw_material_id")]; ok {
			m, err := decodeRow(raw)
			if err != nil {
				return nil, err
			}
			rm = obj("kode", m.Get("kode"), "nama", m.Get("nama"))
		}
		byCredit[it.Str("credit_id")] = append(byCredit[it.Str("credit_id")], obj("id", p.Get("id"), "grn_item_id", p.Get("grn_item_id"),
			"raw_material_id", p.Get("raw_material_id"), "qty", p.Get("qty"), "unit_price", p.Get("unit_price"),
			"line_amount", p.Get("line_amount"), "notes", p.Get("notes"), "raw_material", rm))
	}
	for _, c := range credits {
		list := byCredit[c.Str("id")]
		if list == nil {
			list = []*Row{}
		}
		c.Set("items", list)
	}
	return credits, nil
}
