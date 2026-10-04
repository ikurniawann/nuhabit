package app

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/modules/procurement"
	pdomain "nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/database"
)

// Stopgap SQL adapters for the procurement ports, ported from the TS
// purchasing libs. Each reads tables owned by another context (identity,
// HRIS, the item master, POS, inventory) until those modules expose a
// service to adapt instead.

// ProcurementPorts builds the procurement ports on the process time zone.
func ProcurementPorts(loc *time.Location, now func() time.Time) procurement.Ports {
	rr := procurement.RowReader{Loc: loc}
	return procurement.Ports{
		Directory:   procurementDirectory{rr: rr},
		Catalog:     procurementCatalog{rr: rr},
		Pricing:     procurementPricing{rr: rr, now: now, loc: loc},
		Locations:   procurementLocations{},
		Merchandise: procurementMerchandise{},
		ReturnStock: procurementReturnStock{now: now},
		Production:  procurementProduction{rr: rr},
		Owner:       procurementOwnerNotifier{client: &http.Client{}, getenv: os.Getenv},
	}
}

/* ── Identity users and HRIS departments ─────────────────────────────── */

type procurementDirectory struct{ rr procurement.RowReader }

func (procurementDirectory) Users(ctx context.Context, q database.Querier, ids []string) (map[string]procurement.UserRef, error) {
	out := map[string]procurement.UserRef{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT id::text, full_name, company_id::text, branch_id::text FROM configuration.users WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var u procurement.UserRef
		if err := rows.Scan(&u.ID, &u.FullName, &u.CompanyID, &u.BranchID); err != nil {
			return nil, err
		}
		out[u.ID] = u
	}
	return out, rows.Err()
}

func (procurementDirectory) DepartmentNames(ctx context.Context, q database.Querier, ids []string) (map[string]string, error) {
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT id::text, name FROM hris.departments WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[id] = name
	}
	return out, rows.Err()
}

func (d procurementDirectory) Department(ctx context.Context, q database.Querier, id string) (*procurement.Row, error) {
	return d.rr.One(ctx, q, `SELECT name, code FROM hris.departments WHERE id = $1::text::uuid`, id)
}

func (d procurementDirectory) ActiveDepartments(ctx context.Context, q database.Querier) ([]*procurement.Row, error) {
	return d.rr.Query(ctx, q, `SELECT id, name FROM hris.departments WHERE is_active = true ORDER BY name ASC`)
}

/* ── Item master and POS SKUs ────────────────────────────────────────── */

type procurementCatalog struct{ rr procurement.RowReader }

// catalogTables whitelists the tables behind procurement.Entity.
var catalogTables = map[procurement.Entity]string{
	procurement.EntityRawMaterial: "item.raw_materials",
	procurement.EntityProduct:     "item.products",
	procurement.EntityUnit:        "item.units",
	procurement.EntitySupplyItem:  "item.supply_items",
	procurement.EntityPosSku:      "pos.pos_product_skus",
}

// catalogColumns whitelists the column lists the procurement screens embed.
var catalogColumns = map[string]bool{
	"*": true, "id, kode, nama": true, "id, nama": true, "id, nama, kode": true,
	"id, kode, nama, satuan_id": true, "id, kode, nama, satuan_id, stockable": true, "id, sku, name": true,
	"id, nama, kode, satuan_besar_id": true, "id, nama, satuan_besar_id, satuan_kecil_id": true, "id, kode, nama, satuan_besar_id": true, "kode, nama": true, "nama": true,
}

