// Package domain holds the pure GoFood rules the cashier routes use: the
// POS note of a GoFood order (lib/gobiz/mapping.ts posOrderNotes) and which
// cashier action a gofood_orders status allows (lib/gobiz/service.ts).
package domain

import (
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode"
)

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
