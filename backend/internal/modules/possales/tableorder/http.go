package tableorder

import (
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"

	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/modules/possales/tableorder/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// clientIdentifier is clientIdentifier: the first X-Forwarded-For entry,
// else X-Real-IP, else "anon".
func clientIdentifier(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		if first := strings.TrimSpace(strings.Split(forwarded, ",")[0]); first != "" {
			return first
		}
		return "anon"
	}
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	return "anon"
}

// appOrigin is appOrigin(request): NEXT_PUBLIC_APP_URL (or the legacy
// NEXT_PUBLIC_BASE_URL), else the public origin the proxy forwarded.
func appOrigin(r *http.Request) string {
	origin := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL"))
	if origin == "" {
		origin = strings.TrimSpace(os.Getenv("NEXT_PUBLIC_BASE_URL"))
	}
	if origin == "" {
		host := r.Header.Get("X-Forwarded-Host")
		if host == "" {
			host = r.Host
		}
		scheme := r.Header.Get("X-Forwarded-Proto")
		if scheme == "" {
			scheme = "http"
			if r.TLS != nil {
				scheme = "https"
			}
		}
		if host != "" {
			origin = scheme + "://" + strings.TrimSpace(strings.Split(host, ",")[0])
		}
	}
	return strings.TrimRight(origin, "/")
}

// products is GET /api/table-order/products?search=.
func (h *Handler) products() http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		products, meta, err := h.svc.menu(r.Context(), r.URL.Query().Get("search"))
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, struct {
			Success    bool              `json:"success"`
			Data       []domain.Product  `json:"data"`
			Categories []domain.Category `json:"categories"`
			Meta       CatalogMeta       `json:"meta"`
		}{true, products, domain.BuildCategories(products), meta})
	})
}

type sessionBilling struct {
	Profile string          `json:"profile"`
	Charges []domain.Charge `json:"charges"`
}

type sessionData struct {
	TableID             *string        `json:"table_id"`
	TableCode           string         `json:"table_code"`
	TableLabel          string         `json:"table_label"`
	TableArea           *string        `json:"table_area"`
	TableResolved       bool           `json:"table_resolved"`
	Status              string         `json:"status"`
	OrderType           string         `json:"order_type"`
	BrandName           string         `json:"brand_name"`
	Billing             sessionBilling `json:"billing"`
	QrisAvailable       bool           `json:"qris_available"`
	StaticQrisAvailable bool           `json:"static_qris_available"`
	StaticQrisImageURL  *string        `json:"static_qris_image_url"`
	ArkRate             float64        `json:"ark_rate"`
	MemberLoggedIn      bool           `json:"member_logged_in"`
	ArkEnabled          bool           `json:"ark_enabled"`
	XPEnabled           bool           `json:"xp_enabled"`
}

// session is GET /api/table-order/session/{tableCode}: the table, venue
// billing, QRIS availability and whether a member is signed in. An unknown
// table code may still order (table_resolved false).
func (h *Handler) session() http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		// Next decodes the segment, then the route decodes it again.
		code, err := url.PathUnescape(r.PathValue("tableCode"))
		if err != nil {
			return err
		}
		if code = domain.JSTrim(code); code == "" {
			return httpx.BadRequest("Kode meja wajib diisi")
		}
		svc := h.svc
		table, err := svc.p.Catalog.TableByCode(ctx, svc.db, code)
		if err != nil {
			h.log.WarnContext(ctx, "Table order table lookup warning:", "error", errMessage(err))
			table = nil
		}
		v, err := svc.loadVenue(ctx)
		if err != nil {
			return err
		}
		member, err := h.auth.MemberSessionFromRequest(r)
		memberIn := err == nil && member != nil
		static, err := svc.p.Settings.StaticQris(ctx, svc.db)
		if err != nil {
			static = StaticQris{}
		}

		active := activeTable(table)
		data := sessionData{
			TableCode: strings.ToUpper(code), TableLabel: tableLabel(active, code), TableResolved: active != nil,
			Status: "available", OrderType: "dine_in", BrandName: v.BrandName,
			Billing:       sessionBilling{Profile: v.ProfileName, Charges: v.Charges},
			QrisAvailable: v.QrisAvailable, StaticQrisAvailable: static.Available, ArkRate: v.ArkRate,
			MemberLoggedIn: memberIn, ArkEnabled: svc.p.Loyalty.ArkCoinEnabled(ctx, svc.db), XPEnabled: svc.p.CRM.XPEnabled(ctx, svc.db),
		}
		if active != nil {
			data.TableID = &active.ID
		}
		if table != nil {
			data.TableArea = table.Area
			if table.Status != nil {
				data.Status = *table.Status
			}
		}
		if static.Available {
			data.StaticQrisImageURL = &static.ImageURL
		}
		return httpx.Data(w, http.StatusOK, data)
	})
}

