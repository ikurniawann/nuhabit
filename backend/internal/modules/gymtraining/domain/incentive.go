package domain

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Coach incentives: pay (IDR) per completed class, the monthly statement and
// the payout lifecycle. Separate from member credits. Rupiah amounts are
// float64 because the TS reads numeric(14,2) columns as ::float numbers.

// SchemeRate overrides a scheme's pay for one class type.
type SchemeRate struct {
	ClassTypeID    string  `json:"classTypeId"`
	SessionFeeIDR  float64 `json:"sessionFeeIdr"`
	PerAttendeeIDR float64 `json:"perAttendeeIdr"`
}

// IncentiveScheme is how a coach is paid.
type IncentiveScheme struct {
	ID string `json:"id"`
	// nil = the organization default; set = that coach's own scheme.
	CoachID   *string `json:"coachId"`
	IsDefault bool    `json:"isDefault"`
	// Flat fee per completed class.
	SessionFeeIDR float64 `json:"sessionFeeIdr"`
	// Per member who actually attended.
	PerAttendeeIDR float64 `json:"perAttendeeIdr"`
	// Bonus when attendance reaches the threshold.
	FullClassBonusIDR float64 `json:"fullClassBonusIdr"`
	// e.g. 80 → bonus when attendance is at least 80% of capacity.
	FullClassThresholdPercent int `json:"fullClassThresholdPercent"`
	// Deduction per no-show; never takes a line below zero.
	NoShowPenaltyIDR float64      `json:"noShowPenaltyIdr"`
	Rates            []SchemeRate `json:"rates"`
	IsActive         bool         `json:"isActive"`
}

// Scheme is anything that carries an IncentiveScheme (rows with a name).
type Scheme interface{ Incentive() IncentiveScheme }

// Incentive returns the scheme itself.
func (s IncentiveScheme) Incentive() IncentiveScheme { return s }

// ResolveScheme: an active coach scheme wins, otherwise the default.
func ResolveScheme[S Scheme](defaultScheme S, coachOverride *S) S {
	if coachOverride != nil && (*coachOverride).Incentive().IsActive {
		return *coachOverride
	}
	return defaultScheme
}

// RateFor is what the scheme pays for a class type: its override, or the
// scheme's own numbers.
func RateFor(scheme IncentiveScheme, classTypeID string) SchemeRate {
	for _, r := range scheme.Rates {
		if r.ClassTypeID == classTypeID {
			return r
		}
	}
	return SchemeRate{ClassTypeID: classTypeID, SessionFeeIDR: scheme.SessionFeeIDR, PerAttendeeIDR: scheme.PerAttendeeIDR}
}

/* ── Periods ─────────────────────────────────────────────────────────── */

var periodRE = regexp.MustCompile(`^(\d{4})-(0[1-9]|1[0-2])$`)

// studioZone is WIB (UTC+7), the studio's calendar.
var studioZone = time.FixedZone("WIB", 7*3600)

// IsPeriodMonth reports whether value is a YYYY-MM month.
func IsPeriodMonth(value string) bool { return periodRE.MatchString(value) }

// Period is [Start, End) in absolute time.
type Period struct{ Start, End time.Time }

// MonthPeriod bounds the calendar month YYYY-MM in the studio zone (WIB).
func MonthPeriod(periodMonth string) (Period, error) {
	m := periodRE.FindStringSubmatch(periodMonth)
	if m == nil {
		return Period{}, fmt.Errorf("Periode tidak valid: %s", periodMonth)
	}
	year, _ := strconv.Atoi(m[1])
	month, _ := strconv.Atoi(m[2])
	start := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, studioZone)
	return Period{Start: start.UTC(), End: start.AddDate(0, 1, 0).UTC()}, nil
}

/* ── Statement ───────────────────────────────────────────────────────── */

// StatementSession is a class as the statement sees it.
type StatementSession struct {
	ID              string
	CoachID         *string
	ClassTypeID     string
	ClassTypeName   string
	StartsAt        time.Time
	Capacity        int
	Status          string
	BookingStatuses []string
}

