package domain

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"nuhabit/backend/internal/platform/jsmath"
)

// ForecastCategories are the manual override values of a deal.
var ForecastCategories = []string{"pipeline", "best_case", "commit"}

// StageFlags is the target stage of a categorisation or stage move.
type StageFlags struct {
	IsWon, IsLost bool
	Probability   float64
}

// CategoryFromStage is categoryFromStage.
func CategoryFromStage(s StageFlags) string {
	switch {
	case s.IsWon:
		return "closed_won"
	case s.IsLost:
		return "closed_lost"
	case s.Probability >= 75:
		return "commit"
	case s.Probability >= 50:
		return "best_case"
	}
	return "pipeline"
}

// MonthRange is monthRange: [from, to) as YYYY-MM-DD.
func MonthRange(month string) (from, to string) {
	parts := strings.Split(month, "-")
	y, _ := strconv.Atoi(parts[0])
	m, _ := strconv.Atoi(parts[1])
	from = fmt.Sprintf("%d-%02d-01", y, m)
	if m == 12 {
		return from, fmt.Sprintf("%d-01-01", y+1)
	}
	return from, fmt.Sprintf("%d-%02d-01", y, m+1)
}

// ForecastDeal is ForecastDealRow.
type ForecastDeal struct {
	OwnerUserID *string
	OwnerName   *string
	Value       float64
	Probability float64
	Category    string
}

// Target is TargetSource (UserID nil = the company target).
type Target struct {
	UserID      *string
	TargetValue float64
	TargetDeals *int64
}

// CompanyTarget is the summed company-wide target.
type CompanyTarget struct {
	TargetValue float64 `json:"target_value"`
	TargetDeals *int64  `json:"target_deals"`
}

// ForecastRow is one salesperson row (or the total row, which also carries
// AllocatedTargetValue and CompanyTargetSet).
type ForecastRow struct {
	UserID               *string  `json:"user_id"`
	UserName             string   `json:"user_name"`
	TargetValue          float64  `json:"target_value"`
	TargetDeals          *int64   `json:"target_deals"`
	WonValue             float64  `json:"won_value"`
	WonDeals             int      `json:"won_deals"`
	CommitValue          float64  `json:"commit_value"`
	BestCaseValue        float64  `json:"best_case_value"`
	PipelineValue        float64  `json:"pipeline_value"`
	WeightedValue        float64  `json:"weighted_value"`
	OpenDeals            int      `json:"open_deals"`
	AttainmentPercent    float64  `json:"attainment_percent"`
	Gap                  float64  `json:"gap"`
	AllocatedTargetValue *float64 `json:"allocated_target_value,omitempty"`
	CompanyTargetSet     *bool    `json:"company_target_set,omitempty"`
}

// SplitTargets is splitTargets.
func SplitTargets(targets []Target) (company *CompanyTarget, users []Target) {
	for _, t := range targets {
		if t.UserID == nil {
			if company == nil {
				company = &CompanyTarget{}
			}
			company.TargetValue += finiteOr0(t.TargetValue)
			if t.TargetDeals != nil {
				n := *t.TargetDeals
				if company.TargetDeals != nil {
					n += *company.TargetDeals
				}
				company.TargetDeals = &n
			}
			continue
		}
		users = append(users, t)
	}
	return company, users
}

func finiteOr0(v float64) float64 {
	if math.IsNaN(v) {
		return 0
	}
	return v
}

func addDeals(cur, add *int64) *int64 {
	if add == nil {
		return cur
	}
	n := *add
	if cur != nil {
		n += *cur
	}
	return &n
}

// ForecastUser is a candidate owner row.
type ForecastUser struct{ ID, Name string }

func attainment(projected, target float64) (percent, gap float64) {
	if target > 0 {
		percent = jsmath.Round(float64(projected/target)*1000) / 10
	}
	return percent, math.Max(0, target-projected)
}

// AggregateForecast is aggregateForecast: one row per owner (users first,
// then target owners, then deal owners), sorted by projected value with the
// unowned row last.
func AggregateForecast(deals []ForecastDeal, targets []Target, users []ForecastUser) []*ForecastRow {
	_, userTargets := SplitTargets(targets)
	var order []*ForecastRow
	byID := map[string]*ForecastRow{}
	var unowned *ForecastRow
	ensure := func(id *string, name string) *ForecastRow {
		if id == nil {
			if unowned == nil {
				unowned = &ForecastRow{UserName: name}
				order = append(order, unowned)
			}
			return unowned
		}
		if r, ok := byID[*id]; ok {
			return r
		}
		v := *id
		r := &ForecastRow{UserID: &v, UserName: name}
		byID[v] = r
		order = append(order, r)
		return r
	}
	for _, u := range users {
		id := u.ID
		ensure(&id, u.Name)
	}
	for _, t := range userTargets {
		name := "—"
		for _, u := range users {
			if u.ID == *t.UserID {
				name = u.Name
				break
			}
		}
		r := ensure(t.UserID, name)
		r.TargetValue += finiteOr0(t.TargetValue)
		r.TargetDeals = addDeals(r.TargetDeals, t.TargetDeals)
	}
	for _, d := range deals {
		name := "Tanpa PJ"
		if d.OwnerName != nil {
			name = *d.OwnerName
		}
		r := ensure(d.OwnerUserID, name)
		v := finiteOr0(d.Value)
		switch d.Category {
		case "closed_won":
			r.WonValue += v
			r.WonDeals++
		case "closed_lost":
		default:
			r.OpenDeals++
			r.WeightedValue += jsmath.Round(float64(v*finiteOr0(d.Probability)) / 100)
			switch d.Category {
			case "commit":
				r.CommitValue += v
			case "best_case":
				r.BestCaseValue += v
			default:
				r.PipelineValue += v
			}
		}
	}
	for _, r := range order {
		r.AttainmentPercent, r.Gap = attainment(r.WonValue+r.WeightedValue, r.TargetValue)
	}
	sort.SliceStable(order, func(i, j int) bool {
		a, b := order[i], order[j]
		if a.UserID == nil {
			return false
		}
		if b.UserID == nil {
			return true
		}
		return b.WonValue+b.WeightedValue < a.WonValue+a.WeightedValue
	})
	return order
}

// SumForecast is sumForecast: the total row; a company target replaces the
// summed salesperson targets, which stay in AllocatedTargetValue.
func SumForecast(rows []*ForecastRow, company *CompanyTarget) *ForecastRow {
	total := "total"
	t := &ForecastRow{UserID: &total, UserName: "Total"}
	for _, r := range rows {
		t.TargetValue += r.TargetValue
		t.TargetDeals = addDeals(t.TargetDeals, r.TargetDeals)
		t.WonValue += r.WonValue
		t.WonDeals += r.WonDeals
		t.CommitValue += r.CommitValue
		t.BestCaseValue += r.BestCaseValue
		t.PipelineValue += r.PipelineValue
		t.WeightedValue += r.WeightedValue
		t.OpenDeals += r.OpenDeals
	}
	allocated := t.TargetValue
	set := company != nil && company.TargetValue > 0
	t.AllocatedTargetValue, t.CompanyTargetSet = &allocated, &set
	if set {
		t.TargetValue = finiteOr0(company.TargetValue)
		t.TargetDeals = company.TargetDeals
	}
	t.AttainmentPercent, t.Gap = attainment(t.WonValue+t.WeightedValue, t.TargetValue)
	return t
}
