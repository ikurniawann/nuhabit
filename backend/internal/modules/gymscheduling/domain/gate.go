package domain

import (
	"strconv"
	"strings"
	"time"
)

// CheckInWindow is how far before a class starts (early) and after it ends
// (late) the gate admits its bookings, from checkinOpensMinBefore and
// checkinClosesMinAfter.
func CheckInWindow(rules Rules) (early, late time.Duration) {
	return time.Duration(rules.CheckinOpensMinBefore) * time.Minute, time.Duration(rules.CheckinClosesMinAfter) * time.Minute
}

func IsWithinCheckInWindow(startsAt, endsAt, now time.Time, rules Rules) bool {
	early, late := CheckInWindow(rules)
	return !now.Before(startsAt.Add(-early)) && !now.After(endsAt.Add(late))
}

// WaiverMissing: the rules ask for a waiver and the member has not accepted
// one, or accepted a version other than current. An empty current version
// accepts any version.
func WaiverMissing(rules Rules, acceptedVersion *string, acceptedAt *time.Time, current string) bool {
	if !rules.RequireWaiver {
		return false
	}
	if acceptedAt == nil || acceptedVersion == nil {
		return true
	}
	return current != "" && *acceptedVersion != current
}

// OpenHours is one weekday's open gym window, in minutes after midnight in
// the branch zone. Weekday is ISO: 1 = Monday … 7 = Sunday.
type OpenHours struct {
	Weekday       int
	Opens, Closes int
}

// IsOpenGymTime: a branch with no hours set is open all day; otherwise now,
// read in the branch zone loc, must fall inside that weekday's window
// [Opens, Closes).
func IsOpenGymTime(hours []OpenHours, now time.Time, loc *time.Location) bool {
	if len(hours) == 0 {
		return true
	}
	w := now.In(loc)
	weekday := isoWeekday(w)
	minute := w.Hour()*60 + w.Minute()
	for _, h := range hours {
		if h.Weekday == weekday && minute >= h.Opens && minute < h.Closes {
			return true
		}
	}
	return false
}

// QrTokenProblem is why a scanned QR token cannot be used.
type QrTokenProblem string

const (
	QrNotFound QrTokenProblem = "not_found"
	QrExpired  QrTokenProblem = "expired"
	QrConsumed QrTokenProblem = "consumed"
)

// QrToken is the stored state of a member QR credential.
type QrToken struct {
	CustomerID string
	ExpiresAt  time.Time
	ConsumedAt *time.Time
}

// CheckQrToken mirrors checkQrToken in crm/engagement/rules.ts. Empty result
// means the token is usable.
func CheckQrToken(token *QrToken, now time.Time) QrTokenProblem {
	switch {
	case token == nil:
		return QrNotFound
	case token.ConsumedAt != nil:
		return QrConsumed
	case token.ExpiresAt.Before(now):
		return QrExpired
	}
	return ""
}

type GateDenialReason string

const (
	GateTokenInvalid        GateDenialReason = "token_invalid"
	GateTokenExpired        GateDenialReason = "token_expired"
	GateTokenConsumed       GateDenialReason = "token_consumed"
	GateMemberNotActive     GateDenialReason = "member_not_active"
	GateWaiverRequired      GateDenialReason = "waiver_required"
	GateAntiPassback        GateDenialReason = "anti_passback"
	GateNoBooking           GateDenialReason = "no_booking"
	GateOpenGymClosed       GateDenialReason = "open_gym_closed"
	GateInsufficientCredits GateDenialReason = "insufficient_credits"
)

var GateDenialLabel = map[GateDenialReason]string{
	GateTokenInvalid:        "QR tidak dikenal",
	GateTokenExpired:        "QR kedaluwarsa, minta member membuka ulang kartunya",
	GateTokenConsumed:       "QR sudah dipakai",
	GateMemberNotActive:     "Keanggotaan tidak aktif",
	GateWaiverRequired:      "Waiver belum disetujui, minta member menyetujui waiver dulu",
	GateAntiPassback:        "Baru saja masuk, tunggu sebelum scan lagi",
	GateNoBooking:           "Tidak ada booking kelas",
	GateOpenGymClosed:       "Di luar jam open gym",
	GateInsufficientCredits: "Kredit tidak cukup untuk kelas ini",
}

