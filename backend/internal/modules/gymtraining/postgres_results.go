package gymtraining

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/platform/database"
)

// HYROX results on gym.hyrox_results. Leaderboard privacy reads
// show_on_leaderboard from gym.athlete_settings (the member app settings,
// owned by the athlete module) the way gym-scheduling reads
// booking_reminders.

const resultSelect = `
	SELECT r.id, r.customer_id, r.source, r.race_event_id, e.name, r.workout_session_id, r.member_race_id,
	       r.division, r.age_group, r.run_sec, r.station_sec, r.roxzone_sec, r.official_total_sec,
	       r.splits_total_sec, r.total_sec, r.total_mismatch, r.raced_at, r.notified_prs,
	       r.verified_at IS NOT NULL, r.verified_at, r.created_at
	  FROM gym.hyrox_results r LEFT JOIN gym.race_events e ON e.id = r.race_event_id`

// raceForResult is a calendar race as a new result needs it.
type raceForResult struct {
	Name     string
	Status   string
	StartsAt time.Time
}

func (r *pgRepo) RaceForResult(ctx context.Context, raceEventID string) (*raceForResult, error) {
	return one[raceForResult](ctx, r.db, `SELECT name, status, starts_at FROM gym.race_events WHERE id = $1`, raceEventID)
}

// simulationSession is a member's workout session with its workout.
type simulationSession struct {
	ID           string
	Status       string
	Type         string
	Division     string
	EndedAt      *time.Time
	ActiveSec    int
	Blocks       []domain.WorkoutBlock
	BlockResults []domain.BlockResult
}

const simulationSelect = `
	SELECT s.id, s.status, w.type, w.division, s.ended_at, s.active_sec, w.blocks, s.block_results
	  FROM gym.workout_sessions s JOIN gym.workouts w ON w.id = s.workout_id`

func (r *pgRepo) SimulationSession(ctx context.Context, customerID, sessionID string) (*simulationSession, error) {
	return one[simulationSession](ctx, r.db, simulationSelect+` WHERE s.id = $1 AND s.customer_id = $2`, sessionID, customerID)
}

// OpenSimulations: completed full simulations without a result, newest first.
func (r *pgRepo) OpenSimulations(ctx context.Context, customerID string) ([]simulationSession, error) {
	return collect[simulationSession](ctx, r.db, simulationSelect+`
		WHERE s.customer_id = $1 AND s.status = 'completed' AND w.type = 'FULL_SIMULATION'
		  AND NOT EXISTS (SELECT 1 FROM gym.hyrox_results h WHERE h.workout_session_id = s.id)
		ORDER BY s.ended_at DESC LIMIT 20`, customerID)
}

// OpenResultRaces: started, not cancelled races the member has no result
// for, newest first, with the division of their live entry.
func (r *pgRepo) OpenResultRaces(ctx context.Context, customerID string, now time.Time) ([]resultRaceOption, error) {
	return collect[resultRaceOption](ctx, r.db,
		`SELECT e.id, e.name, e.city, e.starts_at,
		        (SELECT m.division FROM gym.member_races m
		          WHERE m.race_event_id = e.id AND m.customer_id = $1 AND m.status <> 'cancelled' LIMIT 1)
		   FROM gym.race_events e
		  WHERE e.status <> 'cancelled' AND e.starts_at <= $2
		    AND NOT EXISTS (SELECT 1 FROM gym.hyrox_results h
		                     WHERE h.race_event_id = e.id AND h.customer_id = $1 AND h.source = 'race')
		  ORDER BY e.starts_at DESC LIMIT 30`, customerID, now)
}

// LockLiveMemberRace is the member's non-cancelled entry for a race.
func (r *pgRepo) LockLiveMemberRace(ctx context.Context, customerID, raceEventID string) (*string, error) {
	var id string
	err := r.db.QueryRow(ctx,
		`SELECT id FROM gym.member_races WHERE customer_id = $1 AND race_event_id = $2 AND status <> 'cancelled'
		  LIMIT 1 FOR UPDATE`, customerID, raceEventID).Scan(&id)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &id, err
}

func (r *pgRepo) InsertResult(ctx context.Context, customerID string, in resultInput, memberRaceID *string, totals domain.Totals, racedAt time.Time) (string, error) {
	return returningID(ctx, r.db,
		`INSERT INTO gym.hyrox_results (customer_id, source, race_event_id, member_race_id, workout_session_id, division,
		        age_group, run_sec, station_sec, roxzone_sec, official_total_sec, splits_total_sec, total_sec,
		        total_mismatch, raced_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::int[], $9::int[], $10, $11, $12, $13, $14, $15)
		 RETURNING id`,
		customerID, in.Source, in.RaceEventID, memberRaceID, in.WorkoutSessionID, in.Division, in.AgeGroup,
		in.Splits.Runs[:], in.Splits.Stations[:], in.Splits.Roxzone, in.OfficialTotalSec, totals.SplitsTotalSec, totals.TotalSec,
		totals.Mismatch, racedAt)
}

func (r *pgRepo) LockResult(ctx context.Context, customerID, id string) (*resultView, error) {
	return one[resultView](ctx, r.db, resultSelect+` WHERE r.id = $1 AND r.customer_id = $2 FOR UPDATE OF r`, id, customerID)
}

func (r *pgRepo) MemberResult(ctx context.Context, customerID, id string) (*resultView, error) {
	return one[resultView](ctx, r.db, resultSelect+` WHERE r.id = $1 AND r.customer_id = $2`, id, customerID)
}

