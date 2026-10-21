package gymcoaching

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/gymcoaching/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Every write locks the appointment row first, so changes to one session
// and its participants never interleave.

func badMove(a *Appointment, to domain.Status) error {
	if domain.CanTransition(a.Status, to) {
		return nil
	}
	return conflict("Sesi PT berstatus " + string(a.Status) + " tidak bisa diubah ke " + string(to))
}

func (s *Service) setStatus(ctx context.Context, q Q, a *Appointment, to domain.Status, reason *string) error {
	stamp := map[domain.Status]string{domain.Confirmed: "confirmed_at", domain.Completed: "completed_at", domain.Cancelled: "cancelled_at"}[to]
	_, err := q.Exec(ctx, `UPDATE gym.pt_appointments SET status = $2, `+stamp+` = $3,
       cancel_reason = COALESCE($4, cancel_reason), updated_at = now() WHERE id = $1`, a.ID, to, s.now(), reason)
	a.Status = to
	return err
}

func setParticipant(ctx context.Context, q Q, p *Participant, to domain.Status) error {
	_, err := q.Exec(ctx, `UPDATE gym.pt_participants
       SET status = $2, late_cancel = $3, credits_charged = $4,
           cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END, updated_at = now()
     WHERE id = $1`, p.ID, to, p.LateCancel, p.CreditsCharged)
	p.Status = to
	return err
}

func memberLabel(p Participant) string {
	if p.Name != nil {
		return *p.Name
	}
	return "member"
}

// Confirm accepts a requested session for every requesting member.
func (s *Service) Confirm(ctx context.Context, id string) error {
	return s.inTx(ctx, func(q Q) error {
		a, err := lockAppointment(ctx, q, id)
		if err != nil {
			return err
		}
		if err := badMove(a, domain.Confirmed); err != nil {
			return err
		}
		if err := s.setStatus(ctx, q, a, domain.Confirmed, nil); err != nil {
			return err
		}
		for i := range a.Participants {
			p := &a.Participants[i]
			if p.Status != domain.Requested {
				continue
			}
			if err := setParticipant(ctx, q, p, domain.Confirmed); err != nil {
				return err
			}
			s.notify(ctx, q, p.CustomerID, confirmedNotice(a.ClassTypeName, a.when()))
		}
		return nil
	})
}

// CancelAppointment is the coach or the desk calling a session off: every
// member still booked is released without a penalty and notified.
func (s *Service) CancelAppointment(ctx context.Context, id, reason string) error {
	return s.inTx(ctx, func(q Q) error {
		a, err := lockAppointment(ctx, q, id)
		if err != nil {
			return err
		}
		if err := badMove(a, domain.Cancelled); err != nil {
			return err
		}
		if err := s.setStatus(ctx, q, a, domain.Cancelled, nullable(reason)); err != nil {
			return err
		}
		for i := range a.Participants {
			p := &a.Participants[i]
			if !p.Status.Open() {
				continue
			}
			if err := setParticipant(ctx, q, p, domain.Cancelled); err != nil {
				return err
			}
			s.notify(ctx, q, p.CustomerID, cancelledNotice(a.ClassTypeName, a.when(), reason))
		}
		return nil
	})
}

// Complete closes a session that has started and charges each member who
// attended its credit cost, unless a pass covering PT paid for it. A member
// short of PT credits stops the whole completion, so the desk can top up or
// mark the member absent first.
func (s *Service) Complete(ctx context.Context, id string) error {
	return s.inTx(ctx, func(q Q) error {
		a, err := lockAppointment(ctx, q, id)
		if err != nil {
			return err
		}
		if err := badMove(a, domain.Completed); err != nil {
			return err
		}
		if !domain.Started(a.start(), s.now()) {
			return conflict("Sesi PT belum dimulai")
		}
		for i := range a.Participants {
			p := &a.Participants[i]
			if p.Status != domain.Confirmed {
				continue
			}
			ok, err := s.chargeSession(ctx, q, a, p)
			if err != nil {
				return err
			}
			if !ok {
				return conflict("Kredit PT " + memberLabel(*p) + " tidak cukup untuk menyelesaikan sesi")
			}
			if err := setParticipant(ctx, q, p, domain.Completed); err != nil {
				return err
			}
		}
		return s.setStatus(ctx, q, a, domain.Completed, nil)
	})
}

// chargeSession takes the session's credits from a confirmed member, once
// per participant (the gate and completion share the key), and records
// them on p. A pass covering PT at the start costs nothing. ok=false means
// the PT credits were short.
func (s *Service) chargeSession(ctx context.Context, q Q, a *Appointment, p *Participant) (bool, error) {
	covered, err := s.passCovers(ctx, q, p.CustomerID, a.start())
	if err != nil || covered {
		return true, err
	}
	ok, err := s.ports.Credits.Deduct(ctx, q, CreditMove{
		CustomerID: p.CustomerID, ClassTypeID: a.ClassTypeID, Amount: a.CreditCost,
		SourceType: "pt_session", SourceID: p.ID, IdempotencyKey: "gym:pt:" + p.ID,
		Note: "Sesi PT: " + a.ClassTypeName + " " + a.when(),
	})
	if err == nil && ok {
		p.CreditsCharged = a.CreditCost
	}
	return ok, err
}