var TokenDenial = map[QrTokenProblem]GateDenialReason{
	QrNotFound: GateTokenInvalid,
	QrExpired:  GateTokenExpired,
	QrConsumed: GateTokenConsumed,
}

type GateEntryKind string

const (
	EntryBooking GateEntryKind = "booking"
	EntryReEntry GateEntryKind = "re_entry"
	EntryOpenGym GateEntryKind = "open_gym"
)

type Decision string

const (
	Allowed Decision = "allowed"
	Denied  Decision = "denied"
)

type EffectKind string

const (
	EffectConsumeToken  EffectKind = "consume_token"
	EffectDeductCredits EffectKind = "deduct_credits"
	EffectCheckIn       EffectKind = "check_in_booking"
	// EffectChargeOpenGym takes the day's open gym fee.
	EffectChargeOpenGym EffectKind = "charge_open_gym"
)

// GateEffect is one side effect the server applies, in order, inside the
// scan's transaction.
type GateEffect struct {
	Kind      EffectKind
	Amount    int
	BookingID string
}

type GateScanEvaluation struct {
	Decision  Decision
	Reason    GateDenialReason
	EntryKind GateEntryKind
	Effects   []GateEffect
}

// GateCandidate is the confirmed booking around now that the scan may check in.
type GateCandidate struct {
	BookingID  string
	CreditCost int
	// HasPass: a pass covers the class, so entry costs no credits.
	HasPass bool
}

// OpenGymVisit is what open gym entry is decided on, when the rules enable it.
type OpenGymVisit struct {
	// Open: now is inside the branch's open gym hours.
	Open bool
	// HasPass: a pass covers today, so entry is free.
	HasPass bool
	// PaidToday: the member already entered open gym this day (branch zone).
	PaidToday bool
}

type GateScanInput struct {
	// TokenProblem is empty when the caller already validated the token.
	TokenProblem       QrTokenProblem
	MemberActive       bool
	WaiverMissing      bool
	LastAllowedEntryAt *time.Time
	Candidate          *GateCandidate
	// OpenGym is set when no booking is around now and the rules enable open gym.
	OpenGym *OpenGymVisit
	Balance int
	Rules   Rules
	Now     time.Time
}

// EvaluateGateScan runs the gate pipeline: QR, membership, waiver, re-entry
// and anti-passback, booking or open gym, credits. It returns the decision
// plus the effects to apply in one transaction, so the gate never opens
// without its deduction.
func EvaluateGateScan(in GateScanInput) GateScanEvaluation {
	denied := func(reason GateDenialReason, effects ...GateEffect) GateScanEvaluation {
		return GateScanEvaluation{Decision: Denied, Reason: reason, Effects: effects}
	}

	// 1. Valid QR? An invalid token is not consumed (there is nothing to consume).
	if in.TokenProblem != "" {
		return denied(TokenDenial[in.TokenProblem])
	}
	consume := GateEffect{Kind: EffectConsumeToken}

	// 2. Active membership and an accepted waiver?
	if !in.MemberActive {
		return denied(GateMemberNotActive, consume)
	}
	if in.WaiverMissing {
		return denied(GateWaiverRequired, consume)
	}

	// 3. Free re-entry within the grace period, then anti-passback. A booking
	//    not yet checked in always wins, so back-to-back classes are still
	//    recorded (and do not fall to no-show).
	if in.LastAllowedEntryAt != nil && in.Candidate == nil {
		minsSince := float64(in.Now.Sub(*in.LastAllowedEntryAt)) / float64(time.Minute)
		if minsSince >= 0 && minsSince <= float64(in.Rules.ReEntryGraceMin) {
			return GateScanEvaluation{Decision: Allowed, EntryKind: EntryReEntry, Effects: []GateEffect{consume}}
		}
		if minsSince >= 0 && minsSince <= float64(in.Rules.AntiPassbackMin) {
			return denied(GateAntiPassback, consume)
		}
	}

	// 4. A class booking around now, else open gym when the branch has it.
	if in.Candidate == nil {
		if in.OpenGym == nil {
			return denied(GateNoBooking, consume)
		}
		return evaluateOpenGym(*in.OpenGym, in.Balance, in.Rules.OpenGymCreditCost, consume)
	}

	// 5. A pass covers the class, or the balance does.
	if in.Candidate.HasPass {
		return GateScanEvaluation{
			Decision:  Allowed,
			EntryKind: EntryBooking,
			Effects:   []GateEffect{consume, {Kind: EffectCheckIn, BookingID: in.Candidate.BookingID}},
		}
	}
	if in.Balance < in.Candidate.CreditCost {
		return denied(GateInsufficientCredits, consume)
	}

	return GateScanEvaluation{
		Decision:  Allowed,
		EntryKind: EntryBooking,
		Effects: []GateEffect{
			consume,
			{Kind: EffectDeductCredits, Amount: in.Candidate.CreditCost},
			{Kind: EffectCheckIn, BookingID: in.Candidate.BookingID},
		},
	}
}

