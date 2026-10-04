package stock

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	ps "nuhabit/backend/internal/platform/scope"
	"strings"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Supply (operational goods) stock: frontend/src/lib/purchasing/
// supply-inventory-queries.ts, supply-inventory.ts and supply-usage.ts.

// supplyBranch is supplyBranchFilter: scoped users see their branch (plus
// global rows), unscoped users everything.
func supplyBranch(s *ps.Scope) *string {
	if s == nil || s.Unscoped {
		return nil
	}
	return s.BranchID
}

const supplyStockSelect = `SELECT si.id, si.supply_item_id, si.warehouse_id, w.name AS warehouse_nama,
	s.kode AS item_kode, s.nama AS item_nama, s.kategori AS item_kategori%s, u.nama AS satuan_nama,
	COALESCE(si.qty_available, 0) AS qty_available,
	COALESCE(si.qty_on_order, 0) AS qty_on_order,
	GREATEST(COALESCE(si.qty_minimum, 0), COALESCE(s.stok_minimum, 0)) AS qty_minimum,
	COALESCE(si.unit_cost, 0) AS unit_cost%s,
	si.last_movement_at
	FROM supply_inventory si
	JOIN supply_items s ON s.id = si.supply_item_id
	LEFT JOIN configuration.warehouses w ON w.id = si.warehouse_id
	LEFT JOIN units u ON u.id = s.satuan_id`

/* GET /api/purchasing/inventory/supply?search=&warehouse_id=&low_stock=1 */
func (h *handler) supplyStock(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	sp := r.URL.Query()
	var search, warehouse *string
	if s := strings.TrimSpace(sp.Get("search")); s != "" {
		search = &s
	}
	if wid := sp.Get("warehouse_id"); wid != "" {
		warehouse = &wid
	}
	rows, err := kit.Query(r.Context(), h.env.DB, fmt.Sprintf(supplyStockSelect, "", "")+`
		WHERE si.is_active = true
		  AND ($1::uuid IS NULL OR si.branch_id = $1 OR si.branch_id IS NULL)
		  AND ($2::uuid IS NULL OR si.warehouse_id = $2)
		  AND ($3::text IS NULL OR s.nama ILIKE '%' || $3 || '%' OR s.kode ILIKE '%' || $3 || '%')
		  AND ($4::boolean = false OR COALESCE(si.qty_available,0) <= GREATEST(COALESCE(si.qty_minimum,0), COALESCE(s.stok_minimum,0)))
		ORDER BY s.nama ASC`, supplyBranch(scope), warehouse, search, sp.Get("low_stock") == "1")
	if err != nil {
		return err
	}
	return kit.Data(w, rows)
}

/* GET /api/purchasing/inventory/supply/{id} — balance plus the last 200 movements. */
func (h *handler) supplyStockDetail(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	header, err := kit.QueryOne(ctx, h.env.DB, fmt.Sprintf(supplyStockSelect, ", s.stockable", ", si.branch_id")+` WHERE si.id = $1`, id)
	if err != nil {
		return err
	}
	if header == nil || (!scope.Unscoped && header.Str("branch_id") != "" && header.Str("branch_id") != kit.Deref(scope.BranchID)) {
		return httpx.NotFound("Stok tidak ditemukan")
	}
	movements, err := kit.Query(ctx, h.env.DB, `SELECT id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
		reference_type, reference_id, reference_number, alasan, catatan, created_at
		FROM supply_inventory_movements WHERE supply_inventory_id = $1
		ORDER BY created_at DESC, id DESC LIMIT 200`, id)
	if err != nil {
		return err
	}
	return kit.Data(w, header.Set("movements", movements))
}