func (procurementCatalog) Refs(ctx context.Context, q database.Querier, e procurement.Entity, columns string, ids []string) (map[string]json.RawMessage, error) {
	out := map[string]json.RawMessage{}
	table, ok := catalogTables[e]
	if !ok || !catalogColumns[columns] {
		return nil, errUnknownCatalog
	}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT e.id::text, row_to_json(e)::text FROM (SELECT `+columns+` FROM `+table+` WHERE id = ANY($1::uuid[])) e`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, raw string
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		out[id] = json.RawMessage(raw)
	}
	return out, rows.Err()
}

type catalogError string

func (e catalogError) Error() string { return string(e) }

const errUnknownCatalog = catalogError("procurement catalog: unknown entity or column list")

func scopeFilter(sql string, companyID, branchID *string) (string, []any) {
	args := []any{}
	if companyID != nil {
		args = append(args, *companyID)
		sql += ` AND company_id = $1::text::uuid`
	}
	if branchID != nil {
		args = append(args, *branchID)
		if len(args) == 2 {
			sql += ` AND branch_id = $2::text::uuid`
		} else {
			sql += ` AND branch_id = $1::text::uuid`
		}
	}
	return sql, args
}

func (c procurementCatalog) FormProducts(ctx context.Context, q database.Querier, companyID, branchID *string) ([]*procurement.Row, error) {
	sql, args := scopeFilter(`SELECT id, kode, nama, satuan_id, satuan_nama, harga_modal FROM public.v_products_cogs
		WHERE is_active = true AND deleted_at IS NULL`, companyID, branchID)
	return c.rr.Query(ctx, q, sql+` ORDER BY nama ASC`, args...)
}

func (c procurementCatalog) FormSupplies(ctx context.Context, q database.Querier, companyID, branchID *string) ([]*procurement.Row, error) {
	sql, args := scopeFilter(`SELECT id, kode, nama, satuan_id, stockable, harga_beli FROM item.supply_items
		WHERE is_active = true AND deleted_at IS NULL`, companyID, branchID)
	return c.rr.Query(ctx, q, sql+` ORDER BY nama ASC`, args...)
}

func (c procurementCatalog) FormMaterials(ctx context.Context, q database.Querier) ([]*procurement.Row, error) {
	materials, err := c.rr.Query(ctx, q, `SELECT id, kode, nama, satuan_besar_id, satuan_besar_nama, satuan_kecil_id, konversi_factor, avg_cost
		FROM public.v_raw_materials_stock WHERE is_active = true ORDER BY nama ASC`)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(materials))
	for _, m := range materials {
		ids = append(ids, m.Str("id"))
	}
	byMaterial := map[string][]*procurement.Row{}
	if len(ids) > 0 {
		packs, err := c.rr.Query(ctx, q, `SELECT raw_material_id, satuan_id, qty_in_base_unit, is_base, is_purchase_default, is_active
			FROM item.raw_material_unit_conversions WHERE raw_material_id = ANY($1::uuid[]) AND is_active = true`, ids)
		if err != nil {
			packs = nil
		}
		for _, p := range packs {
			byMaterial[p.Str("raw_material_id")] = append(byMaterial[p.Str("raw_material_id")], p)
		}
	}
	for _, m := range materials {
		list := byMaterial[m.Str("id")]
		if list == nil {
			list = []*procurement.Row{}
		}
		m.Set("unit_conversions", list)
	}
	return materials, nil
}

func (c procurementCatalog) ActiveUnits(ctx context.Context, q database.Querier, columns string) ([]*procurement.Row, error) {
	if !catalogColumns[columns] {
		return nil, errUnknownCatalog
	}
	return c.rr.Query(ctx, q, `SELECT `+columns+` FROM item.units WHERE is_active = true ORDER BY nama ASC`)
}

func (c procurementCatalog) MerchandiseSkus(ctx context.Context, q database.Querier, productIDs []string) ([]*procurement.Row, error) {
	if len(productIDs) == 0 {
		return []*procurement.Row{}, nil
	}
	return c.rr.Query(ctx, q, `SELECT s.id, s.product_id, s.sku, s.name, s.options, s.stock_quantity, s.is_active, p.source_product_id
		FROM pos.pos_product_skus s JOIN pos.pos_products p ON p.id = s.product_id
		WHERE p.product_kind = 'merchandise' AND p.source_product_id = ANY($1::uuid[])
		ORDER BY s.name ASC`, productIDs)
}

/* ── Purchase price suggestions (lib/purchasing/purchase-price.ts) ───── */

type procurementPricing struct {
	rr  procurement.RowReader
	now func() time.Time
	loc *time.Location
}

// UnitPrices is getPurchasePriceSuggestions(...).map(s => s.unit_price):
// the newest receipt cost from this supplier, else from anyone, else the
// master price, scaled from the base unit to the requested unit. Lookup
// errors read as "no data", as the TS ignores them.
func (p procurementPricing) UnitPrices(ctx context.Context, q database.Querier, items []procurement.PriceRequest, supplierID string) ([]float64, error) {
	ids := []string{}
	seen := map[string]bool{}
	for _, it := range items {
		if it.RawMaterialID != "" && !seen[it.RawMaterialID] {
			seen[it.RawMaterialID] = true
			ids = append(ids, it.RawMaterialID)
		}
	}
	out := make([]float64, len(items))
	if len(ids) == 0 {
		return out, nil
	}
	materials, err := procurementCatalog{rr: p.rr}.MaterialUnits(ctx, q, ids)
	if err != nil {
		materials = map[string]procurement.MaterialUnits{}
	}
	baseCosts := p.baseUnitCosts(ctx, q, ids, materials, supplierID)
	for i, it := range items {
		factor := 1.0
		if m, ok := materials[it.RawMaterialID]; ok {
			satuan := ""
			if it.SatuanID != nil {
				satuan = *it.SatuanID
			}
			factor = pdomain.PackFactor(&m.Units, m.Packs, satuan)
		}
		if factor <= 0 {
			factor = 1
		}
		out[i] = baseCosts[it.RawMaterialID] * factor
	}
	return out, nil
}

func (p procurementPricing) baseUnitCosts(ctx context.Context, q database.Querier, ids []string, materials map[string]procurement.MaterialUnits, supplierID string) map[string]float64 {
	result := map[string]float64{}
	tier := map[string]string{}
	start := p.now().In(p.loc).AddDate(0, -24, 0)
	movements, err := p.rr.Query(ctx, q, `SELECT raw_material_id, unit_cost, reference_type, reference_id
		FROM inventory.inventory_movements
		WHERE raw_material_id = ANY($1::uuid[]) AND tipe = 'in' AND reference_type IN ('grn', 'import') AND created_at >= $2
		ORDER BY created_at DESC LIMIT 500`, ids, start)
	if err != nil {
		movements = nil
	}
	var priced []*procurement.Row
	var grnIDs []string
	for _, m := range movements {
		if m.Num("unit_cost") > 0 {
			priced = append(priced, m)
			if m.Str("reference_type") == "grn" && m.Str("reference_id") != "" {
				grnIDs = append(grnIDs, m.Str("reference_id"))
			}
		}
	}
	fromSupplier := map[string]bool{}
	if supplierID != "" && len(grnIDs) > 0 {
		rows, err := q.Query(ctx, `SELECT id::text FROM purchasing.grn WHERE id = ANY($1::uuid[]) AND supplier_id = $2::text::uuid`, grnIDs, supplierID)
		if err == nil {
			list, _ := pgx.CollectRows(rows, pgx.RowTo[string])
			for _, id := range list {
				fromSupplier[id] = true
			}
		}
	}
	for _, m := range priced {
		id := m.Str("raw_material_id")
		supplier := m.Str("reference_type") == "grn" && fromSupplier[m.Str("reference_id")]
		if existing, ok := tier[id]; ok && (existing == "supplier_grn" || !supplier) {
			continue
		}
		result[id] = m.Num("unit_cost")
		if supplier {
			tier[id] = "supplier_grn"
		} else {
			tier[id] = "any_grn"
		}
	}
	prices, err := p.rr.Query(ctx, q, `SELECT id, harga_beli FROM item.raw_materials WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		prices = nil
	}
	for _, r := range prices {
		id, harga := r.Str("id"), r.Num("harga_beli")
		if _, ok := tier[id]; ok || harga <= 0 {
			continue
		}
		m := materials[id]
		if big := pdomain.PackFactor(&m.Units, nil, m.Units.SatuanBesarID); big > 0 {
			result[id] = harga / big
		} else {
			result[id] = harga
		}
	}
	return result
}

