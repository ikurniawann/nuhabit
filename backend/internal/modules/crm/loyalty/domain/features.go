package domain

import "encoding/json"

// Loyalty feature setting keys in crm_settings.
const (
	ArkCoinSettingKey = "ark_coin_enabled"
	XPSettingKey      = "xp_enabled"
)

// Features mirrors LoyaltyFeatures; both default to enabled.
type Features struct {
	ArkCoin bool `json:"arkCoin"`
	XP      bool `json:"xp"`
}

// DefaultFeatures is DEFAULT_LOYALTY_FEATURES.
var DefaultFeatures = Features{ArkCoin: true, XP: true}

func toBool(raw json.RawMessage, fallback bool) bool {
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return fallback
	}
	switch x := v.(type) {
	case bool:
		return x
	case string:
		switch x {
		case "true", "1":
			return true
		case "false", "0":
			return false
		}
	case float64:
		switch x {
		case 1:
			return true
		case 0:
			return false
		}
	}
	return fallback
}

// ParseFeatures mirrors parseLoyaltyFeatures over crm_settings values (jsonb).
func ParseFeatures(values map[string]json.RawMessage) Features {
	f := DefaultFeatures
	if raw, ok := values[ArkCoinSettingKey]; ok {
		f.ArkCoin = toBool(raw, DefaultFeatures.ArkCoin)
	}
	if raw, ok := values[XPSettingKey]; ok {
		f.XP = toBool(raw, DefaultFeatures.XP)
	}
	return f
}
