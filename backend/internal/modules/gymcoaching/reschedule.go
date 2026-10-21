package gymcoaching

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/gymcoaching/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
)

// RescheduleInput moves an open session: a new start, keeping the length,
// and optionally another coach. CoachID "" keeps the coach.
type RescheduleInput struct {
	AppointmentID string
	StartsAt      time.Time
	CoachID       string
}

// Reschedule is staff or the coach moving a session. The checks are the
// ones a new booking passes: the coach must be free and every member still
// in the session must have no other PT at the new time. Credits stay
// reserved, the status stays, and every open participant is told.
func (s *Service) Reschedule(ctx context.Context, in RescheduleInput) error {
	return s.inTx(ctx, func(q Q) error {
		a, err := lockAppointment(ctx, q, in.AppointmentID)
		if err != nil {
			return err
		}
		if !a.Status.Open() {
			return conflict("Sesi PT sudah ditutup")
		}
		coachID := in.CoachID
		if coachID == "" {
			coachID = a.CoachID
		}
		if coachID != a.CoachID {
			if _, err := s.coachBranch(ctx, q, coachID, nil); err != nil {
				return err
			}
		}
		return s.move(ctx, q, a, coachID, in.StartsAt, false)
	})
}

// MemberReschedule is a member moving their own 1:1 session inside the
// cancellation deadline, at most ptRescheduleLimit times, to a free slot of
// the coach's availability.
func (s *Service) MemberReschedule(ctx context.Context, customerID, appointmentID string, startsAt time.Time) error {
	return s.inTx(ctx, func(q Q) error {
		a, err := lockAppointment(ctx, q, appointmentID)
		if err != nil {
			return err
		}
		mine, others := false, false
		for _, p := range a.Participants {
			if p.Status.Open() {
				mine, others = mine || p.CustomerID == customerID, others || p.CustomerID != customerID
			}
		}
		if !mine {
			return httpx.NotFound("Sesi PT tidak ditemukan")
		}
		if others {
			return conflict("Sesi grup hanya bisa dipindahkan oleh coach")
		}
		rules, err := s.ports.Rules.ForBranch(ctx, q, a.BranchID)
		if err != nil {
			return err
		}
		if p := domain.MemberRescheduleProblem(a.Status, a.start(), startsAt, s.now(), a.RescheduleCount, rules); p != "" {
			return conflict(p)
		}
		end := startsAt.Add(time.Time(a.EndsAt).Sub(a.start()))
		fits, err := fitsAvailability(ctx, q, a.CoachID, startsAt, end)
		if err != nil {
			return err
		}
		if !fits {
			return conflict("Jam ini di luar jadwal PT coach")
		}
		if err := s.move(ctx, q, a, a.CoachID, startsAt, true); err != nil {
			return err
		}
		s.notifyStaff(ctx, q, a.CoachID, Notification{
			Type:  "gym_pt_rescheduled",
			Title: "Sesi PT dipindahkan member",
			Body:  memberNames(a) + ": " + a.ClassTypeName + " ke " + localtime.Format(startsAt, localtime.Zone(a.Timezone)) + ".",
		})
		return nil
	})
}

// move writes the new time and coach of a locked open session after the
// overlap checks, counting the move when a member made it.
func (s *Service) move(ctx context.Context, q Q, a *Appointment, coachID string, start time.Time, byMember bool) error {
	end := start.Add(time.Time(a.EndsAt).Sub(a.start()))
	for _, p := range a.Participants {
		if !p.Status.Open() {
			continue
		}
		busy, err := memberBusy(ctx, q, p.CustomerID, &a.ID, start, end)
		if err != nil {
			return err
		}
		if busy {
			return conflict(memberLabel(p) + " sudah punya sesi PT pada jam ini")
		}
	}
	if err := s.claimCoach(ctx, q, a.ID, coachID, start, end); err != nil {
		return err
	}
	moved := 0
	if byMember {
		moved = 1
	}
	if _, err := q.Exec(ctx, `UPDATE gym.pt_appointments
       SET coach_id = $2, starts_at = $3, ends_at = $4, reschedule_count = reschedule_count + $5, updated_at = now()
     WHERE id = $1`, a.ID, coachID, start, end, moved); err != nil {
		return err
	}
	zone := localtime.Zone(a.Timezone)
	body := a.ClassTypeName + " dipindahkan dari " + a.when() + " ke " + localtime.Format(start, zone) + "."
	if coachID != a.CoachID {
		var name string
		if err := q.QueryRow(ctx, `SELECT name FROM gym.coaches WHERE id = $1`, coachID).Scan(&name); err != nil {
			return err
		}
		body += " Coach: " + name + "."
	}
	for _, p := range a.Participants {
		if p.Status.Open() {
			s.notify(ctx, q, p.CustomerID, Notification{Type: "gym_pt_rescheduled", Title: "Jadwal sesi PT berubah", Body: body})
		}
	}
	return nil
}

// memberBusy reports an open PT session of the member overlapping
// [start, end), other than exceptID when set.
func memberBusy(ctx context.Context, q Q, customerID string, exceptID *string, start, end time.Time) (bool, error) {
	var busy bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1
       FROM gym.pt_participants p JOIN gym.pt_appointments a ON a.id = p.appointment_id
      WHERE p.customer_id = $1 AND p.status IN ('requested', 'confirmed') AND ($2::uuid IS NULL OR a.id <> $2)
        AND a.starts_at < $4 AND a.ends_at > $3)`, customerID, exceptID, start, end).Scan(&busy)
	return busy, err
}

// memberNames lists the open participants of a session for staff notices.
func memberNames(a *Appointment) string {
	out := ""
	for _, p := range a.Participants {
		if !p.Status.Open() {
			continue
		}
		if out != "" {
			out += ", "
		}
		out += memberLabel(p)
	}
	return out
}
