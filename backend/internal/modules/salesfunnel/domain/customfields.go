package domain

import (
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"unicode/utf16"
)

// CustomFieldObjects is CUSTOM_FIELD_OBJECTS.
var CustomFieldObjects = []string{"lead", "deal", "account", "contact"}

// CustomFieldDef is the slice of a crm_custom_fields row validation reads.
type CustomFieldDef struct {
	Key        string
	Label      string
	FieldType  string
	Options    []string
	IsRequired bool
	Validation map[string]any
}

// CustomFieldError is one failed custom value.
type CustomFieldError struct {
	Key     string `json:"key"`
	Message string `json:"message"`
}

var (
	cfEmailRe  = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	cfURLRe    = regexp.MustCompile(`(?i)^https?://\S+$`)
	cfIDDots   = regexp.MustCompile(`^-?\d{1,3}(\.\d{3})+(,\d+)?$`)
	cfENCommas = regexp.MustCompile(`^-?\d{1,3}(,\d{3})+(\.\d+)?$`)
)

// ParseLocaleNumber is parseLocaleNumber ("25.000.000", "1.500,50", "1,5").
func ParseLocaleNumber(raw string) float64 {
	s := strings.Join(strings.Fields(JSTrim(raw)), "")
	switch {
	case cfIDDots.MatchString(s):
		return JSNumber(strings.Replace(strings.ReplaceAll(s, ".", ""), ",", ".", 1))
	case cfENCommas.MatchString(s):
		return JSNumber(strings.ReplaceAll(s, ",", ""))
	}
	return JSNumber(strings.Replace(s, ",", ".", 1))
}

func isEmptyCustom(v any) bool {
	switch x := v.(type) {
	case nil:
		return true
	case string:
		return x == ""
	case []any:
		return len(x) == 0
	}
	return false
}

// jsString is String(v) for a decoded JSON value.
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return x.String()
		}
		return JSNumberString(f)
	case float64:
		return JSNumberString(x)
	case []any:
		parts := make([]string, len(x))
		for i, it := range x {
			if it != nil {
				parts[i] = jsString(it)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

func validationNum(val map[string]any, key string) (float64, bool) {
	switch x := val[key].(type) {
	case float64:
		return x, true
	case json.Number:
		f, err := x.Float64()
		return f, err == nil
	}
	return 0, false
}

func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

// ValidateCustomValues is validateCustomValues: unknown keys are dropped,
// values normalized per field type; partial (PATCH) only requires the
// required fields the client sent.
func ValidateCustomValues(defs []CustomFieldDef, input map[string]any, partial bool) (map[string]any, []CustomFieldError) {
	values := map[string]any{}
	var errs []CustomFieldError
	fail := func(key, msg string) { errs = append(errs, CustomFieldError{Key: key, Message: msg}) }
	for _, def := range defs {
		v, has := input[def.Key]
		if isEmptyCustom(v) {
			if def.IsRequired && (!partial || has) {
				fail(def.Key, def.Label+" wajib diisi")
			}
			if has {
				values[def.Key] = nil
			}
			continue
		}
		val := def.Validation
		switch def.FieldType {
		case "number":
			var n float64
			if num, ok := v.(json.Number); ok {
				n, _ = num.Float64()
			} else {
				n = ParseLocaleNumber(jsString(v))
			}
			if math.IsNaN(n) || math.IsInf(n, 0) {
				fail(def.Key, def.Label+" harus angka")
				break
			}
			if mn, ok := validationNum(val, "min"); ok && n < mn {
				fail(def.Key, def.Label+" minimal "+JSNumberString(mn))
			}
			if mx, ok := validationNum(val, "max"); ok && n > mx {
				fail(def.Key, def.Label+" maksimal "+JSNumberString(mx))
			}
			values[def.Key] = n
		case "boolean":
			switch x := v.(type) {
			case bool:
				values[def.Key] = x
			case string:
				values[def.Key] = x == "true" || x == "1"
			case json.Number:
				values[def.Key] = jsString(x) == "1"
			default:
				values[def.Key] = false
			}
		case "date":
			s := jsString(v)
			if !IsParsableISODate(s) {
				fail(def.Key, def.Label+" harus tanggal YYYY-MM-DD")
				break
			}
			values[def.Key] = s
		case "picklist":
			s := jsString(v)
			if !Contains(def.Options, s) {
				fail(def.Key, def.Label+" harus salah satu dari pilihan")
				break
			}
			values[def.Key] = s
		case "multipicklist":
			var arr []string
			if list, ok := v.([]any); ok {
				for _, it := range list {
					arr = append(arr, jsString(it))
				}
			} else {
				for _, part := range strings.Split(jsString(v), ",") {
					if p := JSTrim(part); p != "" {
						arr = append(arr, p)
					}
				}
			}
			var bad []string
			for _, x := range arr {
				if !Contains(def.Options, x) {
					bad = append(bad, x)
				}
			}
			if len(bad) > 0 {
				fail(def.Key, def.Label+": pilihan tidak dikenal ("+strings.Join(bad, ", ")+")")
				break
			}
			if arr == nil {
				arr = []string{}
			}
			values[def.Key] = arr
		case "email":
			s := JSTrim(jsString(v))
			if !cfEmailRe.MatchString(s) {
				fail(def.Key, def.Label+" bukan email valid")
				break
			}
			values[def.Key] = s
		case "url":
			s := JSTrim(jsString(v))
			if !cfURLRe.MatchString(s) {
				fail(def.Key, def.Label+" harus diawali http:// atau https://")
				break
			}
			values[def.Key] = s
		case "phone":
			var b strings.Builder
			for _, c := range jsString(v) {
				if c >= '0' && c <= '9' || c == '+' {
					b.WriteRune(c)
				}
			}
			digits := b.String()
			if len(strings.ReplaceAll(digits, "+", "")) < 8 {
				fail(def.Key, def.Label+" nomor terlalu pendek")
				break
			}
			values[def.Key] = digits
		default:
			s := jsString(v)
			if mn, ok := validationNum(val, "min_length"); ok && float64(utf16Len(s)) < mn {
				fail(def.Key, def.Label+" minimal "+JSNumberString(mn)+" karakter")
			}
			if mx, ok := validationNum(val, "max_length"); ok && float64(utf16Len(s)) > mx {
				fail(def.Key, def.Label+" maksimal "+JSNumberString(mx)+" karakter")
			}
			if pattern, ok := val["pattern"].(string); ok && pattern != "" {
				// JS RegExp syntax mostly matches RE2; a pattern RE2 rejects is
				// ignored like an invalid pattern in the TS.
				if re, err := regexp.Compile(pattern); err == nil && !re.MatchString(s) {
					fail(def.Key, def.Label+" tidak sesuai format")
				}
			}
			values[def.Key] = s
		}
	}
	return values, errs
}

// JoinCustomErrors is errors.map(e => e.message).join("; ").
func JoinCustomErrors(errs []CustomFieldError) string {
	msgs := make([]string, len(errs))
	for i, e := range errs {
		msgs[i] = e.Message
	}
	return strings.Join(msgs, "; ")
}
