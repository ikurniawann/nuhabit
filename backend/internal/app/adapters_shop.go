package app

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/shop"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// shop reads the POS merchandise catalog and member phones and claims stock
// through the pos_sell_merchandise_* functions. pos-ops and CRM expose no
// service for these yet, so the adapters below run the SQL of
// lib/shop/storefront-server.ts and lib/shop/marketplace/*.ts.

// ShopPorts wires the shop module; its integration tests use it too.
func ShopPorts(d module.Deps) shop.Ports {
	log := d.Log
	if log == nil {
		log = slog.Default()
	}
	return shop.Ports{
		Catalog:   shopCatalog{},
		Stock:     shopStock{},
		Members:   shopMembers{},
		Payments:  shopPayments{newXenditInvoices(os.Getenv, log)},
		Messenger: gatewayMessenger{db: d.DB, wa: whatsapp.New(log)},
		AppOrigin: ticketingAppOrigin(os.Getenv),
		Getenv:    os.Getenv,
	}
}

type shopCatalog struct{}

var _ shop.Catalog = shopCatalog{}

const webProductSelect = `SELECT p.id::text, p.name, p.description, p.long_description, p.image_url,
	  p.base_price::text, pc.price_override::text, p.weight_gram::text, p.inventory_quantity::text,
	  EXISTS (SELECT 1 FROM pos.pos_product_skus s WHERE s.product_id = p.id AND s.is_active = true)
	FROM pos.pos_products p
	JOIN shop.product_channels pc
	  ON pc.product_id = p.id AND pc.channel_code = 'web' AND pc.is_distributed
	WHERE p.product_kind = 'merchandise'
	  AND p.is_active = true AND p.is_available = true`

func scanWebProduct(row pgx.Row) (shop.WebProduct, error) {
	var p shop.WebProduct
	err := row.Scan(&p.ID, &p.Name, &p.Description, &p.LongDescription, &p.ImageURL,
		&p.BasePrice, &p.ChannelPrice, &p.WeightGram, &p.InventoryQuantity, &p.HasActiveSKU)
	return p, err
}

