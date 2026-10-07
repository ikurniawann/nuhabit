package domain

import (
	"fmt"
	"math"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"

	"golang.org/x/text/unicode/norm"
)

// Variant matrix rules (lib/pos/merchandise-variants.ts): axes such as
// size × colour expand into SKU rows, matched to existing rows by options.

// Matrix limits.
const (
	MaxAxes          = 10
	MaxValuesPerAxis = 50
	MaxCombos        = 500
	maxSkuLength     = 60
	maxBarcodeLength = 64
)

// Options is one matrix combination ({ukuran: "M", warna: "Hitam"}) with
// JS object key semantics: a repeated key keeps its first position.
type Options struct {
	keys []string
	vals map[string]string
}

// NewOptions builds options from key, value pairs.
func NewOptions(kv ...string) Options {
	o := Options{vals: map[string]string{}}
	for i := 0; i+1 < len(kv); i += 2 {
		o.set(kv[i], kv[i+1])
	}
	return o
}

func (o *Options) set(k, v string) {
	if o.vals == nil {
		o.vals = map[string]string{}
	}
	if _, ok := o.vals[k]; !ok {
		o.keys = append(o.keys, k)
	}
	o.vals[k] = v
}

func (o Options) with(k, v string) Options {
	c := Options{keys: slices.Clone(o.keys), vals: make(map[string]string, len(o.vals)+1)}
	for key, val := range o.vals {
		c.vals[key] = val
	}
	c.set(k, v)
	return c
}

// Keys returns Object.keys order: array-index keys ascending, then the
// rest in insertion order.
func (o Options) Keys() []string {
	var idx, rest []string
	for _, k := range o.keys {
		if isIndexKey(k) {
			idx = append(idx, k)
		} else {
			rest = append(rest, k)
		}
	}
	sort.Slice(idx, func(i, j int) bool {
		a, _ := strconv.ParseUint(idx[i], 10, 64)
		b, _ := strconv.ParseUint(idx[j], 10, 64)
		return a < b
	})
	return append(idx, rest...)
}

func isIndexKey(k string) bool {
	if k == "" || (len(k) > 1 && k[0] == '0') {
		return false
	}
	n, err := strconv.ParseUint(k, 10, 64)
	return err == nil && n < math.MaxUint32
}

// Get returns the value of k.
func (o Options) Get(k string) string { return o.vals[k] }

// OptionsFromAny reads a stored options object; values become String(v).
func OptionsFromAny(v any) Options {
	o := Options{vals: map[string]string{}}
	if m, ok := v.(map[string]any); ok {
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys) // key order only matters for display; optionsKey sorts
		for _, k := range keys {
			val := m[k]
			if IsNullish(val) {
				val = ""
			}
			o.set(k, String(val))
		}
	}
	return o
}

type axis struct {
	key    string
	values []string
}

func cleanValues(v any) []string {
	list, ok := v.([]any)
	if !ok {
		return nil
	}
	var out []string
	seen := map[string]bool{}
	for _, raw := range list {
		if IsNullish(raw) {
			raw = ""
		}
		value := TrimJS(String(raw))
		if value == "" || seen[strings.ToLower(value)] {
			continue
		}
		seen[strings.ToLower(value)] = true
		out = append(out, value)
	}
	return out
}

func cleanAxes(axes any) []axis {
	list, _ := axes.([]any)
	var out []axis
	for _, a := range list {
		key := Field(a, "key")
		if IsNullish(key) {
			key = ""
		}
		k := TrimJS(String(key))
		if k == "" {
			continue
		}
		values := Field(a, "values")
		if IsNullish(values) {
			values = []any{}
		}
		out = append(out, axis{key: k, values: cleanValues(values)})
	}
	return out
}

// ValidateMatrixSize mirrors validateMatrixSize; "" means valid.
func ValidateMatrixSize(axes any) string {
	list, ok := axes.([]any)
	if !ok {
		return "Sumbu varian harus berupa daftar"
	}
	for _, a := range list {
		m, ok := a.(map[string]any)
		if !ok {
			return "Nilai sumbu harus berupa daftar"
		}
		if _, ok := m["key"].(string); !ok {
			return "Nilai sumbu harus berupa daftar"
		}
		if _, ok := m["values"].([]any); !ok {
			return "Nilai sumbu harus berupa daftar"
		}
	}
	clean := cleanAxes(axes)
	if len(clean) > MaxAxes {
		return fmt.Sprintf("Maksimal %d sumbu varian", MaxAxes)
	}
	combos := 0
	if len(clean) > 0 {
		combos = 1
	}
	for _, a := range clean {
		if len(a.values) > MaxValuesPerAxis {
			return fmt.Sprintf("Maksimal %d nilai per sumbu", MaxValuesPerAxis)
		}
		combos *= len(a.values)
	}
	if combos > MaxCombos {
		return fmt.Sprintf("Maksimal %d kombinasi varian per produk", MaxCombos)
	}
	return ""
}

