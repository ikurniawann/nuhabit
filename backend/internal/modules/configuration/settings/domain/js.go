// Package domain holds the pure settings rules ported from the TS libs:
// sales target, appearance tokens, the business tree, receipt scopes, order
// alert config and the text-to-speech catalog. No DB, no HTTP.
package domain

import (
	"strings"
	"unicode"
	"unicode/utf16"
)

// isJSSpace is a character JavaScript's \s and String#trim treat as space.
func isJSSpace(r rune) bool {
	return (unicode.IsSpace(r) && r != 0x85) || r == 0xFEFF
}

// TrimJS is String.prototype.trim.
func TrimJS(s string) string { return strings.TrimFunc(s, isJSSpace) }

// SliceJS is String.prototype.slice(0, n): the first n UTF-16 units.
func SliceJS(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}
