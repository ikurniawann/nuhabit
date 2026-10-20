package domain

import (
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"
)

/* ── HYROX result splits ─────────────────────────────────────────────── */

// SplitCount is the number of runs and of stations in a HYROX race.
const SplitCount = 8

// HyroxStations names the 8 stations in race order (notification copy).
var HyroxStations = [SplitCount]string{
	"SkiErg", "Sled Push", "Sled Pull", "Burpee Broad Jumps", "Rowing", "Farmers Carry", "Sandbag Lunges", "Wall Balls",
}

// Closed sets gym.hyrox_results accepts.
var (
	ResultSources   = []string{"race", "simulation"}
	ResultDivisions = []string{
		"MEN_OPEN", "MEN_PRO", "WOMEN_OPEN", "WOMEN_PRO",
		"MEN_DOUBLES", "WOMEN_DOUBLES", "MIXED_DOUBLES",
		"MEN_RELAY", "WOMEN_RELAY", "MIXED_RELAY",
	}
	AgeGroups = []string{"16-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60-64", "65-69", "70+"}
)

// TotalToleranceSec is how far the official total may sit from the sum of
// the splits before the result is flagged: each split is rounded to the
// second, so a few seconds of drift is normal.
const TotalToleranceSec = 5

// Splits are a result's 8 runs, 8 stations and Roxzone (transition) time in
// seconds. A nil element was not entered.
type Splits struct {
	Runs     [SplitCount]*int
	Stations [SplitCount]*int
	Roxzone  *int
}

// Complete reports whether all 16 runs and stations are entered.
func (s Splits) Complete() bool {
	for i := range SplitCount {
		if s.Runs[i] == nil || s.Stations[i] == nil {
			return false
		}
	}
	return true
}

// Totals are what a result stores next to its splits.
type Totals struct {
	// SplitsTotalSec is the sum of the splits (Roxzone included when
	// entered); nil unless all 16 runs and stations are entered.
	SplitsTotalSec *int
	// TotalSec is what leaderboards rank: the official total when entered,
	// otherwise the splits total.
	TotalSec int
	// Mismatch: both totals exist and differ by more than TotalToleranceSec.
	Mismatch bool
}

// ComputeTotals derives the stored totals. The string is the member-facing
// refusal when there is no total at all.
func ComputeTotals(s Splits, officialSec *int) (Totals, string) {
	var t Totals
	if s.Complete() {
		sum := 0
		for i := range SplitCount {
			sum += *s.Runs[i] + *s.Stations[i]
		}
		if s.Roxzone != nil {
			sum += *s.Roxzone
		}
		t.SplitsTotalSec = &sum
	}
	switch {
	case officialSec != nil:
		t.TotalSec = *officialSec
	case t.SplitsTotalSec != nil:
		t.TotalSec = *t.SplitsTotalSec
	default:
		return Totals{}, "Isi total resmi atau lengkapi 8 lari dan 8 stasiun."
	}
	if officialSec != nil && t.SplitsTotalSec != nil {
		t.Mismatch = abs(*officialSec-*t.SplitsTotalSec) > TotalToleranceSec
	}
	return t, ""
}

func abs(n int) int { return max(n, -n) }

/* ── Split keys, personal bests and PRs ──────────────────────────────── */

// Split keys: "run1".."run8", "station1".."station8" and "total".
const TotalKey = "total"

func RunKey(i int) string     { return fmt.Sprintf("run%d", i+1) }
func StationKey(i int) string { return fmt.Sprintf("station%d", i+1) }

// SplitValues maps each entered run and station, plus the total, by key.
func SplitValues(s Splits, totalSec int) map[string]int {
	out := map[string]int{TotalKey: totalSec}
	for i := range SplitCount {
		if s.Runs[i] != nil {
			out[RunKey(i)] = *s.Runs[i]
		}
		if s.Stations[i] != nil {
			out[StationKey(i)] = *s.Stations[i]
		}
	}
	return out
}

