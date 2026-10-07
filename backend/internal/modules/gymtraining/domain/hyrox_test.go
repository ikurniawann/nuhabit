package domain

import (
	"reflect"
	"slices"
	"testing"
	"time"
)

func f(v float64) *float64 { return &v }

func ex(id, category string, station int, equipment []string, distanceM, reps *float64) Exercise {
	e := Exercise{ID: id, Name: id, Category: category, Equipment: equipment, Difficulty: 2,
		DefaultSpec: ExerciseSpec{DistanceM: distanceM, Reps: reps}}
	if station > 0 {
		e.HyroxStationOrder = &station
	}
	return e
}

var exercises = []Exercise{
	ex("ski", "ERG", 1, []string{"skierg"}, f(1000), nil),
	ex("push", "SLED", 2, []string{"sled"}, f(50), nil),
	ex("pull", "SLED", 3, []string{"sled"}, f(50), nil),
	ex("burpee", "JUMP", 4, []string{}, f(80), nil),
	ex("row", "ERG", 5, []string{"rower"}, f(1000), nil),
	ex("carry", "CARRY", 6, []string{"kettlebell"}, f(200), nil),
	ex("lunge", "LUNGE", 7, []string{"sandbag"}, f(100), nil),
	ex("wallball", "THROW", 8, []string{"wall_ball"}, nil, f(100)),
	ex("run", "RUN", 0, []string{}, f(1000), nil),
	ex("bike", "CONDITIONING", 0, []string{"air_bike"}, nil, nil),
}

func rule(from, to string, similarity, volumeFactor float64) SubstitutionRule {
	return SubstitutionRule{OriginalExerciseID: from, AlternativeExerciseID: to, Similarity: similarity, VolumeFactor: volumeFactor}
}

var subs = []SubstitutionRule{
	rule("ski", "row", 0.85, 1),
	rule("ski", "bike", 0.65, 0.5),
	rule("row", "ski", 0.85, 1),
	rule("row", "bike", 0.7, 0.5),
	rule("push", "pull", 0.75, 1),
	rule("push", "lunge", 0.55, 2),
	rule("wallball", "burpee", 0.6, 0.67),
	rule("run", "bike", 0.5, 3),
}

func genArgs(over func(*GenerateWorkoutArgs)) GenerateWorkoutArgs {
	a := GenerateWorkoutArgs{Type: "FULL_SIMULATION", Division: "MEN_OPEN", Exercises: exercises, Substitutions: subs,
		Pick: func(int) int { return 0 }}
	if over != nil {
		over(&a)
	}
	return a
}

func ids(blocks []WorkoutBlock, kind string) []string {
	var out []string
	for _, b := range blocks {
		if kind == "" || b.Kind == kind {
			out = append(out, b.ExerciseID)
		}
	}
	return out
}

func findBlock(t *testing.T, blocks []WorkoutBlock, match func(WorkoutBlock) bool) WorkoutBlock {
	t.Helper()
	for _, b := range blocks {
		if match(b) {
			return b
		}
	}
	t.Fatal("block not found")
	return WorkoutBlock{}
}

func byExercise(id string) func(WorkoutBlock) bool {
	return func(b WorkoutBlock) bool { return b.ExerciseID == id }
}

func byOriginal(id string) func(WorkoutBlock) bool {
	return func(b WorkoutBlock) bool { return b.OriginalExerciseID != nil && *b.OriginalExerciseID == id }
}

func allRunsAre(blocks []WorkoutBlock, distance int) bool {
	for _, b := range blocks {
		if b.Kind == "RUN" && (b.DistanceM == nil || *b.DistanceM != distance) {
			return false
		}
	}
	return true
}

