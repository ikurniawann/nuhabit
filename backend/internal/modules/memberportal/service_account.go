package memberportal

import (
	"context"
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/memberportal/domain"
)

// AccountRepository is the member's own profile, history and orders.
type AccountRepository interface {
	MeCustomer(ctx context.Context, customerID string) (*MeCustomer, error)
	ActiveTiers(ctx context.Context) ([]domain.Tier, error)
	CrmSetting(ctx context.Context, key string) (json.RawMessage, error)
	LoyaltyRates(ctx context.Context) (LoyaltyRates, error)
	UpdateProfile(ctx context.Context, customerID string, in ProfileUpdate) (*UpdatedProfile, error)
	MarkProfileCompleted(ctx context.Context, customerID string) error
	MarkFreeXPGranted(ctx context.Context, customerID string) error
	SetPhotoURL(ctx context.Context, customerID, url string) error
	VenueVisits(ctx context.Context, customerID string) ([]VenueVisit, error)
	VisitCount(ctx context.Context, customerID string) (int64, error)
	WalletHistory(ctx context.Context, customerID string) ([]WalletEntry, error)
	Orders(ctx context.Context, customerID string) ([]OrderSummary, error)
	MemberOrder(ctx context.Context, customerID, orderID string) (*OrderHeader, error)
	OrderItems(ctx context.Context, orderID string) ([]OrderItem, error)
	MemberShopOrder(ctx context.Context, customerID, orderID string) (*ShopOrder, error)
	ShopOrderItems(ctx context.Context, orderID string) ([]OrderItem, error)
	OrderXP(ctx context.Context, customerID, orderID string) (ledger, legacy float64, err error)
}

// ── GET /me ───────────────────────────────────────────────────────────────

type meProfile struct {
	ID string `json:"id"`
	domain.ProfileFields
}

type meTier struct {
	Code            string  `json:"code"`
	Name            string  `json:"name"`
	DiscountPercent float64 `json:"discount_percent"`
}

type meNextTier struct {
	Name          string  `json:"name"`
	MinLifetimeXP float64 `json:"min_lifetime_xp"`
	XPNeeded      float64 `json:"xp_needed"`
}

type meLadderTier struct {
	Code            string  `json:"code"`
	Name            string  `json:"name"`
	MinLifetimeXP   float64 `json:"min_lifetime_xp"`
	DiscountPercent float64 `json:"discount_percent"`
}

type meCompletion struct {
	domain.ProfileCompletion
	MissingLabels []string `json:"missing_labels"`
}

// MeView is the GET /me payload.
type MeView struct {
	Profile                meProfile      `json:"profile"`
	MemberType             string         `json:"member_type"`
	ArkCoinBalance         float64        `json:"ark_coin_balance"`
	ArkRate                float64        `json:"ark_rate"`
	LowBalanceThresholdIdr float64        `json:"low_balance_threshold_idr"`
	MarketingOptIn         bool           `json:"marketing_opt_in"`
	TotalXP                float64        `json:"total_xp"`
	VisitCount             int64          `json:"visit_count"`
	Tier                   *meTier        `json:"tier"`
	NextTier               *meNextTier    `json:"next_tier"`
	Tiers                  []meLadderTier `json:"tiers"`
	Completion             meCompletion   `json:"completion"`
	FreeXPGranted          bool           `json:"free_xp_granted"`
	FreeXPAmount           float64        `json:"free_xp_amount"`
	HasPassword            bool           `json:"has_password"`
}

