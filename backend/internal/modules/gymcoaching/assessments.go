package gymcoaching

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcoaching/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// AssessmentRow is a stored assessment as staff and members read it.
type AssessmentRow struct {
	ID           string   `json:"id"`
	CustomerID   string   `json:"customer_id"`
	MemberName   *string  `json:"member_name"`
	CoachID      *string  `json:"coach_id"`
	CoachName    *string  `json:"coach_name"`
	AssessedOn   string   `json:"assessed_on"`
	WeightKg     *float64 `json:"weight_kg"`
	BodyFatPct   *float64 `json:"body_fat_pct"`
	MuscleMassKg *float64 `json:"muscle_mass_kg"`
	RestingHR    *int     `json:"resting_hr"`

	Run1kmSec          *int `json:"run_1km_sec"`
	Ski1kmSec          *int `json:"ski_1km_sec"`
	Row1kmSec          *int `json:"row_1km_sec"`
	WallBallsMaxReps   *int `json:"wall_balls_max_reps"`
	SledPushSec        *int `json:"sled_push_sec"`
	SledPullSec        *int `json:"sled_pull_sec"`
	BurpeeBroadJumpSec *int `json:"burpee_broad_jump_sec"`

	Notes         string    `json:"notes"`
	Goals         string    `json:"goals"`
	CreatedByName string    `json:"created_by_name"`
	CreatedAt     time.Time `json:"created_at"`
}

const assessmentSelect = `SELECT f.id::text, f.customer_id::text, m.name, f.coach_id::text, c.name, f.assessed_on::text,
       f.weight_kg::float8, f.body_fat_pct::float8, f.muscle_mass_kg::float8, f.resting_hr,
       f.run_1km_sec, f.ski_1km_sec, f.row_1km_sec, f.wall_balls_max_reps, f.sled_push_sec, f.sled_pull_sec,
       f.burpee_broad_jump_sec, f.notes, f.goals, f.created_by_name, f.created_at
  FROM gym.fitness_assessments f
  JOIN pos.pos_customers m ON m.id = f.customer_id
  LEFT JOIN gym.coaches c ON c.id = f.coach_id`

func (s *Service) queryAssessments(ctx context.Context, where string, args ...any) ([]AssessmentRow, error) {
	rows, err := s.db.Query(ctx, assessmentSelect+" "+where, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[AssessmentRow])
}

// MemberAssessments lists a member's assessments, newest first.
func (s *Service) MemberAssessments(ctx context.Context, customerID string) ([]AssessmentRow, error) {
	return s.queryAssessments(ctx, `WHERE f.customer_id = $1 ORDER BY f.assessed_on DESC, f.created_at DESC`, customerID)
}

// RecentAssessments lists the latest 100 assessments, optionally of members
// whose name or phone matches term.
func (s *Service) RecentAssessments(ctx context.Context, term string) ([]AssessmentRow, error) {
	return s.queryAssessments(ctx, `WHERE ($1 = '' OR m.name ILIKE '%' || $1 || '%' OR m.phone ILIKE '%' || $1 || '%')
 ORDER BY f.assessed_on DESC, f.created_at DESC LIMIT 100`, term)
}