func eq(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func intp(v int) *int { return &v }

func TestListSubstitutes(t *testing.T) {
	t.Run("orders substitutes by similarity, best first", func(t *testing.T) {
		var got []string
		for _, s := range ListSubstitutes("ski", subs, exercises) {
			got = append(got, s.Exercise.ID)
		}
		eq(t, got, []string{"row", "bike"})
	})
	t.Run("drops rules that point at an unknown exercise", func(t *testing.T) {
		eq(t, ListSubstitutes("ski", []SubstitutionRule{rule("ski", "ghost", 0.9, 1)}, exercises), []Substitute{})
	})
}

func TestUnavailableExerciseIDs(t *testing.T) {
	t.Run("treats nil as every piece of equipment available", func(t *testing.T) {
		eq(t, UnavailableExerciseIDs(exercises, nil), []string{})
	})
	t.Run("marks exercises whose equipment is missing; bodyweight always works", func(t *testing.T) {
		missing := UnavailableExerciseIDs(exercises, []string{"rower", "kettlebell"})
		for _, id := range []string{"ski", "push"} {
			if !slices.Contains(missing, id) {
				t.Fatalf("%s should be missing", id)
			}
		}
		for _, id := range []string{"row", "burpee", "run"} {
			if slices.Contains(missing, id) {
				t.Fatalf("%s should be available", id)
			}
		}
	})
	t.Run("lists the equipment catalogue once, sorted", func(t *testing.T) {
		eq(t, EquipmentCatalog(exercises), []string{"air_bike", "kettlebell", "rower", "sandbag", "skierg", "sled", "wall_ball"})
	})
}

func TestGenerateWorkoutFullSimulation(t *testing.T) {
	result := GenerateWorkout(genArgs(nil))

	t.Run("alternates 1 km runs with all eight stations in race order", func(t *testing.T) {
		eq(t, len(result.Blocks), 16)
		if !allRunsAre(result.Blocks, 1000) {
			t.Fatal("runs should be 1000 m")
		}
		eq(t, ids(result.Blocks, "STATION"), []string{"ski", "push", "pull", "burpee", "row", "carry", "lunge", "wallball"})
		for i, b := range result.Blocks {
			eq(t, b.Order, i+1)
		}
	})

	t.Run("sums the block targets into the total", func(t *testing.T) {
		// Men Open: 8 × 330 s run + 1830 s of stations.
		eq(t, result.TotalTargetSec, 8*330+1830)
		sum := 0
		for _, b := range result.Blocks {
			sum += b.TargetSec
		}
		eq(t, result.TotalTargetSec, sum)
	})

	t.Run("applies division loads and rep counts", func(t *testing.T) {
		station := func(division, id string) WorkoutBlock {
			return findBlock(t, GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) { a.Division = division })).Blocks, byExercise(id))
		}
		eq(t, *station("MEN_OPEN", "push").WeightNote, "Sled 152 kg")
		eq(t, *station("MEN_PRO", "push").WeightNote, "Sled 202 kg")
		eq(t, *station("WOMEN_OPEN", "carry").WeightNote, "2×16 kg")
		eq(t, *station("WOMEN_PRO", "wallball").WeightNote, "Bola 6 kg")
		eq(t, *station("WOMEN_OPEN", "wallball").Reps, 75)
		eq(t, *station("WOMEN_PRO", "wallball").Reps, 100)
		eq(t, station("MEN_OPEN", "ski").WeightNote, (*string)(nil))
	})

	t.Run("scales targets per division", func(t *testing.T) {
		ski := func(division string) int {
			return findBlock(t, GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) { a.Division = division })).Blocks, byExercise("ski")).TargetSec
		}
		eq(t, ski("MEN_OPEN"), 240)
		eq(t, ski("MEN_PRO"), 216)
		eq(t, ski("WOMEN_OPEN"), 252)
		eq(t, ski("WOMEN_PRO"), 228)
		run := GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) { a.Division = "WOMEN_OPEN" })).Blocks[0]
		eq(t, run.TargetSec, 360)
	})
}

