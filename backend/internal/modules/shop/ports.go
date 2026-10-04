package shop

import (
	"context"
	"errors"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// Ports reach data and capabilities owned by other bounded contexts. The
// adapters live in internal/app/adapters_shop.go.
type Ports struct {
	Catalog   Catalog
	Stock     Stock
	Members   Members
	Payments  Payments
	Messenger Messenger
	// AppOrigin is appOrigin() without a request: NEXT_PUBLIC_APP_URL (or
	// NEXT_PUBLIC_BASE_URL) without trailing slashes, "" when unset.
	AppOrigin string
	// Getenv reads the courier and marketplace credentials
	// (BITESHIP_API_KEY, RAJAONGKIR_API_KEY, SHOPEE_*, BITESHIP_WEBHOOK_TOKEN,
	// MARKETPLACE_SYNC_TOKEN). os.Getenv in production.
	Getenv func(string) string
}

// WebProduct is a merchandise product distributed to the web channel
// (pos.pos_products joined with shop.product_channels). Numeric columns
// keep their node-postgres text form.
type WebProduct struct {
	ID                string
	Name              string
	Description       *string
	LongDescription   *string
	ImageURL          *string
	BasePrice         string
	ChannelPrice      *string
	WeightGram        *string
	InventoryQuantity *string
	HasActiveSKU      bool
}

// CatalogSKU is an active pos.pos_product_skus row.
type CatalogSKU struct {
	ID            string
	ProductID     string
	SKU           string
	Name          string
	PriceOverride *string
	StockQuantity string
}

// ProductImage is a pos.pos_product_images row.
type ProductImage struct{ ProductID, URL string }

// SKULabel names a SKU for the marketplace mapping list.
type SKULabel struct{ Name, Code string }

// Catalog reads the POS merchandise catalog (owned by pos-ops).
type Catalog interface {
	// WebProducts is the storefront catalog: active, available merchandise
	// distributed to the web channel, ordered by name.
	WebProducts(ctx context.Context, q database.Querier) ([]WebProduct, error)
	// WebProduct is one such product with HasActiveSKU, nil when it is not
	// sellable on the web.
	WebProduct(ctx context.Context, q database.Querier, id string) (*WebProduct, error)
	// ActiveSKUs lists the active SKUs of the products, ordered by name.
	ActiveSKUs(ctx context.Context, q database.Querier, productIDs []string) ([]CatalogSKU, error)
	// ActiveSKU is one active SKU of the product, nil when missing.
	ActiveSKU(ctx context.Context, q database.Querier, skuID, productID string) (*CatalogSKU, error)
	// Images lists the product images by display order.
	Images(ctx context.Context, q database.Querier, productIDs []string) ([]ProductImage, error)
	// Cargo is weight_gram and base_price of an active merchandise product
	// (found false otherwise).
	Cargo(ctx context.Context, q database.Querier, id string) (weightGram *string, basePrice string, found bool, err error)
	// ProductKind is product_kind of any product (found false when missing).
	ProductKind(ctx context.Context, q database.Querier, id string) (kind string, found bool, err error)
	// Labels names products and SKUs by id.
	Labels(ctx context.Context, q database.Querier, productIDs, skuIDs []string) (map[string]string, map[string]SKULabel, error)
	// LocalStock is the SKU's stock_quantity, or the product's
	// inventory_quantity without a SKU (nil when NULL or missing).
	LocalStock(ctx context.Context, q database.Querier, productID string, skuID *string) (*string, error)
}

// Stock claims merchandise stock through pos_sell_merchandise_stock /
// pos_sell_merchandise_sku_stock (a negative qty gives stock back).
type Stock interface {
	// Sell returns the jsonb result's success flag (nil when absent, e.g.
	// a non-tracked product reports skipped) and reason.
	Sell(ctx context.Context, q database.Querier, productID string, skuID *string, qty float64) (success *bool, reason string, err error)
}

// Members links paid orders to CRM members (pos.pos_customers).
type Members interface {
	// ByPhoneSuffix is the first member whose phone digits end with suffix,
	// "" when none.
	ByPhoneSuffix(ctx context.Context, q database.Querier, suffix string) (string, error)
}

// InvoiceRequest is CreateInvoiceInput (lib/xendit/client).
type InvoiceRequest struct {
	ExternalID  string
	Amount      float64
	PayerName   string
	Description string
	RedirectURL string
}

// Invoice is CreatedInvoice.
type Invoice struct {
	ID        string
	URL       string
	ExpiresAt time.Time
}

// Payments is the Xendit invoice client (lib/xendit/client).
type Payments interface {
	// Configured is isXenditConfigured (secret key set, or mock mode).
	Configured() bool
	CreateInvoice(ctx context.Context, in InvoiceRequest) (Invoice, error)
	// ValidWebhookToken is isValidWebhookToken: constant-time compare with
	// XENDIT_WEBHOOK_TOKEN.
	ValidWebhookToken(token string) bool
}

// InvoiceExpiryHours is getInvoiceExpiryHours().
const InvoiceExpiryHours = 2

// ErrMessengerNotConfigured is the "gateway-belum-dikonfigurasi" outcome.
var ErrMessengerNotConfigured = errors.New("gateway-belum-dikonfigurasi")

// Messenger sends a WhatsApp text through the self-hosted gateway
// (loadGatewayConfig + sendGatewayText, no crm.wa_messages log).
type Messenger interface {
	SendText(ctx context.Context, target, message string) error
}