// ExpandMatrix is the cartesian product of the axes in order; an axis
// without values makes it empty. Callers validate the size first.
func ExpandMatrix(axes any) []Options {
	clean := cleanAxes(axes)
	if len(clean) == 0 {
		return nil
	}
	for _, a := range clean {
		if len(a.values) == 0 {
			return nil
		}
	}
	combos := []Options{{vals: map[string]string{}}}
	for _, a := range clean {
		var next []Options
		for _, c := range combos {
			for _, v := range a.values {
				next = append(next, c.with(a.key, v))
			}
		}
		combos = next
	}
	return combos
}

// slugToken upper-cases, strips diacritics and drops non-alphanumerics.
func slugToken(v string) string {
	upper := strings.ReplaceAll(strings.ToUpper(v), "ß", "SS")
	var b strings.Builder
	for _, r := range norm.NFKD.String(upper) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func slice16(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}

// BuildSkuCode is BASE-VALUE1-VALUE2…, at most 60 characters, shortening
// the value tokens from the last one and never the base.
func BuildSkuCode(baseSku string, o Options) string {
	base := strings.ToUpper(TrimJS(baseSku))
	if base == "" {
		base = "SKU"
	}
	var tokens []string
	for _, k := range o.Keys() {
		if t := slugToken(o.vals[k]); t != "" {
			tokens = append(tokens, t)
		}
	}
	code := strings.Join(append([]string{base}, tokens...), "-")
	if Len16(code) <= maxSkuLength {
		return code
	}
	parts := slices.Clone(tokens)
	for len(parts) > 0 && Len16(strings.Join(append([]string{base}, parts...), "-")) > maxSkuLength {
		last := len(parts) - 1
		if len(parts[last]) <= 1 {
			parts = parts[:last]
		} else {
			parts[last] = parts[last][:len(parts[last])-1]
		}
	}
	return slice16(strings.Join(append([]string{base}, parts...), "-"), maxSkuLength)
}

// ComposedBarcodeTooLong reports a prefix + SKU code over 64 characters.
func ComposedBarcodeTooLong(prefix string, codes []string) bool {
	if prefix == "" {
		return false
	}
	for _, c := range codes {
		if Len16(prefix+c) > maxBarcodeLength {
			return true
		}
	}
	return false
}

// BuildSkuName is "Product — Value1 / Value2".
func BuildSkuName(productName string, o Options) string {
	name := TrimJS(productName)
	var values []string
	for _, k := range o.Keys() {
		if v := TrimJS(o.vals[k]); v != "" {
			values = append(values, v)
		}
	}
	if len(values) == 0 {
		return name
	}
	return name + " — " + strings.Join(values, " / ")
}

// OptionsKey compares options regardless of key order and case.
func OptionsKey(o Options) string {
	keys := slices.Clone(o.keys)
	slices.SortFunc(keys, compareUTF16)
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = strings.ToLower(k) + "=" + strings.ToLower(TrimJS(o.vals[k]))
	}
	return strings.Join(parts, "&")
}

// compareUTF16 is the default Array.prototype.sort order.
func compareUTF16(a, b string) int {
	ua, ub := utf16.Encode([]rune(a)), utf16.Encode([]rune(b))
	for i := 0; i < len(ua) && i < len(ub); i++ {
		if ua[i] != ub[i] {
			return int(ua[i]) - int(ub[i])
		}
	}
	return len(ua) - len(ub)
}

// ExistingSku is a pos_product_skus row the diff compares.
type ExistingSku struct {
	ID            string
	Options       Options
	StockQuantity float64
	IsActive      bool
}

// MatrixDiff is diffMatrix's result.
type MatrixDiff struct {
	Create     []Options
	Reactivate []ExistingSku
	Deactivate []ExistingSku
	Keep       []ExistingSku
}

// DiffMatrix matches existing rows (active and inactive) to the wanted
// combinations by options: new combinations are created, inactive matches
// reactivated, active matches kept, and active rows nobody wants
// deactivated.
func DiffMatrix(existing []ExistingSku, wanted []Options) MatrixDiff {
	byKey := map[string]ExistingSku{}
	for _, row := range existing {
		key := OptionsKey(row.Options)
		if cur, ok := byKey[key]; !ok || (row.IsActive && !cur.IsActive) {
			byKey[key] = row
		}
	}
	wantedKeys := map[string]bool{}
	for _, o := range wanted {
		wantedKeys[OptionsKey(o)] = true
	}
	var d MatrixDiff
	for _, o := range wanted {
		match, ok := byKey[OptionsKey(o)]
		switch {
		case !ok:
			d.Create = append(d.Create, o)
		case !match.IsActive:
			d.Reactivate = append(d.Reactivate, match)
		default:
			d.Keep = append(d.Keep, match)
		}
	}
	for _, row := range existing {
		if row.IsActive && !wantedKeys[OptionsKey(row.Options)] {
			d.Deactivate = append(d.Deactivate, row)
		}
	}
	return d
}

// BlockedDeactivations are rows to deactivate that still hold stock.
func BlockedDeactivations(existing []ExistingSku, ids []string) []ExistingSku {
	var out []ExistingSku
	for _, row := range existing {
		if slices.Contains(ids, row.ID) && row.StockQuantity > 0 {
			out = append(out, row)
		}
	}
	return out
}
