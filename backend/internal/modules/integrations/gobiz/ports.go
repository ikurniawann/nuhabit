package gobiz

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/integrations/gobiz/domain"
	"nuhabit/backend/internal/platform/database"
)

// Ports are what this package needs from other contexts. pos.gofood_events
// and pos.gofood_catalog_syncs belong to these routes and are queried
// directly; settings go through appsettings.
type Ports struct {
	Catalog Catalog
	Orders  Orders
	Venues  Venues
}

// Catalog reads the POS catalog and the GoFood channel prices (pos-ops).
type Catalog interface {
	// GofoodProducts is loadCatalogProductsForGobiz: active products sold on
	// GoFood (available or not), gift cards excluded, in menu order.
	GofoodProducts(ctx context.Context, q database.Querier) ([]domain.CatalogProduct, error)
	// ProductRefs is loadProductsByIds for webhook mapping, keyed by product
	// id; add-on prices are the POS price adjustments.
	ProductRefs(ctx context.Context, q database.Querier, ids []string) (map[string]domain.ProductRef, error)
	// ChannelRule is loadChannelRule(code); nil when the channel has no row.
	ChannelRule(ctx context.Context, q database.Querier, code string) (*domain.ChannelRule, error)
	// ChannelOverrides is loadChannelOverrides(code): product id → manual price.
	ChannelOverrides(ctx context.Context, q database.Querier, code string) (map[string]float64, error)
}

// Venue is the CRM default company and branch (getCrmDefaultVenue).
type Venue struct{ CompanyID, BranchID *string }

// Venues reads getCrmDefaultVenue; it never fails.
type Venues interface {
	DefaultVenue(ctx context.Context, q database.Querier) Venue
}

// OrderRow is the part of a pos.gofood_orders row the webhook reads back.
type OrderRow struct {
	ID              string
	GofoodOrderID   string
	GofoodOrderType string
	Status          string
	PosOrderID      *string
	CancelReason    *string
}

// ExistingOrder is a gofood_orders row found by its GoFood order number.
type ExistingOrder struct {
	ID     string
	Status string
	// HasItems is false while items is still the empty array.
	HasItems bool
}

// OrderWrite is the gofood_orders upsert of one event
// (upsertGofoodOrderFromEvent).
type OrderWrite struct {
	Status  string
	Summary domain.OrderSummary
	// Items and Unmapped are JSON arrays; nil on an update keeps the stored ones.
	Items, Unmapped []byte
	RawPayload      []byte
	// AwaitingSince and Venue are used on insert only.
	AwaitingSince *time.Time
	Venue         Venue
}

// Orders is pos-sales' side of a GoFood order: pos.gofood_orders and the
// linked pos_orders. They run on the caller's database because the webhook
// answer reports their result.
type Orders interface {
	ByGofoodID(ctx context.Context, q database.Querier, gofoodOrderID string) (*ExistingOrder, error)
	Insert(ctx context.Context, q database.Querier, w OrderWrite) (*OrderRow, error)
	Update(ctx context.Context, q database.Querier, id string, w OrderWrite) (*OrderRow, error)
	// ClaimAutoAccept moves awaiting_acceptance to accepted atomically, so a
	// duplicate event cannot accept twice; false when another claim won.
	ClaimAutoAccept(ctx context.Context, q database.Querier, id string) (bool, error)
	// ReleaseAutoAccept undoes the claim after GoBiz refused, keeping the error.
	ReleaseAutoAccept(ctx context.Context, q database.Querier, id, message string) error
	// EnsurePosOrder is ensurePosOrderForGofood on the current row.
	EnsurePosOrder(ctx context.Context, db database.DB, id string) error
	// SetPosOrderStatus cancels or completes the linked POS order unless it
	// is already final.
	SetPosOrderStatus(ctx context.Context, db database.DB, posOrderID, status, note string) error
}
