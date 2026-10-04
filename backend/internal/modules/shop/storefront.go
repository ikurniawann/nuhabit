package shop

import (
	"context"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/jsmath"
)

// The public storefront (lib/shop/storefront-server.ts): catalog, checkout
// (claim stock first, reserve it with a TTL, then a Xendit invoice), and
// committing or releasing the reservations. Expired reservations are
// released opportunistically through shop.release_expired_reservations().

// InvoicePrefix is SHOP_INVOICE_PREFIX: the Xendit external_id prefix of
// shop orders.
const InvoicePrefix = "shop-order-"

const defaultItemWeightGram = 1000

// Storefront is a shop.storefronts row.
type Storefront struct {
	ID          string
	Slug        string
	Name        string
	Description *string
}

// ResolveStorefront is resolveStorefront: an active storefront by slug
// (case-insensitive), nil when none.
func (s *Service) ResolveStorefront(ctx context.Context, slug string) (*Storefront, error) {
	var sf Storefront
	err := s.db.QueryRow(ctx, `SELECT id::text, slug, name, description
		FROM shop.storefronts
		WHERE lower(slug) = lower($1) AND is_active = true`, slug).Scan(&sf.ID, &sf.Slug, &sf.Name, &sf.Description)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &sf, err
}

// CatalogSKUView is CatalogSku.
type CatalogSKUView struct {
	ID    string  `json:"id"`
	SKU   string  `json:"sku"`
	Name  string  `json:"name"`
	Price float64 `json:"price"`
	Stock float64 `json:"stock"`
}

// CatalogProductView is CatalogProduct.
type CatalogProductView struct {
	ID              string           `json:"id"`
	Name            string           `json:"name"`
	Description     *string          `json:"description"`
	LongDescription *string          `json:"longDescription"`
	ImageURL        *string          `json:"imageUrl"`
	Images          []string         `json:"images"`
	Price           float64          `json:"price"`
	WeightGram      *float64         `json:"weightGram"`
	Stock           float64          `json:"stock"`
	SKUs            []CatalogSKUView `json:"skus"`
}

// numOr0 is `Number(x) || 0` on a nullable numeric string.
func numOr0(s *string) float64 {
	if s == nil {
		return 0
	}
	return domain.OrFinite(domain.JSNumber(*s))
}

// basePrice is Number(channel_price ?? base_price) || 0.
func basePrice(p WebProduct) float64 {
	if p.ChannelPrice != nil {
		return numOr0(p.ChannelPrice)
	}
	return numOr0(&p.BasePrice)
}

// BuildCatalog is buildShopCatalog.
func (s *Service) BuildCatalog(ctx context.Context) ([]CatalogProductView, error) {
	products, err := s.ports.Catalog.WebProducts(ctx, s.db)
	if err != nil || len(products) == 0 {
		return []CatalogProductView{}, err
	}
	ids := make([]string, len(products))
	for i, p := range products {
		ids[i] = p.ID
	}
	skus, err := s.ports.Catalog.ActiveSKUs(ctx, s.db, ids)
	if err != nil {
		return nil, err
	}
	images, err := s.ports.Catalog.Images(ctx, s.db, ids)
	if err != nil {
		return nil, err
	}
	skusByProduct := map[string][]CatalogSKU{}
	for _, sku := range skus {
		skusByProduct[sku.ProductID] = append(skusByProduct[sku.ProductID], sku)
	}
	imagesByProduct := map[string][]string{}
	for _, img := range images {
		imagesByProduct[img.ProductID] = append(imagesByProduct[img.ProductID], img.URL)
	}
	out := make([]CatalogProductView, 0, len(products))
	for _, p := range products {
		price := basePrice(p)
		views := []CatalogSKUView{}
		stock := 0.0
		for _, sku := range skusByProduct[p.ID] {
			skuPrice := price
			if sku.PriceOverride != nil {
				if n := domain.JSNumber(*sku.PriceOverride); !math.IsNaN(n) && !math.IsInf(n, 0) {
					skuPrice = n
				}
			}
			v := CatalogSKUView{ID: sku.ID, SKU: sku.SKU, Name: sku.Name, Price: skuPrice, Stock: numOr0(&sku.StockQuantity)}
			views = append(views, v)
			stock += v.Stock
		}
		if len(views) == 0 {
			stock = numOr0(p.InventoryQuantity)
		}
		var weight *float64
		if p.WeightGram != nil {
			w := domain.JSNumber(*p.WeightGram)
			weight = &w
		}
		imgs := imagesByProduct[p.ID]
		if imgs == nil {
			imgs = []string{}
		}
		out = append(out, CatalogProductView{
			ID: p.ID, Name: p.Name, Description: p.Description, LongDescription: p.LongDescription,
			ImageURL: p.ImageURL, Images: imgs, Price: price, WeightGram: weight, Stock: stock, SKUs: views,
		})
	}
	return out, nil
}

