package posops

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Merchandise is the POS merchandise catalog and its stock claims, with the
// SQL of lib/shop/storefront-server.ts and lib/shop/marketplace/*.ts, for
// the shop context. Every method runs on the caller's Querier. Numeric
// columns keep their node-postgres text form.
type Merchandise struct{}

// MerchProduct is an active, available merchandise product.
type MerchProduct struct {
	ID                string
	Name              string
	Description       *string
	LongDescription   *string
	SizeGuide         *string
	ImageURL          *string
	BasePrice         string
	WeightGram        *string
	InventoryQuantity *string
	HasActiveSKU      bool
	// CategoryID and CategoryName are the product's pos_categories row
	// (nil without one); the storefront groups products by it.
	CategoryID    *string
	CategoryName  *string
	CategoryOrder *int
	CreatedAt     time.Time
}

// MerchSKU is an active pos.pos_product_skus row.
type MerchSKU struct {
	ID            string
	ProductID     string
	SKU           string
	Name          string
	PriceOverride *string
	StockQuantity string
}

// MerchImage is a pos.pos_product_images row.
type MerchImage struct{ ProductID, URL string }

// MerchSKULabel names a SKU.
type MerchSKULabel struct{ Name, Code string }

// Products lists the active, available merchandise among ids, by name.
func (Merchandise) Products(ctx context.Context, q database.Querier, ids []string) ([]MerchProduct, error) {
	rows, err := q.Query(ctx, `SELECT p.id::text, p.name, p.description, p.long_description, p.size_guide, p.image_url,
	  p.base_price::text, p.weight_gram::text, p.inventory_quantity::text,
	  EXISTS (SELECT 1 FROM pos.pos_product_skus s WHERE s.product_id = p.id AND s.is_active = true),
	  c.id::text, c.name, c.display_order, p.created_at
	FROM pos.pos_products p
	LEFT JOIN pos.pos_categories c ON c.id = p.category_id
	WHERE p.id = ANY($1::uuid[]) AND p.product_kind = 'merchandise'
	  AND p.is_active = true AND p.is_available = true
	ORDER BY p.name`, ids)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[MerchProduct])
}

const merchSKUSelect = `SELECT id::text, product_id::text, sku, name, price_override::text, stock_quantity::text
	FROM pos.pos_product_skus`

// ActiveSKUs lists the active SKUs of the products, by name.
func (Merchandise) ActiveSKUs(ctx context.Context, q database.Querier, productIDs []string) ([]MerchSKU, error) {
	rows, err := q.Query(ctx, merchSKUSelect+` WHERE product_id = ANY($1::uuid[]) AND is_active = true ORDER BY name`, productIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[MerchSKU])
}

// ActiveSKU is one active SKU of the product, nil when missing.
func (Merchandise) ActiveSKU(ctx context.Context, q database.Querier, skuID, productID string) (*MerchSKU, error) {
	rows, err := q.Query(ctx, merchSKUSelect+` WHERE id = $1::uuid AND product_id = $2::uuid AND is_active = true`, skuID, productID)
	if err != nil {
		return nil, err
	}
	s, err := pgx.CollectOneRow(rows, pgx.RowToStructByPos[MerchSKU])
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &s, err
}

// Images lists the product images by display order.
func (Merchandise) Images(ctx context.Context, q database.Querier, productIDs []string) ([]MerchImage, error) {
	rows, err := q.Query(ctx, `SELECT product_id::text, url FROM pos.pos_product_images
		WHERE product_id = ANY($1::uuid[]) ORDER BY display_order`, productIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[MerchImage])
}

// Cargo is weight_gram and base_price of an active merchandise product
// (found false otherwise).
func (Merchandise) Cargo(ctx context.Context, q database.Querier, id string) (weightGram *string, basePrice string, found bool, err error) {
	err = q.QueryRow(ctx, `SELECT weight_gram::text, base_price::text FROM pos.pos_products
		WHERE id = $1::uuid AND product_kind = 'merchandise' AND is_active = true`, id).Scan(&weightGram, &basePrice)
	if database.IsNoRows(err) {
		return nil, "", false, nil
	}
	return weightGram, basePrice, err == nil, err
}

// ProductKind is product_kind of any product (found false when missing).
func (Merchandise) ProductKind(ctx context.Context, q database.Querier, id string) (kind string, found bool, err error) {
	err = q.QueryRow(ctx, `SELECT product_kind FROM pos.pos_products WHERE id = $1::uuid`, id).Scan(&kind)
	if database.IsNoRows(err) {
		return "", false, nil
	}
	return kind, err == nil, err
}

// Labels names products and SKUs by id.
func (Merchandise) Labels(ctx context.Context, q database.Querier, productIDs, skuIDs []string) (map[string]string, map[string]MerchSKULabel, error) {
	products := map[string]string{}
	rows, err := q.Query(ctx, `SELECT id::text, name FROM pos.pos_products WHERE id = ANY($1::uuid[])`, productIDs)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			rows.Close()
			return nil, nil, err
		}
		products[id] = name
	}
	rows.Close()
	skus := map[string]MerchSKULabel{}
	rows, err = q.Query(ctx, `SELECT id::text, name, sku FROM pos.pos_product_skus WHERE id = ANY($1::uuid[])`, skuIDs)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var l MerchSKULabel
		if err := rows.Scan(&id, &l.Name, &l.Code); err != nil {
			return nil, nil, err
		}
		skus[id] = l
	}
	return products, skus, rows.Err()
}

// LocalStock is the SKU's stock_quantity, or the product's
// inventory_quantity without a SKU (nil when NULL or missing).
func (Merchandise) LocalStock(ctx context.Context, q database.Querier, productID string, skuID *string) (*string, error) {
	var stock *string
	var err error
	if skuID != nil {
		err = q.QueryRow(ctx, `SELECT stock_quantity::text FROM pos.pos_product_skus WHERE id = $1::uuid`, *skuID).Scan(&stock)
	} else {
		err = q.QueryRow(ctx, `SELECT inventory_quantity::text FROM pos.pos_products WHERE id = $1::uuid`, productID).Scan(&stock)
	}
	if database.IsNoRows(err) {
		return nil, nil
	}
	return stock, err
}

// Sell claims stock through pos_sell_merchandise_stock /
// pos_sell_merchandise_sku_stock (a negative qty gives stock back): the
// jsonb result's success flag (nil when absent, e.g. a non-tracked product
// reports skipped) and reason.
func (Merchandise) Sell(ctx context.Context, q database.Querier, productID string, skuID *string, qty float64) (success *bool, reason string, err error) {
	var raw []byte
	if skuID != nil {
		err = q.QueryRow(ctx, `SELECT public.pos_sell_merchandise_sku_stock($1::uuid, $2::numeric)`, *skuID, qty).Scan(&raw)
	} else {
		err = q.QueryRow(ctx, `SELECT public.pos_sell_merchandise_stock($1::uuid, $2::numeric)`, productID, qty).Scan(&raw)
	}
	if err != nil {
		return nil, "", err
	}
	var res struct {
		Success *bool  `json:"success"`
		Reason  string `json:"reason"`
	}
	_ = json.Unmarshal(raw, &res)
	return res.Success, res.Reason, nil
}
