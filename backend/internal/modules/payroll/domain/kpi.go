package domain

import (
	"math"
	"slices"
	"strconv"
	"strings"
)

// KPIManageRoles run KPI snapshots, see every scorecard and edit the
// department configuration (KPI_MANAGE_ROLES).
var KPIManageRoles = []string{"super_admin", "admin", "hrd"}

// IsKPIManager reports whether role is one of KPIManageRoles.
func IsKPIManager(role string) bool { return slices.Contains(KPIManageRoles, role) }

// AttainmentCap caps over-achievement at 120%.
const AttainmentCap = 1.2

// Attainment is computeAttainment: nil excludes the indicator from the score.
func Attainment(direction string, actual, target *float64) *float64 {
	if actual == nil || !Finite(*actual) {
		return nil
	}
	v := func(x float64) *float64 { return &x }
	clamp := func(x float64) *float64 { return v(math.Min(AttainmentCap, math.Max(0, x))) }
	if direction == "boolean" {
		if *actual >= 1 {
			return v(1)
		}
		return v(0)
	}
	if target == nil || !Finite(*target) {
		return nil
	}
	if direction == "higher_better" {
		if *target <= 0 {
			return nil
		}
		return clamp(*actual / *target)
	}
	switch {
	case *target < 0:
		return nil
	case *target == 0:
		if *actual <= 0 {
			return v(1)
		}
		return v(0)
	case *actual <= 0:
		return v(AttainmentCap)
	}
	return clamp(*target / *actual)
}

// ScoreComponent is one weighted indicator of a scorecard.
type ScoreComponent struct {
	Code       string
	Weight     float64
	Attainment *float64
}

// BreakdownRow is ScorecardBreakdownRow (stored in kpi_scorecards.breakdown).
type BreakdownRow struct {
	Code            string   `json:"code"`
	Weight          float64  `json:"weight"`
	EffectiveWeight float64  `json:"effectiveWeight"`
	Attainment      *float64 `json:"attainment"`
	Contribution    float64  `json:"contribution"`
}

// Score is composeScore's result.
type Score struct {
	Score      *float64
	RawScore   *float64
	UsedWeight float64
	Excluded   []string
	Breakdown  []BreakdownRow
}

// ComposeScore is composeScore: Σ weight × attainment on a 0–100 scale,
// weights of excluded components redistributed proportionally.
func ComposeScore(components []ScoreComponent) Score {
	included := func(c ScoreComponent) bool { return c.Attainment != nil && Finite(*c.Attainment) && c.Weight > 0 }
	s := Score{Excluded: []string{}, Breakdown: []BreakdownRow{}}
	for _, c := range components {
		if included(c) {
			s.UsedWeight += c.Weight
		} else {
			s.Excluded = append(s.Excluded, c.Code)
		}
	}
	if s.UsedWeight <= 0 {
		s.UsedWeight = 0
		for _, c := range components {
			s.Breakdown = append(s.Breakdown, BreakdownRow{Code: c.Code, Weight: c.Weight, Attainment: c.Attainment})
		}
		return s
	}
	scale := 100 / s.UsedWeight
	raw := 0.0
	for _, c := range components {
		eff, contrib := 0.0, 0.0
		if included(c) {
			eff = c.Weight * scale
			contrib = eff * *c.Attainment
		}
		raw += contrib
		s.Breakdown = append(s.Breakdown, BreakdownRow{Code: c.Code, Weight: c.Weight,
			EffectiveWeight: round2(eff), Attainment: c.Attainment, Contribution: round2(contrib)})
	}
	score, rawScore := round2(math.Min(100, raw)), round2(raw)
	s.Score, s.RawScore, s.UsedWeight = &score, &rawScore, round2(s.UsedWeight)
	return s
}

// FormatNumberID is formatNumber (toLocaleString "id-ID" with at most
// digits fraction digits): "1.234,5".
func FormatNumberID(v float64, digits int) string {
	p := math.Pow(10, float64(digits))
	r := math.Round(math.Abs(v)*p) / p
	s := strconv.FormatFloat(r, 'f', -1, 64)
	intPart, frac, _ := strings.Cut(s, ".")
	n, _ := strconv.ParseInt(intPart, 10, 64)
	out := groupThousands(n)
	if frac != "" {
		out += "," + frac
	}
	if v < 0 && r != 0 {
		out = "-" + out
	}
	return out
}
