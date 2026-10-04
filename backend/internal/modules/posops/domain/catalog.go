package domain

import (
	"math"
	"regexp"
	"slices"
	"strings"
	"unicode/utf16"
)

// Column is one column, value pair of an insert or update, in JS key order.
type Column struct {
	Name  string
	Value any
}

// Columns is an ordered column set: setting an existing name replaces the
// value in place, like assigning a key of a JS object.
type Columns []Column

// Set adds or replaces name.
func (c *Columns) Set(name string, v any) {
	for i := range *c {
		if (*c)[i].Name == name {
			(*c)[i].Value = v
			return
		}
	}
	*c = append(*c, Column{name, v})
}

// Get returns the value of name and whether it is present.
func (c Columns) Get(name string) (any, bool) {
	for _, col := range c {
		if col.Name == name {
			return col.Value, true
		}
	}
	return nil, false
}

// Len16 is JS String.length (UTF-16 code units).
func Len16(s string) int { return len(utf16.Encode([]rune(s))) }

/* ── Stations and channels ───────────────────────────────────────────── */

// PosStations are the kitchen stations a product prints to.
var PosStations = []string{"kitchen", "bar", "bakery", "dessert", "merchandise", "photobooth"}

// NormalizeStation is the routes' normalizeStation: a known station or
// "kitchen".
func NormalizeStation(v any) string {
	if !Truthy(v) {
		v = ""
	}
	s := strings.ToLower(TrimJS(String(v)))
	if slices.Contains(PosStations, s) {
		return s
	}
	return "kitchen"
}

var (
	barWords    = regexp.MustCompile(`kopi|coffee|tea|teh|minuman|drink|juice|jus|soda|es|latte|cappuccino|mocktail|milkshake|bar`)
	bakeryWords = regexp.MustCompile(`roti|bread|pastry|cake|kue|croissant|donut|dessert|ice cream|gelato|bakery`)
)

// ResolvePosStation mirrors resolvePosStation: an explicit station, else a
// guess from the purchasing category.
func ResolvePosStation(explicit, kategori string) string {
	if s := strings.ToLower(TrimJS(explicit)); slices.Contains(PosStations, s) {
		return s
	}
	haystack := strings.ToLower(kategori + " ")
	switch {
	case barWords.MatchString(haystack):
		return "bar"
	case bakeryWords.MatchString(haystack):
		return "bakery"
	}
	return "kitchen"
}

// SalesChannelCodes are the pos_products.sales_channels values.
var SalesChannelCodes = []string{"pos", "self_order", "gofood", "grabfood", "shopeefood"}

// NormalizeSalesChannels mirrors normalizeSalesChannels: known codes, de
// duplicated in order; nil means every channel.
func NormalizeSalesChannels(v any) []string {
	var list []any
	switch x := v.(type) {
	case nil, Undefined:
		return nil
	case []any:
		list = x
	case []string:
		for _, s := range x {
			list = append(list, s)
		}
	case string:
		for _, s := range parsePgArray(x) {
			list = append(list, s)
		}
	}
	var seen, codes []string
	for _, item := range list {
		s := TrimJS(String(item))
		if !slices.Contains(seen, s) {
			seen = append(seen, s)
			if slices.Contains(SalesChannelCodes, s) {
				codes = append(codes, s)
			}
		}
	}
	if len(codes) == 0 {
		return nil
	}
	return codes
}

func parsePgArray(v string) []string {
	t := strings.TrimSpace(v)
	if !strings.HasPrefix(t, "{") || !strings.HasSuffix(t, "}") {
		return nil
	}
	var out []string
	for _, item := range strings.Split(t[1:len(t)-1], ",") {
		item = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(item, `"`), `"`))
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}

// IsSoldIn mirrors isSoldIn: no channel list means every channel.
func IsSoldIn(channels any, code string) bool {
	list := NormalizeSalesChannels(channels)
	return list == nil || slices.Contains(list, code)
}

// ValidSalesChannelList is the PATCH guard: null, or an array of known codes.
func ValidSalesChannelList(v any) bool {
	if v == nil {
		return true
	}
	list, ok := v.([]any)
	if !ok {
		return false
	}
	for _, code := range list {
		if !slices.Contains(SalesChannelCodes, String(code)) {
			return false
		}
	}
	return true
}

/* ── Merchandise fields (lib/pos/merchandise-fields.ts) ──────────────── */

// ProductKinds are the pos_products.product_kind values.
var ProductKinds = []string{"regular", "gift_card", "merchandise"}

// nullableNonNegative is toNullableNumber.
func nullableNonNegative(v any) any {
	if IsNullish(v) || v == "" {
		return nil
	}
	f := Number(v)
	if Finite(f) && f >= 0 {
		return f
	}
	return nil
}

