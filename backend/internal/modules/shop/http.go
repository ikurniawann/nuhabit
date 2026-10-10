package shop

import (
	"context"
	"errors"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Guard is the slice of platform/auth the handlers use.
type Guard interface {
	RequireMenuPrefix(r *http.Request, prefixes ...string) (*auth.User, error)
}

// storefrontSettingsMenu is the IAM menu of the storefront settings form.
const storefrontSettingsMenu = "shop.settings"

type handler struct {
	svc   *Service
	guard Guard
}

// Routes lists every /api/shop, /api/public/shop and /api/wholesale route.
//
// GET /api/public/shop/{slug}/catalog and GET /api/public/shop/order/{token}
// overlap in ServeMux (/api/public/shop/order/catalog matches both), so one
// dispatcher serves both, with the static "order" segment winning as in the
// Next app router.
func (h *handler) Routes() []module.Route {
	staff := func(pattern string, fn func(w http.ResponseWriter, r *http.Request, u *auth.User) error) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			u, err := h.guard.RequireMenuPrefix(r, iam.Shop...)
			if err != nil {
				return err
			}
			return fn(w, r, u)
		})}
	}
	pos := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			if err := h.requirePosSession(r); err != nil {
				return err
			}
			return fn(w, r)
		})}
	}
	public := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	// The storefront settings form has its own IAM menu under shop.
	settings := func(pattern string, fn func(w http.ResponseWriter, r *http.Request, u *auth.User) error) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			u, err := h.guard.RequireMenuPrefix(r, storefrontSettingsMenu)
			if err != nil {
				return err
			}
			return fn(w, r, u)
		})}
	}
	routes := []module.Route{
		staff("GET /api/shop/orders", h.listOrders),
		staff("GET /api/shop/orders/{id}", h.orderDetail),
		staff("PATCH /api/shop/orders/{id}", h.transitionOrder),
		staff("POST /api/shop/orders/{id}/shipment", h.createShipment),
		settings("GET /api/shop/storefront-settings", h.getStorefrontSettings),
		settings("PUT /api/shop/storefront-settings", h.putStorefrontSettings),

		staff("GET /api/shop/marketplace/accounts", h.listAccounts),
		staff("PATCH /api/shop/marketplace/accounts", h.updateAccount),
		staff("GET /api/shop/marketplace/links", h.listLinks),
		staff("POST /api/shop/marketplace/links", h.createLink),
		staff("DELETE /api/shop/marketplace/links", h.deleteLink),
		staff("GET /api/shop/marketplace/listings", h.listings),
		staff("GET /api/shop/marketplace/connect", h.connect),
		module.Route{Pattern: "GET /api/shop/marketplace/callback", Handler: httpx.Handle(h.callback)},
		module.Route{Pattern: "POST /api/shop/marketplace/sync", Handler: httpx.Handle(h.sync)},

		staff("GET /api/shop/shipping/settings", h.getShippingSettings),
		staff("PATCH /api/shop/shipping/settings", h.updateShippingSettings),
		pos("POST /api/shop/shipping/rates", h.adminRates),
		pos("GET /api/shop/shipping/track", h.track),
		pos("GET /api/shop/shipping/areas", h.adminAreas),

		public("GET /api/public/shop/{a}/{b}", h.publicGet),
		public("POST /api/public/shop/{slug}/checkout", h.checkout),
		public("POST /api/public/shop/{slug}/promo/preview", h.promoPreview),
		public("GET /api/public/shop/{slug}/shipping/areas", h.publicAreas),
		public("POST /api/public/shop/{slug}/shipping/rates", h.publicRates),
		{Pattern: "POST /api/public/shop/webhook/biteship", Handler: http.HandlerFunc(h.biteshipWebhook)},
		{Pattern: "POST /api/public/shop/webhook/xendit", Handler: http.HandlerFunc(h.xenditWebhook)},
	}
	return append(routes, h.wholesaleRoutes(staff)...)
}

// requirePosSession is `if (!(await getPosSession())) throw unauthorized`:
// no session and no POS menu grant are both a 401.
func (h *handler) requirePosSession(r *http.Request) error {
	_, err := h.guard.RequireMenuPrefix(r, iam.Pos...)
	var e *httpx.Error
	if errors.As(err, &e) && (e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden) {
		return httpx.Unauthorized("")
	}
	return err
}

// errBodyNotJSON is what request.json() throws on a missing or malformed
// body; apiHandler turns it into a 500.
var errBodyNotJSON = errors.New("shop: request body is not valid JSON")

// readJSON is `await request.json()`.
func readJSON(r *http.Request) (any, error) {
	body, ok := validate.ReadBody(r)
	if !ok {
		return nil, errBodyNotJSON
	}
	return body, nil
}

// requestOrigin is appOrigin(request): the configured origin, else the
// public origin the proxy forwarded.
func requestOrigin(r *http.Request, configured string) string {
	if configured != "" {
		return configured
	}
	return forwardedOrigin(r)
}

