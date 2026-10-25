package domain

import (
	"fmt"
	"math"
	"slices"
	"sort"
	"time"
)

// Revenue-share commission, the second incentive scheme type: per branch
// per month a pool of ClassPoolPercent of the recognised class revenue plus
// PtPoolPercent of the recognised PT revenue, split among the coaches who
// taught there. A coach's gross is
//
//	pool × share% × (sessions at the branch ÷ sessions at every branch)
//
// with share% the coach's override or the scheme's role share. Shares are
// fixed per person: what they leave of the pool stays with the company, and
// a total above 100% blocks approval. Discipline incidents cut a line by
// the scheme's percentage per incident type, capped by MaxDeductionPercent.
// Money is computed in sen so the split never drifts by rounding.

// Commission roles.
const (
	RoleHeadCoach = "head_coach"
	RoleCoach     = "coach"
	RoleAssistant = "assistant"
)

// CommissionRoles lists the roles in display order.
var CommissionRoles = []string{RoleHeadCoach, RoleCoach, RoleAssistant}

// Payout channels.
const (
	ChannelPayroll = "payroll"
	ChannelDirect  = "direct"
)

// PayoutChannels lists the channels a scheme may pay through.
var PayoutChannels = []string{ChannelPayroll, ChannelDirect}

// CommissionSettings are the numbers of a revenue-share scheme.
type CommissionSettings struct {
	ClassPoolPercent      float64 `json:"classPoolPercent"`
	PtPoolPercent         float64 `json:"ptPoolPercent"`
	ShareHeadCoachPercent float64 `json:"shareHeadCoachPercent"`
	ShareCoachPercent     float64 `json:"shareCoachPercent"`
	ShareAssistantPercent float64 `json:"shareAssistantPercent"`
	// DeductionPercents is the cut per incident, by incident type.
	DeductionPercents   map[string]float64 `json:"deductionPercents"`
	MaxDeductionPercent float64            `json:"maxDeductionPercent"`
	PayoutChannel       string             `json:"payoutChannel"`
}

// DefaultCommissionSettings are the owner's numbers from the fork: 10% of
// class revenue, 40% of PT revenue, head coach 20%, coach 16%.
var DefaultCommissionSettings = CommissionSettings{
	ClassPoolPercent: 10, PtPoolPercent: 40,
	ShareHeadCoachPercent: 20, ShareCoachPercent: 16, ShareAssistantPercent: 8,
	DeductionPercents:   map[string]float64{"no_show": 15, "short_notice_leave": 5, "late": 5},
	MaxDeductionPercent: 50, PayoutChannel: ChannelPayroll,
}

// RoleShare is the scheme's share for role; an unknown role earns the coach share.
func (s CommissionSettings) RoleShare(role string) float64 {
	switch role {
	case RoleHeadCoach:
		return s.ShareHeadCoachPercent
	case RoleAssistant:
		return s.ShareAssistantPercent
	}
	return s.ShareCoachPercent
}

// Incident is a discipline incident that cuts a coach's commission.
type Incident struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	OccurredOn string `json:"occurredOn"`
}

// AppliedIncident is an incident with the cut the scheme gives its type.
type AppliedIncident struct {
	Incident
	Percent float64 `json:"percent"`
}

// DeductionFor is the month's cut for a coach's incidents: the sum of their
// types' percentages, capped at MaxDeductionPercent and 100. Types the
// scheme does not list cut nothing.
func (s CommissionSettings) DeductionFor(incidents []Incident) (float64, []AppliedIncident) {
	applied := make([]AppliedIncident, 0, len(incidents))
	sum := 0.0
	for _, in := range incidents {
		p := s.DeductionPercents[in.Kind]
		applied = append(applied, AppliedIncident{Incident: in, Percent: p})
		sum += p
	}
	return round2(math.Min(math.Min(sum, s.MaxDeductionPercent), 100)), applied
}

