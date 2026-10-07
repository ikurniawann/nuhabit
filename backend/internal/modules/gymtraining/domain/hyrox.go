package domain

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

/* ── Exercise library ─────────────────────────────────────────────────── */

// ExerciseCategories is the closed set gym.exercises.category accepts.
var ExerciseCategories = []string{"ERG", "SLED", "JUMP", "CARRY", "LUNGE", "THROW", "RUN", "CONDITIONING"}

// ExerciseSpec is the default volume of one exercise.
type ExerciseSpec struct {
	DistanceM *float64 `json:"distanceM"`
	Reps      *float64 `json:"reps"`
}

// Exercise is one library entry as the member app sees it.
type Exercise struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Category string `json:"category"`
	// Equipment codes needed (e.g. "sled"); empty means bodyweight.
	Equipment []string `json:"equipment"`
	// 1..8 when the exercise is one of the HYROX race stations.
	HyroxStationOrder *int         `json:"hyroxStationOrder"`
	Difficulty        int          `json:"difficulty"`
	DefaultSpec       ExerciseSpec `json:"defaultSpec"`
	VideoURL          *string      `json:"videoUrl"`
}

// SubstitutionRule is a substitute, how close it is, and its volume conversion.
type SubstitutionRule struct {
	OriginalExerciseID    string  `json:"originalExerciseId"`
	AlternativeExerciseID string  `json:"alternativeExerciseId"`
	Similarity            float64 `json:"similarity"`
	VolumeFactor          float64 `json:"volumeFactor"`
	ConversionNote        string  `json:"conversionNote"`
}

// Substitute pairs a substitute exercise with the rule that allows it.
type Substitute struct {
	Exercise Exercise
	Rule     SubstitutionRule
}

// ListSubstitutes returns the substitutes of exerciseID, most similar first.
// Rules that point at an unknown exercise are dropped.
func ListSubstitutes(exerciseID string, substitutions []SubstitutionRule, exercises []Exercise) []Substitute {
	var rules []SubstitutionRule
	for _, s := range substitutions {
		if s.OriginalExerciseID == exerciseID {
			rules = append(rules, s)
		}
	}
	sort.SliceStable(rules, func(i, j int) bool { return rules[i].Similarity > rules[j].Similarity })
	out := []Substitute{}
	for _, rule := range rules {
		if e, ok := findExercise(exercises, rule.AlternativeExerciseID); ok {
			out = append(out, Substitute{Exercise: e, Rule: rule})
		}
	}
	return out
}

func findExercise(exercises []Exercise, id string) (Exercise, bool) {
	for _, e := range exercises {
		if e.ID == id {
			return e, true
		}
	}
	return Exercise{}, false
}

// UnavailableExerciseIDs lists exercises that need equipment outside
// available. A nil available means the member did not restrict equipment.
func UnavailableExerciseIDs(exercises []Exercise, available []string) []string {
	out := []string{}
	if available == nil {
		return out
	}
	for _, e := range exercises {
		if slices.ContainsFunc(e.Equipment, func(item string) bool { return !slices.Contains(available, item) }) {
			out = append(out, e.ID)
		}
	}
	return out
}

// EquipmentCatalog lists every equipment code in the library once, sorted.
func EquipmentCatalog(exercises []Exercise) []string {
	out := []string{}
	for _, e := range exercises {
		for _, item := range e.Equipment {
			if !slices.Contains(out, item) {
				out = append(out, item)
			}
		}
	}
	sort.Strings(out)
	return out
}

/* ── Generator ───────────────────────────────────────────────────────── */

// WorkoutTypes and Divisions are the closed sets the generator accepts.
var (
	WorkoutTypes = []string{"FULL_SIMULATION", "COVERAGE", "QUICK", "PRACTICE"}
	Divisions    = []string{"MEN_OPEN", "MEN_PRO", "WOMEN_OPEN", "WOMEN_PRO"}
)