// SplitLabel names a split key for member-facing copy ("Lari 3", "SkiErg").
func SplitLabel(key string) string {
	var n int
	switch {
	case key == TotalKey:
		return "Total"
	case scanKey(key, "run%d", &n):
		return fmt.Sprintf("Lari %d", n)
	case scanKey(key, "station%d", &n) && n >= 1 && n <= SplitCount:
		return HyroxStations[n-1]
	}
	return key
}

func scanKey(key, format string, n *int) bool {
	_, err := fmt.Sscanf(key, format, n)
	return err == nil
}

// ResultRecord is one of a member's results as PR checks see it.
type ResultRecord struct {
	ID        string
	RacedAt   time.Time
	CreatedAt time.Time
	Values    map[string]int
}

// Before reports whether r came first: an earlier race day, or the same day
// and logged earlier.
func (r ResultRecord) Before(other ResultRecord) bool {
	if !r.RacedAt.Equal(other.RacedAt) {
		return r.RacedAt.Before(other.RacedAt)
	}
	return r.CreatedAt.Before(other.CreatedAt)
}

// PreviousBests is the best value per split key over the member's results
// that came before current (current itself excluded).
func PreviousBests(current ResultRecord, all []ResultRecord) map[string]int {
	best := map[string]int{}
	for _, r := range all {
		if r.ID == current.ID || !r.Before(current) {
			continue
		}
		for key, v := range r.Values {
			if b, ok := best[key]; !ok || v < b {
				best[key] = v
			}
		}
	}
	return best
}

// NewPRs lists the keys where current beats the previous best, in split
// order (runs and stations interleaved as raced, total last). A split with
// nothing earlier to beat is not a PR, so a first result has none.
func NewPRs(current map[string]int, previous map[string]int) []string {
	out := []string{}
	for _, key := range orderedKeys() {
		v, ok := current[key]
		if b, had := previous[key]; ok && had && v < b {
			out = append(out, key)
		}
	}
	return out
}

func orderedKeys() []string {
	keys := make([]string, 0, 2*SplitCount+1)
	for i := range SplitCount {
		keys = append(keys, RunKey(i), StationKey(i))
	}
	return append(keys, TotalKey)
}

// UnnotifiedPRs drops PR keys a notification already went out for.
func UnnotifiedPRs(prs, notified []string) []string {
	out := []string{}
	for _, key := range prs {
		if !slices.Contains(notified, key) {
			out = append(out, key)
		}
	}
	return out
}

// PRNotificationBody lists the new PRs, e.g. "SkiErg 4:05, Lari 3 4:40".
func PRNotificationBody(prs []string, values map[string]int, where string) string {
	parts := make([]string, len(prs))
	for i, key := range prs {
		parts[i] = SplitLabel(key) + " " + FormatDuration(float64(values[key]))
	}
	return strings.Join(parts, ", ") + " di " + where + "."
}

// SplitAverages is the rounded mean per split key over a set of results.
func SplitAverages(results []map[string]int) map[string]int {
	sums, counts := map[string]int{}, map[string]int{}
	for _, r := range results {
		for key, v := range r {
			sums[key] += v
			counts[key]++
		}
	}
	out := make(map[string]int, len(sums))
	for key, sum := range sums {
		out[key] = jsRound(float64(sum) / float64(counts[key]))
	}
	return out
}

/* ── Simulation splits ───────────────────────────────────────────────── */

// SimulationSplits reads a full simulation's block results as HYROX splits.
// Runs count in block order; a station lands on its race position, looked up
// by stationOrder. A substituted block is not the race movement, so its split
// stays empty. Roxzone does not exist in a simulation.
func SimulationSplits(blocks []WorkoutBlock, results []BlockResult, stationOrder func(exerciseID string) *int) Splits {
	durations := make(map[int]int, len(results))
	for _, r := range results {
		durations[r.Order] = jsRound(r.DurationSec)
	}
	sorted := slices.Clone(blocks)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Order < sorted[j].Order })
	var s Splits
	run := 0
	for _, b := range sorted {
		d, recorded := durations[b.Order]
		switch b.Kind {
		case "RUN":
			if run < SplitCount && recorded && b.OriginalExerciseID == nil && d > 0 {
				s.Runs[run] = ptr(d)
			}
			run++
		case "STATION":
			if b.OriginalExerciseID != nil || !recorded || d <= 0 {
				continue
			}
			if order := stationOrder(b.ExerciseID); order != nil && *order >= 1 && *order <= SplitCount {
				s.Stations[*order-1] = ptr(d)
			}
		}
	}
	return s
}