// CommissionCoach is a coach as the split sees them.
type CommissionCoach struct {
	CoachID string
	Name    string
	Role    string
	// ShareOverride replaces the role share when set.
	ShareOverride *float64
	// Sessions taught at the branch that month.
	ClassSessions, PtSessions int
	Attendees                 int
	// AllSessions taught at every branch that month (at least the above).
	AllSessions int
	Incidents   []Incident
}

// CommissionLine is one coach's part of a branch pool.
type CommissionLine struct {
	CoachID            string            `json:"coachId"`
	CoachName          string            `json:"coachName"`
	Role               string            `json:"role"`
	SharePercent       float64           `json:"sharePercent"`
	ClassSessions      int               `json:"classSessions"`
	PtSessions         int               `json:"ptSessions"`
	Attendees          int               `json:"attendees"`
	AllSessions        int               `json:"allSessions"`
	AttributionPercent float64           `json:"attributionPercent"`
	GrossIDR           float64           `json:"grossIdr"`
	DeductionPercent   float64           `json:"deductionPercent"`
	DeductionIDR       float64           `json:"deductionIdr"`
	AmountIDR          float64           `json:"amountIdr"`
	Incidents          []AppliedIncident `json:"incidents"`
}

// CommissionPool is the computed split of one branch month.
type CommissionPool struct {
	ClassRevenueIDR float64 `json:"classRevenueIdr"`
	PtRevenueIDR    float64 `json:"ptRevenueIdr"`
	ClassPoolIDR    float64 `json:"classPoolIdr"`
	PtPoolIDR       float64 `json:"ptPoolIdr"`
	TotalPoolIDR    float64 `json:"totalPoolIdr"`
	// AllocatedPercent is Σ share × attribution of the coaches in the pool.
	AllocatedPercent float64 `json:"allocatedPercent"`
	AllocatedIDR     float64 `json:"allocatedIdr"`
	// RetainedIDR is the pool the lines do not pay out (unallocated shares
	// and deductions): it stays company revenue.
	RetainedIDR   float64          `json:"retainedIdr"`
	OverAllocated bool             `json:"overAllocated"`
	Lines         []CommissionLine `json:"lines"`
}

func sen(idr float64) int64              { return int64(math.Round(idr * 100)) }
func idrOf(s int64) float64              { return float64(s) / 100 }
func round2(v float64) float64           { return math.Round(v*100) / 100 }
func percentOf(s int64, p float64) int64 { return int64(math.Round(float64(s) * p / 100)) }

// ShareOf is the coach's share percent under the settings.
func (c CommissionCoach) ShareOf(s CommissionSettings) float64 {
	if c.ShareOverride != nil {
		return *c.ShareOverride
	}
	return s.RoleShare(c.Role)
}