// WorkoutBlock is one run or station of a generated workout. It is stored as
// JSON in gym.workouts.blocks, so its JSON keys are the persisted contract.
type WorkoutBlock struct {
	Order        int    `json:"order"`
	Kind         string `json:"kind"` // RUN | STATION
	ExerciseID   string `json:"exerciseId"`
	ExerciseName string `json:"exerciseName"`
	// Set when this block stands in for an excluded or unequipped station.
	OriginalExerciseID   *string `json:"originalExerciseId"`
	OriginalExerciseName *string `json:"originalExerciseName"`
	// Similarity of the substitute; nil when not substituted.
	Similarity *float64 `json:"similarity"`
	DistanceM  *int     `json:"distanceM"`
	Reps       *int     `json:"reps"`
	WeightNote *string  `json:"weightNote"`
	TargetSec  int      `json:"targetSec"`
	VideoURL   *string  `json:"videoUrl"`
}

// Race loads per division for the weighted stations.
var weightNotes = map[int]map[string]string{
	2: {"MEN_OPEN": "Sled 152 kg", "MEN_PRO": "Sled 202 kg", "WOMEN_OPEN": "Sled 102 kg", "WOMEN_PRO": "Sled 152 kg"},
	3: {"MEN_OPEN": "Sled 103 kg", "MEN_PRO": "Sled 153 kg", "WOMEN_OPEN": "Sled 78 kg", "WOMEN_PRO": "Sled 103 kg"},
	6: {"MEN_OPEN": "2×24 kg", "MEN_PRO": "2×32 kg", "WOMEN_OPEN": "2×16 kg", "WOMEN_PRO": "2×24 kg"},
	7: {"MEN_OPEN": "Sandbag 20 kg", "MEN_PRO": "Sandbag 30 kg", "WOMEN_OPEN": "Sandbag 10 kg", "WOMEN_PRO": "Sandbag 20 kg"},
	8: {"MEN_OPEN": "Bola 6 kg", "MEN_PRO": "Bola 9 kg", "WOMEN_OPEN": "Bola 4 kg", "WOMEN_PRO": "Bola 6 kg"},
}

var (
	wallBallReps     = map[string]int{"MEN_OPEN": 100, "MEN_PRO": 100, "WOMEN_OPEN": 75, "WOMEN_PRO": 100}
	stationTargetSec = map[int]float64{1: 240, 2: 180, 3: 210, 4: 270, 5: 250, 6: 120, 7: 260, 8: 300}
	runPaceSecPerKm  = map[string]float64{"MEN_OPEN": 330, "MEN_PRO": 300, "WOMEN_OPEN": 360, "WOMEN_PRO": 330}
	divisionFactor   = map[string]float64{"MEN_OPEN": 1, "MEN_PRO": 0.9, "WOMEN_OPEN": 1.05, "WOMEN_PRO": 0.95}
)

// Run distance per block and station volume per workout type.
var plans = map[string]struct {
	runM   int
	volume float64
}{
	"FULL_SIMULATION": {1000, 1},
	"COVERAGE":        {600, 1},
	"QUICK":           {400, 0.5},
	"PRACTICE":        {200, 0.5},
}

// GenerateWorkoutArgs is the generator input.
type GenerateWorkoutArgs struct {
	Type     string
	Division string
	// COVERAGE/QUICK/PRACTICE: chosen stations (1..8); empty picks via Pick.
	StationOrders       []int
	ExcludedExerciseIDs []string
	// Available equipment; nil means everything. Exercises needing missing
	// equipment are excluded as well.
	AvailableEquipment []string
	Exercises          []Exercise
	Substitutions      []SubstitutionRule
	// Pick returns an integer in [0, n).
	Pick func(n int) int
}

// GeneratedWorkout is the generator output.
type GeneratedWorkout struct {
	Blocks         []WorkoutBlock
	TotalTargetSec int
	// Everything avoided: the member's choice plus missing equipment.
	ExcludedExerciseIDs []string
	// Avoided exercises without a substitute, so they still appear.
	UnresolvedExerciseIDs []string
}

func scale(value *float64, factor float64) *int {
	if value == nil || *value == 0 {
		return nil
	}
	v := jsRound(*value * factor)
	return &v
}

func ptr[T any](v T) *T { return &v }

