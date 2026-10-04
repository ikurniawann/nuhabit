package production

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	ps "nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/validate"
)

// lib/purchasing/production-orders.ts and production-order-actions.ts.

const orderNotFound = "Production order not found"

/* GET /api/purchasing/production/orders?status=&search=&production_context=&limit= */
func (h *handler) listOrders(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	sp := r.URL.Query()
	limit := math.Min(kit.NumberParam(sp, "limit", 25), 100) // NaN stays NaN, as Math.min
	a := &kit.Args{}
	var where []string
	if c := ps.CompanyFilter(scope); c != nil {
		where = append(where, `("company_id" = `+a.Add(*c)+`)`)
	}
	if b := ps.BranchFilter(scope); b != nil {
		where = append(where, `("branch_id" = `+a.Add(*b)+`)`)
	}
	if pc := sp.Get("production_context"); pc == "product" || pc == "raw_material" {
		where = append(where, `"production_context" = `+a.Add(pc))
	}
	if s := sp.Get("status"); s != "" {
		where = append(where, `"status" = `+a.Add(s))
	}
	if s := sp.Get("search"); s != "" {
		where = append(where, kit.Search(a, "", s, "nomor_produksi", "product_nama", "product_kode",
			"output_raw_material_nama", "output_raw_material_kode", "item_nama"))
	}
	sql := `SELECT * FROM v_production_orders`
	if len(where) > 0 {
		sql += ` WHERE ` + strings.Join(where, " AND ")
	}
	rows, err := kit.Query(ctx, h.env.DB, sql+` ORDER BY "created_at" DESC LIMIT `+a.Add(kit.N(limit)), a.Values...)
	if err != nil {
		return err
	}
	return kit.Data(w, rows)
}

/* ── create ──────────────────────────────────────────────────────────── */

type createInput struct {
	context, productID, rawMaterialID, outputType string
	plannedQty                                    float64
	overhead, labor, packaging, waste             float64
	catatan                                       *string
}

func positive(msg string) func(float64) (string, string, bool) {
	return func(x float64) (string, string, bool) { return "too_small", msg, x > 0 }
}

// parseCreate is createProductionSchema: a missing production_context means
// product; an unknown one is the discriminated union's error.
func parseCreate(r *http.Request) (createInput, error) {
	raw, ok := validate.ReadBody(r)
	var in createInput
	obj, isObj := raw.(map[string]any)
	if _, isArr := raw.([]any); isArr {
		obj, isObj = map[string]any{}, true // { ...array } is an empty object
	}
	if !isObj {
		return in, validate.New(raw, ok).Err("Validation failed")
	}
	if c := obj["production_context"]; c == nil || c == "" || c == false || c == json.Number("0") {
		obj["production_context"] = "product"
	}
	f := validate.New(obj, true)
	switch c := obj["production_context"].(type) {
	case string:
		in.context = c
	}
	if in.context != "product" && in.context != "raw_material" {
		f.Fail("production_context", "invalid_union", "Invalid discriminator value. Expected 'raw_material' | 'product'")
		return in, f.Err("Validation failed")
	}
	if in.context == "product" {
		if v := f.Str("product_id", validate.Rule{}, validate.StrOpts{Check: func(s string) (string, string, bool) {
			return "invalid_format", "Product is required", validate.IsUUID(s)
		}}); v != nil {
			in.productID = *v
		}
		in.outputType = "FINISHED_GOOD"
		if v := kit.Enum(f, "output_type", validate.Rule{HasDefault: true}, []string{"FINISHED_GOOD", "WIP"}, ""); v != nil {
			in.outputType = *v
		}
	} else if v := f.Str("raw_material_id", validate.Rule{}, validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "invalid_format", "Output raw material is required", validate.IsUUID(s)
	}}); v != nil {
		in.rawMaterialID = *v
	}
	if v := kit.NumCheck(f, "planned_qty", validate.Rule{}, positive("Planned quantity must be greater than 0")); v != nil {
		in.plannedQty = *v
	}
	costs := []struct {
		key string
		dst *float64
	}{{"overhead_cost", &in.overhead}, {"labor_cost", &in.labor}, {"packaging_cost", &in.packaging}, {"waste_cost", &in.waste}}
	for _, c := range costs {
		if v := f.Num(c.key, validate.Rule{HasDefault: true}, validate.NumOpts{Min: validate.Bound(0)}); v != nil {
			*c.dst = *v
		}
	}
	in.catatan = f.Str("catatan", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{})
	return in, f.Err("Validation failed")
}

