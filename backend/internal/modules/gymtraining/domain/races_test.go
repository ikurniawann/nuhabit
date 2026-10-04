package domain

import (
	"math"
	"testing"
	"time"
)

var raceNow = time.Date(2026, 10, 3, 10, 0, 0, 0, time.UTC)

func daysAgo(d float64) time.Time {
	return raceNow.Add(-time.Duration(d * 86_400_000 * float64(time.Millisecond)))
}

func boolp(v bool) *bool { return &v }

func TestPredictRaceSec(t *testing.T) {
	t.Run("is nil until a full simulation exists", func(t *testing.T) {
		eq(t, PredictRaceSec(nil), (*int)(nil))
		eq(t, PredictRaceSec([]float64{0, -5, math.NaN()}), (*int)(nil))
	})
	t.Run("takes the best simulation and applies the race-day factor", func(t *testing.T) {
		eq(t, PredictRaceSec([]float64{6000, 5400, 5800}), intp(jsRound(5400*0.97)))
	})
}

func TestRaceReadinessScore(t *testing.T) {
	t.Run("counts activities in the last 28 days against a 12-session plan", func(t *testing.T) {
		var six []time.Time
		for i := range 6 {
			six = append(six, daysAgo(float64(i*3)))
		}
		eq(t, RaceReadinessScore(six, raceNow), 50)
	})
	t.Run("ignores activities older than 28 days or in the future", func(t *testing.T) {
		eq(t, RaceReadinessScore([]time.Time{daysAgo(29), daysAgo(-1), daysAgo(27.9)}, raceNow), 8)
	})
	t.Run("caps at 100 and floors at 0", func(t *testing.T) {
		var twenty []time.Time
		for range 20 {
			twenty = append(twenty, daysAgo(1))
		}
		eq(t, RaceReadinessScore(twenty, raceNow), 100)
		eq(t, RaceReadinessScore(nil, raceNow), 0)
	})
}

func TestAnalyzeRace(t *testing.T) {
	t.Run("compares a result with goal and prediction", func(t *testing.T) {
		eq(t, AnalyzeRace(5612, intp(5700), intp(5500)), RaceAnalysis{VsGoalSec: intp(-88), VsPredictionSec: intp(112), AchievedGoal: boolp(true)})
	})
	t.Run("leaves comparisons nil when there is nothing to compare with", func(t *testing.T) {
		eq(t, AnalyzeRace(5612, nil, nil), RaceAnalysis{})
	})
	t.Run("treats an exact goal as achieved", func(t *testing.T) {
		eq(t, *AnalyzeRace(5700, intp(5700), nil).AchievedGoal, true)
		eq(t, *AnalyzeRace(5701, intp(5700), nil).AchievedGoal, false)
	})
}

func TestPlanMemberRaceUpdate(t *testing.T) {
	plan := func(current string, u MemberRaceUpdate) MemberRacePatch {
		t.Helper()
		p, refusal := PlanMemberRaceUpdate(current, u)
		if refusal != "" {
			t.Fatal(refusal)
		}
		return p
	}
	refused := func(current string, u MemberRaceUpdate) string {
		_, refusal := PlanMemberRaceUpdate(current, u)
		return refusal
	}

	t.Run("moves to raced when a result is logged", func(t *testing.T) {
		eq(t, plan("training", MemberRaceUpdate{ResultSec: f(5612.4)}), MemberRacePatch{Status: "raced", ResultSec: intp(5612)})
	})
	t.Run("updates goal and division while training", func(t *testing.T) {
		eq(t, plan("training", MemberRaceUpdate{GoalSet: true, GoalSec: intp(5400), Division: ptr("MEN_PRO")}),
			MemberRacePatch{Status: "training", GoalSet: true, GoalSec: intp(5400), Division: ptr("MEN_PRO")})
		eq(t, plan("training", MemberRaceUpdate{GoalSet: true}), MemberRacePatch{Status: "training", GoalSet: true})
	})
	t.Run("cancels", func(t *testing.T) {
		eq(t, plan("training", MemberRaceUpdate{Cancel: true}), MemberRacePatch{Status: "cancelled"})
	})
	t.Run("rejects bad numbers and contradictory requests", func(t *testing.T) {
		for _, u := range []MemberRaceUpdate{
			{GoalSet: true, GoalSec: intp(0)},
			{ResultSec: f(-1)},
			{Cancel: true, ResultSec: f(10)},
		} {
			if refused("training", u) == "" {
				t.Fatalf("%+v should be refused", u)
			}
		}
	})
	t.Run("freezes raced and cancelled entries", func(t *testing.T) {
		eq(t, refused("raced", MemberRaceUpdate{ResultSec: f(5000)}), "Hasil race ini sudah dicatat.")
		eq(t, refused("cancelled", MemberRaceUpdate{GoalSet: true, GoalSec: intp(5000)}), "Race ini sudah dibatalkan.")
	})
}

func TestRaceHelpers(t *testing.T) {
	t.Run("only lets members target races that are still ahead", func(t *testing.T) {
		eq(t, CanTargetRace("registration_open"), true)
		eq(t, CanTargetRace("sold_out"), true)
		eq(t, CanTargetRace("completed"), false)
		eq(t, CanTargetRace("cancelled"), false)
	})
	t.Run("counts whole days until the race", func(t *testing.T) {
		eq(t, DaysUntil(raceNow.Add(time.Duration(1.2*86_400_000)*time.Millisecond), raceNow), 2)
		eq(t, DaysUntil(daysAgo(3), raceNow), 0)
	})
}
