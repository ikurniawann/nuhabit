package domain

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"
)

// OrderAlertKey is ORDER_ALERT_SETTING_KEY (lib/notifications/order-alert.ts).
const OrderAlertKey = "order_alert_config"

// RoleOption is one ORDER_ALERT_ROLE_OPTIONS entry.
type RoleOption struct {
	Code  string `json:"code"`
	Label string `json:"label"`
}

// OrderAlertRoles is ORDER_ALERT_ROLE_OPTIONS.
var OrderAlertRoles = []RoleOption{
	{Code: "pos", Label: "POS (kasir/bar)"},
	{Code: "pos_supervisor", Label: "POS Supervisor"},
}

// OrderAlertRoleCodes are the codes of OrderAlertRoles.
func OrderAlertRoleCodes() []string {
	codes := make([]string, len(OrderAlertRoles))
	for i, r := range OrderAlertRoles {
		codes[i] = r.Code
	}
	return codes
}

// OrderAlertConfig is OrderAlertConfig.
type OrderAlertConfig struct {
	WaEnabled       bool     `json:"waEnabled"`
	WaRoles         []string `json:"waRoles"`
	TelegramEnabled bool     `json:"telegramEnabled"`
}

func defaultOrderAlertConfig() OrderAlertConfig {
	return OrderAlertConfig{WaEnabled: true, WaRoles: []string{"pos"}, TelegramEnabled: true}
}

// ParseOrderAlertConfig is parseOrderAlertConfig: the stored JSON with
// unknown roles dropped, defaults for anything missing or malformed.
func ParseOrderAlertConfig(raw *string) OrderAlertConfig {
	out := defaultOrderAlertConfig()
	if raw == nil || *raw == "" {
		return out
	}
	var v map[string]any
	if json.Unmarshal([]byte(*raw), &v) != nil || v == nil {
		return out
	}
	if b, ok := v["waEnabled"].(bool); ok {
		out.WaEnabled = b
	}
	if list, ok := v["waRoles"].([]any); ok {
		allowed := OrderAlertRoleCodes()
		out.WaRoles = []string{}
		for _, item := range list {
			if s, ok := item.(string); ok && slices.Contains(allowed, s) {
				out.WaRoles = append(out.WaRoles, s)
			}
		}
	}
	if b, ok := v["telegramEnabled"].(bool); ok {
		out.TelegramEnabled = b
	}
	return out
}

var nonDigit = regexp.MustCompile(`[^0-9]`)

// NormalizeWaPhone is normalizeWaPhone (lib/pos/receipt-wa.ts): digits in
// 62xx form, or nil when shorter than 11 or longer than 16 digits.
func NormalizeWaPhone(raw *string) *string {
	if raw == nil || *raw == "" {
		return nil
	}
	digits := nonDigit.ReplaceAllString(*raw, "")
	if digits == "" {
		return nil
	}
	var n string
	switch {
	case strings.HasPrefix(digits, "0"):
		n = "62" + digits[1:]
	case strings.HasPrefix(digits, "62"):
		n = digits
	default:
		n = "62" + digits
	}
	if len(n) < 11 || len(n) > 16 {
		return nil
	}
	return &n
}

// MaskPhone is the order-alerts route's maskPhone.
func MaskPhone(phone *string) *string {
	if phone == nil || *phone == "" {
		return nil
	}
	p := *phone
	tail := p
	if len(p) > 3 {
		tail = p[len(p)-3:]
	}
	head := p
	if len(p) > 4 {
		head = p[:4]
	}
	out := head + "••••" + tail
	return &out
}

var telegramToken = regexp.MustCompile(`^\d{5,15}:[A-Za-z0-9_-]{30,50}$`)

// IsTelegramBotToken is isTelegramBotToken (lib/telegram/client.ts).
func IsTelegramBotToken(value string) bool { return telegramToken.MatchString(TrimJS(value)) }

// TelegramChatID is the chat_id pattern of the order-alerts POST schema.
var TelegramChatID = regexp.MustCompile(`^-?\d{1,20}$`)
