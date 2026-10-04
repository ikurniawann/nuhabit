// Package domain holds the pure rules of the CRM engagement area (ports of
// lib/crm/engagement/rules.ts, lib/crm/member-reviews.ts and the link and
// push payload helpers of lib/member-portal). The member-side rules (QR
// tokens, booking decisions, leaderboard names) live in memberportal.
package domain

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
)

var jakarta = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}()

// FormatWIB renders "Sen, 5 Okt, 15.00" the way toLocaleString("id-ID")
// does with weekday short, day numeric, month short, 2-digit hour and minute.
func FormatWIB(t time.Time) string {
	lt := t.In(jakarta)
	days := []string{"Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"}
	months := []string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}
	return fmt.Sprintf("%s, %d %s, %02d.%02d", days[lt.Weekday()], lt.Day(), months[lt.Month()-1], lt.Hour(), lt.Minute())
}

// ── Event bookings ────────────────────────────────────────────────────────

var bookingTransitions = map[string][]string{
	"confirmed": {"cancelled", "attended", "no_show"},
	"waitlist":  {"cancelled"},
}

// CanChangeBooking reports whether a booking may move from one status to
// another (the `allowed` table of changeBooking).
func CanChangeBooking(from, to string) bool { return slices.Contains(bookingTransitions[from], to) }

// IsLateCancel: cancelling after the deadline is recorded for staff.
func IsLateCancel(startsAt time.Time, cancelDeadlineHours int, now time.Time) bool {
	return now.After(startsAt.Add(-time.Duration(cancelDeadlineHours) * time.Hour))
}

// WaitlistEntry is a waiting booking.
type WaitlistEntry struct {
	ID         string
	CustomerID string
	Position   *int
	CreatedAt  time.Time
}

// PickWaitlistPromotion is FIFO: lowest position first, ties broken by
// sign-up time; nil when nobody waits.
func PickWaitlistPromotion(entries []WaitlistEntry) *WaitlistEntry {
	pos := func(e *WaitlistEntry) int {
		if e.Position == nil {
			return 1<<53 - 1 // Number.MAX_SAFE_INTEGER
		}
		return *e.Position
	}
	var best *WaitlistEntry
	for i := range entries {
		e := &entries[i]
		if best == nil || pos(e) < pos(best) || (pos(e) == pos(best) && e.CreatedAt.Before(best.CreatedAt)) {
			best = e
		}
	}
	return best
}

// ── Challenges ────────────────────────────────────────────────────────────

// ChallengeProgress is a participant's progress against the target.
type ChallengeProgress struct {
	Value     float64
	Target    float64
	Pct       float64
	Completed bool
}

// Progress mirrors challengeProgress: pct capped at 100.
func Progress(value, target float64) ChallengeProgress {
	pct := 0.0
	if target > 0 {
		pct = min(100, value/target*100)
	}
	return ChallengeProgress{Value: value, Target: target, Pct: pct, Completed: value >= target}
}

// ── Announcement audience ─────────────────────────────────────────────────

// Audience is the announcement target; nil fields were not sent.
type Audience struct {
	TierCodes    []string
	MinVisits    *int
	InactiveDays *int
}

// AudienceWhere mirrors audienceWhere: the WHERE clause over
// pos.pos_customers (alias c) and its parameters, numbered from $1.
func AudienceWhere(a Audience) (string, []any) {
	clauses := []string{"c.is_active IS NOT FALSE"}
	var params []any
	next := func(v any) string {
		params = append(params, v)
		return "$" + strconv.Itoa(len(params))
	}
	if len(a.TierCodes) > 0 {
		// The tier comes from XP like the portal does; membership_tier may be stale.
		clauses = append(clauses, `(SELECT t.code FROM crm.crm_membership_tiers t
         WHERE t.is_active AND t.min_lifetime_xp <= COALESCE(c.total_xp, 0)
         ORDER BY t.min_lifetime_xp DESC LIMIT 1) = ANY(`+next(a.TierCodes)+`)`)
	}
	if a.MinVisits != nil && *a.MinVisits > 0 {
		clauses = append(clauses, "COALESCE(c.visit_count, 0) >= "+next(*a.MinVisits))
	}
	if a.InactiveDays != nil && *a.InactiveDays > 0 {
		clauses = append(clauses, "(c.last_visit IS NULL OR c.last_visit < now() - make_interval(days => "+next(*a.InactiveDays)+"))")
	}
	return strings.Join(clauses, " AND "), params
}
