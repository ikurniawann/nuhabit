package domain

import (
	"testing"
	"time"
)

// fullSplits: runs of 300 s, stations of 240 s, Roxzone 120 s → 4440 s.
func fullSplits() Splits {
	var s Splits
	for i := range SplitCount {
		s.Runs[i], s.Stations[i] = intp(300), intp(240)
	}
	s.Roxzone = intp(120)
	return s
}

func TestComputeTotals(t *testing.T) {
	t.Run("sums complete splits with Roxzone", func(t *testing.T) {
		got, refusal := ComputeTotals(fullSplits(), nil)
		eq(t, refusal, "")
		eq(t, got, Totals{SplitsTotalSec: intp(4440), TotalSec: 4440})
	})
	t.Run("sums without Roxzone when it is missing", func(t *testing.T) {
		s := fullSplits()
		s.Roxzone = nil
		got, _ := ComputeTotals(s, nil)
		eq(t, *got.SplitsTotalSec, 4320)
	})
	t.Run("ranks the official total and keeps the splits total", func(t *testing.T) {
		got, _ := ComputeTotals(fullSplits(), intp(4443))
		eq(t, got, Totals{SplitsTotalSec: intp(4440), TotalSec: 4443})
	})
	t.Run("flags a gap beyond the tolerance", func(t *testing.T) {
		got, _ := ComputeTotals(fullSplits(), intp(4440+TotalToleranceSec+1))
		eq(t, got.Mismatch, true)
		got, _ = ComputeTotals(fullSplits(), intp(4440-TotalToleranceSec))
		eq(t, got.Mismatch, false)
	})
	t.Run("an incomplete set has no splits total", func(t *testing.T) {
		s := fullSplits()
		s.Stations[7] = nil
		got, refusal := ComputeTotals(s, intp(5000))
		eq(t, refusal, "")
		eq(t, got, Totals{TotalSec: 5000})
		_, refusal = ComputeTotals(s, nil)
		eq(t, refusal != "", true)
	})
	t.Run("a total-only result is valid", func(t *testing.T) {
		got, refusal := ComputeTotals(Splits{}, intp(5400))
		eq(t, refusal, "")
		eq(t, got, Totals{TotalSec: 5400})
	})
}

func TestSplitValuesAndLabels(t *testing.T) {
	s := Splits{}
	s.Runs[2], s.Stations[0] = intp(280), intp(250)
	eq(t, SplitValues(s, 5000), map[string]int{"run3": 280, "station1": 250, "total": 5000})
	eq(t, SplitLabel("run3"), "Lari 3")
	eq(t, SplitLabel("station1"), "SkiErg")
	eq(t, SplitLabel("station8"), "Wall Balls")
	eq(t, SplitLabel("total"), "Total")
}

var day = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

func record(id string, daysIn int, values map[string]int) ResultRecord {
	at := day.AddDate(0, 0, daysIn)
	return ResultRecord{ID: id, RacedAt: at, CreatedAt: at, Values: values}
}

