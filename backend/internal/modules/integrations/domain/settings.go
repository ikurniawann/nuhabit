package domain

import (
	"regexp"
	"strings"
	"unicode/utf16"

	"nuhabit/backend/internal/platform/validate"
)

/* ── AI providers (settings/integrations) ────────────────────────────── */

// ProviderDefaults are DEEPSEEK_DEFAULTS / OPENAI_DEFAULTS.
type ProviderDefaults struct{ Model, BaseURL string }

var (
	DeepSeekDefaults = ProviderDefaults{"deepseek-chat", "https://api.deepseek.com"}
	OpenAIDefaults   = ProviderDefaults{"gpt-4o-mini", "https://api.openai.com/v1"}
)

// ProviderInput is one provider's partial {api_key, model, base_url}. A
// nil pointer is undefined (unchanged); APIKeyNull marks api_key: null.
type ProviderInput struct {
	APIKey     *string
	APIKeyNull bool
	Model      *string
	BaseURL    *string
}

var httpScheme = regexp.MustCompile(`^https?://`)

// ParseProviderInput is validateProviderInput: the 400 message (with the
// provider prefix) of the first invalid field, or "".
func ParseProviderInput(o map[string]any, prefix string) (ProviderInput, string) {
	var in ProviderInput
	if v, sent := o["api_key"]; sent {
		switch x := v.(type) {
		case nil:
			in.APIKeyNull = true
		case string:
			in.APIKey = &x
		default:
			return in, prefix + "api_key tidak valid"
		}
	}
	if v, sent := o["model"]; sent {
		s, ok := v.(string)
		if !ok || validate.JSTrim(s) == "" {
			return in, prefix + "model tidak valid"
		}
		in.Model = &s
	}
	if v, sent := o["base_url"]; sent {
		s, ok := v.(string)
		if !ok || !httpScheme.MatchString(validate.JSTrim(s)) {
			return in, prefix + "base_url tidak valid"
		}
		in.BaseURL = &s
	}
	return in, ""
}

/* ── Google Business Profile ─────────────────────────────────────────── */

// WithPrefix is withPrefix: "123" or "accounts/123" -> "accounts/123"
// (slashes around the value dropped), "" stays "".
func WithPrefix(value, prefix string) string {
	trimmed := strings.Trim(validate.JSTrim(value), "/")
	if trimmed == "" || strings.HasPrefix(trimmed, prefix+"/") {
		return trimmed
	}
	return prefix + "/" + trimmed
}

// ParseLocationIDs is parseLocationIds: locations separated by commas,
// semicolons or spaces, each as "locations/{id}", duplicates dropped.
func ParseLocationIDs(raw string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ';' || unicodeSpace(r) }) {
		cleaned := strings.Trim(validate.JSTrim(part), "/")
		if cleaned == "" {
			continue
		}
		if !strings.HasPrefix(cleaned, "locations/") {
			cleaned = "locations/" + cleaned
		}
		if cleaned == "locations/" || seen[cleaned] {
			continue
		}
		seen[cleaned] = true
		out = append(out, cleaned)
	}
	return out
}

/* ── payment gateways (lib/configuration/payment-gateways.ts) ─────────── */

// MaskGatewaySecret is that file's maskSecret: null when blank, eight
// asterisks up to 8 units, else first 4 + 4-8 asterisks + last 4.
func MaskGatewaySecret(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := validate.JSTrim(*value)
	if trimmed == "" {
		return nil
	}
	units := utf16.Encode([]rune(trimmed))
	m := "********"
	if len(units) > 8 {
		stars := min(8, max(4, len(units)-8))
		m = string(utf16.Decode(units[:4])) + strings.Repeat("*", stars) + string(utf16.Decode(units[len(units)-4:]))
	}
	return &m
}

// HasGatewaySecret is Boolean(value && String(value).trim()).
func HasGatewaySecret(value *string) bool {
	return value != nil && validate.JSTrim(*value) != ""
}

var fourStars = regexp.MustCompile(`\*{4,}`)

// KeepExistingSecret is shouldKeepExistingSecret: an empty or masked value
// keeps the stored secret.
func KeepExistingSecret(value *string) bool {
	if value == nil {
		return true
	}
	t := validate.JSTrim(*value)
	return t == "" || strings.Contains(t, "…") || strings.Contains(t, "••••") || strings.Contains(t, "****") || fourStars.MatchString(t)
}