// GenerateWorkout builds a HYROX workout from the library.
func GenerateWorkout(args GenerateWorkoutArgs) GeneratedWorkout {
	excluded := []string{}
	for _, id := range append(slices.Clone(args.ExcludedExerciseIDs), UnavailableExerciseIDs(args.Exercises, args.AvailableEquipment)...) {
		if !slices.Contains(excluded, id) {
			excluded = append(excluded, id)
		}
	}
	var stations []Exercise
	var running *Exercise
	for i, e := range args.Exercises {
		if e.HyroxStationOrder != nil {
			stations = append(stations, e)
		}
		if running == nil && e.Category == "RUN" {
			running = &args.Exercises[i]
		}
	}
	sortByStation(stations)
	unresolved := []string{}
	blocks := []WorkoutBlock{}

	// The exercise itself when allowed, otherwise its closest allowed substitute.
	resolve := func(e Exercise) (Exercise, *SubstitutionRule, *Exercise) {
		if !slices.Contains(excluded, e.ID) {
			return e, nil, nil
		}
		for _, sub := range ListSubstitutes(e.ID, args.Substitutions, args.Exercises) {
			if !slices.Contains(excluded, sub.Exercise.ID) {
				return sub.Exercise, &sub.Rule, &e
			}
		}
		if !slices.Contains(unresolved, e.ID) {
			unresolved = append(unresolved, e.ID)
		}
		return e, nil, nil
	}

	push := func(b WorkoutBlock) {
		b.Order = len(blocks) + 1
		blocks = append(blocks, b)
	}

	substituted := func(b *WorkoutBlock, rule *SubstitutionRule, original *Exercise) float64 {
		if original != nil {
			b.OriginalExerciseID = ptr(original.ID)
			b.OriginalExerciseName = ptr(original.Name)
		}
		if rule == nil {
			return 1
		}
		b.Similarity = ptr(rule.Similarity)
		return rule.VolumeFactor
	}

	pushRun := func(distanceM int) {
		targetSec := jsRound(runPaceSecPerKm[args.Division] * float64(distanceM) / 1000)
		if running == nil {
			push(WorkoutBlock{Kind: "RUN", ExerciseID: "run", ExerciseName: "Lari", DistanceM: ptr(distanceM), TargetSec: targetSec})
			return
		}
		exercise, rule, original := resolve(*running)
		b := WorkoutBlock{Kind: "RUN", ExerciseID: exercise.ID, ExerciseName: exercise.Name, TargetSec: targetSec, VideoURL: exercise.VideoURL}
		factor := substituted(&b, rule, original)
		b.DistanceM = scale(ptr(float64(distanceM)), factor)
		push(b)
	}

	pushStation := func(station Exercise, volume float64) {
		exercise, rule, original := resolve(station)
		order := *station.HyroxStationOrder
		baseReps := station.DefaultSpec.Reps
		if order == 8 {
			baseReps = ptr(float64(wallBallReps[args.Division]))
		}
		b := WorkoutBlock{Kind: "STATION", ExerciseID: exercise.ID, ExerciseName: exercise.Name, VideoURL: exercise.VideoURL}
		factor := volume * substituted(&b, rule, original)
		b.DistanceM = scale(station.DefaultSpec.DistanceM, factor)
		b.Reps = scale(baseReps, factor)
		// The race load only applies when the station itself is done.
		if note, ok := weightNotes[order][args.Division]; ok && original == nil {
			b.WeightNote = ptr(note)
		}
		target, ok := stationTargetSec[order]
		if !ok {
			target = 240
		}
		b.TargetSec = jsRound(target * divisionFactor[args.Division] * volume)
		push(b)
	}

	chooseStations := func(count int) []Exercise {
		if len(args.StationOrders) > 0 {
			var chosen []Exercise
			for _, s := range stations {
				if slices.Contains(args.StationOrders, *s.HyroxStationOrder) {
					chosen = append(chosen, s)
				}
			}
			return chosen
		}
		pool := slices.Clone(stations)
		var chosen []Exercise
		for len(chosen) < count && len(pool) > 0 {
			index := min(max(0, args.Pick(len(pool))), len(pool)-1)
			chosen = append(chosen, pool[index])
			pool = slices.Delete(pool, index, index+1)
		}
		sortByStation(chosen)
		return chosen
	}

	plan := plans[args.Type]
	if args.Type == "PRACTICE" {
		if chosen := chooseStations(1); len(chosen) > 0 {
			for range 3 {
				pushRun(plan.runM)
				pushStation(chosen[0], plan.volume)
			}
		}
	} else {
		chosen := stations
		if args.Type != "FULL_SIMULATION" {
			chosen = chooseStations(4)
		}
		for _, station := range chosen {
			pushRun(plan.runM)
			pushStation(station, plan.volume)
		}
	}

	total := 0
	for _, b := range blocks {
		total += b.TargetSec
	}
	return GeneratedWorkout{Blocks: blocks, TotalTargetSec: total, ExcludedExerciseIDs: excluded, UnresolvedExerciseIDs: unresolved}
}