// CoachStatementLine is the pay for one class.
type CoachStatementLine struct {
	SessionID     string    `json:"sessionId"`
	StartsAt      Timestamp `json:"startsAt"`
	ClassTypeID   string    `json:"classTypeId"`
	ClassTypeName string    `json:"classTypeName"`
	Capacity      int       `json:"capacity"`
	// Bookings holding a place (confirmed, checked in, completed, no-show).
	Booked int `json:"booked"`
	// Members who came (checked_in or completed).
	Attended      int     `json:"attended"`
	NoShows       int     `json:"noShows"`
	SessionFeeIDR float64 `json:"sessionFeeIdr"`
	AttendeeIDR   float64 `json:"attendeeIdr"`
	BonusIDR      float64 `json:"bonusIdr"`
	PenaltyIDR    float64 `json:"penaltyIdr"`
	TotalIDR      float64 `json:"totalIdr"` // fee + attendees + bonus − penalty, at least 0
}

// CoachStatementTotals sums the lines.
type CoachStatementTotals struct {
	Sessions      int     `json:"sessions"`
	Attended      int     `json:"attended"`
	NoShows       int     `json:"noShows"`
	SessionFeeIDR float64 `json:"sessionFeeIdr"`
	AttendeeIDR   float64 `json:"attendeeIdr"`
	BonusIDR      float64 `json:"bonusIdr"`
	PenaltyIDR    float64 `json:"penaltyIdr"`
	TotalIDR      float64 `json:"totalIdr"`
}

// CoachStatement is one coach's pay for one month.
type CoachStatement struct {
	CoachID     string               `json:"coachId"`
	PeriodMonth string               `json:"periodMonth"`
	SchemeID    string               `json:"schemeId"`
	Lines       []CoachStatementLine `json:"lines"`
	Totals      CoachStatementTotals `json:"totals"`
}

var (
	heldSlot = []string{"confirmed", "checked_in", "completed", "no_show"}
	attended = []string{"checked_in", "completed"}
)

func countIn(statuses, set []string) int {
	n := 0
	for _, s := range statuses {
		if slices.Contains(set, s) {
			n++
		}
	}
	return n
}

// ComputeLine prices one class:
//
//	sessionFee + attended × perAttendee
//	+ (attended/capacity ≥ threshold ? fullClassBonus : 0)
//	− noShows × penalty, clamped at 0.
func ComputeLine(scheme IncentiveScheme, s StatementSession) CoachStatementLine {
	came := countIn(s.BookingStatuses, attended)
	noShows := countIn(s.BookingStatuses, []string{"no_show"})
	rate := RateFor(scheme, s.ClassTypeID)
	fillPercent := 0.0
	if s.Capacity > 0 {
		fillPercent = float64(came) / float64(s.Capacity) * 100
	}
	bonus := 0.0
	if s.Capacity > 0 && fillPercent >= float64(scheme.FullClassThresholdPercent) {
		bonus = scheme.FullClassBonusIDR
	}
	attendee := float64(came) * rate.PerAttendeeIDR
	penalty := float64(noShows) * scheme.NoShowPenaltyIDR
	return CoachStatementLine{
		SessionID:     s.ID,
		StartsAt:      At(s.StartsAt),
		ClassTypeID:   s.ClassTypeID,
		ClassTypeName: s.ClassTypeName,
		Capacity:      s.Capacity,
		Booked:        countIn(s.BookingStatuses, heldSlot),
		Attended:      came,
		NoShows:       noShows,
		SessionFeeIDR: rate.SessionFeeIDR,
		AttendeeIDR:   attendee,
		BonusIDR:      bonus,
		PenaltyIDR:    penalty,
		TotalIDR:      math.Max(0, rate.SessionFeeIDR+attendee+bonus-penalty),
	}
}

