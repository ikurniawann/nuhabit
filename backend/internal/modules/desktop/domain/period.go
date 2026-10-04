// Package domain holds the desktop board's pure rules, ported from
// frontend/src/lib/desktop: periods and their apples-to-apples comparison
// windows, revenue shares, the inbox and search access rules, status
// roll-up, preference normalization and the wallpaper list.
package domain

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/jsmath"
)

// PeriodKinds are the board periods, in PERIOD_KINDS order.
var PeriodKinds = []string{"today", "mtd", "qtd", "ytd"}

// ParsePeriod is parsePeriod: unknown values fall back to "today".
func ParsePeriod(v string) string {
	for _, k := range PeriodKinds {
		if k == v {
			return v
		}
	}
	return "today"
}

// Period is the board period; dates are WIB YYYY-MM-DD, both inclusive.
type Period struct {
	Kind         string `json:"kind"`
	Mulai        string `json:"mulai"`
	Selesai      string `json:"selesai"`
	HariBerjalan int    `json:"hariBerjalan"`
	TotalHari    int    `json:"totalHari"`
}

// Comparison is the window a period is compared with. Penuh is false when
// the window had to be cut shorter (31 March has no 31 February).
type Comparison struct {
	Mulai       string `json:"mulai"`
	Selesai     string `json:"selesai"`
	HariBanding int    `json:"hariBanding"`
	Penuh       bool   `json:"penuh"`
}

// PeriodSummary is the period plus its comparison window.
type PeriodSummary struct {
	Periode Period     `json:"periode"`
	Banding Comparison `json:"banding"`
}

// wibOffset is the fixed WIB offset; the TS shifts instants by 7 hours.
const wibOffset = 7 * time.Hour

// TodayJakarta is todayJakarta: the WIB calendar date of an instant.
func TodayJakarta(now time.Time) string { return now.UTC().Add(wibOffset).Format("2006-01-02") }

func isLeap(y int) bool { return (y%4 == 0 && y%100 != 0) || y%400 == 0 }

func daysInMonth(y, m int) int {
	switch m {
	case 2:
		if isLeap(y) {
			return 29
		}
		return 28
	case 4, 6, 9, 11:
		return 30
	}
	return 31
}

func iso(y, m, d int) string { return fmt.Sprintf("%04d-%02d-%02d", y, m, d) }

func parseISO(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

// AddDays shifts a YYYY-MM-DD date.
func AddDays(date string, days int) string {
	return parseISO(date).AddDate(0, 0, days).Format("2006-01-02")
}

func inclusiveDays(mulai, selesai string) int {
	return int(math.Round(parseISO(selesai).Sub(parseISO(mulai)).Hours()/24)) + 1
}

func quarterStartMonth(m int) int { return m - (m-1)%3 }

func quarterDays(y, start int) int {
	return daysInMonth(y, start) + daysInMonth(y, start+1) + daysInMonth(y, start+2)
}

// ResolvePeriod is resolvePeriod.
func ResolvePeriod(kind string, now time.Time) Period {
	w := now.UTC().Add(wibOffset)
	year, month, day := w.Year(), int(w.Month()), w.Day()
	selesai := iso(year, month, day)
	switch kind {
	case "mtd":
		return Period{Kind: kind, Mulai: iso(year, month, 1), Selesai: selesai, HariBerjalan: day, TotalHari: daysInMonth(year, month)}
	case "qtd":
		start := quarterStartMonth(month)
		mulai := iso(year, start, 1)
		return Period{Kind: kind, Mulai: mulai, Selesai: selesai, HariBerjalan: inclusiveDays(mulai, selesai), TotalHari: quarterDays(year, start)}
	case "ytd":
		mulai := iso(year, 1, 1)
		total := 365
		if isLeap(year) {
			total = 366
		}
		return Period{Kind: kind, Mulai: mulai, Selesai: selesai, HariBerjalan: inclusiveDays(mulai, selesai), TotalHari: total}
	}
	return Period{Kind: "today", Mulai: selesai, Selesai: selesai, HariBerjalan: 1, TotalHari: 1}
}

// ResolveComparison is resolveComparison.
func ResolveComparison(p Period) Comparison {
	parts := strings.Split(p.Selesai, "-")
	year, _ := strconv.Atoi(parts[0])
	month, _ := strconv.Atoi(parts[1])
	day, _ := strconv.Atoi(parts[2])
	switch p.Kind {
	case "mtd":
		prevMonth, prevYear := month-1, year
		if month == 1 {
			prevMonth, prevYear = 12, year-1
		}
		hari := min(day, daysInMonth(prevYear, prevMonth))
		return Comparison{Mulai: iso(prevYear, prevMonth, 1), Selesai: iso(prevYear, prevMonth, hari), HariBanding: hari, Penuh: hari == p.HariBerjalan}
	case "qtd":
		start := quarterStartMonth(month)
		prevStart, prevYear := start-3, year
		if start == 1 {
			prevStart, prevYear = 10, year-1
		}
		mulai := iso(prevYear, prevStart, 1)
		hari := min(p.HariBerjalan, quarterDays(prevYear, prevStart))
		return Comparison{Mulai: mulai, Selesai: AddDays(mulai, hari-1), HariBanding: hari, Penuh: hari == p.HariBerjalan}
	case "ytd":
		prevYear := year - 1
		targetDay := day
		if month == 2 && day == 29 && !isLeap(prevYear) {
			targetDay = 28
		}
		mulai, selesai := iso(prevYear, 1, 1), iso(prevYear, month, targetDay)
		hari := inclusiveDays(mulai, selesai)
		return Comparison{Mulai: mulai, Selesai: selesai, HariBanding: hari, Penuh: hari == p.HariBerjalan}
	}
	// today: the same weekday last week, not yesterday.
	target := AddDays(p.Selesai, -7)
	return Comparison{Mulai: target, Selesai: target, HariBanding: 1, Penuh: true}
}

// SummarizePeriod is summarizePeriod.
func SummarizePeriod(kind string, now time.Time) PeriodSummary {
	p := ResolvePeriod(kind, now)
	return PeriodSummary{Periode: p, Banding: ResolveComparison(p)}
}

// ProjectRunRate is projectRunRate: the period-end value at the running
// pace, Math.round'ed.
func ProjectRunRate(nilai float64, p Period) float64 {
	if p.HariBerjalan <= 0 {
		return 0
	}
	return jsmath.Round(nilai / float64(p.HariBerjalan) * float64(p.TotalHari))
}
