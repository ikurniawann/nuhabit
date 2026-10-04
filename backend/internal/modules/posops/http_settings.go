package posops

import (
	"net/http"
	"regexp"
	"strings"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// POS settings routes: receipt, gift card, loyalty, payment methods,
// sales channels, channel prices and billing.
func (h *Handler) settingsRoutes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/pos/receipt-settings", Handler: apiRoute(h.receiptSettings)},
		{Pattern: "GET /api/pos/gift-card-config", Handler: apiRoute(h.giftCardConfig)},
		{Pattern: "GET /api/pos/loyalty-settings", Handler: apiRoute(h.loyaltySettings)},
		{Pattern: "PUT /api/pos/loyalty-settings", Handler: apiRoute(h.saveLoyaltySettings)},
		{Pattern: "GET /api/pos/payment-methods", Handler: caught(always("Gagal memuat metode bayar"), h.paymentMethods)},
		{Pattern: "PATCH /api/pos/payment-methods", Handler: h.updatePaymentMethodRoute()},
		{Pattern: "POST /api/pos/payment-methods", Handler: h.paymentMethodWrite(h.createPaymentMethod)},
		{Pattern: "DELETE /api/pos/payment-methods", Handler: h.paymentMethodWrite(h.deletePaymentMethod)},
		{Pattern: "PUT /api/pos/sales-channels/{code}", Handler: caught(always("Gagal menyimpan aturan harga"), h.updateSalesChannel)},
		{Pattern: "GET /api/pos/channel-prices", Handler: caught(always("Gagal memproses harga channel"), h.channelPrices)},
		{Pattern: "PUT /api/pos/channel-prices", Handler: caught(always("Gagal memproses harga channel"), h.saveChannelPrices)},
		{Pattern: "GET /api/pos/billing-settings", Handler: apiRoute(h.billingSettings)},
		{Pattern: "PUT /api/pos/billing-settings", Handler: apiRoute(h.saveBillingSettings)},
	}
}

// channelPriceMenu guards the channel price routes.
var channelPriceMenu = []string{"pos.catalog.channel-prices"}

// requirePosSession is route-guards' requirePosSession: the ApiError 401.
func (h *Handler) requirePosSession(r *http.Request) (string, error) {
	u, err := h.posUser(r)
	if err != nil {
		return "", err
	}
	if u == nil {
		return "", httpx.Unauthorized("Authentication required")
	}
	return u.ID, nil
}

func (h *Handler) receiptSettings(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePosSession(r); err != nil {
		return err
	}
	rows, err := h.svc.ReceiptSettings(r.Context())
	if err != nil {
		return err
	}
	return okData(w, rows)
}

func (h *Handler) giftCardConfig(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePosSession(r); err != nil {
		return err
	}
	cfg, err := h.svc.GiftCardConfig(r.Context())
	if err != nil {
		return err
	}
	return okData(w, cfg)
}

func (h *Handler) loyaltySettings(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePosSession(r); err != nil {
		return err
	}
	data, err := h.svc.LoyaltySettings(r.Context())
	if err != nil {
		return err
	}
	return okData(w, data)
}

// bodyOrEmpty is `await request.json().catch(() => ({}))` for zod parsing.
func bodyOrEmpty(r *http.Request) any {
	return jsonBodyOr(r, emptyObject())
}

func (h *Handler) saveLoyaltySettings(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuAction(r, "update", iam.PosLoyaltySettings...)
	if err != nil {
		return err
	}
	data, err := h.svc.SaveLoyaltySettings(r.Context(), user.ID, bodyOrEmpty(r))
	if err != nil {
		return err
	}
	return writeObj(w, http.StatusOK, NewObj("success", true, "data", data, "message", "Loyalty settings saved"))
}

func (h *Handler) paymentMethods(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	q := r.URL.Query()
	methods, err := h.svc.PaymentMethods(r.Context(), q.Get("active") == "1" || q.Get("activeOnly") == "true")
	if err != nil {
		return err
	}
	return okData(w, methods)
}

var knownPaymentUpdateError = regexp.MustCompile(`(?i)tidak valid|tidak bisa diubah|sudah dipakai|metode bawaan`)

