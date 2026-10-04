// Package domain holds the pure GoBiz/GoFood rules the cashier routes use:
// the integration config (lib/gobiz/config.ts), the POS note of a GoFood
// order (lib/gobiz/mapping.ts posOrderNotes) and which cashier action a
// gofood_orders status allows (lib/gobiz/service.ts).
package domain

import (
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode"
)

// Environment is GobizEnvironment.
const (
	Sandbox    = "sandbox"
	Production = "production"
)

// Scopes is GOBIZ_SCOPES, sent with every client_credentials token request.
const Scopes = "gofood:catalog:write gofood:catalog:read gofood:order:write gofood:order:read gofood:outlet:write promo:food_promo:read promo:food_promo:write"

// defaults is GOBIZ_DEFAULTS.
var defaults = map[string]struct{ apiBase, oauthURL string }{
	Sandbox:    {"https://api.partner-sandbox.gobiz.co.id", "https://integration-goauth.gojekapi.com/oauth2/token"},
	Production: {"https://api.gobiz.co.id", "https://accounts.go-jek.com/oauth2/token"},
}

// Config is GobizConfig: what Settings → Integrasi stores in app_settings.
type Config struct {
	Enabled          bool
	Environment      string
	ClientID         string
	ClientSecret     string
	OutletID         string
	WebhookToken     string
	AutoAccept       bool
	PartnerID        string
	RelaySecret      string
	EnforceSignature bool
	APIBase          string
	OAuthURL         string
}

// IsConfigured is isGobizConfigured: client id, secret and outlet are set.
func (c Config) IsConfigured() bool {
	return c.ClientID != "" && c.ClientSecret != "" && c.OutletID != ""
}

// NormalizeEnvironment is normalizeEnvironment: anything but "production"
// is the sandbox.
func NormalizeEnvironment(v string) string {
	if v == Production {
		return Production
	}
	return Sandbox
}

// ResolveURLs is resolveGobizUrls: a non-blank override wins, the API base
// loses one trailing slash.
func ResolveURLs(environment, apiBase, oauthURL string) (string, string) {
	d := defaults[environment]
	if s := jsTrim(apiBase); s != "" {
		d.apiBase = s
	}
	if s := jsTrim(oauthURL); s != "" {
		d.oauthURL = s
	}
	return strings.TrimSuffix(d.apiBase, "/"), d.oauthURL
}

// ConfigFromSettings is loadGobizConfig over the app_settings values
// (nil = row missing or NULL), keyed by setting key.
func ConfigFromSettings(s map[string]*string) Config {
	get := func(key string) string {
		if v := s[key]; v != nil {
			return *v
		}
		return ""
	}
	env := NormalizeEnvironment(get("gobiz_environment"))
	apiBase, oauthURL := ResolveURLs(env, get("gobiz_api_base_url"), get("gobiz_oauth_url"))
	return Config{
		Enabled:          get("gobiz_enabled") == "true",
		Environment:      env,
		ClientID:         jsTrim(get("gobiz_client_id")),
		ClientSecret:     jsTrim(get("gobiz_client_secret")),
		OutletID:         jsTrim(get("gobiz_outlet_id")),
		WebhookToken:     jsTrim(get("gobiz_webhook_token")),
		AutoAccept:       get("gobiz_auto_accept") == "true",
		PartnerID:        jsTrim(get("gobiz_partner_id")),
		RelaySecret:      jsTrim(get("gobiz_relay_secret")),
		EnforceSignature: get("gobiz_signature_enforce") == "true",
		APIBase:          apiBase,
		OAuthURL:         oauthURL,
	}
}

// SettingKeys are the app_settings keys loadGobizConfig reads.
var SettingKeys = []string{
	"gobiz_enabled", "gobiz_environment", "gobiz_client_id", "gobiz_client_secret", "gobiz_outlet_id",
	"gobiz_webhook_token", "gobiz_auto_accept", "gobiz_oauth_url", "gobiz_api_base_url",
	"gobiz_partner_id", "gobiz_relay_secret", "gobiz_signature_enforce",
}

// NotesInput is the argument of posOrderNotes.
type NotesInput struct {
	GofoodOrderID   string
	GofoodOrderType string
	Pin             string
	CustomerName    string
	Cutlery         bool
	UnmappedCount   int
}

// PosOrderNotes is posOrderNotes: the pos_orders.notes that tell the cashier
// and kitchen the order came from GoFood.
func PosOrderNotes(in NotesInput) string {
	kind := "Delivery"
	if in.GofoodOrderType == "pickup" {
		kind = "Pickup"
	}
	parts := []string{"GoFood " + in.GofoodOrderID, kind}
	if in.Pin != "" {
		parts = append(parts, "PIN "+in.Pin)
	}
	if in.CustomerName != "" {
		parts = append(parts, "Pelanggan: "+in.CustomerName)
	}
	if in.Cutlery {
		parts = append(parts, "Minta alat makan")
	}
	if in.UnmappedCount > 0 {
		parts = append(parts, strconv.Itoa(in.UnmappedCount)+" item TIDAK terpetakan — cek halaman GoFood")
	}
	return strings.Join(parts, " · ")
}

// CanAccept: only a new or waiting order can be accepted.
func CanAccept(status string) bool { return status == "awaiting_acceptance" || status == "created" }

// CanReject: an accepted order can still be rejected (cancelled at GoFood).
func CanReject(status string) bool {
	return slices.Contains([]string{"awaiting_acceptance", "created", "accepted"}, status)
}

// NotifiesFoodReady: the KDS hook only tells GoFood about orders a driver
// is still coming for.
func NotifiesFoodReady(status string) bool {
	return slices.Contains([]string{"accepted", "driver_otw_pickup", "driver_arrived"}, status)
}

// TerminalPosStatus: setPosOrderStatus leaves these pos_orders alone.
func TerminalPosStatus(status string) bool {
	return slices.Contains([]string{"cancelled", "voided", "completed", "merged"}, status)
}

// PadReason is `description.trim().padEnd(3, ".")`: GoBiz wants at least
// three characters.
func PadReason(description string) string {
	s := jsTrim(description)
	for n := len([]rune(s)); n < 3; n++ {
		s += "."
	}
	return s
}

// ListLimit is `Math.min(200, Math.max(1, Number(raw || 50)))` rendered the
// way node-postgres sends a JS number ("NaN" included), so PostgreSQL
// rejects a fractional or non-numeric limit with the TS error message.
func ListLimit(raw string) string {
	if raw == "" {
		raw = "50"
	}
	n := math.Min(200, math.Max(1, jsNumber(raw)))
	if math.IsNaN(n) {
		return "NaN"
	}
	return strconv.FormatFloat(n, 'f', -1, 64)
}

// jsNumber is Number(string) for the query-string values a route sees.
func jsNumber(s string) float64 {
	s = jsTrim(s)
	switch s {
	case "":
		return 0
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if len(s) > 2 && s[0] == '0' {
		base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[s[1]]
		if base != 0 {
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	// ParseFloat also takes "inf", "nan", signed hex floats and "_"; JS does not.
	if strings.ContainsAny(s, "_iInNxXpP") {
		return math.NaN()
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// jsTrim is String.prototype.trim.
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' })
}
