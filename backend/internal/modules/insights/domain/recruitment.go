package domain

import (
	"cmp"
	"slices"
	"strconv"
	"time"

	"nuhabit/backend/internal/platform/jsmath"
)

// Recruitment dashboard and analytics aggregates (lib/dashboard/recruitment.ts).
// Routes fetch rows, these functions shape them.

const dayMS = 24 * 60 * 60 * 1000

// ClosedStatuses are the candidate statuses outside the active pipeline.
var ClosedStatuses = []string{"hired", "rejected", "archived"}

// sourceKeys keeps SOURCE_LABELS in declaration order.
var sourceKeys = []string{"portal", "referral", "jobstreet", "instagram", "jobfair", "internal", "other"}

// SourceLabels is SOURCE_LABELS.
var SourceLabels = map[string]string{
	"portal":    "Website Portal",
	"referral":  "Referral",
	"jobstreet": "JobStreet",
	"instagram": "Instagram",
	"jobfair":   "Job Fair",
	"internal":  "Internal",
	"other":     "Lainnya",
}

var periodDays = map[string]int{"week": 7, "month": 30, "3month": 90, "6month": 180}
var periodMonths = map[string]int{"month": 1, "3month": 3, "6month": 6}

// IsActiveCandidate reports a status outside ClosedStatuses (NULL is active).
func IsActiveCandidate(status *string) bool {
	return status == nil || !slices.Contains(ClosedStatuses, *status)
}

// PeriodStartByDays is now minus a fixed number of days per period.
func PeriodStartByDays(period string, now time.Time, fallbackDays int) time.Time {
	days, ok := periodDays[period]
	if !ok {
		days = fallbackDays
	}
	return now.Add(-time.Duration(days) * dayMS * time.Millisecond)
}

// PeriodStartByCalendar steps back calendar months in WIB (week = 7 days);
// unknown periods mean 3 months. Month overflow normalizes like setMonth.
func PeriodStartByCalendar(period string, now time.Time) time.Time {
	local := now.In(WIB)
	if period == "week" {
		return local.AddDate(0, 0, -7)
	}
	months, ok := periodMonths[period]
	if !ok {
		months = 3
	}
	return local.AddDate(0, -months, 0)
}

// SourceSlice is one pie slice.
type SourceSlice struct {
	Name  string `json:"name"`
	Value int    `json:"value"`
}

// SourceDistribution counts candidates per labelled source, largest first
// (ties keep first-seen order).
func SourceDistribution(sources []*string) []SourceSlice {
	var order []string
	counts := map[string]int{}
	for _, s := range sources {
		if s == nil || *s == "" {
			continue
		}
		if _, seen := counts[*s]; !seen {
			order = append(order, *s)
		}
		counts[*s]++
	}
	out := make([]SourceSlice, 0, len(order))
	for _, s := range order {
		name := SourceLabels[s]
		if name == "" {
			name = s
		}
		out = append(out, SourceSlice{Name: name, Value: counts[s]})
	}
	slices.SortStableFunc(out, func(a, b SourceSlice) int { return cmp.Compare(b.Value, a.Value) })
	return out
}

// SourceStatus is a candidate's source and status.
type SourceStatus struct {
	Source *string
	Status *string
}

// SourceRate is total, hired and hire rate for one known source.
type SourceRate struct {
	Source string  `json:"source"`
	Total  int     `json:"total"`
	Hired  int     `json:"hired"`
	Rate   float64 `json:"rate"`
}

// SourceConversion rates each known source (rate in %, one decimal).
func SourceConversion(rows []SourceStatus) []SourceRate {
	out := []SourceRate{}
	for _, source := range sourceKeys {
		total, hired := 0, 0
		for _, r := range rows {
			if r.Source != nil && *r.Source == source {
				total++
				if r.Status != nil && *r.Status == "hired" {
					hired++
				}
			}
		}
		if total == 0 {
			continue
		}
		rate := jsmath.Round(float64(float64(hired)/float64(total)*1000)) / 10
		out = append(out, SourceRate{Source: SourceLabels[source], Total: total, Hired: hired, Rate: rate})
	}
	slices.SortStableFunc(out, func(a, b SourceRate) int { return cmp.Compare(b.Total, a.Total) })
	return out
}

// Brand is an active brand.
type Brand struct{ ID, Name string }

// BrandStatus is a candidate's brand and status.
type BrandStatus struct {
	BrandID *string
	Status  *string
}

// BrandBar is one bar of the brand comparison.
type BrandBar struct {
	Brand      string `json:"brand"`
	Applicants int    `json:"applicants"`
	Active     int    `json:"active"`
	Hired      int    `json:"hired"`
	InPool     int    `json:"in_pool"`
}

