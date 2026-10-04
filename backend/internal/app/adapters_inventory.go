package app

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/inventory/catalog"
	invdomain "nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/production"
	"nuhabit/backend/internal/modules/inventory/stock"
	"nuhabit/backend/internal/platform/database"
)

// Adapters for inventory's ports. The SQL is ported from the TS routes and
// reads tables other contexts own: procurement (purchase_orders, suppliers)
// and the POS catalog (pos_products, pos_product_skus).

/* ── Procurement ─────────────────────────────────────────────────────── */

type inventoryProcurement struct{}

var _ stock.Procurement = inventoryProcurement{}

// LastPurchases is the LATERAL last_po join of listLowStock
// (lib/inventory/low-stock.ts).
func (inventoryProcurement) LastPurchases(ctx context.Context, q database.Querier, rawMaterialIDs []string) (map[string]stock.LastPurchase, error) {
	rows, err := q.Query(ctx, `SELECT DISTINCT ON (poi.raw_material_id) poi.raw_material_id::text, po.supplier_id::text,
		s.nama_supplier, po.tanggal_po::text
		FROM purchasing.purchase_order_items poi
		JOIN purchasing.purchase_orders po ON po.id = poi.purchase_order_id
		LEFT JOIN purchasing.suppliers s ON s.id = po.supplier_id
		WHERE poi.raw_material_id = ANY($1::uuid[]) AND po.supplier_id IS NOT NULL
		ORDER BY poi.raw_material_id, po.tanggal_po DESC, po.created_at DESC`, rawMaterialIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]stock.LastPurchase{}
	for rows.Next() {
		var id string
		var lp stock.LastPurchase
		if err := rows.Scan(&id, &lp.SupplierID, &lp.SupplierName, &lp.TanggalPO); err != nil {
			return nil, err
		}
		out[id] = lp
	}
	return out, rows.Err()
}

/* ── POS catalog SKUs ────────────────────────────────────────────────── */

type inventoryPosSkus struct{}

var _ stock.PosSkus = inventoryPosSkus{}

// ActiveSkus is loadVariantsByProductId / fetchActiveSkusByProductId: active
// SKUs of the merchandise POS products linked to master products.
func (inventoryPosSkus) ActiveSkus(ctx context.Context, q database.Querier, productIDs []string) (map[string][]stock.Sku, error) {
	rows, err := q.Query(ctx, `SELECT sp.source_product_id::text, sk.id::text, sk.sku, sk.name, sk.options, sk.stock_quantity::float8
		FROM pos.pos_products sp
		JOIN pos.pos_product_skus sk ON sk.product_id = sp.id AND sk.is_active = true
		WHERE sp.product_kind = 'merchandise' AND sp.source_product_id = ANY($1::uuid[])
		ORDER BY sk.sku ASC`, productIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]stock.Sku{}
	for rows.Next() {
		var productID string
		var s stock.Sku
		var qty *float64
		if err := rows.Scan(&productID, &s.ID, &s.Sku, &s.Name, &s.Options, &qty); err != nil {
			return nil, err
		}
		if qty != nil {
			s.StockQuantity = *qty
		}
		out[productID] = append(out[productID], s)
	}
	return out, rows.Err()
}

// LockSkuStock is `SELECT stock_quantity … FOR UPDATE` of the product opname.
func (inventoryPosSkus) LockSkuStock(ctx context.Context, q database.Querier, skuID string) (float64, bool, error) {
	var qty *float64
	err := q.QueryRow(ctx, `SELECT stock_quantity::float8 FROM pos.pos_product_skus WHERE id = $1 FOR UPDATE`, skuID).Scan(&qty)
	if database.IsNoRows(err) {
		return 0, false, nil
	}
	if err != nil || qty == nil {
		return 0, err == nil, err
	}
	return *qty, true, nil
}

// SetSkuStock sets the counted SKU stock of a completed product opname.
func (inventoryPosSkus) SetSkuStock(ctx context.Context, q database.Querier, skuID string, qty float64) error {
	_, err := q.Exec(ctx, `UPDATE pos.pos_product_skus SET stock_quantity = $1, updated_at = now() WHERE id = $2`, kit.N(qty), skuID)
	return err
}