func TestGenerateWorkoutShorterFormats(t *testing.T) {
	t.Run("COVERAGE picks four stations with 600 m runs, sorted in race order", func(t *testing.T) {
		picks := []int{7, 0, 3, 1}
		result := GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) {
			a.Type = "COVERAGE"
			a.Pick = func(int) int {
				if len(picks) == 0 {
					return 0
				}
				p := picks[0]
				picks = picks[1:]
				return p
			}
		}))
		eq(t, len(result.Blocks), 8)
		if !allRunsAre(result.Blocks, 600) {
			t.Fatal("runs should be 600 m")
		}
		eq(t, ids(result.Blocks, "STATION"), []string{"ski", "pull", "row", "wallball"})
	})

	t.Run("COVERAGE honours an explicit station choice", func(t *testing.T) {
		result := GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) { a.Type = "COVERAGE"; a.StationOrders = []int{8, 2} }))
		eq(t, ids(result.Blocks, "STATION"), []string{"push", "wallball"})
	})

	t.Run("QUICK halves the station volume and target, with 400 m runs", func(t *testing.T) {
		result := GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) { a.Type = "QUICK"; a.StationOrders = []int{1, 8} }))
		run, ski, wallball := result.Blocks[0], result.Blocks[1], result.Blocks[3]
		eq(t, *run.DistanceM, 400)
		eq(t, *ski.DistanceM, 500)
		eq(t, ski.TargetSec, 120)
		eq(t, *wallball.Reps, 50)
	})

	t.Run("PRACTICE repeats one station for three rounds of 200 m", func(t *testing.T) {
		result := GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) { a.Type = "PRACTICE"; a.StationOrders = []int{4} }))
		eq(t, len(result.Blocks), 6)
		eq(t, ids(result.Blocks, "STATION"), []string{"burpee", "burpee", "burpee"})
		if !allRunsAre(result.Blocks, 200) {
			t.Fatal("runs should be 200 m")
		}
	})

	t.Run("clamps an out-of-range pick instead of crashing", func(t *testing.T) {
		result := GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) { a.Type = "QUICK"; a.Pick = func(int) int { return 99 } }))
		eq(t, len(ids(result.Blocks, "STATION")), 4)
	})

	t.Run("returns no blocks when the library has no stations", func(t *testing.T) {
		var noStations []Exercise
		for _, e := range exercises {
			if e.HyroxStationOrder == nil {
				noStations = append(noStations, e)
			}
		}
		result := GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) { a.Exercises = noStations }))
		eq(t, result.Blocks, []WorkoutBlock{})
		eq(t, result.TotalTargetSec, 0)
	})
}

func TestGenerateWorkoutSubstitutions(t *testing.T) {
	t.Run("swaps an excluded station for its closest allowed substitute", func(t *testing.T) {
		result := GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) { a.ExcludedExerciseIDs = []string{"ski"} }))
		block := findBlock(t, result.Blocks, byOriginal("ski"))
		eq(t, block.ExerciseID, "row")
		eq(t, *block.Similarity, 0.85)
		eq(t, *block.DistanceM, 1000)
	})

	t.Run("follows equipment availability and converts volume", func(t *testing.T) {
		// No skierg and no rower: ski and row fall back to the air bike at half distance.
		result := GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) {
			a.AvailableEquipment = []string{"sled", "kettlebell", "sandbag", "wall_ball", "air_bike"}
		}))
		ski := findBlock(t, result.Blocks, byOriginal("ski"))
		eq(t, ski.ExerciseID, "bike")
		eq(t, *ski.DistanceM, 500)
		if !slices.Contains(result.ExcludedExerciseIDs, "ski") || !slices.Contains(result.ExcludedExerciseIDs, "row") {
			t.Fatalf("excluded = %v", result.ExcludedExerciseIDs)
		}
	})

	t.Run("drops the race load note when a substitute stands in", func(t *testing.T) {
		result := GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) {
			a.AvailableEquipment = []string{"rower", "kettlebell", "sandbag", "wall_ball"}
		}))
		push := findBlock(t, result.Blocks, byOriginal("push"))
		eq(t, push.ExerciseID, "lunge")
		eq(t, *push.DistanceM, 100)
		eq(t, push.WeightNote, (*string)(nil))
	})

	t.Run("keeps a station it cannot replace and reports it", func(t *testing.T) {
		result := GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) { a.AvailableEquipment = []string{} }))
		if !slices.Contains(result.UnresolvedExerciseIDs, "carry") || !slices.Contains(result.UnresolvedExerciseIDs, "lunge") {
			t.Fatalf("unresolved = %v", result.UnresolvedExerciseIDs)
		}
		eq(t, findBlock(t, result.Blocks, byExercise("carry")).OriginalExerciseID, (*string)(nil))
		// Wall ball without a ball → burpee, two thirds of the reps.
		wallball := findBlock(t, result.Blocks, byOriginal("wallball"))
		eq(t, wallball.ExerciseID, "burpee")
		eq(t, *wallball.Reps, 67)
	})

	t.Run("substitutes the run itself when the member excludes running", func(t *testing.T) {
		result := GenerateWorkout(genArgs(func(a *GenerateWorkoutArgs) {
			a.Type = "QUICK"
			a.StationOrders = []int{5}
			a.ExcludedExerciseIDs = []string{"run"}
		}))
		b := result.Blocks[0]
		eq(t, b.Kind, "RUN")
		eq(t, b.ExerciseID, "bike")
		eq(t, *b.DistanceM, 1200)
		eq(t, *b.Similarity, 0.5)
	})
}