// forwardedOrigin is request.nextUrl.origin behind the Next proxy.
func forwardedOrigin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if p := strings.TrimSpace(strings.Split(r.Header.Get("x-forwarded-proto"), ",")[0]); p != "" {
		scheme = p
	}
	host := strings.TrimSpace(strings.Split(r.Header.Get("x-forwarded-host"), ",")[0])
	if host == "" {
		host = r.Host
	}
	return strings.TrimRight(scheme+"://"+host, "/")
}

func ok(w http.ResponseWriter, data any) error { return httpx.Data(w, http.StatusOK, data) }

func created(w http.ResponseWriter, data any) error { return httpx.Data(w, http.StatusCreated, data) }

/* ── orders ──────────────────────────────────────────────────────────── */

func (h *handler) listOrders(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	_, limitSent := q["limit"]
	rows, err := h.svc.ListOrders(r.Context(), domain.ParseOrderListFilter(q.Get("status"), q.Get("search"), q.Get("limit"), limitSent))
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) orderDetail(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id := r.PathValue("id")
	if err := assertOrderID(id); err != nil {
		return err
	}
	order, err := h.svc.OrderDetail(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, order)
}

func (h *handler) transitionOrder(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id := r.PathValue("id")
	if err := assertOrderID(id); err != nil {
		return err
	}
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	body, isObject := raw.(map[string]any)
	if !isObject && raw == nil {
		return errors.New("shop: body is null") // body.status on null throws
	}
	next := domain.JSTrim(text(body["status"]))
	var note *string
	switch v := body["note"].(type) {
	case nil:
	case string:
		if t := domain.JSTrim(v); t != "" {
			note = &t
		}
	default:
		return errors.New("shop: note is not a string") // body.note.trim() throws
	}
	updated, err := h.svc.TransitionOrder(r.Context(), id, next, note)
	if err != nil {
		return err
	}
	return ok(w, updated)
}

func (h *handler) createShipment(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id := r.PathValue("id")
	if err := assertOrderID(id); err != nil {
		return err
	}
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	var body ShipmentBody
	if mode := f.Enum("mode", validate.Rule{}, []string{"provider", "manual"}); mode != nil {
		body.Mode = *mode
	}
	if body.Mode == "manual" {
		if s := f.Str("waybill", validate.Rule{}, validate.StrOpts{Trim: true, Min: 6, Max: 60}); s != nil {
			body.Waybill = *s
		}
		body.CourierCode = f.Str("courier_code", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 30})
	}
	if !f.Valid() {
		return httpx.BadRequest("Payload tidak valid")
	}
	res, err := h.svc.CreateShipment(r.Context(), id, body, u.ID)
	if err != nil {
		return err
	}
	return created(w, res)
}

/* ── marketplace ─────────────────────────────────────────────────────── */

func (h *handler) listAccounts(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	rows, err := h.svc.ListAccounts(r.Context())
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) updateAccount(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	id := f.UUID("id", validate.Rule{})
	buffer := f.Int("stock_buffer", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(10000)})
	status := f.Enum("status", validate.Rule{Optional: true}, []string{"disconnected"})
	if !f.Valid() {
		return httpx.BadRequest("Payload tidak valid")
	}
	row, err := h.svc.UpdateAccount(r.Context(), *id, buffer, status)
	if err != nil {
		return err
	}
	return ok(w, row)
}

func (h *handler) listLinks(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	accountID, err := requireUUID(r.URL.Query().Get("account_id"), "account_id")
	if err != nil {
		return err
	}
	rows, err := h.svc.ListLinks(r.Context(), accountID)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) createLink(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	nullish := validate.Rule{Optional: true, Nullable: true}
	accountID := f.UUID("account_id", validate.Rule{})
	productID := f.UUID("product_id", validate.Rule{})
	in := LinkInput{SkuID: f.UUID("sku_id", nullish)}
	itemID := f.Str("marketplace_item_id", validate.Rule{}, validate.StrOpts{Min: 1})
	in.ModelID = f.Str("marketplace_model_id", nullish, validate.StrOpts{})
	in.ItemName = f.Str("marketplace_item_name", nullish, validate.StrOpts{})
	if !f.Valid() {
		return httpx.BadRequest("Payload tidak valid")
	}
	in.AccountID, in.ProductID, in.ItemID = *accountID, *productID, *itemID
	row, err := h.svc.CreateLink(r.Context(), in)
	if err != nil {
		return err
	}
	return created(w, row)
}

func (h *handler) deleteLink(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.URL.Query().Get("id"), "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteLink(r.Context(), id); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Success bool `json:"success"`
	}{true})
}

