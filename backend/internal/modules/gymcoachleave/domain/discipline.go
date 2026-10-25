package domain

// Incident kinds a coach may be recorded for.
const (
	IncidentNoShow      = "no_show"
	IncidentShortNotice = "short_notice_leave"
	IncidentLate        = "late"
)

// IncidentKinds in display order.
var IncidentKinds = []string{IncidentNoShow, IncidentShortNotice, IncidentLate}

// IncidentLabel is the Indonesian label of each kind.
var IncidentLabel = map[string]string{
	IncidentNoShow:      "Tidak hadir tanpa kabar",
	IncidentShortNotice: "Cuti mendadak",
	IncidentLate:        "Terlambat",
}

// DefaultDeductionPercent is the commission deduction per incident.
var DefaultDeductionPercent = map[string]float64{IncidentNoShow: 15, IncidentShortNotice: 5, IncidentLate: 5}

// NormalizeDeductions fills every kind, clamped to 0..100.
func NormalizeDeductions(stored map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(IncidentKinds))
	for _, k := range IncidentKinds {
		v, ok := stored[k]
		if !ok {
			v = DefaultDeductionPercent[k]
		}
		out[k] = min(max(v, 0), 100)
	}
	return out
}

// IncidentRef is an active incident inside the warning window.
type IncidentRef struct {
	ID         string
	OccurredOn string
}

// WarningProposal is the SP to propose.
type WarningProposal struct {
	Level       int
	IncidentIDs []string
	From, To    string
}

// MaxWarningLevel is SP3.
const MaxWarningLevel = 3

// ProposeWarning: when the active incidents of the window that no earlier
// SP counted reach threshold, propose the next level (at most SP3). Nothing
// while a proposal is still open.
func ProposeWarning(incidents []IncidentRef, counted map[string]bool, lastLevel int, openProposal bool, threshold int) *WarningProposal {
	if openProposal || threshold <= 0 {
		return nil
	}
	var fresh []IncidentRef
	for _, i := range incidents {
		if !counted[i.ID] {
			fresh = append(fresh, i)
		}
	}
	if len(fresh) < threshold {
		return nil
	}
	p := &WarningProposal{Level: min(lastLevel+1, MaxWarningLevel), From: fresh[0].OccurredOn, To: fresh[0].OccurredOn}
	for _, i := range fresh {
		p.IncidentIDs = append(p.IncidentIDs, i.ID)
		if i.OccurredOn < p.From {
			p.From = i.OccurredOn
		}
		if i.OccurredOn > p.To {
			p.To = i.OccurredOn
		}
	}
	return p
}
