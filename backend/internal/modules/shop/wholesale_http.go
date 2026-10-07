package shop

import (
	"errors"
	"net/http"
	"time"

	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Wholesale routes: /api/shop/wholesale/** for staff (IAM shop menus) and
// /api/wholesale/** for partners (nh_wholesale cookie session).

// wholesaleRoutes adds the wholesale routes; staff wraps a handler in the
// shop IAM guard.
func (h *handler) wholesaleRoutes(staff func(string, func(http.ResponseWriter, *http.Request, *auth.User) error) module.Route) []module.Route {
	partner := func(pattern string, fn func(w http.ResponseWriter, r *http.Request, acct WholesaleAccount) error) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			acct, err := h.svc.WholesaleSession(r.Context(), wholesaleToken(r))
			if err != nil {
				return err
			}
			if acct == nil {
				return httpx.Unauthorized("Unauthorized")
			}
			return fn(w, r, *acct)
		})}
	}
	return []module.Route{
		staff("GET /api/shop/wholesale/accounts", h.listWholesaleAccounts),
		staff("POST /api/shop/wholesale/accounts", h.createWholesaleAccount),
		staff("PATCH /api/shop/wholesale/accounts/{id}", h.updateWholesaleAccount),
		staff("GET /api/shop/wholesale/orders", h.listWholesaleOrdersAdmin),
		staff("GET /api/shop/wholesale/products", h.listWholesaleProducts),
		staff("PATCH /api/shop/wholesale/products/{id}", h.updateWholesaleProduct),

		{Pattern: "POST /api/wholesale/login", Handler: httpx.Handle(h.wholesaleLogin)},
		{Pattern: "POST /api/wholesale/logout", Handler: http.HandlerFunc(h.wholesaleLogout)},
		partner("GET /api/wholesale/me", h.wholesaleMe),
		partner("GET /api/wholesale/catalog", h.wholesaleCatalog),
		partner("POST /api/wholesale/orders", h.placeWholesaleOrder),
		partner("GET /api/wholesale/orders", h.listWholesaleOrders),
		partner("GET /api/wholesale/orders/{id}", h.wholesaleOrderDetail),
	}
}

/* ── staff ───────────────────────────────────────────────────────────── */

func (h *handler) listWholesaleAccounts(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	rows, err := h.svc.ListWholesaleAccounts(r.Context())
	if err != nil {
		return err
	}
	return ok(w, rows)
}

// accountWithPassword is an account plus the one-time password staff hand
// over; the password appears only in the response that created it.
type accountWithPassword struct {
	*WholesaleAccount
	Password string `json:"password,omitempty"`
}

// parseAccountInput reads the staff account form.
func parseAccountInput(raw any) (WholesaleAccountInput, bool, error) {
	f := validate.New(raw, true)
	nullish := validate.Rule{Optional: true, Nullable: true}
	var in WholesaleAccountInput
	in.ShopID = f.UUID("shop_id", nullish)
	company := f.Str("company_name", validate.Rule{}, validate.StrOpts{Trim: true, Min: 2, Max: 160})
	contact := f.Str("contact_name", validate.Rule{}, validate.StrOpts{Trim: true, Min: 2, Max: 120})
	email := f.Str("email", validate.Rule{}, validate.StrOpts{Trim: true, Max: 160, Check: emailCheck})
	in.Phone = f.Str("phone", nullish, validate.StrOpts{Trim: true, Max: 30})
	discount := f.Num("discount_pct", validate.Rule{HasDefault: true}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)})
	minOrder := f.Num("min_order_idr", validate.Rule{HasDefault: true}, validate.NumOpts{Min: validate.Bound(0)})
	terms := f.Enum("payment_terms", validate.Rule{HasDefault: true}, domain.PaymentTerms)
	status := f.Enum("status", validate.Rule{HasDefault: true}, []string{"active", "disabled"})
	reset := f.BoolDefault("reset_password", false)
	if !f.Valid() {
		return in, false, f.ErrAtPath("Data tidak valid")
	}
	in.CompanyName, in.ContactName, in.Email = *company, *contact, *email
	in.PaymentTerms, in.Status = "invoice", "active"
	if terms != nil {
		in.PaymentTerms = *terms
	}
	if status != nil {
		in.Status = *status
	}
	if discount != nil {
		in.DiscountPct = *discount
	}
	if minOrder != nil {
		in.MinOrderIDR = *minOrder
	}
	return in, reset, nil
}

func (h *handler) createWholesaleAccount(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	in, _, err := parseAccountInput(raw)
	if err != nil {
		return err
	}
	acct, password, err := h.svc.CreateWholesaleAccount(r.Context(), in)
	if err != nil {
		return err
	}
	return created(w, accountWithPassword{acct, password})
}

func (h *handler) updateWholesaleAccount(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id := r.PathValue("id")
	if !validate.IsUUID(id) {
		return httpx.NotFound("Akun tidak ditemukan")
	}
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	in, reset, err := parseAccountInput(raw)
	if err != nil {
		return err
	}
	acct, password, err := h.svc.UpdateWholesaleAccount(r.Context(), id, in, reset)
	if err != nil {
		return err
	}
	return ok(w, accountWithPassword{acct, password})
}

