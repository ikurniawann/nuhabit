// Package domain holds the athlete (Train tab) rules: GPS track statistics,
// splits, pace, personal records, the weekly goal, the eight-week chart,
// segment matching, leaderboards, challenge progress, gear mileage and the
// social graph. Port of frontend/src/lib/gym/athlete.ts. Pure: no I/O, every
// clock reading arrives as an argument.
package domain

import (
	"math"
	"sort"
	"time"
)

const (
	TypeRun     = "RUN"
	TypeRide    = "RIDE"
	TypeWalk    = "WALK"
	TypeWorkout = "WORKOUT"

	VisibilityEveryone  = "EVERYONE"
	VisibilityFollowers = "FOLLOWERS"
	VisibilityPrivate   = "PRIVATE"

	GearShoes = "SHOES"
	GearBike  = "BIKE"

	ChallengeAny = "ANY"
)

var (
	ActivityTypes        = []string{TypeRun, TypeRide, TypeWalk, TypeWorkout}
	ActivityVisibilities = []string{VisibilityEveryone, VisibilityFollowers, VisibilityPrivate}
	GearKinds            = []string{GearShoes, GearBike}
)

// Server limits and list sizes, as in athlete.ts.
const (
	MaxActivityPhotos = 2
	MaxPhotoBytes     = 400_000
	MaxCommentLength  = 500
	ThumbnailPoints   = 40
	RoutePoints       = 500
	RouteListPoints   = 200
	HeatmapPoints     = 120
	FeedSize          = 30
	FeedCandidates    = 200
	ProfileActivities = 20
	LeaderboardRows   = 5
	SegmentBoardSize  = 20
	SuggestionCount   = 8
	StatsWeeks        = 8
	// StudioTZOffsetMin is WIB (UTC+7), the studio's week boundary.
	StudioTZOffsetMin = 7 * 60
)

// TrackPoint is one GPS sample; T is milliseconds since the start, Ele metres.
type TrackPoint struct {
	T   float64  `json:"t"`
	Lat float64  `json:"lat"`
	Lng float64  `json:"lng"`
	Ele *float64 `json:"ele,omitempty"`
}

// ActivitySplit is one kilometre of a track; the last one may be partial.
type ActivitySplit struct {
	Km           int     `json:"km"`
	DistanceM    float64 `json:"distanceM"`
	PaceSecPerKm int     `json:"paceSecPerKm"`
	Full         bool    `json:"full"`
}

// ActivityStats is everything derivable from a track.
type ActivityStats struct {
	DistanceM        float64
	ElapsedSec       int
	MovingSec        int
	AvgPaceSecPerKm  *int
	ElevationGainM   float64
	Splits           []ActivitySplit
	BestSplitPaceSec *int
}

// Activity is a stored activity in camelCase model form.
type Activity struct {
	ID              string
	MemberID        string
	Type            string
	Title           string
	Description     string
	StartedAt       time.Time
	ElapsedSec      int
	MovingSec       int
	DistanceM       float64
	AvgPaceSecPerKm *int
	ElevationGainM  float64
	Visibility      string
	GearID          *string
	PhotoCount      int
	Points          []TrackPoint
	Photos          []string
}

// Round is JavaScript's Math.round: halves round towards +Infinity.
func Round(x float64) float64 {
	r := math.Floor(x)
	if x-r >= 0.5 {
		r++
	}
	return r
}

func roundInt(x float64) int { return int(Round(x)) }

// msOf is a JavaScript Date's getTime() for t.
func msOf(t time.Time) int64 { return t.UnixMilli() }

const earthRadiusM = 6_371_000

func rad(d float64) float64 { return d * math.Pi / 180 }

// HaversineM is the great-circle distance in metres.
func HaversineM(a, b TrackPoint) float64 {
	dLat := rad(b.Lat - a.Lat)
	dLng := rad(b.Lng - a.Lng)
	s := math.Pow(math.Sin(dLat/2), 2) +
		math.Cos(rad(a.Lat))*math.Cos(rad(b.Lat))*math.Pow(math.Sin(dLng/2), 2)
	return 2 * earthRadiusM * math.Asin(math.Sqrt(s))
}

