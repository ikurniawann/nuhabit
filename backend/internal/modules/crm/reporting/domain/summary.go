package domain

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/crm/internal/kit"
)

// Row is one report result row; date and timestamp columns hold time.Time.
type Row map[string]any

// SummarizeRows mirrors summarizeRows: a short text for WhatsApp messages
// and dashboard cards.
func SummarizeRows(rows []Row, columns []Column, loc *time.Location) string {
	if len(rows) == 0 {
		return "Tidak ada data."
	}
	var aggs []Column
	var labelCol *Column
	for i, c := range columns {
		if c.IsAggregate {
			aggs = append(aggs, c)
		} else if labelCol == nil {
			labelCol = &columns[i]
		}
	}
	if len(aggs) == 0 {
		return fmt.Sprintf("%d baris.", len(rows))
	}
	var lines []string
	for _, r := range rows[:min(5, len(rows))] {
		label := "—"
		if labelCol != nil && r[labelCol.Key] != nil {
			label = displayString(r[labelCol.Key], loc)
		}
		vals := make([]string, len(aggs))
		for i, a := range aggs {
			vals[i] = a.Label + ": " + FormatCellValue(a.Type, r[a.Key], loc)
		}
		lines = append(lines, "• "+label+" — "+strings.Join(vals, ", "))
	}
	out := strings.Join(lines, "\n")
	if len(rows) > 5 {
		out += fmt.Sprintf("\n… dan %d baris lain.", len(rows)-5)
	}
	return out
}

// displayString is String(v) for a node-postgres value; a Date prints like
// Date.prototype.toString in the server zone.
func displayString(v any, loc *time.Location) string {
	switch x := v.(type) {
	case time.Time:
		t := x.In(loc)
		name := t.Format("MST")
		if n, ok := zoneNames[loc.String()]; ok {
			name = n
		}
		return t.Format("Mon Jan 02 2006 15:04:05 GMT-0700") + " (" + name + ")"
	case int64:
		return strconv.FormatInt(x, 10)
	}
	return JSString(v)
}

var zoneNames = map[string]string{"Asia/Jakarta": "Western Indonesia Time", "UTC": "Coordinated Universal Time"}

// FormatCellValue mirrors formatCellValue.
func FormatCellValue(typ string, v any, loc *time.Location) string {
	if v == nil || v == "" {
		return "—"
	}
	switch typ {
	case "currency":
		n := cellNumber(v)
		if math.IsNaN(n) {
			n = 0
		}
		return kit.FormatRupiah(n)
	case "number":
		return FormatNumber(cellNumber(v), 3)
	case "boolean":
		if v == true || v == "true" {
			return "Ya"
		}
		return "Tidak"
	case "date":
		if t, ok := cellTime(v); ok {
			return formatWIB(t, false)
		}
		return "-"
	case "datetime":
		if t, ok := cellTime(v); ok {
			return formatWIB(t, true)
		}
		return "-"
	}
	return displayString(v, loc)
}

func cellNumber(v any) float64 {
	if n, ok := v.(int64); ok {
		return float64(n)
	}
	return JSNumber(v)
}

var (
	wib          = time.FixedZone("WIB", 7*3600)
	calendarDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	idMonths     = [...]string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}
)

// cellTime is lib/format toDate: a "YYYY-MM-DD" string is anchored at noon
// WIB, anything else parsed as a date.
func cellTime(v any) (time.Time, bool) {
	switch x := v.(type) {
	case time.Time:
		return x, true
	case string:
		if calendarDate.MatchString(x) {
			t, err := time.ParseInLocation("2006-01-02 15", x+" 12", wib)
			return t, err == nil
		}
		for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04Z07:00", "2006-01-02T15:04:05.999999999", "2006-01-02 15:04:05.999999999Z07:00"} {
			if t, err := time.Parse(layout, x); err == nil {
				return t, true
			}
		}
	}
	return time.Time{}, false
}

// formatWIB is formatDate ("4 Okt 2026") or formatDateTime ("4 Okt 2026, 14.30").
func formatWIB(t time.Time, withTime bool) string {
	t = t.In(wib)
	s := fmt.Sprintf("%d %s %d", t.Day(), idMonths[t.Month()-1], t.Year())
	if withTime {
		s += fmt.Sprintf(", %02d.%02d", t.Hour(), t.Minute())
	}
	return s
}

// FormatNumber is formatNumber(n, maxFractionDigits) in id-ID: "." groups,
// "," decimals, trailing zeros dropped.
func FormatNumber(n float64, maxFraction int) string {
	if math.IsNaN(n) || math.IsInf(n, 0) {
		n = 0
	}
	s := strconv.FormatFloat(math.Abs(n), 'f', maxFraction, 64)
	intPart, frac, _ := strings.Cut(s, ".")
	frac = strings.TrimRight(frac, "0")
	whole, _ := strconv.ParseInt(intPart, 10, 64)
	out := kit.GroupThousands(whole)
	if frac != "" {
		out += "," + frac
	}
	if n < 0 && (whole != 0 || frac != "") {
		out = "-" + out
	}
	return out
}

// PeriodLabel is the watcher's periodLabel.
func PeriodLabel(d Definition) string {
	if d.DatePreset == "custom" {
		from, to := "?", "?"
		if d.DateFrom.Val != nil {
			from = *d.DateFrom.Val
		}
		if d.DateTo.Val != nil {
			to = *d.DateTo.Val
		}
		return from + " s/d " + to
	}
	return LabelOf(DatePresets, d.DatePreset)
}
