package domain

import (
	"encoding/json"
	"math"
	"testing"
)

// sameFloat treats NaN as equal to NaN; everything else compares with ==.
func sameFloat(a, b float64) bool {
	if math.IsNaN(a) || math.IsNaN(b) {
		return math.IsNaN(a) && math.IsNaN(b)
	}
	return a == b
}

func ptr(f float64) *float64 { return &f }

// Expected values come from node: Number(v), String(v), Boolean(v), Number(v) || 0.
func TestNumberMatchesJS(t *testing.T) {
	nan := math.NaN()
	cases := []struct {
		name string
		in   any
		want float64
	}{
		{"json number", json.Number("12"), 12},
		{"json number exponent", json.Number("1e3"), 1000},
		{"padded string", " 12 ", 12},
		{"empty string", "", 0},
		{"blank string", "   ", 0},
		{"hex", "0x10", 16},
		{"hex upper prefix", "0X1f", 31},
		{"octal", "0o17", 15},
		{"binary", "0b101", 5},
		{"exponent string", "1e3", 1000},
		{"trailing garbage", "12abc", nan},
		{"word", "abc", nan},
		{"empty array", []any{}, 0},
		{"array of numeric string", []any{"7"}, 7},
		{"array of json number", []any{json.Number("7")}, 7},
		{"array of two", []any{json.Number("1"), json.Number("2")}, nan},
		{"array of null", []any{nil}, 0},
		{"nested empty array", []any{[]any{}}, 0},
		{"nested array", []any{[]any{"8"}}, 8},
		{"null", nil, 0},
		{"undefined", Undefined{}, nan},
		{"true", true, 1},
		{"false", false, 0},
		{"Infinity", "Infinity", math.Inf(1)},
		{"-Infinity", "-Infinity", math.Inf(-1)},
		{"+Infinity", "+Infinity", math.Inf(1)},
		{"inf is not JS", "inf", nan},
		{"underscore separator", "1_000", nan},
		{"plus sign", "+5", 5},
		{"negative decimal", "-5.5", -5.5},
		{"leading dot", ".5", 0.5},
		{"trailing dot", "5.", 5},
		{"dangling exponent", "1e", nan},
		{"tab and newline", "\t3\n", 3},
		{"nbsp", "\u00a03", 3},
		{"byte order mark", "\ufeff3", 3},
		{"next line is not JS whitespace", "\u00853", nan},
		{"bare hex prefix", "0x", nan},
		{"signed hex", "-0x10", nan},
		{"zero string", "0", 0},
		{"object", map[string]any{}, nan},
		{"small exponent", "1.5e-3", 0.0015},
		{"leading zeros", "00012", 12},
		{"double sign", "--1", nan},
		{"overflowing exponent", "1e1000", math.Inf(1)},
		{"hex beyond uint64", "0x10000000000000000", 18446744073709552000},
		{"float64", 2.5, 2.5},
		{"int", 3, 3},
	}
	for _, c := range cases {
		if got := Number(c.in); !sameFloat(got, c.want) {
			t.Errorf("Number(%s) = %v, want %v", c.name, got, c.want)
		}
	}
	if got := Number("-0"); got != 0 || !math.Signbit(got) {
		t.Errorf(`Number("-0") = %v, want -0`, got)
	}
}

