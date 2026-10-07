package domain

import (
	"math"
	"reflect"
	"testing"
	"time"
)

// northTrack is a straight line north: each step stepM metres in stepSec seconds.
func northTrack(steps int, stepM, stepSec float64) []TrackPoint {
	const fromLat, fromLng = -6.229, 106.808
	dLat := stepM / 111_195
	out := make([]TrackPoint, steps+1)
	for i := range out {
		out[i] = TrackPoint{T: float64(i) * stepSec * 1000, Lat: fromLat + float64(i)*dLat, Lng: fromLng}
	}
	return out
}

func ts(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func ptr[T any](v T) *T { return &v }

func intOrNil(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestHaversine(t *testing.T) {
	if d := HaversineM(TrackPoint{}, TrackPoint{Lat: 1}); math.Abs(d-111_195) > 5 {
		t.Fatalf("one degree = %v", d)
	}
	p := TrackPoint{Lat: -6.2, Lng: 106.8}
	if d := HaversineM(p, p); d != 0 {
		t.Fatalf("same point = %v", d)
	}
}

func TestRoundIsJavaScriptRound(t *testing.T) {
	for in, want := range map[float64]float64{2.5: 3, -2.5: -2, 0.49999999999999994: 0, 1.4: 1, -0.6: -1} {
		if got := Round(in); got != want {
			t.Errorf("Round(%v) = %v, want %v", in, got, want)
		}
	}
}

func TestComputeActivityStats(t *testing.T) {
	t.Run("empty below two points", func(t *testing.T) {
		s := ComputeActivityStats([]TrackPoint{{T: 5000}})
		if s.DistanceM != 0 || s.ElapsedSec != 5 || s.MovingSec != 0 || s.AvgPaceSecPerKm != nil || len(s.Splits) != 0 {
			t.Fatalf("%+v", s)
		}
	})
	t.Run("distance, pace and full splits", func(t *testing.T) {
		s := ComputeActivityStats(northTrack(250, 10, 3))
		if s.DistanceM != 2500 || s.ElapsedSec != 750 || s.MovingSec != 750 || intOrNil(s.AvgPaceSecPerKm) != 300 {
			t.Fatalf("%+v", s)
		}
		want := []ActivitySplit{{1, 1000, 300, true}, {2, 1000, 300, true}, {3, 500, 300, false}}
		if !reflect.DeepEqual(s.Splits, want) {
			t.Fatalf("splits %+v", s.Splits)
		}
		if intOrNil(s.BestSplitPaceSec) != 300 {
			t.Fatal("best split")
		}
	})
	t.Run("stopped gaps are elapsed, not moving", func(t *testing.T) {
		track := northTrack(10, 10, 3)
		last := track[len(track)-1]
		last.T += 60_000
		s := ComputeActivityStats(append(track, last))
		if s.ElapsedSec != 90 || s.MovingSec != 30 {
			t.Fatalf("%+v", s)
		}
	})
	t.Run("elevation above jitter only", func(t *testing.T) {
		track := northTrack(3, 10, 3)
		for i, e := range []float64{10, 10.2, 12, 11} {
			track[i].Ele = ptr(e)
		}
		if g := ComputeActivityStats(track).ElevationGainM; g != 2 {
			t.Fatalf("gain %v", g)
		}
	})
	t.Run("drops a trailing split under 50 m", func(t *testing.T) {
		if n := len(ComputeActivityStats(northTrack(102, 10, 3)).Splits); n != 1 {
			t.Fatalf("splits %d", n)
		}
	})
}

func TestResolveActivityFigures(t *testing.T) {
	f := ResolveActivityFigures(northTrack(100, 10, 3), ManualFigures{ElapsedSec: ptr(9999.0), DistanceM: ptr(99_999.0)})
	if f.DistanceM != 1000 || f.ElapsedSec != 300 {
		t.Fatalf("%+v", f)
	}
	manual := ResolveActivityFigures(nil, ManualFigures{ElapsedSec: ptr(2400.0)})
	if !reflect.DeepEqual(manual, ActivityFigures{ElapsedSec: 2400, MovingSec: 2400}) {
		t.Fatalf("%+v", manual)
	}
}

func TestDownsample(t *testing.T) {
	if got := Downsample([]int{1, 2, 3}, 5); !reflect.DeepEqual(got, []int{1, 2, 3}) {
		t.Fatal(got)
	}
	in := make([]int, 101)
	for i := range in {
		in[i] = i
	}
	if got := Downsample(in, 5); !reflect.DeepEqual(got, []int{0, 25, 50, 75, 100}) {
		t.Fatal(got)
	}
}

func TestDefaultActivityTitle(t *testing.T) {
	cases := map[string][2]string{
		"2026-10-03T23:30:00Z": {TypeRun, "Morning run"},
		"2026-10-03T07:00:00Z": {TypeRide, "Afternoon ride"},
		"2026-10-03T12:00:00Z": {TypeWalk, "Evening walk"},
	}
	for at, c := range cases {
		if got := DefaultActivityTitle(c[0], ts(at), StudioTZOffsetMin); got != c[1] {
			t.Errorf("%s: %q", at, got)
		}
	}
}

func TestVisibilityAndFeed(t *testing.T) {
	follows := map[string]bool{"b": true}
	can := func(member, vis string) bool {
		return CanViewActivity(member, vis, "me", func(id string) bool { return follows[id] })
	}
	if !can("me", VisibilityPrivate) || !can("x", VisibilityEveryone) || !can("b", VisibilityFollowers) ||
		can("x", VisibilityFollowers) || can("b", VisibilityPrivate) {
		t.Fatal("visibility rules")
	}
	candidates := []Activity{
		{ID: "1", MemberID: "x", Visibility: VisibilityEveryone},
		{ID: "2", MemberID: "b", Visibility: VisibilityFollowers},
		{ID: "3", MemberID: "x", Visibility: VisibilityPrivate},
		{ID: "4", MemberID: "me", Visibility: VisibilityPrivate},
	}
	ids := func(list []Activity) []string {
		out := []string{}
		for _, a := range list {
			out = append(out, a.ID)
		}
		return out
	}
	if got := ids(SelectFeed(candidates, "me", follows, false, FeedSize)); !reflect.DeepEqual(got, []string{"1", "2", "4"}) {
		t.Fatal(got)
	}
	if got := ids(SelectFeed(candidates, "me", follows, true, FeedSize)); !reflect.DeepEqual(got, []string{"2", "4"}) {
		t.Fatal(got)
	}
	if got := ids(SelectFeed(candidates, "me", follows, false, 1)); !reflect.DeepEqual(got, []string{"1"}) {
		t.Fatal(got)
	}
}

func TestMatchSegments(t *testing.T) {
	track := northTrack(300, 10, 3)
	segment := Segment{ID: "s1", Type: TypeRun, DistanceM: 1000, Path: []TrackPoint{track[100], track[150], track[200]}}

	m := MatchSegments([]Segment{segment}, TypeRun, track)
	if len(m) != 1 || m[0].ElapsedSec < 270 || m[0].ElapsedSec > 330 {
		t.Fatalf("match %+v", m)
	}
	if len(MatchSegments([]Segment{segment}, TypeRide, track)) != 0 {
		t.Fatal("other type matched")
	}
	if len(MatchSegments([]Segment{segment}, TypeRun, track[:150])) != 0 {
		t.Fatal("missing end gate matched")
	}
	short := segment
	short.DistanceM = 500
	if len(MatchSegments([]Segment{short}, TypeRun, track)) != 0 {
		t.Fatal("detour matched")
	}
}

func TestLeaderboards(t *testing.T) {
	efforts := []Effort{{MemberID: "a", ElapsedSec: 300}, {MemberID: "b", ElapsedSec: 280}, {MemberID: "a", ElapsedSec: 270}, {MemberID: "c", ElapsedSec: 310}}
	board := BestPerMember(efforts)
	want := []Effort{{MemberID: "a", ElapsedSec: 270}, {MemberID: "b", ElapsedSec: 280}, {MemberID: "c", ElapsedSec: 310}}
	if !reflect.DeepEqual(board, want) {
		t.Fatalf("%+v", board)
	}
	if intOrNil(RankOf(board, "b")) != 2 || RankOf(board, "z") != nil {
		t.Fatal("rank")
	}
	if p := PlaceEffort(Effort{MemberID: "a", ElapsedSec: 270}, efforts); p != (Placement{1, 3, true}) {
		t.Fatalf("%+v", p)
	}
	if PlaceEffort(Effort{MemberID: "a", ElapsedSec: 300}, efforts).IsPersonalBest {
		t.Fatal("slower effort flagged as PR")
	}
	rows := make([]LeaderboardEntry, 7)
	for i := range rows {
		rows[i] = LeaderboardEntry{Km: float64(i), IsMe: i == 2}
	}
	var kms []float64
	for _, r := range TopOf(rows, LeaderboardRows) {
		kms = append(kms, r.Km)
	}
	if !reflect.DeepEqual(kms, []float64{6, 5, 4, 3, 2}) {
		t.Fatal(kms)
	}
}

func TestFindGroupedActivities(t *testing.T) {
	start := &TrackPoint{Lat: -6.229, Lng: 106.808}
	base := GroupCandidate{ID: "a1", MemberID: "me", Type: TypeRun, StartedAt: ts("2026-10-01T23:00:00Z"), Start: start}
	with := func(f func(*GroupCandidate)) GroupCandidate { c := base; f(&c); return c }
	pool := []GroupCandidate{
		with(func(c *GroupCandidate) { c.ID, c.MemberID, c.StartedAt = "x1", "rina", ts("2026-10-01T23:20:00Z") }),
		with(func(c *GroupCandidate) { c.ID, c.MemberID, c.StartedAt = "x2", "rina", ts("2026-10-02T01:00:00Z") }),
		with(func(c *GroupCandidate) { c.ID, c.MemberID, c.Type = "x3", "budi", TypeRide }),
		with(func(c *GroupCandidate) {
			c.ID, c.MemberID, c.Start = "x4", "budi", &TrackPoint{Lat: -6.24, Lng: 106.808}
		}),
		with(func(c *GroupCandidate) { c.ID = "x5" }),
	}
	if got := FindGroupedActivities(base, pool); !reflect.DeepEqual(got, []string{"x1"}) {
		t.Fatal(got)
	}
	noStart := base
	noStart.Start = nil
	if got := FindGroupedActivities(noStart, []GroupCandidate{base}); len(got) != 0 {
		t.Fatal(got)
	}
}

func TestChallenges(t *testing.T) {
	from, to := ts("2026-10-01T00:00:00Z"), ts("2026-10-31T23:59:59Z")
	acts := []Contribution{
		{Type: TypeRun, DistanceM: 5049, StartedAt: ts("2026-10-02T00:00:00Z")},
		{Type: TypeRide, DistanceM: 20_000, StartedAt: ts("2026-10-02T00:00:00Z")},
		{Type: TypeRun, DistanceM: 10_000, StartedAt: ts("2026-09-30T00:00:00Z")},
	}
	if got := ChallengeProgressKm(TypeRun, from, to, acts); got != 5 {
		t.Fatal(got)
	}
	if got := ChallengeProgressKm(ChallengeAny, from, to, acts); got != 25 {
		t.Fatal(got)
	}
	if !IsChallengeRunning(to, ts("2026-10-31T00:00:00Z")) || IsChallengeRunning(to, ts("2026-11-01T00:00:00Z")) {
		t.Fatal("running window")
	}
	if RoundKm(1250) != 1.3 || RoundKm(0) != 0 {
		t.Fatal("roundKm")
	}
}

func TestWeeksAndStats(t *testing.T) {
	now := ts("2026-10-03T15:00:00Z") // Saturday 22:00 WIB

	if got := StartOfWeek(now, StudioTZOffsetMin).Format(time.RFC3339); got != "2026-09-27T17:00:00Z" {
		t.Fatal(got)
	}
	if got := StartOfWeek(ts("2026-09-27T17:30:00Z"), StudioTZOffsetMin).Format(time.RFC3339); got != "2026-09-27T17:00:00Z" {
		t.Fatal(got)
	}

	buckets := WeeklyBuckets([]Contribution{
		{StartedAt: ts("2026-10-01T00:00:00Z"), DistanceM: 5000, MovingSec: 1500},
		{StartedAt: ts("2026-09-29T00:00:00Z"), DistanceM: 2549, MovingSec: 900},
		{StartedAt: ts("2026-09-22T00:00:00Z"), DistanceM: 10_000, MovingSec: 3000},
	}, now, StatsWeeks, StudioTZOffsetMin)
	if len(buckets) != 8 {
		t.Fatal(len(buckets))
	}
	if b := buckets[7]; b.DistanceKm != 7.5 || b.Activities != 2 || b.MovingSec != 2400 {
		t.Fatalf("%+v", b)
	}
	if b := buckets[6]; b.DistanceKm != 10 || b.Activities != 1 {
		t.Fatalf("%+v", b)
	}
	if b := buckets[0]; b.DistanceKm != 0 || b.Activities != 0 {
		t.Fatalf("%+v", b)
	}

	km := WeeklyKmByMember([]Contribution{
		{MemberID: "a", StartedAt: ts("2026-10-01T00:00:00Z"), DistanceM: 4000},
		{MemberID: "a", StartedAt: ts("2026-10-02T00:00:00Z"), DistanceM: 1000},
		{MemberID: "b", StartedAt: ts("2026-09-20T00:00:00Z"), DistanceM: 9000},
	}, now, StudioTZOffsetMin)
	if _, hasB := km["b"]; km["a"] != 5 || hasB {
		t.Fatal(km)
	}
}

func TestPersonalRecords(t *testing.T) {
	prs := ComputePersonalRecords([]Activity{
		{Type: TypeRun, DistanceM: 10_000, MovingSec: 3300, Points: northTrack(110, 10, 3)},
		{Type: TypeRun, DistanceM: 5000, MovingSec: 1400},
		{Type: TypeRide, DistanceM: 30_000, MovingSec: 3600},
	})
	if intOrNil(prs.Best1kPaceSec) != 300 || intOrNil(prs.Best5kSec) != 1400 || intOrNil(prs.Best10kSec) != 3300 ||
		prs.LongestDistanceM != 30_000 || prs.LongestMovingSec != 3600 {
		t.Fatalf("%+v", prs)
	}
	if empty := ComputePersonalRecords(nil); !reflect.DeepEqual(empty, PersonalRecords{}) {
		t.Fatalf("%+v", empty)
	}
}

func TestWeeklyGoalProgress(t *testing.T) {
	if WeeklyGoalProgress(ptr(20.0), 5) != 0.25 || WeeklyGoalProgress(ptr(20.0), 40) != 1 || WeeklyGoalProgress(nil, 5) != 0 {
		t.Fatal("goal progress")
	}
}

func TestGear(t *testing.T) {
	g1, g2 := ptr("g1"), ptr("g2")
	cases := []struct {
		prev, next *string
		dist       float64
		want       []GearMove
	}{
		{g1, g2, 5000, []GearMove{{"g1", -5000}, {"g2", 5000}}},
		{g1, nil, 5000, []GearMove{{"g1", -5000}}},
		{g1, ptr("g1"), 5000, []GearMove{}},
		{nil, g2, 0, []GearMove{}},
	}
	for _, c := range cases {
		if got := GearMileageMoves(c.prev, c.next, c.dist); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%v", got)
		}
	}
	if GearKindFor(TypeRide) != GearBike || GearKindFor(TypeWalk) != GearShoes || GearKindFor(TypeWorkout) != "" {
		t.Fatal("gear kind")
	}
}

func TestSocialAndWorkouts(t *testing.T) {
	got := FollowSuggestions([]string{"me", "a", "b", "c", "d"}, "me",
		map[string]bool{"a": true}, map[string]bool{"a": true, "b": true, "d": true}, 1)
	if !reflect.DeepEqual(got, []string{"b"}) {
		t.Fatal(got)
	}
	blocks := []WorkoutBlock{{Kind: "RUN", DistanceM: ptr(1000.0)}, {Kind: "STATION", DistanceM: ptr(50.0)}, {Kind: "RUN"}}
	if WorkoutRunDistanceM(blocks) != 1000 {
		t.Fatal("workout distance")
	}
	if WorkoutActivityTitle("FULL_SIMULATION") != "HYROX simulation" || WorkoutActivityTitle("PRACTICE") != "HYROX station practice" {
		t.Fatal("workout title")
	}
}
