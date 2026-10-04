package athlete

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/modules/athlete/domain"
	"nuhabit/backend/internal/platform/database"
)

// pgRepository implements Repository on the gym.athlete_* tables with the SQL
// of frontend/src/lib/gym/athlete-*.ts. Timestamps are truncated to
// milliseconds, the precision of the JavaScript Dates the TS worked with.
type pgRepository struct {
	pool *pgxpool.Pool
	q    database.Querier
}

func newPgRepository(pool *pgxpool.Pool) *pgRepository { return &pgRepository{pool: pool, q: pool} }

func (r *pgRepository) InTx(ctx context.Context, fn func(Repository) error) error {
	return database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		return fn(&pgRepository{pool: r.pool, q: tx})
	})
}

// jsTime truncates to the millisecond precision of a JavaScript Date.
func jsTime(t time.Time) time.Time { return t.Truncate(time.Millisecond) }

func jsonText(v any) (string, error) {
	b, err := json.Marshal(v)
	return string(b), err
}

// collect scans every row with scan and returns a non-nil slice.
func collect[T any](rows pgx.Rows, err error, scan func(pgx.Rows) (T, error)) ([]T, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (r *pgRepository) exec(ctx context.Context, sql string, args ...any) (int64, error) {
	tag, err := r.q.Exec(ctx, sql, args...)
	return tag.RowsAffected(), err
}

// ── Activities ───────────────────────────────────────────────────────────────

const summaryColumns = `a.id, a.customer_id, a.type, a.title, a.description, a.started_at, a.elapsed_sec,
  a.moving_sec, a.distance_m, a.avg_pace_sec_per_km, a.elevation_gain_m, a.visibility, a.gear_id,
  jsonb_array_length(a.photos)::int AS photo_count`
const fullColumns = summaryColumns + `, a.points, a.photos`

func (r *pgRepository) selectActivities(ctx context.Context, where string, full bool, args ...any) ([]domain.Activity, error) {
	columns := summaryColumns
	if full {
		columns = fullColumns
	}
	rows, err := r.q.Query(ctx, `SELECT `+columns+` FROM gym.athlete_activities a `+where, args...)
	return collect(rows, err, func(row pgx.Rows) (domain.Activity, error) {
		var a domain.Activity
		dest := []any{&a.ID, &a.MemberID, &a.Type, &a.Title, &a.Description, &a.StartedAt, &a.ElapsedSec,
			&a.MovingSec, &a.DistanceM, &a.AvgPaceSecPerKm, &a.ElevationGainM, &a.Visibility, &a.GearID, &a.PhotoCount}
		if full {
			dest = append(dest, &a.Points, &a.Photos)
		}
		if err := row.Scan(dest...); err != nil {
			return a, err
		}
		a.StartedAt = jsTime(a.StartedAt)
		if a.Points == nil {
			a.Points = []domain.TrackPoint{}
		}
		if a.Photos == nil {
			a.Photos = []string{}
		}
		return a, nil
	})
}

func (r *pgRepository) MemberActivities(ctx context.Context, customerID string, full bool) ([]domain.Activity, error) {
	return r.selectActivities(ctx, "WHERE a.customer_id = $1 ORDER BY a.started_at DESC", full, customerID)
}

func (r *pgRepository) RecentSummaries(ctx context.Context, limit int) ([]domain.Activity, error) {
	return r.selectActivities(ctx, "ORDER BY a.started_at DESC LIMIT $1", false, limit)
}

func (r *pgRepository) Activity(ctx context.Context, id string) (*domain.Activity, error) {
	list, err := r.selectActivities(ctx, "WHERE a.id = $1", true, id)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

func (r *pgRepository) PointsByID(ctx context.Context, ids []string) (map[string][]domain.TrackPoint, error) {
	type row struct {
		id     string
		points []domain.TrackPoint
	}
	rows, err := r.q.Query(ctx, `SELECT id, points FROM gym.athlete_activities WHERE id = ANY($1::uuid[])`, ids)
	list, err := collect(rows, err, func(rs pgx.Rows) (row, error) {
		var v row
		return v, rs.Scan(&v.id, &v.points)
	})
	out := make(map[string][]domain.TrackPoint, len(list))
	for _, v := range list {
		out[v.id] = v.points
	}
	return out, err
}

func (r *pgRepository) InsertActivity(ctx context.Context, customerID string, in SaveActivityInput, title string, startedAt time.Time, f domain.ActivityFigures) (string, error) {
	points, err := jsonText(in.Points)
	if err != nil {
		return "", err
	}
	photos, err := jsonText(in.Photos)
	if err != nil {
		return "", err
	}
	var id string
	err = r.q.QueryRow(ctx,
		`INSERT INTO gym.athlete_activities
         (customer_id, type, title, description, started_at, elapsed_sec, moving_sec, distance_m,
          avg_pace_sec_per_km, elevation_gain_m, points, photos, visibility, gear_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14)
       RETURNING id`,
		customerID, in.Type, title, jsTrim(in.Description), startedAt, f.ElapsedSec, f.MovingSec, f.DistanceM,
		f.AvgPaceSecPerKm, f.ElevationGainM, points, photos, in.Visibility, in.GearID,
	).Scan(&id)
	return id, err
}

func (r *pgRepository) UpdateActivity(ctx context.Context, id, title, description, visibility string, gearID *string) error {
	_, err := r.exec(ctx,
		`UPDATE gym.athlete_activities
          SET title = $2, description = $3, visibility = $4, gear_id = $5, updated_at = now()
        WHERE id = $1`, id, title, description, visibility, gearID)
	return err
}

func (r *pgRepository) DeleteActivity(ctx context.Context, id string) error {
	_, err := r.exec(ctx, `DELETE FROM gym.athlete_activities WHERE id = $1`, id)
	return err
}

func (r *pgRepository) InsertWorkoutActivity(ctx context.Context, s CompletedWorkoutSession) error {
	_, err := r.exec(ctx,
		`INSERT INTO gym.athlete_activities
         (customer_id, type, title, started_at, elapsed_sec, moving_sec, distance_m, visibility, source_type, source_id)
       VALUES ($1, 'WORKOUT', $2, $3, $4, $5, $6, 'EVERYONE', 'workout_session', $7)
       ON CONFLICT DO NOTHING`,
		s.CustomerID, domain.WorkoutActivityTitle(s.WorkoutType), s.StartedAt,
		s.ActiveSec+s.TotalPauseSec, s.ActiveSec, domain.WorkoutRunDistanceM(s.Blocks), s.ID)
	return err
}

func (r *pgRepository) GroupCandidates(ctx context.Context, a domain.Activity, limit int) ([]domain.GroupCandidate, error) {
	rows, err := r.q.Query(ctx,
		`SELECT id, customer_id, type, started_at, points->0 AS start
       FROM gym.athlete_activities
      WHERE type = $1 AND customer_id <> $2 AND started_at BETWEEN $3::timestamptz - interval '1 hour'
                                                                AND $3::timestamptz + interval '1 hour'
      ORDER BY started_at DESC LIMIT $4`, a.Type, a.MemberID, a.StartedAt, limit)
	return collect(rows, err, func(rs pgx.Rows) (domain.GroupCandidate, error) {
		var c domain.GroupCandidate
		err := rs.Scan(&c.ID, &c.MemberID, &c.Type, &c.StartedAt, &c.Start)
		c.StartedAt = jsTime(c.StartedAt)
		return c, err
	})
}

func (r *pgRepository) HeatmapTracks(ctx context.Context, customerID string) ([][]domain.TrackPoint, error) {
	rows, err := r.q.Query(ctx,
		`SELECT points FROM gym.athlete_activities
      WHERE customer_id = $1 AND jsonb_array_length(points) > 1 ORDER BY started_at DESC`, customerID)
	return collect(rows, err, func(rs pgx.Rows) ([]domain.TrackPoint, error) {
		var points []domain.TrackPoint
		return points, rs.Scan(&points)
	})
}

func (r *pgRepository) CardCounts(ctx context.Context, ids []string, viewerID string) (map[string]CardCounts, error) {
	type row struct {
		id string
		CardCounts
	}
	rows, err := r.q.Query(ctx,
		`SELECT x.id,
              (SELECT count(*) FROM gym.athlete_kudos k WHERE k.activity_id = x.id)::int AS kudos,
              EXISTS (SELECT 1 FROM gym.athlete_kudos k WHERE k.activity_id = x.id AND k.customer_id = $2) AS kudoed,
              (SELECT count(*) FROM gym.athlete_activity_comments c WHERE c.activity_id = x.id)::int AS comments
         FROM unnest($1::uuid[]) AS x(id)`, ids, viewerID)
	list, err := collect(rows, err, func(rs pgx.Rows) (row, error) {
		var v row
		return v, rs.Scan(&v.id, &v.Kudos, &v.Kudoed, &v.Comments)
	})
	out := make(map[string]CardCounts, len(list))
	for _, v := range list {
		out[v.id] = v.CardCounts
	}
	return out, err
}

// ── Social graph ─────────────────────────────────────────────────────────────

func (r *pgRepository) ids(ctx context.Context, sql string, args ...any) ([]string, error) {
	rows, err := r.q.Query(ctx, sql, args...)
	return collect(rows, err, func(rs pgx.Rows) (string, error) {
		var id string
		return id, rs.Scan(&id)
	})
}

func (r *pgRepository) FollowingOf(ctx context.Context, customerID string) ([]string, error) {
	return r.ids(ctx, `SELECT followee_id FROM gym.athlete_follows WHERE follower_id = $1 ORDER BY created_at DESC`, customerID)
}

func (r *pgRepository) FollowersOf(ctx context.Context, customerID string) ([]string, error) {
	return r.ids(ctx, `SELECT follower_id FROM gym.athlete_follows WHERE followee_id = $1 ORDER BY created_at DESC`, customerID)
}

func (r *pgRepository) CountFollows(ctx context.Context, customerID string) (following, followers int, err error) {
	err = r.q.QueryRow(ctx,
		`SELECT (SELECT count(*) FROM gym.athlete_follows WHERE follower_id = $1)::int AS following,
            (SELECT count(*) FROM gym.athlete_follows WHERE followee_id = $1)::int AS followers`,
		customerID).Scan(&following, &followers)
	return following, followers, err
}

func (r *pgRepository) DeleteFollow(ctx context.Context, followerID, followeeID string) (int64, error) {
	return r.exec(ctx, `DELETE FROM gym.athlete_follows WHERE follower_id = $1 AND followee_id = $2`, followerID, followeeID)
}

func (r *pgRepository) InsertFollow(ctx context.Context, followerID, followeeID string) error {
	_, err := r.exec(ctx,
		`INSERT INTO gym.athlete_follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		followerID, followeeID)
	return err
}

// ── Kudos & comments ─────────────────────────────────────────────────────────

func (r *pgRepository) DeleteKudos(ctx context.Context, activityID, customerID string) (int64, error) {
	return r.exec(ctx, `DELETE FROM gym.athlete_kudos WHERE activity_id = $1 AND customer_id = $2`, activityID, customerID)
}

func (r *pgRepository) InsertKudos(ctx context.Context, activityID, customerID string) error {
	_, err := r.exec(ctx,
		`INSERT INTO gym.athlete_kudos (activity_id, customer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		activityID, customerID)
	return err
}

func (r *pgRepository) CountKudos(ctx context.Context, activityID string) (int, error) {
	var n int
	err := r.q.QueryRow(ctx, `SELECT count(*)::int AS count FROM gym.athlete_kudos WHERE activity_id = $1`, activityID).Scan(&n)
	return n, err
}

func (r *pgRepository) InsertComment(ctx context.Context, activityID, customerID, text string) (string, time.Time, error) {
	var id string
	var createdAt time.Time
	err := r.q.QueryRow(ctx,
		`INSERT INTO gym.athlete_activity_comments (activity_id, customer_id, text) VALUES ($1, $2, $3)
     RETURNING id, created_at`, activityID, customerID, text).Scan(&id, &createdAt)
	return id, jsTime(createdAt), err
}

func (r *pgRepository) Comments(ctx context.Context, activityID string) ([]CommentRow, error) {
	rows, err := r.q.Query(ctx,
		`SELECT id, customer_id, text, created_at FROM gym.athlete_activity_comments
      WHERE activity_id = $1 ORDER BY created_at`, activityID)
	return collect(rows, err, func(rs pgx.Rows) (CommentRow, error) {
		var c CommentRow
		err := rs.Scan(&c.ID, &c.CustomerID, &c.Text, &c.CreatedAt)
		c.CreatedAt = jsTime(c.CreatedAt)
		return c, err
	})
}

// ── Segments ─────────────────────────────────────────────────────────────────

func (r *pgRepository) Segments(ctx context.Context) ([]domain.Segment, error) {
	rows, err := r.q.Query(ctx, `SELECT id, name, type, distance_m, location, path FROM gym.athlete_segments ORDER BY name`)
	return collect(rows, err, func(rs pgx.Rows) (domain.Segment, error) {
		var s domain.Segment
		err := rs.Scan(&s.ID, &s.Name, &s.Type, &s.DistanceM, &s.Location, &s.Path)
		if s.Path == nil {
			s.Path = []domain.TrackPoint{}
		}
		return s, err
	})
}

func (r *pgRepository) InsertEffort(ctx context.Context, segmentID, activityID, customerID string, elapsedSec int) error {
	_, err := r.exec(ctx,
		`INSERT INTO gym.athlete_segment_efforts (segment_id, activity_id, customer_id, elapsed_sec)
           VALUES ($1, $2, $3, $4) ON CONFLICT (activity_id, segment_id) DO NOTHING`,
		segmentID, activityID, customerID, elapsedSec)
	return err
}

func (r *pgRepository) ActivityEfforts(ctx context.Context, activityID string) ([]ActivityEffortRow, error) {
	rows, err := r.q.Query(ctx,
		`SELECT e.segment_id, s.name, s.distance_m, e.elapsed_sec,
            (SELECT jsonb_agg(jsonb_build_object('memberId', o.customer_id, 'elapsedSec', o.elapsed_sec))
               FROM gym.athlete_segment_efforts o WHERE o.segment_id = e.segment_id) AS board
       FROM gym.athlete_segment_efforts e
       JOIN gym.athlete_segments s ON s.id = e.segment_id
      WHERE e.activity_id = $1
      ORDER BY s.name`, activityID)
	return collect(rows, err, func(rs pgx.Rows) (ActivityEffortRow, error) {
		var v ActivityEffortRow
		var board []struct {
			MemberID   string `json:"memberId"`
			ElapsedSec int    `json:"elapsedSec"`
		}
		if err := rs.Scan(&v.SegmentID, &v.Name, &v.DistanceM, &v.ElapsedSec, &board); err != nil {
			return v, err
		}
		v.Board = make([]domain.Effort, len(board))
		for i, b := range board {
			v.Board[i] = domain.Effort{MemberID: b.MemberID, ElapsedSec: b.ElapsedSec}
		}
		return v, nil
	})
}

// Efforts lists every effort, or one segment's when segmentID is set.
func (r *pgRepository) Efforts(ctx context.Context, segmentID *string) ([]domain.Effort, error) {
	sql := `SELECT segment_id, customer_id, elapsed_sec, created_at FROM gym.athlete_segment_efforts`
	args := []any{}
	if segmentID != nil {
		sql += ` WHERE segment_id = $1`
		args = append(args, *segmentID)
	}
	rows, err := r.q.Query(ctx, sql, args...)
	return collect(rows, err, func(rs pgx.Rows) (domain.Effort, error) {
		var e domain.Effort
		err := rs.Scan(&e.SegmentID, &e.MemberID, &e.ElapsedSec, &e.CreatedAt)
		e.CreatedAt = jsTime(e.CreatedAt)
		return e, err
	})
}

// ── Gear ─────────────────────────────────────────────────────────────────────

const gearColumns = "id, customer_id, name, kind, distance_m, retired"

func scanGear(rs pgx.Row) (GearView, error) {
	var g GearView
	return g, rs.Scan(&g.ID, &g.MemberID, &g.Name, &g.Kind, &g.DistanceM, &g.Retired)
}

func (r *pgRepository) OwnsGear(ctx context.Context, gearID, customerID string) (bool, error) {
	var one int
	err := r.q.QueryRow(ctx, `SELECT 1 FROM gym.athlete_gear WHERE id = $1 AND customer_id = $2`, gearID, customerID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (r *pgRepository) MoveGearMileage(ctx context.Context, gearID string, deltaM float64) error {
	_, err := r.exec(ctx,
		`UPDATE gym.athlete_gear SET distance_m = GREATEST(0, distance_m + $2), updated_at = now() WHERE id = $1`,
		gearID, deltaM)
	return err
}

func (r *pgRepository) GearList(ctx context.Context, customerID string) ([]GearView, error) {
	rows, err := r.q.Query(ctx,
		`SELECT `+gearColumns+` FROM gym.athlete_gear WHERE customer_id = $1 ORDER BY retired, created_at`, customerID)
	return collect(rows, err, func(rs pgx.Rows) (GearView, error) { return scanGear(rs) })
}

func (r *pgRepository) GearName(ctx context.Context, gearID string) (*string, error) {
	var name string
	err := r.q.QueryRow(ctx, `SELECT name FROM gym.athlete_gear WHERE id = $1`, gearID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &name, err
}

func (r *pgRepository) UpdateGear(ctx context.Context, gearID, customerID string, in GearInput) (*GearView, error) {
	g, err := scanGear(r.q.QueryRow(ctx,
		`UPDATE gym.athlete_gear SET name = $3, kind = $4, retired = $5, updated_at = now()
          WHERE id = $1 AND customer_id = $2 RETURNING `+gearColumns,
		gearID, customerID, in.Name, in.Kind, in.Retired))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &g, err
}

func (r *pgRepository) InsertGear(ctx context.Context, customerID string, in GearInput) (GearView, error) {
	return scanGear(r.q.QueryRow(ctx,
		`INSERT INTO gym.athlete_gear (customer_id, name, kind, retired) VALUES ($1, $2, $3, $4)
         RETURNING `+gearColumns, customerID, in.Name, in.Kind, in.Retired))
}

// ── Routes ───────────────────────────────────────────────────────────────────

func scanRoute(rs pgx.Row) (RouteRow, error) {
	var v RouteRow
	err := rs.Scan(&v.ID, &v.Name, &v.DistanceM, &v.Points, &v.CreatedAt)
	v.CreatedAt = jsTime(v.CreatedAt)
	if v.Points == nil {
		v.Points = []domain.TrackPoint{}
	}
	return v, err
}

func (r *pgRepository) Routes(ctx context.Context, customerID string) ([]RouteRow, error) {
	rows, err := r.q.Query(ctx,
		`SELECT id, name, distance_m, points, created_at FROM gym.athlete_routes
      WHERE customer_id = $1 ORDER BY created_at DESC`, customerID)
	return collect(rows, err, func(rs pgx.Rows) (RouteRow, error) { return scanRoute(rs) })
}

func (r *pgRepository) InsertRoute(ctx context.Context, customerID, name string, points []domain.TrackPoint, distanceM float64) (RouteRow, error) {
	text, err := jsonText(points)
	if err != nil {
		return RouteRow{}, err
	}
	return scanRoute(r.q.QueryRow(ctx,
		`INSERT INTO gym.athlete_routes (customer_id, name, points, distance_m) VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id, name, distance_m, points, created_at`, customerID, name, text, distanceM))
}

func (r *pgRepository) DeleteRoute(ctx context.Context, routeID, customerID string) (int64, error) {
	return r.exec(ctx, `DELETE FROM gym.athlete_routes WHERE id = $1 AND customer_id = $2`, routeID, customerID)
}

// ── Settings ─────────────────────────────────────────────────────────────────

func (r *pgRepository) Settings(ctx context.Context, customerID string) (*SettingsView, error) {
	var s SettingsView
	err := r.q.QueryRow(ctx,
		`SELECT units, booking_reminders, weekly_goal_km, language FROM gym.athlete_settings WHERE customer_id = $1`,
		customerID).Scan(&s.Units, &s.BookingReminders, &s.WeeklyGoalKm, &s.Language)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &s, err
}

func (r *pgRepository) UpsertSettings(ctx context.Context, customerID string, s SettingsView) error {
	_, err := r.exec(ctx,
		`INSERT INTO gym.athlete_settings (customer_id, units, booking_reminders, weekly_goal_km, language)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (customer_id) DO UPDATE SET units = EXCLUDED.units, booking_reminders = EXCLUDED.booking_reminders,
       weekly_goal_km = EXCLUDED.weekly_goal_km, language = EXCLUDED.language, updated_at = now()`,
		customerID, s.Units, s.BookingReminders, s.WeeklyGoalKm, s.Language)
	return err
}

// PatchHomeSettings is the home tab PATCH: COALESCE keeps unsent fields.
func (r *pgRepository) PatchHomeSettings(ctx context.Context, customerID string, p SettingsPatch, d SettingsView) error {
	_, err := r.exec(ctx,
		`INSERT INTO gym.athlete_settings (customer_id, units, booking_reminders, language)
     VALUES ($1, COALESCE($2::text, $5), COALESCE($3::boolean, $6), COALESCE($4::text, $7))
     ON CONFLICT (customer_id) DO UPDATE
        SET units = COALESCE($2::text, gym.athlete_settings.units),
            booking_reminders = COALESCE($3::boolean, gym.athlete_settings.booking_reminders),
            language = COALESCE($4::text, gym.athlete_settings.language),
            updated_at = now()`,
		customerID, p.Units, p.BookingReminders, p.Language, d.Units, d.BookingReminders, d.Language)
	return err
}

// ── Challenges & clubs ───────────────────────────────────────────────────────

func (r *pgRepository) Challenges(ctx context.Context) ([]ChallengeInfoRow, error) {
	rows, err := r.q.Query(ctx,
		`SELECT id, name, description, type, target_km, starts_at, ends_at FROM gym.athlete_challenges ORDER BY starts_at`)
	return collect(rows, err, func(rs pgx.Rows) (ChallengeInfoRow, error) {
		var c ChallengeInfoRow
		err := rs.Scan(&c.ID, &c.Name, &c.Description, &c.Type, &c.TargetKm, &c.StartsAt, &c.EndsAt)
		c.StartsAt, c.EndsAt = jsTime(c.StartsAt), jsTime(c.EndsAt)
		return c, err
	})
}

// joinsBy groups (group_id, customer_id) rows in query order.
func (r *pgRepository) joinsBy(ctx context.Context, sql string) (map[string][]string, error) {
	type pair struct{ group, customer string }
	rows, err := r.q.Query(ctx, sql)
	list, err := collect(rows, err, func(rs pgx.Rows) (pair, error) {
		var p pair
		return p, rs.Scan(&p.group, &p.customer)
	})
	out := map[string][]string{}
	for _, p := range list {
		out[p.group] = append(out[p.group], p.customer)
	}
	return out, err
}

func (r *pgRepository) ChallengeParticipants(ctx context.Context) (map[string][]string, error) {
	return r.joinsBy(ctx, `SELECT challenge_id AS group_id, customer_id FROM gym.athlete_challenge_joins ORDER BY joined_at`)
}

func (r *pgRepository) JoinChallenge(ctx context.Context, challengeID, customerID string) (int64, error) {
	return r.exec(ctx,
		`INSERT INTO gym.athlete_challenge_joins (challenge_id, customer_id)
     SELECT id, $2 FROM gym.athlete_challenges WHERE id = $1
     ON CONFLICT DO NOTHING`, challengeID, customerID)
}

func (r *pgRepository) ChallengeExists(ctx context.Context, challengeID string) (bool, error) {
	var one int
	err := r.q.QueryRow(ctx, `SELECT 1 FROM gym.athlete_challenges WHERE id = $1`, challengeID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (r *pgRepository) LeaveChallenge(ctx context.Context, challengeID, customerID string) error {
	_, err := r.exec(ctx, `DELETE FROM gym.athlete_challenge_joins WHERE challenge_id = $1 AND customer_id = $2`, challengeID, customerID)
	return err
}

func (r *pgRepository) Clubs(ctx context.Context) ([]ClubInfo, error) {
	rows, err := r.q.Query(ctx, `SELECT id, name, description, location FROM gym.athlete_clubs ORDER BY name`)
	return collect(rows, err, func(rs pgx.Rows) (ClubInfo, error) {
		var c ClubInfo
		return c, rs.Scan(&c.ID, &c.Name, &c.Description, &c.Location)
	})
}

func (r *pgRepository) ClubMembers(ctx context.Context) (map[string][]string, error) {
	return r.joinsBy(ctx, `SELECT club_id AS group_id, customer_id FROM gym.athlete_club_members ORDER BY joined_at`)
}

func (r *pgRepository) DeleteClubMember(ctx context.Context, clubID, customerID string) (int64, error) {
	return r.exec(ctx, `DELETE FROM gym.athlete_club_members WHERE club_id = $1 AND customer_id = $2`, clubID, customerID)
}

func (r *pgRepository) InsertClubMember(ctx context.Context, clubID, customerID string) (int64, error) {
	return r.exec(ctx,
		`INSERT INTO gym.athlete_club_members (club_id, customer_id) SELECT id, $2 FROM gym.athlete_clubs WHERE id = $1`,
		clubID, customerID)
}
