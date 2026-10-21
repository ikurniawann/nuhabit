package gymcoaching

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcoaching/domain"
)

// The gate (gym-scheduling) admits a member for a confirmed PT session the
// way it does for a class booking: the participant is marked checked in and
// the session's credits are charged at the door, under the key completion
// uses, so completing the session later charges nothing more.

// GateCandidate is a confirmed PT participant the gate may check in.
type GateCandidate struct {
	ParticipantID, AppointmentID, ClassTypeID, ClassName string
	CreditCost                                           int
	StartsAt, EndsAt                                     time.Time
	// Covered: a pass pays for the session.
	Covered bool
}

// LockGateCandidate is the member's first confirmed session at the branch
// (or anywhere when branchID is nil) starting by now+early and ending at
// or after now-late, not checked in yet; nil when none.
func (s *Service) LockGateCandidate(ctx context.Context, q Q, customerID string, branchID *string, now time.Time, early, late time.Duration) (*GateCandidate, error) {
	var c GateCandidate
	err := q.QueryRow(ctx, `SELECT p.id::text, a.id::text, a.class_type_id::text, t.name, a.credit_cost, a.starts_at, a.ends_at
       FROM gym.pt_participants p
       JOIN gym.pt_appointments a ON a.id = p.appointment_id
       JOIN gym.class_types t ON t.id = a.class_type_id
      WHERE p.customer_id = $1 AND p.status = 'confirmed' AND p.checked_in_at IS NULL
        AND a.status = 'confirmed'
        AND ($2::uuid IS NULL OR a.branch_id IS NULL OR a.branch_id = $2)
        AND a.starts_at <= $3 AND a.ends_at >= $4
      ORDER BY a.starts_at
      LIMIT 1
      FOR UPDATE OF a`, customerID, branchID, now.Add(early), now.Add(-late)).
		Scan(&c.ParticipantID, &c.AppointmentID, &c.ClassTypeID, &c.ClassName, &c.CreditCost, &c.StartsAt, &c.EndsAt)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.Covered, err = s.passCovers(ctx, q, customerID, c.StartsAt)
	return &c, err
}

// GateCheckIn marks the participant checked in at now and charges the
// session. A participant already checked in is left as is. ok=false means
// the PT credits were short, so the gate stays shut.
func (s *Service) GateCheckIn(ctx context.Context, q Q, participantID string, now time.Time) (charged int, ok bool, err error) {
	var appointmentID string
	if err := q.QueryRow(ctx, `SELECT appointment_id::text FROM gym.pt_participants WHERE id = $1`, participantID).Scan(&appointmentID); err != nil {
		return 0, false, err
	}
	a, err := lockAppointment(ctx, q, appointmentID)
	if err != nil {
		return 0, false, err
	}
	p, err := participantIn(a, participantID)
	if err != nil {
		return 0, false, err
	}
	if a.Status != domain.Confirmed || p.Status != domain.Confirmed {
		return 0, false, conflict("Sesi PT belum terkonfirmasi")
	}
	if p.CheckedInAt != nil {
		return p.CreditsCharged, true, nil
	}
	if ok, err = s.chargeSession(ctx, q, a, p); err != nil || !ok {
		return 0, ok, err
	}
	_, err = q.Exec(ctx, `UPDATE gym.pt_participants SET checked_in_at = $2, credits_charged = $3, updated_at = now() WHERE id = $1`,
		p.ID, now, p.CreditsCharged)
	return p.CreditsCharged, true, err
}

// sweepGrace is how long after a session ends the sweep waits before
// closing it, so a late completion by staff still wins.
const sweepGrace = 30 * time.Minute

// CompletePastAppointments closes every confirmed session that ended more
// than sweepGrace before now, one transaction per session: members who
// checked in at the gate are completed (their credits were charged there),
// members who never did are marked absent under the no-show policy. Meant
// for a periodic job; one session's failure does not stop the others.
func (s *Service) CompletePastAppointments(ctx context.Context, now time.Time) error {
	rows, err := s.db.Query(ctx, `SELECT id::text FROM gym.pt_appointments
      WHERE status = 'confirmed' AND ends_at < $1 ORDER BY ends_at`, now.Add(-sweepGrace))
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	var errs []error
	for _, id := range ids {
		if err := s.sweepAppointment(ctx, id); err != nil {
			errs = append(errs, fmt.Errorf("appointment %s: %w", id, err))
		}
	}
	return errors.Join(errs...)
}

func (s *Service) sweepAppointment(ctx context.Context, id string) error {
	return s.inTx(ctx, func(q Q) error {
		a, err := lockAppointment(ctx, q, id)
		if err != nil || a.Status != domain.Confirmed {
			// Closed by staff since the list was read.
			return err
		}
		rules, err := s.ports.Rules.ForBranch(ctx, q, a.BranchID)
		if err != nil {
			return err
		}
		for i := range a.Participants {
			p := &a.Participants[i]
			if p.Status != domain.Confirmed {
				continue
			}
			if p.CheckedInAt == nil {
				if p.CreditsCharged, err = s.chargePenalty(ctx, q, a, p, domain.NoShowPenalty(a.CreditCost, rules), "pt_no_show", "Tidak hadir PT"); err != nil {
					return err
				}
				if err := setParticipant(ctx, q, p, domain.NoShow); err != nil {
					return err
				}
				continue
			}
			if _, err := s.chargeSession(ctx, q, a, p); err != nil {
				return err
			}
			if err := setParticipant(ctx, q, p, domain.Completed); err != nil {
				return err
			}
		}
		return s.setStatus(ctx, q, a, domain.Completed, nil)
	})
}
