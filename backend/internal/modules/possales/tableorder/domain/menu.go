// Package domain holds the pure rules of table self-order: the menu shape and
// add-on validation (lib/table-order/menu.ts), bill charges
// (lib/pos/billing-settings.ts), guest identity (guest.ts), payment-flow
// labels (order-status.ts), member discounts and privileges, the staff order
// alert text and the Xendit paid check.
package domain

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"
)

// UncategorizedID and UncategorizedLabel name the bucket of products without
// a category.
const (
	UncategorizedID    = "__lainnya"
	UncategorizedLabel = "Lainnya"
)

// Variant is TableOrderVariant.
type Variant struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	PriceAdjustment float64 `json:"priceAdjustment"`
}

// Modifier is TableOrderModifier (an add-on).
type Modifier struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	PriceAdjustment float64 `json:"priceAdjustment"`
}

// ModifierGroup is TableOrderModifierGroup.
type ModifierGroup struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	MinSelection float64    `json:"minSelection"`
	MaxSelection float64    `json:"maxSelection"`
	Modifiers    []Modifier `json:"modifiers"`
}

// SelectedModifier is a chosen add-on with its group name.
type SelectedModifier struct {
	Modifier
	GroupName string
}

// Product is TableOrderProduct, in its JSON key order.
type Product struct {
	ID              string          `json:"id"`
	SKU             string          `json:"sku"`
	Name            string          `json:"name"`
	Description     string          `json:"description"`
	Price           float64         `json:"price"`
	XP              float64         `json:"xp"`
	Station         string          `json:"station"`
	StationLabel    string          `json:"stationLabel"`
	Image           *string         `json:"image"`
	CategoryID      *string         `json:"categoryId"`
	CategoryName    string          `json:"categoryName"`
	PrepTimeMinutes float64         `json:"prepTimeMinutes"`
	MinXP           float64         `json:"minXp"`
	Variants        []Variant       `json:"variants"`
	ModifierGroups  []ModifierGroup `json:"modifierGroups"`
	Customizable    bool            `json:"customizable"`
}

// Category is TableOrderCategory.
type Category struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// ProductRow is ProductRowInput: one pos_products row with its variants and
// add-on groups as JSON (a json_agg result). Nil pointers are SQL NULL.
type ProductRow struct {
	ID              string
	SKU             *string
	Name            string
	Description     *string
	BasePrice       *float64
	ImageURL        *string
	XPPoints        *float64
	Station         *string
	PrepTimeMinutes *float64
	MinXP           *float64
	CategoryID      *string
	CategoryName    *string
	Variants        []byte
	ModifierGroups  []byte
}

// JSRound is Math.round.
func JSRound(x float64) float64 { return math.Floor(x + 0.5) }

// JSTrim is String.prototype.trim.
func JSTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' })
}

// ToNumber is toNumber in menu.ts: Number(value), 0 when not finite.
func ToNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		if math.IsInf(x, 0) || math.IsNaN(x) {
			return 0
		}
		return x
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		s := JSTrim(x)
		if s == "" {
			return 0
		}
		n, err := strconv.ParseFloat(s, 64)
		if err != nil || math.IsInf(n, 0) {
			return 0
		}
		return n
	}
	return 0
}

// JSString is String(value) for the scalars a JSON row holds.
func JSString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	}
	return fmt.Sprint(v)
}

// Truthy is JS truthiness for a JSON value.
func Truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case string:
		return x != ""
	case float64:
		return x != 0 && !math.IsNaN(x)
	case bool:
		return x
	}
	return true
}