// Me is the profile, balance, XP, tier progress and profile completion.
func (s *Service) Me(ctx context.Context, customerID string) (*MeView, error) {
	customer, err := s.repo.MeCustomer(ctx, customerID)
	if err != nil {
		return nil, err
	}
	tiers, err := s.repo.ActiveTiers(ctx)
	if err != nil {
		return nil, err
	}
	freeXP, err := s.repo.CrmSetting(ctx, "profile_completion_free_xp")
	if err != nil {
		return nil, err
	}
	rates, err := s.repo.LoyaltyRates(ctx)
	if err != nil {
		return nil, err
	}
	if customer == nil {
		return nil, fail(404, "Member tidak ditemukan")
	}
	optIn, err := s.repo.ReadMarketingConsent(ctx, customerID)
	if err != nil {
		return nil, err
	}

	completion := domain.ComputeProfileCompletion(customer.Fields)
	totalXP := deref(customer.TotalXP)
	view := &MeView{
		Profile:                meProfile{ID: customer.ID, ProfileFields: customer.Fields},
		MemberType:             customer.MemberType,
		ArkCoinBalance:         deref(customer.ArkCoinBalance),
		ArkRate:                orDefault(deref(rates.ArkRate), domain.DefaultArkRate),
		LowBalanceThresholdIdr: deref(rates.LowBalanceThresholdIdr),
		MarketingOptIn:         optIn,
		TotalXP:                totalXP,
		Tiers:                  []meLadderTier{},
		Completion:             meCompletion{ProfileCompletion: completion, MissingLabels: domain.MissingLabels(completion.Missing)},
		FreeXPGranted:          customer.FreeXPGrantedAt != nil && customer.FreeXPGrantedAt.Valid,
		FreeXPAmount:           jsNumber(freeXP),
		HasPassword:            customer.HasPassword,
	}
	if customer.VisitCount != nil {
		view.VisitCount = *customer.VisitCount
	}
	if t := domain.ResolveTierByXP(tiers, totalXP); t != nil {
		view.Tier = &meTier{Code: t.Code, Name: t.Name, DiscountPercent: t.DiscountPercent}
	}
	if t := domain.NextTier(tiers, totalXP); t != nil {
		view.NextTier = &meNextTier{Name: t.Name, MinLifetimeXP: t.MinLifetimeXP, XPNeeded: math.Max(0, t.MinLifetimeXP-totalXP)}
	}
	for _, t := range tiers {
		view.Tiers = append(view.Tiers, meLadderTier{Code: t.Code, Name: t.Name, MinLifetimeXP: t.MinLifetimeXP, DiscountPercent: t.DiscountPercent})
	}
	return view, nil
}

// ── PUT /profile ──────────────────────────────────────────────────────────

// ProfileSaved is the PUT /profile result.
type ProfileSaved struct {
	Completion     domain.ProfileCompletion `json:"completion"`
	FreeXPAwarded  float64                  `json:"free_xp_awarded"`
	SuccessMessage string                   `json:"-"`
}

// UpdateProfile saves the member's own fields. A 100% complete profile earns
// the Free XP once in a lifetime, idempotent on the column and the ledger.
// The phone number is the OTP identity and cannot change here.
func (s *Service) UpdateProfile(ctx context.Context, customerID string, in ProfileUpdate) (*ProfileSaved, error) {
	updated, err := s.repo.UpdateProfile(ctx, customerID, in)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, fail(404, "Member tidak ditemukan")
	}
	completion := domain.ComputeProfileCompletion(updated.Fields)

	var awarded float64
	if completion.Complete && (updated.ProfileCompletedAt == nil || !updated.ProfileCompletedAt.Valid) {
		if err := s.repo.MarkProfileCompleted(ctx, customerID); err != nil {
			return nil, err
		}
	}
	if completion.Complete && (updated.FreeXPGrantedAt == nil || !updated.FreeXPGrantedAt.Valid) {
		raw, err := s.repo.CrmSetting(ctx, "profile_completion_free_xp")
		if err != nil {
			return nil, err
		}
		if amount := jsNumber(raw); amount > 0 {
			venue := s.repo.DefaultVenue(ctx)
			result, err := s.loyalty.AwardFlatXP(ctx, XPAward{
				CustomerID:     customerID,
				XPAmount:       amount,
				CompanyID:      venue.CompanyID,
				BranchID:       venue.BranchID,
				SourceType:     "profile_completion",
				SourceID:       customerID,
				ReferenceTable: "pos_customers",
				IdempotencyKey: "portal:profile-complete:" + customerID,
				Description:    "Free XP profil lengkap (portal member)",
			})
			if err != nil {
				return nil, err
			}
			if result.Status == "posted" || result.Status == "duplicate" {
				if err := s.repo.MarkFreeXPGranted(ctx, customerID); err != nil {
					return nil, err
				}
				awarded = result.XPAwarded
			}
		}
	}
	msg := "Profil tersimpan"
	if awarded > 0 {
		msg = "Profil lengkap! Selamat, Anda mendapat " + jsNumberString(awarded) + " Free XP 🎉"
	}
	return &ProfileSaved{Completion: completion, FreeXPAwarded: awarded, SuccessMessage: msg}, nil
}