func sortByStation(list []Exercise) {
	sort.SliceStable(list, func(i, j int) bool { return *list[i].HyroxStationOrder < *list[j].HyroxStationOrder })
}

/* ── Active workout session ──────────────────────────────────────────── */

// Session statuses.
const (
	SessionReady     = "ready"
	SessionStarted   = "started"
	SessionPaused    = "paused"
	SessionCompleted = "completed"
	SessionPartial   = "partial"
)

// SessionTransitions is the workout session state machine.
var SessionTransitions = map[string][]string{
	SessionReady:     {SessionStarted},
	SessionStarted:   {SessionPaused, SessionCompleted, SessionPartial},
	SessionPaused:    {SessionStarted, SessionCompleted, SessionPartial},
	SessionCompleted: {},
	SessionPartial:   {},
}

// BlockResult is the recorded duration of one block. Stored as JSON in
// gym.workout_sessions.block_results.
type BlockResult struct {
	Order       int     `json:"order"`
	DurationSec float64 `json:"durationSec"`
}

// SessionState is the mutable part of a workout session.
type SessionState struct {
	Status string
	// Block being worked on (from 1).
	CurrentBlock  int
	StartedAt     *time.Time
	EndedAt       *time.Time
	PausedAt      *time.Time
	BlockResults  []BlockResult
	PauseCount    int
	TotalPauseSec int
}

// Session error codes.
const (
	ErrInvalidTransition = "invalid_transition"
	ErrFinished          = "finished"
	ErrInvalidBlock      = "invalid_block"
	ErrInvalidDuration   = "invalid_duration"
)

// SessionError explains why a session action was refused.
type SessionError struct {
	Code  string
	From  string
	To    string
	Order int
}

var sessionErrorMessages = map[string]string{
	ErrInvalidTransition: "Status sesi tidak bisa diubah ke langkah itu.",
	ErrFinished:          "Sesi ini sudah selesai.",
	ErrInvalidBlock:      "Blok itu tidak ada di workout ini.",
	ErrInvalidDuration:   "Durasi blok tidak valid.",
}

// Message is the member-facing text for the error.
func (e *SessionError) Message() string { return sessionErrorMessages[e.Code] }

func move(s SessionState, to string) *SessionError {
	if slices.Contains(SessionTransitions[s.Status], to) {
		return nil
	}
	return &SessionError{Code: ErrInvalidTransition, From: s.Status, To: to}
}

func secondsBetween(from, to time.Time) int {
	return max(0, jsRound(float64(millis(to)-millis(from))/1000))
}

// NewSession starts a session on block 1.
func NewSession(now time.Time) SessionState {
	return SessionState{Status: SessionStarted, CurrentBlock: 1, StartedAt: &now, BlockResults: []BlockResult{}}
}

// PauseSession stops the clock and counts the pause.
func PauseSession(s SessionState, now time.Time) (SessionState, *SessionError) {
	if err := move(s, SessionPaused); err != nil {
		return s, err
	}
	s.Status = SessionPaused
	s.PausedAt = &now
	s.PauseCount++
	return s, nil
}

// closePause adds the running pause to the pause total.
func closePause(s SessionState, now time.Time) SessionState {
	if s.PausedAt == nil {
		return s
	}
	s.TotalPauseSec += secondsBetween(*s.PausedAt, now)
	s.PausedAt = nil
	return s
}

// ResumeSession restarts the clock.
func ResumeSession(s SessionState, now time.Time) (SessionState, *SessionError) {
	if err := move(s, SessionStarted); err != nil {
		return s, err
	}
	s = closePause(s, now)
	s.Status = SessionStarted
	return s, nil
}

