package domain

import "testing"

func asset(path string) string { return "/member-assets" + path }

func block(order int) WorkoutBlock {
	kind := "STATION"
	if order%2 == 1 {
		kind = "RUN"
	}
	return WorkoutBlock{Order: order, Kind: kind, ExerciseID: "ex", ExerciseName: "Ex", DistanceM: intp(1000), TargetSec: 300}
}

func sessionRow(over func(*SessionRow)) SessionRow {
	s := SessionRow{ID: "s1", WorkoutID: "w1", Status: "started", CurrentBlock: 2,
		BlockResults: []BlockResult{{Order: 1, DurationSec: 280}}, CreatedAt: mustTime("2026-10-01T00:00:00Z")}
	if over != nil {
		over(&s)
	}
	return s
}

func eventRow(over func(*RaceEventRow)) RaceEventRow {
	r := RaceEventRow{ID: "r1", Name: "HYROX Jakarta", Country: "Indonesia", Region: "ASIA", City: "Jakarta", Venue: "JIExpo",
		StartsAt: mustTime("2026-12-05T00:00:00Z"), EndsAt: mustTime("2026-12-06T00:00:00Z"),
		RegistrationURL: "https://hyrox.com", Status: "registration_open"}
	if over != nil {
		over(&r)
	}
	return r
}

func TestWorkoutAdapters(t *testing.T) {
	workout := ToWorkout(WorkoutRow{ID: "w1", Type: "QUICK", Division: "MEN_OPEN", Blocks: []WorkoutBlock{block(1), block(2)}, TotalTargetSec: 600})

	t.Run("maps a session to the reference view with active time and completion", func(t *testing.T) {
		view := ToSessionView(sessionRow(nil), workout)
		eq(t, view.Session.Status, "STARTED")
		eq(t, view.Session.CurrentBlock, 2)
		eq(t, view.ActiveSec, 280)
		eq(t, view.CompletionPct, 50)
		eq(t, view.Workout.TotalTargetSec, 600)
	})

	t.Run("flattens history to one row per session, newest first", func(t *testing.T) {
		history := []WorkoutRow{
			{ID: "w1", Type: "QUICK", Division: "WOMEN_PRO", Blocks: []WorkoutBlock{block(1), block(2)}, TotalTargetSec: 600,
				Sessions: []SessionRow{
					sessionRow(func(s *SessionRow) { s.ID = "old" }),
					sessionRow(func(s *SessionRow) {
						s.ID, s.Status, s.CreatedAt = "new", "completed", mustTime("2026-10-02T00:00:00Z")
					}),
				}},
			{ID: "w2", Type: "QUICK", Division: "MEN_OPEN", Blocks: workout.Blocks, TotalTargetSec: 600},
		}
		items := FlattenWorkoutHistory(history)
		eq(t, []string{items[0].Session.ID, items[1].Session.ID}, []string{"new", "old"})
		eq(t, len(items), 2)
		first := items[0]
		eq(t, []any{first.WorkoutType, first.Division, first.TotalBlocks, first.CompletionPct}, []any{"QUICK", "WOMEN_PRO", 2, 50})
		eq(t, first.Session.Status, "COMPLETED")
	})
}

func TestRaceAdapters(t *testing.T) {
	t.Run("maps known cities to their photo", func(t *testing.T) {
		eq(t, RaceImagePath("Jakarta"), "/img/race-jakarta.jpg")
		eq(t, RaceImagePath("Kuala Lumpur"), "/img/race-kualalumpur.jpg")
		eq(t, RaceImagePath("Hong Kong"), "/img/race-hongkong.jpg")
		eq(t, RaceImagePath("Surabaya"), "")
	})

	t.Run("prefers a stored image, then the city photo", func(t *testing.T) {
		eq(t, *ToRaceEvent(eventRow(nil), asset).ImageURL, "/member-assets/img/race-jakarta.jpg")
		eq(t, *ToRaceEvent(eventRow(func(r *RaceEventRow) { r.ImageURL = ptr("https://cdn/x.jpg") }), asset).ImageURL, "https://cdn/x.jpg")
		eq(t, ToRaceEvent(eventRow(func(r *RaceEventRow) { r.City = "Surabaya" }), asset).ImageURL, (*string)(nil))
		eq(t, ToRaceEvent(eventRow(nil), asset).Status, "REGISTRATION_OPEN")
	})

	t.Run("builds My Races rows with member-wide readiness", func(t *testing.T) {
		row := MemberRaceRow{ID: "e1", RaceEventID: "r1", Division: "MEN_PRO", GoalSec: intp(5400), ResultSec: intp(5300),
			Status: "raced", Event: eventRow(nil), PredictionSec: intp(5500),
			Analysis: &RaceAnalysis{VsGoalSec: intp(-100), VsPredictionSec: intp(-200), AchievedGoal: boolp(true)}}
		view := ToMyRace(row, 75, 3, asset)
		eq(t, view.UserRace, AppUserRace{ID: "e1", RaceEventID: "r1", Division: "MEN_PRO", GoalSec: intp(5400), ResultSec: intp(5300), Status: "RACED"})
		eq(t, []any{view.ReadinessScore, view.SimulationCount, *view.PredictionSec, view.DaysToRace}, []any{75, 3, 5500, 0})
	})

	t.Run("parses hh:mm:ss only", func(t *testing.T) {
		parse := func(s string) *int {
			if v, ok := ParseHms(s); ok {
				return &v
			}
			return nil
		}
		eq(t, parse("01:30:00"), intp(5400))
		eq(t, parse(" 1:05:09 "), intp(3909))
		eq(t, parse("90:00"), (*int)(nil))
		eq(t, parse(""), (*int)(nil))
	})
}

func TestYoutubeLinks(t *testing.T) {
	t.Run("extracts ids from watch, short and embed links", func(t *testing.T) {
		eq(t, YoutubeVideoID("https://www.youtube.com/watch?v=abc123XYZ&t=4"), "abc123XYZ")
		eq(t, YoutubeVideoID("https://youtu.be/abc123XYZ"), "abc123XYZ")
		eq(t, YoutubeVideoID("https://www.youtube.com/embed/abc123XYZ"), "abc123XYZ")
	})
	t.Run("does not embed search links", func(t *testing.T) {
		search := "https://www.youtube.com/results?search_query=hyrox+skierg+technique"
		eq(t, YoutubeVideoID(search), "")
		eq(t, YoutubeEmbedURL(search), "")
		eq(t, YoutubeEmbedURL("https://www.youtube.com/watch?v=abc123XYZ"), "https://www.youtube.com/embed/abc123XYZ")
	})
}