/*
GET /api/purchasing/inventory/supply/form-data — warehouses, stockable

	supply items and units for the usage/adjustment forms.
*/
func (h *handler) supplyFormData(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	ctx := r.Context()
	// The TS reads ignore query errors (`data || []`).
	list := func(sql string, args ...any) kit.Rows {
		rows, err := kit.Query(ctx, h.env.DB, sql, args...)
		if err != nil {
			h.env.Log.WarnContext(ctx, "supply form-data query failed", "error", err)
			return kit.Rows{}
		}
		return rows
	}
	wa := &kit.Args{}
	whWhere := `"is_active" = ` + wa.Add(true)
	if b := kit.Deref(ps.BranchFilter(scope)); b != "" {
		whWhere += ` AND ("branch_id" = ` + wa.Add(b) + `)`
	}
	sa := &kit.Args{}
	supWhere := []string{`"is_active" = ` + sa.Add(true), `"stockable" = ` + sa.Add(true), `"deleted_at" IS NULL`}
	supWhere = kit.ScopeFilters(scope, "", sa, supWhere)
	warehouses := list(`SELECT "id", "name", "code" FROM "configuration"."warehouses" WHERE `+whWhere+` ORDER BY "name" ASC`, wa.Values...)
	supplies := list(`SELECT "id", "kode", "nama", "satuan_id", "stok_minimum" FROM "supply_items" WHERE `+strings.Join(supWhere, " AND ")+
		` ORDER BY "nama" ASC`, sa.Values...)
	units := list(`SELECT "id", "nama", "kode" FROM "units" WHERE "is_active" = $1 ORDER BY "nama" ASC`, true)
	return kit.Data(w, kit.Obj("warehouses", warehouses, "supplies", supplies, "units", units))
}

/*
POST /api/purchasing/inventory/supply-adjustment — set a supply item's

	stock at a warehouse to the counted quantity.
*/
func (h *handler) adjustSupply(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	itemID := f.Str("supply_item_id", validate.Rule{}, uuidMsg("Barang wajib dipilih"))
	warehouseID := f.Str("warehouse_id", validate.Rule{}, uuidMsg("Gudang wajib dipilih"))
	qtyActual := kit.NumCheck(f, "qty_actual", validate.Rule{}, kit.Min(0, "Stok aktual minimal 0"))
	notes := f.Str("notes", validate.Rule{Optional: true}, validate.StrOpts{})
	if err := kit.FirstIssueErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	var res ledger.SupplyAdjustment
	err = h.env.Tx(ctx, func(q database.Querier) error {
		res, err = ledger.AdjustSupply(ctx, q, ledger.SupplyTarget{
			SupplyItemID: *itemID, WarehouseID: warehouseID, CompanyID: ps.EffectiveCompanyID(scope),
			BranchID: ps.EffectiveBranchID(scope), UserID: &u.ID,
		}, *qtyActual, kit.OrNil(notes), nil, h.env.Now())
		return err
	})
	if err != nil {
		return err
	}
	return kit.OK(w, kit.Obj("success", true, "data", res, "message", "Stok berhasil disesuaikan"))
}

