package tableorder

import (
	"context"

	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/modules/possales/tableorder/domain"
	"nuhabit/backend/internal/platform/database"
)

// Ports are the cross-context ports internal/app wires. Every nil field gets
// the stopgap adapter of this package (adapters_*.go), except Loyalty, whose
// nil fallback is a no-op meant for tests only: production must wire the
// CRM adapter or self-orders paid with ARK Coin earn no XP.
type Ports struct {
	Loyalty ports.Loyalty
	// Wallet debits ARK Coin (ports.Wallet satisfies it).
	Wallet ArkWallet
	// Directory gives the default venue (ports.Directory satisfies it).
	Directory VenueDirectory
	Catalog   Catalog
	Settings  Settings
	CRM       CRM
	Alerts    Alerts
	Xendit    *Xendit
}

// ArkWallet is the part of ports.Wallet self-order uses.
type ArkWallet interface {
	Move(ctx context.Context, q database.Querier, m ports.ArkMove) (*float64, error)
}

// VenueDirectory is the part of ports.Directory self-order uses.
type VenueDirectory interface {
	// Venue is getCrmDefaultVenue ("" when unset or unreadable).
	Venue(ctx context.Context, q database.Querier) (companyID, branchID string)
}

// CatalogProduct is a catalog row plus whether self-order may sell it.
type CatalogProduct struct {
	Row      domain.ProductRow
	Sellable bool
}

// CatalogMeta is the menu diagnosis of loadCatalogMeta.
type CatalogMeta struct {
	TotalProducts     int `json:"total_products"`
	SellableProducts  int `json:"sellable_products"`
	HiddenUnavailable int `json:"hidden_unavailable"`
}

// Table is TableInfo (pos.pos_tables).
type Table struct {
	ID          string
	TableNumber *string
	QRCode      *string
	Name        *string
	Area        *string
	Status      *string
	IsActive    *bool
}

// Catalog reads what pos-ops owns: products, tables, the billing profile and
// the ARK rate (lib/table-order/server.ts, billing-settings-server.ts,
// loyalty-settings.ts).
type Catalog interface {
	// SellableProducts is loadSellableCatalog's rows (active, available,
	// sold on self_order, name ILIKE %search%), in menu order.
	SellableProducts(ctx context.Context, q database.Querier, search string) ([]domain.ProductRow, error)
	Meta(ctx context.Context, q database.Querier) (CatalogMeta, error)
	// ProductsByIDs is loadProductsByIds (inactive products included).
	ProductsByIDs(ctx context.Context, q database.Querier, ids []string) ([]CatalogProduct, error)
	// TableByCode is loadTableByCode (nil when unknown).
	TableByCode(ctx context.Context, q database.Querier, code string) (*Table, error)
	// BillingProfile is resolveBillingProfile({branchId}): its name and charges.
	BillingProfile(ctx context.Context, q database.Querier, branchID string) (string, []domain.Charge, error)
	// ArkRate is loadPosLoyaltySettings().ark_rate.
	ArkRate(ctx context.Context, q database.Querier) (float64, error)
}

// StaticQris is StaticQrisConfig.
type StaticQris struct {
	ImageURL  string
	Available bool
}

// XenditConfig is XenditGatewayConfig.
type XenditConfig struct {
	SecretKey   string
	CallbackURL string
}

// Settings reads configuration.* (no wave owns it): brand, static QRIS and
// the Xendit gateway row.
type Settings interface {
	// BrandName is resolveBrandName(companyID).
	BrandName(ctx context.Context, q database.Querier, companyID string) (string, error)
	StaticQris(ctx context.Context, q database.Querier) (StaticQris, error)
	// XenditConfig is loadActiveXenditConfig, with its error messages.
	XenditConfig(ctx context.Context, q database.Querier) (*XenditConfig, error)
}

// CRM is what self-order reads from CRM beyond ports.Loyalty.
type CRM interface {
	// MemberDiscountPercent is loadMemberDiscountPercent
	// (lib/member-portal/tier.ts): 0 on any failure.
	MemberDiscountPercent(ctx context.Context, q database.Querier, customerID string) float64
	// XPEnabled is getLoyaltyFeatures().xp (true when unreadable).
	XPEnabled(ctx context.Context, q database.Querier) bool
}

// Alerts is fireOrderAlert (lib/notifications/order-alert-server.ts): fire
// and forget, never fails the order.
type Alerts interface {
	OrderAlert(in domain.OrderAlert)
}