// movingThresholdMPS: below this speed a gap counts as stopped (auto-pause).
const movingThresholdMPS = 0.5

// ComputeActivityStats derives the figures from the track, never the client.
func ComputeActivityStats(points []TrackPoint) ActivityStats {
	if len(points) < 2 {
		elapsed := 0
		if len(points) == 1 {
			elapsed = roundInt(points[0].T / 1000)
		}
		return ActivityStats{ElapsedSec: elapsed, Splits: []ActivitySplit{}}
	}

	var distanceM, movingSec, elevationGainM, splitDist, splitMoving float64
	splits := []ActivitySplit{}

	for i := 1; i < len(points); i++ {
		prev, curr := points[i-1], points[i]
		dt := (curr.T - prev.T) / 1000
		if dt <= 0 {
			continue
		}
		d := HaversineM(prev, curr)
		distanceM += d
		if prev.Ele != nil && curr.Ele != nil {
			if rise := *curr.Ele - *prev.Ele; rise > 0.3 { // ignore GPS jitter
				elevationGainM += rise
			}
		}
		moving := d/dt >= movingThresholdMPS
		if moving {
			movingSec += dt
		}

		// One sample can cross a kilometre boundary.
		remaining := d
		remainingT := 0.0
		if moving {
			remainingT = dt
		}
		for remaining > 0 {
			take := math.Min(1000-splitDist, remaining)
			frac := take / remaining
			splitDist += take
			splitMoving += remainingT * frac
			remainingT *= 1 - frac
			remaining -= take
			if splitDist >= 1000 {
				splits = append(splits, ActivitySplit{
					Km: len(splits) + 1, DistanceM: 1000, PaceSecPerKm: roundInt(splitMoving), Full: true,
				})
				splitDist, splitMoving = 0, 0
			}
		}
	}
	if splitDist > 50 {
		splits = append(splits, ActivitySplit{
			Km:           len(splits) + 1,
			DistanceM:    Round(splitDist),
			PaceSecPerKm: roundInt(splitMoving / splitDist * 1000),
			Full:         false,
		})
	}

	stats := ActivityStats{
		DistanceM:      Round(distanceM),
		ElapsedSec:     roundInt((points[len(points)-1].T - points[0].T) / 1000),
		MovingSec:      roundInt(movingSec),
		ElevationGainM: Round(elevationGainM),
		Splits:         splits,
	}
	if distanceM >= 50 {
		pace := roundInt(movingSec / (distanceM / 1000))
		stats.AvgPaceSecPerKm = &pace
	}
	for _, s := range splits {
		if s.Full && (stats.BestSplitPaceSec == nil || s.PaceSecPerKm < *stats.BestSplitPaceSec) {
			best := s.PaceSecPerKm
			stats.BestSplitPaceSec = &best
		}
	}
	return stats
}

// Downsample keeps at most max points spread along the track, first and last kept.
func Downsample[T any](points []T, max int) []T {
	if max < 2 || len(points) <= max {
		out := make([]T, len(points))
		copy(out, points)
		return out
	}
	step := float64(len(points)-1) / float64(max-1)
	out := make([]T, max)
	for i := range out {
		out[i] = points[roundInt(float64(i)*step)]
	}
	return out
}

// DefaultActivityTitle is the server title when the client sends an empty one.
func DefaultActivityTitle(activityType string, startedAt time.Time, tzOffsetMin int) string {
	hour := time.UnixMilli(startedAt.UnixMilli() + int64(tzOffsetMin)*60_000).UTC().Hour()
	part := "Evening"
	if hour < 12 {
		part = "Morning"
	} else if hour < 17 {
		part = "Afternoon"
	}
	word := map[string]string{TypeRun: "run", TypeRide: "ride", TypeWalk: "walk", TypeWorkout: "workout"}[activityType]
	return part + " " + word
}