// parseJSONArray is parseJSONArray: a malformed or non-array value is [].
func parseJSONArray(raw []byte) []map[string]any {
	var list []any
	if len(raw) == 0 || json.Unmarshal(raw, &list) != nil {
		return nil
	}
	out := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func parseModifierGroups(raw []byte) []ModifierGroup {
	groups := []ModifierGroup{}
	for _, g := range parseJSONArray(raw) {
		if !Truthy(g["id"]) {
			continue
		}
		group := ModifierGroup{
			ID:           JSString(g["id"]),
			Name:         orDefault(JSTrim(JSOr(g["name"])), "Tambahan"),
			MinSelection: math.Max(0, JSRound(ToNumber(g["min_selection"]))),
			MaxSelection: math.Max(1, orOne(JSRound(ToNumber(g["max_selection"])))),
			Modifiers:    []Modifier{},
		}
		mods, _ := g["modifiers"].([]any)
		for _, item := range mods {
			m, ok := item.(map[string]any)
			if !ok || !Truthy(m["id"]) {
				continue
			}
			group.Modifiers = append(group.Modifiers, Modifier{
				ID:              JSString(m["id"]),
				Name:            JSTrim(JSOr(m["name"])),
				PriceAdjustment: ToNumber(m["price_adjustment"]),
			})
		}
		if len(group.Modifiers) > 0 {
			groups = append(groups, group)
		}
	}
	return groups
}

// JSOr is String(value || "").
func JSOr(v any) string {
	if !Truthy(v) {
		return ""
	}
	return JSString(v)
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// orOne is `x || 1` for a number.
func orOne(x float64) float64 {
	if x == 0 || math.IsNaN(x) {
		return 1
	}
	return x
}

func strOr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func numOr(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// NormalizeProduct is normalizeTableOrderProduct.
func NormalizeProduct(row ProductRow) Product {
	variants := []Variant{}
	for _, v := range parseJSONArray(row.Variants) {
		if !Truthy(v["id"]) {
			continue
		}
		if active, ok := v["is_active"].(bool); ok && !active {
			continue
		}
		variants = append(variants, Variant{
			ID:              JSString(v["id"]),
			Name:            orDefault(JSTrim(JSOr(v["name"])), "Regular"),
			PriceAdjustment: ToNumber(v["price_adjustment"]),
		})
	}
	groups := parseModifierGroups(row.ModifierGroups)
	station := orDefault(strings.ToLower(JSTrim(orDefault(strOr(row.Station), "kitchen"))), "kitchen")

	p := Product{
		ID:              row.ID,
		SKU:             orDefault(strOr(row.SKU), row.ID),
		Name:            row.Name,
		Description:     JSTrim(strOr(row.Description)),
		Price:           math.Max(0, numOr(row.BasePrice)),
		XP:              math.Max(0, JSRound(numOr(row.XPPoints))),
		Station:         station,
		StationLabel:    StationLabel(station),
		CategoryName:    orDefault(JSTrim(strOr(row.CategoryName)), UncategorizedLabel),
		PrepTimeMinutes: math.Max(0, JSRound(numOr(row.PrepTimeMinutes))),
		MinXP:           math.Max(0, JSRound(numOr(row.MinXP))),
		Variants:        variants,
		ModifierGroups:  groups,
		Customizable:    len(variants) > 1 || len(groups) > 0,
	}
	if img := JSTrim(strOr(row.ImageURL)); img != "" {
		p.Image = &img
	}
	if row.CategoryID != nil && *row.CategoryID != "" {
		p.CategoryID = row.CategoryID
	}
	return p
}

// stationLabels is POS_STATION_OPTIONS.
var stationLabels = map[string]string{
	"kitchen": "Kitchen", "bar": "Bar", "bakery": "Bakery",
	"dessert": "Dessert", "merchandise": "Merchandise", "photobooth": "Photobooth",
}

// StationLabel is posStationLabel.
func StationLabel(value string) string {
	station := strings.ToLower(JSTrim(value))
	if label, ok := stationLabels[station]; ok {
		return label
	}
	return orDefault(station, "-")
}

// ResolveVariant is resolveVariant: no variants → nil; no choice → the
// first; an unknown id → nil (the server rejects it).
func ResolveVariant(p Product, variantID string) *Variant {
	if len(p.Variants) == 0 {
		return nil
	}
	if variantID == "" {
		return &p.Variants[0]
	}
	for i := range p.Variants {
		if p.Variants[i].ID == variantID {
			return &p.Variants[i]
		}
	}
	return nil
}

// UnitPrice is unitPriceFor: base + variant + add-ons, rounded, at least 0.
func UnitPrice(p Product, v *Variant, mods []SelectedModifier) float64 {
	price := p.Price
	if v != nil {
		price += v.PriceAdjustment
	}
	addOns := 0.0
	for _, m := range mods {
		addOns += m.PriceAdjustment
	}
	return math.Max(0, JSRound(price+addOns))
}

// ResolveModifiers is resolveModifiers: every id must belong to one of the
// product's groups, no id twice, and each group's min/max must hold. It
// returns the Indonesian error the route answers with 409.
func ResolveModifiers(p Product, ids []string) ([]SelectedModifier, string) {
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			return nil, fmt.Sprintf("Tambahan %s dipilih ganda — pilih ulang", p.Name)
		}
		seen[id] = true
	}
	selected := []SelectedModifier{}
	perGroup := map[string]float64{}
	for _, id := range ids {
		found := false
		for _, g := range p.ModifierGroups {
			for _, m := range g.Modifiers {
				if m.ID == id {
					selected = append(selected, SelectedModifier{Modifier: m, GroupName: g.Name})
					perGroup[g.ID]++
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		if !found {
			return nil, fmt.Sprintf("Tambahan %s tidak dikenal — pilih ulang", p.Name)
		}
	}
	for _, g := range p.ModifierGroups {
		count := perGroup[g.ID]
		if count > g.MaxSelection {
			return nil, fmt.Sprintf("%s: maksimal %s pilihan", g.Name, JSString(g.MaxSelection))
		}
		if count < g.MinSelection {
			return nil, fmt.Sprintf("%s: wajib pilih %s", g.Name, JSString(g.MinSelection))
		}
	}
	return selected, ""
}

// BuildCategories is buildCategories: categories in order of first product,
// with counts.
func BuildCategories(products []Product) []Category {
	out := []Category{}
	index := map[string]int{}
	for _, p := range products {
		id := UncategorizedID
		if p.CategoryID != nil {
			id = *p.CategoryID
		}
		if i, ok := index[id]; ok {
			out[i].Count++
			continue
		}
		index[id] = len(out)
		out = append(out, Category{ID: id, Name: p.CategoryName, Count: 1})
	}
	return out
}
