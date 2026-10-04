package gymtraining

import (
	"encoding/json"
	"time"

	"nuhabit/backend/internal/modules/gymtraining/domain"
)

// Response rows. Field order follows the TS SELECT lists and JSON keys match
// what node-pg returned: timestamptz as Date (domain.Timestamp), jsonb passed
// through (json.RawMessage), ::float numerics as numbers. Fields tagged
// db:"-" are filled after the scan.

/* ── Exercises ───────────────────────────────────────────────────────── */

type exerciseAdminView struct {
	ID                string           `json:"id"`
	Code              string           `json:"code"`
	Name              string           `json:"name"`
	Description       string           `json:"description"`
	Category          string           `json:"category"`
	Equipment         []string         `json:"equipment"`
	HyroxStationOrder *int             `json:"hyrox_station_order"`
	Difficulty        int              `json:"difficulty"`
	DefaultSpec       json.RawMessage  `json:"default_spec"`
	VideoURL          *string          `json:"video_url"`
	IsActive          bool             `json:"is_active"`
	UpdatedAt         domain.Timestamp `json:"updated_at"`
}

type substitutionAdminView struct {
	ID                    string  `json:"id"`
	OriginalExerciseID    string  `json:"original_exercise_id"`
	OriginalName          string  `json:"original_name"`
	AlternativeExerciseID string  `json:"alternative_exercise_id"`
	AlternativeName       string  `json:"alternative_name"`
	Similarity            float64 `json:"similarity"`
	VolumeFactor          float64 `json:"volume_factor"`
	ConversionNote        string  `json:"conversion_note"`
}

type exerciseAdmin struct {
	Exercises     []exerciseAdminView     `json:"exercises"`
	Substitutions []substitutionAdminView `json:"substitutions"`
}

// library is loadLibrary: active exercises and the rules between them.
type library struct {
	Exercises     []domain.Exercise         `json:"exercises"`
	Substitutions []domain.SubstitutionRule `json:"substitutions"`
}

/* ── Races ───────────────────────────────────────────────────────────── */

// raceEventView is the explicit race column list of workout-server.ts.
type raceEventView struct {
	ID              string           `json:"id"`
	Name            string           `json:"name"`
	Country         string           `json:"country"`
	Region          string           `json:"region"`
	City            string           `json:"city"`
	Venue           string           `json:"venue"`
	StartsAt        domain.Timestamp `json:"starts_at"`
	EndsAt          domain.Timestamp `json:"ends_at"`
	RegistrationURL string           `json:"registration_url"`
	ImageURL        *string          `json:"image_url"`
	Status          string           `json:"status"`
}

// raceEventRow is `e.*` of gym.race_events.
type raceEventRow struct {
	raceEventView
	CreatedAt domain.Timestamp `json:"created_at"`
	UpdatedAt domain.Timestamp `json:"updated_at"`
}

type raceAdminView struct {
	raceEventRow
	TrainingCount int `json:"training_count"`
	RacedCount    int `json:"raced_count"`
}

// memberEventView is a race plus the member's live entry and the entrant count.
type memberEventView struct {
	raceEventView
	MyEntryID    *string `json:"my_entry_id"`
	EntrantCount int     `json:"entrant_count"`
}

type memberEventRow struct {
	raceEventRow
	MyEntryID    *string `json:"my_entry_id"`
	EntrantCount int     `json:"entrant_count"`
}

type entrantView struct {
	ID         string           `json:"id"`
	CustomerID string           `json:"customer_id"`
	Name       *string          `json:"name" db:"-"`
	Phone      *string          `json:"phone" db:"-"`
	Division   string           `json:"division"`
	GoalSec    *int             `json:"goal_sec"`
	ResultSec  *int             `json:"result_sec"`
	Status     string           `json:"status"`
	CreatedAt  domain.Timestamp `json:"created_at"`
}

type memberRaceEntry struct {
	ID          string `json:"id"`
	RaceEventID string `json:"race_event_id"`
	Division    string `json:"division"`
	GoalSec     *int   `json:"goal_sec"`
	ResultSec   *int   `json:"result_sec"`
	Status      string `json:"status"`
}

type memberRaceView struct {
	memberRaceEntry
	CreatedAt domain.Timestamp `json:"created_at"`
	// The race row as jsonb, without created_at/updated_at.
	Event         json.RawMessage      `json:"event"`
	EventStartsAt time.Time            `json:"-"`
	DaysUntil     int                  `json:"days_until" db:"-"`
	PredictionSec *int                 `json:"prediction_sec" db:"-"`
	Analysis      *domain.RaceAnalysis `json:"analysis" db:"-"`
}

type raceOverview struct {
	PredictionSec     *int             `json:"prediction_sec"`
	BestSimulationSec *int             `json:"best_simulation_sec"`
	Readiness         int              `json:"readiness"`
	ActivitiesLast28d int              `json:"activities_last_28d"`
	MyRaces           []memberRaceView `json:"my_races"`
	Events            []memberEventRow `json:"events"`
}