// createOrder is POST /api/table-order/orders (20 per minute per client).
func (h *Handler) createOrder() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !h.limiter.Allow("table-order:create:"+clientIdentifier(r), 20) {
			_ = kit.Fail(w, http.StatusTooManyRequests, "Terlalu banyak pesanan dalam waktu singkat — coba lagi sebentar")
			return
		}
		in, ok := parseCreate(r)
		if !ok {
			_ = kit.Fail(w, http.StatusBadRequest, "Data pesanan tidak valid")
			return
		}
		// The member comes from the portal session, never from the body.
		if m, err := h.auth.MemberSessionFromRequest(r); err == nil && m != nil {
			in.CustomerID = m.CustomerID
		}
		in.ActionURL = func(orderID string) string {
			base := appOrigin(r)
			if base == "" {
				return ""
			}
			return base + "/dashboard/pos/self-orders?order=" + url.QueryEscape(orderID)
		}

		out, err := h.svc.createOrder(r.Context(), in)
		var rejected *httpx.Error
		switch {
		case err == nil:
			_ = httpx.Data(w, http.StatusCreated, out)
		case errors.Is(err, errArkDisabled):
			_ = httpx.JSON(w, http.StatusConflict, struct {
				Success bool   `json:"success"`
				Error   string `json:"error"`
				Code    string `json:"code"`
			}{false, "Fitur ARK Coin sedang dinonaktifkan di pengaturan CRM", "ARK_COIN_DISABLED"})
		case errors.As(err, &rejected):
			_ = kit.Fail(w, rejected.Status, rejected.Message)
		default:
			h.log.ErrorContext(r.Context(), "Table order create error:", "error", err)
			_ = kit.Fail(w, http.StatusInternalServerError, errMessage(err))
		}
	})
}

// parseCreate is createOrderSchema.safeParse.
func parseCreate(r *http.Request) (createInput, bool) {
	f := validate.New(validate.ReadBody(r))
	in := createInput{}
	if s := f.Str("table_code", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 80}); s != nil {
		in.TableCode = *s
	}
	in.OrderType = f.StrDefault("order_type", "dine_in", validate.StrOpts{Check: validate.EnumCheck([]string{"dine_in", "takeaway"})})
	if s := f.Enum("payment_method", validate.Rule{}, []string{"qris", "static_qris", "ark_coin", "cashier"}); s != nil {
		in.PaymentMethod = *s
	}
	items := f.List("items", validate.Rule{}, 50, func(list *validate.Form, i int, v any) {
		item := list.Item(i, v)
		var it orderLineInput
		if s := item.UUID("product_id", validate.Rule{}); s != nil {
			it.ProductID = *s
		}
		if s := item.Str("variant_id", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Trim: true, Max: 80}); s != nil {
			it.VariantID = *s
		}
		it.ModifierIDs = item.Strings("modifier_ids", validate.Rule{Optional: true}, 20, validate.StrOpts{Check: validate.UUIDCheck})
		if n := item.Int("quantity", validate.Rule{}, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(99)}); n != nil {
			it.Quantity = *n
		}
		in.Items = append(in.Items, it)
	})
	if items != nil && len(items) == 0 {
		f.Fail("items", "too_small", "Too small: expected array to have >=1 items")
	}
	opt := validate.Rule{Optional: true}
	if s := f.Str("customer_note", opt, validate.StrOpts{Trim: true, Max: 300}); s != nil {
		in.CustomerNote = *s
	}
	if s := f.Str("guest_name", opt, validate.StrOpts{Trim: true, Max: 80}); s != nil {
		in.GuestName = *s
	}
	if s := f.Str("guest_phone", opt, validate.StrOpts{Trim: true, Max: 30}); s != nil {
		in.GuestPhone = *s
	}
	return in, f.Valid()
}

// orderStatus is GET /api/table-order/orders/{id}?qr=1: the tracking screen
// (the random UUID is the access token; 90 polls per minute per client).
func (h *Handler) orderStatus() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := domain.JSTrim(r.PathValue("id"))
		if !isUUID(id) {
			_ = kit.Fail(w, http.StatusBadRequest, "Order tidak valid")
			return
		}
		if !h.limiter.Allow("table-order:status:"+clientIdentifier(r), 90) {
			_ = kit.Fail(w, http.StatusTooManyRequests, "Terlalu sering — tunggu sebentar")
			return
		}
		out, err := h.svc.orderStatus(r.Context(), id, r.URL.Query().Get("qr") == "1")
		switch {
		case err != nil:
			h.log.ErrorContext(r.Context(), "Table order status error:", "error", err)
			_ = kit.Fail(w, http.StatusInternalServerError, errMessage(err))
		case out == nil:
			_ = kit.Fail(w, http.StatusNotFound, "Order tidak ditemukan")
		default:
			_ = httpx.Data(w, http.StatusOK, out)
		}
	})
}
