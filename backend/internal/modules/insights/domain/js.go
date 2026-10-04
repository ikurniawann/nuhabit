// Package domain holds the pure rules of the insights context: recruitment
// dashboard aggregates, the sales target setting, and the Do assistant's
// intent, context, tool-scope and text rules. No database, no HTTP.
package domain

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

// WIB is Asia/Jakarta (UTC+7, no DST). The TS routes do calendar math in
// the server's local zone, which production runs as WIB.
var WIB = time.FixedZone("WIB", 7*3600)

// Field is one key of an Object.
type Field struct {
	Key   string
	Value any
}

// Object is a JS object literal: keys keep insertion order when marshalled.
type Object []Field

// Get returns the value of key (nil when absent).
func (o Object) Get(key string) any {
	for _, f := range o {
		if f.Key == key {
			return f.Value
		}
	}
	return nil
}

// Has reports whether key exists.
func (o Object) Has(key string) bool {
	for _, f := range o {
		if f.Key == key {
			return true
		}
	}
	return false
}

// MarshalJSON writes the keys in order without HTML escaping.
func (o Object) MarshalJSON() ([]byte, error) {
	if o == nil {
		return []byte("{}"), nil
	}
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, f := range o {
		if i > 0 {
			buf.WriteByte(',')
		}
		k, _ := Marshal(f.Key)
		buf.Write(k)
		buf.WriteByte(':')
		v, err := Marshal(f.Value)
		if err != nil {
			return nil, err
		}
		buf.Write(v)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

// Marshal is JSON.stringify(v): no HTML escaping, no trailing newline.
func Marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// MarshalIndent is JSON.stringify(v, null, 2).
func MarshalIndent(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// JSDate is a timestamp as node-postgres hands it to JSON.stringify.
type JSDate time.Time

// MarshalJSON writes Date.prototype.toISOString.
func (d JSDate) MarshalJSON() ([]byte, error) {
	return []byte(`"` + ISO(time.Time(d)) + `"`), nil
}

// String is Date.prototype.toString in WIB, e.g.
// "Sun Oct 04 2026 17:00:00 GMT+0700 (Western Indonesia Time)".
func (d JSDate) String() string {
	return time.Time(d).In(WIB).Format("Mon Jan 02 2006 15:04:05 GMT-0700") + " (Western Indonesia Time)"
}

// ISO is Date.prototype.toISOString.
func ISO(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

// JSString is String(v) for the values a node-postgres row holds.
func JSString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case int:
		return strconv.Itoa(x)
	case float64:
		return JSNumber(x)
	case JSDate:
		return x.String()
	case Object, map[string]any: // model arguments can be objects or arrays
		return "[object Object]"
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if e != nil {
				parts[i] = JSString(e)
			}
		}
		return strings.Join(parts, ",")
	}
	b, _ := Marshal(v)
	return string(b)
}

// Truthy is Boolean(v).
func Truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case string:
		return x != ""
	case bool:
		return x
	case int:
		return x != 0
	case float64:
		return x != 0 && !math.IsNaN(x)
	}
	return true
}

// JSNumber is Number.prototype.toString for finite values.
func JSNumber(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case f == 0:
		return "0"
	}
	if a := math.Abs(f); a >= 1e-6 && a < 1e21 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	s := strconv.FormatFloat(f, 'e', -1, 64)
	mant, exp, _ := strings.Cut(s, "e")
	sign := exp[0]
	exp = strings.TrimLeft(exp[1:], "0")
	return mant + "e" + string(sign) + exp
}

// jsSpace is the JavaScript \s class (Go's \s is ASCII only).
const jsSpace = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

var trimSet = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

// Trim is String.prototype.trim.
func Trim(s string) string { return strings.Trim(s, trimSet) }

var spaceRun = regexp.MustCompile(`[` + jsSpace + `]+`)

// CollapseSpace is s.replace(/\s+/g, " ").
func CollapseSpace(s string) string { return spaceRun.ReplaceAllString(s, " ") }

// Len is String.prototype.length (UTF-16 code units).
func Len(s string) int { return len(utf16.Encode([]rune(s))) }

// Slice is String.prototype.slice(0, n) on UTF-16 code units.
func Slice(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if n >= len(u) {
		return s
	}
	if n < 0 {
		n = 0
	}
	return string(utf16.Decode(u[:n]))
}
