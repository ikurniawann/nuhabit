package adapters

import (
	"encoding/json"
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
