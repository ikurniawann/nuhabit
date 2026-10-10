package shop

import (
	"context"
	"errors"
	"net/http"
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
	Branches  Branches
	Promo     Promo
	Wallet    Wallet
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
	SizeGuide         *string
	ImageURL          *string
	BasePrice         string
	ChannelPrice      *string
	WeightGram        *string
	InventoryQuantity *string
	HasActiveSKU      bool
	// The product's POS category, the storefront's collection (nil without
	// one).
	CategoryID    *string
	CategoryName  *string
	CategoryOrder *int
	CreatedAt     time.Time
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

// Member is the signed-in buyer (pos.pos_customers display fields).
type Member struct {
	ID    string
	Name  *string
	Phone string
	Email *string
}

// Members links orders to CRM members (pos.pos_customers).
type Members interface {
	// ByPhoneSuffix is the first member whose phone digits end with suffix,
	// "" when none.
	ByPhoneSuffix(ctx context.Context, q database.Querier, suffix string) (string, error)
	// FromRequest resolves the member_session cookie (or Bearer token) of
	// a public request; nil without a live session.
	FromRequest(r *http.Request) (*Member, error)
}

// PickupBranch is a branch a pickup order can be collected from
// (configuration.branches).
type PickupBranch struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Address *string `json:"address"`
	City    *string `json:"city"`
	Phone   *string `json:"phone"`
}

// Branches reads branches from the configuration context.
type Branches interface {
	// Public lists the active public branches by name.
	Public(ctx context.Context, q database.Querier) ([]PickupBranch, error)
	// Get is one branch by id, public or not; nil when missing.
	Get(ctx context.Context, q database.Querier, id string) (*PickupBranch, error)
}

// PromoContextType is promo_redemptions.context_type of a shop order.
const PromoContextType = "shop_order"

// PromoLine is one cart line the promo engine may target.
type PromoLine struct {
	ProductID string
	Amount    float64
}

// PromoCheck is a code to evaluate for one cart.
type PromoCheck struct {
	Code       string
	Subtotal   float64
	Phone      *string
	CustomerID *string
	Lines      []PromoLine
}

// PromoPreview is the result of a preview: the discount and campaign name,
// or the rejection reason (a promo domain RejectReason string).
type PromoPreview struct {
	OK       bool
	Discount float64
	Label    string
	Reason   string
}

// PromoRejectedError is a hold the promo engine refused; Reason is the
// promo domain RejectReason string.
type PromoRejectedError struct{ Reason string }

func (e *PromoRejectedError) Error() string { return "promo rejected: " + e.Reason }

// Promo is the promo-code service of the stored-value context. The shop
// evaluates codes on the "shop" channel, so campaigns scoped to every
// channel apply.
type Promo interface {
	// Preview validates a code without claiming it.
	Preview(ctx context.Context, q database.Querier, in PromoCheck) (PromoPreview, error)
	// Hold claims the code for the order inside the caller's transaction
	// and returns the discount and campaign name. A refusal is a
	// *PromoRejectedError.
	Hold(ctx context.Context, q database.Querier, in PromoCheck, orderID string) (discount float64, label string, err error)
	// Capture makes the order's held redemption final (idempotent).
	Capture(ctx context.Context, q database.Querier, orderID string) error
	// Release gives the order's redemption back (idempotent).
	Release(ctx context.Context, q database.Querier, orderID string) error
}

// ErrArkInsufficient is a payment the ARK Coin balance does not cover.
var ErrArkInsufficient = errors.New("insufficient ARK Coin balance")

// Wallet is the ARK Coin wallet of the stored-value context.
type Wallet interface {
	// Balance is the member's ARK Coin balance (0 when unknown).
	Balance(ctx context.Context, q database.Querier, customerID string) (float64, error)
	// Pay debits amount for the order on the caller's transaction;
	// ErrArkInsufficient when the balance does not cover it.
	Pay(ctx context.Context, q database.Querier, customerID string, amount float64, orderID, notes string) error
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
