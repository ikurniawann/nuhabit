package domain

import (
	"math"
	"strings"
	"time"
	"unicode"

	"nuhabit/backend/internal/platform/localtime"
)

// Settings are gym.loyalty_settings: the tier hold and the XP values.
type Settings struct {
	TierHoldMonths          int `json:"tier_hold_months"`
	XPClassAttended         int `json:"xp_class_attended"`
	XPPTAttended            int `json:"xp_pt_attended"`
	XPOffPeakBonus          int `json:"xp_offpeak_bonus"`
	XPWeeklyStreak          int `json:"xp_weekly_streak"`
	WeeklyStreakMinSessions int `json:"weekly_streak_min_sessions"`
	XPStreak4W              int `json:"xp_streak_4w"`
	XPPurchasePerStep       int `json:"xp_purchase_per_step"`
	PurchaseStepIdr         int `json:"purchase_step_idr"`
	XPEarlyRenewal          int `json:"xp_early_renewal"`
}

// OffPeak is a branch's off-peak window in minutes after local midnight,
// [Start, End).
type OffPeak struct {
	Start int `json:"starts_min"`
	End   int `json:"ends_min"`
}

// Contains: the class starts inside the window, read in the branch zone.
func (w OffPeak) Contains(startsAt time.Time, zone *time.Location) bool {
	local := startsAt.In(zone)
	m := local.Hour()*60 + local.Minute()
	return m >= w.Start && m < w.End
}

// PurchaseXP is the XP for paying amount for a package: the per-step XP for
// each whole step.
func PurchaseXP(amount float64, s Settings) int {
	if amount <= 0 || s.PurchaseStepIdr <= 0 {
		return 0
	}
	return int(math.Floor(amount/float64(s.PurchaseStepIdr))) * s.XPPurchasePerStep
}

// StreakWeeks counts the ISO weeks in a row, ending with the week starting
// weekStart, that hold at least minSessions attended sessions. Weeks are
// read in loc.
func StreakWeeks(attended []time.Time, weekStart time.Time, loc *time.Location, minSessions int) int {
	perWeek := map[string]int{}
	for _, at := range attended {
		perWeek[localtime.DayKey(localtime.WeekStart(at, loc), loc)]++
	}
	streak := 0
	for week := localtime.WeekStart(weekStart, loc); perWeek[localtime.DayKey(week, loc)] >= max(minSessions, 1); week = week.AddDate(0, 0, -7) {
		streak++
	}
	return streak
}

// Renewal is what an early renewal is decided on, as the purchase was paid.
type Renewal struct {
	PaidAt time.Time
	// PassRunsUntil is the end of the member's other live pass, nil when none.
	PassRunsUntil *time.Time
	// CreditsLeft are the unexpired credits from the member's other packages.
	CreditsLeft int
}

// Early: the member bought while a previous package still ran, a pass that
// had not ended or credits left to use.
func (r Renewal) Early() bool {
	return (r.PassRunsUntil != nil && r.PassRunsUntil.After(r.PaidAt)) || r.CreditsLeft > 0
}

// FourWeekStreak: every fourth week in a row earns the 4-week bonus.
func FourWeekStreak(weeks int) bool { return weeks > 0 && weeks%4 == 0 }

// LeaderboardAlias shortens a name for the leaderboard: "Maya Kartika Sari"
// becomes "Maya K.", a blank name "Atlet".
func LeaderboardAlias(name string) string {
	parts := strings.Fields(name)
	switch len(parts) {
	case 0:
		return "Atlet"
	case 1:
		return parts[0]
	}
	initial := []rune(parts[1])[0]
	return parts[0] + " " + string(unicode.ToUpper(initial)) + "."
}

// CompetitionRanks ranks counts sorted high to low: equal counts share a
// rank and the next count skips the shared places (1, 1, 3).
func CompetitionRanks(counts []int) []int {
	ranks := make([]int, len(counts))
	for i, c := range counts {
		if i > 0 && c == counts[i-1] {
			ranks[i] = ranks[i-1]
		} else {
			ranks[i] = i + 1
		}
	}
	return ranks
}