// ActivityFigures are the stored numbers of an activity.
type ActivityFigures struct {
	ElapsedSec      int
	MovingSec       int
	DistanceM       float64
	AvgPaceSecPerKm *int
	ElevationGainM  float64
}

// ManualFigures are client-entered numbers for a workout without GPS.
type ManualFigures struct {
	ElapsedSec *float64
	MovingSec  *float64
	DistanceM  *float64
}

// ResolveActivityFigures uses the track when it has two points or more,
// otherwise the manual figures (a gym workout still has a duration).
func ResolveActivityFigures(points []TrackPoint, manual ManualFigures) ActivityFigures {
	if len(points) >= 2 {
		s := ComputeActivityStats(points)
		return ActivityFigures{
			ElapsedSec: s.ElapsedSec, MovingSec: s.MovingSec, DistanceM: s.DistanceM,
			AvgPaceSecPerKm: s.AvgPaceSecPerKm, ElevationGainM: s.ElevationGainM,
		}
	}
	or0 := func(v *float64, fallback float64) float64 {
		if v == nil {
			return fallback
		}
		return *v
	}
	elapsed := math.Max(0, Round(or0(manual.ElapsedSec, 0)))
	return ActivityFigures{
		ElapsedSec: int(elapsed),
		MovingSec:  int(math.Max(0, Round(or0(manual.MovingSec, elapsed)))),
		DistanceM:  math.Max(0, or0(manual.DistanceM, 0)),
	}
}

// CanViewActivity says whether a viewer may see an activity.
func CanViewActivity(memberID, visibility, viewerID string, viewerFollows func(string) bool) bool {
	switch {
	case memberID == viewerID:
		return true
	case visibility == VisibilityEveryone:
		return true
	case visibility == VisibilityFollowers:
		return viewerFollows(memberID)
	}
	return false
}

