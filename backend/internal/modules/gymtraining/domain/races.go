package domain

import (
	"math"
	"time"
)

// RaceStatuses and RaceRegions are the closed sets gym.race_events accepts.
var (
	RaceStatuses = []string{"announced", "registration_open", "sold_out", "upcoming", "ongoing", "completed", "cancelled"}
	RaceRegions  = []string{"ASIA", "EUROPE", "AMERICAS", "OCEANIA"}
)

// CanTargetRace: members may target a race that is neither finished nor cancelled.
func CanTargetRace(status string) bool { return status != "completed" && status != "cancelled" }

/* ── A member's race ─────────────────────────────────────────────────── */

// Member race statuses.
const (
	MemberRaceTraining  = "training"
	MemberRaceRaced     = "raced"
	MemberRaceCancelled = "cancelled"
)

// MemberRaceUpdate is a requested change; nil fields are not part of it.
type MemberRaceUpdate struct {
	Division *string
	// GoalSet distinguishes "clear the goal" (GoalSet, GoalSec nil) from
	// "leave the goal alone" (!GoalSet).
	GoalSet   bool
	GoalSec   *int
	ResultSec *float64
	Cancel    bool
}

// MemberRacePatch is a validated change.
type MemberRacePatch struct {
	Status    string
	Division  *string
	GoalSet   bool
	GoalSec   *int
	ResultSec *int
}

// PlanMemberRaceUpdate validates a change to a member's race. Logging a
// result moves it to raced; a result is logged once and a raced or cancelled
// entry is frozen. The string is the member-facing refusal.
func PlanMemberRaceUpdate(current string, u MemberRaceUpdate) (MemberRacePatch, string) {
	// Only a race in training can change; a cancelled one comes back by registering again.
	if current != MemberRaceTraining {
		if current == MemberRaceRaced {
			return MemberRacePatch{}, "Hasil race ini sudah dicatat."
		}
		return MemberRacePatch{}, "Race ini sudah dibatalkan."
	}
	if u.GoalSet && u.GoalSec != nil && *u.GoalSec <= 0 {
		return MemberRacePatch{}, "Target waktu harus lebih dari 0."
	}
	if u.ResultSec != nil && !(*u.ResultSec > 0) {
		return MemberRacePatch{}, "Waktu hasil harus lebih dari 0."
	}
	if u.Cancel && u.ResultSec != nil {
		return MemberRacePatch{}, "Pilih salah satu: batal atau catat hasil."
	}
	patch := MemberRacePatch{Status: MemberRaceTraining, Division: u.Division, GoalSet: u.GoalSet, GoalSec: u.GoalSec}
	switch {
	case u.Cancel:
		patch.Status = MemberRaceCancelled
	case u.ResultSec != nil:
		patch.Status = MemberRaceRaced
	}
	if u.ResultSec != nil {
		patch.ResultSec = ptr(jsRound(*u.ResultSec))
	}
	return patch, ""
}

/* ── Prediction and analysis ─────────────────────────────────────────── */

const (
	// RaceDayFactor: adrenaline and the official course cut about 3% off the best simulation.
	RaceDayFactor        = 0.97
	readinessWindow      = 28 * 24 * time.Hour
	readinessTargetCount = 12 // 3 sessions a week for 4 weeks
)

// PredictRaceSec is the best completed full simulation × 0.97, or nil when
// there is none.
func PredictRaceSec(fullSimActiveSecs []float64) *int {
	best := math.Inf(1)
	for _, s := range fullSimActiveSecs {
		if !math.IsNaN(s) && !math.IsInf(s, 0) && s > 0 {
			best = math.Min(best, s)
		}
	}
	if math.IsInf(best, 1) {
		return nil
	}
	return ptr(jsRound(best * RaceDayFactor))
}

// RaceReadinessWindowStart is the earliest activity the readiness score counts.
func RaceReadinessWindowStart(now time.Time) time.Time { return now.Add(-readinessWindow) }

// RaceReadinessScore (0..100) is training consistency over the last 28 days
// against a plan of 12 activities.
func RaceReadinessScore(activities []time.Time, now time.Time) int {
	end := millis(now)
	cutoff := end - readinessWindow.Milliseconds()
	recent := 0
	for _, a := range activities {
		if t := millis(a); t >= cutoff && t <= end {
			recent++
		}
	}
	return max(0, min(100, jsRound(float64(recent)/readinessTargetCount*100)))
}

// RaceAnalysis compares a result; positive means slower than the target.
type RaceAnalysis struct {
	VsGoalSec       *int  `json:"vsGoalSec"`
	VsPredictionSec *int  `json:"vsPredictionSec"`
	AchievedGoal    *bool `json:"achievedGoal"`
}

// AnalyzeRace compares a race result with the goal and the prediction.
func AnalyzeRace(resultSec int, goalSec, predictionSec *int) RaceAnalysis {
	var a RaceAnalysis
	if goalSec != nil {
		a.VsGoalSec = ptr(resultSec - *goalSec)
		a.AchievedGoal = ptr(resultSec <= *goalSec)
	}
	if predictionSec != nil {
		a.VsPredictionSec = ptr(resultSec - *predictionSec)
	}
	return a
}

// DaysUntil counts whole days left before the race (0 on the day or after).
func DaysUntil(startsAt, now time.Time) int {
	return max(0, int(math.Ceil(float64(millis(startsAt)-millis(now))/86_400_000)))
}
