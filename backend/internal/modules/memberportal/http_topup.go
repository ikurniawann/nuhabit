package memberportal

import (
	"net/http"
	"strings"

	"nuhabit/backend/internal/platform/module"
)

func (h *Handler) topupRoutes() []module.Route {
	return []module.Route{
		{Pattern: "GET " + prefix + "/topup", Handler: h.member("Gagal memuat top-up", h.topupOptions)},
		{Pattern: "POST " + prefix + "/topup", Handler: h.member("Gagal membuat top-up", h.createTopup)},
		{Pattern: "GET " + prefix + "/topup/{id}", Handler: h.member("Gagal memuat status top-up", h.topupStatus)},
		{Pattern: "POST " + prefix + "/topup/{id}/simulate-paid", Handler: h.member("Gagal mensimulasikan pembayaran", h.simulateTopup)},
	}
}

// GET /topup.
func (h *Handler) topupOptions(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.TopupOptions(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, view)
}

// parseTopupRequest mirrors the zod schema of topup/route.ts, including the
// first-issue messages zod v4 produces.
func parseTopupRequest(raw any, parsed bool) (TopupRequest, string) {
	if !parsed {
		raw = map[string]any{}
	}
	body, isObject := raw.(map[string]any)
	if !isObject {
		return TopupRequest{}, "Invalid input: expected object, received " + jsTypeName(raw)
	}
	var req TopupRequest
	if v, present := body["package_id"]; present && v != nil {
		s, isString := v.(string)
		if !isString {
			return req, "Invalid input: expected string, received " + jsTypeName(v)
		}
		if !isUUID(s) {
			return req, "Invalid UUID"
		}
		req.PackageID = s
	}
	if v, present := body["amount"]; present && v != nil {
		n, isNumber := v.(float64)
		if !isNumber {
			return req, "Invalid input: expected number, received " + jsTypeName(v)
		}
		if n != float64(int64(n)) {
			return req, "Invalid input: expected int, received number"
		}
		if n <= 0 {
			return req, "Too small: expected number to be >0"
		}
		req.Amount = n
	}
	if (req.PackageID != "") == (req.Amount != 0) {
		return req, "Pilih paket atau isi nominal"
	}
	return req, ""
}

func jsTypeName(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case float64:
		return "number"
	case bool:
		return "boolean"
	case []any:
		return "array"
	}
	return "object"
}

// POST /topup { package_id } or { amount }.
func (h *Handler) createTopup(w http.ResponseWriter, r *http.Request, customerID string) error {
	if !h.svc.wallet.ArkCoinEnabled(r.Context()) {
		return errArkCoinDisabled
	}
	raw, parsed := readRaw(r)
	req, problem := parseTopupRequest(raw, parsed)
	if problem != "" {
		return fail(400, problem)
	}
	origin := appOrigin(r, h.svc.appOrigin)
	view, err := h.svc.CreateTopup(r.Context(), customerID, req, func(configured string) string {
		if configured != "" {
			return configured
		}
		return origin + "/api/payments/xendit/webhook"
	})
	if err != nil {
		return err
	}
	return ok(w, view)
}

// appOrigin mirrors lib/app-origin: NEXT_PUBLIC_APP_URL (or the old
// NEXT_PUBLIC_BASE_URL), else the request origin, without a trailing slash.
func appOrigin(r *http.Request, configured string) string {
	origin := configured
	if origin == "" {
		scheme := "http"
		if r.TLS != nil || strings.EqualFold(strings.TrimSpace(strings.Split(r.Header.Get("x-forwarded-proto"), ",")[0]), "https") {
			scheme = "https"
		}
		host := r.Header.Get("x-forwarded-host")
		if host == "" {
			host = r.Host
		}
		origin = scheme + "://" + host
	}
	return strings.TrimRight(origin, "/")
}

// GET /topup/{id}.
func (h *Handler) topupStatus(w http.ResponseWriter, r *http.Request, customerID string) error {
	id := r.PathValue("id")
	if !isUUID(id) {
		return fail(400, "ID tidak valid")
	}
	view, err := h.svc.TopupStatus(r.Context(), customerID, id)
	if err != nil {
		return err
	}
	return ok(w, view)
}

// POST /topup/{id}/simulate-paid (local dev only).
func (h *Handler) simulateTopup(w http.ResponseWriter, r *http.Request, customerID string) error {
	if !h.svc.bypass().Active() {
		return fail(404, "Not found")
	}
	id := r.PathValue("id")
	if !isUUID(id) {
		return fail(400, "ID tidak valid")
	}
	view, err := h.svc.SimulateTopupPaid(r.Context(), customerID, id)
	if err != nil {
		return err
	}
	return ok(w, view)
}