/* ── Leaderboards ────────────────────────────────────────────────────── */

// BoardCandidate is one stored result as a leaderboard filters and ranks it.
type BoardCandidate struct {
	ResultID    string
	CustomerID  string
	Source      string
	RaceEventID *string
	Division    string
	AgeGroup    *string
	TotalSec    int
	StationSec  [SplitCount]*int
	RacedAt     time.Time
	Verified    bool
	// Visible is false when the member turned leaderboards off.
	Visible bool
}

// BoardFilter narrows a leaderboard; nil fields do not filter.
type BoardFilter struct {
	RaceEventID       *string
	Source            *string
	Division          *string
	AgeGroup          *string
	Year              *int
	IncludeUnverified bool
}

// wib is Asia/Jakarta (no daylight saving): a race's year is the gym's year.
var wib = time.FixedZone("WIB", 7*3600)

// Match reports whether a candidate belongs on the board.
func (f BoardFilter) Match(c BoardCandidate) bool {
	switch {
	case !c.Verified && !f.IncludeUnverified:
		return false
	case f.RaceEventID != nil && (c.RaceEventID == nil || *c.RaceEventID != *f.RaceEventID):
		return false
	case f.Source != nil && c.Source != *f.Source:
		return false
	case f.Division != nil && c.Division != *f.Division:
		return false
	case f.AgeGroup != nil && (c.AgeGroup == nil || *c.AgeGroup != *f.AgeGroup):
		return false
	case f.Year != nil && c.RacedAt.In(wib).Year() != *f.Year:
		return false
	}
	return true
}

// BoardRow is a ranked best result. Rank is shared on a tie (1, 2, 2, 4).
type BoardRow struct {
	BoardCandidate
	Rank     int
	ValueSec int
}

// Leaderboard ranks each visible member's best value: the total, or one
// station (1..8) when station is set. Members who turned leaderboards off
// are left out. Ties share a rank; among them the earlier result lists
// first.
func Leaderboard(candidates []BoardCandidate, f BoardFilter, station int) []BoardRow {
	best := map[string]BoardRow{}
	for _, c := range candidates {
		if !c.Visible || !f.Match(c) {
			continue
		}
		value := c.TotalSec
		if station > 0 {
			if station > SplitCount || c.StationSec[station-1] == nil {
				continue
			}
			value = *c.StationSec[station-1]
		}
		row := BoardRow{BoardCandidate: c, ValueSec: value}
		if cur, ok := best[c.CustomerID]; !ok || ranksBefore(row, cur) {
			best[c.CustomerID] = row
		}
	}
	rows := make([]BoardRow, 0, len(best))
	for _, r := range best {
		rows = append(rows, r)
	}
	sort.Slice(rows, func(i, j int) bool { return ranksBefore(rows[i], rows[j]) })
	for i := range rows {
		rows[i].Rank = i + 1
		if i > 0 && rows[i].ValueSec == rows[i-1].ValueSec {
			rows[i].Rank = rows[i-1].Rank
		}
	}
	return rows
}

// ranksBefore orders by time, then the earlier result, then ids so the order
// is stable between requests.
func ranksBefore(a, b BoardRow) bool {
	switch {
	case a.ValueSec != b.ValueSec:
		return a.ValueSec < b.ValueSec
	case !a.RacedAt.Equal(b.RacedAt):
		return a.RacedAt.Before(b.RacedAt)
	case a.CustomerID != b.CustomerID:
		return a.CustomerID < b.CustomerID
	}
	return a.ResultID < b.ResultID
}
