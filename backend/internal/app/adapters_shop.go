package app

import (
	"context"
	"errors"
	"log/slog"
	"maps"
	"os"
	"slices"

	"nuhabit/backend/internal/modules/posops"
	"nuhabit/backend/internal/modules/shop"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// shop reads the POS merchandise catalog and claims its stock through
// pos-ops' Merchandise service, and member phones through a stopgap SQL
// adapter (CRM exposes no service for them yet).

// ShopPorts wires the shop module; its integration tests use it too.
func ShopPorts(d module.Deps) shop.Ports {
	log := d.Log
	if log == nil {
		log = slog.Default()
	}
	return shop.Ports{
		Catalog:   shopCatalog{},
		Stock:     posops.Merchandise{},
		Members:   shopMembers{},
		Payments:  shopPayments{newXenditInvoices(os.Getenv, log)},
		Messenger: gatewayMessenger{db: d.DB, wa: whatsapp.New(log)},
		AppOrigin: ticketingAppOrigin(os.Getenv),
		Getenv:    os.Getenv,
	}
}

// shopCatalog composes pos-ops' merchandise catalog with the shop's web
// channel rows (pos.pos_products joined with shop.product_channels).
type shopCatalog struct {
	pos      posops.Merchandise
	channels shop.Channels
}

var _ shop.Catalog = shopCatalog{}

// webProducts is the merchandise of the web channel rows, by name.
func (c shopCatalog) webProducts(ctx context.Context, q database.Querier, productID string) ([]shop.WebProduct, error) {
	prices, err := c.channels.Web(ctx, q, productID)
	if err != nil || len(prices) == 0 {
		return nil, err
	}
	products, err := c.pos.Products(ctx, q, slices.Collect(maps.Keys(prices)))
	if err != nil {
		return nil, err
	}
	out := make([]shop.WebProduct, len(products))
	for i, p := range products {
		out[i] = shop.WebProduct{ID: p.ID, Name: p.Name, Description: p.Description, LongDescription: p.LongDescription,
			ImageURL: p.ImageURL, BasePrice: p.BasePrice, ChannelPrice: prices[p.ID], WeightGram: p.WeightGram,
			InventoryQuantity: p.InventoryQuantity, HasActiveSKU: p.HasActiveSKU,
			CategoryID: p.CategoryID, CategoryName: p.CategoryName, CategoryOrder: p.CategoryOrder}
	}
	return out, nil
}

func (c shopCatalog) WebProducts(ctx context.Context, q database.Querier) ([]shop.WebProduct, error) {
	return c.webProducts(ctx, q, "")
}

func (c shopCatalog) WebProduct(ctx context.Context, q database.Querier, id string) (*shop.WebProduct, error) {
	products, err := c.webProducts(ctx, q, id)
	if err != nil || len(products) == 0 {
		return nil, err
	}
	return &products[0], nil
}

func (c shopCatalog) ActiveSKUs(ctx context.Context, q database.Querier, productIDs []string) ([]shop.CatalogSKU, error) {
	skus, err := c.pos.ActiveSKUs(ctx, q, productIDs)
	if err != nil {
		return nil, err
	}
	out := make([]shop.CatalogSKU, len(skus))
	for i, s := range skus {
		out[i] = shop.CatalogSKU(s)
	}
	return out, nil
}

func (c shopCatalog) ActiveSKU(ctx context.Context, q database.Querier, skuID, productID string) (*shop.CatalogSKU, error) {
	s, err := c.pos.ActiveSKU(ctx, q, skuID, productID)
	if s == nil || err != nil {
		return nil, err
	}
	out := shop.CatalogSKU(*s)
	return &out, nil
}

func (c shopCatalog) Images(ctx context.Context, q database.Querier, productIDs []string) ([]shop.ProductImage, error) {
	images, err := c.pos.Images(ctx, q, productIDs)
	if err != nil {
		return nil, err
	}
	out := make([]shop.ProductImage, len(images))
	for i, img := range images {
		out[i] = shop.ProductImage(img)
	}
	return out, nil
}

func (c shopCatalog) Cargo(ctx context.Context, q database.Querier, id string) (*string, string, bool, error) {
	return c.pos.Cargo(ctx, q, id)
}

func (c shopCatalog) ProductKind(ctx context.Context, q database.Querier, id string) (string, bool, error) {
	return c.pos.ProductKind(ctx, q, id)
}

func (c shopCatalog) Labels(ctx context.Context, q database.Querier, productIDs, skuIDs []string) (map[string]string, map[string]shop.SKULabel, error) {
	products, skus, err := c.pos.Labels(ctx, q, productIDs, skuIDs)
	if err != nil {
		return nil, nil, err
	}
	labels := make(map[string]shop.SKULabel, len(skus))
	for id, l := range skus {
		labels[id] = shop.SKULabel(l)
	}
	return products, labels, nil
}

func (c shopCatalog) LocalStock(ctx context.Context, q database.Querier, productID string, skuID *string) (*string, error) {
	return c.pos.LocalStock(ctx, q, productID, skuID)
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
