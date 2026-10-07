package posops

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/scope"
)

// withXpAlias is withProductXpAlias: xp mirrors xp_points, station falls
// back to kitchen.
func withXpAlias(p *Obj) *Obj {
	if p == nil {
		return nil
	}
	out := p.Clone()
	xp := p.Get("xp_points")
	if xp == nil {
		xp = p.Get("xp")
	}
	if xp == nil {
		xp = 0.0
	}
	out.Set("xp", domain.Number(xp))
	if _, ok := p.Get("station").(string); !ok {
		out.Set("station", "kitchen")
	}
	return out
}

// ProductList is GET /api/pos/products' data and meta.
type ProductList struct {
	Products []*Obj
	Meta     *Obj
}

// ListProducts mirrors GET /api/pos/products: the catalog the caller may
// sell from their stall, cashier-visible channels only unless the
// product page asks for inactive ones too.
func (s *Service) ListProducts(ctx context.Context, c Caller, f productFilter) (*ProductList, error) {
	sc, err := scope.Load(ctx, s.db, c.UserID)
	if err != nil {
		return nil, err
	}
	if sc.Role != nil {
		c.Role = *sc.Role
	}
	ps, err := s.productStallScope(ctx, c, sc.BranchID)
	if err != nil {
		return nil, err
	}
	warehouseIDs := []string{}
	if ps.Mode == "ids" {
		warehouseIDs = ps.WarehouseIDs
	}
	if ps.Mode != "all" && len(ps.ProductIDs) == 0 {
		reason := "no_products_for_stall"
		if ps.Mode == "none" {
			reason = ps.Reason
			if reason == "" {
				reason = "no_stall_assignment"
			}
		}
		return &ProductList{Products: []*Obj{}, Meta: NewObj("stall_scoped", true, "warehouse_ids", warehouseIDs,
			"reason", reason, "active_mode", ps.ActiveMode)}, nil
	}
	if ps.Mode == "ids" {
		f.IDs = ps.ProductIDs
	}

	rows, err := listCatalogProducts(ctx, s.db, f)
	if err != nil {
		return nil, err
	}
	products := []*Obj{}
	for _, p := range rows {
		if f.IncludeInactive || domain.IsSoldIn(p.Get("sales_channels"), "pos") {
			products = append(products, withXpAlias(p))
		}
	}
	if err := s.embedChannels(ctx, products); err != nil {
		return nil, err
	}
	products = s.withPurchasingCogs(ctx, products)

	ids := make([]string, len(products))
	for i, p := range products {
		ids[i] = p.Str("id")
	}
	stalls, err := s.ports.Inventory.ProductStalls(ctx, s.db, ids)
	if err != nil {
		return nil, err
	}
	for _, p := range products {
		st := stalls[p.Str("id")]
		p.Set("warehouse_id", st.WarehouseID).Set("warehouse_name", st.Name).Set("stall_warehouse_id", st.WarehouseID).
			Set("stall_code", st.Code).Set("stall_name", st.Name)
	}
	return &ProductList{Products: products, Meta: NewObj(
		"stall_scoped", ps.Mode != "all",
		"all_stalls", ps.Mode == "all",
		"warehouse_ids", warehouseIDs,
		"product_count", len(products),
		"active_mode", ps.ActiveMode,
	)}, nil
}

func (s *Service) embedChannels(ctx context.Context, products []*Obj) error {
	if len(products) == 0 {
		return nil
	}
	ids := make([]string, len(products))
	for i, p := range products {
		ids[i] = p.Str("id")
	}
	channels, err := s.ports.Shop.ProductChannels(ctx, s.db, ids)
	if err != nil {
		return err
	}
	for _, p := range products {
		list := channels[p.Str("id")]
		if list == nil {
			list = []ProductChannel{}
		}
		p.Set("channels", list)
	}
	return nil
}

