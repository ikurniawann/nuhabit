package domain

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// AlertItem is one line of OrderAlertInput.items.
type AlertItem struct {
	Name      string
	Quantity  int
	Variant   string
	Modifiers []string
}

// OrderAlert is OrderAlertInput (lib/notifications/order-alert.ts). Empty
// strings stand for null.
type OrderAlert struct {
	BrandName    string
	SourceLabel  string
	TableLabel   string
	OrderType    string
	QueueNumber  string
	OrderNumber  string
	PaymentLabel string
	Paid         bool
	GuestName    string
	GuestPhone   string
	IsMember     bool
	CustomerNote string
	Total        float64
	Items        []AlertItem
	ActionURL    string
}

// rupiah is `Rp${Math.round(v).toLocaleString("id-ID")}`.
func rupiah(v float64) string {
	n := int64(JSRound(v))
	sign := ""
	if n < 0 {
		sign, n = "-", -n
	}
	digits := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, d := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(d)
	}
	return "Rp" + sign + b.String()
}

func localPhone(phone string) string {
	if strings.HasPrefix(phone, "62") {
		return "0" + phone[2:]
	}
	return phone
}

// BuildOrderAlertMessage is buildOrderAlertMessage: the plain text sent to
// staff over WhatsApp and Telegram.
func BuildOrderAlertMessage(in OrderAlert) string {
	place := []string{}
	if in.TableLabel != "" {
		place = append(place, "Meja "+in.TableLabel)
	}
	if in.OrderType == "takeaway" {
		place = append(place, "Bawa pulang")
	} else {
		place = append(place, "Makan di tempat")
	}
	queue := in.QueueNumber
	if queue == "" {
		queue = "-"
	}
	lines := []string{
		"🛎️ Pesanan baru — " + in.SourceLabel,
		in.BrandName,
		strings.Join(place, " · "),
		fmt.Sprintf("Antrean %s · %s", queue, in.OrderNumber),
	}
	if in.GuestName != "" {
		who := "Atas nama: " + in.GuestName
		if in.IsMember {
			who += " (member)"
		}
		if in.GuestPhone != "" {
			who += " · WA " + localPhone(in.GuestPhone)
		}
		lines = append(lines, who)
	}
	lines = append(lines, "")
	for _, item := range in.Items {
		extras := []string{}
		if item.Variant != "" {
			extras = append(extras, item.Variant)
		}
		for _, m := range item.Modifiers {
			if m != "" {
				extras = append(extras, m)
			}
		}
		line := fmt.Sprintf("• %d× %s", item.Quantity, item.Name)
		if len(extras) > 0 {
			line += " (" + strings.Join(extras, ", ") + ")"
		}
		lines = append(lines, line)
	}
	if in.CustomerNote != "" {
		lines = append(lines, "\nCatatan: "+in.CustomerNote)
	}
	status := " (belum dibayar)"
	if in.Paid {
		status = " (lunas)"
	}
	lines = append(lines, "", fmt.Sprintf("Total %s · %s%s", rupiah(in.Total), in.PaymentLabel, status))
	if in.ActionURL != "" {
		lines = append(lines, "\n👉 Buatkan Pesanan: "+in.ActionURL)
	}
	return JSTrim(strings.Join(lines, "\n"))
}

// AlertConfig is OrderAlertConfig.
type AlertConfig struct {
	WAEnabled       bool
	WARoles         []string
	TelegramEnabled bool
}

// ParseAlertConfig is parseOrderAlertConfig: the order_alert_config setting
// with defaults (WA to role "pos", Telegram on); unknown roles are dropped.
func ParseAlertConfig(raw string) AlertConfig {
	cfg := AlertConfig{WAEnabled: true, WARoles: []string{"pos"}, TelegramEnabled: true}
	if raw == "" {
		return cfg
	}
	var v map[string]any
	if json.Unmarshal([]byte(raw), &v) != nil {
		return cfg
	}
	if b, ok := v["waEnabled"].(bool); ok {
		cfg.WAEnabled = b
	}
	if b, ok := v["telegramEnabled"].(bool); ok {
		cfg.TelegramEnabled = b
	}
	if roles, ok := v["waRoles"].([]any); ok {
		cfg.WARoles = []string{}
		for _, r := range roles {
			if s := JSString(r); s == "pos" || s == "pos_supervisor" {
				cfg.WARoles = append(cfg.WARoles, s)
			}
		}
	}
	return cfg
}

// NormalizeWAPhone is normalizeWaPhone (lib/pos/receipt-wa.ts): 62-prefixed
// digits of 11..16 characters, "" otherwise.
func NormalizeWAPhone(raw string) string {
	digits := nonDigits.ReplaceAllString(raw, "")
	switch {
	case digits == "":
		return ""
	case strings.HasPrefix(digits, "0"):
		digits = "62" + digits[1:]
	case !strings.HasPrefix(digits, "62"):
		digits = "62" + digits
	}
	if len(digits) < 11 || len(digits) > 16 {
		return ""
	}
	return digits
}