/*
GET /api/purchasing/inventory/supply-usage — the 100 latest usages (any

	signed-in user, as in TS).
*/
func (h *handler) listSupplyUsages(w http.ResponseWriter, r *http.Request) error {
	u, err := h.env.Auth.RequireUser(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	rows, err := kit.Query(ctx, h.env.DB, `SELECT su.id, su.nomor, su.tanggal, su.warehouse_id, w.name AS warehouse_nama,
		su.divisi, su.keperluan, su.total_items, su.created_at
		FROM supply_usages su LEFT JOIN configuration.warehouses w ON w.id = su.warehouse_id
		WHERE ($1::uuid IS NULL OR su.branch_id = $1 OR su.branch_id IS NULL)
		ORDER BY su.tanggal DESC, su.created_at DESC
		LIMIT 100`, supplyBranch(scope))
	if err != nil {
		return err
	}
	return kit.Data(w, rows)
}

type usageItem struct {
	supplyItemID string
	qty          float64
	catatan      *string
}

/*
POST /api/purchasing/inventory/supply-usage — issue supply items: every

	balance is checked first, then the header, stock decrements and lines.
*/
func (h *handler) createSupplyUsage(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	warehouseID := f.Str("warehouse_id", validate.Rule{}, uuidMsg("Gudang wajib dipilih"))
	tanggal := f.Str("tanggal", validate.Rule{Optional: true}, validate.StrOpts{})
	divisi := f.Str("divisi", validate.Rule{Optional: true}, validate.StrOpts{})
	keperluan := f.Str("keperluan", validate.Rule{Optional: true}, validate.StrOpts{})
	catatan := f.Str("catatan", validate.Rule{Optional: true}, validate.StrOpts{})
	var items []usageItem
	list := f.List("items", validate.Rule{}, 1<<30, func(sub *validate.Form, i int, v any) {
		item := sub.Item(i, v)
		var it usageItem
		if id := item.UUID("supply_item_id", validate.Rule{}); id != nil {
			it.supplyItemID = *id
		}
		if q := kit.NumCheck(item, "qty", validate.Rule{}, kit.Positive("Qty harus lebih dari 0")); q != nil {
			it.qty = *q
		}
		it.catatan = item.Str("catatan", validate.Rule{Optional: true}, validate.StrOpts{})
		items = append(items, it)
	})
	if list != nil && len(list) < 1 {
		f.Fail("items", "too_small", "Minimal satu barang")
	}
	if err := kit.FirstIssueErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	for _, it := range items {
		var avail string
		err := h.env.DB.QueryRow(ctx, `SELECT COALESCE(qty_available,0)::text AS qty FROM supply_inventory
			WHERE supply_item_id = $1
			  AND COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid)
			    = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
			  AND is_active = true LIMIT 1`, it.supplyItemID, *warehouseID).Scan(&avail)
		if err != nil && !database.IsNoRows(err) {
			return err
		}
		if available := kit.ToNum(avail); it.qty > available {
			return httpx.BadRequest("Stok tidak cukup untuk salah satu barang (tersedia " + kit.JSNum(available) +
				", diminta " + kit.JSNum(it.qty) + ")")
		}
	}
	companyID, branchID := ps.EffectiveCompanyID(scope), ps.EffectiveBranchID(scope)
	now := h.env.Now()
	var id, nomor string
	err = h.env.Tx(ctx, func(q database.Querier) error {
		var err error
		if nomor, err = nextUsageNumber(ctx, q, now.UTC().Format("20060102")); err != nil {
			return err
		}
		if err := q.QueryRow(ctx, `INSERT INTO supply_usages (nomor, tanggal, warehouse_id, divisi, keperluan, catatan,
			total_items, company_id, branch_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			RETURNING id::text, nomor`, nomor, orDate(tanggal, now), *warehouseID, kit.OrNil(divisi), kit.OrNil(keperluan),
			kit.OrNil(catatan), len(items), companyID, branchID, u.ID).Scan(&id, &nomor); err != nil {
			return err
		}
		alasan := kit.Deref(keperluan)
		if alasan == "" {
			alasan = "Pemakaian " + nomor
		}
		for _, it := range items {
			unitCost, err := ledger.ReduceSupply(ctx, q, ledger.SupplyTarget{
				SupplyItemID: it.supplyItemID, WarehouseID: warehouseID, CompanyID: companyID, BranchID: branchID, UserID: &u.ID,
			}, ledger.SupplyIssue{
				Qty: it.qty, ReferenceType: "usage", ReferenceID: &id, ReferenceNumber: &nomor, Alasan: &alasan,
				Catatan: kit.OrNil(it.catatan),
			}, now)
			var short ledger.ErrSupplyShort
			if errors.As(err, &short) {
				return httpx.BadRequest(short.Error())
			}
			if err != nil {
				return err
			}
			if _, err := q.Exec(ctx, `INSERT INTO supply_usage_items (usage_id, supply_item_id, qty, unit_cost, catatan)
				VALUES ($1, $2, $3, $4, $5)`, id, it.supplyItemID, kit.N(it.qty), kit.N(unitCost), kit.OrNil(it.catatan)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return kit.OK(w, kit.Obj("success", true, "data", kit.Obj("id", id, "nomor", nomor), "message", "Pemakaian "+nomor+" tercatat"))
}

// nextUsageNumber is PMK-YYYYMMDD-NNNN, the day's count plus one.
func nextUsageNumber(ctx context.Context, q database.Querier, stamp string) (string, error) {
	var n string
	if err := q.QueryRow(ctx, `SELECT COUNT(*)::text AS n FROM supply_usages WHERE nomor LIKE $1`, "PMK-"+stamp+"-%").Scan(&n); err != nil {
		return "", err
	}
	return fmt.Sprintf("PMK-%s-%04d", stamp, atoi(n)+1), nil
}