// BrandComparisonResult is { barData, pieData }.
type BrandComparisonResult struct {
	BarData []BrandBar    `json:"barData"`
	PieData []SourceSlice `json:"pieData"`
}

// BrandComparison counts applicants, active, hired and pool per brand;
// brands without applicants are hidden, the pie is hired per brand.
func BrandComparison(brands []Brand, rows []BrandStatus, brandFilter *string) BrandComparisonResult {
	res := BrandComparisonResult{BarData: []BrandBar{}, PieData: []SourceSlice{}}
	for _, b := range brands {
		if brandFilter != nil && *brandFilter != "" && b.ID != *brandFilter {
			continue
		}
		bar := BrandBar{Brand: b.Name}
		for _, r := range rows {
			if r.BrandID == nil || *r.BrandID != b.ID {
				continue
			}
			bar.Applicants++
			if IsActiveCandidate(r.Status) {
				bar.Active++
			}
			if r.Status != nil && *r.Status == "hired" {
				bar.Hired++
			}
			if r.Status != nil && *r.Status == "talent_pool" {
				bar.InPool++
			}
		}
		if bar.Applicants > 0 {
			res.BarData = append(res.BarData, bar)
			res.PieData = append(res.PieData, SourceSlice{Name: bar.Brand, Value: bar.Hired})
		}
	}
	return res
}

var funnelStages = [][2]string{
	{"applied", "Applied"},
	{"screening", "Screening"},
	{"psikotes", "Psikotes"},
	{"interview", "Interview"},
	{"offer", "Offer"},
	{"hired", "Hired"},
	{"talent_pool", "Talent Pool"},
}

var overviewStages = append(slices.Clone(funnelStages), [2]string{"rejected", "Tolak"}, [2]string{"archived", "Archived"})

func countStatuses(statuses []*string) map[string]int {
	counts := map[string]int{}
	for _, s := range statuses {
		if s != nil && *s != "" {
			counts[*s]++
		}
	}
	return counts
}

// FunnelStage is one pipeline stage count.
type FunnelStage struct {
	Stage string `json:"stage"`
	Count int    `json:"count"`
}

// FunnelStages counts candidates per funnel stage.
func FunnelStages(statuses []*string) []FunnelStage {
	counts := countStatuses(statuses)
	out := make([]FunnelStage, len(funnelStages))
	for i, s := range funnelStages {
		out[i] = FunnelStage{Stage: s[1], Count: counts[s[0]]}
	}
	return out
}

// OverviewCandidate is one candidate row of the analytics overview.
type OverviewCandidate struct {
	ID         string
	Status     string
	CreatedAt  time.Time
	UpdatedAt  time.Time
	PositionID *string
}

// StageRate is a conversion rate in whole percent.
type StageRate struct {
	Stage string  `json:"stage"`
	Rate  float64 `json:"rate"`
}

// OverviewKpis is the analytics KPI block.
type OverviewKpis struct {
	TimeToHireAvg   *float64    `json:"time_to_hire_avg"`
	HiringRate      float64     `json:"hiring_rate"`
	TotalApplicants int         `json:"total_applicants"`
	TotalHired      int         `json:"total_hired"`
	TotalRejected   int         `json:"total_rejected"`
	TotalActive     int         `json:"total_active"`
	ConversionRates []StageRate `json:"conversion_rates"`
}

// PositionCount is an active-candidate count per position, in first-seen
// order (a JS Map).
type PositionCount struct {
	PositionID string
	Count      int
}

// ComputeOverviewKpis returns the KPIs and the active candidates per position.
func ComputeOverviewKpis(candidates []OverviewCandidate) (OverviewKpis, []PositionCount) {
	total := len(candidates)
	statuses := make([]*string, len(candidates))
	hired, totalDays, active := 0, 0.0, 0
	var perPosition []PositionCount
	index := map[string]int{}
	for i := range candidates {
		c := &candidates[i]
		statuses[i] = &c.Status
		if c.Status == "hired" {
			hired++
			totalDays += float64(floorDiv(c.UpdatedAt.UnixMilli()-c.CreatedAt.UnixMilli(), dayMS))
		}
		if !IsActiveCandidate(&c.Status) {
			continue
		}
		active++
		if c.PositionID != nil && *c.PositionID != "" {
			if at, ok := index[*c.PositionID]; ok {
				perPosition[at].Count++
			} else {
				index[*c.PositionID] = len(perPosition)
				perPosition = append(perPosition, PositionCount{PositionID: *c.PositionID, Count: 1})
			}
		}
	}
	counts := countStatuses(statuses)
	k := OverviewKpis{TotalApplicants: total, TotalHired: hired, TotalRejected: counts["rejected"], TotalActive: active}
	if total > 0 {
		k.HiringRate = jsmath.RoundTo(float64(hired)/float64(total)*100, 2)
	}
	if hired > 0 {
		avg := jsmath.Round(totalDays / float64(hired))
		k.TimeToHireAvg = &avg
	}
	k.ConversionRates = make([]StageRate, len(overviewStages))
	for i, s := range overviewStages {
		rate := 0.0
		if total > 0 {
			rate = jsmath.Round(float64(counts[s[0]]) / float64(total) * 100)
		}
		k.ConversionRates[i] = StageRate{Stage: s[1], Rate: rate}
	}
	return k, perPosition
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if a%b != 0 && (a < 0) != (b < 0) {
		q--
	}
	return q
}

