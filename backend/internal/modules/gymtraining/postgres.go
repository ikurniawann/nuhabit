package gymtraining

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/platform/database"
)

// pgRepo implements Repository on the gym-training tables: gym.exercises,
// gym.substitution_rules, gym.workouts, gym.workout_sessions,
// gym.race_events, gym.member_races, gym.incentive_schemes,
// gym.incentive_scheme_rates and gym.coach_payouts. SQL is ported from
// frontend/src/lib/gym/*-server.ts and member-app/workout-server.ts.
type pgRepo struct {
	db   database.Querier
	pool *pgxpool.Pool // nil inside a transaction
}

func newPgRepo(pool *pgxpool.Pool) *pgRepo { return &pgRepo{db: pool, pool: pool} }

func (r *pgRepo) InTx(ctx context.Context, fn func(Repository) error) error {
	if r.pool == nil {
		return fn(r)
	}
	return database.WithTx(ctx, r.pool, func(tx pgx.Tx) error { return fn(&pgRepo{db: tx}) })
}

func collect[T any](ctx context.Context, q database.Querier, sql string, args ...any) ([]T, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[T])
	if out == nil {
		out = []T{}
	}
	return out, err
}

// one returns nil when the query has no row.
func one[T any](ctx context.Context, q database.Querier, sql string, args ...any) (*T, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	v, err := pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByPos[T])
	if database.IsNoRows(err) {
		return nil, nil
	}
	return v, err
}