// evaluateOpenGym admits an open gym visit inside the open hours. Pass
// holders, a free open gym and a second visit the same day cost nothing;
// otherwise the day's fee is charged.
func evaluateOpenGym(v OpenGymVisit, balance, cost int, consume GateEffect) GateScanEvaluation {
	if !v.Open {
		return GateScanEvaluation{Decision: Denied, Reason: GateOpenGymClosed, Effects: []GateEffect{consume}}
	}
	allowed := GateScanEvaluation{Decision: Allowed, EntryKind: EntryOpenGym, Effects: []GateEffect{consume}}
	if v.HasPass || v.PaidToday || cost <= 0 {
		return allowed
	}
	if balance < cost {
		return GateScanEvaluation{Decision: Denied, Reason: GateInsufficientCredits, Effects: []GateEffect{consume}}
	}
	allowed.Effects = append(allowed.Effects, GateEffect{Kind: EffectChargeOpenGym, Amount: cost})
	return allowed
}

// GateDetail feeds DescribeGateDecision. Zero Credits and nil BalanceAfter
// are omitted; Pass says the entry was covered by a pass.
type GateDetail struct {
	ClassName    string
	Credits      int
	BalanceAfter *int
	Pass         bool
}

// DescribeGateDecision is the staff-facing sentence: why the member got in,
// or why not.
func DescribeGateDecision(decision Decision, reason GateDenialReason, entryKind GateEntryKind, d GateDetail) string {
	if decision == Denied {
		if reason == "" {
			reason = GateNoBooking
		}
		return GateDenialLabel[reason]
	}
	if entryKind == EntryReEntry {
		return "Masuk ulang dalam masa tenggang, tanpa potong kredit"
	}
	className := d.ClassName
	if className == "" {
		className = "kelas"
	}
	parts := []string{"Check-in " + className}
	if entryKind == EntryOpenGym {
		parts = []string{"Open gym"}
	}
	if d.Pass {
		return strings.Join(append(parts, "pass aktif, tanpa potong kredit"), " · ")
	}
	if d.Credits != 0 {
		parts = append(parts, strconv.Itoa(d.Credits)+" kredit dipotong")
	} else if entryKind == EntryOpenGym {
		parts = append(parts, "tanpa potong kredit")
	}
	if d.BalanceAfter != nil {
		parts = append(parts, "sisa "+strconv.Itoa(*d.BalanceAfter)+" kredit")
	}
	return strings.Join(parts, " · ")
}

// DeviceDisplay is the short text a gate device shows: a greeting with the
// member's first name, or the denial label.
func DeviceDisplay(decision Decision, reason GateDenialReason, memberName *string) string {
	if decision == Denied {
		if reason == "" {
			reason = GateNoBooking
		}
		return "Ditolak: " + GateDenialLabel[reason]
	}
	if memberName != nil {
		if first, _, _ := strings.Cut(strings.TrimSpace(*memberName), " "); first != "" {
			return "Silakan masuk, " + first
		}
	}
	return "Silakan masuk"
}
