package gymscheduling

import (
	"context"
	"errors"
	"math"
	"strconv"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
)

// Sessions for staff: create, edit, publish, cancel, complete, delete, copy
// a week. Port of session-admin-server.ts.

// SessionInput is a new session; nil duration, capacity and cost fall back
// to the class type.
type SessionInput struct {
	ClassTypeID             string
	CoachID, BranchID, Area *string
	StartsAt                time.Time
	DurationMin             *int
	Capacity                *int
	CreditCost              *int
	Notes                   *string
	Publish                 bool
}

func orDefault(v *int, fallback int) int {
	if v == nil || *v == 0 {
		return fallback
	}
	return *v
}

func (s *Service) CreateSession(ctx context.Context, in SessionInput, createdBy *string) (id string, err error) {
	err = s.inTx(ctx, func(q Q) error {
		def, err := s.repo.ClassTypeDefaults(ctx, q, in.ClassTypeID)
		if err != nil {
			return err
		}
		if def == nil || def.Status != "active" {
			return schedulingError("Jenis kelas tidak ditemukan atau diarsipkan", 404)
		}
		rules, err := s.Rules.ForBranch(ctx, q, in.BranchID)
		if err != nil {
			return err
		}
		opens, closes := domain.DeriveBookingWindow(in.StartsAt, rules)
		status := domain.SessionDraft
		if in.Publish {
			status = domain.SessionPublished
		}
		id, err = s.repo.InsertSession(ctx, q, NewSession{
			ClassTypeID: in.ClassTypeID, CoachID: in.CoachID, BranchID: in.BranchID, Area: in.Area,
			StartsAt:       in.StartsAt,
			DurationMin:    orDefault(in.DurationMin, def.DurationMin),
			Capacity:       orDefault(in.Capacity, def.Capacity),
			CreditCost:     orDefault(in.CreditCost, def.CreditCost),
			BookingOpensAt: opens, BookingClosesAt: closes,
			Status: status, Notes: in.Notes, CreatedBy: createdBy,
		})
		return err
	})
	return id, err
}

// Optional is a PATCH field: Set=false keeps the stored value, Set with a nil
// Value clears it.
type Optional[T any] struct {
	Set   bool
	Value *T
}

// SessionPatch is sessionPatchSchema.
type SessionPatch struct {
	CoachID, Area, Notes Optional[string]
	StartsAt             *time.Time
	DurationMin          *int
	Capacity             *int
}

func pick[T any](o Optional[T], stored *T) *T {
	if o.Set {
		return o.Value
	}
	return stored
}