// withPurchasingCogs is enrichPosProductsWithPurchasingCogs: products
// synced from purchasing (SKU PUR-<kode>) take the estimated COGS as cost
// when it is positive. A failing lookup leaves the products unchanged.
func (s *Service) withPurchasingCogs(ctx context.Context, products []*Obj) []*Obj {
	kodeOf := func(p *Obj) string {
		sku := domain.String(p.Get("sku"))
		if p.Get("sku") == nil || !strings.HasPrefix(sku, "PUR-") {
			return ""
		}
		return domain.TrimJS(sku[4:])
	}
	var kodes []string
	for _, p := range products {
		if k := kodeOf(p); k != "" && !slices.Contains(kodes, k) {
			kodes = append(kodes, k)
		}
	}
	if len(kodes) == 0 {
		return products
	}
	cogs, err := s.ports.Inventory.CogsByKode(ctx, s.db, kodes)
	if err != nil {
		s.log.WarnContext(ctx, "POS products COGS enrichment warning", "error", err)
		return products
	}
	for _, p := range products {
		if !strings.HasPrefix(domain.String(p.Get("sku")), "PUR-") {
			continue
		}
		c, ok := cogs[kodeOf(p)]
		if !ok {
			continue
		}
		hppRaw := c.HppEstimasi
		if hppRaw == nil {
			hppRaw = c.EstimatedCogs
		}
		hpp := 0.0
		if hppRaw != nil {
			hpp = domain.ToNumber(*hppRaw)
		}
		cost := domain.ToNumber(p.Get("cost_price"))
		if hpp > 0 {
			cost = hpp
		}
		p.Set("cost_price", cost).Set("estimated_cogs", hpp).Set("hpp_estimasi", hpp)
	}
	return products
}

// arrayField is a body array; other values iterate as empty.
func arrayField(body any, key string) []any {
	list, _ := field(body, key).([]any)
	return list
}

// orDefaultParam is `value || def`.
func orDefaultParam(v any, def float64) any {
	if !domain.Truthy(v) {
		return def
	}
	return v
}

