package domain

import (
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Member app view adapters, ported from frontend/src/lib/member-app/workout.ts:
// they turn this repo's API rows into the NüHabit reference contract
// (camelCase, upper-case statuses) for the ported member screens.

// AppWorkout is a generated workout in the reference shape.
type AppWorkout struct {
	ID             string         `json:"id"`
	Type           string         `json:"type"`
	Division       string         `json:"division"`
	Blocks         []WorkoutBlock `json:"blocks"`
	TotalTargetSec int            `json:"totalTargetSec"`
}

// AppSession is a workout session in the reference shape.
type AppSession struct {
	ID           string        `json:"id"`
	WorkoutID    string        `json:"workoutId"`
	Status       string        `json:"status"` // READY | STARTED | PAUSED | COMPLETED | PARTIAL
	CurrentBlock int           `json:"currentBlock"`
	BlockResults []BlockResult `json:"blockResults"`
	CreatedAt    time.Time     `json:"createdAt"`
}

// AppSessionView is a session with its workout and progress.
type AppSessionView struct {
	Session       AppSession `json:"session"`
	Workout       AppWorkout `json:"workout"`
	ActiveSec     int        `json:"activeSec"`
	CompletionPct int        `json:"completionPct"`
}

// AppHistoryItem is one session in the history list.
type AppHistoryItem struct {
	Session       AppSession `json:"session"`
	WorkoutType   string     `json:"workoutType"`
	Division      string     `json:"division"`
	TotalBlocks   int        `json:"totalBlocks"`
	ActiveSec     int        `json:"activeSec"`
	CompletionPct int        `json:"completionPct"`
}

// SessionRow is the stored session the adapters read.
type SessionRow struct {
	ID           string
	WorkoutID    string
	Status       string
	CurrentBlock int
	BlockResults []BlockResult
	CreatedAt    time.Time
}

// WorkoutRow is the stored workout the adapters read.
type WorkoutRow struct {
	ID             string
	Type           string
	Division       string
	Blocks         []WorkoutBlock
	TotalTargetSec int
	Sessions       []SessionRow
}

// ToWorkout maps a stored workout.
func ToWorkout(w WorkoutRow) AppWorkout {
	return AppWorkout{ID: w.ID, Type: w.Type, Division: w.Division, Blocks: w.Blocks, TotalTargetSec: w.TotalTargetSec}
}

// ToSession maps a stored session.
func ToSession(s SessionRow) AppSession {
	results := s.BlockResults
	if results == nil {
		results = []BlockResult{}
	}
	return AppSession{ID: s.ID, WorkoutID: s.WorkoutID, Status: strings.ToUpper(s.Status), CurrentBlock: s.CurrentBlock,
		BlockResults: results, CreatedAt: s.CreatedAt}
}

// ToSessionView adds progress to a session.
func ToSessionView(s SessionRow, w AppWorkout) AppSessionView {
	session := ToSession(s)
	return AppSessionView{
		Session:       session,
		Workout:       w,
		ActiveSec:     SessionActiveSec(session.BlockResults),
		CompletionPct: SessionCompletionPct(session.BlockResults, len(w.Blocks)),
	}
}

// FlattenWorkoutHistory lists one row per session (not per workout), newest
// first; workouts never started do not appear.
func FlattenWorkoutHistory(workouts []WorkoutRow) []AppHistoryItem {
	items := []AppHistoryItem{}
	for _, w := range workouts {
		for _, row := range w.Sessions {
			session := ToSession(row)
			items = append(items, AppHistoryItem{
				Session:       session,
				WorkoutType:   w.Type,
				Division:      w.Division,
				TotalBlocks:   len(w.Blocks),
				ActiveSec:     SessionActiveSec(session.BlockResults),
				CompletionPct: SessionCompletionPct(session.BlockResults, len(w.Blocks)),
			})
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].Session.CreatedAt.After(items[j].Session.CreatedAt) })
	return items
}

// AppRaceEvent is a race in the reference shape.
type AppRaceEvent struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Country         string    `json:"country"`
	Region          string    `json:"region"`
	City            string    `json:"city"`
	Venue           string    `json:"venue"`
	StartsAt        time.Time `json:"startsAt"`
	EndsAt          time.Time `json:"endsAt"`
	RegistrationURL string    `json:"registrationUrl"`
	ImageURL        *string   `json:"imageUrl"`
	Status          string    `json:"status"`
}

// RaceEventRow is the stored race the adapters read.
type RaceEventRow struct {
	ID, Name, Country, Region, City, Venue string
	StartsAt, EndsAt                       time.Time
	RegistrationURL                        string
	ImageURL                               *string
	Status                                 string
}

