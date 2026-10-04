package domain

import (
	"math"
	"strings"
	"time"
	"unicode"
)

// Member app home rules (lib/member-app/home.ts, lib/gym/booking.ts).
const (
	WaiverVersion = "1.0"
	// CheckinLateMinutes keeps a booking on the home rail until this long
	// after the class ends.
	CheckinLateMinutes = 15
)

var raceImageCities = map[string]bool{
	"bangkok": true, "berlin": true, "hongkong": true, "jakarta": true,
	"kualalumpur": true, "newyork": true, "singapore": true, "sydney": true,
}

// RaceImage is the admin image, or the app's bundled photo of the city.
func RaceImage(imageURL *string, city string) *string {
	if imageURL != nil && *imageURL != "" {
		return imageURL
	}
	slug := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' {
			return r
		}
		return -1
	}, strings.Map(unicode.ToLower, city))
	if !raceImageCities[slug] {
		return nil
	}
	path := "/member-assets/img/race-" + slug + ".jpg"
	return &path
}

// DaysUntil rounds the days to a race up, never below zero.
func DaysUntil(startsAt, now time.Time) int {
	return int(math.Max(0, math.Ceil(float64(startsAt.Sub(now).Milliseconds())/86_400_000)))
}

// PickRailDay keeps today's (WIB) sessions that have not started; once the
// last one has passed, tomorrow's. It returns the rail day and the indexes
// of the kept sessions.
func PickRailDay(startsAt []time.Time, now time.Time) (string, []int) {
	today := TodayWIB(now)
	var todayIdx, upcoming []int
	for i, t := range startsAt {
		if t.After(now) {
			upcoming = append(upcoming, i)
			if TodayWIB(t) == today {
				todayIdx = append(todayIdx, i)
			}
		}
	}
	if len(todayIdx) > 0 {
		return "TODAY", todayIdx
	}
	tomorrow := TodayWIB(now.Add(24 * time.Hour))
	var tomorrowIdx []int
	for _, i := range upcoming {
		if TodayWIB(startsAt[i]) == tomorrow {
			tomorrowIdx = append(tomorrowIdx, i)
		}
	}
	return "TOMORROW", tomorrowIdx
}
