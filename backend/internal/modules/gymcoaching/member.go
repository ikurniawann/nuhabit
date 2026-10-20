package gymcoaching

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcoaching/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// PTCoach is a coach who takes PT (has weekly availability).
type PTCoach struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Specialization string  `json:"specialization"`
	Bio            string  `json:"bio"`
	PhotoURL       *string `json:"photo_url"`
	BranchID       *string `json:"branch_id"`
}

// PTCoaches lists active coaches with weekly PT availability, or every
// active coach when all is set.
func (s *Service) PTCoaches(ctx context.Context, all bool) ([]PTCoach, error) {
	rows, err := s.db.Query(ctx, `SELECT c.id::text, c.name, c.specialization, c.bio, c.photo_url, c.branch_id::text
       FROM gym.coaches c
      WHERE c.status = 'active' AND ($1 OR EXISTS (SELECT 1 FROM gym.coach_availability w WHERE w.coach_id = c.id))
      ORDER BY c.name`, all)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[PTCoach])
}

// MemberType is a PT class type with the member's credits for it: usable
// credits less what their open sessions will take.
type MemberType struct {
	PersonalType
	CreditsAvailable int `json:"credits_available"`
}

// MemberOptions is what the member app needs to request a session.
type MemberOptions struct {
	Types   []MemberType `json:"class_types"`
	Coaches []PTCoach    `json:"coaches"`
	// EarliestStart is the first start a request may take now.
	EarliestStart httpx.JSTime `json:"earliest_start"`
	HorizonDays   int          `json:"horizon_days"`
}

// Options lists the PT types with the member's credits, and PT coaches.
func (s *Service) Options(ctx context.Context, customerID string) (*MemberOptions, error) {
	types, err := s.PersonalTypes(ctx)
	if err != nil {
		return nil, err
	}
	coaches, err := s.PTCoaches(ctx, false)
	if err != nil {
		return nil, err
	}
	out := &MemberOptions{Types: make([]MemberType, 0, len(types)), Coaches: coaches, HorizonDays: domain.MemberHorizonDays}
	err = s.inTx(ctx, func(q Q) error {
		rules, err := s.ports.Rules.ForBranch(ctx, q, nil)
		if err != nil {
			return err
		}
		out.EarliestStart = httpx.JSTime(domain.EarliestRequest(s.now(), rules))
		for _, t := range types {
			n, err := s.availableCredits(ctx, q, customerID, t.ID)
			if err != nil {
				return err
			}
			out.Types = append(out.Types, MemberType{PersonalType: t, CreditsAvailable: n})
		}
		return nil
	})
	return out, err
}

// availableCredits is the member's usable credits for classTypeID less the
// cost of their open sessions of that type.
func (s *Service) availableCredits(ctx context.Context, q Q, customerID, classTypeID string) (int, error) {
	usable, err := s.ports.Credits.UsableBalance(ctx, q, customerID, classTypeID)
	if err != nil {
		return 0, err
	}
	var committed int
	err = q.QueryRow(ctx, `SELECT COALESCE(sum(a.credit_cost), 0)
       FROM gym.pt_participants p JOIN gym.pt_appointments a ON a.id = p.appointment_id
      WHERE p.customer_id = $1 AND a.class_type_id = $2 AND p.status IN ('requested', 'confirmed')`,
		customerID, classTypeID).Scan(&committed)
	return max(usable-committed, 0), err
}

// MemberSession is one of the member's PT sessions.
type MemberSession struct {
	ParticipantID     string        `json:"participant_id"`
	AppointmentID     string        `json:"appointment_id"`
	Status            domain.Status `json:"status"`
	AppointmentStatus domain.Status `json:"appointment_status"`
	LateCancel        bool          `json:"late_cancel"`
	CreditsCharged    int           `json:"credits_charged"`
	CoachID           string        `json:"coach_id"`
	CoachName         string        `json:"coach_name"`
	CoachPhotoURL     *string       `json:"coach_photo_url"`
	ClassTypeName     string        `json:"class_type_name"`
	BranchName        *string       `json:"branch_name"`
	StartsAt          httpx.JSTime  `json:"starts_at"`
	EndsAt            httpx.JSTime  `json:"ends_at"`
	CreditCost        int           `json:"credit_cost"`
	Capacity          int           `json:"capacity"`
	Notes             string        `json:"notes"`
	CancelReason      *string       `json:"cancel_reason"`
	// FreeCancelUntil is the last moment a confirmed session cancels without penalty.
	FreeCancelUntil httpx.JSTime `json:"free_cancel_until"`
}

// MemberSessions lists the member's PT sessions, latest start first, at most 100.
func (s *Service) MemberSessions(ctx context.Context, customerID string) ([]MemberSession, error) {
	var out []MemberSession
	err := s.inTx(ctx, func(q Q) error {
		rows, err := q.Query(ctx, `SELECT p.id::text, a.id::text, p.status, a.status, p.late_cancel, p.credits_charged,
       a.coach_id::text, c.name, c.photo_url, t.name, b.name, a.starts_at, a.ends_at, a.credit_cost, a.capacity,
       a.notes, a.cancel_reason, a.branch_id::text
  FROM gym.pt_participants p
  JOIN gym.pt_appointments a ON a.id = p.appointment_id
  JOIN gym.coaches c ON c.id = a.coach_id
  JOIN gym.class_types t ON t.id = a.class_type_id
  LEFT JOIN configuration.branches b ON b.id = a.branch_id
 WHERE p.customer_id = $1
 ORDER BY a.starts_at DESC
 LIMIT 100`, customerID)
		if err != nil {
			return err
		}
		var branches []*string
		out, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (MemberSession, error) {
			var m MemberSession
			var start, end time.Time
			var branch *string
			err := r.Scan(&m.ParticipantID, &m.AppointmentID, &m.Status, &m.AppointmentStatus, &m.LateCancel, &m.CreditsCharged,
				&m.CoachID, &m.CoachName, &m.CoachPhotoURL, &m.ClassTypeName, &m.BranchName, &start, &end, &m.CreditCost,
				&m.Capacity, &m.Notes, &m.CancelReason, &branch)
			m.StartsAt, m.EndsAt = httpx.JSTime(start), httpx.JSTime(end)
			branches = append(branches, branch)
			return m, err
		})
		if err != nil {
			return err
		}
		rules := s.branchRules(q)
		for i := range out {
			r, err := rules(ctx, branches[i])
			if err != nil {
				return err
			}
			deadline := time.Duration(r.CancellationDeadlineHours) * time.Hour
			out[i].FreeCancelUntil = httpx.JSTime(time.Time(out[i].StartsAt).Add(-deadline))
		}
		return nil
	})
	return out, err
}

// MemberCancel withdraws the member from their open session appointmentID.
func (s *Service) MemberCancel(ctx context.Context, customerID, appointmentID string) (CancelResult, error) {
	var participantID string
	err := s.db.QueryRow(ctx, `SELECT id::text FROM gym.pt_participants
       WHERE appointment_id = $1 AND customer_id = $2 AND status IN ('requested', 'confirmed')`,
		appointmentID, customerID).Scan(&participantID)
	if isNoRows(err) {
		return CancelResult{}, httpx.NotFound("Sesi PT tidak ditemukan")
	}
	if err != nil {
		return CancelResult{}, err
	}
	return s.CancelParticipant(ctx, appointmentID, participantID, true, false)
}
