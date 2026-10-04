// Package domain holds the pure rules of the resort module
// (lib/resort/rates.ts, reservation.ts and planning.ts): nightly rates,
// stay quotes, reservation statuses, folio balances and stock planning.
package domain

import (
	"strconv"
	"time"

	"nuhabit/backend/internal/platform/jsmath"
)

const day = 24 * time.Hour

// parseDay is Date.parse(`${s}T00:00:00Z`) for a YYYY-MM-DD string. V8
// accepts days up to 31 in any month and rolls them over (2026-02-30 is
// 2026-03-02), so the date is normalized the same way.
func parseDay(s string) (time.Time, bool) {
	if len(s) != 10 || s[4] != '-' || s[7] != '-' {
		return time.Time{}, false
	}
	y, err1 := strconv.Atoi(s[:4])
	m, err2 := strconv.Atoi(s[5:7])
	d, err3 := strconv.Atoi(s[8:])
	if err1 != nil || err2 != nil || err3 != nil || m < 1 || m > 12 || d < 1 || d > 31 {
		return time.Time{}, false
	}
	return time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC), true
}

// NightsBetween is nightsBetween: nights from check-in to check-out, 0 when
// either date does not parse or check-out is not later.
func NightsBetween(checkIn, checkOut string) int {
	a, ok1 := parseDay(checkIn)
	b, ok2 := parseDay(checkOut)
	if !ok1 || !ok2 {
		return 0
	}
	return max(0, int(jsmath.Round(float64(b.Sub(a))/float64(day))))
}

// EachNight is eachNight: the dates of each night (check-out excluded).
func EachNight(checkIn, checkOut string) []string {
	total := NightsBetween(checkIn, checkOut)
	start, _ := parseDay(checkIn)
	out := make([]string, 0, total)
	for i := range total {
		out = append(out, start.Add(time.Duration(i)*day).Format("2006-01-02"))
	}
	return out
}

// IsWeekendNight is isWeekendNight: Friday and Saturday nights.
func IsWeekendNight(date string) bool {
	t, ok := parseDay(date)
	if !ok {
		return false
	}
	return t.Weekday() == time.Friday || t.Weekday() == time.Saturday
}

// RoomTypeRate is the rate part of a room type.
type RoomTypeRate struct {
	ID           string
	RateWeekday  float64
	RateWeekend  float64
	ExtraBedRate float64
}

// RateSeason is one resort.rate_dates row (RoomTypeID nil = every type).
type RateSeason struct {
	RoomTypeID       *string  `json:"room_type_id"`
	Label            string   `json:"label"`
	StartDate        string   `json:"start_date"`
	EndDate          string   `json:"end_date"`
	Rate             *float64 `json:"rate"`
	SurchargePercent *float64 `json:"surcharge_percent"`
}

// NightRate is one night of a quote; it is also the rate_breakdown
// snapshot stored on the reservation.
type NightRate struct {
	Date    string  `json:"date"`
	Rate    float64 `json:"rate"`
	Weekend bool    `json:"weekend"`
	Season  *string `json:"season"`
}

// seasonFor is seasonFor: a season for the room type wins over one for
// every type; within each group the first (by start_date) wins.
func seasonFor(seasons []RateSeason, roomTypeID, date string) *RateSeason {
	var general *RateSeason
	for i := range seasons {
		s := &seasons[i]
		if date < s.StartDate || date > s.EndDate {
			continue
		}
		if s.RoomTypeID == nil {
			if general == nil {
				general = s
			}
			continue
		}
		if *s.RoomTypeID == roomTypeID {
			return s
		}
	}
	return general
}

// NightlyRate is nightlyRate: weekday or weekend base (weekend falls back
// to weekday when zero), replaced by a season's fixed rate or surcharge.
func NightlyRate(t RoomTypeRate, date string, seasons []RateSeason) NightRate {
	weekend := IsWeekendNight(date)
	base := t.RateWeekday
	if weekend && t.RateWeekend != 0 {
		base = t.RateWeekend
	}
	rate := base
	season := seasonFor(seasons, t.ID, date)
	var label *string
	if season != nil {
		switch {
		case season.Rate != nil:
			rate = *season.Rate
		case season.SurchargePercent != nil:
			rate = float64(base * float64(1+*season.SurchargePercent/100))
		}
		label = &season.Label
	}
	return NightRate{Date: date, Rate: jsmath.Round(rate), Weekend: weekend, Season: label}
}

// StayQuote is a one-room stay total.
type StayQuote struct {
	Nights        int         `json:"nights"`
	Breakdown     []NightRate `json:"breakdown"`
	RoomSubtotal  float64     `json:"room_subtotal"`
	ExtraBedTotal float64     `json:"extra_bed_total"`
	Subtotal      float64     `json:"subtotal"`
}

// QuoteStay is quoteStay: nightly rates plus extra beds per night.
func QuoteStay(t RoomTypeRate, checkIn, checkOut string, extraBed int, seasons []RateSeason) StayQuote {
	nights := EachNight(checkIn, checkOut)
	breakdown := make([]NightRate, len(nights))
	room := 0.0
	for i, d := range nights {
		breakdown[i] = NightlyRate(t, d, seasons)
		room += breakdown[i].Rate
	}
	extra := float64(float64(float64(max(0, extraBed))*t.ExtraBedRate) * float64(len(breakdown)))
	return StayQuote{Nights: len(breakdown), Breakdown: breakdown, RoomSubtotal: room, ExtraBedTotal: extra, Subtotal: room + extra}
}