// SelectFeed walks newest-first candidates, keeps what the viewer may see and,
// for the "following" scope, only their own and followed athletes' activities.
func SelectFeed(candidates []Activity, viewerID string, following map[string]bool, followingOnly bool, limit int) []Activity {
	out := []Activity{}
	for _, a := range candidates {
		if !CanViewActivity(a.MemberID, a.Visibility, viewerID, func(id string) bool { return following[id] }) {
			continue
		}
		if followingOnly && a.MemberID != viewerID && !following[a.MemberID] {
			continue
		}
		out = append(out, a)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// ── Segments ─────────────────────────────────────────────────────────────────

// Segment is a stretch people race each other over.
type Segment struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	Type      string       `json:"type"`
	DistanceM float64      `json:"distanceM"`
	Location  string       `json:"location"`
	Path      []TrackPoint `json:"path"`
}

// SegmentMatchRadiusM is how close (metres) a track must pass a segment gate.
const SegmentMatchRadiusM = 60

// SegmentMatch is a segment found inside a track.
type SegmentMatch struct {
	Segment    Segment
	StartIdx   int
	EndIdx     int
	ElapsedSec int
}

// MatchSegments matches when the track passes the start gate and later the
// end gate having travelled 80%..135% of the segment; effort time comes from
// the point timestamps.
func MatchSegments(segments []Segment, activityType string, points []TrackPoint) []SegmentMatch {
	matches := []SegmentMatch{}
	if len(points) < 2 {
		return matches
	}
	cum := make([]float64, len(points))
	for i := 1; i < len(points); i++ {
		cum[i] = cum[i-1] + HaversineM(points[i-1], points[i])
	}
	for _, segment := range segments {
		if segment.Type != activityType || len(segment.Path) < 2 {
			continue
		}
		gateStart := segment.Path[0]
		gateEnd := segment.Path[len(segment.Path)-1]

		startIdx := -1
		for i, p := range points {
			if HaversineM(p, gateStart) <= SegmentMatchRadiusM {
				startIdx = i
				break
			}
		}
		if startIdx < 0 {
			continue
		}
		endIdx := -1
		for j := startIdx + 1; j < len(points); j++ {
			if HaversineM(points[j], gateEnd) > SegmentMatchRadiusM {
				continue
			}
			traveled := cum[j] - cum[startIdx]
			if traveled >= segment.DistanceM*0.8 && traveled <= segment.DistanceM*1.35 {
				endIdx = j
				break
			}
		}
		if endIdx < 0 {
			continue
		}
		elapsed := roundInt((points[endIdx].T - points[startIdx].T) / 1000)
		if elapsed < 1 {
			elapsed = 1
		}
		matches = append(matches, SegmentMatch{Segment: segment, StartIdx: startIdx, EndIdx: endIdx, ElapsedSec: elapsed})
	}
	return matches
}

// Effort is one attempt at a segment.
type Effort struct {
	SegmentID  string
	MemberID   string
	ElapsedSec int
	CreatedAt  time.Time
}

// BestPerMember keeps each athlete's best effort, fastest first (stable on ties,
// in first-seen order).
func BestPerMember(efforts []Effort) []Effort {
	best := map[string]int{}
	board := []Effort{}
	for _, e := range efforts {
		i, ok := best[e.MemberID]
		if !ok {
			best[e.MemberID] = len(board)
			board = append(board, e)
			continue
		}
		if e.ElapsedSec < board[i].ElapsedSec {
			board[i] = e
		}
	}
	sort.SliceStable(board, func(a, b int) bool { return board[a].ElapsedSec < board[b].ElapsedSec })
	return board
}

// RankOf is the 1-based rank of an athlete on a best-per-member board, nil when absent.
func RankOf(board []Effort, memberID string) *int {
	for i, e := range board {
		if e.MemberID == memberID {
			rank := i + 1
			return &rank
		}
	}
	return nil
}

// Placement is one effort's position on its board.
type Placement struct {
	Rank           int  `json:"rank"`
	TotalEfforts   int  `json:"totalEfforts"`
	IsPersonalBest bool `json:"isPersonalBest"`
}

// PlaceEffort ranks an effort among all efforts on its segment.
func PlaceEffort(effort Effort, all []Effort) Placement {
	board := BestPerMember(all)
	rank := 0
	mine := effort.ElapsedSec
	if r := RankOf(board, effort.MemberID); r != nil {
		rank = *r
		mine = board[*r-1].ElapsedSec
	}
	return Placement{Rank: rank, TotalEfforts: len(board), IsPersonalBest: effort.ElapsedSec <= mine}
}

// ── Grouped activities ───────────────────────────────────────────────────────

// GroupCandidate is the little of an activity grouping needs.
type GroupCandidate struct {
	ID        string
	MemberID  string
	Type      string
	StartedAt time.Time
	Start     *TrackPoint
}

// FindGroupedActivities is "trained together": same type, started within 45
// minutes, start point within 500 m, another athlete.
func FindGroupedActivities(activity GroupCandidate, candidates []GroupCandidate) []string {
	const windowMs = 45 * 60_000
	const radiusM = 500
	ids := []string{}
	if activity.Start == nil {
		return ids
	}
	t0 := msOf(activity.StartedAt)
	for _, c := range candidates {
		if c.ID == activity.ID || c.MemberID == activity.MemberID || c.Type != activity.Type || c.Start == nil {
			continue
		}
		gap := msOf(c.StartedAt) - t0
		if gap < 0 {
			gap = -gap
		}
		if gap <= windowMs && HaversineM(*c.Start, *activity.Start) <= radiusM {
			ids = append(ids, c.ID)
		}
	}
	return ids
}

// ── Challenges & leaderboards ────────────────────────────────────────────────

// Contribution is an activity's claim on a challenge or a weekly board.
type Contribution struct {
	MemberID  string
	Type      string
	DistanceM float64
	MovingSec int
	StartedAt time.Time
}

// RoundKm is km to one decimal from metres (half up).
func RoundKm(metres float64) float64 { return Round(metres/100) / 10 }

// ChallengeProgressKm totals matching activities inside the challenge window.
func ChallengeProgressKm(challengeType string, startsAt, endsAt time.Time, activities []Contribution) float64 {
	from, to := msOf(startsAt), msOf(endsAt)
	total := 0.0
	for _, a := range activities {
		at := msOf(a.StartedAt)
		if (challengeType == ChallengeAny || a.Type == challengeType) && at >= from && at <= to {
			total += a.DistanceM
		}
	}
	return RoundKm(total)
}

// IsChallengeRunning: a challenge can be joined until it ends.
func IsChallengeRunning(endsAt, now time.Time) bool { return msOf(endsAt) >= msOf(now) }

// LeaderboardEntry is one row of a km board.
type LeaderboardEntry struct {
	MemberName string  `json:"memberName"`
	Km         float64 `json:"km"`
	IsMe       bool    `json:"isMe"`
}

// TopOf is the top rows by km (stable on ties).
func TopOf(rows []LeaderboardEntry, size int) []LeaderboardEntry {
	out := append([]LeaderboardEntry{}, rows...)
	sort.SliceStable(out, func(a, b int) bool { return out[a].Km > out[b].Km })
	if len(out) > size {
		out = out[:size]
	}
	return out
}

// ── Weeks, stats, records ────────────────────────────────────────────────────

const dayMs = 24 * 3600_000

// StartOfWeek is Monday 00:00 in the studio zone of the week containing at.
func StartOfWeek(at time.Time, tzOffsetMin int) time.Time {
	offset := int64(tzOffsetMin) * 60_000
	local := time.UnixMilli(at.UnixMilli() + offset).UTC()
	day := (int(local.Weekday()) + 6) % 7 // Monday = 0
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC).UnixMilli() - int64(day)*dayMs
	return time.UnixMilli(midnight - offset).UTC()
}