func TestPersonalRecords(t *testing.T) {
	first := record("a", 0, map[string]int{"run1": 300, "station1": 260, "total": 5000})
	second := record("b", 10, map[string]int{"run1": 290, "station1": 270, "total": 4900})
	third := record("c", 20, map[string]int{"run1": 295, "station1": 250, "station2": 200, "total": 4950})
	all := []ResultRecord{first, second, third}

	t.Run("a first result has nothing to beat", func(t *testing.T) {
		eq(t, NewPRs(first.Values, PreviousBests(first, all)), []string{})
	})
	t.Run("only earlier results count as previous bests", func(t *testing.T) {
		eq(t, PreviousBests(second, all), map[string]int{"run1": 300, "station1": 260, "total": 5000})
		eq(t, PreviousBests(third, all), map[string]int{"run1": 290, "station1": 260, "total": 4900})
	})
	t.Run("PRs are strict improvements on splits entered before", func(t *testing.T) {
		eq(t, NewPRs(second.Values, PreviousBests(second, all)), []string{"run1", "total"})
		// station2 is new, run1 and total are slower: only SkiErg is a PR.
		eq(t, NewPRs(third.Values, PreviousBests(third, all)), []string{"station1"})
	})
	t.Run("an equal time is not a PR", func(t *testing.T) {
		tie := record("d", 30, map[string]int{"run1": 290})
		eq(t, NewPRs(tie.Values, PreviousBests(tie, all)), []string{})
	})
	t.Run("same race day: the one logged first came before", func(t *testing.T) {
		a := record("x", 40, map[string]int{"total": 5000})
		b := a
		b.ID, b.CreatedAt, b.Values = "y", a.CreatedAt.Add(time.Minute), map[string]int{"total": 4800}
		eq(t, NewPRs(b.Values, PreviousBests(b, []ResultRecord{a, b})), []string{"total"})
		eq(t, NewPRs(a.Values, PreviousBests(a, []ResultRecord{a, b})), []string{})
	})
	t.Run("an edit only notifies PRs not notified before", func(t *testing.T) {
		eq(t, UnnotifiedPRs([]string{"run1", "station1", "total"}, []string{"run1"}), []string{"station1", "total"})
	})
	t.Run("the notification lists each PR with its time", func(t *testing.T) {
		eq(t, PRNotificationBody([]string{"station1", "run3"}, map[string]int{"station1": 245, "run3": 280}, "HYROX Jakarta"),
			"SkiErg 4:05, Lari 3 4:40 di HYROX Jakarta.")
	})
}

func TestSplitAverages(t *testing.T) {
	eq(t, SplitAverages([]map[string]int{{"run1": 300, "total": 5000}, {"run1": 301}, {"total": 4000}}),
		map[string]int{"run1": 301, "total": 4500})
	eq(t, SplitAverages(nil), map[string]int{})
}

func TestSimulationSplits(t *testing.T) {
	sub := "ski"
	var blocks []WorkoutBlock
	var results []BlockResult
	for i := range SplitCount {
		blocks = append(blocks,
			WorkoutBlock{Order: 2*i + 1, Kind: "RUN", ExerciseID: "run"},
			WorkoutBlock{Order: 2*i + 2, Kind: "STATION", ExerciseID: "st" + string(rune('1'+i))})
		results = append(results, BlockResult{Order: 2*i + 1, DurationSec: 300.4}, BlockResult{Order: 2*i + 2, DurationSec: float64(200 + i)})
	}
	// Station 1 swapped for a substitute; the last station never recorded.
	blocks[1].OriginalExerciseID = &sub
	results = results[:len(results)-1]
	order := func(id string) *int { return intp(int(id[2] - '0')) }

	got := SimulationSplits(blocks, results, order)
	for i := range SplitCount {
		eq(t, *got.Runs[i], 300)
	}
	eq(t, got.Stations[0], (*int)(nil))
	eq(t, *got.Stations[1], 201)
	eq(t, got.Stations[7], (*int)(nil))
	eq(t, got.Roxzone, (*int)(nil))
}

func strp(v string) *string { return &v }

func candidate(customer, result string, total int, daysIn int) BoardCandidate {
	return BoardCandidate{ResultID: result, CustomerID: customer, Source: "race", RaceEventID: strp("jkt"),
		Division: "MEN_OPEN", AgeGroup: strp("30-34"), TotalSec: total, RacedAt: day.AddDate(0, 0, daysIn),
		Verified: true, Visible: true}
}

func ranks(rows []BoardRow) (out []string) {
	for _, r := range rows {
		out = append(out, string(rune('0'+r.Rank))+":"+r.CustomerID)
	}
	return out
}