// UpdateSession: capacity may not drop below the members already booked;
// moving the start re-derives the booking window and notifies members.
func (s *Service) UpdateSession(ctx context.Context, id string, patch SessionPatch) error {
	return s.inTx(ctx, func(q Q) error {
		session, err := s.lockSession(ctx, q, id)
		if err != nil {
			return err
		}
		if session.Status == domain.SessionCompleted || session.Status == domain.SessionCancelled {
			return schedulingError("Sesi yang sudah selesai atau batal tidak bisa diubah")
		}
		held, err := s.repo.SeatsHeld(ctx, q, id)
		if err != nil {
			return err
		}
		if patch.Capacity != nil && *patch.Capacity < held {
			return schedulingError(strconv.Itoa(held) + " member sudah terdaftar; kapasitas tidak bisa di bawah itu")
		}
		startsAt := session.StartsAt
		if patch.StartsAt != nil {
			startsAt = *patch.StartsAt
		}
		duration := int(math.Round(session.EndsAt.Sub(session.StartsAt).Minutes()))
		if patch.DurationMin != nil {
			duration = *patch.DurationMin
		}
		moved := !startsAt.Equal(session.StartsAt)
		opens, closes := session.BookingOpensAt, session.BookingClosesAt
		if moved {
			rules, err := s.Rules.ForBranch(ctx, q, session.BranchID)
			if err != nil {
				return err
			}
			opens, closes = domain.DeriveBookingWindow(startsAt, rules)
		}
		capacity := session.Capacity
		if patch.Capacity != nil {
			capacity = *patch.Capacity
		}
		if err := s.repo.UpdateSession(ctx, q, id, SessionUpdate{
			CoachID: pick(patch.CoachID, session.CoachID), Area: pick(patch.Area, session.Area),
			Notes: pick(patch.Notes, session.Notes), StartsAt: startsAt, DurationMin: duration, Capacity: capacity,
			BookingOpensAt: opens, BookingClosesAt: closes,
		}); err != nil {
			return err
		}
		session.Capacity = capacity
		if err := s.syncSessionSeats(ctx, q, session); err != nil {
			return err
		}
		if !moved {
			return nil
		}
		customers, err := s.repo.ActiveBookingCustomers(ctx, q, id)
		if err != nil {
			return err
		}
		for _, c := range customers {
			if err := s.Notifier.NotifyMember(ctx, q, c, Notification{
				Type:  "gym_session_moved",
				Title: "Jadwal berubah: " + session.ClassTypeName,
				Body:  "Kelas dipindah ke " + domain.FormatWib(startsAt) + ". Batalkan dari portal bila tidak bisa hadir.",
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

// SessionAction runs publish, cancel or complete and returns
// {id, action} plus {notified} or {completed, noShows, penaltyCredits}.
func (s *Service) SessionAction(ctx context.Context, id, action string) (*Row, error) {
	out := object("id", id, "action", action)
	err := s.inTx(ctx, func(q Q) error {
		session, err := s.lockSession(ctx, q, id)
		if err != nil {
			return err
		}
		switch action {
		case "publish":
			return s.publishSession(ctx, q, session)
		case "cancel":
			return s.cancelSession(ctx, q, session, out)
		}
		return s.completeSession(ctx, q, session, out)
	})
	return out, err
}

func (s *Service) publishSession(ctx context.Context, q Q, session *SessionRow) error {
	if !domain.CanTransitionSession(session.Status, domain.SessionPublished) {
		return schedulingError("Hanya sesi draf yang bisa diterbitkan")
	}
	return s.repo.SetSessionStatus(ctx, q, session.ID, domain.SessionPublished)
}

// cancelSession cancels every active booking without a charge and tells each member.
func (s *Service) cancelSession(ctx context.Context, q Q, session *SessionRow, out *Row) error {
	if !domain.CanTransitionSession(session.Status, domain.SessionCancelled) {
		return schedulingError("Sesi ini sudah selesai atau sudah batal")
	}
	if err := s.repo.SetSessionStatus(ctx, q, session.ID, domain.SessionCancelled); err != nil {
		return err
	}
	customers, err := s.repo.CancelSessionBookings(ctx, q, session.ID)
	if err != nil {
		return err
	}
	for _, c := range customers {
		if err := s.Notifier.NotifyMember(ctx, q, c, Notification{
			Type:  "gym_session_cancelled",
			Title: "Kelas dibatalkan: " + session.ClassTypeName,
			Body:  "Kelas " + domain.FormatWib(session.StartsAt) + " dibatalkan studio. Kredit Anda tidak terpotong.",
		}); err != nil {
			return err
		}
	}
	out.Set("notified", len(customers))
	return nil
}

// completeSession closes the session: checked in becomes completed,
// confirmed but absent becomes no-show (charged per policy), waitlist is cancelled.
func (s *Service) completeSession(ctx context.Context, q Q, session *SessionRow, out *Row) error {
	if !domain.CanTransitionSession(session.Status, domain.SessionCompleted) {
		return schedulingError("Hanya sesi terbit atau penuh yang bisa diselesaikan")
	}
	bookings, err := s.repo.LockOpenBookings(ctx, q, session.ID)
	if err != nil {
		return err
	}
	completed, noShows, penalty := 0, 0, 0
	for i := range bookings {
		b := &bookings[i]
		next := domain.BookingStatusOnComplete(b.Status)
		if next == domain.BookingNoShow {
			charged, err := s.applyNoShow(ctx, q, b, session)
			if err != nil {
				return err
			}
			penalty += charged
			noShows++
			continue
		}
		if next == domain.BookingCompleted {
			completed++
		}
		if err := s.repo.CloseBooking(ctx, q, b.ID, next); err != nil {
			return err
		}
	}
	if err := s.repo.SetSessionStatus(ctx, q, session.ID, domain.SessionCompleted); err != nil {
		return err
	}
	out.Set("completed", completed)
	out.Set("noShows", noShows)
	out.Set("penaltyCredits", penalty)
	return nil
}

// DeleteSession removes only a session without any booking; the rest are cancelled instead.
func (s *Service) DeleteSession(ctx context.Context, id string) error {
	return s.inTx(ctx, func(q Q) error {
		if _, err := s.lockSession(ctx, q, id); err != nil {
			return err
		}
		has, err := s.repo.SessionHasBookings(ctx, q, id)
		if err != nil {
			return err
		}
		if has {
			return schedulingError("Sesi ini punya booking. Batalkan sesi, jangan dihapus.")
		}
		return s.repo.DeleteSession(ctx, q, id)
	})
}

// DuplicateWeekResult is {created, skipped}.
type DuplicateWeekResult struct {
	Created int `json:"created"`
	Skipped int `json:"skipped"`
}

var errInvalidWeek = errors.New("gymscheduling: invalid week start")

// wibMidnight reads YYYY-MM-DD as 00:00 WIB the way `new Date("…T00:00:00+07:00")`
// does: month 1-12, day 1-31, and a day past the month's end rolls over.
func wibMidnight(day string) (time.Time, bool) {
	if !dateOnlyPattern.MatchString(day) {
		return time.Time{}, false
	}
	y, _ := strconv.Atoi(day[0:4])
	m, _ := strconv.Atoi(day[5:7])
	d, _ := strconv.Atoi(day[8:10])
	if m < 1 || m > 12 || d < 1 || d > 31 {
		return time.Time{}, false
	}
	return time.Date(y, time.Month(m), d, 0, 0, 0, 0, domain.WIB), true
}

// DuplicateWeek copies every non-cancelled session of the source week
// (Monday to Sunday WIB) to the target week, same times and coach. A slot
// already taken in the target week is skipped.
func (s *Service) DuplicateWeek(ctx context.Context, sourceWeek, targetWeek string, publish bool, createdBy *string) (DuplicateWeekResult, error) {
	var out DuplicateWeekResult
	source, ok1 := wibMidnight(sourceWeek)
	target, ok2 := wibMidnight(targetWeek)
	if !ok1 || !ok2 {
		// new Date("2026-02-31T00:00:00+07:00") is Invalid Date in TS and the
		// insert fails the same way: a server error.
		return out, errInvalidWeek
	}
	dayShift := int(math.Round(target.Sub(source).Hours() / 24))
	if dayShift == 0 {
		return out, schedulingError("Minggu tujuan harus berbeda dari minggu sumber", 400)
	}
	status := domain.SessionDraft
	if publish {
		status = domain.SessionPublished
	}
	err := s.inTx(ctx, func(q Q) error {
		rows, err := s.repo.SessionsInWeek(ctx, q, source)
		if err != nil {
			return err
		}
		rulesFor := s.branchRules(q)
		for _, w := range rows {
			startsAt := domain.ShiftDays(w.StartsAt, dayShift)
			rules, err := rulesFor(ctx, w.BranchID)
			if err != nil {
				return err
			}
			opens, closes := domain.DeriveBookingWindow(startsAt, rules)
			inserted, err := s.repo.InsertSessionIfFree(ctx, q, NewSession{
				ClassTypeID: w.ClassTypeID, CoachID: w.CoachID, BranchID: w.BranchID, Area: w.Area,
				StartsAt: startsAt, Capacity: w.Capacity, CreditCost: w.CreditCost,
				BookingOpensAt: opens, BookingClosesAt: closes,
				Status: status, Notes: w.Notes, CreatedBy: createdBy,
			}, domain.ShiftDays(w.EndsAt, dayShift))
			if err != nil {
				return err
			}
			if inserted {
				out.Created++
			}
		}
		out.Skipped = len(rows) - out.Created
		return nil
	})
	return out, err
}