// updatePaymentMethodRoute renders the PATCH catch: a known rule message
// is a 400, anything else 500 "Gagal memperbarui metode bayar".
func (h *Handler) updatePaymentMethodRoute() http.Handler {
	return rendered(h.updatePaymentMethod, func(err error) (int, string) {
		if msg := pgMessage(err); knownPaymentUpdateError.MatchString(msg) {
			return http.StatusBadRequest, msg
		}
		return http.StatusInternalServerError, "Gagal memperbarui metode bayar"
	})
}

func (h *Handler) updatePaymentMethod(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuAction(r, "update", iam.PosOperations...); err != nil {
		return err
	}
	body, ok := validate.ReadBody(r)
	if !ok {
		return &jsError{msg: "Unexpected end of JSON input"}
	}
	m, err := h.svc.UpdatePaymentMethod(r.Context(), body, true)
	if err != nil {
		return err
	}
	if m == nil {
		return fail(http.StatusNotFound, "Metode bayar tidak ditemukan")
	}
	return writeObj(w, http.StatusOK, NewObj("success", true, "data", m, "message", "Metode bayar diperbarui"))
}

// paymentMethodWrite renders POST/DELETE failures: rule and parse errors
// as 400 with their message, 409 for a taken code on create.
func (h *Handler) paymentMethodWrite(fn httpx.HandlerFunc) http.Handler {
	return rendered(fn, func(err error) (int, string) {
		msg := pgMessage(err)
		if strings.Contains(strings.ToLower(msg), "sudah dipakai") {
			return http.StatusConflict, msg
		}
		return http.StatusBadRequest, msg
	})
}

func (h *Handler) createPaymentMethod(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuAction(r, "update", iam.PosOperations...); err != nil {
		return err
	}
	body, ok := validate.ReadBody(r)
	if !ok {
		return &jsError{msg: "Unexpected end of JSON input"}
	}
	m, err := h.svc.CreatePaymentMethod(r.Context(), body, true)
	if err != nil {
		return err
	}
	return writeObj(w, http.StatusOK, NewObj("success", true, "data", m, "message", "Metode bayar ditambahkan"))
}

func (h *Handler) deletePaymentMethod(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuAction(r, "delete", iam.PosOperations...); err != nil {
		return err
	}
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	deleted, err := h.svc.DeletePaymentMethod(r.Context(), code)
	if err != nil {
		return err
	}
	if !deleted {
		return fail(http.StatusNotFound, "Metode bayar tidak ditemukan")
	}
	return writeObj(w, http.StatusOK, NewObj("success", true, "data", NewObj("code", code), "message", "Metode bayar dihapus"))
}

func (h *Handler) updateSalesChannel(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuAction(r, "update", channelPriceMenu...)
	if err != nil {
		return err
	}
	rule, err := h.svc.UpdateSalesChannel(r.Context(), user.ID, r.PathValue("code"), jsonBodyOr(r, nil))
	if err != nil {
		return err
	}
	return okData(w, rule)
}

func (h *Handler) channelPrices(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, channelPriceMenu...); err != nil {
		return err
	}
	data, err := h.svc.ChannelPrices(r.Context(), r.URL.Query().Get("channel"))
	if err != nil {
		return err
	}
	return okData(w, data)
}

func (h *Handler) saveChannelPrices(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuAction(r, "update", channelPriceMenu...)
	if err != nil {
		return err
	}
	data, err := h.svc.SaveChannelPrices(r.Context(), user.ID, jsonBodyOr(r, nil))
	if err != nil {
		return err
	}
	return okData(w, data)
}

func (h *Handler) billingSettings(w http.ResponseWriter, r *http.Request) error {
	user, err := h.posUser(r)
	if err != nil {
		return err
	}
	if user == nil {
		return httpx.Unauthorized("Authentication required")
	}
	q := r.URL.Query()
	mode := q.Get("mode")
	if mode == "" {
		mode = "resolve"
	}
	data, err := h.svc.BillingSettings(r.Context(), h.caller(r, user), mode, q.Get("branch_id"), q.Get("warehouse_id"),
		q.Get("subtotal"), q.Get("enabled_codes"))
	if err != nil {
		return err
	}
	return okData(w, data)
}

func (h *Handler) saveBillingSettings(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuAction(r, "update", iam.SettingsBilling...)
	if err != nil {
		return err
	}
	profile, err := h.svc.SaveBillingProfile(r.Context(), user.ID, bodyOrEmpty(r))
	if err != nil {
		return err
	}
	return writeObj(w, http.StatusOK, NewObj("success", true, "data", profile, "message", "Billing settings saved"))
}