// SkuLabels reads the SKU code and name the opname lines show.
func (inventoryPosSkus) SkuLabels(ctx context.Context, q database.Querier, skuIDs []string) (map[string]stock.Sku, error) {
	rows, err := q.Query(ctx, `SELECT id::text, sku, name FROM pos.pos_product_skus WHERE id = ANY($1::uuid[])`, skuIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]stock.Sku{}
	for rows.Next() {
		var s stock.Sku
		if err := rows.Scan(&s.ID, &s.Sku, &s.Name); err != nil {
			return nil, err
		}
		out[s.ID] = s
	}
	return out, rows.Err()
}

/* ── POS catalog sync (lib/pos/purchasing-sync.ts) ───────────────────── */

type inventoryPosCatalog struct{ now func() time.Time }

var _ catalog.PosCatalog = inventoryPosCatalog{}

var (
	posDrinkCategory   = regexp.MustCompile(`(?i)minuman|drink|coffee|kopi|tea|bar`)
	posDessertCategory = regexp.MustCompile(`(?i)dessert|roti|cake|bakery|pastry`)
	posSnackCategory   = regexp.MustCompile(`(?i)snack|cemilan`)
)

// posCategoryName is normalizeCategoryName.
func posCategoryName(kategori string) string {
	c := strings.TrimSpace(kategori)
	switch {
	case c == "":
		return "Makanan"
	case posDrinkCategory.MatchString(c):
		return "Minuman"
	case posDessertCategory.MatchString(c):
		return "Dessert"
	case posSnackCategory.MatchString(c):
		return "Snack"
	}
	return c
}

// SyncProduct is syncPurchasingProductToPos.
func (a inventoryPosCatalog) SyncProduct(ctx context.Context, q database.Querier, productID, station string, costOverride *float64) (*kit.Row, error) {
	p, err := kit.QueryOne(ctx, q, `SELECT * FROM v_products_cogs WHERE id = $1`, productID)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, errors.New("Purchasing product not found")
	}
	kode := p.Str("kode")
	sku := "PUR-" + kode
	if kode == "" {
		sku = "PUR-" + productID[:min(8, len(productID))]
	}
	var categoryID any
	name := posCategoryName(p.Str("kategori"))
	cat, err := kit.QueryOne(ctx, q, `SELECT id FROM pos_categories WHERE name ILIKE $1 LIMIT 1`, name)
	if err != nil {
		return nil, err
	}
	if cat != nil {
		categoryID = cat.Get("id")
	} else if created, err := kit.InsertOne(ctx, q, "pos_categories", kit.Obj("name", name, "is_active", true)); err == nil && created != nil {
		categoryID = created.Get("id")
	}
	base := p.Num("harga_jual")
	cost := kit.ToNum(p.Get("hpp_estimasi"))
	if p.Get("hpp_estimasi") == nil {
		cost = kit.ToNum(p.Get("estimated_cogs"))
	}
	if costOverride != nil {
		cost = *costOverride
	}
	desc := p.Str("deskripsi")
	if desc == "" {
		desc = "Synced from Purchasing product " + firstNonEmptyStr(kode, productID)
	}
	productName := p.Str("nama")
	if productName == "" {
		productName = sku
	}
	now := time.Now()
	if a.now != nil {
		now = a.now()
	}
	payload := kit.Obj("sku", sku, "name", productName, "description", desc, "category_id", categoryID, "base_price", base,
		"cost_price", cost, "is_active", p.Get("is_active") != false, "is_available", true, "inventory_tracking", false,
		"station", invdomain.ResolvePosStation(station, p.Str("kategori")), "updated_at", now)
	existing, err := kit.QueryOne(ctx, q, `SELECT id FROM pos_products WHERE sku = $1 LIMIT 1`, sku)
	if err != nil {
		return nil, err
	}
	mode := "created"
	var product *kit.Row
	if existing != nil {
		mode = "updated"
		rows, err := kit.Update(ctx, q, "pos_products", payload, func(args *kit.Args) string { return `"id" = ` + args.Add(existing.Get("id")) }, true)
		if err != nil {
			return nil, err
		}
		if len(rows) == 0 {
			return nil, errors.New("No rows found")
		}
		product = rows[0]
	} else if product, err = kit.InsertOne(ctx, q, "pos_products", payload.Set("created_at", now)); err != nil {
		return nil, err
	}
	basePrice := product.Num("base_price")
	margin := 0.0
	if basePrice > 0 {
		margin = kit.JSRound((basePrice-cost)/basePrice*10000) / 100
	}
	return kit.Obj("mode", mode, "product", product, "cost_price", cost, "base_price", basePrice,
		"gross_profit", basePrice-cost, "margin_percentage", margin), nil
}