/* POST /api/purchasing/production/orders — a DRAFT order planned from the BOM. */
func (h *handler) createOrder(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	in, err := parseCreate(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	db := h.env.DB
	var owner *kit.Row
	var lines kit.Rows
	fields := kit.NewRow()
	if in.context == "raw_material" {
		owner, err = kit.QueryOne(ctx, db, `SELECT id, kode, nama, company_id::text, branch_id::text FROM raw_materials
			WHERE id = $1 AND is_active = true AND deleted_at IS NULL`, in.rawMaterialID)
		if err != nil || owner == nil {
			return httpx.NotFound("Output raw material not found")
		}
		if lines, err = kit.Query(ctx, db, `SELECT component_raw_material_id AS raw_material_id, satuan_id, qty_required, waste_factor
			FROM manufacturing.raw_material_bom_items WHERE output_raw_material_id = $1 AND is_active = true`, in.rawMaterialID); err != nil {
			return err
		}
		if len(lines) == 0 {
			return httpx.BadRequest("This raw material does not have a bill of materials. Complete the recipe before production.")
		}
		fields.Set("production_context", "raw_material").Set("output_raw_material_id", in.rawMaterialID).
			Set("product_id", nil).Set("output_type", "FINISHED_GOOD")
	} else {
		owner, err = kit.QueryOne(ctx, db, `SELECT id, kode, nama, company_id::text, branch_id::text FROM products
			WHERE id = $1 AND is_active = true`, in.productID)
		if err != nil || owner == nil {
			return httpx.NotFound("Produk tidak ditemukan")
		}
		if lines, err = kit.Query(ctx, db, `SELECT raw_material_id, satuan_id, qty_required, waste_factor
			FROM manufacturing.bom_items WHERE product_id = $1 AND is_active = true`, in.productID); err != nil {
			return err
		}
		if len(lines) == 0 {
			return httpx.BadRequest("Produk belum memiliki BOM. Lengkapi recipe/BOM dulu sebelum produksi.")
		}
		fields.Set("product_id", in.productID).Set("output_type", in.outputType).Set("production_context", "product")
	}

	ids := make([]string, 0, len(lines))
	for _, l := range lines {
		if id := l.Str("raw_material_id"); id != "" {
			ids = append(ids, id)
		}
	}
	avgCost := map[string]float64{}
	stock, err := kit.Query(ctx, db, `SELECT id, avg_cost FROM v_raw_materials_stock WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return err
	}
	for _, s := range stock {
		avgCost[s.Str("id")] = s.Num("avg_cost")
	}
	materials := make([]*kit.Row, len(lines))
	plannedCost := 0.0
	for i, l := range lines {
		qty := l.Num("qty_required") * (1 + l.Num("waste_factor")) * in.plannedQty
		unit := avgCost[l.Str("raw_material_id")]
		materials[i] = kit.Obj("raw_material_id", l.Get("raw_material_id"), "satuan_id", l.Get("satuan_id"), "qty_planned", qty,
			"qty_actual", qty, "waste_qty", 0.0, "unit_cost", unit, "total_cost", qty*unit)
		plannedCost += qty * unit
	}
	hpp := (plannedCost + in.overhead + in.labor + in.packaging + in.waste) / in.plannedQty
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	company, branch := owner.Get("company_id"), owner.Get("branch_id")
	if company == nil {
		company = ps.EffectiveCompanyID(scope)
	}
	if branch == nil {
		branch = ps.EffectiveBranchID(scope)
	}
	var order *kit.Row
	var nomor string
	err = h.env.Tx(ctx, func(q database.Querier) error {
		if nomor, err = nextProductionNumber(ctx, q, h.env.Now()); err != nil {
			return err
		}
		cols := kit.Obj("nomor_produksi", nomor)
		for _, k := range fields.Keys() {
			cols.Set(k, fields.Get(k))
		}
		cols.Set("company_id", company).Set("branch_id", branch).Set("planned_qty", in.plannedQty).Set("actual_qty", 0.0).
			Set("status", "DRAFT").Set("planned_material_cost", plannedCost).Set("overhead_cost", in.overhead).
			Set("labor_cost", in.labor).Set("packaging_cost", in.packaging).Set("waste_cost", in.waste).
			Set("hpp_per_unit", hpp).Set("catatan", orNilStr(in.catatan)).Set("created_by", u.ID)
		if order, err = kit.InsertOne(ctx, q, "production_orders", cols); err != nil {
			return err
		}
		rows := make([]*kit.Row, len(materials))
		for i, m := range materials {
			rows[i] = m.Clone().Set("production_order_id", order.Get("id"))
		}
		_, err := kit.Insert(ctx, q, "production_order_materials", rows, "", false)
		return err
	})
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, kit.Obj("success", true, "data", order.Set("materials", materials),
		"message", "Production order "+nomor+" created successfully"))
}

func orNilStr(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

// nextProductionNumber is generateProductionNumber: PROD-YYYYMM-NNNN after
// the month's highest number.
func nextProductionNumber(ctx context.Context, q database.Querier, now time.Time) (string, error) {
	prefix := domain.ProductionNumberPrefix(now)
	last, err := kit.QueryOne(ctx, q, `SELECT nomor_produksi FROM production_orders WHERE nomor_produksi ILIKE $1
		ORDER BY nomor_produksi DESC LIMIT 1`, prefix+"-%")
	if err != nil {
		return "", err
	}
	lastNumber := ""
	if last != nil {
		lastNumber = last.Str("nomor_produksi")
	}
	return domain.NextProductionNumber(prefix, lastNumber), nil
}
