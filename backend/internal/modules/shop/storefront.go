package shop

import (
	"context"
	"errors"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	possales "nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/outbox"
)

// The public storefront (lib/shop/storefront-server.ts): catalog, checkout
// (claim stock first, reserve it with a TTL, then a Xendit invoice), and
// committing or releasing the reservations. Expired reservations are
// released opportunistically through shop.release_expired_reservations().
// The wholesale portal places its orders through the same steps.

// InvoicePrefix is SHOP_INVOICE_PREFIX: the Xendit external_id prefix of
// shop orders.
const InvoicePrefix = "shop-order-"

const defaultItemWeightGram = 1000

// DefaultStorefrontSlug asks ResolveStorefront for the default storefront
// (/apparel).
const DefaultStorefrontSlug = "default"

// Storefront is a shop.storefronts row. VenueIDs nil = every venue.
type Storefront struct {
	ID          string
	Slug        string
	Name        string
	Description *string
	VenueIDs    []string
}

const storefrontColumns = `id::text, slug, name, description, venue_ids::text[]`

func scanStorefront(row pgx.Row) (*Storefront, error) {
	var sf Storefront
	err := row.Scan(&sf.ID, &sf.Slug, &sf.Name, &sf.Description, &sf.VenueIDs)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &sf, err
}

// ResolveStorefront is resolveStorefront: an active storefront by slug
// (case-insensitive), nil when none. DefaultStorefrontSlug resolves the
// is_default storefront, else the oldest active one.
func (s *Service) ResolveStorefront(ctx context.Context, slug string) (*Storefront, error) {
	if slug == DefaultStorefrontSlug {
		return scanStorefront(s.db.QueryRow(ctx, `SELECT `+storefrontColumns+` FROM shop.storefronts
			WHERE is_active = true ORDER BY is_default DESC, created_at, id LIMIT 1`))
	}
	return scanStorefront(s.db.QueryRow(ctx, `SELECT `+storefrontColumns+` FROM shop.storefronts
		WHERE lower(slug) = lower($1) AND is_active = true`, slug))
}

// ProductSettings is a shop.product_settings row; the zero value is a
// product without one.
type ProductSettings struct {
	PreorderUntil     *time.Time
	WholesalePriceIDR *float64
	WholesaleMinQty   float64
}