func TestWorkoutSessionLifecycle(t *testing.T) {
	t0 := time.Date(2026, 10, 3, 6, 0, 0, 0, time.UTC)
	at := func(sec int) time.Time { return t0.Add(time.Duration(sec) * time.Second) }
	unwrap := func(s SessionState, err *SessionError) SessionState {
		t.Helper()
		if err != nil {
			t.Fatal(err.Code)
		}
		return s
	}

	t.Run("starts on block 1", func(t *testing.T) {
		s := NewSession(t0)
		eq(t, s.Status, "started")
		eq(t, s.CurrentBlock, 1)
		eq(t, *s.StartedAt, t0)
	})

	t.Run("tracks pause count and total pause time", func(t *testing.T) {
		s := NewSession(t0)
		s = unwrap(PauseSession(s, at(60)))
		eq(t, s.Status, "paused")
		eq(t, s.PauseCount, 1)
		s = unwrap(ResumeSession(s, at(90)))
		s = unwrap(PauseSession(s, at(120)))
		s = unwrap(ResumeSession(s, at(130)))
		eq(t, s.Status, "started")
		eq(t, s.PauseCount, 2)
		eq(t, s.TotalPauseSec, 40)
		eq(t, s.PausedAt, (*time.Time)(nil))
	})

	t.Run("rejects illegal transitions", func(t *testing.T) {
		s := NewSession(t0)
		_, err := ResumeSession(s, t0)
		eq(t, err, &SessionError{Code: ErrInvalidTransition, From: "started", To: "started"})
		paused := unwrap(PauseSession(s, t0))
		if _, err := PauseSession(paused, t0); err == nil {
			t.Fatal("pausing twice should fail")
		}
	})

	t.Run("overwrites a repeated block result and advances the cursor", func(t *testing.T) {
		s := NewSession(t0)
		s = unwrap(RecordBlock(s, 4, BlockResult{Order: 1, DurationSec: 300}))
		s = unwrap(RecordBlock(s, 4, BlockResult{Order: 1, DurationSec: 280.4}))
		eq(t, s.BlockResults, []BlockResult{{Order: 1, DurationSec: 280}})
		eq(t, s.CurrentBlock, 2)
		_, err := RecordBlock(s, 4, BlockResult{Order: 5, DurationSec: 10})
		eq(t, err.Code, ErrInvalidBlock)
		_, err = RecordBlock(s, 4, BlockResult{Order: 2, DurationSec: -1})
		eq(t, err.Code, ErrInvalidDuration)
	})

	t.Run("completes only when every block has a result", func(t *testing.T) {
		s := NewSession(t0)
		done := unwrap(FinishSession(s, 2, []BlockResult{{Order: 1, DurationSec: 100}, {Order: 2, DurationSec: 200}}, false, at(400)))
		eq(t, done.Status, "completed")
		eq(t, *done.EndedAt, at(400))
		eq(t, SessionActiveSec(done.BlockResults), 300)
		eq(t, SessionCompletionPct(done.BlockResults, 2), 100)

		half := unwrap(FinishSession(s, 2, []BlockResult{{Order: 1, DurationSec: 100}}, false, at(400)))
		eq(t, half.Status, "partial")
		eq(t, SessionCompletionPct(half.BlockResults, 2), 50)
	})

	t.Run("finishes as partial on request and closes an open pause", func(t *testing.T) {
		paused := unwrap(PauseSession(NewSession(t0), at(100)))
		stopped := unwrap(FinishSession(paused, 4, nil, true, at(160)))
		eq(t, stopped.Status, "partial")
		eq(t, stopped.TotalPauseSec, 60)
		eq(t, stopped.PausedAt, (*time.Time)(nil))
		_, err := FinishSession(stopped, 4, nil, false, at(200))
		eq(t, err, &SessionError{Code: ErrFinished})
		_, err = RecordBlock(stopped, 4, BlockResult{Order: 1, DurationSec: 1})
		eq(t, err, &SessionError{Code: ErrFinished})
	})

	t.Run("guards completion percentage against empty workouts", func(t *testing.T) {
		eq(t, SessionCompletionPct(nil, 0), 0)
	})
}

