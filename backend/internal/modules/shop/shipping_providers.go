package shop

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/jsmath"
)

// Courier provider adapters over net/http (lib/shop/shipping/{biteship,
// rajaongkir}.ts). Responses are decoded loosely, as the TS reads them.

// fetchJSON sends a request and decodes the body as `response.json()
// .catch(() => ({}))` does.
func (s *Service) fetchJSON(ctx context.Context, method, target string, body io.Reader, headers map[string]string) (int, map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return 0, nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := s.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var out map[string]any
	if dec.Decode(&out) != nil || out == nil {
		out = map[string]any{}
	}
	return res.StatusCode, out, nil
}

func ok2xx(status int) bool { return status >= 200 && status < 300 }

// field reads obj[key] of a decoded JSON object (nil when obj is not one).
func field(v any, key string) any {
	if m, ok := v.(map[string]any); ok {
		return m[key]
	}
	return nil
}

// list reads a decoded JSON array (nil otherwise).
func list(v any) []any {
	l, _ := v.([]any)
	return l
}

// text is `String(v || "")`.
func text(v any) string {
	if !domain.JSTruthy(v) {
		return ""
	}
	return domain.JSString(v)
}

// firstText is `String(a || b || "")`.
func firstText(vals ...any) string {
	for _, v := range vals {
		if domain.JSTruthy(v) {
			return domain.JSString(v)
		}
	}
	return ""
}

// optText is `v ? String(v) : null`.
func optText(v any) *string {
	if !domain.JSTruthy(v) {
		return nil
	}
	s := domain.JSString(v)
	return &s
}

// toNumber is the adapters' toNumber: finite Number(v), else 0.
func toNumber(v any) float64 {
	n := domain.JSValueNumber(v)
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return 0
	}
	return n
}

// weightParam is Math.max(1, Math.round(weightGram)).
func weightParam(w float64) float64 { return math.Max(1, jsmath.Round(w)) }

/* ── Biteship ─────────────────────────────────────────────────────────── */

type biteship struct{ s *Service }

func (biteship) name() string            { return "biteship" }
func (biteship) canCreateShipment() bool { return true }

func (b biteship) fetch(ctx context.Context, method, path string, body any) (map[string]any, error) {
	key, err := b.s.requireEnvKey("BITESHIP_API_KEY")
	if err != nil {
		return nil, err
	}
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	status, data, err := b.s.fetchJSON(ctx, method, b.s.biteshipBase+path, rd,
		map[string]string{"authorization": key, "content-type": "application/json"})
	if err != nil {
		return nil, err
	}
	if !ok2xx(status) || data["success"] == false {
		msg := firstText(data["error"])
		if msg == "" {
			msg = "Biteship error HTTP " + strconv.Itoa(status)
		}
		return nil, providerError("Biteship: " + msg)
	}
	return data, nil
}