// ── Visits, history, order detail ─────────────────────────────────────────

// VisitsView is GET /visits.
type VisitsView struct {
	VisitCount int64        `json:"visit_count"`
	Venues     []VenueVisit `json:"venues"`
}

// Visits sums paid orders per venue.
func (s *Service) Visits(ctx context.Context, customerID string) (*VisitsView, error) {
	venues, err := s.repo.VenueVisits(ctx, customerID)
	if err != nil {
		return nil, err
	}
	n, err := s.repo.VisitCount(ctx, customerID)
	if err != nil {
		return nil, err
	}
	return &VisitsView{VisitCount: n, Venues: venues}, nil
}

// TransactionsView is GET /transactions.
type TransactionsView struct {
	Wallet []WalletEntry  `json:"wallet"`
	Orders []OrderSummary `json:"orders"`
}

// Transactions is the latest wallet entries, paid outlet orders and online
// shop orders.
func (s *Service) Transactions(ctx context.Context, customerID string) (*TransactionsView, error) {
	wallet, err := s.repo.WalletHistory(ctx, customerID)
	if err != nil {
		return nil, err
	}
	orders, err := s.repo.Orders(ctx, customerID)
	if err != nil {
		return nil, err
	}
	return &TransactionsView{Wallet: wallet, Orders: orders}, nil
}

type orderDetailHeader struct {
	ID             string  `json:"id"`
	OrderNumber    *string `json:"order_number"`
	OrderedAt      jsTime  `json:"ordered_at"`
	TotalAmount    float64 `json:"total_amount"`
	DiscountAmount float64 `json:"discount_amount"`
	DiscountReason *string `json:"discount_reason"`
	PaymentMethod  *string `json:"payment_method"`
	ArkCoinsUsed   float64 `json:"ark_coins_used"`
	VenueName      *string `json:"venue_name"`
	Subtotal       float64 `json:"subtotal"`
}

// OrderDetailView is GET /orders/{id}. Source tells an outlet receipt
// from an online shop order; Shop is set for the latter only.
type OrderDetailView struct {
	Source   string            `json:"source"`
	Order    orderDetailHeader `json:"order"`
	Items    []OrderItem       `json:"items"`
	XPEarned float64           `json:"xp_earned"`
	ArkRate  float64           `json:"ark_rate"`
	Shop     *shopOrderDetail  `json:"shop"`
}

// shopOrderDetail is what an online shop order adds to the receipt.
type shopOrderDetail struct {
	Status       string       `json:"status"`
	PaidAt       jsTime       `json:"paid_at"`
	ShippingCost float64      `json:"shipping_cost"`
	Delivery     shopDelivery `json:"delivery"`
	// InvoiceURL is the payment link while the order is pending, else nil.
	InvoiceURL *string `json:"invoice_url"`
	// StatusURL is the buyer's public status page (tracking and reviews).
	StatusURL string `json:"status_url"`
}

// shopDelivery is a shipped order's destination and courier, or a pickup
// order's branch.
type shopDelivery struct {
	Method    string      `json:"method"`
	Address   string      `json:"address"`
	AreaLabel *string     `json:"area_label"`
	Courier   *string     `json:"courier"`
	EtaText   *string     `json:"eta_text"`
	Waybill   *string     `json:"waybill"`
	Branch    *shopBranch `json:"branch"`
	ReadyAt   jsTime      `json:"ready_at"`
}

type shopBranch struct {
	Name    string  `json:"name"`
	Address *string `json:"address"`
	Phone   *string `json:"phone"`
}

var errOrderNotFound = fail(404, "Order tidak ditemukan")