// HardToFillPosition is a position with many active candidates.
type HardToFillPosition struct {
	PositionID    string `json:"position_id"`
	PositionTitle string `json:"position_title"`
	Count         int    `json:"count"`
}

// HardToFill lists the 10 positions with the most active candidates;
// titles is position id -> title.
func HardToFill(perPosition []PositionCount, titles map[string]string) []HardToFillPosition {
	out := make([]HardToFillPosition, len(perPosition))
	for i, p := range perPosition {
		title := titles[p.PositionID]
		if title == "" {
			title = "Unknown"
		}
		out[i] = HardToFillPosition{PositionID: p.PositionID, PositionTitle: title, Count: p.Count}
	}
	slices.SortStableFunc(out, func(a, b HardToFillPosition) int { return cmp.Compare(b.Count, a.Count) })
	if len(out) > 10 {
		out = out[:10]
	}
	return out
}

var monthShort = []string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}

// Week is one Monday..Sunday window in WIB.
type Week struct {
	Label      string
	Start, End time.Time
}

// LastEightWeeks returns the 8 weeks ending last Sunday (or today when it is
// Sunday), oldest first.
func LastEightWeeks(today time.Time) []Week {
	t := today.In(WIB)
	weeks := make([]Week, 0, 8)
	for i := 7; i >= 0; i-- {
		d := t.AddDate(0, 0, -int(t.Weekday())-i*7)
		end := time.Date(d.Year(), d.Month(), d.Day(), 23, 59, 59, 999e6, WIB)
		s := end.AddDate(0, 0, -6)
		start := time.Date(s.Year(), s.Month(), s.Day(), 0, 0, 0, 0, WIB)
		weeks = append(weeks, Week{Label: monthShort[start.Month()-1] + " " + strconv.Itoa(start.Day()), Start: start, End: end})
	}
	return weeks
}

// WeeklyCount is applications in one week.
type WeeklyCount struct {
	Week  string `json:"week"`
	Date  string `json:"date"`
	Label string `json:"label"`
	Count int    `json:"count"`
}

// WeeklyApplications counts created_at values per week; date is the UTC
// calendar date of the week start (toISOString().split("T")[0]).
func WeeklyApplications(weeks []Week, createdAt []time.Time) []WeeklyCount {
	out := make([]WeeklyCount, len(weeks))
	for i, w := range weeks {
		n := 0
		for _, c := range createdAt {
			if !c.Before(w.Start) && !c.After(w.End) {
				n++
			}
		}
		out[i] = WeeklyCount{Week: "Week " + strconv.Itoa(i+1), Date: ISO(w.Start)[:10], Label: w.Label, Count: n}
	}
	return out
}

// StaleCandidate is a candidate that has not moved.
type StaleCandidate struct {
	ID            string
	FullName      string
	Status        string
	UpdatedAt     time.Time
	PositionTitle *string
	BrandName     *string
}

// AttentionItem is one row of the attention list.
type AttentionItem struct {
	ID                  string  `json:"id"`
	FullName            string  `json:"full_name"`
	Status              string  `json:"status"`
	PositionTitle       *string `json:"position_title"`
	BrandName           *string `json:"brand_name"`
	DaysInCurrentStatus int64   `json:"days_in_current_status"`
	Urgency             string  `json:"urgency"`
}

// Attention marks a stale candidate red after 14 days, amber before.
func Attention(c StaleCandidate, now time.Time) AttentionItem {
	days := floorDiv(now.UnixMilli()-c.UpdatedAt.UnixMilli(), dayMS)
	urgency := "amber"
	if days > 14 {
		urgency = "red"
	}
	return AttentionItem{
		ID: c.ID, FullName: c.FullName, Status: c.Status,
		PositionTitle: c.PositionTitle, BrandName: c.BrandName,
		DaysInCurrentStatus: days, Urgency: urgency,
	}
}