func (procurementCatalog) ShelfLifeDays(ctx context.Context, q database.Querier, ids []string) (map[string]*float64, error) {
	out := map[string]*float64{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT id::text, shelf_life_days::float8 FROM item.raw_materials WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var days *float64
		if err := rows.Scan(&id, &days); err != nil {
			return nil, err
		}
		out[id] = days
	}
	return out, rows.Err()
}

/* ── Configuration: warehouses, branches, companies (lib/api/scope.ts) ─ */

type procurementLocations struct{}

func scanBusiness(row pgx.Row) (*procurement.BusinessIDs, error) {
	var b procurement.BusinessIDs
	if err := row.Scan(&b.CompanyID, &b.BranchID); err != nil {
		if database.IsNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	return &b, nil
}

func (procurementLocations) WarehouseScope(ctx context.Context, q database.Querier, warehouseID string) (*procurement.BusinessIDs, error) {
	return scanBusiness(q.QueryRow(ctx, `SELECT c.id::text, b.id::text
		FROM configuration.warehouses w
		JOIN configuration.branches b ON b.id = w.branch_id
		JOIN configuration.companies c ON c.id = b.company_id
		WHERE w.id = $1::text::uuid AND w.is_active = true AND b.is_active = true AND c.is_active = true`, warehouseID))
}

func (procurementLocations) ScopeByCodes(ctx context.Context, q database.Querier, companyCode, branchCode string) (*procurement.BusinessIDs, error) {
	return scanBusiness(q.QueryRow(ctx, `SELECT c.id::text, b.id::text
		FROM configuration.companies c JOIN configuration.branches b ON b.company_id = c.id
		WHERE c.code = $1 AND b.code = $2 AND c.is_active = true AND b.is_active = true`, companyCode, branchCode))
}

func (procurementLocations) Warehouse(ctx context.Context, q database.Querier, id string) (*procurement.Warehouse, error) {
	var w procurement.Warehouse
	err := q.QueryRow(ctx, `SELECT w.branch_id::text, w.is_active, b.company_id::text
		FROM configuration.warehouses w LEFT JOIN configuration.branches b ON b.id = w.branch_id
		WHERE w.id = $1::text::uuid`, id).Scan(&w.BranchID, &w.IsActive, &w.CompanyID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &w, nil
}

func (procurementLocations) WarehouseNames(ctx context.Context, q database.Querier, ids []string) (map[string]*string, error) {
	out := map[string]*string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT id::text, name FROM configuration.warehouses WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var name *string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[id] = name
	}
	return out, rows.Err()
}

/* ── POS merchandise stock (database functions owned by POS) ─────────── */

type procurementMerchandise struct{}

func (procurementMerchandise) ReceiveSkuStock(ctx context.Context, q database.Querier, skuID string, qty float64) (int, error) {
	var n *int
	err := q.QueryRow(ctx, `SELECT public.pos_receive_merchandise_sku_stock($1::uuid, $2::numeric)`, skuID, qty).Scan(&n)
	if err != nil || n == nil {
		return 0, err
	}
	return *n, nil
}

func (procurementMerchandise) ReceiveProductStock(ctx context.Context, q database.Querier, productID string, qty float64) (int, error) {
	var n *int
	err := q.QueryRow(ctx, `SELECT public.pos_receive_merchandise_stock($1::uuid, $2::numeric)`, productID, qty).Scan(&n)
	if err != nil || n == nil {
		return 0, err
	}
	return *n, nil
}

func (procurementCatalog) MaterialUnits(ctx context.Context, q database.Querier, ids []string) (map[string]procurement.MaterialUnits, error) {
	out := map[string]procurement.MaterialUnits{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT id::text, COALESCE(satuan_besar_id::text, ''), COALESCE(satuan_kecil_id::text, ''), COALESCE(konversi_factor, 0)::float8
		FROM item.raw_materials WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var m procurement.MaterialUnits
		if err := rows.Scan(&id, &m.Units.SatuanBesarID, &m.Units.SatuanKecilID, &m.Units.KonversiFactor); err != nil {
			rows.Close()
			return nil, err
		}
		out[id] = m
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	packs, err := q.Query(ctx, `SELECT raw_material_id::text, satuan_id::text, COALESCE(qty_in_base_unit, 0)::float8, COALESCE(is_base, false), COALESCE(is_purchase_default, false)
		FROM item.raw_material_unit_conversions WHERE raw_material_id = ANY($1::uuid[]) AND is_active = true`, ids)
	if err != nil {
		return nil, err
	}
	defer packs.Close()
	for packs.Next() {
		var id string
		var p pdomain.Pack
		if err := packs.Scan(&id, &p.SatuanID, &p.QtyInBase, &p.IsBase, &p.IsPurchaseDefault); err != nil {
			return nil, err
		}
		if m, ok := out[id]; ok {
			m.Packs = append(m.Packs, p)
			out[id] = m
		}
	}
	return out, packs.Err()
}

func (procurementCatalog) StockableSupplies(ctx context.Context, q database.Querier, ids []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT id::text FROM item.supply_items WHERE id = ANY($1::uuid[]) AND stockable = true`, ids)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, pgx.RowTo[string])
	for _, id := range list {
		out[id] = true
	}
	return out, err
}

/* ── Inventory: purchase return stock-out (inventory ledger) ─────────── */

type procurementReturnStock struct{ now func() time.Time }

// Reduce takes an approved return line out of raw material stock (receipt
// warehouse) or finished goods stock, on the caller's transaction.
func (a procurementReturnStock) Reduce(ctx context.Context, q database.Querier, l procurement.ReturnStockLine) error {
	in := ledger.PurchaseReturn{
		RawMaterialID: l.RawMaterialID, ProductID: l.ProductID, Qty: l.Qty, UnitCost: l.UnitCost,
		ReturnID: l.ReturnID, ReturnNumber: l.ReturnNumber, WarehouseID: l.WarehouseID, UserID: l.UserID, ConditionNotes: l.ConditionNotes,
	}
	if l.ProductID != "" {
		return ledger.ReduceProductForPurchaseReturn(ctx, q, in, a.now())
	}
	return ledger.ReduceForPurchaseReturn(ctx, q, in, a.now())
}

func (procurementCatalog) ProductsMatch(ctx context.Context, q database.Querier, term string) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM item.products WHERE (nama ILIKE $1 OR kode ILIKE $1) AND deleted_at IS NULL)`, term).Scan(&ok)
	return ok, err
}

func (procurementCatalog) ProductUnit(ctx context.Context, q database.Querier, productID string) (bool, *string, error) {
	var unit *string
	err := q.QueryRow(ctx, `SELECT satuan_id::text FROM item.products WHERE id = $1::text::uuid AND deleted_at IS NULL`, productID).Scan(&unit)
	if err != nil {
		return false, nil, nil
	}
	return true, unit, nil
}

func (p procurementPricing) GrnMovements(ctx context.Context, q database.Querier, grnIDs []string, rawMaterialID *string) ([]*procurement.Row, error) {
	sql := `SELECT id, raw_material_id, jumlah, unit_cost, reference_id, reference_number, created_at FROM inventory.inventory_movements
		WHERE tipe = 'in' AND reference_type = 'grn' AND reference_id = ANY($1::uuid[])`
	args := []any{grnIDs}
	if rawMaterialID != nil && *rawMaterialID != "" {
		sql += ` AND raw_material_id = $2::text::uuid`
		args = append(args, *rawMaterialID)
	}
	return p.rr.Query(ctx, q, sql+` ORDER BY created_at DESC LIMIT 1000`, args...)
}

/* ── Manufacturing: production orders (report-production-in-house.ts) ─ */

type procurementProduction struct{ rr procurement.RowReader }

func (procurementProduction) WarehouseProductIDs(ctx context.Context, q database.Querier, warehouseID string) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT id::text FROM item.products WHERE warehouse_id = $1::text::uuid AND is_active = true`, warehouseID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (p procurementProduction) Orders(ctx context.Context, q database.Querier, f procurement.ProductionFilter) ([]*procurement.Row, error) {
	col := "completed_at"
	if f.DateField == "created_at" {
		col = "created_at"
	}
	sql := `SELECT * FROM public.v_production_orders WHERE production_context = 'product'`
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	if f.DateFrom != nil && *f.DateFrom != "" {
		sql += ` AND ` + col + ` >= ` + arg(*f.DateFrom+"T00:00:00.000Z") + `::text::timestamptz`
	}
	if f.DateTo != nil && *f.DateTo != "" {
		sql += ` AND ` + col + ` <= ` + arg(*f.DateTo+"T23:59:59.999Z") + `::text::timestamptz`
	}
	if f.Status != nil && *f.Status != "" && *f.Status != "all" {
		sql += ` AND status = ` + arg(strings.ToUpper(*f.Status))
	}
	if f.OutputType != "all" {
		sql += ` AND output_type = ` + arg(f.OutputType)
	}
	if f.ProductID != nil && *f.ProductID != "" {
		sql += ` AND product_id = ` + arg(*f.ProductID) + `::text::uuid`
	}
	if f.ProductIDs != nil {
		sql += ` AND product_id = ANY(` + arg(f.ProductIDs) + `::uuid[])`
	}
	return p.rr.Query(ctx, q, sql+` ORDER BY `+col+` DESC NULLS LAST`, args...)
}

func (p procurementProduction) ProductWarehouses(ctx context.Context, q database.Querier, productIDs []string) (map[string]*procurement.Row, error) {
	out := map[string]*procurement.Row{}
	if len(productIDs) == 0 {
		return out, nil
	}
	rows, err := p.rr.Query(ctx, q, `SELECT p.id AS product_id, p.warehouse_id, w.name AS warehouse_name, w.code AS warehouse_code
		FROM item.products p LEFT JOIN configuration.warehouses w ON w.id = p.warehouse_id WHERE p.id = ANY($1::uuid[])`, productIDs)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.Str("product_id")] = r
	}
	return out, nil
}

/* ── Owner WhatsApp alerts (lib/wa/notifications-sender.ts) ──────────── */

// procurementOwnerNotifier is sendOwnerNotification for procurement's
// alerts. Owner notifications are not in a porting wave; this adapter moves
// to that module when it exists.
type procurementOwnerNotifier struct {
	client *http.Client
	getenv func(string) string
}

var waRecipient = regexp.MustCompile(`^62\d{8,13}$`)

// normalizeWaRecipient is normalizeWaRecipient: 08…/+62…/62… → 62…, or "".
func normalizeWaRecipient(raw string) string {
	var b strings.Builder
	for _, c := range raw {
		if (c >= '0' && c <= '9') || c == '+' {
			b.WriteRune(c)
		}
	}
	n := strings.TrimPrefix(b.String(), "+")
	if strings.HasPrefix(n, "0") {
		n = "62" + n[1:]
	}
	if !waRecipient.MatchString(n) {
		return ""
	}
	return n
}

func (n procurementOwnerNotifier) settings(ctx context.Context, q database.Querier, keys ...string) map[string]string {
	out := map[string]string{}
	rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`, keys)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		var v *string
		if rows.Scan(&k, &v) == nil && v != nil {
			out[k] = *v
		}
	}
	return out
}

