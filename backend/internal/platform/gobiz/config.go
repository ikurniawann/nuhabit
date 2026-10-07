// Package gobiz is the GoBiz Direct Integration client (lib/gobiz/client.ts)
// and its settings (lib/gobiz/config.ts). The integrations module uses it
// for the settings page, the webhook's auto-accept and the catalog sync;
// pos-sales for the cashier's accept, reject and food-ready calls. Loading
// the settings stays with each caller.
package gobiz

import (
	"strings"
	"unicode"
)

// Environments (GobizEnvironment).
const (
	Sandbox    = "sandbox"
	Production = "production"
)

// Scopes is GOBIZ_SCOPES, sent with every client_credentials token request.
const Scopes = "gofood:catalog:write gofood:catalog:read gofood:order:write gofood:order:read gofood:outlet:write promo:food_promo:read promo:food_promo:write"

// The app_settings keys (SETTING_KEYS.GOBIZ_*).
const (
	KeyEnabled          = "gobiz_enabled"
	KeyEnvironment      = "gobiz_environment"
	KeyClientID         = "gobiz_client_id"
	KeyClientSecret     = "gobiz_client_secret"
	KeyOutletID         = "gobiz_outlet_id"
	KeyWebhookToken     = "gobiz_webhook_token"
	KeyAutoAccept       = "gobiz_auto_accept"
	KeyOAuthURL         = "gobiz_oauth_url"
	KeyAPIBaseURL       = "gobiz_api_base_url"
	KeyPartnerID        = "gobiz_partner_id"
	KeyRelaySecret      = "gobiz_relay_secret"
	KeySignatureEnforce = "gobiz_signature_enforce"
)

// SettingKeys are the keys loadGobizConfig reads.
var SettingKeys = []string{
	KeyEnabled, KeyEnvironment, KeyClientID, KeyClientSecret, KeyOutletID, KeyWebhookToken,
	KeyAutoAccept, KeyOAuthURL, KeyAPIBaseURL, KeyPartnerID, KeyRelaySecret, KeySignatureEnforce,
}

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

// ConfigFromSettings is loadGobizConfig over getSettings' map (nil = row
// missing or NULL).
func ConfigFromSettings(s map[string]*string) Config {
	get := func(key string) string {
		if v := s[key]; v != nil {
			return *v
		}
		return ""
	}
	env := NormalizeEnvironment(get(KeyEnvironment))
	apiBase, oauthURL := ResolveURLs(env, get(KeyAPIBaseURL), get(KeyOAuthURL))
	return Config{
		Enabled:          get(KeyEnabled) == "true",
		Environment:      env,
		ClientID:         jsTrim(get(KeyClientID)),
		ClientSecret:     jsTrim(get(KeyClientSecret)),
		OutletID:         jsTrim(get(KeyOutletID)),
		WebhookToken:     jsTrim(get(KeyWebhookToken)),
		AutoAccept:       get(KeyAutoAccept) == "true",
		PartnerID:        jsTrim(get(KeyPartnerID)),
		RelaySecret:      jsTrim(get(KeyRelaySecret)),
		EnforceSignature: get(KeySignatureEnforce) == "true",
		APIBase:          apiBase,
		OAuthURL:         oauthURL,
	}
}

// PadReason is `description.trim().padEnd(3, ".")`: GoBiz wants a cancel
// reason of at least three characters.
func PadReason(description string) string {
	s := jsTrim(description)
	for n := len([]rune(s)); n < 3; n++ {
		s += "."
	}
	return s
}

// jsTrim is String.prototype.trim.
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' })
}