// ComputeCoachStatement is one coach's statement for a month: only that
// coach's completed classes starting inside the month count, oldest first.
func ComputeCoachStatement(coachID, periodMonth string, scheme IncentiveScheme, sessions []StatementSession) (CoachStatement, error) {
	period, err := MonthPeriod(periodMonth)
	if err != nil {
		return CoachStatement{}, err
	}
	var inPeriod []StatementSession
	for _, s := range sessions {
		t := millis(s.StartsAt)
		if s.CoachID != nil && *s.CoachID == coachID && s.Status == "completed" &&
			t >= millis(period.Start) && t < millis(period.End) {
			inPeriod = append(inPeriod, s)
		}
	}
	sort.SliceStable(inPeriod, func(i, j int) bool { return millis(inPeriod[i].StartsAt) < millis(inPeriod[j].StartsAt) })

	st := CoachStatement{CoachID: coachID, PeriodMonth: periodMonth, SchemeID: scheme.ID, Lines: []CoachStatementLine{}}
	for _, s := range inPeriod {
		l := ComputeLine(scheme, s)
		st.Lines = append(st.Lines, l)
		t := &st.Totals
		t.Sessions++
		t.Attended += l.Attended
		t.NoShows += l.NoShows
		t.SessionFeeIDR += l.SessionFeeIDR
		t.AttendeeIDR += l.AttendeeIDR
		t.BonusIDR += l.BonusIDR
		t.PenaltyIDR += l.PenaltyIDR
		t.TotalIDR += l.TotalIDR
	}
	return st, nil
}

/* ── Payout ──────────────────────────────────────────────────────────── */

// Payout statuses.
const (
	PayoutDraft    = "draft"
	PayoutApproved = "approved"
	PayoutPaid     = "paid"
	PayoutVoid     = "void"
)

// PayoutTransitions is the payout state machine.
var PayoutTransitions = map[string][]string{
	PayoutDraft:    {PayoutApproved, PayoutVoid},
	PayoutApproved: {PayoutPaid, PayoutVoid},
	PayoutPaid:     {},
	PayoutVoid:     {},
}

// PayoutActions are the admin actions and the status each one targets.
var (
	PayoutActions      = []string{"approve", "pay", "void"}
	payoutActionTarget = map[string]string{"approve": PayoutApproved, "pay": PayoutPaid, "void": PayoutVoid}
	payoutStatusLabels = map[string]string{PayoutDraft: "Draf", PayoutApproved: "Disetujui", PayoutPaid: "Dibayar", PayoutVoid: "Dibatalkan"}
	payoutActionVerbs  = map[string]string{"approve": "disetujui", "pay": "dibayar", "void": "dibatalkan"}
)

// PayoutDecision is an accepted action.
type PayoutDecision struct {
	Status           string
	PaymentReference *string
	Note             *string
}

func trimmedOrNil(v *string) *string {
	if v == nil {
		return nil
	}
	if t := strings.TrimSpace(*v); t != "" {
		return &t
	}
	return nil
}

// DecidePayoutAction validates one admin action on a payout. Paying needs a
// payment reference; voiding needs a reason. The string is the refusal.
func DecidePayoutAction(current, action string, paymentReference, note *string) (PayoutDecision, string) {
	target := payoutActionTarget[action]
	if !slices.Contains(PayoutTransitions[current], target) {
		return PayoutDecision{}, fmt.Sprintf("Payout berstatus %s tidak bisa %s.",
			strings.ToLower(payoutStatusLabels[current]), payoutActionVerbs[action])
	}
	ref, reason := trimmedOrNil(paymentReference), trimmedOrNil(note)
	if action == "pay" && ref == nil {
		return PayoutDecision{}, "Referensi pembayaran wajib diisi."
	}
	if action == "void" && reason == nil {
		return PayoutDecision{}, "Alasan pembatalan wajib diisi."
	}
	return PayoutDecision{Status: target, PaymentReference: ref, Note: reason}, ""
}
