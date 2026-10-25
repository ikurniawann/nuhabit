// Package domain holds the coach leave rules without the database: minimum
// notice per leave type, blackout dates, the substitute (cover) states, who
// decides a coach's leave, and the warning letter (SP) proposal.
package domain

import (
	"fmt"
	"time"
)

// DateLayout is a calendar day, YYYY-MM-DD.
const DateLayout = "2006-01-02"

// LeaveTypes are the hris.leaves types the notice rules cover.
var LeaveTypes = []string{"annual", "unpaid", "marriage", "maternity", "pilgrimage",
	"sick", "emergency", "menstrual", "paternity", "bereavement"}

// LeaveTypeLabel is the Indonesian name of each leave type.
var LeaveTypeLabel = map[string]string{
	"annual": "Cuti tahunan", "unpaid": "Cuti di luar tanggungan", "marriage": "Cuti menikah",
	"maternity": "Cuti melahirkan", "pilgrimage": "Cuti ibadah", "sick": "Sakit", "emergency": "Izin darurat",
	"menstrual": "Cuti haid", "paternity": "Cuti ayah", "bereavement": "Cuti duka",
}

// NoticeRule is the minimum notice of one leave type. MinDays: the start
// date is at least that many days after the submission day (0 = no rule).
// Below it the request is refused, unless AllowShortNotice accepts it and
// flags it as short notice. Blackout: the type cannot fall on a blackout
// date without the Program Director's override.
type NoticeRule struct {
	MinDays          int  `json:"min_days"`
	AllowShortNotice bool `json:"allow_short_notice"`
	Blackout         bool `json:"blackout"`
}

// MaxNoticeDays bounds MinDays.
const MaxNoticeDays = 90

// DefaultNoticeRules: planned leave needs a week or more and respects
// blackouts; leave nobody can plan (sick, emergency) is accepted any time
// but flagged when it starts the same day.
var DefaultNoticeRules = map[string]NoticeRule{
	"annual":      {MinDays: 7, Blackout: true},
	"unpaid":      {MinDays: 7, Blackout: true},
	"marriage":    {MinDays: 14, Blackout: true},
	"maternity":   {MinDays: 30},
	"pilgrimage":  {MinDays: 30},
	"sick":        {MinDays: 1, AllowShortNotice: true},
	"emergency":   {MinDays: 1, AllowShortNotice: true},
	"menstrual":   {MinDays: 1, AllowShortNotice: true},
	"paternity":   {MinDays: 1, AllowShortNotice: true},
	"bereavement": {MinDays: 1, AllowShortNotice: true},
}

// NormalizeNoticeRules fills every leave type from stored, falling back to
// the defaults, with MinDays clamped to 0..MaxNoticeDays.
func NormalizeNoticeRules(stored map[string]NoticeRule) map[string]NoticeRule {
	out := make(map[string]NoticeRule, len(LeaveTypes))
	for _, t := range LeaveTypes {
		r, ok := stored[t]
		if !ok {
			r = DefaultNoticeRules[t]
		}
		r.MinDays = min(max(r.MinDays, 0), MaxNoticeDays)
		out[t] = r
	}
	return out
}

// DaysBetween is to minus from in calendar days (both YYYY-MM-DD).
func DaysBetween(from, to string) int {
	a, errA := time.Parse(DateLayout, from)
	b, errB := time.Parse(DateLayout, to)
	if errA != nil || errB != nil {
		return 0
	}
	return int(b.Sub(a).Hours() / 24)
}

// ValidDate reports whether s is a YYYY-MM-DD calendar day.
func ValidDate(s string) bool {
	_, err := time.Parse(DateLayout, s)
	return err == nil
}

// AddDays shifts a YYYY-MM-DD date.
func AddDays(date string, n int) string {
	d, err := time.Parse(DateLayout, date)
	if err != nil {
		return date
	}
	return d.AddDate(0, 0, n).Format(DateLayout)
}

// NoticeVerdict is a request checked against its rule. NoticeDays is the
// start date minus the submission day (negative after the start).
type NoticeVerdict struct {
	OK            bool
	ShortNotice   bool
	NoticeDays    int
	EarliestStart string
}

// EvaluateNotice checks a request starting on start, submitted on today.
// recordedByHR accepts a late request (HR records leave after the fact) and
// flags it as short notice.
func EvaluateNotice(rule NoticeRule, start, today string, recordedByHR bool) NoticeVerdict {
	days := DaysBetween(today, start)
	v := NoticeVerdict{OK: true, NoticeDays: days}
	if days >= rule.MinDays {
		return v
	}
	if rule.AllowShortNotice || recordedByHR {
		v.ShortNotice = true
		return v
	}
	return NoticeVerdict{NoticeDays: days, EarliestStart: AddDays(today, rule.MinDays)}
}

// NoticeRefusal is the message for a request below the minimum notice.
func NoticeRefusal(leaveType string, rule NoticeRule, earliestStart string) string {
	return fmt.Sprintf("%s untuk coach minimal diajukan H-%d. Tanggal mulai paling cepat %s.",
		Label(leaveType), rule.MinDays, earliestStart)
}

// Label is the Indonesian name of a leave type, the code when unknown.
func Label(leaveType string) string {
	if l, ok := LeaveTypeLabel[leaveType]; ok {
		return l
	}
	return leaveType
}