func TestFormatDuration(t *testing.T) {
	t.Run("formats minutes and hours", func(t *testing.T) {
		eq(t, FormatDuration(245), "4:05")
		eq(t, FormatDuration(3909), "1:05:09")
		eq(t, FormatDuration(-3), "0:00")
	})
}

func TestParseDuration(t *testing.T) {
	parse := func(s string) *int {
		if v, ok := ParseDuration(s); ok {
			return &v
		}
		return nil
	}
	t.Run("reads h:mm:ss, mm:ss, and bare minutes", func(t *testing.T) {
		eq(t, parse("1:30:00"), intp(5400))
		eq(t, parse(" 85:30 "), intp(5130))
		eq(t, parse("90"), intp(5400))
	})
	t.Run("rejects junk and zero", func(t *testing.T) {
		for _, s := range []string{"", "1:2:3:4", "abc", "0:00"} {
			eq(t, parse(s), (*int)(nil))
		}
	})
}

func TestReplaceBlockExercise(t *testing.T) {
	sledPush := WorkoutBlock{Order: 4, Kind: "STATION", ExerciseID: "sled", ExerciseName: "Sled Push", DistanceM: intp(50),
		WeightNote: ptr("Sled 152 kg"), TargetSec: 180, VideoURL: ptr("https://youtu.be/sled")}
	exercise := func(id, name string) Exercise {
		return Exercise{ID: id, Name: name, Category: "CONDITIONING", Equipment: []string{}, Difficulty: 2,
			VideoURL: ptr("https://youtu.be/" + id)}
	}
	sledRule := func(alt string, similarity float64) SubstitutionRule {
		return SubstitutionRule{OriginalExerciseID: "sled", AlternativeExerciseID: alt, Similarity: similarity, VolumeFactor: 1}
	}

	t.Run("swaps the exercise, remembers the station and drops the race load", func(t *testing.T) {
		next := ReplaceBlockExercise(sledPush, exercise("bike", "Air Bike"), sledRule("bike", 0.6))
		eq(t, next.ExerciseID, "bike")
		eq(t, next.ExerciseName, "Air Bike")
		eq(t, *next.OriginalExerciseID, "sled")
		eq(t, *next.OriginalExerciseName, "Sled Push")
		eq(t, *next.Similarity, 0.6)
		eq(t, next.WeightNote, (*string)(nil))
		eq(t, *next.VideoURL, "https://youtu.be/bike")
		eq(t, *next.DistanceM, 50)
		eq(t, next.TargetSec, 180)
	})

	t.Run("keeps the first original when swapped twice", func(t *testing.T) {
		once := ReplaceBlockExercise(sledPush, exercise("bike", "Air Bike"), sledRule("bike", 0.6))
		twice := ReplaceBlockExercise(once, exercise("prowler", "Prowler"), sledRule("prowler", 0.9))
		eq(t, twice.ExerciseID, "prowler")
		eq(t, *twice.OriginalExerciseID, "sled")
		eq(t, *twice.OriginalExerciseName, "Sled Push")
		eq(t, *twice.Similarity, 0.9)
	})
}