// returningID runs an INSERT/UPDATE … RETURNING id; "" when no row came back.
func returningID(ctx context.Context, q database.Querier, sql string, args ...any) (string, error) {
	var id string
	err := q.QueryRow(ctx, sql, args...).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

func affected(ctx context.Context, q database.Querier, sql string, args ...any) (bool, error) {
	tag, err := q.Exec(ctx, sql, args...)
	return tag.RowsAffected() > 0, err
}

/* ── Exercise library ────────────────────────────────────────────────── */

type exerciseRow struct {
	ID                string
	Name              string
	Category          string
	Equipment         []string
	HyroxStationOrder *int
	Difficulty        int
	DefaultSpec       *domain.ExerciseSpec
	VideoURL          *string
}

func (r *pgRepo) Library(ctx context.Context) (library, error) {
	rows, err := collect[exerciseRow](ctx, r.db,
		`SELECT id, name, category, equipment, hyrox_station_order, difficulty, default_spec, video_url
		   FROM gym.exercises WHERE is_active ORDER BY hyrox_station_order NULLS LAST, name`)
	if err != nil {
		return library{}, err
	}
	lib := library{Exercises: make([]domain.Exercise, 0, len(rows))}
	for _, row := range rows {
		e := domain.Exercise{ID: row.ID, Name: row.Name, Category: row.Category, Equipment: row.Equipment,
			HyroxStationOrder: row.HyroxStationOrder, Difficulty: min(3, max(1, row.Difficulty)), VideoURL: row.VideoURL}
		if e.Equipment == nil {
			e.Equipment = []string{}
		}
		if row.DefaultSpec != nil {
			e.DefaultSpec = *row.DefaultSpec
		}
		lib.Exercises = append(lib.Exercises, e)
	}
	lib.Substitutions, err = collect[domain.SubstitutionRule](ctx, r.db,
		`SELECT s.original_exercise_id, s.alternative_exercise_id, s.similarity::float, s.volume_factor::float, s.conversion_note
		   FROM gym.substitution_rules s
		   JOIN gym.exercises o ON o.id = s.original_exercise_id AND o.is_active
		   JOIN gym.exercises a ON a.id = s.alternative_exercise_id AND a.is_active`)
	return lib, err
}

func (r *pgRepo) ExerciseAdmin(ctx context.Context) (exerciseAdmin, error) {
	var out exerciseAdmin
	var err error
	out.Exercises, err = collect[exerciseAdminView](ctx, r.db,
		`SELECT id, code, name, description, category, equipment, hyrox_station_order, difficulty, default_spec,
		        video_url, is_active, updated_at
		   FROM gym.exercises ORDER BY hyrox_station_order NULLS LAST, name`)
	if err != nil {
		return out, err
	}
	out.Substitutions, err = collect[substitutionAdminView](ctx, r.db,
		`SELECT s.id, s.original_exercise_id, o.name AS original_name, s.alternative_exercise_id, a.name AS alternative_name,
		        s.similarity::float AS similarity, s.volume_factor::float AS volume_factor, s.conversion_note
		   FROM gym.substitution_rules s
		   JOIN gym.exercises o ON o.id = s.original_exercise_id
		   JOIN gym.exercises a ON a.id = s.alternative_exercise_id
		  ORDER BY o.hyrox_station_order NULLS LAST, o.name, s.similarity DESC`)
	return out, err
}

func (r *pgRepo) SaveExercise(ctx context.Context, e exerciseInput) (string, error) {
	spec, err := json.Marshal(e.DefaultSpec)
	if err != nil {
		return "", err
	}
	args := []any{e.Code, e.Name, e.Description, e.Category, e.Equipment, e.HyroxStationOrder, e.Difficulty, string(spec), e.VideoURL, e.IsActive}
	if e.ID != nil {
		return returningID(ctx, r.db,
			`UPDATE gym.exercises SET code=$1, name=$2, description=$3, category=$4, equipment=$5::text[],
			        hyrox_station_order=$6, difficulty=$7, default_spec=$8::jsonb, video_url=$9, is_active=$10,
			        updated_at=now()
			  WHERE id=$11 RETURNING id`, append(args, *e.ID)...)
	}
	return returningID(ctx, r.db,
		`INSERT INTO gym.exercises (code, name, description, category, equipment, hyrox_station_order, difficulty,
		                            default_spec, video_url, is_active)
		 VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8::jsonb,$9,$10) RETURNING id`, args...)
}

func (r *pgRepo) DeleteExercise(ctx context.Context, id string) (bool, error) {
	return affected(ctx, r.db, `DELETE FROM gym.exercises WHERE id = $1`, id)
}

func (r *pgRepo) SaveSubstitution(ctx context.Context, s substitutionInput) (string, error) {
	return returningID(ctx, r.db,
		`INSERT INTO gym.substitution_rules (original_exercise_id, alternative_exercise_id, similarity, volume_factor, conversion_note)
		 SELECT $1, $2, $3, $4, $5
		  WHERE EXISTS (SELECT 1 FROM gym.exercises WHERE id = $1)
		    AND EXISTS (SELECT 1 FROM gym.exercises WHERE id = $2)
		 ON CONFLICT (original_exercise_id, alternative_exercise_id)
		 DO UPDATE SET similarity = EXCLUDED.similarity, volume_factor = EXCLUDED.volume_factor,
		               conversion_note = EXCLUDED.conversion_note
		 RETURNING id`,
		s.OriginalExerciseID, s.AlternativeExerciseID, s.Similarity, s.VolumeFactor, s.ConversionNote)
}

func (r *pgRepo) DeleteSubstitution(ctx context.Context, id string) (bool, error) {
	return affected(ctx, r.db, `DELETE FROM gym.substitution_rules WHERE id = $1`, id)
}

/* ── Workouts ────────────────────────────────────────────────────────── */

const workoutColumns = `id, type, division, blocks, total_target_sec, excluded_exercise_ids::text[], available_equipment, created_at`

func (r *pgRepo) InsertWorkout(ctx context.Context, customerID string, in generateInput, w domain.GeneratedWorkout) (workoutView, error) {
	blocks, err := json.Marshal(w.Blocks)
	if err != nil {
		return workoutView{}, err
	}
	row, err := one[workoutView](ctx, r.db,
		`INSERT INTO gym.workouts (customer_id, type, division, blocks, excluded_exercise_ids, available_equipment, total_target_sec)
		 VALUES ($1, $2, $3, $4::jsonb, $5::uuid[], $6::text[], $7)
		 RETURNING `+workoutColumns,
		customerID, in.Type, in.Division, string(blocks), w.ExcludedExerciseIDs, in.AvailableEquipment, w.TotalTargetSec)
	if err != nil {
		return workoutView{}, err
	}
	return *row, nil
}

func (r *pgRepo) WorkoutHistory(ctx context.Context, customerID string) ([]workoutHistoryItem, error) {
	return collect[workoutHistoryItem](ctx, r.db,
		`SELECT w.id, w.type, w.division, w.blocks, w.total_target_sec, w.excluded_exercise_ids::text[],
		        w.available_equipment, w.created_at,
		        COALESCE((
		          SELECT jsonb_agg(to_jsonb(s) - 'customer_id' - 'updated_at' ORDER BY s.created_at DESC)
		            FROM gym.workout_sessions s WHERE s.workout_id = w.id
		        ), '[]'::jsonb) AS sessions
		   FROM gym.workouts w
		  WHERE w.customer_id = $1
		  ORDER BY w.created_at DESC
		  LIMIT 20`, customerID)
}

func (r *pgRepo) MemberWorkout(ctx context.Context, customerID, workoutID string) (*workoutView, error) {
	return one[workoutView](ctx, r.db,
		`SELECT `+workoutColumns+` FROM gym.workouts WHERE id = $1 AND customer_id = $2`, workoutID, customerID)
}

func (r *pgRepo) LockWorkoutBlocks(ctx context.Context, customerID, workoutID string) ([]domain.WorkoutBlock, bool, error) {
	var blocks []domain.WorkoutBlock
	err := r.db.QueryRow(ctx, `SELECT blocks FROM gym.workouts WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
		workoutID, customerID).Scan(&blocks)
	if database.IsNoRows(err) {
		return nil, false, nil
	}
	return blocks, err == nil, err
}

func (r *pgRepo) SaveWorkoutBlocks(ctx context.Context, workoutID string, blocks []domain.WorkoutBlock) (workoutView, error) {
	raw, err := json.Marshal(blocks)
	if err != nil {
		return workoutView{}, err
	}
	row, err := one[workoutView](ctx, r.db,
		`UPDATE gym.workouts SET blocks = $2::jsonb WHERE id = $1 RETURNING `+workoutColumns, workoutID, string(raw))
	if err != nil {
		return workoutView{}, err
	}
	return *row, nil
}

/* ── Workout sessions ────────────────────────────────────────────────── */

const sessionColumns = `id, workout_id, status, current_block, started_at, ended_at, paused_at, block_results,
	pause_count, total_pause_sec, active_sec, created_at`

func (r *pgRepo) StartSession(ctx context.Context, customerID, workoutID string, s domain.SessionState) (*workoutSessionView, error) {
	return one[workoutSessionView](ctx, r.db,
		`INSERT INTO gym.workout_sessions (workout_id, customer_id, status, current_block, started_at)
		 SELECT w.id, w.customer_id, $3, $4, $5 FROM gym.workouts w WHERE w.id = $1 AND w.customer_id = $2
		 RETURNING `+sessionColumns,
		workoutID, customerID, s.Status, s.CurrentBlock, s.StartedAt)
}

func (r *pgRepo) MemberSession(ctx context.Context, customerID, sessionID string) (*workoutSessionView, error) {
	return one[workoutSessionView](ctx, r.db,
		`SELECT `+sessionColumns+` FROM gym.workout_sessions WHERE id = $1 AND customer_id = $2`, sessionID, customerID)
}

// lockedSession is a session row with its workout's block count.
type lockedSession struct {
	workoutSessionView
	TotalBlocks int
}

func (r *pgRepo) LockSession(ctx context.Context, customerID, sessionID string) (*lockedSession, error) {
	return one[lockedSession](ctx, r.db,
		`SELECT s.id, s.workout_id, s.status, s.current_block, s.started_at, s.ended_at, s.paused_at, s.block_results,
		        s.pause_count, s.total_pause_sec, s.active_sec, s.created_at,
		        jsonb_array_length(w.blocks)::int AS total_blocks
		   FROM gym.workout_sessions s JOIN gym.workouts w ON w.id = s.workout_id
		  WHERE s.id = $1 AND s.customer_id = $2
		  FOR UPDATE OF s`, sessionID, customerID)
}

func (r *pgRepo) SaveSession(ctx context.Context, sessionID string, s domain.SessionState) (workoutSessionView, error) {
	results, err := json.Marshal(s.BlockResults)
	if err != nil {
		return workoutSessionView{}, err
	}
	row, err := one[workoutSessionView](ctx, r.db,
		`UPDATE gym.workout_sessions
		    SET status = $2, current_block = $3, ended_at = $4, paused_at = $5, block_results = $6::jsonb,
		        pause_count = $7, total_pause_sec = $8, active_sec = $9, updated_at = now()
		  WHERE id = $1
		  RETURNING `+sessionColumns,
		sessionID, s.Status, s.CurrentBlock, s.EndedAt, s.PausedAt, string(results), s.PauseCount, s.TotalPauseSec,
		domain.SessionActiveSec(s.BlockResults))
	if err != nil {
		return workoutSessionView{}, err
	}
	return *row, nil
}

/* ── Member races ────────────────────────────────────────────────────── */

func (r *pgRepo) FullSimulations(ctx context.Context, customerID string) ([]simulation, error) {
	return collect[simulation](ctx, r.db,
		`SELECT s.active_sec, s.ended_at
		   FROM gym.workout_sessions s JOIN gym.workouts w ON w.id = s.workout_id
		  WHERE s.customer_id = $1 AND s.status = 'completed' AND w.type = 'FULL_SIMULATION' AND s.active_sec > 0`,
		customerID)
}

func (r *pgRepo) FinishedWorkoutTimes(ctx context.Context, customerID string, since time.Time) ([]time.Time, error) {
	rows, err := r.db.Query(ctx,
		`SELECT ended_at FROM gym.workout_sessions
		  WHERE customer_id = $1 AND status IN ('completed', 'partial') AND ended_at >= $2`, customerID, since)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[time.Time])
}

func (r *pgRepo) MemberRaces(ctx context.Context, customerID string) ([]memberRaceView, error) {
	return collect[memberRaceView](ctx, r.db,
		`SELECT r.id, r.race_event_id, r.division, r.goal_sec, r.result_sec, r.status, r.created_at,
		        to_jsonb(e) - 'created_at' - 'updated_at' AS event, e.starts_at
		   FROM gym.member_races r JOIN gym.race_events e ON e.id = r.race_event_id
		  WHERE r.customer_id = $1
		  ORDER BY (r.status = 'cancelled'), e.starts_at`, customerID)
}

func (r *pgRepo) OpenRaceEvents(ctx context.Context, customerID string, now time.Time) ([]memberEventRow, error) {
	return collect[memberEventRow](ctx, r.db,
		`SELECT e.id, e.name, e.country, e.region, e.city, e.venue, e.starts_at, e.ends_at, e.registration_url,
		        e.image_url, e.status, e.created_at, e.updated_at,
		        (SELECT r.id FROM gym.member_races r
		          WHERE r.race_event_id = e.id AND r.customer_id = $1 AND r.status <> 'cancelled' LIMIT 1) AS my_entry_id,
		        (SELECT count(*)::int FROM gym.member_races r
		          WHERE r.race_event_id = e.id AND r.status <> 'cancelled') AS entrant_count
		   FROM gym.race_events e
		  WHERE e.status NOT IN ('completed', 'cancelled') AND e.ends_at >= $2
		  ORDER BY e.starts_at`, customerID, now)
}

const memberEventSelect = `
	SELECT e.id, e.name, e.country, e.region, e.city, e.venue, e.starts_at, e.ends_at,
	       e.registration_url, e.image_url, e.status,
	       (SELECT r.id FROM gym.member_races r
	         WHERE r.race_event_id = e.id AND r.customer_id = $1 AND r.status <> 'cancelled' LIMIT 1) AS my_entry_id,
	       (SELECT count(*)::int FROM gym.member_races r
	         WHERE r.race_event_id = e.id AND r.status <> 'cancelled') AS entrant_count
	  FROM gym.race_events e`

func (r *pgRepo) RaceCalendar(ctx context.Context, customerID string, results bool, region *string) ([]memberEventView, error) {
	scope := `e.status <> 'completed' ORDER BY e.starts_at`
	if results {
		scope = `e.status = 'completed' ORDER BY e.starts_at DESC`
	}
	return collect[memberEventView](ctx, r.db,
		memberEventSelect+` WHERE ($2::text IS NULL OR e.region = $2) AND `+scope, customerID, region)
}

func (r *pgRepo) RaceEvent(ctx context.Context, customerID, raceEventID string) (*memberEventView, error) {
	return one[memberEventView](ctx, r.db, memberEventSelect+` WHERE e.id = $2`, customerID, raceEventID)
}

func (r *pgRepo) LiveMemberRace(ctx context.Context, customerID, raceEventID string) (*memberRaceEntry, error) {
	return one[memberRaceEntry](ctx, r.db,
		`SELECT id, race_event_id, division, goal_sec, result_sec, status
		   FROM gym.member_races WHERE customer_id = $1 AND race_event_id = $2 AND status <> 'cancelled' LIMIT 1`,
		customerID, raceEventID)
}

func (r *pgRepo) RaceEventStatus(ctx context.Context, raceEventID string) (string, bool, error) {
	var status string
	err := r.db.QueryRow(ctx, `SELECT status FROM gym.race_events WHERE id = $1`, raceEventID).Scan(&status)
	if database.IsNoRows(err) {
		return "", false, nil
	}
	return status, err == nil, err
}

// entryState is a member race id with its status.
type entryState struct {
	ID     string
	Status string
}

func (r *pgRepo) LockLatestMemberRace(ctx context.Context, customerID, raceEventID string) (*entryState, error) {
	return one[entryState](ctx, r.db,
		`SELECT id, status FROM gym.member_races WHERE customer_id = $1 AND race_event_id = $2
		  ORDER BY (status = 'cancelled'), created_at DESC LIMIT 1 FOR UPDATE`, customerID, raceEventID)
}

func (r *pgRepo) ReviveMemberRace(ctx context.Context, entryID, division string, goalSec *int) (string, error) {
	return returningID(ctx, r.db,
		`UPDATE gym.member_races SET status = 'training', division = $2, goal_sec = $3, result_sec = NULL, updated_at = now()
		  WHERE id = $1 RETURNING id`, entryID, division, goalSec)
}

func (r *pgRepo) InsertMemberRace(ctx context.Context, customerID, raceEventID, division string, goalSec *int) (string, error) {
	return returningID(ctx, r.db,
		`INSERT INTO gym.member_races (customer_id, race_event_id, division, goal_sec) VALUES ($1, $2, $3, $4) RETURNING id`,
		customerID, raceEventID, division, goalSec)
}

func (r *pgRepo) LockMemberRaceStatus(ctx context.Context, customerID, entryID string) (string, bool, error) {
	var status string
	err := r.db.QueryRow(ctx, `SELECT status FROM gym.member_races WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
		entryID, customerID).Scan(&status)
	if database.IsNoRows(err) {
		return "", false, nil
	}
	return status, err == nil, err
}

func (r *pgRepo) ApplyMemberRacePatch(ctx context.Context, entryID string, p domain.MemberRacePatch) error {
	_, err := r.db.Exec(ctx,
		`UPDATE gym.member_races SET status = $2,
		        division = COALESCE($3, division),
		        goal_sec = CASE WHEN $4::boolean THEN $5::int ELSE goal_sec END,
		        result_sec = COALESCE($6::int, result_sec),
		        updated_at = now()
		  WHERE id = $1`,
		entryID, p.Status, p.Division, p.GoalSet, p.GoalSec, p.ResultSec)
	return err
}

/* ── Race admin ──────────────────────────────────────────────────────── */

func (r *pgRepo) RaceEventsAdmin(ctx context.Context) ([]raceAdminView, error) {
	return collect[raceAdminView](ctx, r.db,
		`SELECT e.id, e.name, e.country, e.region, e.city, e.venue, e.starts_at, e.ends_at, e.registration_url,
		        e.image_url, e.status, e.created_at, e.updated_at,
		        count(r.*) FILTER (WHERE r.status = 'training')::int AS training_count,
		        count(r.*) FILTER (WHERE r.status = 'raced')::int AS raced_count
		   FROM gym.race_events e LEFT JOIN gym.member_races r ON r.race_event_id = e.id
		  GROUP BY e.id
		  ORDER BY (e.ends_at < now()), e.starts_at`)
}

func (r *pgRepo) SaveRaceEvent(ctx context.Context, in raceInput) (string, error) {
	args := []any{in.Name, in.Country, in.Region, in.City, in.Venue, in.StartsAt, in.EndsAt, in.RegistrationURL, in.ImageURL, in.Status}
	if in.ID != nil {
		return returningID(ctx, r.db,
			`UPDATE gym.race_events SET name=$1, country=$2, region=$3, city=$4, venue=$5, starts_at=$6::timestamptz,
			        ends_at=$7::timestamptz, registration_url=$8, image_url=$9, status=$10, updated_at=now()
			  WHERE id=$11 RETURNING id`, append(args, *in.ID)...)
	}
	return returningID(ctx, r.db,
		`INSERT INTO gym.race_events (name, country, region, city, venue, starts_at, ends_at, registration_url, image_url, status)
		 VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10) RETURNING id`, args...)
}

// DeleteRaceEvent deletes a race without entrants and cancels one with
// entrants; "" when the race does not exist.
func (r *pgRepo) DeleteRaceEvent(ctx context.Context, id string) (string, error) {
	var outcome string
	err := r.db.QueryRow(ctx,
		`WITH entrants AS (SELECT count(*) AS n FROM gym.member_races WHERE race_event_id = $1),
		      removed AS (
		        DELETE FROM gym.race_events WHERE id = $1 AND (SELECT n FROM entrants) = 0 RETURNING 'deleted'::text AS outcome
		      ),
		      cancelled AS (
		        UPDATE gym.race_events SET status = 'cancelled', updated_at = now()
		         WHERE id = $1 AND (SELECT n FROM entrants) > 0 RETURNING 'cancelled'::text AS outcome
		      )
		 SELECT outcome FROM removed UNION ALL SELECT outcome FROM cancelled`, id).Scan(&outcome)
	if database.IsNoRows(err) {
		return "", nil
	}
	return outcome, err
}

func (r *pgRepo) RaceEntrants(ctx context.Context, raceID string) ([]entrantView, error) {
	return collect[entrantView](ctx, r.db,
		`SELECT r.id, r.customer_id, r.division, r.goal_sec, r.result_sec, r.status, r.created_at
		   FROM gym.member_races r
		  WHERE r.race_event_id = $1
		  ORDER BY (r.status = 'cancelled'), r.result_sec NULLS LAST, r.created_at`, raceID)
}

/* ── Incentive schemes ───────────────────────────────────────────────── */

// Schemes lists every scheme with its class-type rates, default first, then
// in coachOrder (coach ids sorted by name, from the coach directory).
func (r *pgRepo) Schemes(ctx context.Context, coachOrder []string) ([]schemeRow, error) {
	return collect[schemeRow](ctx, r.db,
		`SELECT s.id, s.coach_id, s.is_default,
		        s.session_fee_idr::float, s.per_attendee_idr::float, s.full_class_bonus_idr::float,
		        s.full_class_threshold_percent, s.no_show_penalty_idr::float,
		        COALESCE((
		          SELECT jsonb_agg(jsonb_build_object(
		                   'classTypeId', r.class_type_id,
		                   'sessionFeeIdr', r.session_fee_idr::float,
		                   'perAttendeeIdr', r.per_attendee_idr::float) ORDER BY r.created_at)
		            FROM gym.incentive_scheme_rates r WHERE r.scheme_id = s.id
		        ), '[]'::jsonb) AS rates,
		        s.is_active, s.name, s.updated_at
		   FROM gym.incentive_schemes s
		  ORDER BY s.is_default DESC, array_position($1::uuid[], s.coach_id)`, coachOrder)
}

func (r *pgRepo) SaveScheme(ctx context.Context, s schemeInput, actorID string) (string, error) {
	isDefault := s.CoachID == nil
	isActive := s.IsActive || isDefault
	args := []any{s.Name, s.CoachID, isDefault, s.SessionFeeIDR, s.PerAttendeeIDR, s.FullClassBonusIDR,
		s.FullClassThresholdPercent, s.NoShowPenaltyIDR, isActive, actorID}
	var id string
	var err error
	if s.ID != nil {
		id, err = returningID(ctx, r.db,
			`UPDATE gym.incentive_schemes SET name=$1, coach_id=$2, is_default=$3, session_fee_idr=$4,
			        per_attendee_idr=$5, full_class_bonus_idr=$6, full_class_threshold_percent=$7,
			        no_show_penalty_idr=$8, is_active=$9, updated_by=$10, updated_at=now()
			  WHERE id=$11 RETURNING id`, append(args, *s.ID)...)
	} else {
		id, err = returningID(ctx, r.db,
			`INSERT INTO gym.incentive_schemes (name, coach_id, is_default, session_fee_idr, per_attendee_idr,
			        full_class_bonus_idr, full_class_threshold_percent, no_show_penalty_idr, is_active, updated_by)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, args...)
	}
	if err != nil || id == "" {
		return id, err
	}
	if _, err := r.db.Exec(ctx, `DELETE FROM gym.incentive_scheme_rates WHERE scheme_id = $1`, id); err != nil {
		return "", err
	}
	if len(s.Rates) > 0 {
		rates, err := json.Marshal(s.Rates)
		if err != nil {
			return "", err
		}
		_, err = r.db.Exec(ctx,
			`INSERT INTO gym.incentive_scheme_rates (scheme_id, class_type_id, session_fee_idr, per_attendee_idr)
			 SELECT $1, r.class_type_id, r.session_fee_idr, r.per_attendee_idr
			   FROM jsonb_to_recordset($2::jsonb) AS r(class_type_id uuid, session_fee_idr numeric, per_attendee_idr numeric)`,
			id, string(rates))
		if err != nil {
			return "", err
		}
	}
	return id, nil
}

func (r *pgRepo) DeleteScheme(ctx context.Context, id string) (bool, error) {
	return affected(ctx, r.db, `DELETE FROM gym.incentive_schemes WHERE id = $1 AND NOT is_default`, id)
}

/* ── Payouts ─────────────────────────────────────────────────────────── */

func (r *pgRepo) LivePayouts(ctx context.Context, periodMonth string) ([]livePayout, error) {
	return collect[livePayout](ctx, r.db,
		`SELECT id, coach_id, status, total_idr::float AS total_idr FROM gym.coach_payouts
		  WHERE period_month = $1::date AND status <> 'void'`, periodMonth+"-01")
}

// Payouts lists payouts newest period first, void last, then in coachOrder.
func (r *pgRepo) Payouts(ctx context.Context, month *string, coachOrder []string) ([]payoutListRow, error) {
	return collect[payoutListRow](ctx, r.db,
		`SELECT p.id, p.coach_id, to_char(p.period_month, 'YYYY-MM') AS month,
		        p.total_idr::float AS total_idr, p.status, p.payment_reference, p.note,
		        (p.statement->'totals'->>'sessions')::int AS sessions,
		        p.created_at, p.approved_at, p.paid_at, p.voided_at
		   FROM gym.coach_payouts p
		  WHERE ($1::text IS NULL OR p.period_month = ($1 || '-01')::date)
		  ORDER BY p.period_month DESC, (p.status = 'void'), array_position($2::uuid[], p.coach_id)
		  LIMIT 200`, month, coachOrder)
}

func (r *pgRepo) Payout(ctx context.Context, id string) (*payoutDetail, error) {
	return one[payoutDetail](ctx, r.db,
		`SELECT p.id, p.coach_id, to_char(p.period_month, 'YYYY-MM') AS month, p.statement,
		        p.total_idr::float AS total_idr, p.status, p.payment_reference, p.note,
		        p.created_at, p.approved_at, p.paid_at, p.voided_at
		   FROM gym.coach_payouts p
		  WHERE p.id = $1`, id)
}

// InsertPayout freezes a statement; "" when a live payout already exists for
// the coach and month (partial unique index).
func (r *pgRepo) InsertPayout(ctx context.Context, coachID, periodMonth string, statement any, totalIDR float64, userID string) (string, error) {
	raw, err := json.Marshal(statement)
	if err != nil {
		return "", err
	}
	return returningID(ctx, r.db,
		`INSERT INTO gym.coach_payouts (coach_id, period_month, statement, total_idr, created_by)
		 VALUES ($1, $2::date, $3::jsonb, $4, $5)
		 ON CONFLICT (coach_id, period_month) WHERE status <> 'void' DO NOTHING
		 RETURNING id`, coachID, periodMonth+"-01", string(raw), totalIDR, userID)
}

func (r *pgRepo) LockPayoutStatus(ctx context.Context, id string) (string, bool, error) {
	var status string
	err := r.db.QueryRow(ctx, `SELECT status FROM gym.coach_payouts WHERE id = $1 FOR UPDATE`, id).Scan(&status)
	if database.IsNoRows(err) {
		return "", false, nil
	}
	return status, err == nil, err
}

func (r *pgRepo) ApplyPayoutDecision(ctx context.Context, id, userID string, d domain.PayoutDecision) error {
	_, err := r.db.Exec(ctx,
		`UPDATE gym.coach_payouts SET
		    status = $2,
		    approved_by = CASE WHEN $2 = 'approved' THEN $3::uuid ELSE approved_by END,
		    approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END,
		    paid_by = CASE WHEN $2 = 'paid' THEN $3::uuid ELSE paid_by END,
		    paid_at = CASE WHEN $2 = 'paid' THEN now() ELSE paid_at END,
		    payment_reference = COALESCE($4, payment_reference),
		    voided_by = CASE WHEN $2 = 'void' THEN $3::uuid ELSE voided_by END,
		    voided_at = CASE WHEN $2 = 'void' THEN now() ELSE voided_at END,
		    note = COALESCE($5, note),
		    updated_at = now()
		  WHERE id = $1`, id, d.Status, userID, d.PaymentReference, d.Note)
	return err
}