// CreateProduct mirrors POST /api/pos/products with its variants and
// modifier groups, written in one transaction.
func (s *Service) CreateProduct(ctx context.Context, body any) (*Obj, error) {
	sku, name, basePrice := field(body, "sku"), field(body, "name"), field(body, "base_price")
	if !domain.Truthy(sku) || !domain.Truthy(name) || !domain.Truthy(basePrice) {
		return nil, fail(http.StatusBadRequest, "SKU, name, and base_price are required")
	}
	cols, msg := domain.MerchandiseColumns(body)
	if msg != "" {
		return nil, fail(http.StatusBadRequest, msg)
	}
	xp := field(body, "xp_points")
	if domain.IsNullish(xp) {
		xp = defaultTo(field(body, "xp"), json.Number("0"))
	}
	isActive := defaultTo(field(body, "is_active"), true)
	cols.Set("sku", sku)
	cols.Set("name", name)
	cols.Set("description", field(body, "description"))
	cols.Set("category_id", field(body, "category_id"))
	cols.Set("base_price", basePrice)
	cols.Set("cost_price", orDefaultParam(field(body, "cost_price"), 0))
	cols.Set("xp_points", math.Max(0, orZeroNum(domain.Number(xp))))
	cols.Set("station", domain.NormalizeStation(field(body, "station")))
	cols.Set("is_active", isActive)
	cols.Set("min_xp", domain.MinXp(field(body, "min_xp")))

	var id string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		product, err := insertRow(ctx, tx, "pos.pos_products", cols, "*")
		if err != nil {
			return err
		}
		id = product.Str("id")
		var variants []domain.Columns
		for _, v := range arrayField(body, "variants") {
			variants = append(variants, domain.Columns{
				{Name: "product_id", Value: id},
				{Name: "name", Value: field(v, "name")},
				{Name: "group_name", Value: field(v, "group_name")},
				{Name: "price_adjustment", Value: orDefaultParam(field(v, "price_adjustment"), 0)},
				{Name: "display_order", Value: orDefaultParam(field(v, "display_order"), 0)},
			})
		}
		if _, err := insertRows(ctx, tx, "pos.pos_product_variants", variants, ""); err != nil {
			return err
		}
		for _, g := range arrayField(body, "modifierGroups") {
			group, err := insertRow(ctx, tx, "pos.pos_modifier_groups", domain.Columns{
				{Name: "name", Value: field(g, "name")},
				{Name: "min_selection", Value: orDefaultParam(field(g, "min_selection"), 0)},
				{Name: "max_selection", Value: orDefaultParam(field(g, "max_selection"), 1)},
				{Name: "display_order", Value: orDefaultParam(field(g, "display_order"), 0)},
			}, "*")
			if err != nil {
				return err
			}
			groupID := group.Str("id")
			if _, err := insertRow(ctx, tx, "pos.pos_product_modifiers", domain.Columns{
				{Name: "product_id", Value: id}, {Name: "modifier_group_id", Value: groupID},
			}, ""); err != nil {
				return err
			}
			var modifiers []domain.Columns
			for _, m := range arrayField(g, "modifiers") {
				modifiers = append(modifiers, domain.Columns{
					{Name: "group_id", Value: groupID},
					{Name: "name", Value: field(m, "name")},
					{Name: "price_adjustment", Value: orDefaultParam(field(m, "price_adjustment"), 0)},
					{Name: "display_order", Value: orDefaultParam(field(m, "display_order"), 0)},
				})
			}
			if _, err := insertRows(ctx, tx, "pos.pos_modifiers", modifiers, ""); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	complete, err := productWithOptions(ctx, s.db, id)
	if err != nil {
		return nil, nil // the TS ignores this read's error and answers data: null
	}
	return withXpAlias(complete), nil
}

func orZeroNum(f float64) float64 {
	if math.IsNaN(f) {
		return 0
	}
	return f
}

// UpdateProduct mirrors PATCH /api/pos/products/{id}: only the fields sent
// change; web distribution goes to the shop channel table in the same
// transaction.
func (s *Service) UpdateProduct(ctx context.Context, id string, body any) (*Obj, error) {
	sent := func(key string) bool { return !domain.IsUndef(field(body, key)) }
	hasXp := sent("xp_points") || sent("xp")
	rawSales := field(body, "sales_channels")
	if sent("sales_channels") && !domain.ValidSalesChannelList(rawSales) {
		return nil, fail(http.StatusBadRequest, "Channel penjualan tidak valid")
	}
	cols := domain.Columns{{Name: "updated_at", Value: s.now()}}
	if hasXp {
		xp := field(body, "xp_points")
		if domain.IsNullish(xp) {
			xp = field(body, "xp")
		}
		if domain.IsNullish(xp) {
			xp = 0.0
		}
		cols.Set("xp_points", math.Max(0, orZeroNum(domain.Number(xp))))
	}
	if sent("station") {
		cols.Set("station", domain.NormalizeStation(field(body, "station")))
	}
	if sent("is_active") {
		cols.Set("is_active", domain.Truthy(field(body, "is_active")))
	}
	if sent("is_available") {
		cols.Set("is_available", domain.Truthy(field(body, "is_available")))
	}
	if sent("sales_channels") {
		cols.Set("sales_channels", domain.NormalizeSalesChannels(rawSales))
	}
	if sent("bonus_xp") {
		bonus := math.Floor(domain.Number(field(body, "bonus_xp")))
		if !domain.Finite(bonus) || bonus < 0 || bonus > 100_000 {
			return nil, fail(http.StatusBadRequest, "Bonus XP harus 0–100.000")
		}
		cols.Set("bonus_xp", bonus)
	}
	if sent("min_xp") {
		cols.Set("min_xp", domain.MinXpUpdate(field(body, "min_xp")))
	}
	merch, msg := domain.MerchandiseColumns(body)
	if msg != "" {
		return nil, fail(http.StatusBadRequest, msg)
	}
	for _, c := range merch {
		cols.Set(c.Name, c.Value)
	}
	if !hasXp && !sent("station") && !sent("is_active") && !sent("is_available") && !sent("min_xp") &&
		!sent("bonus_xp") && len(merch) == 0 && !sent("web_distributed") && !sent("sales_channels") {
		return nil, fail(http.StatusBadRequest, "No product fields to update")
	}

	var updated *Obj
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if sent("web_distributed") {
			if err := s.ports.Shop.SetWebDistribution(ctx, tx, id, domain.Truthy(field(body, "web_distributed"))); err != nil {
				return &jsError{msg: pgMessage(err)} // a node-postgres Error: its message reaches the client
			}
		}
		rows, err := updateRows(ctx, tx, "pos.pos_products", cols, domain.Columns{{Name: "id", Value: id}}, "*")
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return plainError("No rows found")
		}
		updated = rows[0]
		return nil
	})
	if err != nil {
		return nil, err
	}
	return withXpAlias(updated), nil
}