// RecordBlock stores one block's duration. Recording the same block again
// overwrites it, so completion never passes 100%.
func RecordBlock(s SessionState, totalBlocks int, result BlockResult) (SessionState, *SessionError) {
	if s.Status != SessionStarted && s.Status != SessionPaused {
		return s, &SessionError{Code: ErrFinished}
	}
	if result.Order < 1 || result.Order > totalBlocks {
		return s, &SessionError{Code: ErrInvalidBlock, Order: result.Order}
	}
	if result.DurationSec < 0 {
		return s, &SessionError{Code: ErrInvalidDuration}
	}
	next := []BlockResult{}
	for _, r := range s.BlockResults {
		if r.Order != result.Order {
			next = append(next, r)
		}
	}
	next = append(next, BlockResult{Order: result.Order, DurationSec: float64(jsRound(result.DurationSec))})
	sort.SliceStable(next, func(i, j int) bool { return next[i].Order < next[j].Order })
	s.BlockResults = next
	s.CurrentBlock = max(s.CurrentBlock, min(result.Order+1, totalBlocks+1))
	return s, nil
}

// FinishSession closes the session, recording the results sent with it. It
// is completed only when every block has a result; otherwise, or when the
// member stops early, it is partial.
func FinishSession(s SessionState, totalBlocks int, results []BlockResult, partial bool, now time.Time) (SessionState, *SessionError) {
	if s.Status != SessionStarted && s.Status != SessionPaused {
		return s, &SessionError{Code: ErrFinished}
	}
	next := s
	for _, r := range results {
		var err *SessionError
		if next, err = RecordBlock(next, totalBlocks, r); err != nil {
			return s, err
		}
	}
	target := SessionPartial
	if !partial && len(next.BlockResults) >= totalBlocks && totalBlocks > 0 {
		target = SessionCompleted
	}
	if err := move(next, target); err != nil {
		return s, err
	}
	next = closePause(next, now)
	next.Status = target
	next.EndedAt = &now
	return next, nil
}

// SessionActiveSec sums the recorded block durations.
func SessionActiveSec(results []BlockResult) int {
	sum := 0.0
	for _, r := range results {
		sum += r.DurationSec
	}
	return int(sum)
}

// SessionCompletionPct is the share of blocks with a result, capped at 100.
func SessionCompletionPct(results []BlockResult, totalBlocks int) int {
	if totalBlocks <= 0 {
		return 0
	}
	return min(100, jsRound(float64(len(results))/float64(totalBlocks)*100))
}

/* ── Durations ────────────────────────────────────────────── */

// FormatDuration renders seconds as "1:05:09" or "4:05".
func FormatDuration(totalSec float64) string {
	sec := max(0, jsRound(totalSec))
	h, m, s := sec/3600, sec%3600/60, sec%60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%d:%02d", m, s)
}

var digits = regexp.MustCompile(`^\d+$`)

// ParseDuration reads "1:30:00" or "90:00" as seconds; a bare number is
// minutes. It returns false for junk and zero.
func ParseDuration(text string) (int, bool) {
	parts := strings.Split(strings.TrimSpace(text), ":")
	if len(parts) > 3 {
		return 0, false
	}
	n := make([]int, len(parts))
	for i, p := range parts {
		p = strings.TrimSpace(p)
		if !digits.MatchString(p) {
			return 0, false
		}
		n[i], _ = strconv.Atoi(p)
	}
	var sec int
	switch len(n) {
	case 1:
		sec = n[0] * 60
	case 2:
		sec = n[0]*60 + n[1]
	default:
		sec = n[0]*3600 + n[1]*60 + n[2]
	}
	return sec, sec > 0
}

/* ── Swap one block's exercise ───────────────────────────────────────── */

// ReplaceBlockExercise swaps a station block's exercise for the member's
// chosen substitute. The original is recorded on the first swap only, so the
// block keeps naming the race station it replaces. The race load no longer
// applies.
func ReplaceBlockExercise(block WorkoutBlock, replacement Exercise, rule SubstitutionRule) WorkoutBlock {
	if block.OriginalExerciseID == nil {
		block.OriginalExerciseID = ptr(block.ExerciseID)
	}
	if block.OriginalExerciseName == nil {
		block.OriginalExerciseName = ptr(block.ExerciseName)
	}
	block.ExerciseID = replacement.ID
	block.ExerciseName = replacement.Name
	block.Similarity = ptr(rule.Similarity)
	block.WeightNote = nil
	block.VideoURL = replacement.VideoURL
	return block
}