func firstNonEmptyStr(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// VariantCounts is attachVariantCounts' query.
func (inventoryPosCatalog) VariantCounts(ctx context.Context, q database.Querier, productIDs []string) (map[string]int, error) {
	rows, err := q.Query(ctx, `SELECT p.source_product_id::text, COUNT(s.id)::int
		FROM pos.pos_products p JOIN pos.pos_product_skus s ON s.product_id = p.id AND s.is_active = true
		WHERE p.source_product_id = ANY($1::uuid[]) GROUP BY p.source_product_id`, productIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

/* ── Procurement GRNs (purchase price suggestions) ───────────────────── */

type inventoryGrns struct{}

var _ catalog.Procurement = inventoryGrns{}

// SupplierGrnIDs is resolveSupplierGrnIds in lib/purchasing/purchase-price.ts.
func (inventoryGrns) SupplierGrnIDs(ctx context.Context, q database.Querier, grnIDs []string, supplierID string) (map[string]bool, error) {
	rows, err := q.Query(ctx, `SELECT id::text FROM grn WHERE id = ANY($1::uuid[]) AND supplier_id = $2`, grnIDs, supplierID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

/* ── Procurement receipts (COGS landed cost) ─────────────────────────── */

type inventoryReceipts struct{}

var _ production.Receipts = inventoryReceipts{}

// receiptValue is a GRN line's value: quantity received × PO unit price.
const receiptValue = `(gi.qty_diterima * poi.harga_satuan)::float8`

// ReceivedValues is loadReceivedValues in lib/purchasing/cogs-additional-cost.ts.
func (inventoryReceipts) ReceivedValues(ctx context.Context, q database.Querier, rawMaterialIDs []string) ([]invdomain.ReceiptLine, map[string]float64, error) {
	rows, err := q.Query(ctx, `SELECT gi.grn_id::text, g.purchase_order_id::text, gi.raw_material_id::text, `+receiptValue+`
		FROM purchasing.grn_items gi
		JOIN purchasing.grn g ON g.id = gi.grn_id AND g.is_active = true
		JOIN purchasing.purchase_order_items poi ON poi.id = gi.purchase_order_item_id
		WHERE gi.is_active = true AND gi.raw_material_id = ANY($1::uuid[])`, rawMaterialIDs)
	if err != nil {
		return nil, nil, err
	}
	lines, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (invdomain.ReceiptLine, error) {
		var l invdomain.ReceiptLine
		return l, r.Scan(&l.GrnID, &l.PoID, &l.MaterialID, &l.Value)
	})
	if err != nil || len(lines) == 0 {
		return nil, nil, err
	}
	var grns, pos []string
	for _, l := range lines {
		grns = append(grns, l.GrnID)
		pos = append(pos, l.PoID)
	}
	rows, err = q.Query(ctx, `SELECT 'GRN:' || gi.grn_id::text, sum(`+receiptValue+`)
		FROM purchasing.grn_items gi
		JOIN purchasing.grn g ON g.id = gi.grn_id AND g.is_active = true
		JOIN purchasing.purchase_order_items poi ON poi.id = gi.purchase_order_item_id
		WHERE gi.is_active = true AND gi.grn_id = ANY($1::uuid[]) GROUP BY gi.grn_id
		UNION ALL
		SELECT 'PO:' || g.purchase_order_id::text, sum(`+receiptValue+`)
		FROM purchasing.grn_items gi
		JOIN purchasing.grn g ON g.id = gi.grn_id AND g.is_active = true
		JOIN purchasing.purchase_order_items poi ON poi.id = gi.purchase_order_item_id
		WHERE gi.is_active = true AND g.purchase_order_id = ANY($2::uuid[]) GROUP BY g.purchase_order_id`, grns, pos)
	if err != nil {
		return nil, nil, err
	}
	totals, err := collectAmounts(rows)
	return lines, totals, err
}

// DocumentNumbers is loadDocumentNumbers in lib/purchasing/cogs-additional-cost.ts.
func (inventoryReceipts) DocumentNumbers(ctx context.Context, q database.Querier, refs []production.DocRef) (map[string]string, error) {
	var pos, grns []string
	for _, r := range refs {
		if r.Type == "PO" {
			pos = append(pos, r.ID)
		} else {
			grns = append(grns, r.ID)
		}
	}
	rows, err := q.Query(ctx, `SELECT 'PO:' || id::text, nomor_po FROM purchasing.purchase_orders WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
		UNION ALL
		SELECT 'GRN:' || id::text, nomor_grn FROM purchasing.grn WHERE id = ANY($2::uuid[]) AND is_active = true`, pos, grns)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var key, number string
		if err := rows.Scan(&key, &number); err != nil {
			return nil, err
		}
		out[key] = number
	}
	return out, rows.Err()
}

func collectAmounts(rows pgx.Rows) (map[string]float64, error) {
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var key string
		var v float64
		if err := rows.Scan(&key, &v); err != nil {
			return nil, err
		}
		out[key] = v
	}
	return out, rows.Err()
}

/* ── POS merchandise output (production completion) ──────────────────── */

type inventoryPosOutput struct{ catalog inventoryPosCatalog }

var _ production.PosOutput = inventoryPosOutput{}

// MerchandiseSkus is resolveVariantContext in lib/purchasing/production-orders.ts.
func (inventoryPosOutput) MerchandiseSkus(ctx context.Context, q database.Querier, productID string) (string, []production.Sku, error) {
	var posID string
	err := q.QueryRow(ctx, `SELECT id::text FROM pos.pos_products WHERE source_product_id = $1 AND product_kind = 'merchandise' LIMIT 1`,
		productID).Scan(&posID)
	if database.IsNoRows(err) {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	rows, err := q.Query(ctx, `SELECT id::text, sku, name, options, stock_quantity::text FROM pos.pos_product_skus
		WHERE product_id = $1 AND is_active = true ORDER BY name ASC`, posID)
	if err != nil {
		return "", nil, err
	}
	defer rows.Close()
	var skus []production.Sku
	for rows.Next() {
		var s production.Sku
		if err := rows.Scan(&s.ID, &s.Sku, &s.Name, &s.Options, &s.StockQuantity); err != nil {
			return "", nil, err
		}
		skus = append(skus, s)
	}
	return posID, skus, rows.Err()
}

// AddSkuStock is postVariantStock's UPDATE … RETURNING stock_quantity.
func (inventoryPosOutput) AddSkuStock(ctx context.Context, q database.Querier, skuID, posProductID string, qty float64) (float64, bool, error) {
	var after float64
	err := q.QueryRow(ctx, `UPDATE pos.pos_product_skus SET stock_quantity = stock_quantity + $1, updated_at = now()
		WHERE id = $2 AND product_id = $3 RETURNING stock_quantity::float8`, kit.N(qty), skuID, posProductID).Scan(&after)
	if database.IsNoRows(err) {
		return 0, false, nil
	}
	return after, err == nil, err
}

// SkuLabels reads sku, name and options of SKUs.
func (inventoryPosOutput) SkuLabels(ctx context.Context, q database.Querier, skuIDs []string) (map[string]production.Sku, error) {
	rows, err := q.Query(ctx, `SELECT id::text, sku, name, options FROM pos.pos_product_skus WHERE id = ANY($1::uuid[])`, skuIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]production.Sku{}
	for rows.Next() {
		var s production.Sku
		if err := rows.Scan(&s.ID, &s.Sku, &s.Name, &s.Options); err != nil {
			return nil, err
		}
		out[s.ID] = s
	}
	return out, rows.Err()
}

// SyncHpp is syncProductionHppToPos.
func (a inventoryPosOutput) SyncHpp(ctx context.Context, q database.Querier, productID string, hppPerUnit float64) (*kit.Row, error) {
	return a.catalog.SyncProduct(ctx, q, productID, "", &hppPerUnit)
}