/* ── SKUs ────────────────────────────────────────────────────────────── */

const (
	skuConflict          = "Kode SKU / barcode sudah dipakai varian lain"
	skuMerchandiseOnly   = "Varian SKU hanya untuk produk merchandise"
	productMissingSkuMsg = "Produk tidak ditemukan"
)

// isUniqueViolation mirrors the routes' isUniqueViolation.
func isUniqueViolation(err error) bool {
	return database.IsUniqueViolation(err) || domain.UniqueViolationMessage.MatchString(pgMessage(err))
}

// merchandiseProduct loads the product and enforces the SKU invariant.
func (s *Service) merchandiseProduct(ctx context.Context, q database.Querier, id string) (*Obj, error) {
	product, err := productKindOf(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if product == nil {
		return nil, fail(http.StatusNotFound, productMissingSkuMsg)
	}
	if product.Str("product_kind") != "merchandise" {
		return nil, fail(http.StatusBadRequest, skuMerchandiseOnly)
	}
	return product, nil
}

// ListSkus mirrors GET /api/pos/products/{id}/skus.
func (s *Service) ListSkus(ctx context.Context, productID string) ([]*Obj, error) {
	return listProductSkus(ctx, s.db, productID)
}

// CreateSku mirrors POST /api/pos/products/{id}/skus.
func (s *Service) CreateSku(ctx context.Context, productID string, body any) (*Obj, error) {
	cols, msg := domain.SkuColumns(body, true)
	if msg != "" {
		return nil, fail(http.StatusBadRequest, msg)
	}
	if _, err := s.merchandiseProduct(ctx, s.db, productID); err != nil {
		return nil, err
	}
	cols.Set("product_id", productID)
	row, err := insertRow(ctx, s.db, "pos.pos_product_skus", cols, "*")
	if err != nil && isUniqueViolation(err) {
		return nil, fail(http.StatusConflict, skuConflict)
	}
	return row, err
}

// UpdateSku mirrors PATCH /api/pos/products/{id}/skus/{skuId}.
func (s *Service) UpdateSku(ctx context.Context, productID, skuID string, body any) (*Obj, error) {
	cols, msg := domain.SkuColumns(body, false)
	if msg != "" {
		return nil, fail(http.StatusBadRequest, msg)
	}
	if len(cols) == 0 {
		return nil, fail(http.StatusBadRequest, "Tidak ada field yang diubah")
	}
	cols.Set("updated_at", s.now())
	rows, err := updateRows(ctx, s.db, "pos.pos_product_skus", cols,
		domain.Columns{{Name: "id", Value: skuID}, {Name: "product_id", Value: productID}}, "*")
	if err != nil && isUniqueViolation(err) {
		return nil, fail(http.StatusConflict, skuConflict)
	}
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, plainError("No rows found")
	}
	return rows[0], nil
}

// DeleteSku mirrors DELETE /api/pos/products/{id}/skus/{skuId}; order
// history keeps its line (sku_id is set null).
func (s *Service) DeleteSku(ctx context.Context, productID, skuID string) error {
	return deleteProductSku(ctx, s.db, productID, skuID)
}

// skuMatrixResult is the matrix route's outcome.
type skuMatrixResult struct {
	Blocked []*Obj
	Data    *Obj
}