func (h *handler) listings(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	accountID, err := requireUUID(r.URL.Query().Get("account_id"), "account_id")
	if err != nil {
		return err
	}
	listings, err := h.svc.Listings(r.Context(), accountID)
	if err != nil {
		return err
	}
	return ok(w, listings)
}

func (h *handler) connect(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	authURL, err := h.svc.AuthURL(requestOrigin(r, h.svc.ports.AppOrigin))
	if err != nil {
		return err
	}
	return ok(w, struct {
		AuthURL string `json:"auth_url"`
	}{authURL})
}

const marketplaceDashboard = "/dashboard/shop/marketplace"

// callback is the redirect back from Shopee (?code&shop_id). It needs the
// admin session; after that every failure redirects to the dashboard.
func (h *handler) callback(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.Shop...); err != nil {
		return err
	}
	redirect := func(query string) error {
		http.Redirect(w, r, forwardedOrigin(r)+marketplaceDashboard+"?"+query, http.StatusTemporaryRedirect)
		return nil
	}
	q := r.URL.Query()
	code, shopID := domain.JSTrim(q.Get("code")), domain.JSTrim(q.Get("shop_id"))
	if code == "" || shopID == "" {
		return redirect("error=callback-kosong")
	}
	if err := h.svc.ConnectShopee(r.Context(), code, shopID); err != nil {
		h.svc.log.Error("[marketplace] callback error", "error", err)
		msg := "Gagal menghubungkan toko"
		var e *httpx.Error
		if errors.As(err, &e) {
			msg = e.Message
		}
		return redirect("error=" + encodeURIComponent(msg))
	}
	return redirect("connected=" + shopID)
}

// encodeURIComponent escapes everything except A-Z a-z 0-9 - _ . ! ~ * ' ( ).
func encodeURIComponent(s string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || strings.IndexByte("-_.!~*'()", c) >= 0 {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hex[c>>4])
		b.WriteByte(hex[c&15])
	}
	return b.String()
}

// sync is the manual sync; an external cron may call it with
// x-sync-token = MARKETPLACE_SYNC_TOKEN instead of an admin session.
func (h *handler) sync(w http.ResponseWriter, r *http.Request) error {
	if !domain.SafeEqual(r.Header.Get("x-sync-token"), h.svc.ports.Getenv("MARKETPLACE_SYNC_TOKEN")) {
		if _, err := h.guard.RequireMenuPrefix(r, iam.Shop...); err != nil {
			return err
		}
	}
	raw, _ := validate.ReadBody(r) // request.json().catch(() => ({}))
	accountID, err := requireUUID(text(field(raw, "account_id")), "account_id")
	if err != nil {
		return err
	}
	res, err := h.svc.Sync(r.Context(), accountID)
	if err != nil {
		return err
	}
	return ok(w, res)
}

/* ── storefront settings (admin) ─────────────────────────────────────── */

// defaultStorefront is the storefront the settings form edits.
func (h *handler) defaultStorefront(r *http.Request) (*Storefront, error) {
	sf, err := h.svc.ResolveStorefront(r.Context(), DefaultStorefrontSlug)
	if err == nil && sf == nil {
		return nil, httpx.NotFound("No active storefront")
	}
	return sf, err
}

func (h *handler) getStorefrontSettings(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	sf, err := h.defaultStorefront(r)
	if err != nil {
		return err
	}
	settings, err := h.svc.StorefrontSettings(r.Context(), sf.ID)
	if err != nil {
		return err
	}
	return ok(w, settings)
}

func (h *handler) putStorefrontSettings(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	sf, err := h.defaultStorefront(r)
	if err != nil {
		return err
	}
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	nullish := validate.Rule{Optional: true, Nullable: true}
	in := domain.DefaultStorefrontSettings()
	in.PickupEnabled = f.BoolDefault("pickupEnabled", in.PickupEnabled)
	in.FreeShippingThreshold = f.Num("freeShippingThreshold", nullish, validate.NumOpts{Min: validate.Bound(0)})
	if n := f.Int("lowStockThreshold", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1000)}); n != nil {
		in.LowStockThreshold = *n
	}
	in.WhatsappNumber = f.Str("whatsappNumber", nullish, validate.StrOpts{Trim: true, Max: 30, Check: phoneCheck})
	if !f.Valid() {
		return httpx.BadRequest("Invalid settings")
	}
	settings, err := h.svc.SaveStorefrontSettings(r.Context(), sf.ID, in, u.ID)
	if err != nil {
		return err
	}
	return ok(w, settings)
}

// phoneCheck accepts an empty value (cleared) or 8 to 15 digits with the
// usual separators.
func phoneCheck(s string) (string, string, bool) {
	n := len(domain.PhoneDigits(s))
	return "invalid_format", "Invalid phone number", s == "" || (n >= 8 && n <= 15 && len(s) <= 30)
}

/* ── shipping (admin) ────────────────────────────────────────────────── */

