package athlete

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/athlete/domain"
	"nuhabit/backend/internal/platform/database"
)

// pgWorkoutSessions implements WorkoutSessions on gym.workout_sessions and
// gym.workouts (owned by gym-training) with the SQL of syncWorkoutActivities
// in athlete-store.ts. When gym-training becomes its own service, this is the
// one file that turns into an HTTP client.
type pgWorkoutSessions struct{ q database.Querier }

func (w pgWorkoutSessions) UnsyncedCompleted(ctx context.Context, customerID *string) ([]CompletedWorkoutSession, error) {
	rows, err := w.q.Query(ctx,
		`SELECT s.id, s.customer_id, w.type, w.blocks, COALESCE(s.started_at, s.created_at) AS started_at,
            s.active_sec, s.total_pause_sec
       FROM gym.workout_sessions s
       JOIN gym.workouts w ON w.id = s.workout_id
      WHERE s.status = 'completed'
        AND ($1::uuid IS NULL OR s.customer_id = $1)
        AND NOT EXISTS (SELECT 1 FROM gym.athlete_activities a
                         WHERE a.source_type = 'workout_session' AND a.source_id = s.id)`, customerID)
	return collect(rows, err, func(rs pgx.Rows) (CompletedWorkoutSession, error) {
		var s CompletedWorkoutSession
		err := rs.Scan(&s.ID, &s.CustomerID, &s.WorkoutType, &s.Blocks, &s.StartedAt, &s.ActiveSec, &s.TotalPauseSec)
		if s.Blocks == nil {
			s.Blocks = []domain.WorkoutBlock{}
		}
		s.StartedAt = jsTime(s.StartedAt)
		return s, err
	})
}