// GenerateSkuMatrix mirrors POST /api/pos/products/{id}/skus/matrix:
// validate (404, 400s) before any write, then in one transaction with the
// product's SKU rows locked, reactivate, create and deactivate. A SKU that
// still holds stock is never deactivated (409, nothing written).
func (s *Service) GenerateSkuMatrix(ctx context.Context, productID string, body any) (*skuMatrixResult, error) {
	product, err := s.merchandiseProduct(ctx, s.db, productID)
	if err != nil {
		return nil, err
	}
	if body == nil { // a JSON null body: body.axes throws
		return nil, &jsError{msg: "Cannot read properties of null (reading 'axes')"}
	}
	axes := field(body, "axes")
	if msg := domain.ValidateMatrixSize(axes); msg != "" {
		return nil, fail(http.StatusBadRequest, msg)
	}
	wanted := domain.ExpandMatrix(axes)
	if len(wanted) == 0 {
		return nil, fail(http.StatusBadRequest, "Sumbu varian (axes) wajib diisi, minimal satu sumbu dengan nilai")
	}
	var price *float64
	if raw := field(body, "price_override"); !domain.IsUndef(raw) {
		cols, msg := domain.SkuColumns(map[string]any{"price_override": raw}, false)
		if msg != "" {
			return nil, fail(http.StatusBadRequest, msg)
		}
		if v, _ := cols.Get("price_override"); v != nil {
			p := v.(float64)
			price = &p
		}
	}
	prefix := ""
	if p, ok := field(body, "barcode_prefix").(string); ok {
		prefix = domain.TrimJS(p)
	}
	if domain.Len16(prefix) > 20 {
		return nil, fail(http.StatusBadRequest, "Prefix barcode maksimal 20 karakter")
	}
	baseSku, productName := domain.String(product.Get("sku")), domain.String(product.Get("name"))
	if prefix != "" {
		codes := make([]string, len(wanted))
		for i, o := range wanted {
			codes[i] = domain.BuildSkuCode(baseSku, o)
		}
		if domain.ComposedBarcodeTooLong(prefix, codes) {
			return nil, fail(http.StatusBadRequest, "Barcode gabungan melebihi 64 karakter; perpendek prefix")
		}
	}

	var out *skuMatrixResult
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		rows, err := lockProductSkus(ctx, tx, productID)
		if err != nil {
			return err
		}
		existing := make([]domain.ExistingSku, len(rows))
		byID := map[string]*Obj{}
		for i, row := range rows {
			var opts any
			if raw, ok := row.Get("options").(json.RawMessage); ok {
				_ = json.Unmarshal(raw, &opts)
			}
			if opts == nil {
				row.Set("options", json.RawMessage("{}"))
			}
			row.Set("stock_quantity", domain.Number(row.Get("stock_quantity")))
			existing[i] = domain.ExistingSku{
				ID: row.Str("id"), Options: domain.OptionsFromAny(opts),
				StockQuantity: row.Get("stock_quantity").(float64), IsActive: row.Get("is_active") != false,
			}
			byID[existing[i].ID] = row
		}
		diff := domain.DiffMatrix(existing, wanted)
		deactivateIDs := skuIDs(diff.Deactivate)
		if blocked := domain.BlockedDeactivations(existing, deactivateIDs); len(blocked) > 0 {
			out = &skuMatrixResult{}
			for _, b := range blocked {
				row := byID[b.ID]
				out.Blocked = append(out.Blocked, NewObj("id", b.ID, "sku", row.Get("sku"), "name", row.Get("name"),
					"stock_quantity", b.StockQuantity))
			}
			return nil
		}
		reactivated := []*Obj{}
		if ids := skuIDs(diff.Reactivate); len(ids) > 0 {
			if reactivated, err = reactivateSkus(ctx, tx, productID, ids); err != nil {
				return err
			}
		}
		created := []*Obj{}
		for _, o := range diff.Create {
			sku := domain.BuildSkuCode(baseSku, o)
			name := domain.BuildSkuName(productName, o)
			var barcode *string
			if prefix != "" {
				b := prefix + sku
				barcode = &b
			}
			check := map[string]any{"sku": sku, "name": name}
			if barcode != nil {
				check["barcode"] = *barcode
			}
			if _, msg := domain.SkuColumns(check, true); msg != "" {
				return fail(http.StatusBadRequest, msg)
			}
			row, err := insertMatrixSku(ctx, tx, productID, sku, name, optionsJSON(o), barcode, price)
			if err != nil {
				return err
			}
			created = append(created, row)
		}
		deactivated := []*Obj{}
		if len(deactivateIDs) > 0 {
			if deactivated, err = deactivateSkus(ctx, tx, productID, deactivateIDs); err != nil {
				return err
			}
		}
		all, err := productSkusByName(ctx, tx, productID)
		if err != nil {
			return err
		}
		kept := make([]*Obj, len(diff.Keep))
		for i, k := range diff.Keep {
			kept[i] = byID[k.ID]
		}
		out = &skuMatrixResult{Data: NewObj("created", created, "reactivated", reactivated, "deactivated", deactivated,
			"kept", kept, "skus", all)}
		return nil
	})
	if err != nil && isUniqueViolation(err) {
		return nil, fail(http.StatusConflict, skuConflict)
	}
	return out, err
}