func (h *handler) getShippingSettings(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	settings, err := h.svc.ShippingSettings(r.Context())
	if err != nil {
		return err
	}
	return ok(w, settings)
}

func (h *handler) updateShippingSettings(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	if raw == nil {
		return errors.New("shop: body is null") // body.provider on null throws
	}
	body, _ := raw.(map[string]any)
	fields, msg := domain.BuildShippingSettingsPatch(body)
	if msg != "" {
		return httpx.BadRequest(msg)
	}
	settings, err := h.svc.UpdateShippingSettings(r.Context(), fields, u.ID)
	if err != nil {
		return err
	}
	return ok(w, settings)
}

type ratesMeta struct {
	Provider string  `json:"provider"`
	Markup   float64 `json:"markup"`
}

func (h *handler) adminRates(w http.ResponseWriter, r *http.Request) error {
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	if raw == nil {
		return errors.New("shop: body is null")
	}
	destID := domain.JSTrim(text(field(raw, "destination_id")))
	weight := domain.JSValueNumber(field(raw, "weight_gram"))
	if destID == "" {
		return httpx.BadRequest("Tujuan wajib dipilih")
	}
	if math.IsNaN(weight) || math.IsInf(weight, 0) || weight <= 0 {
		return httpx.BadRequest("Berat (gram) wajib angka > 0 — isi berat produk di master")
	}
	ctx := r.Context()
	sc, err := h.svc.loadShippingContext(ctx)
	if err != nil {
		return err
	}
	if sc.originID == "" {
		return httpx.BadRequest("Alamat origin toko belum diatur di Settings → Pengiriman")
	}
	var postal *string
	if v, ok := field(raw, "destination_postal_code").(string); ok {
		postal = &v
	}
	quotes, err := h.svc.quoteFromOrigin(ctx, sc, destID, postal, weight, domain.OrFinite(domain.JSValueNumber(field(raw, "item_value"))))
	if err != nil {
		return err
	}
	priced := domain.WithMarkup(quotes, sc.markup)
	for i := range priced {
		priced[i].Markup = &sc.markup
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Success bool                 `json:"success"`
		Data    []domain.PricedQuote `json:"data"`
		Meta    ratesMeta            `json:"meta"`
	}{true, priced, ratesMeta{sc.provider.name(), sc.markup}})
}

func (h *handler) track(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	waybill, courier := domain.JSTrim(q.Get("waybill")), strings.ToLower(domain.JSTrim(q.Get("courier")))
	if waybill == "" || courier == "" {
		return httpx.BadRequest("Parameter waybill dan courier wajib diisi")
	}
	res, err := h.svc.Track(r.Context(), waybill, courier)
	if err != nil {
		return err
	}
	return ok(w, res)
}

func (h *handler) adminAreas(w http.ResponseWriter, r *http.Request) error {
	query := domain.JSTrim(r.URL.Query().Get("q"))
	if validate.UTF16Len(query) < 3 {
		return ok(w, []AreaSuggestion{})
	}
	areas, provider, err := h.svc.SearchAreas(r.Context(), query)
	if err != nil {
		return err
	}
	type meta struct {
		Provider string `json:"provider"`
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Success bool             `json:"success"`
		Data    []AreaSuggestion `json:"data"`
		Meta    meta             `json:"meta"`
	}{true, areas, meta{provider}})
}

/* ── public storefront ───────────────────────────────────────────────── */

// limit is checkRateLimit(`${bucket}:${ip}`, { limit, windowMs: 60_000 })
// answered with the storefront's 429 body.
func (h *handler) limit(r *http.Request, bucket string, limit int) error {
	allowed, _, err := h.svc.limits.Sliding(r.Context(), bucket+":"+domain.ClientIP(r.Header), limit, time.Minute, h.svc.now())
	if err != nil {
		return err
	}
	if !allowed {
		return httpx.Status(http.StatusTooManyRequests, "Too many requests")
	}
	return nil
}

func (h *handler) storefront(r *http.Request) (*Storefront, error) {
	sf, err := h.svc.ResolveStorefront(r.Context(), r.PathValue("slug"))
	if err == nil && sf == nil {
		return nil, httpx.NotFound("Store not found")
	}
	return sf, err
}

// Messages for the public storefront and the partner portal, in English;
// staff routes keep orderNotFound.
const (
	publicOrderNotFound   = "Order not found"
	publicCartInvalid     = "Invalid cart"
	publicOriginNotSet    = "The store has not set a shipping origin yet"
	publicCourierGone     = "That courier service is no longer available. Pick a shipping rate again."
	publicCheckoutInvalid = "Checkout data is incomplete or invalid"
)