func (shopCatalog) WebProducts(ctx context.Context, q database.Querier) ([]shop.WebProduct, error) {
	rows, err := q.Query(ctx, webProductSelect+` ORDER BY p.name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (shop.WebProduct, error) { return scanWebProduct(r) })
}

func (shopCatalog) WebProduct(ctx context.Context, q database.Querier, id string) (*shop.WebProduct, error) {
	p, err := scanWebProduct(q.QueryRow(ctx, webProductSelect+` AND p.id = $1::uuid`, id))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &p, err
}

const skuSelect = `SELECT id::text, product_id::text, sku, name, price_override::text, stock_quantity::text
	FROM pos.pos_product_skus`

func scanSKU(row pgx.Row) (shop.CatalogSKU, error) {
	var s shop.CatalogSKU
	err := row.Scan(&s.ID, &s.ProductID, &s.SKU, &s.Name, &s.PriceOverride, &s.StockQuantity)
	return s, err
}

func (shopCatalog) ActiveSKUs(ctx context.Context, q database.Querier, productIDs []string) ([]shop.CatalogSKU, error) {
	rows, err := q.Query(ctx, skuSelect+` WHERE product_id = ANY($1::uuid[]) AND is_active = true ORDER BY name`, productIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (shop.CatalogSKU, error) { return scanSKU(r) })
}

func (shopCatalog) ActiveSKU(ctx context.Context, q database.Querier, skuID, productID string) (*shop.CatalogSKU, error) {
	s, err := scanSKU(q.QueryRow(ctx, skuSelect+` WHERE id = $1::uuid AND product_id = $2::uuid AND is_active = true`, skuID, productID))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &s, err
}

func (shopCatalog) Images(ctx context.Context, q database.Querier, productIDs []string) ([]shop.ProductImage, error) {
	rows, err := q.Query(ctx, `SELECT product_id::text, url FROM pos.pos_product_images
		WHERE product_id = ANY($1::uuid[]) ORDER BY display_order`, productIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[shop.ProductImage])
}

func (shopCatalog) Cargo(ctx context.Context, q database.Querier, id string) (*string, string, bool, error) {
	var weight *string
	var price string
	err := q.QueryRow(ctx, `SELECT weight_gram::text, base_price::text FROM pos.pos_products
		WHERE id = $1::uuid AND product_kind = 'merchandise' AND is_active = true`, id).Scan(&weight, &price)
	if database.IsNoRows(err) {
		return nil, "", false, nil
	}
	return weight, price, err == nil, err
}

func (shopCatalog) ProductKind(ctx context.Context, q database.Querier, id string) (string, bool, error) {
	var kind string
	err := q.QueryRow(ctx, `SELECT product_kind FROM pos.pos_products WHERE id = $1::uuid`, id).Scan(&kind)
	if database.IsNoRows(err) {
		return "", false, nil
	}
	return kind, err == nil, err
}

func (shopCatalog) Labels(ctx context.Context, q database.Querier, productIDs, skuIDs []string) (map[string]string, map[string]shop.SKULabel, error) {
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
	skus := map[string]shop.SKULabel{}
	rows, err = q.Query(ctx, `SELECT id::text, name, sku FROM pos.pos_product_skus WHERE id = ANY($1::uuid[])`, skuIDs)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var l shop.SKULabel
		if err := rows.Scan(&id, &l.Name, &l.Code); err != nil {
			return nil, nil, err
		}
		skus[id] = l
	}
	return products, skus, rows.Err()
}

func (shopCatalog) LocalStock(ctx context.Context, q database.Querier, productID string, skuID *string) (*string, error) {
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

// shopStock claims stock with the POS merchandise functions (DB functions,
// not table writes), like lib/shop's claimLine.
type shopStock struct{}

func (shopStock) Sell(ctx context.Context, q database.Querier, productID string, skuID *string, qty float64) (*bool, string, error) {
	var raw []byte
	var err error
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

// shopMembers finds the CRM member whose phone digits end with a suffix.
type shopMembers struct{}

func (shopMembers) ByPhoneSuffix(ctx context.Context, q database.Querier, suffix string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM pos.pos_customers
		WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') LIKE '%' || $1
		LIMIT 1`, suffix).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

// shopPayments adapts the Xendit invoice client to shop.Payments.
type shopPayments struct{ x xenditInvoices }

func (p shopPayments) Configured() bool { return p.x.configured() }

func (p shopPayments) ValidWebhookToken(token string) bool { return p.x.validWebhookToken(token) }

func (p shopPayments) CreateInvoice(ctx context.Context, in shop.InvoiceRequest) (shop.Invoice, error) {
	inv, err := p.x.create(ctx, in.ExternalID, in.Amount, in.PayerName, in.Description, in.RedirectURL)
	return shop.Invoice{ID: inv.id, URL: inv.url, ExpiresAt: inv.expiresAt}, err
}

// gatewayMessenger sends texts through the self-hosted WhatsApp gateway
// only (loadGatewayConfig + sendGatewayText, no provider switch, no
// crm.wa_messages log), for shop and public booking notifications.
type gatewayMessenger struct {
	db database.Querier
	wa *whatsapp.Client
}

// errGatewayNotConfigured is the "gateway-belum-dikonfigurasi" outcome.
var errGatewayNotConfigured = errors.New("gateway-belum-dikonfigurasi")

func (m gatewayMessenger) SendText(ctx context.Context, target, message string) error {
	gateway := m.wa.LoadGateway(ctx, m.db)
	if gateway == nil {
		return errGatewayNotConfigured
	}
	if res := gateway.SendText(ctx, target, message); !res.Success {
		return errors.New(res.Reason)
	}
	return nil
}
