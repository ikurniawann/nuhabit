package offers

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// Offer rules and promo codes belong to the stored-value context
// (lib/promo/offer-pos.ts, offer-rules-server.ts, promo-server.ts).
// internal/app adapts its promo service to these interfaces. Every method
// runs on the caller's Querier, so the sale flow claims offers and codes
// inside its own transaction.

// Engine is what the sale flow calls when it creates, settles and voids
// orders.
type Engine interface {
	// EvaluateForPosCart is evaluateActiveOffersForPosCart: the active
	// offers applied to a cashier cart. code is what the cashier typed
	// ("" = none); a matching unlock code activates its offer and fills
	// UnlockedRuleID. A nil or empty venue evaluates nothing.
	EvaluateForPosCart(ctx context.Context, q database.Querier, companyID, branchID *string, items []CartLine, code, customerID string) (CartEvaluation, error)
	// RecordUsage is recordOfferUsage, idempotent per (rule, order). With
	// Enforce a reached cap is *CapReachedError.
	RecordUsage(ctx context.Context, q database.Querier, in UsageInput) error
	// CaptureUsage is captureOfferUsage: held becomes captured. Idempotent.
	CaptureUsage(ctx context.Context, q database.Querier, orderID string) error
	// ReleaseUsage is releaseOfferUsage: a voided order gives the quota back. Idempotent.
	ReleaseUsage(ctx context.Context, q database.Querier, orderID string) error
	// HoldPromo is holdPromoRedemption. A failing code is *PromoRejectedError.
	HoldPromo(ctx context.Context, q database.Querier, in HoldInput) (*PromoHold, error)
	// CapturePromo is capturePromoRedemption. Idempotent.
	CapturePromo(ctx context.Context, q database.Querier, contextType, contextID string) error
	// ReleasePromo is releasePromoRedemption: the code gets its use back. Idempotent.
	ReleasePromo(ctx context.Context, q database.Querier, contextType, contextID string) error
}

// Backend adds the reads of the promo-check and offer-rules routes.
type Backend interface {
	Engine
	// FindByUnlockCode is findOfferByUnlockCode: the active offer opened by
	// code (trimmed, case-insensitive), nil when none.
	FindByUnlockCode(ctx context.Context, q database.Querier, companyID, branchID, code string) (*UnlockedOffer, error)
	// PreviewPromo is previewPromoCode: read-only and indicative. An
	// unknown code answers like an inactive one.
	PreviewPromo(ctx context.Context, q database.Querier, in PreviewInput) (PromoPreview, error)
	// ActiveRules is loadActiveOfferEvalRules for today; customerID "" =
	// no member.
	ActiveRules(ctx context.Context, q database.Querier, companyID, branchID, customerID string) ([]ActiveRule, error)
}

/* ── offers ──────────────────────────────────────────────────────────── */

// CartLine is OfferCartLine: one cashier cart line.
type CartLine struct {
	ProductID string
	Quantity  float64
	UnitPrice float64
}

// FreeUnit is one BXGY unit given away (the FREE line in the cart UI).
type FreeUnit struct {
	ProductID string  `json:"productId"`
	Qty       float64 `json:"qty"`
	UnitPrice float64 `json:"unitPrice"`
}

// AppliedOffer is one offer applied to the cart.
type AppliedOffer struct {
	RuleID    string     `json:"rule_id"`
	OfferType string     `json:"offer_type"`
	Name      string     `json:"name"`
	Discount  float64    `json:"discount"`
	FreeUnits []FreeUnit `json:"free_units"`
}

// CartEvaluation is the result of evaluateActiveOffersForPosCart.
type CartEvaluation struct {
	OfferDiscount float64        `json:"offer_discount"`
	Applied       []AppliedOffer `json:"applied"`
	// UnlockedRuleID is set when the typed code opened an offer; the caller
	// then no longer treats the code as a promo campaign code.
	UnlockedRuleID *string `json:"unlocked_rule_id"`
}

// UnlockedOffer is the offer an unlock code opens.
type UnlockedOffer struct {
	ID   string
	Name string
}

// RuleItem is one target of an active rule with its catalog names.
type RuleItem struct {
	Role         string
	ProductID    *string
	Qty          float64
	ProductName  *string
	CategoryName *string
}

// ActiveRule is an active offer rule as the cashier banner shows it.
type ActiveRule struct {
	ID            string
	OfferType     string
	Name          string
	Description   *string
	ValidFrom     *string // YYYY-MM-DD
	ValidUntil    *string
	BundlePrice   *float64
	BuyQty        *int
	GetQty        *int
	GetMode       *string
	VolumeBasis   *string
	VolumeMin     *float64
	DiscountType  *string
	DiscountValue *float64
	RequiresCode  bool
	IsExclusive   bool
	Items         []RuleItem
	// Eval is the evaluator view of the rule (toOfferEvalRules with
	// category targets expanded), sent as is in the `eval` field; nil = none.
	Eval any
}

// UsageInput is the input of recordOfferUsage.
type UsageInput struct {
	CompanyID  *string
	BranchID   *string
	OrderID    string
	CustomerID string // "" = no member
	Applied    []AppliedOffer
	Status     string // "held" | "captured"
	// Enforce locks each rule, recounts live usage and rejects a reached cap.
	// Without it (open bills whose lines are already saved) usage is only recorded.
	Enforce bool
}

// CapReachedError is OfferCapReachedError (the order routes answer 422).
type CapReachedError struct{ OfferName string }

func (e *CapReachedError) Error() string {
	return `Kuota penawaran "` + e.OfferName + `" sudah habis — muat ulang keranjang`
}

/* ── promo codes ─────────────────────────────────────────────────────── */

// ContextPosOrder is the promo_redemptions.context_type of a POS order.
const ContextPosOrder = "pos_order"

// PromoLineInput is one cart line from the caller; its category is reloaded
// from the catalog.
type PromoLineInput struct {
	ProductID string
	Amount    float64
}

// PreviewInput is the input of previewPromoCode.
type PreviewInput struct {
	CompanyID, BranchID string
	Code                string
	Channel             string
	Subtotal            float64
	CustomerID          string // "" = no member
	// Lines nil = not sent (the TS `lines` undefined).
	Lines []PromoLineInput
}

// PromoPreview is PromoPreview: Discount, CampaignName and DiscountType when
// OK; otherwise Reason with its Message and cashier Label.
type PromoPreview struct {
	OK           bool
	Discount     float64
	CampaignName string
	DiscountType string
	Reason       string
	Message      string
	Label        string
}

// HoldInput is the input of holdPromoRedemption.
type HoldInput struct {
	CompanyID, BranchID string
	Code                string
	Channel             string
	ContextType         string
	ContextID           string
	Subtotal            float64
	CustomerID          string // "" = no member
	Lines               []PromoLineInput
}

// PromoHold is a held redemption.
type PromoHold struct {
	RedemptionID string
	CodeID       string
	CampaignName string
	Discount     float64
}

// PromoRejectedError is PromoRejectedError (the order routes answer 422
// with Error()).
type PromoRejectedError struct {
	Reason  string
	Message string
}

func (e *PromoRejectedError) Error() string { return e.Message }
