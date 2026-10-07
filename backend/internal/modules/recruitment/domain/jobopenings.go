package domain

import (
	"encoding/json"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// JobOpeningStatuses are the allowed job opening statuses.
var JobOpeningStatuses = []string{"draft", "published", "closed"}

var (
	slugInvalid = regexp.MustCompile(`[^a-z0-9]+`)
	slugEdges   = regexp.MustCompile(`^-+|-+$`)
)

// Slugify lowercases, turns every non [a-z0-9] run into "-" and trims dashes.
func Slugify(value string) string {
	s := slugInvalid.ReplaceAllString(strings.TrimSpace(strings.ToLower(value)), "-")
	return slugEdges.ReplaceAllString(s, "")
}

// JobOpening is the normalized job opening payload, in the column order the
// TS insert and update send.
type JobOpening struct {
	PositionID     *string
	BrandID        *string
	DepartmentID   *string
	Title          string
	Slug           string
	Department     string
	Location       string
	EmploymentType string
	WorkMode       string
	// Headcount is String(Number(body.headcount || 1)); the column cast
	// rejects NaN and fractions as node-postgres does.
	Headcount    string
	Description  *string
	Requirements *string
	Benefits     *string
	Status       string
	ClosingDate  *string
	PublishedAt  *string
}

func text(body map[string]any, key, fallback string) string {
	if s, ok := body[key].(string); ok {
		return s
	}
	return fallback
}

func orNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// NormalizeJobOpening is normalizeJobOpening: non-string fields are ignored,
// published_at is now when created as published, and on update the value
// sent wins.
func NormalizeJobOpening(body map[string]any, update bool, now time.Time) JobOpening {
	title := JSTrim(text(body, "title", ""))
	status := text(body, "status", "draft")
	sent := ""
	if update {
		sent = text(body, "published_at", "")
	}
	var publishedNow string
	if status == "published" {
		publishedNow = now.UTC().Format("2006-01-02T15:04:05.000Z")
	}
	published := sent
	if published == "" {
		published = publishedNow
	}
	return JobOpening{
		PositionID:     orNil(text(body, "position_id", "")),
		BrandID:        orNil(text(body, "brand_id", "")),
		DepartmentID:   orNil(text(body, "department_id", "")),
		Title:          title,
		Slug:           JSTrim(text(body, "slug", Slugify(title))),
		Department:     JSTrim(text(body, "department", "Operations")),
		Location:       JSTrim(text(body, "location", "Jakarta, ID")),
		EmploymentType: JSTrim(text(body, "employment_type", "Full-time")),
		WorkMode:       JSTrim(text(body, "work_mode", "On-site")),
		Headcount:      jsNumberString(headcountValue(body["headcount"])),
		Description:    orNil(JSTrim(text(body, "description", ""))),
		Requirements:   orNil(JSTrim(text(body, "requirements", ""))),
		Benefits:       orNil(JSTrim(text(body, "benefits", ""))),
		Status:         status,
		ClosingDate:    orNil(text(body, "closing_date", "")),
		PublishedAt:    orNil(published),
	}
}

// ValidateJobOpening returns the Indonesian validation message, or "".
func ValidateJobOpening(p JobOpening, update bool) string {
	if p.Title == "" {
		return "Judul lowongan wajib diisi"
	}
	if !update {
		if p.Slug == "" {
			return "Slug lowongan wajib diisi"
		}
		if !slices.Contains(JobOpeningStatuses, p.Status) {
			return "Status lowongan tidak valid"
		}
	}
	return ""
}

// headcountValue is Number(v || 1) for a decoded JSON value.
func headcountValue(v any) float64 {
	switch x := v.(type) {
	case nil, bool: // false || 1 and Number(true) are both 1
		return 1
	case string:
		if x == "" {
			return 1
		}
		return JSNumber(x)
	case json.Number:
		f, err := x.Float64()
		if err != nil || f == 0 {
			return 1
		}
		return f
	case float64:
		if x == 0 {
			return 1
		}
		return x
	case []any:
		if len(x) == 0 {
			return 0
		}
		if len(x) == 1 {
			return headcountValue(x[0])
		}
		return math.NaN()
	}
	return math.NaN()
}

// JSNumber is Number(string) for the decimal, hex and blank forms.
func JSNumber(s string) float64 {
	s = JSTrim(s)
	if s == "" {
		return 0
	}
	if strings.HasPrefix(s, "0x") || strings.HasPrefix(s, "0X") {
		if n, err := strconv.ParseUint(s[2:], 16, 64); err == nil {
			return float64(n)
		}
		return math.NaN()
	}
	if s == "Infinity" || s == "+Infinity" {
		return math.Inf(1)
	}
	if s == "-Infinity" {
		return math.Inf(-1)
	}
	if strings.ContainsAny(s, "xXpP_") || strings.EqualFold(s, "inf") || strings.EqualFold(s, "nan") {
		return math.NaN()
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// jsNumberString is String(number).
func jsNumberString(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// JSTrim is String.prototype.trim: Unicode whitespace plus the BOM.
func JSTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == 0xFEFF })
}
