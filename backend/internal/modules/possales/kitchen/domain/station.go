// Package domain holds the pure kitchen rules of pos-sales: which station an
// item goes to (lib/pos/kitchen-station.ts), the kitchen status of items and
// orders (lib/pos/kds-status.ts), the print-queue job rows built when an order
// is placed, and the print-queue status rules of /api/pos/print-jobs.
package domain

import (
	"regexp"
	"slices"
	"strings"
)

// Stations is POS_STATIONS.
var Stations = []string{"kitchen", "bar", "bakery", "dessert", "merchandise", "photobooth"}

// IsStation reports whether s is one of Stations (exact, already lowercased).
func IsStation(s string) bool { return slices.Contains(Stations, s) }

var (
	barWords    = regexp.MustCompile(`kopi|coffee|tea|teh|minuman|drink|juice|jus|soda|es|latte|cappuccino|mocktail|milkshake|bar`)
	bakeryWords = regexp.MustCompile(`roti|bread|pastry|cake|kue|croissant|donut|dessert|ice cream|gelato|bakery`)
)

// NormalizeStation is normalizeStation(value, productName, kitchenNotes): a
// valid station (trimmed, case-insensitive) wins; otherwise the product name
// and kitchen notes pick "bar", "bakery" or "kitchen" by keyword.
//
// Pass "" for a NULL/undefined argument. The TS one-argument call
// normalizeStation(station) defaults productName and kitchenNotes to "", so it
// is NormalizeStation(station, "", ""): an unknown station then always falls
// back to "kitchen" (the haystack is a single space).
func NormalizeStation(station, productName, kitchenNotes string) string {
	if lower := strings.ToLower(strings.TrimSpace(station)); IsStation(lower) {
		return lower
	}
	haystack := strings.ToLower(productName + " " + kitchenNotes)
	switch {
	case barWords.MatchString(haystack):
		return "bar"
	case bakeryWords.MatchString(haystack):
		return "bakery"
	}
	return "kitchen"
}

// ResolvePosStation is resolvePosStation(explicit, kategori): the explicit
// station when valid, else the keyword heuristic on the product category.
func ResolvePosStation(explicit, kategori string) string {
	return NormalizeStation(explicit, kategori, "")
}
