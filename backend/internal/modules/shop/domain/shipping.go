package domain

import (
	"math"
	"strings"
)

// RateQuote is one courier service from the active provider, before the
// shop markup.
type RateQuote struct {
	Provider    string  `json:"provider"`
	CourierCode string  `json:"courierCode"`
	CourierName string  `json:"courierName"`
	ServiceCode string  `json:"serviceCode"`
	ServiceName string  `json:"serviceName"`
	Price       float64 `json:"price"`
	Etd         *string `json:"etd"`
}

// PricedQuote is a quote with total_price (and, on the admin rates route,
// the markup itself).
type PricedQuote struct {
	RateQuote
	TotalPrice float64  `json:"total_price"`
	Markup     *float64 `json:"markup,omitempty"`
}

// WithMarkup is withMarkup: drop zero prices (service unavailable), then
// add the flat shop markup.
func WithMarkup(quotes []RateQuote, markup float64) []PricedQuote {
	out := []PricedQuote{}
	for _, q := range quotes {
		if q.Price > 0 {
			out = append(out, PricedQuote{RateQuote: q, TotalPrice: q.Price + markup})
		}
	}
	return out
}

// FindQuote is findQuote: the priced quote for the client's courier and
// service, case-insensitive.
func FindQuote(quotes []RateQuote, courierCode, serviceCode string) (RateQuote, bool) {
	courier, service := strings.ToLower(courierCode), strings.ToLower(serviceCode)
	for _, q := range quotes {
		if strings.ToLower(q.CourierCode) == courier && strings.ToLower(q.ServiceCode) == service && q.Price > 0 {
			return q, true
		}
	}
	return RateQuote{}, false
}

// DefaultCouriers is DEFAULT_COURIERS.
const DefaultCouriers = "jne,jnt,sicepat"

// ParseCourierList is parseCourierList: lower-cased codes, empties dropped,
// the default list for an empty value.
func ParseCourierList(value string) []string {
	if value == "" {
		value = DefaultCouriers
	}
	out := []string{}
	for _, code := range strings.Split(value, ",") {
		if c := strings.ToLower(JSTrim(code)); c != "" {
			out = append(out, c)
		}
	}
	return out
}

// settingsTextFields are the nullable text columns a settings patch sets.
var settingsTextFields = []string{
	"origin_area_id", "origin_district_id", "origin_label", "origin_postal_code",
	"origin_address", "origin_contact_name", "origin_contact_phone",
}

// PatchField is one column of a shipping settings patch.
type PatchField struct {
	Column string
	Value  any // string, float64 or nil
}

// BuildShippingSettingsPatch is buildShippingSettingsPatch: only the sent
// fields, empty text becomes NULL, couriers normalized. msg is the 400
// message when a value is invalid.
func BuildShippingSettingsPatch(body map[string]any) (fields []PatchField, msg string) {
	if v, sent := body["provider"]; sent {
		provider := strings.ToLower(JSString(v))
		if provider != "biteship" && provider != "rajaongkir" {
			return nil, "Provider harus biteship atau rajaongkir"
		}
		fields = append(fields, PatchField{"provider", provider})
	}
	for _, key := range settingsTextFields {
		v, sent := body[key]
		if !sent {
			continue
		}
		if JSTruthy(v) {
			fields = append(fields, PatchField{key, JSString(v)})
		} else {
			fields = append(fields, PatchField{key, nil})
		}
	}
	if v, sent := body["couriers"]; sent {
		raw := ""
		if JSTruthy(v) {
			raw = JSString(v)
		}
		// String(body.couriers || "") then parseCourierList: "" falls back to
		// the default list.
		couriers := ParseCourierList(raw)
		if len(couriers) == 0 {
			return nil, "Minimal satu kurir harus aktif"
		}
		fields = append(fields, PatchField{"couriers", strings.Join(couriers, ",")})
	}
	if v, sent := body["markup_amount"]; sent {
		markup := JSValueNumber(v)
		if math.IsNaN(markup) || math.IsInf(markup, 0) || markup < 0 {
			return nil, "Markup harus angka ≥ 0"
		}
		fields = append(fields, PatchField{"markup_amount", markup})
	}
	if len(fields) == 0 {
		return nil, "Tidak ada field yang diubah"
	}
	return fields, ""
}

// BiteshipShipmentStatus maps a Biteship order status to the internal
// shipment status ("" when unknown).
var BiteshipShipmentStatus = map[string]string{
	"confirmed":         "pickup",
	"allocated":         "pickup",
	"picking_up":        "pickup",
	"picked":            "in_transit",
	"dropping_off":      "in_transit",
	"delivered":         "delivered",
	"rejected":          "failed",
	"courier_not_found": "failed",
	"returned":          "failed",
	"cancelled":         "cancelled",
}
