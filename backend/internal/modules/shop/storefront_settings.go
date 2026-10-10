package shop

import (
	"context"
	"slices"

	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/database"
)

// Storefront settings (pickup, free shipping, low stock, WhatsApp, the
// promo banner), the pickup branches a storefront offers, the signed-in
// buyer's prefill and the promo code preview.

// StorefrontConfig reads the storefront's settings and banner, the
// defaults without a row.
func (s *Service) StorefrontConfig(ctx context.Context, storefrontID string) (domain.StorefrontConfig, error) {
	v := domain.StorefrontConfig{StorefrontSettings: domain.DefaultStorefrontSettings()}
	var headline *string
	var banner domain.StorefrontBanner
	err := s.db.QueryRow(ctx, `SELECT pickup_enabled, free_shipping_threshold::float8, low_stock_threshold, whatsapp_number,
		  banner_headline, banner_text, banner_code
		FROM shop.storefront_settings WHERE storefront_id = $1::uuid`, storefrontID).
		Scan(&v.PickupEnabled, &v.FreeShippingThreshold, &v.LowStockThreshold, &v.WhatsappNumber, &headline, &banner.Text, &banner.Code)
	if database.IsNoRows(err) {
		return v, nil
	}
	if headline != nil {
		banner.Headline = *headline
		v.Banner = &banner
	}
	return v, err
}

// StorefrontSettings is the public part of the storefront's config.
func (s *Service) StorefrontSettings(ctx context.Context, storefrontID string) (domain.StorefrontSettings, error) {
	cfg, err := s.StorefrontConfig(ctx, storefrontID)
	return cfg.StorefrontSettings, err
}

// SaveStorefrontConfig upserts the storefront's settings row.
func (s *Service) SaveStorefrontConfig(ctx context.Context, storefrontID string, in domain.StorefrontConfig, userID string) (domain.StorefrontConfig, error) {
	var headline, text, code *string
	if in.Banner != nil {
		headline, text, code = &in.Banner.Headline, orNil(in.Banner.Text), orNil(in.Banner.Code)
	}
	_, err := s.db.Exec(ctx, `INSERT INTO shop.storefront_settings
		  (storefront_id, pickup_enabled, free_shipping_threshold, low_stock_threshold, whatsapp_number,
		   banner_headline, banner_text, banner_code, updated_by)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid)
		ON CONFLICT (storefront_id) DO UPDATE SET
		  pickup_enabled = EXCLUDED.pickup_enabled, free_shipping_threshold = EXCLUDED.free_shipping_threshold,
		  low_stock_threshold = EXCLUDED.low_stock_threshold, whatsapp_number = EXCLUDED.whatsapp_number,
		  banner_headline = EXCLUDED.banner_headline, banner_text = EXCLUDED.banner_text, banner_code = EXCLUDED.banner_code,
		  updated_by = EXCLUDED.updated_by, updated_at = now()`,
		storefrontID, in.PickupEnabled, in.FreeShippingThreshold, in.LowStockThreshold, orNil(in.WhatsappNumber),
		headline, text, code, userID)
	if err != nil {
		return domain.StorefrontConfig{}, err
	}
	return s.StorefrontConfig(ctx, storefrontID)
}

// PickupBranches lists the public branches a storefront's orders can be
// collected from: every public branch, or those among the storefront's
// venues. Empty when pickup is off.
func (s *Service) PickupBranches(ctx context.Context, sf Storefront, settings domain.StorefrontSettings) ([]PickupBranch, error) {
	out := []PickupBranch{}
	if !settings.PickupEnabled {
		return out, nil
	}
	branches, err := s.ports.Branches.Public(ctx, s.db)
	if err != nil {
		return nil, err
	}
	for _, b := range branches {
		if sf.VenueIDs == nil || slices.Contains(sf.VenueIDs, b.ID) {
			out = append(out, b)
		}
	}
	return out, nil
}

// LastAddress is the destination of the member's latest shipped order.
type LastAddress struct {
	Address    string  `json:"address"`
	AreaID     *string `json:"areaId"`
	AreaLabel  *string `json:"areaLabel"`
	PostalCode *string `json:"postalCode"`
}

// MemberView is GET /api/public/shop/{slug}/me: the checkout prefill.
type MemberView struct {
	Name        *string      `json:"name"`
	Phone       string       `json:"phone"`
	Email       *string      `json:"email"`
	ArkBalance  float64      `json:"arkBalance"`
	LastAddress *LastAddress `json:"lastAddress"`
}

// MemberView builds the prefill of a signed-in buyer.
func (s *Service) MemberView(ctx context.Context, m Member) (*MemberView, error) {
	balance, err := s.ports.Wallet.Balance(ctx, s.db, m.ID)
	if err != nil {
		return nil, err
	}
	v := &MemberView{Name: m.Name, Phone: m.Phone, Email: m.Email, ArkBalance: balance}
	var last LastAddress
	err = s.db.QueryRow(ctx, `SELECT shipping_address, shipping_area_id, shipping_area_label, shipping_postal_code
		FROM shop.orders WHERE customer_id = $1::uuid AND delivery_method = 'ship'
		ORDER BY created_at DESC LIMIT 1`, m.ID).Scan(&last.Address, &last.AreaID, &last.AreaLabel, &last.PostalCode)
	if err == nil {
		v.LastAddress = &last
	} else if !database.IsNoRows(err) {
		return nil, err
	}
	return v, nil
}

// PromoPreviewView is POST /api/public/shop/{slug}/promo/preview.
type PromoPreviewView struct {
	Code           string  `json:"code"`
	DiscountAmount float64 `json:"discountAmount"`
	Label          string  `json:"label"`
}

// PreviewPromo prices the cart from the catalog and asks the promo engine
// about the code. A refusal is a 422 *checkoutError.
func (s *Service) PreviewPromo(ctx context.Context, code string, items []CartItem, member *Member) (*PromoPreviewView, error) {
	lines, reason, err := s.resolveLines(ctx, items)
	if err != nil {
		return nil, err
	}
	if reason != "" {
		return nil, &checkoutError{400, reason}
	}
	d := orderDraft{lines: lines, promoCode: &code, member: member}
	if member != nil {
		d.customerPhone = member.Phone
	}
	p, err := s.ports.Promo.Preview(ctx, s.db, d.promoCheck())
	if err != nil {
		return nil, err
	}
	if !p.OK {
		return nil, &checkoutError{422, domain.PromoMessage(p.Reason)}
	}
	return &PromoPreviewView{Code: code, DiscountAmount: p.Discount, Label: p.Label}, nil
}
