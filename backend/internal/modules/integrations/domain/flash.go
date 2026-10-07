package domain

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/validate"
)

// The Daily Flash Report text (lib/wa/flash-report.ts) and the id-ID date
// formats the owner notification test sends.

var jakarta = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}()

var (
	idMonths      = []string{"Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}
	idMonthsShort = []string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}
	idWeekdays    = []string{"Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"}
)

// BrandName is brandName(): the configured NEXT_PUBLIC_APP_NAME, else
// the default "NüHabit".
func BrandName(configured string) string {
	if name := validate.JSTrim(configured); name != "" {
		return name
	}
	return "NüHabit"
}

// TodayWib is todayWib: the WIB calendar date, YYYY-MM-DD.
func TodayWib(now time.Time) string { return now.In(jakarta).Format("2006-01-02") }

// WibDayRange is wibDayRange: [00:00, 24:00) WIB of dateWib.
func WibDayRange(dateWib string) (time.Time, time.Time, error) {
	start, err := time.ParseInLocation("2006-01-02", dateWib, jakarta)
	return start, start.Add(24 * time.Hour), err
}

// NowLabel is toLocaleString("id-ID", { dateStyle: "medium", timeStyle:
// "short", timeZone: "Asia/Jakarta" }): "4 Okt 2026, 14.30".
func NowLabel(t time.Time) string {
	w := t.In(jakarta)
	return fmt.Sprintf("%d %s %d, %s", w.Day(), idMonthsShort[w.Month()-1], w.Year(), ClockLabel(t))
}

// ClockLabel is toLocaleTimeString("id-ID", 2-digit hour and minute, WIB):
// "14.30".
func ClockLabel(t time.Time) string { return t.In(jakarta).Format("15.04") }

// longDate is toLocaleDateString("id-ID", weekday/day/month long, WIB).
func longDate(t time.Time) string {
	w := t.In(jakarta)
	return fmt.Sprintf("%s, %d %s %d", idWeekdays[w.Weekday()], w.Day(), idMonths[w.Month()-1], w.Year())
}

// groupID is Math.round(n).toLocaleString("id-ID") for whole numbers.
func groupID(n float64) string {
	r := jsmath.Round(n)
	neg := r < 0 || (r == 0 && math.Signbit(r))
	digits := strconv.FormatFloat(math.Abs(r), 'f', 0, 64)
	var b strings.Builder
	for i, c := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	if neg {
		return "-" + b.String()
	}
	return b.String()
}

func rp(n float64) string { return "Rp " + groupID(n) }

// FlashLine is one stall or category row.
type FlashLine struct {
	Name    string
	Revenue float64
	Pcs     float64
}

// FlashReportData is FlashReportData.
type FlashReportData struct {
	OperationHour                 *string
	Revenue, NettSales, Discount  float64
	CitizenCardTx, FullDiscountTx float64
	KolCompIdr, KolCompTx         float64
	OwnerCompIdr, OwnerCompTx     float64
	FocCompIdr, FocCompTx         float64
	GuestCount                    float64
	ByStall, ByCategory           []FlashLine
	TopProducts                   []FlashLine
}

// BuildFlashReportMessage is buildFlashReportMessage.
func BuildFlashReportMessage(d FlashReportData, dateWib, brand string) string {
	day, _, _ := WibDayRange(dateWib)
	avgPerPax := 0.0
	if d.GuestCount > 0 {
		avgPerPax = d.NettSales / d.GuestCount
	}
	lines := []string{"📊 *Daily Flash Report*", strings.ToUpper(brand), longDate(day)}
	if d.OperationHour != nil {
		lines = append(lines, "Jam operasional: "+*d.OperationHour)
	}
	lines = append(lines,
		"--------------------------------",
		"*SALES SUMMARY*",
		"Revenue : "+rp(d.Revenue),
		"Nett Sales : "+rp(d.NettSales),
		"Discount : "+rp(d.Discount),
		"SULU Citizen : "+validate.JSNumber(d.CitizenCardTx)+" Card",
		"Disc 100% : "+validate.JSNumber(d.FullDiscountTx)+" Transaksi",
	)
	if d.KolCompTx > 0 {
		lines = append(lines, "KOL Comp : "+rp(d.KolCompIdr)+" ("+validate.JSNumber(d.KolCompTx)+" Trx)")
	}
	if d.FocCompTx > 0 {
		lines = append(lines, "Komplimen FOC : "+rp(d.FocCompIdr)+" ("+validate.JSNumber(d.FocCompTx)+" Trx)")
	}
	if d.OwnerCompTx > 0 {
		lines = append(lines, "Owner Comp : "+rp(d.OwnerCompIdr)+" ("+validate.JSNumber(d.OwnerCompTx)+" Trx)")
	}
	lines = append(lines, "", "No of Guest : "+validate.JSNumber(d.GuestCount)+" Pax", "Average/Pax : "+rp(avgPerPax), "", "*SALES BY STALL*")
	for _, s := range d.ByStall {
		if s.Pcs > 0 {
			lines = append(lines, s.Name+" : "+rp(s.Revenue)+" ("+validate.JSNumber(s.Pcs)+" Pcs)")
		} else {
			lines = append(lines, s.Name+" : Rp 0")
		}
	}
	lines = append(lines, "", "*SALES BY CATEGORY*")
	for _, c := range d.ByCategory {
		lines = append(lines, c.Name+" : "+rp(c.Revenue)+" ("+validate.JSNumber(c.Pcs)+" Pcs)")
	}
	lines = append(lines, "", "*TOP PRODUCT*")
	for i, p := range d.TopProducts {
		lines = append(lines, fmt.Sprintf("%d. %s : %s pcs", i+1, p.Name, validate.JSNumber(p.Pcs)))
	}
	if len(d.TopProducts) == 0 {
		lines = append(lines, "—")
	}
	return strings.Join(lines, "\n")
}