type myRaces struct {
	MyRaces         []memberRaceView `json:"my_races"`
	Readiness       int              `json:"readiness"`
	SimulationCount int              `json:"simulation_count"`
}

type raceDetail struct {
	Event  memberEventView  `json:"event"`
	MyRace *memberRaceEntry `json:"my_race"`
}

// simulation is one completed full simulation (the prediction input).
type simulation struct {
	ActiveSec int
	EndedAt   *time.Time
}

/* ── Workouts ────────────────────────────────────────────────────────── */

type workoutView struct {
	ID                  string           `json:"id"`
	Type                string           `json:"type"`
	Division            string           `json:"division"`
	Blocks              json.RawMessage  `json:"blocks"`
	TotalTargetSec      int              `json:"total_target_sec"`
	ExcludedExerciseIDs []string         `json:"excluded_exercise_ids"`
	AvailableEquipment  []string         `json:"available_equipment"`
	CreatedAt           domain.Timestamp `json:"created_at"`
}

type workoutHistoryItem struct {
	workoutView
	Sessions json.RawMessage `json:"sessions"`
}

type workoutSessionView struct {
	ID            string               `json:"id"`
	WorkoutID     string               `json:"workout_id"`
	Status        string               `json:"status"`
	CurrentBlock  int                  `json:"current_block"`
	StartedAt     *domain.Timestamp    `json:"started_at"`
	EndedAt       *domain.Timestamp    `json:"ended_at"`
	PausedAt      *domain.Timestamp    `json:"paused_at"`
	BlockResults  []domain.BlockResult `json:"block_results"`
	PauseCount    int                  `json:"pause_count"`
	TotalPauseSec int                  `json:"total_pause_sec"`
	ActiveSec     int                  `json:"active_sec"`
	CreatedAt     domain.Timestamp     `json:"created_at"`
}

type workoutsPage struct {
	Stations  []stationOption      `json:"stations"`
	Exercises []exerciseOption     `json:"exercises"`
	Equipment []string             `json:"equipment"`
	Workouts  []workoutHistoryItem `json:"workouts"`
}

type stationOption struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Order     *int     `json:"order"`
	Equipment []string `json:"equipment"`
}

type exerciseOption struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Equipment []string `json:"equipment"`
}

type generatedWorkout struct {
	Workout               workoutView `json:"workout"`
	UnresolvedExerciseIDs []string    `json:"unresolved_exercise_ids"`
}

/* ── Incentives ──────────────────────────────────────────────────────── */

// schemeRow is a scheme with its name, coach name and last update.
type schemeRow struct {
	domain.IncentiveScheme
	Name      string           `json:"name"`
	CoachName *string          `json:"coachName" db:"-"`
	UpdatedAt domain.Timestamp `json:"updatedAt"`
}

type schemeForm struct {
	Schemes    []schemeRow    `json:"schemes"`
	Coaches    []CatalogEntry `json:"coaches"`
	ClassTypes []CatalogEntry `json:"class_types"`
}

type payoutRef struct {
	ID       string  `json:"id"`
	Status   string  `json:"status"`
	TotalIDR float64 `json:"totalIdr"`
}

// livePayout is a non-void payout of the statement month.
type livePayout struct {
	ID       string
	CoachID  string
	Status   string
	TotalIDR float64
}

type statementView struct {
	domain.CoachStatement
	CoachName  string     `json:"coachName"`
	SchemeName string     `json:"schemeName"`
	Payout     *payoutRef `json:"payout"`
}

type payoutListRow struct {
	ID               string            `json:"id"`
	CoachID          string            `json:"coach_id"`
	CoachName        string            `json:"coach_name" db:"-"`
	Month            string            `json:"month"`
	TotalIDR         float64           `json:"total_idr"`
	Status           string            `json:"status"`
	PaymentReference *string           `json:"payment_reference"`
	Note             *string           `json:"note"`
	Sessions         *int              `json:"sessions"`
	CreatedAt        domain.Timestamp  `json:"created_at"`
	ApprovedAt       *domain.Timestamp `json:"approved_at"`
	PaidAt           *domain.Timestamp `json:"paid_at"`
	VoidedAt         *domain.Timestamp `json:"voided_at"`
}

type payoutDetail struct {
	ID               string            `json:"id"`
	CoachID          string            `json:"coach_id"`
	CoachName        string            `json:"coach_name" db:"-"`
	Month            string            `json:"month"`
	Statement        json.RawMessage   `json:"statement"`
	TotalIDR         float64           `json:"total_idr"`
	Status           string            `json:"status"`
	PaymentReference *string           `json:"payment_reference"`
	Note             *string           `json:"note"`
	CreatedAt        domain.Timestamp  `json:"created_at"`
	ApprovedAt       *domain.Timestamp `json:"approved_at"`
	PaidAt           *domain.Timestamp `json:"paid_at"`
	VoidedAt         *domain.Timestamp `json:"voided_at"`
}
