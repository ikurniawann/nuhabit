package domain

import (
	"regexp"
	"strings"
)

// Compact chart-of-accounts codes: Excel "1 1 01 001" becomes "1101001"
// (lib/accounting/account-code.ts).

var (
	segmentPattern = regexp.MustCompile(`^(\d) (\d) (\d{2}) (\d{3})$`)
	compactPattern = regexp.MustCompile(`^(\d)(\d)(\d{2})(\d{3})$`)
)

// collapseSpaces is .replace(/\s+/g, " ").
func collapseSpaces(s string) string {
	var b strings.Builder
	inSpace := false
	for _, r := range s {
		if IsJSSpace(r) {
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

// NormalizeAccountCode returns the compact 7-digit code, or "" when raw is
// not a recognised format.
func NormalizeAccountCode(raw string) string {
	trimmed := strings.TrimFunc(raw, IsJSSpace)
	trimmed = strings.NewReplacer("-", " ", "_", " ", ".", " ").Replace(trimmed)
	trimmed = collapseSpaces(trimmed)
	if trimmed == "" {
		return ""
	}
	if m := segmentPattern.FindStringSubmatch(trimmed); m != nil {
		return m[1] + m[2] + m[3] + m[4]
	}
	digits := strings.ReplaceAll(trimmed, " ", "")
	if compactPattern.MatchString(digits) {
		return digits
	}
	return ""
}

type codeParts struct{ class, group, sub, detail string }

func parseAccountCode(code string) (codeParts, bool) {
	m := compactPattern.FindStringSubmatch(NormalizeAccountCode(code))
	if m == nil {
		return codeParts{}, false
	}
	return codeParts{m[1], m[2], m[3], m[4]}, true
}

// FormatAccountCodeDisplay is "1 1 01 001" for a compact code; anything
// unparseable is returned unchanged.
func FormatAccountCodeDisplay(code string) string {
	p, ok := parseAccountCode(code)
	if !ok {
		return code
	}
	return p.class + " " + p.group + " " + p.sub + " " + p.detail
}

// InferAccountLevel is the hierarchy level (1..4) from the trailing zeros,
// 0 when the code is not recognised.
func InferAccountLevel(code string) int {
	p, ok := parseAccountCode(code)
	switch {
	case !ok:
		return 0
	case p.group == "0" && p.sub == "00" && p.detail == "000":
		return 1
	case p.sub == "00" && p.detail == "000":
		return 2
	case p.detail == "000":
		return 3
	}
	return 4
}