// publicGet dispatches GET /api/public/shop/order/{token},
// GET /api/public/shop/{slug}/catalog and GET /api/public/shop/{slug}/me.
func (h *handler) publicGet(w http.ResponseWriter, r *http.Request) error {
	a, b := r.PathValue("a"), r.PathValue("b")
	switch {
	case a == "order":
		return h.orderStatus(w, r, b)
	case b == "catalog":
		r.SetPathValue("slug", a)
		return h.catalog(w, r)
	case b == "me":
		r.SetPathValue("slug", a)
		return h.me(w, r)
	}
	http.NotFound(w, r)
	return nil
}

// catalog is GET /api/public/shop/{slug}/catalog: the storefront with its
// settings and pickup branches, the collections and the products.
func (h *handler) catalog(w http.ResponseWriter, r *http.Request) error {
	if err := h.limit(r, "shop-catalog", 60); err != nil {
		return err
	}
	sf, err := h.storefront(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	h.svc.releaseExpiredReservations(ctx)
	catalog, err := h.svc.BuildCatalog(ctx)
	if err != nil {
		return err
	}
	settings, err := h.svc.StorefrontSettings(ctx, sf.ID)
	if err != nil {
		return err
	}
	branches, err := h.svc.PickupBranches(ctx, *sf, settings)
	if err != nil {
		return err
	}
	type storefrontView struct {
		Slug           string                    `json:"slug"`
		Name           string                    `json:"name"`
		Description    *string                   `json:"description"`
		Settings       domain.StorefrontSettings `json:"settings"`
		PickupBranches []PickupBranch            `json:"pickupBranches"`
	}
	return ok(w, struct {
		Storefront  storefrontView       `json:"storefront"`
		Collections []CatalogCollection  `json:"collections"`
		Products    []CatalogProductView `json:"products"`
	}{storefrontView{sf.Slug, sf.Name, sf.Description, settings, branches}, catalog.Collections, catalog.Products})
}

// me is GET /api/public/shop/{slug}/me: the signed-in member's checkout
// prefill, data null for a guest.
func (h *handler) me(w http.ResponseWriter, r *http.Request) error {
	if err := h.limit(r, "shop-me", 60); err != nil {
		return err
	}
	if _, err := h.storefront(r); err != nil {
		return err
	}
	member, err := h.svc.ports.Members.FromRequest(r)
	if err != nil {
		return err
	}
	if member == nil {
		return ok(w, nil)
	}
	view, err := h.svc.MemberView(r.Context(), *member)
	if err != nil {
		return err
	}
	return ok(w, view)
}

// promoPreview is POST /api/public/shop/{slug}/promo/preview.
func (h *handler) promoPreview(w http.ResponseWriter, r *http.Request) error {
	if err := h.limit(r, "shop-promo", 20); err != nil {
		return err
	}
	if _, err := h.storefront(r); err != nil {
		return err
	}
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	code := f.Str("code", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 40})
	items := promoLines(f)
	if !f.Valid() {
		return httpx.BadRequest("Invalid payload")
	}
	member, err := h.svc.ports.Members.FromRequest(r)
	if err != nil {
		return err
	}
	view, err := h.svc.PreviewPromo(r.Context(), *code, items, member)
	if err != nil {
		return checkoutStatus(err)
	}
	return ok(w, view)
}

// promoLines reads the preview's lines: [{productId, skuId?, quantity}].
func promoLines(f *validate.Form) []CartItem {
	var out []CartItem
	f.List("lines", validate.Rule{}, 50, func(sub *validate.Form, i int, v any) {
		it := sub.Item(i, v)
		var item CartItem
		if id := it.UUID("productId", validate.Rule{}); id != nil {
			item.ProductID = *id
		}
		item.SkuID = it.UUID("skuId", validate.Rule{Optional: true, Nullable: true})
		if q := it.Int("quantity", validate.Rule{}, validate.NumOpts{Positive: true, Max: validate.Bound(999)}); q != nil {
			item.Quantity = float64(*q)
		}
		out = append(out, item)
	})
	return out
}

// checkoutStatus turns a *checkoutError into its HTTP status.
func checkoutStatus(err error) error {
	if cerr, ok := errors.AsType[*checkoutError](err); ok {
		return httpx.Status(cerr.status, cerr.reason)
	}
	return err
}

func (h *handler) orderStatus(w http.ResponseWriter, r *http.Request, token string) error {
	if err := h.limit(r, "shop-order-status", 60); err != nil {
		return err
	}
	var view *PublicOrderStatus
	if validate.IsUUID(token) {
		var err error
		if view, err = h.svc.PublicOrderStatus(r.Context(), token); err != nil {
			return err
		}
	}
	if view == nil {
		return httpx.NotFound(publicOrderNotFound)
	}
	return ok(w, view)
}

func (h *handler) publicAreas(w http.ResponseWriter, r *http.Request) error {
	if err := h.limit(r, "shop-areas", 30); err != nil {
		return err
	}
	if _, err := h.storefront(r); err != nil {
		return err
	}
	query := domain.JSTrim(r.URL.Query().Get("q"))
	if validate.UTF16Len(query) < 3 {
		return ok(w, []AreaSuggestion{})
	}
	areas, _, err := h.svc.SearchAreas(r.Context(), query)
	if err != nil {
		return err
	}
	return ok(w, areas)
}

