package app

import (
	"context"
	"errors"
	"log/slog"
	"maps"
	"net/http"
	"os"
	"slices"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/posops"
	"nuhabit/backend/internal/modules/shop"
	"nuhabit/backend/internal/modules/storedvalue"
	"nuhabit/backend/internal/modules/storedvalue/promo"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/members"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// shop reads the POS merchandise catalog and claims its stock through
// pos-ops' Merchandise service, members through platform/auth and
// platform/members (phone lookups through a stopgap SQL adapter), pickup
// branches from configuration.branches, and promo codes and ARK Coin
// through the stored-value services.

// ShopPorts wires the shop module; its integration tests use it too.
func ShopPorts(d module.Deps) shop.Ports {
	log := d.Log
	if log == nil {
		log = slog.Default()
	}
	sv := storedValuePorts(d)
	return shop.Ports{
		Catalog:   shopCatalog{},
		Stock:     posops.Merchandise{},
		Members:   shopMembers{auth: d.Auth, db: d.DB},
		Payments:  shopPayments{newXenditInvoices(os.Getenv, log)},
		Messenger: gatewayMessenger{db: d.DB, wa: whatsapp.New(log)},
		Branches:  shopBranches{},
		Promo:     shopPromo{s: storedvalue.NewPromo(d, sv)},
		Wallet:    shopWallet{w: storedvalue.NewWallet(d, sv)},
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
		out[i] = shop.WebProduct{ID: p.ID, Name: p.Name, Description: p.Description, LongDescription: p.LongDescription, SizeGuide: p.SizeGuide,
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

// shopMembers finds the CRM member whose phone digits end with a suffix,
// and the member behind a public request's member session.
type shopMembers struct {
	auth *auth.Service
	db   database.Querier
}

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

func (m shopMembers) FromRequest(r *http.Request) (*shop.Member, error) {
	session, err := m.auth.MemberSessionFromRequest(r)
	if err != nil || session == nil {
		return nil, err
	}
	member, err := members.Get(r.Context(), m.db, session.CustomerID)
	if err != nil || member == nil || !member.IsActive {
		return nil, err
	}
	return &shop.Member{ID: member.ID, Name: member.Name, Phone: member.Phone, Email: member.Email}, nil
}

// shopBranches reads pickup branches from configuration.branches.
type shopBranches struct{}

const pickupBranchColumns = `SELECT id::text, name, address, city, phone FROM configuration.branches`

func (shopBranches) Public(ctx context.Context, q database.Querier) ([]shop.PickupBranch, error) {
	rows, err := q.Query(ctx, pickupBranchColumns+` WHERE is_active AND is_public ORDER BY name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[shop.PickupBranch])
}

func (shopBranches) Get(ctx context.Context, q database.Querier, id string) (*shop.PickupBranch, error) {
	rows, err := q.Query(ctx, pickupBranchColumns+` WHERE id = $1::uuid`, id)
	if err != nil {
		return nil, err
	}
	b, err := pgx.CollectOneRow(rows, pgx.RowToStructByPos[shop.PickupBranch])
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &b, err
}

// shopPromo adapts the stored-value promo service: codes of the default
// CRM venue, evaluated on the "shop" channel.
type shopPromo struct{ s *promo.Service }

// shopPromoChannel is the channel the promo engine sees; campaigns scoped
// "semua" apply.
const shopPromoChannel = "shop"

func (shopPromo) scope(ctx context.Context, q database.Querier) (promo.VenueScope, bool) {
	v := svDirectory{}.DefaultVenue(ctx, q)
	if v.CompanyID == nil || v.BranchID == nil {
		return promo.VenueScope{}, false
	}
	return promo.VenueScope{CompanyID: *v.CompanyID, BranchID: *v.BranchID}, true
}

func shopPromoLines(in shop.PromoCheck) []promo.LineInput {
	lines := make([]promo.LineInput, len(in.Lines))
	for i, l := range in.Lines {
		lines[i] = promo.LineInput{ProductID: l.ProductID, Amount: l.Amount}
	}
	return lines
}

func (p shopPromo) Preview(ctx context.Context, q database.Querier, in shop.PromoCheck) (shop.PromoPreview, error) {
	scope, ok := p.scope(ctx, q)
	if !ok {
		return shop.PromoPreview{Reason: "nonaktif"}, nil
	}
	res, err := p.s.PreviewPromoCode(ctx, q, promo.PreviewInput{
		Scope: scope, Code: in.Code, Channel: shopPromoChannel, Subtotal: in.Subtotal, Phone: in.Phone,
		Lines: shopPromoLines(in), CustomerID: in.CustomerID,
	})
	return shop.PromoPreview{OK: res.OK, Discount: res.Discount, Label: res.CampaignName, Reason: string(res.Reason)}, err
}

func (p shopPromo) Hold(ctx context.Context, q database.Querier, in shop.PromoCheck, orderID string) (float64, string, error) {
	scope, ok := p.scope(ctx, q)
	if !ok {
		return 0, "", &shop.PromoRejectedError{Reason: "nonaktif"}
	}
	hold, err := p.s.HoldPromoRedemption(ctx, q, promo.HoldInput{
		Scope: scope, Code: in.Code, Channel: shopPromoChannel, ContextType: shop.PromoContextType, ContextID: orderID,
		Subtotal: in.Subtotal, Phone: in.Phone, CustomerID: in.CustomerID, Lines: shopPromoLines(in),
	})
	if rej, ok := errors.AsType[*promo.PromoRejectedError](err); ok {
		return 0, "", &shop.PromoRejectedError{Reason: string(rej.Reason)}
	}
	return hold.Discount, hold.CampaignName, err
}

func (p shopPromo) Capture(ctx context.Context, q database.Querier, orderID string) error {
	_, err := p.s.CapturePromoRedemption(ctx, q, shop.PromoContextType, orderID)
	return err
}

func (p shopPromo) Release(ctx context.Context, q database.Querier, orderID string) error {
	_, err := p.s.ReleasePromoRedemption(ctx, q, shop.PromoContextType, orderID)
	return err
}

// shopWallet adapts the ARK Coin wallet. The wallet row's order_id is a
// POS order, so a shop order is named in the notes instead.
type shopWallet struct{ w *storedvalue.Wallet }

func (a shopWallet) Balance(ctx context.Context, q database.Querier, customerID string) (float64, error) {
	return a.w.ArkBalance(ctx, q, customerID)
}

func (a shopWallet) Pay(ctx context.Context, q database.Querier, customerID string, amount float64, _ string, notes string) error {
	_, err := a.w.MoveArkCoins(ctx, q, storedvalue.ArkMovement{CustomerID: customerID, Amount: -amount, Type: "payment", Notes: &notes})
	if errors.Is(err, storedvalue.ErrArkInsufficient) {
		return shop.ErrArkInsufficient
	}
	return err
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