// ComputeCommission splits a branch month. Coaches without a session at the
// branch are left out. Lines are head coaches first, then coaches, then
// assistants, each by name.
func ComputeCommission(classRevenueIDR, ptRevenueIDR float64, s CommissionSettings, coaches []CommissionCoach) CommissionPool {
	classPool := percentOf(sen(classRevenueIDR), s.ClassPoolPercent)
	ptPool := percentOf(sen(ptRevenueIDR), s.PtPoolPercent)
	total := classPool + ptPool
	out := CommissionPool{
		ClassRevenueIDR: round2(classRevenueIDR), PtRevenueIDR: round2(ptRevenueIDR),
		ClassPoolIDR: idrOf(classPool), PtPoolIDR: idrOf(ptPool), TotalPoolIDR: idrOf(total), Lines: []CommissionLine{},
	}
	var allocatedPercent float64
	var paid int64
	for _, c := range coaches {
		here := c.ClassSessions + c.PtSessions
		if here <= 0 {
			continue
		}
		all := max(c.AllSessions, here)
		share := c.ShareOf(s)
		attribution := float64(here) / float64(all)
		gross := int64(math.Round(float64(total) * share / 100 * attribution))
		cut, applied := s.DeductionFor(c.Incidents)
		deduction := percentOf(gross, cut)
		allocatedPercent += share * attribution
		paid += gross - deduction
		out.Lines = append(out.Lines, CommissionLine{
			CoachID: c.CoachID, CoachName: c.Name, Role: c.Role, SharePercent: share,
			ClassSessions: c.ClassSessions, PtSessions: c.PtSessions, Attendees: c.Attendees, AllSessions: all,
			AttributionPercent: round2(attribution * 100),
			GrossIDR:           idrOf(gross), DeductionPercent: cut, DeductionIDR: idrOf(deduction), AmountIDR: idrOf(gross - deduction),
			Incidents: applied,
		})
	}
	sort.SliceStable(out.Lines, func(i, j int) bool {
		ri, rj := slices.Index(CommissionRoles, out.Lines[i].Role), slices.Index(CommissionRoles, out.Lines[j].Role)
		if ri != rj {
			return ri < rj
		}
		return out.Lines[i].CoachName < out.Lines[j].CoachName
	})
	out.AllocatedPercent = round2(allocatedPercent)
	out.AllocatedIDR = idrOf(paid)
	out.RetainedIDR = idrOf(max(total-paid, 0))
	out.OverAllocated = out.AllocatedPercent > 100
	return out
}

/* ── Statement lifecycle ─────────────────────────────────────────────── */

// Commission statement statuses. A month without a stored statement shows
// as a preview.
const (
	CommissionPreview  = "preview"
	CommissionDraft    = "draft"
	CommissionApproved = "approved"
	CommissionPaid     = "paid"
)

// CheckApproval is the refusal of approving a statement, "" when it may be
// approved: the month must be over and the shares must fit the pool.
func CheckApproval(status string, monthOver bool, pool CommissionPool) string {
	switch {
	case status == CommissionApproved || status == CommissionPaid:
		return "Statement komisi bulan ini sudah disetujui."
	case !monthOver:
		return "Komisi baru bisa disetujui setelah bulannya berakhir."
	case pool.OverAllocated:
		return fmt.Sprintf("Total porsi coach %.2f%% melebihi 100%% pool. Sesuaikan porsi coach dulu.", pool.AllocatedPercent)
	}
	return ""
}

// Payment methods of a commission line.
const (
	PayByPayroll  = "payroll"
	PayByCash     = "cash"
	PayByTransfer = "transfer"
)

// DirectPaymentMethods are the methods of a scheme that pays outside payroll.
var DirectPaymentMethods = []string{PayByCash, PayByTransfer}

// CheckLinePayment is the refusal of paying a line, "" when it may be paid.
// A payroll statement pays through payroll; a direct one in cash or by
// transfer, the transfer with a reference.
func CheckLinePayment(statementStatus, lineStatus, channel, method string, reference *string) string {
	switch {
	case statementStatus == CommissionDraft || statementStatus == CommissionPreview:
		return "Setujui statement komisi dulu sebelum membayar."
	case lineStatus == "paid":
		return "Komisi coach ini sudah dibayar."
	case channel == ChannelPayroll && method != PayByPayroll:
		return "Skema ini membayar komisi lewat payroll."
	case channel == ChannelDirect && !slices.Contains(DirectPaymentMethods, method):
		return "Skema ini membayar komisi di luar payroll: pilih tunai atau transfer."
	case method == PayByTransfer && (reference == nil || *reference == ""):
		return "Referensi transfer wajib diisi."
	}
	return ""
}

// MonthEnd is the last day (YYYY-MM-DD) of a YYYY-MM month.
func MonthEnd(periodMonth string) (string, error) {
	p, err := MonthPeriodIn(periodMonth, time.UTC)
	if err != nil {
		return "", err
	}
	return p.End.AddDate(0, 0, -1).Format("2006-01-02"), nil
}