// productSettings reads the settings of the products (missing rows give
// the zero value with a minimum quantity of 1).
func (s *Service) productSettings(ctx context.Context, ids []string) (map[string]ProductSettings, error) {
	out := map[string]ProductSettings{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(ctx, `SELECT product_id::text, preorder_until, wholesale_price_idr::float8, wholesale_min_qty
		FROM shop.product_settings WHERE product_id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var ps ProductSettings
		var minQty int
		if err := rows.Scan(&id, &ps.PreorderUntil, &ps.WholesalePriceIDR, &minQty); err != nil {
			return nil, err
		}
		ps.WholesaleMinQty = float64(minQty)
		out[id] = ps
	}
	return out, rows.Err()
}

func settingsOf(all map[string]ProductSettings, id string) ProductSettings {
	if ps, ok := all[id]; ok {
		return ps
	}
	return ProductSettings{WholesaleMinQty: 1}
}

// CatalogSKUView is CatalogSku.
type CatalogSKUView struct {
	ID       string  `json:"id"`
	SKU      string  `json:"sku"`
	Name     string  `json:"name"`
	Price    float64 `json:"price"`
	Stock    float64 `json:"stock"`
	Preorder bool    `json:"preorder"`
}

// CatalogCollection is a storefront collection (a POS category).
type CatalogCollection struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	order int
}

// CatalogProductView is CatalogProduct.
type CatalogProductView struct {
	ID              string             `json:"id"`
	Name            string             `json:"name"`
	Description     *string            `json:"description"`
	LongDescription *string            `json:"longDescription"`
	SizeGuide       *string            `json:"sizeGuide"`
	ImageURL        *string            `json:"imageUrl"`
	Images          []string           `json:"images"`
	Price           float64            `json:"price"`
	WeightGram      *float64           `json:"weightGram"`
	Stock           float64            `json:"stock"`
	Collection      *CatalogCollection `json:"collection"`
	PreorderUntil   *string            `json:"preorderUntil"`
	Preorder        bool               `json:"preorder"`
	SKUs            []CatalogSKUView   `json:"skus"`
}

// Catalog is the storefront catalog: products with their collections in
// display order.
type CatalogView struct {
	Collections []CatalogCollection  `json:"collections"`
	Products    []CatalogProductView `json:"products"`
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

// skuPrice is the SKU's override when it is a number, else the product price.
func skuPrice(product float64, override *string) float64 {
	if override != nil {
		if n := domain.JSNumber(*override); !math.IsNaN(n) && !math.IsInf(n, 0) {
			return n
		}
	}
	return product
}

// BuildCatalog is buildShopCatalog, plus collections and pre-order flags.
func (s *Service) BuildCatalog(ctx context.Context) (CatalogView, error) {
	catalog, _, err := s.buildCatalog(ctx)
	return catalog, err
}

// buildCatalog also hands back the product settings it read, for the
// wholesale views that price the same products.
func (s *Service) buildCatalog(ctx context.Context) (CatalogView, map[string]ProductSettings, error) {
	catalog := CatalogView{Collections: []CatalogCollection{}, Products: []CatalogProductView{}}
	settings := map[string]ProductSettings{}
	products, err := s.ports.Catalog.WebProducts(ctx, s.db)
	if err != nil || len(products) == 0 {
		return catalog, settings, err
	}
	ids := make([]string, len(products))
	for i, p := range products {
		ids[i] = p.ID
	}
	skus, err := s.ports.Catalog.ActiveSKUs(ctx, s.db, ids)
	if err != nil {
		return catalog, settings, err
	}
	images, err := s.ports.Catalog.Images(ctx, s.db, ids)
	if err != nil {
		return catalog, settings, err
	}
	settings, err = s.productSettings(ctx, ids)
	if err != nil {
		return catalog, settings, err
	}
	skusByProduct := map[string][]CatalogSKU{}
	for _, sku := range skus {
		skusByProduct[sku.ProductID] = append(skusByProduct[sku.ProductID], sku)
	}
	imagesByProduct := map[string][]string{}
	for _, img := range images {
		imagesByProduct[img.ProductID] = append(imagesByProduct[img.ProductID], img.URL)
	}
	now := s.now()
	collections := map[string]CatalogCollection{}
	for _, p := range products {
		price := basePrice(p)
		until := settingsOf(settings, p.ID).PreorderUntil
		preorderOpen := domain.PreorderOpen(0, until, now)
		views := []CatalogSKUView{}
		stock := 0.0
		anyPreorder := false
		for _, sku := range skusByProduct[p.ID] {
			v := CatalogSKUView{ID: sku.ID, SKU: sku.SKU, Name: sku.Name, Price: skuPrice(price, sku.PriceOverride), Stock: numOr0(&sku.StockQuantity)}
			v.Preorder = preorderOpen && v.Stock <= 0
			anyPreorder = anyPreorder || v.Preorder
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
		var collection *CatalogCollection
		if p.CategoryID != nil && p.CategoryName != nil {
			c := CatalogCollection{ID: *p.CategoryID, Name: *p.CategoryName}
			if p.CategoryOrder != nil {
				c.order = *p.CategoryOrder
			}
			collections[c.ID] = c
			collection = &CatalogCollection{ID: c.ID, Name: c.Name}
		}
		catalog.Products = append(catalog.Products, CatalogProductView{
			ID: p.ID, Name: p.Name, Description: p.Description, LongDescription: p.LongDescription, SizeGuide: p.SizeGuide,
			ImageURL: p.ImageURL, Images: imgs, Price: price, WeightGram: weight, Stock: stock,
			Collection: collection, PreorderUntil: domain.DateString(until),
			Preorder: anyPreorder || (preorderOpen && stock <= 0), SKUs: views,
		})
	}
	for _, c := range collections {
		catalog.Collections = append(catalog.Collections, c)
	}
	sort.Slice(catalog.Collections, func(i, j int) bool {
		a, b := catalog.Collections[i], catalog.Collections[j]
		if a.order != b.order {
			return a.order < b.order
		}
		return a.Name < b.Name
	})
	return catalog, settings, nil
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

// CheckoutInput is the parsed checkout body plus what the handler
// resolved: the storefront, the authoritative courier quote and the
// signed-in member.
type CheckoutInput struct {
	Storefront Storefront
	Items      []CartItem
	Customer   struct {
		Name, Phone string
		Email       *string
	}
	// Delivery is ship (destination and courier required) or pickup at
	// Branch (no address, no shipping cost).
	Delivery struct {
		Method string
		Branch *PickupBranch
	}
	Destination struct {
		AreaID, Label, Address string
		PostalCode             *string
	}
	Courier struct {
		Code, ServiceCode, Provider string
		Cost                        float64
		Etd                         *string
	}
	PromoCode *string
	// Payment is xendit (an invoice to pay) or arkcoin (the member's
	// balance, paid at once).
	Payment string
	Member  *Member
	Notes   *string
	// BaseURL is the absolute origin for the Xendit redirect.
	BaseURL string
}

// CheckoutResult is a placed order; InvoiceURL is empty for an ARK Coin
// order, which is already paid.
type CheckoutResult struct {
	OrderID, OrderNumber, AccessToken, InvoiceURL string
	Paid                                          bool
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
	// stock is what the catalog shows for the SKU (or the product).
	stock float64
	// settings are the product's shop settings.
	settings ProductSettings
	// isPreorder lines sell at zero stock: no claim, no reservation.
	isPreorder bool
}

func (l resolvedLine) label() string {
	if l.skuName != nil {
		return l.productName + " (" + *l.skuName + ")"
	}
	return l.productName
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
// client's prices are never trusted). A zero-stock line of a product whose
// pre-order window is open becomes a pre-order line.
func (s *Service) resolveLines(ctx context.Context, items []CartItem) ([]resolvedLine, string, error) {
	if len(items) == 0 {
		return nil, "Your cart is empty", nil
	}
	if len(items) > 50 {
		return nil, "Too many cart lines", nil
	}
	ids := make([]string, len(items))
	for i, it := range items {
		ids[i] = it.ProductID
	}
	settings, err := s.productSettings(ctx, ids)
	if err != nil {
		return nil, "", err
	}
	now := s.now()
	var lines []resolvedLine
	for _, it := range items {
		qty := math.Floor(it.Quantity)
		if qty <= 0 || qty > 999 {
			return nil, "Invalid item quantity", nil
		}
		p, err := s.ports.Catalog.WebProduct(ctx, s.db, it.ProductID)
		if err != nil {
			return nil, "", err
		}
		if p == nil {
			return nil, "A product is no longer available. Reload the catalog.", nil
		}
		line := resolvedLine{productID: p.ID, productName: p.Name, quantity: qty, unitPrice: basePrice(*p),
			weightGram: unitWeight(p.WeightGram), stock: numOr0(p.InventoryQuantity), settings: settingsOf(settings, p.ID)}
		if it.SkuID != nil && *it.SkuID != "" {
			sku, err := s.ports.Catalog.ActiveSKU(ctx, s.db, *it.SkuID, it.ProductID)
			if err != nil {
				return nil, "", err
			}
			if sku == nil {
				return nil, "A variant is no longer available. Reload the catalog.", nil
			}
			if sku.PriceOverride != nil {
				if n := numOr0(sku.PriceOverride); n != 0 {
					line.unitPrice = n
				}
			}
			line.skuID, line.skuName, line.skuCode = &sku.ID, &sku.Name, &sku.SKU
			line.stock = numOr0(&sku.StockQuantity)
		} else if p.HasActiveSKU {
			return nil, p.Name + " has variants. Choose one first.", nil
		}
		line.isPreorder = domain.PreorderOpen(line.stock, line.settings.PreorderUntil, now)
		lines = append(lines, line)
	}
	return lines, "", nil
}

// orderDraft is an order about to be written: the resolved lines plus the
// buyer, destination and terms. Retail checkout and the wholesale portal
// both build one.
type orderDraft struct {
	storefront    Storefront
	lines         []resolvedLine
	customerName  string
	customerPhone string
	customerEmail *string
	address       string
	areaID        *string
	areaLabel     *string
	postalCode    *string
	provider      *string
	courierCode   *string
	courierSvc    *string
	shippingCost  float64
	etaText       *string
	notes         *string
	// Retail orders: delivery, promo code, payment method and the member
	// (nil for a guest). The zero values are ship, no promo, xendit.
	deliveryMethod string
	pickupBranchID *string
	promoCode      *string
	paymentMethod  string
	member         *Member
	// Wholesale orders carry the account and its terms; pay_later ones a
	// due date instead of an invoice expiry.
	wholesaleAccountID *string
	paymentTerms       *string
	dueAt              *time.Time
	invoiceExpiresAt   *time.Time
	// reservationStatus is held for orders awaiting payment, committed when
	// the goods ship before payment (pay_later).
	reservationStatus string
}

func (d orderDraft) subtotal() float64 {
	sum := 0.0
	for _, l := range d.lines {
		sum += float64(l.unitPrice * l.quantity)
	}
	return sum
}

// total is the amount before any promo discount; placeOrder applies the
// discount the promo engine grants.
func (d orderDraft) total() float64 { return d.subtotal() + d.shippingCost }

// promoCheck is the cart as the promo engine evaluates it.
func (d orderDraft) promoCheck() PromoCheck {
	check := PromoCheck{Code: *d.promoCode, Subtotal: d.subtotal(), Phone: orNil(&d.customerPhone), CustomerID: d.customerID()}
	for _, l := range d.lines {
		check.Lines = append(check.Lines, PromoLine{ProductID: l.productID, Amount: float64(l.unitPrice * l.quantity)})
	}
	return check
}

func (d orderDraft) customerID() *string {
	if d.member == nil {
		return nil
	}
	return &d.member.ID
}

// placedOrder is a written order and the stock it claimed.
type placedOrder struct {
	id, number, token string
	total             float64
	claims            []claim
}

// placeOrder claims stock for the non-pre-order lines BEFORE the order
// exists (the cashier pattern), then, in one transaction, holds the promo
// code, writes the order with its discount, its items and the
// reservations, and for ARK Coin debits the member's balance and marks
// the order paid. A failure part-way gives the claims back; a promo
// refusal or an insufficient balance is a 422 *checkoutError.
func (s *Service) placeOrder(ctx context.Context, d orderDraft) (placedOrder, error) {
	var claims []claim
	for _, l := range d.lines {
		if l.isPreorder {
			continue
		}
		c := claim{productID: l.productID, skuID: l.skuID, qty: l.quantity}
		ok, why, err := s.claimLine(ctx, c)
		if err != nil {
			s.restoreClaims(ctx, claims)
			return placedOrder{}, err
		}
		if !ok {
			s.restoreClaims(ctx, claims)
			if why == "variant_required" {
				return placedOrder{}, &checkoutError{400, l.productName + " has variants. Choose one first."}
			}
			return placedOrder{}, &checkoutError{400, "Not enough stock for " + l.label()}
		}
		claims = append(claims, c)
	}
	if d.reservationStatus == "" {
		d.reservationStatus = "held"
	}
	reservationExpiry := d.invoiceExpiresAt
	if reservationExpiry == nil {
		reservationExpiry = d.dueAt
	}
	if reservationExpiry == nil {
		t := s.now().Add(InvoiceExpiryHours * time.Hour)
		reservationExpiry = &t
	}
	if d.deliveryMethod == "" {
		d.deliveryMethod = domain.DeliveryShip
	}
	if d.paymentMethod == "" {
		d.paymentMethod = domain.PaymentXendit
	}
	res := placedOrder{claims: claims}
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		// The promo hold needs the order id, so the id comes first.
		if err := tx.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&res.id); err != nil {
			return err
		}
		discount := 0.0
		if d.promoCode != nil {
			var err error
			discount, _, err = s.ports.Promo.Hold(ctx, tx, d.promoCheck(), res.id)
			if rej, ok := errors.AsType[*PromoRejectedError](err); ok {
				return &checkoutError{422, domain.PromoMessage(rej.Reason)}
			}
			if err != nil {
				return err
			}
		}
		res.total = domain.OrderTotal(d.subtotal(), discount, d.shippingCost)
		if res.total <= 0 && d.paymentMethod == domain.PaymentXendit {
			return &checkoutError{400, "Invalid order total"}
		}
		if err := tx.QueryRow(ctx, `INSERT INTO shop.orders (
			  id, storefront_id, customer_name, customer_phone, customer_email,
			  shipping_address, shipping_area_id, shipping_area_label,
			  shipping_postal_code, shipping_provider, courier_code,
			  courier_service, subtotal, shipping_cost, total,
			  invoice_expires_at, notes, wholesale_account_id, payment_terms, due_at,
			  delivery_method, pickup_branch_id, promo_code, discount_amount,
			  payment_method, eta_text, customer_id
			) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::uuid,$19,$20,
			  $21,$22::uuid,$23,$24,$25,$26,$27::uuid)
			RETURNING order_number, access_token::text`,
			res.id, d.storefront.ID, d.customerName, d.customerPhone, orNil(d.customerEmail),
			d.address, d.areaID, d.areaLabel, orNil(d.postalCode), d.provider, d.courierCode,
			d.courierSvc, d.subtotal(), d.shippingCost, res.total, d.invoiceExpiresAt, orNil(d.notes),
			d.wholesaleAccountID, d.paymentTerms, d.dueAt,
			d.deliveryMethod, d.pickupBranchID, d.promoCode, discount, d.paymentMethod, d.etaText, d.customerID(),
		).Scan(&res.number, &res.token); err != nil {
			return err
		}
		for _, l := range d.lines {
			if _, err := tx.Exec(ctx, `INSERT INTO shop.order_items (
				  order_id, product_id, sku_id, product_name, sku_name, sku_code,
				  quantity, unit_price, total, weight_gram, is_preorder
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
				res.id, l.productID, l.skuID, l.productName, l.skuName, l.skuCode,
				l.quantity, l.unitPrice, float64(l.unitPrice*l.quantity), l.weightGram, l.isPreorder); err != nil {
				return err
			}
		}
		for _, c := range claims {
			if _, err := tx.Exec(ctx, `INSERT INTO shop.stock_reservations (order_id, product_id, sku_id, qty, status, expires_at)
				VALUES ($1,$2,$3,$4,$5,$6)`, res.id, c.productID, c.skuID, c.qty, d.reservationStatus, reservationExpiry); err != nil {
				return err
			}
		}
		if d.paymentMethod == domain.PaymentArkCoin {
			return s.payWithArkCoin(ctx, tx, d, res)
		}
		return nil
	})
	if err != nil {
		s.restoreClaims(ctx, claims)
		if cerr, ok := errors.AsType[*checkoutError](err); ok {
			return placedOrder{}, cerr
		}
		s.log.Error("[shop] checkout order insert failed", "error", err)
		return placedOrder{}, &checkoutError{500, "Could not create the order. Try again."}
	}
	return res, nil
}