// cartItems reads z.array(item).min(1).max(50) of product_id, optional
// sku_id (withSku) and quantity.
func cartItems(f *validate.Form, withSku bool) []CartItem {
	var out []CartItem
	items := f.List("items", validate.Rule{}, 50, func(sub *validate.Form, i int, v any) {
		it := sub.Item(i, v)
		var item CartItem
		if id := it.UUID("product_id", validate.Rule{}); id != nil {
			item.ProductID = *id
		}
		if withSku {
			item.SkuID = it.UUID("sku_id", validate.Rule{Optional: true, Nullable: true})
		}
		if q := it.Int("quantity", validate.Rule{}, validate.NumOpts{Positive: true, Max: validate.Bound(999)}); q != nil {
			item.Quantity = float64(*q)
		}
		out = append(out, item)
	})
	if items != nil && len(items) == 0 {
		f.Fail("items", "too_small", "Too small: expected array to have >=1 items")
	}
	return out
}

func (h *handler) publicRates(w http.ResponseWriter, r *http.Request) error {
	if err := h.limit(r, "shop-rates", 20); err != nil {
		return err
	}
	if _, err := h.storefront(r); err != nil {
		return err
	}
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	destID := f.Str("destination_id", validate.Rule{}, validate.StrOpts{Min: 1})
	postal := f.Str("destination_postal_code", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{})
	items := cartItems(f, false)
	if !f.Valid() {
		return httpx.BadRequest("Invalid payload")
	}
	ctx := r.Context()
	weight, value, err := h.svc.CartWeightAndValue(ctx, items)
	if err != nil {
		return err
	}
	if weight <= 0 {
		return httpx.BadRequest(publicCartInvalid)
	}
	sc, err := h.svc.loadShippingContext(ctx)
	if err != nil {
		return err
	}
	if sc.originID == "" {
		return httpx.Status(http.StatusServiceUnavailable, publicOriginNotSet)
	}
	quotes, err := h.svc.quoteFromOrigin(ctx, sc, *destID, postal, weight, value)
	if err != nil {
		return err
	}
	type meta struct {
		Provider   string  `json:"provider"`
		WeightGram float64 `json:"weight_gram"`
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Success bool                 `json:"success"`
		Data    []domain.PricedQuote `json:"data"`
		Meta    meta                 `json:"meta"`
	}{true, domain.WithMarkup(quotes, sc.markup), meta{sc.provider.name(), weight}})
}