// OrderDetail is one of the member's orders: an outlet (POS) order, else
// an online shop order. Someone else's order behaves exactly like a
// missing one (404), without confirming the id exists.
func (s *Service) OrderDetail(ctx context.Context, customerID, orderID string) (*OrderDetailView, error) {
	if !isLooseUUID(orderID) {
		return nil, errOrderNotFound
	}
	order, err := s.repo.MemberOrder(ctx, customerID, orderID)
	if err != nil {
		return nil, err
	}
	rates, err := s.repo.LoyaltyRates(ctx)
	if err != nil {
		return nil, err
	}
	if order == nil {
		return s.shopOrderDetail(ctx, customerID, orderID, deref(rates.ArkRate))
	}
	items, err := s.repo.OrderItems(ctx, orderID)
	if err != nil {
		return nil, err
	}
	ledger, legacy, err := s.repo.OrderXP(ctx, customerID, orderID)
	if err != nil {
		return nil, err
	}
	var subtotal float64
	for _, it := range items {
		subtotal += deref(it.UnitPrice) * deref(it.Quantity)
	}
	xp := legacy
	if ledger > 0 {
		xp = ledger
	}
	return &OrderDetailView{
		Source: OrderSourcePOS,
		Order: orderDetailHeader{
			ID: order.ID, OrderNumber: order.OrderNumber, OrderedAt: order.OrderedAt,
			TotalAmount: deref(order.TotalAmount), DiscountAmount: deref(order.DiscountAmount),
			DiscountReason: order.DiscountReason, PaymentMethod: order.PaymentMethod,
			ArkCoinsUsed: deref(order.ArkCoinsUsed), VenueName: order.VenueName, Subtotal: subtotal,
		},
		Items:    nonNil(items),
		XPEarned: xp,
		ArkRate:  deref(rates.ArkRate),
	}, nil
}

// shopOrderDetail is OrderDetail for an online shop order. The promo code
// is the discount reason and the storefront the venue; shop orders earn
// no XP.
func (s *Service) shopOrderDetail(ctx context.Context, customerID, orderID string, arkRate float64) (*OrderDetailView, error) {
	o, err := s.repo.MemberShopOrder(ctx, customerID, orderID)
	if err != nil {
		return nil, err
	}
	if o == nil {
		return nil, errOrderNotFound
	}
	items, err := s.repo.ShopOrderItems(ctx, orderID)
	if err != nil {
		return nil, err
	}
	shop := &shopOrderDetail{
		Status: o.Status, PaidAt: o.PaidAt, ShippingCost: o.ShippingCost,
		Delivery: shopDelivery{Method: o.DeliveryMethod, Address: o.Address, AreaLabel: o.AreaLabel,
			Courier: courierLabel(o.CourierCode, o.CourierService), EtaText: o.EtaText, Waybill: o.Waybill, ReadyAt: o.ReadyAt},
		StatusURL: "/shop/order/" + o.AccessToken,
	}
	if o.Status == "pending" {
		shop.InvoiceURL = o.InvoiceURL
	}
	if o.BranchName != nil {
		shop.Delivery.Branch = &shopBranch{Name: *o.BranchName, Address: o.BranchAddress, Phone: o.BranchPhone}
	}
	payment := o.PaymentMethod
	return &OrderDetailView{
		Source: OrderSourceShop,
		Order: orderDetailHeader{
			ID: o.ID, OrderNumber: &o.OrderNumber, OrderedAt: o.CreatedAt, TotalAmount: o.Total,
			DiscountAmount: o.DiscountAmount, DiscountReason: o.PromoCode, PaymentMethod: &payment,
			VenueName: o.StorefrontName, Subtotal: o.Subtotal,
		},
		Items:   nonNil(items),
		ArkRate: arkRate,
		Shop:    shop,
	}, nil
}

// courierLabel is "JNE REG" from the codes jne and reg, nil without a
// courier (pickup).
func courierLabel(code, service *string) *string {
	var parts []string
	for _, p := range []*string{code, service} {
		if p != nil && *p != "" {
			parts = append(parts, strings.ToUpper(*p))
		}
	}
	if len(parts) == 0 {
		return nil
	}
	label := strings.Join(parts, " ")
	return &label
}

// ── helpers ───────────────────────────────────────────────────────────────

// jsNumber is Number(value) || 0 for a jsonb value.
func jsNumber(raw json.RawMessage) float64 {
	if len(raw) == 0 {
		return 0
	}
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return 0
	}
	var n float64
	switch x := v.(type) {
	case float64:
		n = x
	case bool:
		if x {
			n = 1
		}
	case string:
		t := strings.TrimSpace(x)
		if t == "" {
			return 0
		}
		f, err := strconv.ParseFloat(t, 64)
		if err != nil {
			return 0
		}
		n = f
	}
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return 0
	}
	return n
}

// jsNumberString is String(n) for a finite JS number.
func jsNumberString(n float64) string { return strconv.FormatFloat(n, 'f', -1, 64) }

func orDefault(v, fallback float64) float64 {
	if v == 0 || math.IsNaN(v) {
		return fallback
	}
	return v
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