// AppUserRace is a member's race entry in the reference shape.
type AppUserRace struct {
	ID          string `json:"id"`
	RaceEventID string `json:"raceEventId"`
	Division    string `json:"division"`
	GoalSec     *int   `json:"goalSec"`
	ResultSec   *int   `json:"resultSec"`
	Status      string `json:"status"` // TRAINING | RACED | CANCELLED
}

// AppMyRace is one row of "My races".
type AppMyRace struct {
	UserRace        AppUserRace   `json:"userRace"`
	Event           AppRaceEvent  `json:"event"`
	DaysToRace      int           `json:"daysToRace"`
	PredictionSec   *int          `json:"predictionSec"`
	ReadinessScore  int           `json:"readinessScore"`
	SimulationCount int           `json:"simulationCount"`
	Analysis        *RaceAnalysis `json:"analysis"`
}

// MemberRaceRow is the stored member race with its computed fields.
type MemberRaceRow struct {
	ID, RaceEventID, Division string
	GoalSec, ResultSec        *int
	Status                    string
	Event                     RaceEventRow
	DaysUntil                 int
	PredictionSec             *int
	Analysis                  *RaceAnalysis
}

// Cities whose race photo ships with the member app (/img/race-<city>.jpg).
var raceImageCities = []string{"bangkok", "berlin", "hongkong", "jakarta", "kualalumpur", "newyork", "singapore", "sydney"}

var notLetters = regexp.MustCompile(`[^a-z]`)

// RaceImagePath maps a city to its photo ("Kuala Lumpur" →
// "/img/race-kualalumpur.jpg"), or "" when there is none.
func RaceImagePath(city string) string {
	slug := notLetters.ReplaceAllString(strings.ToLower(city), "")
	if !slices.Contains(raceImageCities, slug) {
		return ""
	}
	return "/img/race-" + slug + ".jpg"
}

// ToRaceEvent maps a stored race; assetURL turns an app asset path into its
// public URL.
func ToRaceEvent(r RaceEventRow, assetURL func(string) string) AppRaceEvent {
	image := r.ImageURL
	if image == nil {
		if path := RaceImagePath(r.City); path != "" {
			image = ptr(assetURL(path))
		}
	}
	return AppRaceEvent{ID: r.ID, Name: r.Name, Country: r.Country, Region: r.Region, City: r.City, Venue: r.Venue,
		StartsAt: r.StartsAt, EndsAt: r.EndsAt, RegistrationURL: r.RegistrationURL, ImageURL: image,
		Status: strings.ToUpper(r.Status)}
}

// ToMyRace maps a member race with member-wide readiness.
func ToMyRace(r MemberRaceRow, readiness, simulationCount int, assetURL func(string) string) AppMyRace {
	return AppMyRace{
		UserRace: AppUserRace{ID: r.ID, RaceEventID: r.RaceEventID, Division: r.Division, GoalSec: r.GoalSec,
			ResultSec: r.ResultSec, Status: strings.ToUpper(r.Status)},
		Event:           ToRaceEvent(r.Event, assetURL),
		DaysToRace:      r.DaysUntil,
		PredictionSec:   r.PredictionSec,
		ReadinessScore:  readiness,
		SimulationCount: simulationCount,
		Analysis:        r.Analysis,
	}
}

var hmsRE = regexp.MustCompile(`^(\d{1,2}):(\d{2}):(\d{2})$`)

// ParseHms reads "01:30:00" as 5400; only hh:mm:ss is accepted.
func ParseHms(value string) (int, bool) {
	m := hmsRE.FindStringSubmatch(strings.TrimSpace(value))
	if m == nil {
		return 0, false
	}
	h, _ := strconv.Atoi(m[1])
	mm, _ := strconv.Atoi(m[2])
	s, _ := strconv.Atoi(m[3])
	return h*3600 + mm*60 + s, true
}

var youtubeRE = regexp.MustCompile(`(?:[?&]v=|youtu\.be/|/embed/)([\w-]{6,})`)

// YoutubeVideoID extracts the id from watch?v=, youtu.be or embed links; ""
// for other links (e.g. a search).
func YoutubeVideoID(url string) string {
	if m := youtubeRE.FindStringSubmatch(url); m != nil {
		return m[1]
	}
	return ""
}

// YoutubeEmbedURL is the iframe URL, or "" when the link is not one video.
func YoutubeEmbedURL(url string) string {
	if id := YoutubeVideoID(url); id != "" {
		return "https://www.youtube.com/embed/" + id
	}
	return ""
}