func (b biteship) searchAreas(ctx context.Context, query string) ([]AreaSuggestion, error) {
	params := url.Values{"countries": {"ID"}, "input": {query}, "type": {"single"}}
	data, err := b.fetch(ctx, http.MethodGet, "/v1/maps/areas?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	out := []AreaSuggestion{}
	for _, a := range list(data["areas"]) {
		if !domain.JSTruthy(field(a, "id")) || !domain.JSTruthy(field(a, "name")) {
			continue
		}
		out = append(out, AreaSuggestion{Provider: "biteship", ID: domain.JSString(field(a, "id")),
			Label: domain.JSString(field(a, "name")), PostalCode: optText(field(a, "postal_code"))})
	}
	return out, nil
}

func (b biteship) getRates(ctx context.Context, req rateRequest) ([]domain.RateQuote, error) {
	data, err := b.fetch(ctx, http.MethodPost, "/v1/rates/couriers", map[string]any{
		"origin_area_id":      req.originID,
		"destination_area_id": req.destinationID,
		"couriers":            strings.Join(req.couriers, ","),
		"items": []map[string]any{{
			"name": "Merchandise", "value": domain.OrFinite(req.itemValue),
			"weight": weightParam(req.weightGram), "quantity": 1,
		}},
	})
	if err != nil {
		return nil, err
	}
	out := []domain.RateQuote{}
	for _, row := range list(data["pricing"]) {
		etd := optText(field(row, "duration"))
		if etd == nil && domain.JSTruthy(field(row, "shipment_duration_range")) {
			v := strings.TrimSpace(domain.JSString(field(row, "shipment_duration_range")) + " " + text(field(row, "shipment_duration_unit")))
			etd = &v
		}
		out = append(out, domain.RateQuote{
			Provider:    "biteship",
			CourierCode: text(field(row, "courier_code")),
			CourierName: firstText(field(row, "courier_name"), field(row, "courier_code")),
			ServiceCode: text(field(row, "courier_service_code")),
			ServiceName: firstText(field(row, "courier_service_name"), field(row, "courier_service_code")),
			Price:       toNumber(field(row, "price")),
			Etd:         etd,
		})
	}
	return out, nil
}

func (b biteship) getTracking(ctx context.Context, waybill, courier string) (*TrackingResult, error) {
	data, err := b.fetch(ctx, http.MethodGet, "/v1/trackings/"+url.PathEscape(waybill)+"/couriers/"+url.PathEscape(courier), nil)
	if err != nil {
		return nil, err
	}
	status := firstText(data["status"])
	if status == "" {
		status = "unknown"
	}
	events := []TrackingEvent{}
	for _, e := range list(data["history"]) {
		events = append(events, TrackingEvent{Time: optText(field(e, "updated_at")), Status: text(field(e, "status")), Note: optText(field(e, "note"))})
	}
	return &TrackingResult{Provider: "biteship", Waybill: waybill, CourierCode: courier, Status: status, Events: events}, nil
}

func (b biteship) createShipment(ctx context.Context, req createShipmentRequest) (*createdShipment, error) {
	items := make([]map[string]any, len(req.items))
	for i, it := range req.items {
		items[i] = map[string]any{"name": it.name, "value": it.value, "weight": weightParam(it.weightGram), "quantity": it.quantity}
	}
	data, err := b.fetch(ctx, http.MethodPost, "/v1/orders", map[string]any{
		"origin_contact_name":       req.originContactName,
		"origin_contact_phone":      req.originContactPhone,
		"origin_address":            req.originAddress,
		"origin_area_id":            req.originID,
		"destination_contact_name":  req.destContactName,
		"destination_contact_phone": req.destContactPhone,
		"destination_address":       req.destAddress,
		"destination_area_id":       req.destAreaID,
		"courier_company":           req.courierCode,
		"courier_type":              req.serviceCode,
		"delivery_type":             "now",
		"reference_id":              req.referenceID,
		"items":                     items,
	})
	if err != nil {
		return nil, err
	}
	if !domain.JSTruthy(data["id"]) {
		return nil, providerError("Biteship: order pengiriman tidak mengembalikan id")
	}
	var waybill *string
	if w, ok := field(data["courier"], "waybill_id").(string); ok {
		waybill = &w
	}
	return &createdShipment{providerOrderID: domain.JSString(data["id"]), waybill: waybill, price: toNumber(data["price"])}, nil
}

/* ── RajaOngkir (Komerce) ─────────────────────────────────────────────── */

type rajaongkir struct{ s *Service }

func (rajaongkir) name() string            { return "rajaongkir" }
func (rajaongkir) canCreateShipment() bool { return false }

func (r rajaongkir) fetch(ctx context.Context, method, path string, form url.Values) (map[string]any, error) {
	key, err := r.s.requireEnvKey("RAJAONGKIR_API_KEY")
	if err != nil {
		return nil, err
	}
	headers := map[string]string{"key": key}
	var body io.Reader
	if form != nil {
		headers["content-type"] = "application/x-www-form-urlencoded"
		body = strings.NewReader(form.Encode())
	}
	status, data, err := r.s.fetchJSON(ctx, method, r.s.rajaongkirBase+path, body, headers)
	if err != nil {
		return nil, err
	}
	meta := data["meta"]
	metaStatus := ""
	if st, ok := field(meta, "status").(string); ok {
		metaStatus = strings.ToLower(st)
	}
	if !ok2xx(status) || (metaStatus != "" && metaStatus != "success") {
		msg := firstText(field(meta, "message"))
		if msg == "" {
			msg = "RajaOngkir error HTTP " + strconv.Itoa(status)
		}
		return nil, providerError("RajaOngkir: " + msg)
	}
	return data, nil
}

func (r rajaongkir) searchAreas(ctx context.Context, query string) ([]AreaSuggestion, error) {
	params := url.Values{"search": {query}, "limit": {"15"}, "offset": {"0"}}
	data, err := r.fetch(ctx, http.MethodGet, "/destination/domestic-destination?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	out := []AreaSuggestion{}
	for _, row := range list(data["data"]) {
		id := field(row, "id")
		if id == nil {
			continue
		}
		label := text(field(row, "label"))
		if label == "" {
			var parts []string
			for _, k := range []string{"subdistrict_name", "district_name", "city_name", "province_name"} {
				if v := text(field(row, k)); v != "" {
					parts = append(parts, v)
				}
			}
			label = strings.Join(parts, ", ")
		}
		out = append(out, AreaSuggestion{Provider: "rajaongkir", ID: domain.JSString(id), Label: label, PostalCode: optText(field(row, "zip_code"))})
	}
	return out, nil
}

func (r rajaongkir) getRates(ctx context.Context, req rateRequest) ([]domain.RateQuote, error) {
	form := url.Values{
		"origin":      {req.originID},
		"destination": {req.destinationID},
		"weight":      {strconv.FormatFloat(weightParam(req.weightGram), 'f', -1, 64)},
		"courier":     {strings.Join(req.couriers, ":")},
	}
	if req.itemValue != 0 && !math.IsNaN(req.itemValue) {
		form.Set("item_value", strconv.FormatFloat(jsmath.Round(req.itemValue), 'f', -1, 64))
	}
	data, err := r.fetch(ctx, http.MethodPost, "/calculate/domestic-cost", form)
	if err != nil {
		return nil, err
	}
	out := []domain.RateQuote{}
	for _, row := range list(data["data"]) {
		out = append(out, domain.RateQuote{
			Provider:    "rajaongkir",
			CourierCode: strings.ToLower(text(field(row, "code"))),
			CourierName: firstText(field(row, "name"), field(row, "code")),
			ServiceCode: text(field(row, "service")),
			ServiceName: firstText(field(row, "description"), field(row, "service")),
			Price:       toNumber(field(row, "cost")),
			Etd:         optText(field(row, "etd")),
		})
	}
	return out, nil
}

func (r rajaongkir) getTracking(ctx context.Context, waybill, courier string) (*TrackingResult, error) {
	params := url.Values{"awb": {waybill}, "courier": {courier}}
	data, err := r.fetch(ctx, http.MethodPost, "/track/waybill?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	d := data["data"]
	status := text(field(field(d, "delivery_status"), "status"))
	if status == "" {
		status = "unknown"
	}
	events := []TrackingEvent{}
	for _, e := range list(field(d, "manifest")) {
		var parts []string
		for _, k := range []string{"manifest_date", "manifest_time"} {
			if v := text(field(e, k)); v != "" {
				parts = append(parts, v)
			}
		}
		var at *string
		if len(parts) > 0 {
			v := strings.Join(parts, " ")
			at = &v
		}
		events = append(events, TrackingEvent{Time: at, Status: text(field(e, "manifest_description")), Note: optText(field(e, "city_name"))})
	}
	return &TrackingResult{Provider: "rajaongkir", Waybill: waybill, CourierCode: courier, Status: status, Events: events}, nil
}

func (rajaongkir) createShipment(context.Context, createShipmentRequest) (*createdShipment, error) {
	return nil, providerError("RajaOngkir tidak mendukung pembuatan order pengiriman — buat pengiriman di aplikasi kurir lalu input resi manual", 400)
}
