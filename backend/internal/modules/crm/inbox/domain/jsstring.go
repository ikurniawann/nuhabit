// Package domain holds the pure rules of the CS inbox: conversation insight
// parsing and caching, Google review mapping and approval, the Instagram
// webhook, and the owner notification texts. No database, no HTTP.
package domain

import (
	"strings"
	"unicode/utf16"
)

// The TS libs measure and cut strings in UTF-16 code units (String.length,
// slice) and use the JS definition of whitespace; these helpers keep that.

// isJSSpace is the JS \s class (which String.prototype.trim also uses).
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// JSTrim is String.prototype.trim.
func JSTrim(s string) string { return strings.TrimFunc(s, isJSSpace) }

// collapseSpace is s.replace(/\s+/g, " ").
func collapseSpace(s string) string {
	var b strings.Builder
	inSpace := false
	for _, r := range s {
		if isJSSpace(r) {
			if !inSpace {
				b.WriteByte(' ')
			}
			inSpace = true
			continue
		}
		inSpace = false
		b.WriteRune(r)
	}
	return b.String()
}

// UTF16Len is String.length.
func UTF16Len(s string) int { return len(utf16.Encode([]rune(s))) }

// UTF16Slice is s.slice(start, end) for 0 <= start <= end.
func UTF16Slice(s string, start, end int) string {
	u := utf16.Encode([]rune(s))
	end = min(end, len(u))
	start = min(start, end)
	return string(utf16.Decode(u[start:end]))
}