func (h *handler) listWholesaleOrdersAdmin(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	_, limitSent := q["limit"]
	rows, err := h.svc.ListWholesaleOrdersAdmin(r.Context(), domain.ParseOrderListFilter(q.Get("status"), q.Get("search"), q.Get("limit"), limitSent))
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) listWholesaleProducts(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	rows, err := h.svc.ListWholesaleProducts(r.Context())
	if err != nil {
		return err
	}
	return ok(w, rows)
}

// dateCheck is a YYYY-MM-DD calendar date.
func dateCheck(s string) (string, string, bool) {
	_, err := time.Parse("2006-01-02", s)
	return "invalid_format", "Invalid date", err == nil
}

func (h *handler) updateWholesaleProduct(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id := r.PathValue("id")
	if !validate.IsUUID(id) {
		return errUnknownProduct
	}
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	nullish := validate.Rule{Optional: true, Nullable: true}
	var in ProductSettingsInput
	in.PreorderUntil = f.Str("preorder_until", nullish, validate.StrOpts{Check: dateCheck})
	in.WholesalePriceIDR = f.Num("wholesale_price_idr", nullish, validate.NumOpts{Min: validate.Bound(0)})
	in.WholesaleMinQty = 1
	if n := f.Int("wholesale_min_qty", validate.Rule{HasDefault: true}, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(999)}); n != nil {
		in.WholesaleMinQty = *n
	}
	if !f.Valid() {
		return f.ErrAtPath("Data tidak valid")
	}
	row, err := h.svc.UpdateProductSettings(r.Context(), id, in)
	if err != nil {
		return err
	}
	return ok(w, row)
}

/* ── partner ─────────────────────────────────────────────────────────── */

func wholesaleCookie(r *http.Request, token string, now time.Time, ttl time.Duration) *http.Cookie {
	c := &http.Cookie{Name: domain.WholesaleSessionCookie, Value: token, Path: "/", HttpOnly: true,
		Secure: httpx.SecureRequest(r), SameSite: http.SameSiteLaxMode}
	if ttl <= 0 {
		c.MaxAge = -1
		return c
	}
	c.MaxAge, c.Expires = int(ttl/time.Second), now.Add(ttl)
	return c
}

func (h *handler) wholesaleLogin(w http.ResponseWriter, r *http.Request) error {
	raw, _ := validate.ReadBody(r)
	body, _ := raw.(map[string]any)
	token, acct, err := h.svc.WholesaleLogin(r.Context(), domain.ClientIP(r.Header), text(body["email"]), text(body["password"]))
	if err != nil {
		return err
	}
	http.SetCookie(w, wholesaleCookie(r, token, h.svc.now(), domain.WholesaleSessionTTL))
	return ok(w, acct)
}

// wholesaleLogout ends the session and clears the cookie, even on failure.
func (h *handler) wholesaleLogout(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.WholesaleLogout(r.Context(), wholesaleToken(r)); err != nil {
		h.svc.log.Error("[shop] wholesale logout failed", "error", err)
	}
	http.SetCookie(w, wholesaleCookie(r, "", h.svc.now(), 0))
	_ = httpx.JSON(w, http.StatusOK, struct {
		Success bool `json:"success"`
	}{true})
}

func (h *handler) wholesaleMe(w http.ResponseWriter, _ *http.Request, acct WholesaleAccount) error {
	return ok(w, acct)
}

func (h *handler) wholesaleCatalog(w http.ResponseWriter, r *http.Request, acct WholesaleAccount) error {
	ctx := r.Context()
	h.svc.releaseExpiredReservations(ctx)
	products, err := h.svc.WholesaleCatalog(ctx, acct)
	if err != nil {
		return err
	}
	return ok(w, products)
}

func (h *handler) placeWholesaleOrder(w http.ResponseWriter, r *http.Request, acct WholesaleAccount) error {
	if err := h.limit(r, "wholesale-order", 10); err != nil {
		return err
	}
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	in := WholesaleOrderInput{Items: cartItems(f, true), BaseURL: requestOrigin(r, h.svc.ports.AppOrigin)}
	address := f.Str("shipping_address", validate.Rule{}, validate.StrOpts{Trim: true, Min: 10, Max: 500})
	in.Notes = f.Str("notes", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Trim: true, Max: 500})
	if !f.Valid() {
		return httpx.BadRequest("Data pesanan tidak lengkap/valid")
	}
	in.Address = *address
	ctx := r.Context()
	h.svc.releaseExpiredReservations(ctx)
	res, err := h.svc.PlaceWholesaleOrder(ctx, acct, in)
	var cerr *checkoutError
	if errors.As(err, &cerr) {
		return httpx.Status(cerr.status, cerr.reason)
	}
	if err != nil {
		return err
	}
	return created(w, res)
}

func (h *handler) listWholesaleOrders(w http.ResponseWriter, r *http.Request, acct WholesaleAccount) error {
	rows, err := h.svc.ListWholesaleOrders(r.Context(), acct.ID)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) wholesaleOrderDetail(w http.ResponseWriter, r *http.Request, acct WholesaleAccount) error {
	id := r.PathValue("id")
	if err := assertOrderID(id); err != nil {
		return err
	}
	order, err := h.svc.WholesaleOrderDetail(r.Context(), acct.ID, id)
	if err != nil {
		return err
	}
	if order == nil {
		return httpx.NotFound(orderNotFound)
	}
	return ok(w, order)
}