// zodEmail is z.string().email() (zod v4).
var zodEmail = regexp.MustCompile(`^([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)

func emailCheck(s string) (string, string, bool) {
	return "invalid_format", "Invalid email address",
		!strings.HasPrefix(s, ".") && !strings.Contains(s, "..") && zodEmail.MatchString(s)
}

func (h *handler) checkout(w http.ResponseWriter, r *http.Request) error {
	if err := h.limit(r, "shop-checkout", 10); err != nil {
		return err
	}
	sf, err := h.storefront(r)
	if err != nil {
		return err
	}
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	in, branchID, valid := parseCheckout(raw)
	if !valid {
		return httpx.BadRequest(publicCheckoutInvalid)
	}
	ctx := r.Context()
	h.svc.releaseExpiredReservations(ctx)
	in.Storefront = *sf
	if in.Member, err = h.svc.ports.Members.FromRequest(r); err != nil {
		return err
	}
	if in.Delivery.Method == domain.DeliveryPickup {
		if in.Delivery.Branch, err = h.pickupBranch(ctx, *sf, branchID); err != nil {
			return err
		}
	} else if err := h.priceShipping(ctx, &in); err != nil {
		return err
	}
	base := requestOrigin(r, h.svc.ports.AppOrigin)
	in.BaseURL = base
	res, err := h.svc.Checkout(ctx, in)
	if err != nil {
		return checkoutStatus(err)
	}
	statusURL := base + "/shop/order/" + res.AccessToken
	if res.Paid {
		return created(w, struct {
			OrderNumber string `json:"orderNumber"`
			AccessToken string `json:"accessToken"`
			Status      string `json:"status"`
			StatusURL   string `json:"statusUrl"`
		}{res.OrderNumber, res.AccessToken, "paid", statusURL})
	}
	return created(w, struct {
		OrderNumber string `json:"order_number"`
		InvoiceURL  string `json:"invoice_url"`
		StatusURL   string `json:"status_url"`
	}{res.OrderNumber, res.InvoiceURL, statusURL})
}

// pickupBranch is the branch a pickup order names: pickup must be on and
// the branch among the storefront's pickup branches.
func (h *handler) pickupBranch(ctx context.Context, sf Storefront, branchID string) (*PickupBranch, error) {
	settings, err := h.svc.StorefrontSettings(ctx, sf.ID)
	if err != nil {
		return nil, err
	}
	branches, err := h.svc.PickupBranches(ctx, sf, settings)
	if err != nil {
		return nil, err
	}
	for i := range branches {
		if branches[i].ID == branchID {
			return &branches[i], nil
		}
	}
	return nil, httpx.BadRequest("Pickup is not available at that branch")
}

// priceShipping is the authoritative shipping of a ship order: re-quote
// from the provider and match the client's choice.
func (h *handler) priceShipping(ctx context.Context, in *CheckoutInput) error {
	weight, value, err := h.svc.CartWeightAndValue(ctx, in.Items)
	if err != nil {
		return err
	}
	if weight <= 0 {
		return httpx.BadRequest(publicCartInvalid)
	}
	sc, err := h.svc.loadShippingContext(ctx)
	if err != nil {
		return err
	}
	if sc.originID == "" {
		return httpx.Status(http.StatusServiceUnavailable, publicOriginNotSet)
	}
	quotes, err := h.svc.quoteFromOrigin(ctx, sc, in.Destination.AreaID, in.Destination.PostalCode, weight, value)
	if err != nil {
		return err
	}
	chosen, found := domain.FindQuote(quotes, in.Courier.Code, in.Courier.ServiceCode)
	if !found {
		return httpx.Conflict(publicCourierGone)
	}
	in.Courier.Code, in.Courier.ServiceCode = chosen.CourierCode, chosen.ServiceCode
	in.Courier.Provider, in.Courier.Cost, in.Courier.Etd = sc.provider.name(), chosen.Price+sc.markup, chosen.Etd
	return nil
}

// parseCheckout is the checkout body: items, customer, delivery (ship by
// default; pickup names a branchId and needs no destination or courier),
// promoCode, payment (xendit by default) and notes. Only pass or fail
// matters.
func parseCheckout(raw any) (in CheckoutInput, branchID string, valid bool) {
	f := validate.New(raw, true)
	nullish := validate.Rule{Optional: true, Nullable: true}
	in.Items = cartItems(f, true)
	c := f.Child("customer")
	name := c.Str("name", validate.Rule{}, validate.StrOpts{Trim: true, Min: 2, Max: 120})
	phone := c.Str("phone", validate.Rule{}, validate.StrOpts{Trim: true, Min: 8, Max: 30})
	if v, sent := c.Fields()["email"]; sent && v != nil {
		if s, isStr := v.(string); isStr && s == "" {
			// z.literal('') branch: an empty email is no email.
		} else {
			in.Customer.Email = c.Str("email", nullish, validate.StrOpts{Trim: true, Max: 160, Check: emailCheck})
		}
	}
	in.Delivery.Method, in.Payment = domain.DeliveryShip, domain.PaymentXendit
	if _, sent := f.Fields()["delivery"]; sent {
		d := f.Child("delivery")
		if m := d.Enum("method", validate.Rule{}, []string{domain.DeliveryShip, domain.DeliveryPickup}); m != nil {
			in.Delivery.Method = *m
		}
		if in.Delivery.Method == domain.DeliveryPickup {
			if id := d.UUID("branchId", validate.Rule{}); id != nil {
				branchID = *id
			}
		}
	}
	if _, sent := f.Fields()["payment"]; sent {
		if m := f.Child("payment").Enum("method", validate.Rule{}, []string{domain.PaymentXendit, domain.PaymentArkCoin}); m != nil {
			in.Payment = *m
		}
	}
	in.PromoCode = orNil(f.Str("promoCode", nullish, validate.StrOpts{Trim: true, Max: 40}))
	in.Notes = f.Str("notes", nullish, validate.StrOpts{Trim: true, Max: 500})
	var area, label, address, code, service *string
	if in.Delivery.Method == domain.DeliveryShip {
		d := f.Child("destination")
		area = d.Str("area_id", validate.Rule{}, validate.StrOpts{Min: 1})
		label = d.Str("label", validate.Rule{}, validate.StrOpts{Trim: true, Min: 3, Max: 300})
		in.Destination.PostalCode = d.Str("postal_code", nullish, validate.StrOpts{Trim: true, Max: 10})
		address = d.Str("address", validate.Rule{}, validate.StrOpts{Trim: true, Min: 10, Max: 500})
		k := f.Child("courier")
		code = k.Str("code", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 30})
		service = k.Str("service_code", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 60})
	}
	if !f.Valid() {
		return in, "", false
	}
	in.Customer.Name, in.Customer.Phone = *name, *phone
	if in.Delivery.Method == domain.DeliveryShip {
		in.Destination.AreaID, in.Destination.Label, in.Destination.Address = *area, *label, *address
		in.Courier.Code, in.Courier.ServiceCode = *code, *service
	}
	return in, branchID, true
}

/* ── webhooks ────────────────────────────────────────────────────────── */

var bearerRe = regexp.MustCompile(`(?i)^Bearer\s+(\S+)$`)

// biteshipToken is the webhook secret from x-webhook-token, a Bearer
// header, or (for URLs already registered at Biteship) ?token=.
func biteshipToken(r *http.Request) string {
	if t := r.Header.Get("x-webhook-token"); t != "" {
		return t
	}
	if m := bearerRe.FindStringSubmatch(r.Header.Get("authorization")); m != nil {
		return m[1]
	}
	return r.URL.Query().Get("token")
}

// biteshipWebhook is the Biteship tracking webhook. Biteship does not sign
// payloads, so the BITESHIP_WEBHOOK_TOKEN secret guards it (constant-time
// compare); without the env token the webhook is closed (503).
func (h *handler) biteshipWebhook(w http.ResponseWriter, r *http.Request) {
	if err := h.limit(r, "biteship-webhook", 120); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	expected := h.svc.ports.Getenv("BITESHIP_WEBHOOK_TOKEN")
	if expected == "" {
		_ = httpx.JSON(w, http.StatusServiceUnavailable, failure{false, "Webhook belum dikonfigurasi"})
		return
	}
	if !domain.SafeEqual(biteshipToken(r), expected) {
		_ = httpx.JSON(w, http.StatusUnauthorized, failure{false, "Unauthorized"})
		return
	}
	fail := func(err error) {
		h.svc.log.Error("[shop] biteship webhook error", "error", err)
		_ = httpx.JSON(w, http.StatusInternalServerError, failure{false, "Webhook error"})
	}
	raw, err := readJSON(r)
	if err != nil {
		fail(err)
		return
	}
	ev, valid := parseBiteship(raw)
	if !valid || ev.OrderID == "" {
		_ = httpx.JSON(w, http.StatusOK, ack{Success: true, Ignored: true})
		return
	}
	ignored, err := h.svc.ApplyBiteshipEvent(r.Context(), ev)
	if err != nil {
		fail(err)
		return
	}
	_ = httpx.JSON(w, http.StatusOK, ack{Success: true, Ignored: ignored})
}

// parseBiteship is payloadSchema.
func parseBiteship(raw any) (BiteshipEvent, bool) {
	f := validate.New(raw, true)
	opt, nullish := validate.Rule{Optional: true}, validate.Rule{Optional: true, Nullable: true}
	var ev BiteshipEvent
	get := func(key string) string {
		if s := f.Str(key, opt, validate.StrOpts{}); s != nil {
			return *s
		}
		return ""
	}
	ev.Event = get("event")
	ev.OrderID = get("order_id")
	ev.CourierTrackingID = f.Str("courier_tracking_id", nullish, validate.StrOpts{})
	ev.CourierWaybillID = f.Str("courier_waybill_id", nullish, validate.StrOpts{})
	ev.Status = get("status")
	return ev, f.Valid()
}

// ParseInvoiceCallback is the Xendit callbackSchema; ok is false when the
// payload does not match it.
func ParseInvoiceCallback(raw any) (InvoiceCallback, bool) {
	f := validate.New(raw, true)
	var cb InvoiceCallback
	str := func(key string) string {
		if s := f.Str(key, validate.Rule{}, validate.StrOpts{}); s != nil {
			return *s
		}
		return ""
	}
	cb.ID, cb.ExternalID, cb.Status = str("id"), str("external_id"), str("status")
	cb.PaidAt = f.Str("paid_at", validate.Rule{Optional: true}, validate.StrOpts{})
	cb.Amount = f.Num("amount", validate.Rule{Optional: true}, validate.NumOpts{})
	return cb, f.Valid()
}

// xenditWebhook is the shop's Xendit invoice webhook: x-callback-token,
// amount cross-check, idempotent settlement, best-effort WhatsApp.
func (h *handler) xenditWebhook(w http.ResponseWriter, r *http.Request) {
	if err := h.limit(r, "shop-webhook", 120); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if !h.svc.ports.Payments.ValidWebhookToken(r.Header.Get("x-callback-token")) {
		_ = httpx.JSON(w, http.StatusUnauthorized, failure{false, "Unauthorized"})
		return
	}
	fail := func(err error) {
		h.svc.log.Error("[shop] webhook error", "error", err)
		_ = httpx.JSON(w, http.StatusInternalServerError, failure{false, "Webhook error"})
	}
	raw, err := readJSON(r)
	if err != nil {
		fail(err)
		return
	}
	cb, valid := ParseInvoiceCallback(raw)
	if !valid {
		_ = httpx.JSON(w, http.StatusBadRequest, failure{false, "Payload tidak dikenal"})
		return
	}
	res, err := h.svc.SettleInvoice(r.Context(), nil, cb)
	if err != nil {
		fail(err)
		return
	}
	_ = httpx.JSON(w, res.Status, res.Body)
}
