package giftcards

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/storedvalue/giftcards/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

type handler struct {
	k   *kit.Kit
	svc *Service
}

// Routes lists the gift card routes (every one an apiHandler route).
func Routes(k *kit.Kit, svc *Service) []module.Route {
	h := &handler{k: k, svc: svc}
	return []module.Route{
		{Pattern: "POST /api/pos/gift-card-check", Handler: kit.API(h.posCheck)},
		{Pattern: "POST /api/pos/gift-card-reload", Handler: kit.API(h.posReload)},
		{Pattern: "GET /api/promo/gift-cards", Handler: kit.API(h.list)},
		{Pattern: "POST /api/promo/gift-cards", Handler: kit.API(h.issue)},
		{Pattern: "GET /api/promo/gift-cards/member-lookup", Handler: kit.API(h.memberLookup)},
		{Pattern: "PATCH /api/promo/gift-cards/{id}", Handler: kit.API(h.patch)},
		{Pattern: "POST /api/promo/gift-cards/{id}/adjust", Handler: kit.API(h.adjust)},
		{Pattern: "GET /api/promo/gift-cards/{id}/ledger", Handler: kit.API(h.ledger)},
		{Pattern: "POST /api/promo/gift-cards/{id}/reload", Handler: kit.API(h.reload)},
		{Pattern: "GET /api/promo/gift-card-config", Handler: kit.API(h.getConfig)},
		{Pattern: "PUT /api/promo/gift-card-config", Handler: kit.API(h.putConfig)},
	}
}

/* ── POS (cashier session) ───────────────────────────────────────────── */

const invalidCodeFormat = "Format kode gift card tidak valid"

// posCheck is POST /api/pos/gift-card-check: an indicative balance check,
// rate limited per cashier because a code is money to whoever holds it.
func (h *handler) posCheck(w http.ResponseWriter, r *http.Request) error {
	u, err := h.k.PosUser(r)
	if err != nil {
		return err
	}
	if err := h.k.EnforceRateLimit(r.Context(), "pos-gift-card-check:"+u.ID, 20); err != nil {
		return err
	}
	f := posForm(r)
	code := f.Str("code", validate.Rule{}, validate.StrOpts{Trim: true, Min: 3, Max: 40})
	total := f.Num("total", validate.Rule{}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1_000_000_000)})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	normalized := domain.NormalizeCode(*code)
	if !domain.IsValidCodeFormat(normalized) {
		return httpx.BadRequest(invalidCodeFormat)
	}
	company, branch, err := h.k.RequireDefaultVenue(r.Context())
	if err != nil {
		return err
	}
	preview, reason, err := h.svc.Preview(r.Context(), Scope{CompanyID: company, BranchID: branch}, normalized, *total)
	if err != nil {
		return err
	}
	if reason != "" {
		h.k.Log.WarnContext(r.Context(), "[pos] gift card check rejected", "user", u.ID, "reason", reason)
	}
	return kit.OK(w, http.StatusOK, preview)
}

// posReload is POST /api/pos/gift-card-reload: top up a typed or scanned
// code, the payment recorded on the ledger.
func (h *handler) posReload(w http.ResponseWriter, r *http.Request) error {
	u, err := h.k.PosUser(r)
	if err != nil {
		return err
	}
	if err := h.k.EnforceRateLimit(r.Context(), "pos-gift-card-reload:"+u.ID, 20); err != nil {
		return err
	}
	f := posForm(r)
	in := reloadFields(f)
	code := f.Str("code", validate.Rule{}, validate.StrOpts{Trim: true, Min: 3, Max: 40})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	in.Code = strings.ToUpper(*code)
	if !domain.IsValidCodeFormat(in.Code) {
		return httpx.BadRequest(invalidCodeFormat)
	}
	company, branch, err := h.k.RequireDefaultVenue(r.Context())
	if err != nil {
		return err
	}
	in.Scope, in.CreatedBy = Scope{CompanyID: company, BranchID: branch}, u.ID
	res, err := h.svc.Reload(r.Context(), in)
	if err != nil {
		var e *httpx.Error
		if errors.As(err, &e) {
			h.k.Log.WarnContext(r.Context(), "[pos] gift card reload rejected", "user", u.ID, "reason", e.Message)
		}
		return err
	}
	return kit.OK(w, http.StatusOK, res)
}

/* ── promo back office ───────────────────────────────────────────────── */

func (h *handler) promo(r *http.Request) (*kit.PromoContext, Scope, error) {
	pc, err := h.k.PromoContext(r)
	if err != nil {
		return nil, Scope{}, err
	}
	return pc, Scope{CompanyID: pc.CompanyID, BranchID: pc.BranchID}, nil
}

