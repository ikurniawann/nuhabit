package domain

import (
	"fmt"
	"strings"
	"time"
)

// QR check-in credentials (crm/engagement/rules.ts).
const (
	QRTokenPrefix = "nhqr_"
	QRTTLSeconds  = 60
)

// ── Event booking ─────────────────────────────────────────────────────────

// BookableEvent is the part of crm.events a booking decision reads.
type BookableEvent struct {
	Status             string
	StartsAt           time.Time
	Capacity           int
	BookingClosesHours int
}

// BookingDecision is confirm, waitlist (with position) or deny (with reason).
type BookingDecision struct {
	Kind     string `json:"kind"`
	Position int    `json:"position,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

// BookingDenialLabel are the member-facing reasons.
var BookingDenialLabel = map[string]string{
	"event_not_open": "Event ini belum dibuka atau sudah dibatalkan",
	"booking_closed": "Pendaftaran event ini sudah ditutup",
	"event_started":  "Event ini sudah dimulai",
	"already_booked": "Anda sudah terdaftar di event ini",
}

// EvaluateBooking decides one booking request.
func EvaluateBooking(event BookableEvent, confirmed, lastWaitlist int, hasActive bool, now time.Time) BookingDecision {
	if event.Status != "published" {
		return BookingDecision{Kind: "deny", Reason: "event_not_open"}
	}
	if !event.StartsAt.After(now) {
		return BookingDecision{Kind: "deny", Reason: "event_started"}
	}
	closes := event.StartsAt.Add(-time.Duration(event.BookingClosesHours) * time.Hour)
	if !closes.After(now) {
		return BookingDecision{Kind: "deny", Reason: "booking_closed"}
	}
	if hasActive {
		return BookingDecision{Kind: "deny", Reason: "already_booked"}
	}
	if confirmed >= event.Capacity {
		return BookingDecision{Kind: "waitlist", Position: lastWaitlist + 1}
	}
	return BookingDecision{Kind: "confirm"}
}

// IsLateCancel: cancelling after the deadline is recorded for staff.
func IsLateCancel(startsAt time.Time, cancelDeadlineHours int, now time.Time) bool {
	return now.After(startsAt.Add(-time.Duration(cancelDeadlineHours) * time.Hour))
}

// BookingTransitions are the member/staff moves allowed from each status.
var BookingTransitions = map[string][]string{
	"confirmed": {"cancelled", "attended", "no_show"},
	"waitlist":  {"cancelled"},
}

// CanChangeBooking reports whether from -> to is allowed.
func CanChangeBooking(from, to string) bool {
	for _, s := range BookingTransitions[from] {
		if s == to {
			return true
		}
	}
	return false
}

// WaitlistEntry is a waiting booking.
type WaitlistEntry struct {
	ID         string
	CustomerID string
	Position   *int
	CreatedAt  time.Time
}

// PickWaitlistPromotion is FIFO: lowest position, ties broken by sign-up time.
func PickWaitlistPromotion(entries []WaitlistEntry) *WaitlistEntry {
	var best *WaitlistEntry
	pos := func(e *WaitlistEntry) int {
		if e.Position == nil {
			return int(^uint(0) >> 1)
		}
		return *e.Position
	}
	for i := range entries {
		e := &entries[i]
		if best == nil || pos(e) < pos(best) || (pos(e) == pos(best) && e.CreatedAt.Before(best.CreatedAt)) {
			best = e
		}
	}
	return best
}

// ── Challenges ────────────────────────────────────────────────────────────

// ChallengeProgress is the member's progress against a target.
type ChallengeProgress struct {
	Value     float64 `json:"value"`
	Target    float64 `json:"target"`
	Pct       float64 `json:"pct"`
	Completed bool    `json:"completed"`
}

// Progress mirrors challengeProgress.
func Progress(value, target float64) ChallengeProgress {
	pct := 0.0
	if target > 0 {
		pct = value / target * 100
		if pct > 100 {
			pct = 100
		}
	}
	return ChallengeProgress{Value: value, Target: target, Pct: pct, Completed: value >= target}
}

// ChallengePhase is upcoming, running or ended.
func ChallengePhase(startsAt, endsAt, now time.Time) string {
	if now.Before(startsAt) {
		return "upcoming"
	}
	if now.After(endsAt) {
		return "ended"
	}
	return "running"
}

// LeaderboardName shows a first name plus last initial, for privacy.
func LeaderboardName(name *string) string {
	if name == nil {
		return "Member"
	}
	parts := strings.Fields(*name)
	if len(parts) == 0 {
		return "Member"
	}
	if len(parts) == 1 {
		return parts[0]
	}
	last := []rune(parts[len(parts)-1])
	return fmt.Sprintf("%s %s.", parts[0], string(last[0]))
}

// ── Reviews (crm/member-reviews.ts) ───────────────────────────────────────

// Review rules.
const (
	ReviewWindowDays = 14
	ReviewCommentMax = 1000
)

// ReviewIneligibleMessages are the member-facing reasons.
var ReviewIneligibleMessages = map[string]string{
	"order-tidak-ditemukan": "Order tidak ditemukan",
	"bukan-order-member":    "Order ini bukan milik akun Anda",
	"belum-lunas":           "Order belum lunas",
	"order-batal":           "Order dibatalkan",
	"lewat-batas-waktu":     fmt.Sprintf("Ulasan hanya bisa diberikan maksimal %d hari setelah order", ReviewWindowDays),
	"sudah-diulas":          "Order ini sudah Anda ulas",
}

// ReviewableOrder is the order a review targets.
type ReviewableOrder struct {
	CustomerID    *string
	PaymentStatus string
	Status        string
	PaidAt        time.Time
}

// ReviewEligibility returns "" when the member may review, else the reason.
func ReviewEligibility(order *ReviewableOrder, customerID string, now time.Time, alreadyReviewed bool) string {
	if order == nil {
		return "order-tidak-ditemukan"
	}
	if order.CustomerID == nil || *order.CustomerID != customerID {
		return "bukan-order-member"
	}
	switch order.Status {
	case "cancelled", "voided", "merged":
		return "order-batal"
	}
	if order.PaymentStatus != "paid" {
		return "belum-lunas"
	}
	if alreadyReviewed {
		return "sudah-diulas"
	}
	if now.Sub(order.PaidAt) > ReviewWindowDays*24*time.Hour {
		return "lewat-batas-waktu"
	}
	return ""
}

// CleanReviewText trims, maps empty to nil and cuts at max UTF-16 units.
func CleanReviewText(text *string, max int) *string {
	if text == nil {
		return nil
	}
	value := strings.TrimSpace(*text)
	if value == "" {
		return nil
	}
	value = JSSlice(value, max)
	return &value
}

// JSSlice cuts s to at most n UTF-16 code units, like String.prototype.slice.
func JSSlice(s string, n int) string {
	if JSLength(s) <= n {
		return s
	}
	units := 0
	for i, r := range s {
		w := 1
		if r >= 0x10000 {
			w = 2
		}
		if units+w > n {
			return s[:i]
		}
		units += w
	}
	return s
}

// FormatWIB renders "Sen, 5 Okt, 15.00" the way toLocaleString("id-ID") does
// with weekday short, day numeric, month short, 2-digit hour and minute.
func FormatWIB(t time.Time) string {
	loc := Jakarta()
	lt := t.In(loc)
	days := []string{"Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"}
	months := []string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}
	return fmt.Sprintf("%s, %d %s, %02d.%02d", days[lt.Weekday()], lt.Day(), months[lt.Month()-1], lt.Hour(), lt.Minute())
}

var jakarta = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}()

// Jakarta is Asia/Jakarta, falling back to a fixed UTC+7 zone.
func Jakarta() *time.Location { return jakarta }

// TodayWIB is the calendar date in Asia/Jakarta as YYYY-MM-DD.
func TodayWIB(now time.Time) string { return now.In(Jakarta()).Format("2006-01-02") }