// payWithArkCoin debits the member inside the order's transaction, marks
// the order paid, captures the promo, commits the stock and records the
// member's spend through the outbox.
func (s *Service) payWithArkCoin(ctx context.Context, tx pgx.Tx, d orderDraft, o placedOrder) error {
	err := s.ports.Wallet.Pay(ctx, tx, d.member.ID, o.total, o.id, "Shop order "+o.number)
	if errors.Is(err, ErrArkInsufficient) {
		return &checkoutError{422, arkInsufficient}
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE shop.orders SET status = 'paid', paid_at = now(), invoice_expires_at = NULL, updated_at = now()
		WHERE id = $1::uuid`, o.id); err != nil {
		return err
	}
	if d.promoCode != nil {
		if err := s.ports.Promo.Capture(ctx, tx, o.id); err != nil {
			return err
		}
	}
	if err := commitOrderReservations(ctx, tx, o.id); err != nil {
		return err
	}
	return outbox.Publish(ctx, tx, possales.TopicCustomerOrderRecorded, o.id, possales.CustomerOrderRecorded{
		CustomerID: d.member.ID, OrderID: o.id, Amount: o.total,
	})
}

const arkInsufficient = "Your ARK Coin balance does not cover this order"

// issueInvoice creates the Xendit invoice of a placed order and stores its
// link. A failure compensates fully: stock back, reservations and promo
// released, order cancelled.
func (s *Service) issueInvoice(ctx context.Context, o placedOrder, amount float64, payer, description, redirectURL string) (string, error) {
	invoice, err := s.ports.Payments.CreateInvoice(ctx, InvoiceRequest{
		ExternalID: InvoicePrefix + o.id, Amount: amount, PayerName: payer, Description: description, RedirectURL: redirectURL,
	})
	if err == nil {
		_, err = s.db.Exec(ctx, `UPDATE shop.orders
			SET xendit_invoice_id = $2, xendit_invoice_url = $3, updated_at = now()
			WHERE id = $1::uuid`, o.id, invoice.ID, invoice.URL)
	}
	if err == nil {
		return invoice.URL, nil
	}
	s.log.Error("[shop] xendit invoice failed", "order", o.id, "error", err)
	s.restoreClaims(ctx, o.claims)
	if _, err := s.db.Exec(ctx, `UPDATE shop.stock_reservations SET status='released', updated_at=now()
		WHERE order_id = $1::uuid AND status='held'`, o.id); err != nil {
		s.log.Error("[shop] release reservations failed", "order", o.id, "error", err)
	}
	if _, err := s.db.Exec(ctx, `UPDATE shop.orders SET status='cancelled', updated_at=now() WHERE id = $1::uuid`, o.id); err != nil {
		s.log.Error("[shop] cancel order failed", "order", o.id, "error", err)
	}
	s.releasePromo(ctx, o.id)
	return "", &checkoutError{502, "Could not create the payment invoice. Try again."}
}

// releasePromo gives an expired or cancelled order's promo code back;
// a failure is only logged.
func (s *Service) releasePromo(ctx context.Context, orderID string) {
	if err := s.ports.Promo.Release(ctx, s.db, orderID); err != nil {
		s.log.Error("[shop] promo release failed", "order", orderID, "error", err)
	}
}

// Checkout places a retail order. Ship orders carry the authoritative
// courier quote; pickup orders skip shipping. Xendit orders get an
// invoice and a WhatsApp summary; ARK Coin orders are paid at once and
// get the payment confirmation. A *checkoutError carries the status and
// reason for the buyer.
func (s *Service) Checkout(ctx context.Context, in CheckoutInput) (CheckoutResult, error) {
	if in.Payment == domain.PaymentXendit && !s.ports.Payments.Configured() {
		return CheckoutResult{}, &checkoutError{503, "Online payment is not configured"}
	}
	if in.Payment == domain.PaymentArkCoin && in.Member == nil {
		return CheckoutResult{}, &checkoutError{401, "Sign in to pay with ARK Coin"}
	}
	lines, reason, err := s.resolveLines(ctx, in.Items)
	if err != nil {
		return CheckoutResult{}, err
	}
	if reason != "" {
		return CheckoutResult{}, &checkoutError{400, reason}
	}
	expiresAt := s.now().Add(InvoiceExpiryHours * time.Hour)
	d := orderDraft{
		storefront: in.Storefront, lines: lines,
		customerName: in.Customer.Name, customerPhone: in.Customer.Phone, customerEmail: in.Customer.Email,
		notes: in.Notes, invoiceExpiresAt: &expiresAt,
		deliveryMethod: in.Delivery.Method, promoCode: in.PromoCode, paymentMethod: in.Payment, member: in.Member,
	}
	delivery := "Shipping to " + in.Destination.Label
	if in.Delivery.Method == domain.DeliveryPickup {
		d.pickupBranchID = &in.Delivery.Branch.ID
		d.address = "Pickup at " + in.Delivery.Branch.Name
		delivery = "Pick up at " + in.Delivery.Branch.Name
	} else {
		settings, err := s.StorefrontSettings(ctx, in.Storefront.ID)
		if err != nil {
			return CheckoutResult{}, err
		}
		d.address, d.areaID, d.areaLabel, d.postalCode = in.Destination.Address, &in.Destination.AreaID, &in.Destination.Label, in.Destination.PostalCode
		d.provider, d.courierCode, d.courierSvc = &in.Courier.Provider, &in.Courier.Code, &in.Courier.ServiceCode
		rate := math.Max(0, jsmath.Round(domain.OrFinite(in.Courier.Cost)))
		d.shippingCost = domain.ShippingCost(rate, d.subtotal(), settings.FreeShippingThreshold)
		d.etaText = orNil(in.Courier.Etd)
	}
	if d.total() <= 0 {
		return CheckoutResult{}, &checkoutError{400, "Invalid order total"}
	}
	if in.Payment == domain.PaymentArkCoin {
		// A cheap refusal before any stock is claimed; the debit inside
		// the transaction is the final word.
		balance, err := s.ports.Wallet.Balance(ctx, s.db, in.Member.ID)
		if err != nil {
			return CheckoutResult{}, err
		}
		if balance < s.estimatedTotal(ctx, d) {
			return CheckoutResult{}, &checkoutError{422, arkInsufficient}
		}
	}
	placed, err := s.placeOrder(ctx, d)
	if err != nil {
		return CheckoutResult{}, err
	}
	res := CheckoutResult{OrderID: placed.id, OrderNumber: placed.number, AccessToken: placed.token}
	statusURL := in.BaseURL + "/shop/order/" + placed.token
	if in.Payment == domain.PaymentArkCoin {
		res.Paid = true
		s.sendWa(ctx, in.Customer.Phone, domain.OrderPaidMessage(s.ports.AppOrigin, placed.number, in.Customer.Name, placed.token, placed.total), "paid")
		return res, nil
	}
	res.InvoiceURL, err = s.issueInvoice(ctx, placed, placed.total, in.Customer.Name, "Order "+placed.number+" — "+in.Storefront.Name, statusURL)
	if err != nil {
		return CheckoutResult{}, err
	}
	s.sendWa(ctx, in.Customer.Phone, domain.OrderPlacedMessage(s.ports.AppOrigin, placed.number, in.Customer.Name, placed.token, delivery, res.InvoiceURL, placed.total), "placed")
	return res, nil
}

// estimatedTotal is the total after the promo preview's discount.
func (s *Service) estimatedTotal(ctx context.Context, d orderDraft) float64 {
	discount := 0.0
	if d.promoCode != nil {
		if p, err := s.ports.Promo.Preview(ctx, s.db, d.promoCheck()); err == nil && p.OK {
			discount = p.Discount
		}
	}
	return domain.OrderTotal(d.subtotal(), discount, d.shippingCost)
}

// sendWa sends a best-effort WhatsApp text after the response.
func (s *Service) sendWa(ctx context.Context, phone, message, kind string) {
	s.background(ctx, func(ctx context.Context) {
		if err := s.ports.Messenger.SendText(ctx, phone, message); err != nil {
			s.log.Error("[shop] WA "+kind+" failed", "error", err)
		}
	})
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