func TestLeaderboard(t *testing.T) {
	t.Run("keeps each member's best and ranks fastest first", func(t *testing.T) {
		rows := Leaderboard([]BoardCandidate{
			candidate("ana", "a1", 5000, 0), candidate("ana", "a2", 4800, 5), candidate("budi", "b1", 4900, 1),
		}, BoardFilter{}, 0)
		eq(t, ranks(rows), []string{"1:ana", "2:budi"})
		eq(t, rows[0].ResultID, "a2")
	})
	t.Run("ties share a rank and the next rank skips", func(t *testing.T) {
		rows := Leaderboard([]BoardCandidate{
			candidate("cici", "c", 4900, 3), candidate("ana", "a", 4800, 0), candidate("budi", "b", 4900, 1), candidate("dodi", "d", 5000, 0),
		}, BoardFilter{}, 0)
		// budi raced before cici, so budi lists first at the shared rank.
		eq(t, ranks(rows), []string{"1:ana", "2:budi", "2:cici", "4:dodi"})
	})
	t.Run("leaves out members who turned leaderboards off", func(t *testing.T) {
		hidden := candidate("ana", "a", 4000, 0)
		hidden.Visible = false
		eq(t, ranks(Leaderboard([]BoardCandidate{hidden, candidate("budi", "b", 4900, 0)}, BoardFilter{}, 0)), []string{"1:budi"})
	})
	t.Run("counts verified results unless unverified are included", func(t *testing.T) {
		pending := candidate("ana", "a", 4000, 0)
		pending.Verified = false
		all := []BoardCandidate{pending, candidate("budi", "b", 4900, 0)}
		eq(t, ranks(Leaderboard(all, BoardFilter{}, 0)), []string{"1:budi"})
		eq(t, ranks(Leaderboard(all, BoardFilter{IncludeUnverified: true}, 0)), []string{"1:ana", "2:budi"})
	})
	t.Run("filters by division, age group, race, source and year", func(t *testing.T) {
		women := candidate("ana", "a", 4000, 0)
		women.Division = "WOMEN_OPEN"
		older := candidate("budi", "b", 4100, 0)
		older.AgeGroup = strp("40-44")
		noAge := candidate("cici", "c", 4200, 0)
		noAge.AgeGroup = nil
		sim := candidate("dodi", "d", 4300, 0)
		sim.Source, sim.RaceEventID = "simulation", nil
		lastYear := candidate("eka", "e", 4400, -200)
		all := []BoardCandidate{women, older, noAge, sim, lastYear, candidate("fani", "f", 4500, 0)}

		eq(t, ranks(Leaderboard(all, BoardFilter{Division: strp("WOMEN_OPEN")}, 0)), []string{"1:ana"})
		eq(t, ranks(Leaderboard(all, BoardFilter{AgeGroup: strp("40-44")}, 0)), []string{"1:budi"})
		eq(t, ranks(Leaderboard(all, BoardFilter{Source: strp("simulation")}, 0)), []string{"1:dodi"})
		eq(t, len(Leaderboard(all, BoardFilter{RaceEventID: strp("jkt")}, 0)), 5)
		eq(t, ranks(Leaderboard(all, BoardFilter{Year: intp(2025)}, 0)), []string{"1:eka"})
		eq(t, len(Leaderboard(all, BoardFilter{Year: intp(2026), Division: strp("MEN_OPEN")}, 0)), 4)
	})
	t.Run("the year follows Jakarta time", func(t *testing.T) {
		newYear := candidate("ana", "a", 4000, 0)
		newYear.RacedAt = time.Date(2025, 12, 31, 18, 0, 0, 0, time.UTC) // 01:00 WIB on 1 January
		eq(t, len(Leaderboard([]BoardCandidate{newYear}, BoardFilter{Year: intp(2026)}, 0)), 1)
	})
	t.Run("a station board ranks that split and skips results without it", func(t *testing.T) {
		a := candidate("ana", "a", 4000, 0)
		a.StationSec[0] = intp(250)
		b := candidate("budi", "b", 5000, 0)
		b.StationSec[0] = intp(240)
		c := candidate("cici", "c", 4500, 0)
		rows := Leaderboard([]BoardCandidate{a, b, c}, BoardFilter{}, 1)
		eq(t, ranks(rows), []string{"1:budi", "2:ana"})
		eq(t, rows[0].ValueSec, 240)
		eq(t, len(Leaderboard([]BoardCandidate{a}, BoardFilter{}, 9)), 0)
	})
}