// GetAssessment returns nil when the assessment does not exist.
func (s *Service) GetAssessment(ctx context.Context, id string) (*AssessmentRow, error) {
	list, err := s.queryAssessments(ctx, `WHERE f.id = $1`, id)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// AssessmentInput is an assessment to record or the new content of one.
type AssessmentInput struct {
	domain.Assessment
	CustomerID string
	CoachID    *string
}

func (s *Service) checkAssessment(ctx context.Context, in AssessmentInput) error {
	zone, err := coachZone(ctx, s.db, in.CoachID)
	if err != nil {
		return err
	}
	if p := in.Problem(s.today(zone)); p != "" {
		return httpx.BadRequest(p)
	}
	if in.CoachID == nil {
		return nil
	}
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gym.coaches WHERE id = $1)`, *in.CoachID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return httpx.NotFound("Coach tidak ditemukan")
	}
	return nil
}

func metricArgs(a domain.Assessment) []any {
	return []any{a.AssessedOn, a.WeightKg, a.BodyFatPct, a.MuscleMassKg, a.RestingHR,
		a.Run1kmSec, a.Ski1kmSec, a.Row1kmSec, a.WallBallsMaxReps, a.SledPushSec, a.SledPullSec, a.BurpeeBroadJumpSec,
		a.Notes, a.Goals}
}

// CreateAssessment records an assessment for a member.
func (s *Service) CreateAssessment(ctx context.Context, in AssessmentInput, actorID, actorName string) (string, error) {
	if err := s.checkAssessment(ctx, in); err != nil {
		return "", err
	}
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pos.pos_customers WHERE id = $1)`, in.CustomerID).Scan(&exists); err != nil {
		return "", err
	}
	if !exists {
		return "", httpx.NotFound("Member tidak ditemukan")
	}
	var id string
	args := append([]any{in.CustomerID, in.CoachID, actorID, actorName}, metricArgs(in.Assessment)...)
	err := s.db.QueryRow(ctx, `INSERT INTO gym.fitness_assessments
      (customer_id, coach_id, created_by, created_by_name, assessed_on, weight_kg, body_fat_pct, muscle_mass_kg, resting_hr,
       run_1km_sec, ski_1km_sec, row_1km_sec, wall_balls_max_reps, sled_push_sec, sled_pull_sec, burpee_broad_jump_sec,
       notes, goals)
      VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING id::text`, args...).Scan(&id)
	return id, err
}

// UpdateAssessment replaces an assessment's date, coach, metrics, notes
// and goals; the member stays.
func (s *Service) UpdateAssessment(ctx context.Context, id string, in AssessmentInput) error {
	if err := s.checkAssessment(ctx, in); err != nil {
		return err
	}
	args := append([]any{id, in.CoachID}, metricArgs(in.Assessment)...)
	tag, err := s.db.Exec(ctx, `UPDATE gym.fitness_assessments SET coach_id = $2, assessed_on = $3::date,
       weight_kg = $4, body_fat_pct = $5, muscle_mass_kg = $6, resting_hr = $7, run_1km_sec = $8, ski_1km_sec = $9,
       row_1km_sec = $10, wall_balls_max_reps = $11, sled_push_sec = $12, sled_pull_sec = $13, burpee_broad_jump_sec = $14,
       notes = $15, goals = $16, updated_at = now()
     WHERE id = $1`, args...)
	if err == nil && tag.RowsAffected() == 0 {
		err = httpx.NotFound("Asesmen tidak ditemukan")
	}
	return err
}

func (s *Service) DeleteAssessment(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM gym.fitness_assessments WHERE id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		err = httpx.NotFound("Asesmen tidak ditemukan")
	}
	return err
}

// MemberHit is a member search result with their PT credits for the
// requested class type (0 when none was given).
type MemberHit struct {
	ID        string  `json:"id"`
	Name      *string `json:"name"`
	Phone     *string `json:"phone"`
	IsActive  *bool   `json:"is_active"`
	PTCredits int     `json:"pt_credits"`
}

// SearchMembers matches name or phone, at most 10 hits.
func (s *Service) SearchMembers(ctx context.Context, term, classTypeID string) ([]MemberHit, error) {
	var out []MemberHit
	err := s.inTx(ctx, func(q Q) error {
		rows, err := q.Query(ctx, `SELECT id::text, name, phone, is_active FROM pos.pos_customers
       WHERE name ILIKE '%' || $1 || '%' OR phone ILIKE '%' || $1 || '%'
       ORDER BY name LIMIT 10`, term)
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (MemberHit, error) {
			var h MemberHit
			return h, r.Scan(&h.ID, &h.Name, &h.Phone, &h.IsActive)
		})
		if err != nil || classTypeID == "" {
			return err
		}
		for i := range out {
			if out[i].PTCredits, err = s.availableCredits(ctx, q, out[i].ID, classTypeID); err != nil {
				return err
			}
		}
		return nil
	})
	return out, err
}