// unitWeight is the product weight, 1000 g when unset or zero.
func unitWeight(weight *string) float64 {
	if w := numOr0(weight); w != 0 {
		return w
	}
	return defaultItemWeightGram
}

// CartItem is a checkout or rates cart line.
type CartItem struct {
	ProductID string
	SkuID     *string
	Quantity  float64
}

// CartWeightAndValue is computeCartWeightAndValue: weight and value from the
// server catalog, so a client cannot shrink the shipping cost. Unknown
// products are skipped.
func (s *Service) CartWeightAndValue(ctx context.Context, items []CartItem) (weightGram, itemValue float64, err error) {
	for _, it := range items {
		weight, price, found, err := s.ports.Catalog.Cargo(ctx, s.db, it.ProductID)
		if err != nil {
			return 0, 0, err
		}
		if !found {
			continue
		}
		weightGram += float64(unitWeight(weight) * it.Quantity)
		itemValue += float64(numOr0(&price) * it.Quantity)
	}
	return weightGram, itemValue, nil
}

// ── Checkout ────────────────────────────────────────────────────────────

// CheckoutInput is CheckoutInput.
type CheckoutInput struct {
	Storefront Storefront
	Items      []CartItem
	Customer   struct {
		Name, Phone string
		Email       *string
	}
	Destination struct {
		AreaID, Label, Address string
		PostalCode             *string
	}
	Courier struct {
		Code, ServiceCode, Provider string
		Cost                        float64
	}
	Notes *string
	// BaseURL is the absolute origin for the Xendit redirect.
	BaseURL string
}

// CheckoutResult is the ok branch of CheckoutResult.
type CheckoutResult struct {
	OrderID, OrderNumber, AccessToken, InvoiceURL string
}

// checkoutError is the `{ ok: false, status, reason }` branch.
type checkoutError struct {
	status int
	reason string
}

func (e *checkoutError) Error() string { return e.reason }

type resolvedLine struct {
	productID   string
	skuID       *string
	productName string
	skuName     *string
	skuCode     *string
	quantity    float64
	unitPrice   float64
	weightGram  float64
}

type claim struct {
	productID string
	skuID     *string
	qty       float64
}

// claimLine is claimLine: a skipped (untracked) product counts as success.
func (s *Service) claimLine(ctx context.Context, c claim) (bool, string, error) {
	success, reason, err := s.ports.Stock.Sell(ctx, s.db, c.productID, c.skuID, c.qty)
	if err != nil {
		return false, "", err
	}
	return success == nil || *success, reason, nil
}

// restoreClaims gives claimed stock back; failures are only logged.
func (s *Service) restoreClaims(ctx context.Context, claims []claim) {
	for _, c := range claims {
		// One savepoint per claim: a failure is skipped like the TS catch and
		// never aborts a caller's transaction.
		err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
			_, _, err := s.ports.Stock.Sell(ctx, tx, c.productID, c.skuID, -c.qty)
			return err
		})
		if err != nil {
			s.log.Error("[shop] checkout restore claim failed", "error", err)
		}
	}
}