// UpdateResult saves a member's edit; the result needs verifying again.
func (r *pgRepo) UpdateResult(ctx context.Context, id string, in resultFields, totals domain.Totals) error {
	_, err := r.db.Exec(ctx,
		`UPDATE gym.hyrox_results
		    SET division = $2, age_group = $3, run_sec = $4::int[], station_sec = $5::int[], roxzone_sec = $6,
		        official_total_sec = $7, splits_total_sec = $8, total_sec = $9, total_mismatch = $10,
		        verified_at = NULL, verified_by = NULL, updated_at = now()
		  WHERE id = $1`,
		id, in.Division, in.AgeGroup, in.Splits.Runs[:], in.Splits.Stations[:], in.Splits.Roxzone, in.OfficialTotalSec,
		totals.SplitsTotalSec, totals.TotalSec, totals.Mismatch)
	return err
}

// SetMemberRaceResult marks the race entry raced with the result's total.
func (r *pgRepo) SetMemberRaceResult(ctx context.Context, memberRaceID string, totalSec int) error {
	_, err := r.db.Exec(ctx,
		`UPDATE gym.member_races SET status = 'raced', result_sec = $2, updated_at = now() WHERE id = $1`,
		memberRaceID, totalSec)
	return err
}

// InsertEntryResult copies a race entry's logged total as a total-only
// result; nothing happens when the race already has the member's result.
func (r *pgRepo) InsertEntryResult(ctx context.Context, entryID string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO gym.hyrox_results (customer_id, source, race_event_id, member_race_id, division,
		        official_total_sec, total_sec, raced_at)
		 SELECT m.customer_id, 'race', m.race_event_id, m.id, m.division, m.result_sec, m.result_sec, e.starts_at
		   FROM gym.member_races m JOIN gym.race_events e ON e.id = m.race_event_id
		  WHERE m.id = $1 AND m.result_sec IS NOT NULL
		 ON CONFLICT DO NOTHING`, entryID)
	return err
}

func (r *pgRepo) SetNotifiedPRs(ctx context.Context, id string, keys []string) error {
	_, err := r.db.Exec(ctx, `UPDATE gym.hyrox_results SET notified_prs = $2 WHERE id = $1`, id, keys)
	return err
}

// MemberResults lists a member's results, newest race first; one division
// only when division is set.
func (r *pgRepo) MemberResults(ctx context.Context, customerID string, division *string) ([]resultView, error) {
	return collect[resultView](ctx, r.db, resultSelect+`
		WHERE r.customer_id = $1 AND ($2::text IS NULL OR r.division = $2)
		ORDER BY r.raced_at DESC, r.created_at DESC`, customerID, division)
}

// DivisionResults is every result in a division (the gym average).
func (r *pgRepo) DivisionResults(ctx context.Context, division string) ([]resultView, error) {
	return collect[resultView](ctx, r.db, resultSelect+` WHERE r.division = $1`, division)
}

func (r *pgRepo) BoardCandidates(ctx context.Context) ([]boardCandidateRow, error) {
	return collect[boardCandidateRow](ctx, r.db,
		`SELECT r.id, r.customer_id, r.source, r.race_event_id, e.name, r.division, r.age_group, r.total_sec,
		        r.station_sec, r.raced_at, r.verified_at IS NOT NULL, COALESCE(s.show_on_leaderboard, true)
		   FROM gym.hyrox_results r
		   LEFT JOIN gym.race_events e ON e.id = r.race_event_id
		   LEFT JOIN gym.athlete_settings s ON s.customer_id = r.customer_id`)
}

// ShowsOnLeaderboard is the member's leaderboard choice (on by default).
func (r *pgRepo) ShowsOnLeaderboard(ctx context.Context, customerID string) (bool, error) {
	var show bool
	err := r.db.QueryRow(ctx,
		`SELECT COALESCE((SELECT show_on_leaderboard FROM gym.athlete_settings WHERE customer_id = $1), true)`,
		customerID).Scan(&show)
	return show, err
}

// ResultsAdmin lists results for staff, unverified first, then newest.
// verified filters when set.
func (r *pgRepo) ResultsAdmin(ctx context.Context, raceEventID *string, verified *bool) ([]resultAdminView, error) {
	return collect[resultAdminView](ctx, r.db,
		`SELECT r.id, r.customer_id, r.source, r.race_event_id, e.name, r.workout_session_id, r.member_race_id,
		        r.division, r.age_group, r.run_sec, r.station_sec, r.roxzone_sec, r.official_total_sec,
		        r.splits_total_sec, r.total_sec, r.total_mismatch, r.raced_at, r.notified_prs,
		        r.verified_at IS NOT NULL, r.verified_at, r.created_at,
		        COALESCE(s.show_on_leaderboard, true)
		   FROM gym.hyrox_results r
		   LEFT JOIN gym.race_events e ON e.id = r.race_event_id
		   LEFT JOIN gym.athlete_settings s ON s.customer_id = r.customer_id
		  WHERE ($1::uuid IS NULL OR r.race_event_id = $1)
		    AND ($2::boolean IS NULL OR (r.verified_at IS NOT NULL) = $2)
		  ORDER BY (r.verified_at IS NOT NULL), r.raced_at DESC, r.created_at DESC
		  LIMIT 300`, raceEventID, verified)
}

// VerifyResult sets or clears the verification; false when the result does
// not exist.
func (r *pgRepo) VerifyResult(ctx context.Context, id, userID string, verified bool) (bool, error) {
	return affected(ctx, r.db,
		`UPDATE gym.hyrox_results
		    SET verified_at = CASE WHEN $3 THEN COALESCE(verified_at, now()) END,
		        verified_by = CASE WHEN $3 THEN COALESCE(verified_by, $2::uuid) END,
		        updated_at = now()
		  WHERE id = $1`, id, userID, verified)
}