// WeekBucket is one week of training.
type WeekBucket struct {
	WeekStart  time.Time
	DistanceKm float64
	Activities int
	MovingSec  int
}

// WeeklyBuckets is the last `weeks` weeks, oldest first, empty weeks kept.
func WeeklyBuckets(activities []Contribution, now time.Time, weeks, tzOffsetMin int) []WeekBucket {
	current := msOf(StartOfWeek(now, tzOffsetMin))
	buckets := make([]WeekBucket, 0, weeks)
	for i := weeks - 1; i >= 0; i-- {
		start := current - int64(i)*7*dayMs
		end := start + 7*dayMs
		bucket := WeekBucket{WeekStart: time.UnixMilli(start).UTC()}
		total := 0.0
		for _, a := range activities {
			if at := msOf(a.StartedAt); at >= start && at < end {
				total += a.DistanceM
				bucket.Activities++
				bucket.MovingSec += a.MovingSec
			}
		}
		bucket.DistanceKm = RoundKm(total)
		buckets = append(buckets, bucket)
	}
	return buckets
}

// WeeklyKmByMember is this week's km per athlete (club board, suggestions).
func WeeklyKmByMember(activities []Contribution, now time.Time, tzOffsetMin int) map[string]float64 {
	from := msOf(StartOfWeek(now, tzOffsetMin))
	metres := map[string]float64{}
	for _, a := range activities {
		if msOf(a.StartedAt) < from {
			continue
		}
		metres[a.MemberID] += a.DistanceM
	}
	out := make(map[string]float64, len(metres))
	for id, m := range metres {
		out[id] = RoundKm(m)
	}
	return out
}

// PersonalRecords are a member's bests.
type PersonalRecords struct {
	Best1kPaceSec    *int    `json:"best1kPaceSec"`
	Best5kSec        *int    `json:"best5kSec"`
	Best10kSec       *int    `json:"best10kSec"`
	LongestDistanceM float64 `json:"longestDistanceM"`
	LongestMovingSec int     `json:"longestMovingSec"`
}