// resolveLines is resolveLines: the cart re-priced from the catalog (the
// client's prices are never trusted).
func (s *Service) resolveLines(ctx context.Context, items []CartItem) ([]resolvedLine, string, error) {
	if len(items) == 0 {
		return nil, "Keranjang kosong", nil
	}
	if len(items) > 50 {
		return nil, "Terlalu banyak baris keranjang", nil
	}
	var lines []resolvedLine
	for _, it := range items {
		qty := math.Floor(it.Quantity)
		if qty <= 0 || qty > 999 {
			return nil, "Jumlah item tidak valid", nil
		}
		p, err := s.ports.Catalog.WebProduct(ctx, s.db, it.ProductID)
		if err != nil {
			return nil, "", err
		}
		if p == nil {
			return nil, "Ada produk yang sudah tidak tersedia — muat ulang katalog", nil
		}
		price := basePrice(*p)
		weight := unitWeight(p.WeightGram)
		if it.SkuID != nil && *it.SkuID != "" {
			sku, err := s.ports.Catalog.ActiveSKU(ctx, s.db, *it.SkuID, it.ProductID)
			if err != nil {
				return nil, "", err
			}
			if sku == nil {
				return nil, "Ada varian yang sudah tidak tersedia — muat ulang katalog", nil
			}
			unit := price
			if sku.PriceOverride != nil {
				if n := numOr0(sku.PriceOverride); n != 0 {
					unit = n
				}
			}
			lines = append(lines, resolvedLine{productID: p.ID, skuID: &sku.ID, productName: p.Name, skuName: &sku.Name,
				skuCode: &sku.SKU, quantity: qty, unitPrice: unit, weightGram: weight})
			continue
		}
		if p.HasActiveSKU {
			return nil, p.Name + " punya varian — pilih varian dulu", nil
		}
		lines = append(lines, resolvedLine{productID: p.ID, productName: p.Name, quantity: qty, unitPrice: price, weightGram: weight})
	}
	return lines, "", nil
}

// Checkout is processShopCheckout. A *checkoutError carries the TS status
// and reason.
func (s *Service) Checkout(ctx context.Context, in CheckoutInput) (CheckoutResult, error) {
	if !s.ports.Payments.Configured() {
		return CheckoutResult{}, &checkoutError{503, "Pembayaran online belum dikonfigurasi"}
	}
	lines, reason, err := s.resolveLines(ctx, in.Items)
	if err != nil {
		return CheckoutResult{}, err
	}
	if reason != "" {
		return CheckoutResult{}, &checkoutError{400, reason}
	}
	subtotal := 0.0
	for _, l := range lines {
		subtotal += float64(l.unitPrice * l.quantity)
	}
	shippingCost := math.Max(0, jsmath.Round(domain.OrFinite(in.Courier.Cost)))
	total := subtotal + shippingCost
	if total <= 0 {
		return CheckoutResult{}, &checkoutError{400, "Total order tidak valid"}
	}

	// Claim stock BEFORE the order exists (the cashier pattern); a failure
	// part-way gives the earlier claims back.
	var claims []claim
	for _, l := range lines {
		c := claim{productID: l.productID, skuID: l.skuID, qty: l.quantity}
		ok, why, err := s.claimLine(ctx, c)
		if err != nil {
			s.restoreClaims(ctx, claims)
			return CheckoutResult{}, err
		}
		if !ok {
			s.restoreClaims(ctx, claims)
			if why == "variant_required" {
				return CheckoutResult{}, &checkoutError{400, l.productName + " punya varian — pilih varian dulu"}
			}
			label := l.productName
			if l.skuName != nil {
				label += " (" + *l.skuName + ")"
			}
			return CheckoutResult{}, &checkoutError{400, "Stok " + label + " tidak cukup"}
		}
		claims = append(claims, c)
	}

	expiresAt := s.now().Add(InvoiceExpiryHours * time.Hour)
	var res CheckoutResult
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO shop.orders (
			  storefront_id, customer_name, customer_phone, customer_email,
			  shipping_address, shipping_area_id, shipping_area_label,
			  shipping_postal_code, shipping_provider, courier_code,
			  courier_service, subtotal, shipping_cost, total,
			  invoice_expires_at, notes
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
			RETURNING id::text, order_number, access_token::text`,
			in.Storefront.ID, in.Customer.Name, in.Customer.Phone, orNil(in.Customer.Email),
			in.Destination.Address, in.Destination.AreaID, in.Destination.Label,
			orNil(in.Destination.PostalCode), in.Courier.Provider, in.Courier.Code,
			in.Courier.ServiceCode, subtotal, shippingCost, total, expiresAt, orNil(in.Notes),
		).Scan(&res.OrderID, &res.OrderNumber, &res.AccessToken); err != nil {
			return err
		}
		for _, l := range lines {
			if _, err := tx.Exec(ctx, `INSERT INTO shop.order_items (
				  order_id, product_id, sku_id, product_name, sku_name, sku_code,
				  quantity, unit_price, total, weight_gram
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
				res.OrderID, l.productID, l.skuID, l.productName, l.skuName, l.skuCode,
				l.quantity, l.unitPrice, float64(l.unitPrice*l.quantity), l.weightGram); err != nil {
				return err
			}
		}
		for _, c := range claims {
			if _, err := tx.Exec(ctx, `INSERT INTO shop.stock_reservations (order_id, product_id, sku_id, qty, expires_at)
				VALUES ($1,$2,$3,$4,$5)`, res.OrderID, c.productID, c.skuID, c.qty, expiresAt); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		s.log.Error("[shop] checkout order insert failed", "error", err)
		s.restoreClaims(ctx, claims)
		return CheckoutResult{}, &checkoutError{500, "Gagal membuat order — coba lagi"}
	}

	invoice, err := s.ports.Payments.CreateInvoice(ctx, InvoiceRequest{
		ExternalID:  InvoicePrefix + res.OrderID,
		Amount:      total,
		PayerName:   in.Customer.Name,
		Description: "Order " + res.OrderNumber + " — " + in.Storefront.Name,
		RedirectURL: in.BaseURL + "/shop/order/" + res.AccessToken,
	})
	if err == nil {
		_, err = s.db.Exec(ctx, `UPDATE shop.orders
			SET xendit_invoice_id = $2, xendit_invoice_url = $3, updated_at = now()
			WHERE id = $1::uuid`, res.OrderID, invoice.ID, invoice.URL)
	}
	if err != nil {
		s.log.Error("[shop] xendit invoice failed", "order", res.OrderID, "error", err)
		// Full compensation: stock back, reservations released, order cancelled.
		s.restoreClaims(ctx, claims)
		if _, err := s.db.Exec(ctx, `UPDATE shop.stock_reservations SET status='released', updated_at=now()
			WHERE order_id = $1::uuid AND status='held'`, res.OrderID); err != nil {
			s.log.Error("[shop] release reservations failed", "order", res.OrderID, "error", err)
		}
		if _, err := s.db.Exec(ctx, `UPDATE shop.orders SET status='cancelled', updated_at=now() WHERE id = $1::uuid`, res.OrderID); err != nil {
			s.log.Error("[shop] cancel order failed", "order", res.OrderID, "error", err)
		}
		return CheckoutResult{}, &checkoutError{502, "Gagal membuat invoice pembayaran — coba lagi"}
	}
	res.InvoiceURL = invoice.URL
	return res, nil
}