// list is GET /api/promo/gift-cards.
func (h *handler) list(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.promo(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	f := ListFilters{Status: q.Get("status"), Q: validate.JSTrim(q.Get("q")), CustomerID: q.Get("customer_id"), Phone: q.Get("phone")}
	if f.CustomerID != "" && !validate.IsUUID(f.CustomerID) {
		return httpx.BadRequest("customer_id tidak valid")
	}
	rows, err := h.svc.List(r.Context(), scope, f)
	if err != nil {
		return err
	}
	return kit.OK(w, http.StatusOK, rows)
}

// issue is POST /api/promo/gift-cards: one card or a batch, codes always
// generated (the admin never types one).
func (h *handler) issue(w http.ResponseWriter, r *http.Request) error {
	pc, scope, err := h.promo(r)
	if err != nil {
		return err
	}
	f, err := promoForm(r)
	if err != nil {
		return err
	}
	in, single := issueFields(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	cards, err := h.svc.Issue(r.Context(), scope, pc.UserID, in)
	if err != nil {
		return err
	}
	if single {
		return kit.OKMessage(w, http.StatusOK, cards[0], "Gift card diterbitkan")
	}
	codes := make([]string, len(cards))
	for i, c := range cards {
		codes[i] = c.Code
	}
	return kit.OKMessage(w, http.StatusOK, struct {
		Count int      `json:"count"`
		Codes []string `json:"codes"`
	}{len(cards), codes}, strconv.Itoa(len(cards))+" gift card diterbitkan")
}

// memberLookup is GET /api/promo/gift-cards/member-lookup.
func (h *handler) memberLookup(w http.ResponseWriter, r *http.Request) error {
	if _, _, err := h.promo(r); err != nil {
		return err
	}
	rows, err := h.svc.FindMembersByPhone(r.Context(), r.URL.Query().Get("phone"))
	if err != nil {
		return err
	}
	return kit.OK(w, http.StatusOK, rows)
}

// patch is PATCH /api/promo/gift-cards/{id}: toggle active, or link or
// unlink a member, one action per request.
func (h *handler) patch(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.promo(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	raw, err := promoBody(r)
	if err != nil {
		return err
	}
	// z.union of two strict objects: exactly {is_active: boolean} or
	// exactly {customer_id: uuid | null}. zod reports any miss as one
	// invalid_union issue at the root.
	body, _ := raw.(map[string]any)
	active, isToggle := body["is_active"].(bool)
	customer, hasCustomer := body["customer_id"]
	customerID, isUUID := customer.(string)
	isLink := hasCustomer && (customer == nil || (isUUID && validate.IsUUID(customerID)))
	if len(body) != 1 || !(isToggle || isLink) {
		return httpx.BadRequest("Validation failed", []validate.Issue{{Code: "invalid_union", Path: []any{}, Message: "Invalid input"}})
	}
	if isToggle {
		res, err := h.svc.SetActive(r.Context(), scope, id, active)
		if err != nil {
			return err
		}
		return kit.OKMessage(w, http.StatusOK, res, "Gift card diperbarui")
	}
	link := kit.NullIfEmpty(customerID)
	linked, err := h.svc.Link(r.Context(), scope, id, link)
	if err != nil {
		return err
	}
	if !linked {
		return httpx.NotFound("Gift card atau member tidak ditemukan")
	}
	msg := "Tautan member dilepas"
	if link != nil {
		msg = "Gift card ditautkan ke member"
	}
	return kit.OKMessage(w, http.StatusOK, struct {
		ID         string  `json:"id"`
		CustomerID *string `json:"customer_id"`
	}{id, link}, msg)
}

// adjust is POST /api/promo/gift-cards/{id}/adjust: an audited correction
// with a mandatory reason.
func (h *handler) adjust(w http.ResponseWriter, r *http.Request) error {
	pc, scope, err := h.promo(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	f, err := promoForm(r)
	if err != nil {
		return err
	}
	before := len(f.Issues())
	delta := f.Num("delta", validate.Rule{}, validate.NumOpts{})
	if delta != nil && len(f.Issues()) == before {
		switch {
		case *delta == 0:
			f.Fail("delta", "custom", "Nominal koreksi tidak boleh 0")
		case math.Abs(*delta) > 100_000_000:
			f.Fail("delta", "custom", "Nominal koreksi terlalu besar")
		}
	}
	reason := f.Str("reason", validate.Rule{}, validate.StrOpts{Trim: true, Min: 5, Max: 300})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	res, err := h.svc.Adjust(r.Context(), scope, id, *delta, *reason, pc.UserID)
	if err != nil {
		return err
	}
	h.k.Log.WarnContext(r.Context(), "[giftcard] koreksi saldo", "card", id, "delta", *delta, "by", pc.UserID)
	return kit.OKMessage(w, http.StatusOK, res, "Saldo gift card dikoreksi")
}

// ledger is GET /api/promo/gift-cards/{id}/ledger.
func (h *handler) ledger(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.promo(r)
	if err != nil {
		return err
	}
	rows, err := h.svc.Ledger(r.Context(), scope, r.PathValue("id"))
	if err != nil {
		return err
	}
	return kit.OK(w, http.StatusOK, rows)
}

// reload is POST /api/promo/gift-cards/{id}/reload.
func (h *handler) reload(w http.ResponseWriter, r *http.Request) error {
	pc, scope, err := h.promo(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	f, err := promoForm(r)
	if err != nil {
		return err
	}
	in := reloadFields(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	in.Scope, in.ID, in.CreatedBy = scope, id, pc.UserID
	res, err := h.svc.Reload(r.Context(), in)
	if err != nil {
		return err
	}
	return kit.OKMessage(w, http.StatusOK, res, "Saldo gift card bertambah")
}

// getConfig is GET /api/promo/gift-card-config.
func (h *handler) getConfig(w http.ResponseWriter, r *http.Request) error {
	if _, _, err := h.promo(r); err != nil {
		return err
	}
	cfg, err := h.svc.LoadConfig(r.Context(), h.svc.db)
	if err != nil {
		return err
	}
	return kit.OK(w, http.StatusOK, cfg)
}

// putConfig is PUT /api/promo/gift-card-config.
func (h *handler) putConfig(w http.ResponseWriter, r *http.Request) error {
	if _, _, err := h.promo(r); err != nil {
		return err
	}
	f, err := promoForm(r)
	if err != nil {
		return err
	}
	var patch ConfigPatch
	items := f.List("presets", validate.Rule{Optional: true}, 12, func(sub *validate.Form, i int, v any) {
		x, _ := sub.CheckNumber(i, v, validate.NumOpts{Integer: true, Positive: true, Max: validate.Bound(domain.MaxValue)})
		patch.Presets = append(patch.Presets, x)
	})
	if items != nil && len(items) == 0 {
		f.Fail("presets", "too_small", "Too small: expected array to have >=1 items")
	}
	patch.AllowCustom = f.Bool("allow_custom", validate.Rule{Optional: true})
	_, patch.SetExpiry = f.Fields()["expiry_months"]
	patch.ExpiryMonths = f.Int("expiry_months", validate.Rule{Optional: true, Nullable: true},
		validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(120)})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	cfg, err := h.svc.SaveConfig(r.Context(), patch)
	if err != nil {
		return err
	}
	return kit.OKMessage(w, http.StatusOK, cfg, "Konfigurasi gift card tersimpan")
}

/* ── request bodies ──────────────────────────────────────────────────── */

// posForm is parseJsonBody's input: a malformed body validates as {}.
func posForm(r *http.Request) *validate.Form {
	v, ok := validate.ReadBody(r)
	if !ok {
		v = map[string]any{}
	}
	return validate.New(v, true)
}

// errMalformedBody is `await request.json()` throwing inside validateBody:
// apiHandler answers it with a 500.
var errMalformedBody = errors.New("request body is not valid JSON")

// promoBody is `await request.json()` in validateBody.
func promoBody(r *http.Request) (any, error) {
	v, ok := validate.ReadBody(r)
	if !ok {
		return nil, errMalformedBody
	}
	return v, nil
}

// promoForm is validateBody's input.
func promoForm(r *http.Request) (*validate.Form, error) {
	v, err := promoBody(r)
	if err != nil {
		return nil, err
	}
	return validate.New(v, true), nil
}

// reloadFields reads giftCardReloadSchema.
func reloadFields(f *validate.Form) ReloadInput {
	var in ReloadInput
	if amount := f.Num("amount", validate.Rule{}, validate.NumOpts{Integer: true, Positive: true, Max: validate.Bound(domain.MaxValue)}); amount != nil {
		in.Amount = *amount
	}
	if method := f.Enum("payment_method", validate.Rule{}, domain.ReloadPaymentMethods); method != nil {
		in.PaymentMethod = *method
	}
	in.PaymentReference = f.Str("payment_reference", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Trim: true, Max: 80})
	in.Note = f.Str("note", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Trim: true, Max: 300})
	return in
}

// issueFields reads giftCardIssueSchema, a union discriminated by "mode".
func issueFields(f *validate.Form) (in IssueRequest, single bool) {
	if f.Fields() == nil {
		return in, false
	}
	mode, _ := f.Fields()["mode"].(string)
	if mode != "single" && mode != "batch" {
		f.Fail("mode", "invalid_union", "Invalid discriminator value. Expected 'single' | 'batch'")
		return in, false
	}
	opt := validate.Rule{Optional: true, Nullable: true}
	if v := f.Num("initial_value", validate.Rule{}, validate.NumOpts{Positive: true, Max: validate.Bound(domain.MaxValue)}); v != nil {
		in.InitialValue = *v
	}
	in.Count = 1
	if mode == "batch" {
		if n := f.Int("count", validate.Rule{}, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(500)}); n != nil {
			in.Count = *n
		}
	}
	in.ExpiresAt = f.Str("expires_at", opt, validate.StrOpts{Trim: true, Min: 1})
	if mode == "single" {
		in.BuyerName = f.Str("buyer_name", opt, validate.StrOpts{Trim: true, Max: 120})
		in.BuyerPhone = f.Str("buyer_phone", opt, validate.StrOpts{Trim: true, Max: 25})
		in.Note = f.Str("note", opt, validate.StrOpts{Trim: true, Max: 500})
		in.CustomerID = f.UUID("customer_id", opt)
	}
	return in, mode == "single"
}
