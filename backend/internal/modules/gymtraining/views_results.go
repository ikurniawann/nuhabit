package gymtraining

import (
	"time"

	"nuhabit/backend/internal/modules/gymtraining/domain"
)

/* ── HYROX results ───────────────────────────────────────────────────── */

// resultView is a gym.hyrox_results row with its race name. Fields tagged
// json:"-" stay on the server.
type resultView struct {
	ID               string            `json:"id"`
	CustomerID       string            `json:"-"`
	Source           string            `json:"source"`
	RaceEventID      *string           `json:"race_event_id"`
	RaceName         *string           `json:"race_name"`
	WorkoutSessionID *string           `json:"workout_session_id"`
	MemberRaceID     *string           `json:"-"`
	Division         string            `json:"division"`
	AgeGroup         *string           `json:"age_group"`
	RunSec           []*int            `json:"run_sec"`
	StationSec       []*int            `json:"station_sec"`
	RoxzoneSec       *int              `json:"roxzone_sec"`
	OfficialTotalSec *int              `json:"official_total_sec"`
	SplitsTotalSec   *int              `json:"splits_total_sec"`
	TotalSec         int               `json:"total_sec"`
	TotalMismatch    bool              `json:"total_mismatch"`
	RacedAt          domain.Timestamp  `json:"raced_at"`
	NotifiedPRs      []string          `json:"-"`
	Verified         bool              `json:"verified"`
	VerifiedAt       *domain.Timestamp `json:"verified_at"`
	CreatedAt        domain.Timestamp  `json:"created_at"`
}

func (v resultView) splits() domain.Splits {
	s := domain.Splits{Roxzone: v.RoxzoneSec}
	copy(s.Runs[:], v.RunSec)
	copy(s.Stations[:], v.StationSec)
	return s
}

func (v resultView) record() domain.ResultRecord {
	return domain.ResultRecord{ID: v.ID, RacedAt: v.RacedAt.Time, CreatedAt: v.CreatedAt.Time,
		Values: domain.SplitValues(v.splits(), v.TotalSec)}
}

// splitCompare is one split on the detail page: the member's time, their
// best before this result, the gym average in the division, and whether it
// is a PR.
type splitCompare struct {
	Key             string `json:"key"`
	Sec             *int   `json:"sec"`
	PreviousBestSec *int   `json:"previous_best_sec"`
	GymAverageSec   *int   `json:"gym_average_sec"`
	IsPR            bool   `json:"is_pr"`
}

type resultDetail struct {
	Result resultView     `json:"result"`
	Splits []splitCompare `json:"splits"`
}

// resultRaceOption is a race the member can log a result for.
type resultRaceOption struct {
	ID       string           `json:"id"`
	Name     string           `json:"name"`
	City     string           `json:"city"`
	StartsAt domain.Timestamp `json:"starts_at"`
	// The division of the member's race entry, when there is one.
	Division *string `json:"division"`
}

// simulationOption is a completed full simulation not logged yet, with the
// splits read from its blocks.
type simulationOption struct {
	SessionID  string           `json:"session_id"`
	EndedAt    domain.Timestamp `json:"ended_at"`
	Division   string           `json:"division"`
	ActiveSec  int              `json:"active_sec"`
	RunSec     []*int           `json:"run_sec"`
	StationSec []*int           `json:"station_sec"`
}

type myResults struct {
	Results     []resultView       `json:"results"`
	Races       []resultRaceOption `json:"races"`
	Simulations []simulationOption `json:"simulations"`
}

// boardRowView is one leaderboard line. CustomerID is filled for staff only.
type boardRowView struct {
	Rank       int              `json:"rank"`
	ResultID   string           `json:"result_id"`
	CustomerID string           `json:"customer_id,omitempty"`
	Name       string           `json:"name"`
	IsMe       bool             `json:"is_me"`
	Division   string           `json:"division"`
	AgeGroup   *string          `json:"age_group"`
	Source     string           `json:"source"`
	RaceName   *string          `json:"race_name"`
	ValueSec   int              `json:"value_sec"`
	TotalSec   int              `json:"total_sec"`
	RacedAt    domain.Timestamp `json:"raced_at"`
	Verified   bool             `json:"verified"`
}

type leaderboardView struct {
	Rows   []boardRowView `json:"rows"`
	MyRank *int           `json:"my_rank"`
	// Hidden: the viewer turned leaderboards off; they see their own row,
	// other members do not.
	Hidden bool `json:"hidden"`
	// Years with results, newest first, for the period filter.
	Years []int `json:"years"`
}

// boardCandidateRow is a result as the leaderboard query returns it.
type boardCandidateRow struct {
	ResultID    string
	CustomerID  string
	Source      string
	RaceEventID *string
	RaceName    *string
	Division    string
	AgeGroup    *string
	TotalSec    int
	StationSec  []*int
	RacedAt     time.Time
	Verified    bool
	Visible     bool
}

// resultAdminView is a result on the staff list, with the member's contact
// and leaderboard choice.
type resultAdminView struct {
	resultView
	Name              *string `json:"name" db:"-"`
	Phone             *string `json:"phone" db:"-"`
	ShowOnLeaderboard bool    `json:"show_on_leaderboard"`
}
