// Package promo is the promo part of the stored-value context: campaigns,
// codes and offer rules (lib/promo), plus the checkout-facing promo code
// preview, hold, capture and release and the offer engine calls that POS
// sales runs inside its own transaction.
package promo

import (
	"context"
	"log/slog"
	"time"

	"nuhabit/backend/internal/modules/storedvalue/promo/domain"
	"nuhabit/backend/internal/platform/database"
)

// CatalogProduct is an active POS product for the target picker.
type CatalogProduct struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Price      string  `json:"price"`
	CategoryID *string `json:"category_id"`
}

// CatalogCategory is an active POS category.
type CatalogCategory struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Catalog is the promo catalog response (loadPromoCatalog).
type Catalog struct {
	Products   []CatalogProduct  `json:"products"`
	Categories []CatalogCategory `json:"categories"`
}

// POSCatalog reads the POS catalog (pos.pos_products, pos.pos_categories),
// owned by pos-ops. Every call runs on the caller's Querier.
type POSCatalog interface {
	// Active lists active products by name and active categories by
	// display order then name.
	Active(ctx context.Context, q database.Querier) (Catalog, error)
	// ProductCategories maps each existing product id to its category.
	ProductCategories(ctx context.Context, q database.Querier, productIDs []string) (map[string]*string, error)
	// CategoryProducts lists every product id of each category, in table
	// order (loadCategoryProductMap has no ORDER BY).
	CategoryProducts(ctx context.Context, q database.Querier, categoryIDs []string) (map[string][]string, error)
	// Names returns product and category names by id.
	Names(ctx context.Context, q database.Querier, productIDs, categoryIDs []string) (products, categories map[string]string, err error)
}

// MemberHistory reads the order history of a member (pos.pos_customers,
// pos.pos_orders) for the new-member promo rule.
type MemberHistory interface {
	// PromoContext is nil when the customer does not exist.
	PromoContext(ctx context.Context, q database.Querier, customerID string) (*domain.MemberContext, error)
}

// Ports are the promo adapters internal/app wires.
type Ports struct {
	Catalog POSCatalog
	Members MemberHistory
}

// Service is the promo service.
type Service struct {
	db    database.DB
	ports Ports
	now   func() time.Time
}

// NewService builds the promo service (the logger is unused: every failure
// is returned to the caller).
func NewService(db database.DB, ports Ports, now func() time.Time, _ *slog.Logger) *Service {
	return &Service{db: db, ports: ports, now: now}
}

var jakarta = mustJakarta()

func mustJakarta() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}

// TodayJakarta is today's date in Asia/Jakarta as YYYY-MM-DD
// (todayJakartaIso).
func (s *Service) TodayJakarta() string { return s.now().In(jakarta).Format(time.DateOnly) }

// venue is the company + branch the promo data is scoped to.
type venue struct{ companyID, branchID string }