// Notify sends message to the configured owners once per dedup key.
func (n procurementOwnerNotifier) Notify(ctx context.Context, q database.Querier, notifType, dedupKey, message string) error {
	var cfg struct {
		Enabled    *bool          `json:"enabled"`
		Recipients []any          `json:"recipients"`
		Types      map[string]any `json:"types"`
	}
	stored := n.settings(ctx, q, "wa_notif_config", "wa_gateway_url", "wa_gateway_token")
	if raw := stored["wa_notif_config"]; raw == "" || json.Unmarshal([]byte(raw), &cfg) != nil || cfg.Enabled == nil || !*cfg.Enabled {
		return nil
	}
	if on, ok := cfg.Types[notifType].(bool); ok && !on {
		return nil
	}
	var recipients []string
	for _, r := range cfg.Recipients {
		if s, ok := r.(string); ok {
			if norm := normalizeWaRecipient(s); norm != "" && len(recipients) < 5 {
				recipients = append(recipients, norm)
			}
		}
	}
	token := strings.TrimSpace(stored["wa_gateway_token"])
	if token == "" {
		token = n.getenv("WA_GATEWAY_TOKEN")
	}
	if len(recipients) == 0 || token == "" {
		return nil
	}
	base := strings.TrimSpace(stored["wa_gateway_url"])
	if base == "" {
		base = n.getenv("WA_GATEWAY_URL")
	}
	if base == "" {
		base = "http://127.0.0.1:3471"
	}
	timeout := 20 * time.Second
	if ms, err := strconv.Atoi(n.getenv("WA_GATEWAY_TIMEOUT_MS")); err == nil && ms > 0 {
		timeout = time.Duration(ms) * time.Millisecond
	}
	list, _ := json.Marshal(recipients)
	var claimID string
	err := q.QueryRow(ctx, `INSERT INTO configuration.wa_notif_log (notif_type, dedup_key, message, recipients)
		VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (notif_type, dedup_key) DO NOTHING RETURNING id::text`,
		notifType, dedupKey, message, string(list)).Scan(&claimID)
	if database.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	delivered, timedOut := 0, false
	for _, target := range recipients {
		body, _ := json.Marshal(map[string]string{"target": target, "message": message})
		reqCtx, cancel := context.WithTimeout(ctx, timeout)
		req, _ := http.NewRequestWithContext(reqCtx, http.MethodPost, base+"/send", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-gateway-token", token)
		resp, err := n.client.Do(req)
		cancel()
		switch {
		case err != nil && reqCtx.Err() != nil:
			timedOut = true
		case err != nil:
			slog.ErrorContext(ctx, "[wa-notif] gagal kirim", "type", notifType, "error", err)
		default:
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				delivered++
			}
			resp.Body.Close()
		}
	}
	if delivered == 0 && !timedOut {
		_, err = q.Exec(ctx, `DELETE FROM configuration.wa_notif_log WHERE id = $1`, claimID)
	}
	return err
}
