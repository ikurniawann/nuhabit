package domain

import (
	"strconv"
	"strings"
	"time"
)

// The gate admits a member for a class from 45 minutes before it starts until
// 15 minutes after it ends.
const (
	CheckInEarlyMin = 45
	CheckInLateMin  = 15
)

func IsWithinCheckInWindow(startsAt, endsAt, now time.Time) bool {
	return !now.Before(startsAt.Add(-CheckInEarlyMin*time.Minute)) && !now.After(endsAt.Add(CheckInLateMin*time.Minute))
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
	GateAntiPassback        GateDenialReason = "anti_passback"
	GateNoBooking           GateDenialReason = "no_booking"
	GateInsufficientCredits GateDenialReason = "insufficient_credits"
)

var GateDenialLabel = map[GateDenialReason]string{
	GateTokenInvalid:        "QR tidak dikenal",
	GateTokenExpired:        "QR kedaluwarsa, minta member membuka ulang kartunya",
	GateTokenConsumed:       "QR sudah dipakai",
	GateMemberNotActive:     "Keanggotaan tidak aktif",
	GateAntiPassback:        "Baru saja masuk, tunggu sebelum scan lagi",
	GateNoBooking:           "Tidak ada booking kelas",
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
}

type GateScanInput struct {
	// TokenProblem is empty when the caller already validated the token.
	TokenProblem       QrTokenProblem
	MemberActive       bool
	LastAllowedEntryAt *time.Time
	Candidate          *GateCandidate
	Balance            int
	Rules              Rules
	Now                time.Time
}

// EvaluateGateScan runs the gate pipeline: QR, membership, re-entry and
// anti-passback, booking, credits. It returns the decision plus the effects
// to apply in one transaction, so the gate never opens without its deduction.
// There is no open gym: without a class booking around now, entry is denied.
func EvaluateGateScan(in GateScanInput) GateScanEvaluation {
	denied := func(reason GateDenialReason, effects ...GateEffect) GateScanEvaluation {
		return GateScanEvaluation{Decision: Denied, Reason: reason, Effects: effects}
	}

	// 1. Valid QR? An invalid token is not consumed (there is nothing to consume).
	if in.TokenProblem != "" {
		return denied(TokenDenial[in.TokenProblem])
	}
	consume := GateEffect{Kind: EffectConsumeToken}

	// 2. Active membership?
	if !in.MemberActive {
		return denied(GateMemberNotActive, consume)
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

	// 4. A class booking around now is required.
	if in.Candidate == nil {
		return denied(GateNoBooking, consume)
	}

	// 5. The balance covers the class.
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

// GateDetail feeds DescribeGateDecision. Zero Credits and nil BalanceAfter are omitted.
type GateDetail struct {
	ClassName    string
	Credits      int
	BalanceAfter *int
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
	if d.Credits != 0 {
		parts = append(parts, strconv.Itoa(d.Credits)+" kredit dipotong")
	}
	if d.BalanceAfter != nil {
		parts = append(parts, "sisa "+strconv.Itoa(*d.BalanceAfter)+" kredit")
	}
	return strings.Join(parts, " · ")
}