func skuIDs(rows []domain.ExistingSku) []string {
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	return ids
}

// optionsJSON is JSON.stringify(options) in key order.
func optionsJSON(o domain.Options) string {
	obj := NewObj()
	for _, k := range o.Keys() {
		obj.Set(k, o.Get(k))
	}
	b, _ := obj.MarshalJSON()
	return string(b)
}

/* ── Purchasing sync ─────────────────────────────────────────────────── */

// SyncPurchasing mirrors POST /api/pos/products/sync-purchasing: each
// purchasing product becomes (or refreshes) a POS product with SKU
// PUR-<kode>. One id answers one result, several answer a list.
func (s *Service) SyncPurchasing(ctx context.Context, body any) (any, error) {
	var ids []any
	if list, ok := field(body, "purchasing_product_ids").([]any); ok {
		ids = list
	} else if one := field(body, "purchasing_product_id"); domain.Truthy(one) {
		ids = []any{one}
	}
	if len(ids) == 0 {
		return nil, fail(http.StatusBadRequest, "purchasing_product_id is required")
	}
	station := field(body, "station")
	results := make([]*Obj, 0, len(ids))
	for _, id := range ids {
		r, err := s.syncPurchasingProduct(ctx, domain.String(id), station)
		if err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	if len(results) == 1 {
		return results[0], nil
	}
	return results, nil
}

func (s *Service) syncPurchasingProduct(ctx context.Context, id string, station any) (*Obj, error) {
	p, err := s.ports.Inventory.PurchasingProduct(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, plainError("No rows found")
	}
	kode := ""
	if p.Kode != nil {
		kode = *p.Kode
	}
	sku := "PUR-" + kode
	if kode == "" {
		sku = "PUR-" + first8(p.ID)
	}
	kategori := ""
	if p.Kategori != nil {
		kategori = *p.Kategori
	}
	categoryID, err := posCategoryID(ctx, s.db, domain.PosCategoryName(kategori))
	if err != nil {
		return nil, err
	}
	basePrice := numOrZero(p.HargaJual)
	costRaw := p.HppEstimasi
	if costRaw == nil {
		costRaw = p.EstimatedCogs
	}
	costPrice := numOrZero(costRaw)
	name := sku
	if p.Nama != nil && *p.Nama != "" {
		name = *p.Nama
	}
	description := "Synced from Purchasing product " + firstNonEmpty(kode, p.ID)
	if p.Deskripsi != nil && *p.Deskripsi != "" {
		description = *p.Deskripsi
	}
	explicit := ""
	if domain.Truthy(station) {
		explicit = domain.String(station)
	}
	now := s.now()
	cols := domain.Columns{
		{Name: "sku", Value: sku}, {Name: "name", Value: name}, {Name: "description", Value: description},
		{Name: "category_id", Value: derefOrNil(categoryID)}, {Name: "base_price", Value: basePrice},
		{Name: "cost_price", Value: costPrice}, {Name: "is_active", Value: p.IsActive == nil || *p.IsActive},
		{Name: "is_available", Value: true}, {Name: "inventory_tracking", Value: false},
		{Name: "station", Value: domain.ResolvePosStation(explicit, kategori)}, {Name: "updated_at", Value: now},
	}
	existingID, err := productIDBySku(ctx, s.db, sku)
	if err != nil {
		return nil, err
	}
	mode := "created"
	var product *Obj
	if existingID != nil {
		mode = "updated"
		rows, err := updateRows(ctx, s.db, "pos.pos_products", cols, domain.Columns{{Name: "id", Value: *existingID}}, "*")
		if err != nil {
			return nil, err
		}
		if len(rows) == 0 {
			return nil, plainError("No rows found")
		}
		product = rows[0]
	} else {
		cols.Set("created_at", now)
		if product, err = insertRow(ctx, s.db, "pos.pos_products", cols, "*"); err != nil {
			return nil, err
		}
	}
	base := domain.ToNumber(product.Get("base_price"))
	return NewObj("mode", mode, "product", product, "cost_price", costPrice, "base_price", base,
		"gross_profit", base-costPrice, "margin_percentage", domain.MarginPercentage(base, costPrice)), nil
}

func derefOrNil(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func first8(s string) string {
	if len(s) > 8 {
		return s[:8]
	}
	return s
}
