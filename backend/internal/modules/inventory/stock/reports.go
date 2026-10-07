package stock

import (
	"context"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Port of frontend/src/app/api/purchasing/reports/{stock-card,
// inventory-valuation} (lib/purchasing/report-stock-card.ts and
// report-inventory-valuation.ts). Both follow the sidebar's active stall.

/* ── stock card ──────────────────────────────────────────────────────── */

// stockCardQuery is stockCardQuerySchema.
type stockCardQuery struct {
	itemType, tipe                string
	materialID, productID, itemID string
	warehouseID, search           string
	dateFrom, dateTo              *string // dayStartIso / dayEndIso bounds
	limit                         float64
}

// movementSource is MovementSource: raw materials, or finished goods
// without the per-variant detail rows (pos_sku_id set).
type movementSource struct {
	table, itemColumn string
	productLevelOnly  bool
}

var (
	rawMaterialMovements = movementSource{"inventory_movements", "raw_material_id", false}
	productMovements     = movementSource{"finished_goods_movements", "product_id", true}
)

const movementColumns = `"id", "warehouse_id", "tipe", "jumlah", "qty_before", "qty_after", "unit_cost", "total_cost",
	"reference_type", "reference_id", "reference_number", "alasan", "catatan", "created_at"`

/* GET /api/purchasing/reports/stock-card */
func (h *handler) stockCard(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	f := kit.NewQueryForm(r.URL.Query())
	optional := validate.Rule{Optional: true}
	p := stockCardQuery{itemType: "raw_material", tipe: "all"}
	if v := kit.Enum(f.Form, "item_type", validate.Rule{HasDefault: true}, []string{"raw_material", "product"}, ""); v != nil {
		p.itemType = *v
	}
	p.materialID = kit.Deref(f.UUID("material_id", optional))
	p.productID = kit.Deref(f.UUID("product_id", optional))
	p.itemID = kit.Deref(f.UUID("item_id", optional))
	explicit := kit.Deref(f.UUID("warehouse_id", optional))
	p.search = kit.Deref(f.Str("search", optional, validate.StrOpts{}))
	if v := kit.Enum(f.Form, "tipe", validate.Rule{HasDefault: true}, []string{"all", "in", "out", "adjustment", "transfer", "return"}, ""); v != nil {
		p.tipe = *v
	}
	if v := kit.Deref(f.Str("date_from", optional, validate.StrOpts{})); v != "" {
		p.dateFrom = kit.Ptr(v + "T00:00:00.000Z")
	}
	if v := kit.Deref(f.Str("date_to", optional, validate.StrOpts{})); v != "" {
		p.dateTo = kit.Ptr(v + "T23:59:59.999Z")
	}
	limit := f.Coerce("limit", kit.Ptr(200.0), validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(500)})
	if !f.Valid() {
		return httpx.BadRequest("Invalid query params", f.Issues())
	}
	p.limit = *limit
	ctx := r.Context()
	if p.warehouseID, err = kit.ResolveWarehouseFilter(ctx, h.env.DB, r, u.ID, explicit); err != nil {
		return err
	}
	var data *kit.Row
	if p.itemType == "product" {
		data, err = h.productStockCard(ctx, p)
	} else {
		data, err = h.rawMaterialStockCard(ctx, p)
	}
	if err != nil {
		return err
	}
	return kit.OK(w, kit.Obj("success", true, "data", data))
}

func (h *handler) rawMaterialStockCard(ctx context.Context, p stockCardQuery) (*kit.Row, error) {
	db := h.env.DB
	selectedID := kit.FirstNonEmpty(p.itemID, p.materialID)
	a := &kit.Args{}
	where := []string{`"is_active" = ` + a.Add(true)}
	if p.search != "" {
		where = append(where, kit.Search(a, "", p.search, "nama", "kode"))
	}
	rows, err := kit.Query(ctx, db, `SELECT * FROM "v_raw_materials_stock" WHERE `+strings.Join(where, " AND ")+` ORDER BY "nama" ASC`, a.Values...)
	if err != nil {
		return nil, err
	}
	materials := make(kit.Rows, 0, len(rows))
	for _, row := range rows {
		materials = append(materials, normalizeStockItem(row))
	}
	if p.warehouseID != "" {
		inv, err := kit.Query(ctx, db, `SELECT "raw_material_id" FROM "inventory" WHERE "warehouse_id" = $1 AND "is_active" = $2`, p.warehouseID, true)
		if err != nil {
			return nil, err
		}
		allowed := map[string]bool{}
		for _, row := range inv {
			allowed[row.Str("raw_material_id")] = true
		}
		materials = slices.DeleteFunc(materials, func(m *kit.Row) bool { return !allowed[m.Str("id")] })
	}

	movementRows, err := loadStockCardMovements(ctx, db, rawMaterialMovements, p, selectedID)
	if err != nil {
		return nil, err
	}
	var itemIDs []string
	for _, row := range movementRows {
		if id := jsString(row.Get("raw_material_id")); !slices.Contains(itemIDs, id) {
			itemIDs = append(itemIDs, id)
		}
	}
	byID := map[string]*kit.Row{}
	for _, m := range materials {
		byID[m.Str("id")] = m
	}
	fallbackCost := map[string]float64{}
	if len(itemIDs) > 0 {
		// Materials outside the list (filtered by search or stall) still need
		// their code and name.
		var missing []string
		for _, id := range itemIDs {
			if byID[id] == nil {
				missing = append(missing, id)
			}
		}
		if len(missing) > 0 {
			a := &kit.Args{}
			extra, err := kit.Query(ctx, db, `SELECT "id", "kode", "nama", "kategori" FROM "raw_materials" WHERE `+
				inClause(a, `"id"`, missing)+` AND "deleted_at" IS NULL`, a.Values...)
			if err != nil {
				return nil, err
			}
			for _, row := range extra {
				row.Set("kategori", kit.FirstNonEmpty(row.Str("kategori"), "-")).Set("status_stok", "AMAN")
				byID[jsString(row.Get("id"))] = normalizeStockItem(row)
			}
		}
		a := &kit.Args{}
		costs, err := kit.Query(ctx, db, `SELECT "raw_material_id", "unit_cost" FROM "inventory" WHERE `+
			inClause(a, `"raw_material_id"`, itemIDs)+` AND "is_active" = `+a.Add(true), a.Values...)
		if err != nil {
			return nil, err
		}
		for _, row := range costs {
			fallbackCost[row.Str("raw_material_id")] = row.Num("unit_cost")
		}
	}
	return buildStockCard(ctx, db, rawMaterialMovements, p, selectedID, materials, byID, movementRows, fallbackCost)
}

func (h *handler) productStockCard(ctx context.Context, p stockCardQuery) (*kit.Row, error) {
	db := h.env.DB
	selectedID := kit.FirstNonEmpty(p.itemID, p.productID)
	a := &kit.Args{}
	where := []string{`"is_active" = ` + a.Add(true)}
	if p.warehouseID != "" {
		where = append(where, `"warehouse_id" = `+a.Add(p.warehouseID))
	}
	if p.search != "" {
		where = append(where, kit.Search(a, "", p.search, "product_nama", "product_kode"))
	}
	rows, err := kit.Query(ctx, db, `SELECT * FROM "v_finished_goods_stock" WHERE `+strings.Join(where, " AND ")+` ORDER BY "product_nama" ASC`, a.Values...)
	if err != nil {
		return nil, err
	}
	items := make(kit.Rows, 0, len(rows))
	byID := map[string]*kit.Row{}
	fallbackCost := map[string]float64{}
	for _, row := range rows {
		id := row.Get("product_id")
		if !truthy(id) {
			id = row.Get("id")
		}
		item := normalizeStockItem(kit.Obj(
			"id", jsString(id), "kode", row.Get("product_kode"), "nama", row.Get("product_nama"),
			"kategori", row.Get("product_kategori"), "satuan", row.Get("satuan_nama"), "lokasi_rak", row.Get("warehouse_name"),
			"qty_onhand", row.Get("qty_available"), "avg_cost", row.Get("unit_cost"), "min_stock", 0.0, "max_stock", nil,
			"status_stok", "AMAN", "warehouse_id", row.Get("warehouse_id"), "warehouse_name", row.Get("warehouse_name"),
		))
		items = append(items, item)
		byID[item.Str("id")] = item
		fallbackCost[item.Str("id")] = item.Num("avg_cost")
	}
	movementRows, err := loadStockCardMovements(ctx, db, productMovements, p, selectedID)
	if err != nil {
		return nil, err
	}
	return buildStockCard(ctx, db, productMovements, p, selectedID, items, byID, movementRows, fallbackCost)
}

// loadStockCardMovements is loadMovements: active rows oldest first.
func loadStockCardMovements(ctx context.Context, q database.Querier, src movementSource, p stockCardQuery, selectedID string) (kit.Rows, error) {
	a := &kit.Args{}
	where := []string{`"is_active" = ` + a.Add(true)}
	if selectedID != "" {
		where = append(where, `"`+src.itemColumn+`" = `+a.Add(selectedID))
	}
	if p.warehouseID != "" {
		where = append(where, `"warehouse_id" = `+a.Add(p.warehouseID))
	}
	if p.tipe != "all" {
		where = append(where, `"tipe" = `+a.Add(p.tipe))
	}
	if p.dateFrom != nil {
		where = append(where, `"created_at" >= `+a.Add(*p.dateFrom))
	}
	if p.dateTo != nil {
		where = append(where, `"created_at" <= `+a.Add(*p.dateTo))
	}
	if src.productLevelOnly {
		where = append(where, `"pos_sku_id" IS NULL`)
	}
	return kit.Query(ctx, q, `SELECT "`+src.itemColumn+`", `+movementColumns+` FROM "`+src.table+`" WHERE `+
		strings.Join(where, " AND ")+` ORDER BY "created_at" ASC LIMIT `+a.Add(kit.N(p.limit)), a.Values...)
}

// openingBalance is loadOpeningBalance: qty_after of the last movement
// before date_from, when an item and a start date are chosen.
func openingBalance(ctx context.Context, q database.Querier, src movementSource, p stockCardQuery, selectedID string, fallback float64) (float64, error) {
	if selectedID == "" || p.dateFrom == nil {
		return fallback, nil
	}
	a := &kit.Args{}
	where := []string{`"` + src.itemColumn + `" = ` + a.Add(selectedID), `"is_active" = ` + a.Add(true)}
	if src.productLevelOnly {
		where = append(where, `"pos_sku_id" IS NULL`)
	}
	where = append(where, `"created_at" < `+a.Add(*p.dateFrom))
	if p.warehouseID != "" {
		where = append(where, `"warehouse_id" = `+a.Add(p.warehouseID))
	}
	row, err := kit.QueryOne(ctx, q, `SELECT "qty_after" FROM "`+src.table+`" WHERE `+strings.Join(where, " AND ")+
		` ORDER BY "created_at" DESC LIMIT `+a.Add(1), a.Values...)
	if err != nil || row == nil {
		return fallback, err
	}
	return row.Num("qty_after"), nil
}

// buildStockCard is `{ item_type, ...buildStockCard() }`: items, the
// selected one, normalized movements and the summary.
func buildStockCard(ctx context.Context, q database.Querier, src movementSource, p stockCardQuery, selectedID string,
	items kit.Rows, byID map[string]*kit.Row, movementRows kit.Rows, fallbackCost map[string]float64) (*kit.Row, error) {
	var selected *kit.Row
	if selectedID != "" {
		for _, item := range items {
			if item.Str("id") == selectedID {
				selected = item
				break
			}
		}
	}
	movements := make(kit.Rows, 0, len(movementRows))
	for _, row := range movementRows {
		itemID := jsString(row.Get(src.itemColumn))
		movements = append(movements, normalizeMovement(row, itemID, byID[itemID], fallbackCost))
	}
	fallback := 0.0
	if len(movements) > 0 {
		fallback = movements[0].Num("qty_before")
	}
	opening, err := openingBalance(ctx, q, src, p, selectedID, fallback)
	if err != nil {
		return nil, err
	}
	closing := 0.0
	if selected != nil {
		closing = selected.Num("qty_onhand")
	}
	return kit.Obj("item_type", p.itemType, "items", items, "materials", items, "selected_item", selected, "selected_material", selected,
		"movements", movements, "summary", stockCardSummary(movements, opening, closing)), nil
}

// normalizeStockItem is normalizeItem.
func normalizeStockItem(row *kit.Row) *kit.Row {
	var maxStock any
	if row.Get("max_stock") != nil {
		maxStock = row.Num("max_stock")
	}
	return kit.Obj(
		"id", row.Get("id"),
		"kode", or(row.Get("kode"), ""),
		"nama", or(row.Get("nama"), row.Get("id")),
		"kategori", or(row.Get("kategori"), "-"),
		"satuan", or(row.Get("satuan"), ""),
		"lokasi_rak", or(row.Get("lokasi_rak"), or(row.Get("warehouse_name"), "-")),
		"qty_onhand", row.Num("qty_onhand"),
		"avg_cost", row.Num("avg_cost"),
		"min_stock", row.Num("min_stock"),
		"max_stock", maxStock,
		"status_stok", or(row.Get("status_stok"), "AMAN"),
		"warehouse_id", or(row.Get("warehouse_id"), nil),
		"warehouse_name", or(row.Get("warehouse_name"), nil),
	)
}

// normalizeMovement is normalizeMovement: the recorded unit cost, else the
// item's fallback cost; total = |qty| x unit when no total was recorded.
func normalizeMovement(row *kit.Row, itemID string, item *kit.Row, fallbackCost map[string]float64) *kit.Row {
	unitCost := row.Num("unit_cost")
	if unitCost == 0 {
		unitCost = fallbackCost[itemID]
	}
	totalCost := row.Num("total_cost")
	if totalCost == 0 {
		totalCost = float64(math.Abs(row.Num("jumlah")) * unitCost)
	}
	var kode, nama, kategori any = "", itemID, "-"
	if item != nil {
		kode, nama, kategori = or(item.Get("kode"), ""), or(item.Get("nama"), itemID), or(item.Get("kategori"), "-")
	}
	return kit.Obj(
		"id", row.Get("id"),
		"item_id", itemID,
		"raw_material_id", itemID,
		"material_kode", kode,
		"material_nama", nama,
		"material_kategori", kategori,
		"item_kode", kode,
		"item_nama", nama,
		"item_kategori", kategori,
		"tipe", row.Get("tipe"),
		"jumlah", row.Num("jumlah"),
		"qty_before", row.Num("qty_before"),
		"qty_after", row.Num("qty_after"),
		"unit_cost", unitCost,
		"total_cost", totalCost,
		"reference_type", or(row.Get("reference_type"), "-"),
		"reference_id", or(row.Get("reference_id"), nil),
		"reference_number", or(row.Get("reference_number"), "-"),
		"alasan", or(row.Get("alasan"), "-"),
		"catatan", or(row.Get("catatan"), ""),
		"created_at", row.Get("created_at"),
		"warehouse_id", or(row.Get("warehouse_id"), nil),
	)
}

// stockCardSummary is buildStockCardSummary.
func stockCardSummary(movements kit.Rows, opening, fallbackClosing float64) *kit.Row {
	closing := fallbackClosing
	var in, out, adjIn, adjOut, ret, transfer, value float64
	for _, m := range movements {
		qty := m.Num("jumlah")
		switch m.Str("tipe") {
		case "in":
			in += qty
		case "out":
			out += qty
		case "return":
			ret += qty
		case "transfer":
			transfer += qty
		case "adjustment":
			if diff := m.Num("qty_after") - m.Num("qty_before"); diff >= 0 {
				adjIn += diff
			} else {
				adjOut += math.Abs(diff)
			}
		}
		if total := m.Num("total_cost"); total != 0 {
			value += total
		} else {
			value += float64(qty * m.Num("unit_cost"))
		}
		closing = m.Num("qty_after")
	}
	return kit.Obj(
		"opening_balance", opening, "closing_balance", closing,
		"total_in", in, "total_out", out, "total_adjustment_in", adjIn, "total_adjustment_out", adjOut,
		"total_return", ret, "total_transfer", transfer, "total_value", value, "movement_count", len(movements),
	)
}

/* ── inventory valuation ─────────────────────────────────────────────── */

// valuationCategoryLabels is KATEGORI_LABELS.
var valuationCategoryLabels = map[string]string{
	"BAHAN_PANGAN":     "Bahan Pangan",
	"BAHAN_NON_PANGAN": "Bahan Non-Pangan",
	"KEMASAN":          "Kemasan",
	"BAHAN_BAKAR":      "Bahan Bakar",
	"LAINNYA":          "Lainnya",
}

/* GET /api/purchasing/reports/inventory-valuation */
func (h *handler) inventoryValuation(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	src, err := kit.RawMaterialStockSource(ctx, h.env.DB, r, u.ID)
	if err != nil {
		return err
	}
	a := &kit.Args{}
	where := `"is_active" = ` + a.Add(true)
	if src.WarehouseID != "" {
		where += ` AND "warehouse_id" = ` + a.Add(src.WarehouseID)
	}
	rows, err := kit.Query(ctx, h.env.DB, `SELECT * FROM "`+src.View+`" WHERE `+where+` ORDER BY "kategori" ASC`, a.Values...)
	if err != nil {
		return err
	}
	data, summary := inventoryValuation(rows)
	return kit.OK(w, kit.Obj("success", true, "data", data, "summary", summary))
}

// inventoryValuation is buildInventoryValuation: qty x average cost (unit
// cost as fallback) per material, totalled per category.
func inventoryValuation(rows kit.Rows) (kit.Rows, *kit.Row) {
	data := make(kit.Rows, 0, len(rows))
	type bucket struct {
		kategori    any
		total       float64
		count       int
		integerLike bool
		index       uint64
	}
	buckets := map[string]*bucket{}
	var order []*bucket
	total := 0.0
	for _, row := range rows {
		item := row.Clone()
		qty := row.Num("qty_onhand")
		avgCost := kit.ToNum(coalesce(row.Get("avg_cost"), row.Get("unit_cost")))
		value := qty * avgCost
		item.Set("qty_onhand", qty).
			Set("min_stock", kit.ToNum(coalesce(row.Get("min_stock"), row.Get("stok_minimum")))).
			Set("max_stock", coalesce(row.Get("max_stock"), row.Get("stok_maximum"))).
			Set("avg_cost", avgCost).
			Set("unit_cost", avgCost).
			Set("total_value", value).
			Set("satuan", or(row.Get("satuan"), or(row.Get("satuan_besar_nama"), ""))).
			Set("lokasi_rak", or(row.Get("lokasi_rak"), "-"))
		data = append(data, item)

		total += value
		key := jsString(row.Get("kategori"))
		b := buckets[key]
		if b == nil {
			b = &bucket{kategori: row.Get("kategori")}
			b.index, b.integerLike = arrayIndex(key)
			buckets[key] = b
			order = append(order, b)
		}
		b.total += value
		b.count++
	}
	// Object.values lists integer-like keys first, ascending.
	slices.SortStableFunc(order, func(x, y *bucket) int {
		switch {
		case x.integerLike && y.integerLike:
			return int(x.index) - int(y.index)
		case x.integerLike:
			return -1
		case y.integerLike:
			return 1
		}
		return 0
	})
	byCategory := make(kit.Rows, 0, len(order))
	for _, b := range order {
		label := b.kategori
		if s, ok := b.kategori.(string); ok && valuationCategoryLabels[s] != "" {
			label = valuationCategoryLabels[s]
		}
		byCategory = append(byCategory, kit.Obj("kategori", label, "total_value", b.total, "item_count", b.count))
	}
	return data, kit.Obj("total_value", total, "total_items", len(data), "by_category", byCategory)
}

// arrayIndex reports whether key is a canonical array index ("0", "17").
func arrayIndex(key string) (uint64, bool) {
	n, err := strconv.ParseUint(key, 10, 32)
	if err != nil || n == math.MaxUint32 || strconv.FormatUint(n, 10) != key {
		return 0, false
	}
	return n, true
}

/* ── JS value helpers ────────────────────────────────────────────────── */

// truthy is JavaScript truthiness for node-postgres values.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64, int, int16, int32, int64:
		return kit.ToNum(x) != 0
	}
	return true
}

// or is `a || b`.
func or(a, b any) any {
	if truthy(a) {
		return a
	}
	return b
}

// coalesce is `a ?? b`.
func coalesce(a, b any) any {
	if a != nil {
		return a
	}
	return b
}

// jsString is String(v) for an id column (uuid text, or "null").
func jsString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	if v == nil {
		return "null"
	}
	return kit.JSNum(kit.ToNum(v))
}

// inClause is the shim's `.in(col, values)`: col IN ($1, $2, …).
func inClause(a *kit.Args, col string, values []string) string {
	ph := make([]string, len(values))
	for i, v := range values {
		ph[i] = a.Add(v)
	}
	return col + " IN (" + strings.Join(ph, ", ") + ")"
}