// orNil is `value || null`.
func orNil(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}

// commitOrderReservations is commitOrderReservations: on PAID the held
// stock becomes the order's for good.
func commitOrderReservations(ctx context.Context, q database.Querier, orderID string) error {
	_, err := q.Exec(ctx, `UPDATE shop.stock_reservations SET status='committed', updated_at=now()
		WHERE order_id = $1::uuid AND status='held'`, orderID)
	return err
}

// releaseOrderReservations is releaseOrderReservations: held stock goes back
// (invoice expired, pending order cancelled).
func (s *Service) releaseOrderReservations(ctx context.Context, orderID string) error {
	return s.releaseReservations(ctx, orderID, `status='held'`)
}

// restoreCommittedReservations is restoreCommittedReservations: a paid order
// is cancelled (refunded by hand), so committed stock goes back too.
func (s *Service) restoreCommittedReservations(ctx context.Context, orderID string) error {
	return s.releaseReservations(ctx, orderID, `status IN ('held','committed')`)
}

func (s *Service) releaseReservations(ctx context.Context, orderID, statusCond string) error {
	rows, err := s.db.Query(ctx, `UPDATE shop.stock_reservations SET status='released', updated_at=now()
		WHERE order_id = $1::uuid AND `+statusCond+`
		RETURNING product_id::text, sku_id::text, qty::text`, orderID)
	if err != nil {
		return err
	}
	var claims []claim
	for rows.Next() {
		var c claim
		var qty string
		if err := rows.Scan(&c.productID, &c.skuID, &qty); err != nil {
			rows.Close()
			return err
		}
		c.qty = domain.OrFinite(domain.JSNumber(qty))
		claims = append(claims, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	s.restoreClaims(ctx, claims)
	return nil
}