// AddMember adds a member to an open small group session with room left.
func (s *Service) AddMember(ctx context.Context, id, customerID string) error {
	return s.inTx(ctx, func(q Q) error {
		a, err := lockAppointment(ctx, q, id)
		if err != nil {
			return err
		}
		if !a.Status.Open() {
			return conflict("Sesi PT sudah ditutup")
		}
		taken := 0
		for _, p := range a.Participants {
			if p.Status.Open() {
				taken++
			}
		}
		if taken >= a.Capacity {
			return conflict("Sesi PT sudah penuh")
		}
		ct, err := s.personalType(ctx, q, a.ClassTypeID)
		if err != nil {
			return err
		}
		ct.CreditCost = a.CreditCost
		if err := s.checkMember(ctx, q, customerID, ct, a.start(), time.Time(a.EndsAt)); err != nil {
			return err
		}
		if err := s.addParticipant(ctx, q, a.ID, customerID, a.Status); err != nil {
			return err
		}
		if a.Status == domain.Confirmed {
			s.notify(ctx, q, customerID, confirmedNotice(a.ClassTypeName, a.when()))
		}
		return nil
	})
}

// CancelResult reports a participant cancel: Late past the free deadline,
// Penalty the credits charged for it.
type CancelResult struct {
	Late    bool `json:"late"`
	Penalty int  `json:"penalty"`
}

// participantIn finds participantID in a locked appointment.
func participantIn(a *Appointment, participantID string) (*Participant, error) {
	for i := range a.Participants {
		if a.Participants[i].ID == participantID {
			return &a.Participants[i], nil
		}
	}
	return nil, httpx.NotFound("Peserta PT tidak ditemukan")
}

// CancelParticipant takes one member out of a session. A member cancelling
// late pays the late-cancel policy; staff may waive it. The session is
// cancelled when no member is left in it.
func (s *Service) CancelParticipant(ctx context.Context, appointmentID, participantID string, byMember, waive bool) (CancelResult, error) {
	var out CancelResult
	err := s.inTx(ctx, func(q Q) error {
		a, err := lockAppointment(ctx, q, appointmentID)
		if err != nil {
			return err
		}
		p, err := participantIn(a, participantID)
		if err != nil {
			return err
		}
		if !p.Status.Open() || !a.Status.Open() {
			return conflict("Peserta PT sudah tidak terdaftar")
		}
		rules, err := s.ports.Rules.ForBranch(ctx, q, a.BranchID)
		if err != nil {
			return err
		}
		outcome := domain.EvaluateCancel(p.Status, a.start(), a.CreditCost, rules, s.now())
		out.Late = outcome.Late
		if !waive {
			if out.Penalty, err = s.chargePenalty(ctx, q, a, p, outcome.Penalty, "pt_late_cancel", "Batal terlambat PT"); err != nil {
				return err
			}
		}
		p.LateCancel, p.CreditsCharged = out.Late, out.Penalty
		if err := setParticipant(ctx, q, p, domain.Cancelled); err != nil {
			return err
		}
		if !byMember {
			s.notify(ctx, q, p.CustomerID, cancelledNotice(a.ClassTypeName, a.when(), ""))
		}
		for _, other := range a.Participants {
			if other.Status.Open() {
				return nil
			}
		}
		reason := "Semua peserta batal"
		return s.setStatus(ctx, q, a, domain.Cancelled, &reason)
	})
	return out, err
}

// NoShow marks a confirmed member absent once the session has started and
// charges the no-show policy unless staff waive it.
func (s *Service) NoShow(ctx context.Context, appointmentID, participantID string, waive bool) (int, error) {
	var penalty int
	err := s.inTx(ctx, func(q Q) error {
		a, err := lockAppointment(ctx, q, appointmentID)
		if err != nil {
			return err
		}
		p, err := participantIn(a, participantID)
		if err != nil {
			return err
		}
		if a.Status != domain.Confirmed || !domain.CanTransition(p.Status, domain.NoShow) {
			return conflict("Hanya peserta sesi terkonfirmasi yang bisa ditandai tidak hadir")
		}
		if !domain.Started(a.start(), s.now()) {
			return conflict("Sesi PT belum dimulai")
		}
		if !waive {
			rules, err := s.ports.Rules.ForBranch(ctx, q, a.BranchID)
			if err != nil {
				return err
			}
			if penalty, err = s.chargePenalty(ctx, q, a, p, domain.NoShowPenalty(a.CreditCost, rules), "pt_no_show", "Tidak hadir PT"); err != nil {
				return err
			}
		}
		p.CreditsCharged = penalty
		return setParticipant(ctx, q, p, domain.NoShow)
	})
	return penalty, err
}

// chargePenalty deducts up to amount of the member's usable PT credits: a
// short balance never goes negative, and a pass covering PT owes nothing.
func (s *Service) chargePenalty(ctx context.Context, q Q, a *Appointment, p *Participant, amount int, kind, note string) (int, error) {
	if amount <= 0 {
		return 0, nil
	}
	if covered, err := s.passCovers(ctx, q, p.CustomerID, a.start()); err != nil || covered {
		return 0, err
	}
	usable, err := s.ports.Credits.UsableBalance(ctx, q, p.CustomerID, a.ClassTypeID)
	if err != nil {
		return 0, err
	}
	if amount = min(amount, usable); amount <= 0 {
		return 0, nil
	}
	ok, err := s.ports.Credits.Deduct(ctx, q, CreditMove{
		CustomerID: p.CustomerID, ClassTypeID: a.ClassTypeID, Amount: amount,
		SourceType: kind, SourceID: p.ID, IdempotencyKey: "gym:" + kind + ":" + p.ID,
		Note: note + ": " + a.ClassTypeName + " " + a.when(),
	})
	if err != nil || !ok {
		return 0, err
	}
	return amount, nil
}