// ComputePersonalRecords: 1k from the fastest full split; 5k/10k estimated
// from a long enough run's whole moving pace.
func ComputePersonalRecords(activities []Activity) PersonalRecords {
	prs := PersonalRecords{}
	var runs []Activity
	for _, a := range activities {
		if a.Type == TypeRun && a.DistanceM > 0 && a.MovingSec > 0 {
			runs = append(runs, a)
		}
		prs.LongestDistanceM = math.Max(prs.LongestDistanceM, a.DistanceM)
		if a.MovingSec > prs.LongestMovingSec {
			prs.LongestMovingSec = a.MovingSec
		}
	}
	for _, a := range runs {
		if p := ComputeActivityStats(a.Points).BestSplitPaceSec; p != nil && (prs.Best1kPaceSec == nil || *p < *prs.Best1kPaceSec) {
			prs.Best1kPaceSec = p
		}
	}
	estimate := func(meters float64) *int {
		var best *int
		for _, a := range runs {
			if a.DistanceM < meters {
				continue
			}
			sec := roundInt(float64(a.MovingSec) * meters / a.DistanceM)
			if best == nil || sec < *best {
				best = &sec
			}
		}
		return best
	}
	prs.Best5kSec = estimate(5000)
	prs.Best10kSec = estimate(10_000)
	return prs
}

// WeeklyGoalProgress is 0..1 (0 when no target is set).
func WeeklyGoalProgress(targetKm *float64, currentKm float64) float64 {
	if targetKm == nil || *targetKm <= 0 {
		return 0
	}
	return math.Min(1, currentKm / *targetKm)
}

// ── Gear ─────────────────────────────────────────────────────────────────────

// GearMove shifts mileage on one piece of gear.
type GearMove struct {
	GearID string
	DeltaM float64
}

// GearMileageMoves moves an activity's distance from the previous gear to the
// next one (or drops it when the activity is deleted, next = nil).
func GearMileageMoves(previous, next *string, distanceM float64) []GearMove {
	if equalPtr(previous, next) || distanceM <= 0 {
		return []GearMove{}
	}
	moves := []GearMove{}
	if previous != nil && *previous != "" {
		moves = append(moves, GearMove{GearID: *previous, DeltaM: -distanceM})
	}
	if next != nil && *next != "" {
		moves = append(moves, GearMove{GearID: *next, DeltaM: distanceM})
	}
	return moves
}

func equalPtr(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// GearKindFor pairs bikes with rides and shoes with runs and walks.
func GearKindFor(activityType string) string {
	switch activityType {
	case TypeRide:
		return GearBike
	case TypeWorkout:
		return ""
	}
	return GearShoes
}

// ── Social ───────────────────────────────────────────────────────────────────

// FollowSuggestions: active athletes who train, not yet followed, not self.
func FollowSuggestions(activeMemberIDs []string, viewerID string, following, trains map[string]bool, count int) []string {
	out := []string{}
	for _, id := range activeMemberIDs {
		if len(out) >= count {
			break
		}
		if id != viewerID && !following[id] && trains[id] {
			out = append(out, id)
		}
	}
	return out
}

// ── HYROX workout as an activity ─────────────────────────────────────────────

// WorkoutBlock is one block of a workout definition.
type WorkoutBlock struct {
	Kind      string   `json:"kind"`
	DistanceM *float64 `json:"distanceM"`
}

// WorkoutRunDistanceM is the total of the run blocks (stations are not km).
func WorkoutRunDistanceM(blocks []WorkoutBlock) float64 {
	sum := 0.0
	for _, b := range blocks {
		if b.Kind == "RUN" && b.DistanceM != nil && *b.DistanceM != 0 {
			sum += *b.DistanceM
		}
	}
	return sum
}

// WorkoutActivityTitle names a synced workout like the reference.
func WorkoutActivityTitle(workoutType string) string {
	switch workoutType {
	case "FULL_SIMULATION":
		return "HYROX simulation"
	case "COVERAGE":
		return "HYROX coverage session"
	case "QUICK":
		return "Quick HYROX session"
	}
	return "HYROX station practice"
}