// MerchandiseColumns mirrors buildMerchandiseColumns: only the fields
// present in body, in its order. errMsg is the 400 text.
func MerchandiseColumns(body any) (cols Columns, errMsg string) {
	if v := Field(body, "product_kind"); !IsUndef(v) {
		if !Truthy(v) {
			v = ""
		}
		kind := strings.ToLower(TrimJS(String(v)))
		if !slices.Contains(ProductKinds, kind) {
			return nil, "product_kind tidak valid (regular|gift_card|merchandise)"
		}
		cols.Set("product_kind", kind)
		if kind == "merchandise" && IsUndef(Field(body, "inventory_tracking")) {
			cols.Set("inventory_tracking", true)
		}
	}
	if v := Field(body, "source_product_id"); !IsUndef(v) {
		if Truthy(v) {
			cols.Set("source_product_id", String(v))
		} else {
			cols.Set("source_product_id", nil)
		}
	}
	if v := Field(body, "inventory_tracking"); !IsUndef(v) {
		cols.Set("inventory_tracking", Truthy(v))
	}
	if v := Field(body, "inventory_quantity"); !IsUndef(v) {
		if n := nullableNonNegative(v); n != nil {
			cols.Set("inventory_quantity", n)
		} else {
			cols.Set("inventory_quantity", 0.0)
		}
	}
	for _, key := range []string{"weight_gram", "length_cm", "width_cm", "height_cm"} {
		if v := Field(body, key); !IsUndef(v) {
			cols.Set(key, nullableNonNegative(v))
		}
	}
	if v := Field(body, "long_description"); !IsUndef(v) {
		if Truthy(v) {
			cols.Set("long_description", String(v))
		} else {
			cols.Set("long_description", nil)
		}
	}
	return cols, ""
}

// MinXp is the member privilege threshold column on create: null when
// absent or <= 0, else Math.floor (NaN for a non-numeric value).
func MinXp(raw any) any {
	if IsNullish(raw) || Number(raw) <= 0 {
		return nil
	}
	return math.Floor(Number(raw))
}

// MinXpUpdate is the PATCH variant: "" is null too, and a floor of 0 or
// NaN falls back to null (`Math.floor(n) || null`).
func MinXpUpdate(raw any) any {
	if raw == nil || raw == "" || Number(raw) <= 0 {
		return nil
	}
	n := math.Floor(Number(raw))
	if n == 0 || math.IsNaN(n) {
		return nil
	}
	return n
}

/* ── SKU payload (lib/pos/merchandise-sku-payload.ts) ────────────────── */

// SkuColumns mirrors normalizeSkuPayload; requireCore demands sku and name.
func SkuColumns(body any, requireCore bool) (cols Columns, errMsg string) {
	text := func(v any) string {
		if !Truthy(v) {
			return ""
		}
		return TrimJS(String(v))
	}
	if v := Field(body, "sku"); !IsUndef(v) || requireCore {
		sku := text(v)
		switch {
		case sku == "":
			return nil, "Kode SKU wajib diisi"
		case Len16(sku) > 60:
			return nil, "Kode SKU maksimal 60 karakter"
		}
		cols.Set("sku", sku)
	}
	if v := Field(body, "name"); !IsUndef(v) || requireCore {
		name := text(v)
		switch {
		case name == "":
			return nil, "Nama varian wajib diisi"
		case Len16(name) > 120:
			return nil, "Nama varian maksimal 120 karakter"
		}
		cols.Set("name", name)
	}
	if v := Field(body, "barcode"); !IsUndef(v) {
		barcode := text(v)
		if Len16(barcode) > 64 {
			return nil, "Barcode maksimal 64 karakter"
		}
		if barcode == "" {
			cols.Set("barcode", nil)
		} else {
			cols.Set("barcode", barcode)
		}
	}
	if v := Field(body, "options"); !IsUndef(v) {
		switch v.(type) {
		case map[string]any, []any:
			cols.Set("options", v)
		default:
			cols.Set("options", map[string]any{})
		}
	}
	if v := Field(body, "price_override"); !IsUndef(v) {
		if v == nil || v == "" {
			cols.Set("price_override", nil)
		} else {
			price := Number(v)
			if !Finite(price) || price < 0 {
				return nil, "Harga varian harus angka ≥ 0"
			}
			cols.Set("price_override", price)
		}
	}
	if v := Field(body, "stock_quantity"); !IsUndef(v) {
		stock := Number(v)
		if !Finite(stock) {
			return nil, "Stok varian harus angka"
		}
		cols.Set("stock_quantity", stock)
	}
	if v := Field(body, "is_active"); !IsUndef(v) {
		cols.Set("is_active", Truthy(v))
	}
	return cols, ""
}

// UniqueViolationMessage mirrors isUniqueViolation's message test.
var UniqueViolationMessage = regexp.MustCompile(`(?i)duplicate key|unique`)

/* ── Purchasing sync (lib/pos/purchasing-sync.ts) ────────────────────── */

var (
	drinkCategory   = regexp.MustCompile(`(?i)minuman|drink|coffee|kopi|tea|bar`)
	dessertCategory = regexp.MustCompile(`(?i)dessert|roti|cake|bakery|pastry`)
	snackCategory   = regexp.MustCompile(`(?i)snack|cemilan`)
)

// PosCategoryName mirrors normalizeCategoryName.
func PosCategoryName(kategori string) string {
	c := TrimJS(kategori)
	switch {
	case c == "":
		return "Makanan"
	case drinkCategory.MatchString(c):
		return "Minuman"
	case dessertCategory.MatchString(c):
		return "Dessert"
	case snackCategory.MatchString(c):
		return "Snack"
	}
	return c
}

// MarginPercentage is round(gross / base * 100, 2), 0 without a price.
func MarginPercentage(base, cost float64) float64 {
	if base <= 0 {
		return 0
	}
	return Round((base-cost)/base*10000) / 100
}
