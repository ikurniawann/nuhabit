// Package offers ports pos/promo-check and pos/offer-rules, and declares
// the offer and promo-code Engine the POS order code runs inside its own
// transaction. Stored-value implements both (wired in internal/app).
package offers

import (
	"net/http"
	"regexp"

	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Handler serves the routes of this package.
type Handler struct {
	db      database.Querier
	auth    *auth.Service
	limiter *kit.RateLimiter
	backend Backend
	venues  Venues
}

// NewWithBackend builds the handler on the stored-value backend and a venue
// reader (CrmSettingsVenue until CRM exposes one).
func NewWithBackend(deps module.Deps, backend Backend, venues Venues) *Handler {
	return &Handler{
		db:      deps.DB,
		auth:    deps.Auth,
		limiter: kit.NewRateLimiter(deps.Now),
		backend: backend,
		venues:  venues,
	}
}

// Routes lists the routes.
func (h *Handler) Routes() []module.Route {
	return []module.Route{
		{Pattern: "POST /api/pos/promo-check", Handler: httpx.Handle(h.promoCheck)},
		{Pattern: "GET /api/pos/offer-rules", Handler: httpx.Handle(h.offerRules)},
	}
}

// venue is getCrmDefaultVenue with both ids set, ok=false otherwise.
func (h *Handler) venue(r *http.Request) (companyID, branchID string, ok bool) {
	v := h.venues.DefaultVenue(r.Context(), h.db)
	if v.CompanyID == nil || *v.CompanyID == "" || v.BranchID == nil || *v.BranchID == "" {
		return "", "", false
	}
	return *v.CompanyID, *v.BranchID, true
}

/* ── POST /api/pos/promo-check ───────────────────────────────────────── */

type offerCheck struct {
	OK        bool    `json:"ok"`
	Kind      string  `json:"kind"`
	RuleID    string  `json:"rule_id"`
	OfferName string  `json:"offer_name"`
	Discount  float64 `json:"discount"`
}

type promoAccepted struct {
	OK           bool    `json:"ok"`
	Discount     float64 `json:"discount"`
	CampaignName string  `json:"campaign_name"`
	DiscountType string  `json:"discount_type"`
	Kind         string  `json:"kind"`
}

type promoRejected struct {
	OK      bool   `json:"ok"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
	Kind    string `json:"kind"`
	Label   string `json:"label"`
}

// promoCheck validates a code for the cashier (channel pos). Indicative
// only: the order creation is the final word. The code is either an offer
// unlock code (kind "offer") or a promo campaign code (kind "promo").
func (h *Handler) promoCheck(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	if !h.limiter.Allow("pos-promo-check:"+user.ID, 30) {
		return httpx.TooManyRequests("Terlalu banyak percobaan — tunggu sebentar")
	}

	// parseJsonBody: a body that is not JSON is validated as {}.
	body, present := validate.ReadBody(r)
	if !present {
		body, present = map[string]any{}, true
	}
	f := validate.New(body, present)
	code := f.Str("code", validate.Rule{}, validate.StrOpts{Trim: true, Min: 3, Max: 40})
	subtotal := f.Num("subtotal", validate.Rule{}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1_000_000_000)})
	var lines []PromoLineInput
	f.List("items", validate.Rule{Optional: true}, 500, func(list *validate.Form, i int, v any) {
		it := list.Item(i, v)
		productID := it.UUID("product_id", validate.Rule{})
		amount := it.Num("amount", validate.Rule{}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1_000_000_000)})
		if productID != nil && amount != nil {
			lines = append(lines, PromoLineInput{ProductID: *productID, Amount: *amount})
		}
	})
	customerID := f.UUID("customer_id", validate.Rule{Optional: true, Nullable: true})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}

	companyID, branchID, ok := h.venue(r)
	if !ok {
		return httpx.BadRequest("Venue belum dikonfigurasi")
	}

	ctx := r.Context()
	offer, err := h.backend.FindByUnlockCode(ctx, h.db, companyID, branchID, *code)
	if err != nil {
		return err
	}
	if offer != nil {
		return httpx.Data(w, http.StatusOK, offerCheck{OK: true, Kind: "offer", RuleID: offer.ID, OfferName: offer.Name})
	}

	in := PreviewInput{CompanyID: companyID, BranchID: branchID, Code: *code, Channel: "pos", Subtotal: *subtotal, Lines: lines}
	if customerID != nil {
		in.CustomerID = *customerID
	}
	preview, err := h.backend.PreviewPromo(ctx, h.db, in)
	if err != nil {
		return err
	}
	if !preview.OK {
		return httpx.Data(w, http.StatusOK, promoRejected{
			Reason: preview.Reason, Message: preview.Message, Kind: "promo", Label: preview.Label,
		})
	}
	return httpx.Data(w, http.StatusOK, promoAccepted{
		OK: true, Discount: preview.Discount, CampaignName: preview.CampaignName, DiscountType: preview.DiscountType, Kind: "promo",
	})
}

/* ── GET /api/pos/offer-rules ────────────────────────────────────────── */

var anyUUID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type offerRuleItem struct {
	Role        string  `json:"role"`
	ProductID   string  `json:"product_id"`
	ProductName *string `json:"product_name"`
	Qty         float64 `json:"qty"`
}

type offerRule struct {
	ID            string          `json:"id"`
	OfferType     string          `json:"offer_type"`
	Name          string          `json:"name"`
	Description   *string         `json:"description"`
	ValidFrom     *string         `json:"valid_from"`
	ValidUntil    *string         `json:"valid_until"`
	BundlePrice   *float64        `json:"bundle_price"`
	BuyQty        *int            `json:"buy_qty"`
	GetQty        *int            `json:"get_qty"`
	GetMode       *string         `json:"get_mode"`
	VolumeBasis   *string         `json:"volume_basis"`
	VolumeMin     *float64        `json:"volume_min"`
	DiscountType  *string         `json:"discount_type"`
	DiscountValue *float64        `json:"discount_value"`
	RequiresCode  bool            `json:"requires_code"`
	IsExclusive   bool            `json:"is_exclusive"`
	Items         []offerRuleItem `json:"items"`
	Eval          any             `json:"eval,omitempty"`
}

// offerRules lists the active offers for the cashier banner and the client
// discount preview. `?customer_id=` fills the member usage so per-member
// caps match the server. Unlock codes are never sent.
func (h *Handler) offerRules(w http.ResponseWriter, r *http.Request) error {
	if _, err := kit.PosUser(h.auth, r); err != nil {
		return err
	}
	companyID, branchID, ok := h.venue(r)
	if !ok {
		return httpx.Data(w, http.StatusOK, []offerRule{})
	}
	customerID := r.URL.Query().Get("customer_id")
	if !anyUUID.MatchString(customerID) {
		customerID = ""
	}
	active, err := h.backend.ActiveRules(r.Context(), h.db, companyID, branchID, customerID)
	if err != nil {
		return err
	}
	data := make([]offerRule, len(active))
	for i, d := range active {
		items := make([]offerRuleItem, len(d.Items))
		for j, it := range d.Items {
			name := it.ProductName
			if name == nil {
				name = it.CategoryName
			}
			productID := ""
			if it.ProductID != nil {
				productID = *it.ProductID
			}
			qty := it.Qty
			if qty == 0 {
				qty = 1
			}
			items[j] = offerRuleItem{Role: it.Role, ProductID: productID, ProductName: name, Qty: qty}
		}
		data[i] = offerRule{
			ID: d.ID, OfferType: d.OfferType, Name: d.Name, Description: d.Description,
			ValidFrom: d.ValidFrom, ValidUntil: d.ValidUntil, BundlePrice: d.BundlePrice,
			BuyQty: d.BuyQty, GetQty: d.GetQty, GetMode: d.GetMode, VolumeBasis: d.VolumeBasis,
			VolumeMin: d.VolumeMin, DiscountType: d.DiscountType, DiscountValue: d.DiscountValue,
			RequiresCode: d.RequiresCode, IsExclusive: d.IsExclusive, Items: items, Eval: d.Eval,
		}
	}
	return httpx.Data(w, http.StatusOK, data)
}