func TestStringMatchesJS(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want string
	}{
		{"json number", json.Number("12"), "12"},
		{"json exponent", json.Number("1e3"), "1000"},
		{"json decimal", json.Number("0.1"), "0.1"},
		{"json negative zero", json.Number("-0"), "0"},
		{"padded string kept", " 12 ", " 12 "},
		{"empty array", []any{}, ""},
		{"one element", []any{"7"}, "7"},
		{"mixed array", []any{1, nil, Undefined{}, "a", true, []any{2, 3}}, "1,,,a,true,2,3"},
		{"null", nil, "null"},
		{"undefined", Undefined{}, "undefined"},
		{"true", true, "true"},
		{"false", false, "false"},
		{"object", map[string]any{"a": 1}, "[object Object]"},
		{"negative zero", math.Copysign(0, -1), "0"},
		{"float", 25000.5, "25000.5"},
		{"int", 42, "42"},
	}
	for _, c := range cases {
		if got := String(c.in); got != c.want {
			t.Errorf("String(%s) = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestTruthyMatchesJS(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want bool
	}{
		{"json zero", json.Number("0"), false},
		{"json negative zero", json.Number("-0"), false},
		{"json zero decimal", json.Number("0.0"), false},
		{"json number", json.Number("12"), true},
		{"empty string", "", false},
		{"blank string", "   ", true},
		{"zero string", "0", true},
		{"empty array", []any{}, true},
		{"empty object", map[string]any{}, true},
		{"null", nil, false},
		{"undefined", Undefined{}, false},
		{"true", true, true},
		{"false", false, false},
		{"NaN", math.NaN(), false},
		{"float zero", 0.0, false},
		{"int zero", 0, false},
	}
	for _, c := range cases {
		if got := Truthy(c.in); got != c.want {
			t.Errorf("Truthy(%s) = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestOr0MatchesJS(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want float64
	}{
		{"garbage", "12abc", 0},
		{"undefined", Undefined{}, 0},
		{"Infinity", "Infinity", math.Inf(1)},
		{"negative zero", "-0", 0},
		{"array", []any{"7"}, 7},
		{"number", json.Number("-3.5"), -3.5},
	}
	for _, c := range cases {
		if got := Or0(Number(c.in)); got != c.want {
			t.Errorf("Number(%s) || 0 = %v, want %v", c.name, got, c.want)
		}
	}
	if got := Or(Number("0"), 1); got != 1 {
		t.Errorf(`Number("0") || 1 = %v, want 1`, got)
	}
	if got := Or(Number("abc"), 7); got != 7 {
		t.Errorf(`Number("abc") || 7 = %v, want 7`, got)
	}
	if got := Or(Number("4"), 7); got != 4 {
		t.Errorf(`Number("4") || 7 = %v, want 4`, got)
	}
}

func TestStrOrAndToNumber(t *testing.T) {
	if got := StrOr(json.Number("0"), ""); got != "" {
		t.Errorf(`String(0 || "") = %q, want ""`, got)
	}
	if got := StrOr("x", ""); got != "x" {
		t.Errorf(`String("x" || "") = %q`, got)
	}
	if got := StrOr(nil, "d"); got != "d" {
		t.Errorf(`String(null || "d") = %q`, got)
	}
	if got := ToNumber("abc", 1); got != 1 {
		t.Errorf(`toNumber("abc", 1) = %v`, got)
	}
	if got := ToNumber("Infinity", 7); got != 7 {
		t.Errorf(`toNumber("Infinity", 7) = %v`, got)
	}
	if got := ToNumber(nil, 5); got != 0 {
		t.Errorf("toNumber(null, 5) = %v, want 0", got)
	}
	if got := ToNumber(Undefined{}, 5); got != 5 {
		t.Errorf("toNumber(undefined, 5) = %v, want 5", got)
	}
}

// Expected strings from node: String(n).
func TestNumberStringMatchesJS(t *testing.T) {
	// Runtime addition: the constant 0.1 + 0.2 folds to exactly 0.3 in Go.
	tenth, fifth := 0.1, 0.2
	cases := []struct {
		in   float64
		want string
	}{
		{tenth + fifth, "0.30000000000000004"},
		{1e21, "1e+21"},
		{1e-7, "1e-7"},
		{-1e-7, "-1e-7"},
		{123.5, "123.5"},
		{1e20, "100000000000000000000"},
		{123456789012345680000, "123456789012345680000"},
		{1e-6, "0.000001"},
		{0.000001234, "0.000001234"},
		{9007199254740992, "9007199254740992"},
		{1.0 / 3, "0.3333333333333333"},
		{math.Copysign(0, -1), "0"},
		{5e-324, "5e-324"},
		{1.7976931348623157e308, "1.7976931348623157e+308"},
		{100, "100"},
		{1.5e300, "1.5e+300"},
		{0.1, "0.1"},
		{25000.5, "25000.5"},
		{1.2345678e-16, "1.2345678e-16"},
		{math.NaN(), "NaN"},
		{math.Inf(1), "Infinity"},
		{math.Inf(-1), "-Infinity"},
	}
	for _, c := range cases {
		if got := NumberString(c.in); got != c.want {
			t.Errorf("NumberString(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestTrimMatchesJS(t *testing.T) {
	cases := []struct{ in, want string }{
		{"  a  ", "a"},
		{"\ufeff a \u3000", "a"},
		{"\u00a0\u2028x\u2029\u202f", "x"},
		{"\u2003y\u200a", "y"},
		{"\u0085a", "\u0085a"},
		{"\t\n\v\f\rz", "z"},
	}
	for _, c := range cases {
		if got := Trim(c.in); got != c.want {
			t.Errorf("Trim(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// Expected values from node: Math.round(x).
func TestRoundHalfUpMatchesMathRound(t *testing.T) {
	cases := []struct{ in, want float64 }{
		{2.5, 3},
		{-2.5, -2},
		{-0.4, 0},
		{1.4999, 1},
		{0.49999999999999994, 0},
		{4503599627370497, 4503599627370497},
	}
	for _, c := range cases {
		if got := RoundHalfUp(c.in); got != c.want {
			t.Errorf("RoundHalfUp(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestObjAccessors(t *testing.T) {
	o := Obj{"a": nil, "n": json.Number("0"), "s": "x", "child": map[string]any{"k": "v"}, "list": []any{"1"}}
	if _, ok := o.Get("missing").(Undefined); !ok {
		t.Errorf("missing key should be Undefined")
	}
	if o.Get("a") != nil {
		t.Errorf("explicit null should be nil")
	}
	if !o.Has("a") || o.Has("missing") {
		t.Errorf("Has mismatch")
	}
	if !o.IsNullish("a") || !o.IsNullish("missing") || o.IsNullish("n") {
		t.Errorf("IsNullish mismatch")
	}
	if !math.IsNaN(o.Num("missing")) || o.Num("a") != 0 {
		t.Errorf("Num mismatch")
	}
	if o.NumOr0("missing") != 0 {
		t.Errorf("NumOr0 mismatch")
	}
	if o.Str("n") != "" || o.Str("s") != "x" || o.Str("missing") != "" {
		t.Errorf("Str mismatch")
	}
	if o.Truthy("n") || !o.Truthy("s") {
		t.Errorf("Truthy mismatch")
	}
	if o.Child("child")["k"] != "v" || o.Child("s") != nil {
		t.Errorf("Child mismatch")
	}
	if l, ok := o.List("list"); !ok || len(l) != 1 {
		t.Errorf("List mismatch")
	}
	if _, ok := o.List("s"); ok {
		t.Errorf("List on string should fail")
	}
	var nilObj Obj
	if _, ok := nilObj.Get("x").(Undefined); !ok {
		t.Errorf("nil Obj Get should be Undefined")
	}
}
