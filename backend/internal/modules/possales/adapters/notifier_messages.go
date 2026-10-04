package adapters

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/ports"
)

// Pure message builders of lib/wa/comp-notification.ts,
// notifications-messages.ts, notifications-config.ts and
// lib/giftcard/gift-card-wa.ts.

// compNotifTarget is the owner's number for comp notices.
const compNotifTarget = "6281809078014"

var wib = time.FixedZone("WIB", 7*3600)

var (
	longMonthsID = [...]string{"Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}
)

// longDateWIB is toLocaleDateString("id-ID", {day: "numeric", month:
// "long", year: "numeric"}) in the server zone (Asia/Jakarta).
func longDateWIB(t time.Time) string {
	w := t.In(wib)
	return strconv.Itoa(w.Day()) + " " + longMonthsID[w.Month()-1] + " " + strconv.Itoa(w.Year())
}

func trimOr(s *string, fallback string) string {
	if s == nil {
		return fallback
	}
	if v := domain.Trim(*s); v != "" {
		return v
	}
	return fallback
}

// compNotifLabel names the comp type.
func compNotifLabel(compType string) string {
	if compType == "foc_comp" {
		return "FOC (Free of Charge)"
	}
	return "Owner Comp"
}

// buildCompNotifMessage is the owner's comp alert.
func buildCompNotifMessage(n ports.CompNotice, customerName *string, now time.Time) string {
	order := n.OrderNumber
	if n.OrderCount > 1 {
		order += " (" + strconv.Itoa(n.OrderCount) + " order)"
	}
	return strings.Join([]string{
		"NüHabit OS — Komplimen " + compNotifLabel(n.CompType),
		"Order : " + order,
		"Customer : " + trimOr(customerName, "-"),
		"Nilai : Rp " + localeID(domain.RoundHalfUp(n.GrossIdr)),
		"Disetujui : " + trimOr(n.ApprovedName, "-"),
		domain.WaktuWIB(now) + " WIB",
	}, "\n")
}

// compDedupKey is `comp:<type>:<order>` cut to 160 UTF-16 units.
func compDedupKey(n ports.CompNotice) string {
	return sliceUTF16("comp:"+n.CompType+":"+n.OrderNumber, 160)
}

// sliceUTF16 is String.prototype.slice(0, n) for BMP text (runes ≈ units).
func sliceUTF16(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

// buildVoidBesarMessage is the large-void owner alert.
func buildVoidBesarMessage(orderNumber string, total float64, reason, supervisor string) string {
	return strings.Join([]string{
		"🚨 *Void Bernilai Besar*",
		"",
		"Order " + orderNumber + " senilai *Rp" + localeID(domain.RoundHalfUp(total)) + "* di-void.",
		"Alasan: " + sliceUTF16(reason, 200),
		"Disetujui: " + supervisor,
		"",
		"Cek POS → Laporan untuk rinciannya.",
	}, "\n")
}

// buildGiftCardSoldMessage is sendGiftCardSoldWa's text.
func buildGiftCardSoldMessage(buyerName *string, cards []ports.IssuedGiftCard) string {
	salam := ""
	if buyerName != nil && *buyerName != "" {
		salam = "Halo " + *buyerName + ",\n\n"
	}
	lines := make([]string, len(cards))
	for i, c := range cards {
		lines[i] = "• Kode: *" + c.Code + "*\n  Saldo: Rp" + localeID(c.InitialValue) + "\n" +
			"  Berlaku: " + formatGiftExpiry(c.ExpiresAt)
	}
	penutup := "\n\nSimpan kode ini baik-baik."
	if len(cards) > 1 {
		penutup = "\n\nSimpan semua kode di atas baik-baik."
	}
	return "*Gift Card aktif* 🎁\n\n" + salam +
		"Gift card kamu sudah aktif dan bisa langsung dipakai di kasir:\n\n" +
		strings.Join(lines, "\n") + penutup + " Siapa pun yang memegang kode ini bisa memakai saldonya."
}

// formatGiftExpiry renders expires_at JSON: a long WIB date, or
// "tanpa batas waktu" for null.
func formatGiftExpiry(raw json.RawMessage) string {
	var iso *string
	if json.Unmarshal(raw, &iso) != nil || iso == nil || *iso == "" {
		return "tanpa batas waktu"
	}
	t, err := time.Parse(time.RFC3339Nano, *iso)
	if err != nil {
		return "Invalid Date"
	}
	return longDateWIB(t)
}

// waNotifConfig is the part of WaNotifConfig the void alert reads.
type waNotifConfig struct {
	Enabled         bool
	Recipients      []string
	VoidBesar       bool
	VoidThresholdRp float64
}

var waRecipient = regexp.MustCompile(`^62\d{8,13}$`)
var notDigitPlus = regexp.MustCompile(`[^\d+]`)

// normalizeWaRecipient maps 08…/+62…/62… to 62xxxxxxxxxx ("" = invalid).
func normalizeWaRecipient(raw string) string {
	n := strings.TrimPrefix(notDigitPlus.ReplaceAllString(raw, ""), "+")
	if strings.HasPrefix(n, "0") {
		n = "62" + n[1:]
	}
	if !waRecipient.MatchString(n) {
		return ""
	}
	return n
}

// parseWaNotifConfig reads wa_notif_config with per-field defaults
// (disabled, no recipients, voidBesar on, threshold 500.000).
func parseWaNotifConfig(raw *string) waNotifConfig {
	cfg := waNotifConfig{VoidBesar: true, VoidThresholdRp: 500_000}
	if raw == nil || *raw == "" {
		return cfg
	}
	var o map[string]any
	if json.Unmarshal([]byte(*raw), &o) != nil || o == nil {
		return cfg
	}
	if list, ok := o["recipients"].([]any); ok {
		seen := map[string]bool{}
		var valid []string
		for _, r := range list {
			if s, ok := r.(string); ok {
				if n := normalizeWaRecipient(s); n != "" {
					valid = append(valid, n)
				}
			}
		}
		if len(valid) > 5 {
			valid = valid[:5]
		}
		for _, n := range valid {
			if !seen[n] {
				seen[n] = true
				cfg.Recipients = append(cfg.Recipients, n)
			}
		}
	}
	if types, ok := o["types"].(map[string]any); ok {
		if v, ok := types["voidBesar"].(bool); ok {
			cfg.VoidBesar = v
		}
	}
	if v, ok := o["voidThresholdRp"].(float64); ok && v >= 0 {
		cfg.VoidThresholdRp = domain.RoundHalfUp(v)
	}
	if v, ok := o["enabled"].(bool); ok {
		cfg.Enabled = v
	}
	return cfg
}
