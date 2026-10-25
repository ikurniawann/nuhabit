package gymscheduling

import (
	"context"
	"errors"
	"math"
	"regexp"
	"slices"
	"strconv"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/localtime"
)

// Sessions for staff: create, edit, publish, cancel, complete, delete, copy
// a week. Port of session-admin-server.ts. Every write that places a session
// in the timetable takes the schedule lock and rejects coach or room clashes.

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

var errClassTypeGone = schedulingError("Jenis kelas tidak ditemukan atau diarsipkan", 404)

func (s *Service) CreateSession(ctx context.Context, in SessionInput, createdBy *string) (id string, err error) {
	err = s.inTx(ctx, func(q Q) error {
		def, err := s.repo.ClassTypeDefaults(ctx, q, in.ClassTypeID)
		if err != nil {
			return err
		}
		if def == nil || def.Status != "active" {
			return errClassTypeGone
		}
		duration := orDefault(in.DurationMin, def.DurationMin)
		if err := s.claimSlot(ctx, q, domain.Slot{
			CoachID: in.CoachID, BranchID: in.BranchID, Area: in.Area,
			StartsAt: in.StartsAt, EndsAt: in.StartsAt.Add(time.Duration(duration) * time.Minute),
		}); err != nil {
			return err
		}
		rules, err := s.Rules.ForBranch(ctx, q, in.BranchID)
		if err != nil {
			return err
		}
		// Read before the insert: a unique violation aborts the transaction.
		zone, err := localtime.BranchZone(ctx, q, in.BranchID)
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
			DurationMin:    duration,
			Capacity:       orDefault(in.Capacity, def.Capacity),
			CreditCost:     orDefault(in.CreditCost, def.CreditCost),
			BookingOpensAt: opens, BookingClosesAt: closes,
			Status: status, Notes: in.Notes, CreatedBy: createdBy,
		})
		if database.IsUniqueViolation(err) {
			return slotTaken(in.StartsAt, zone)
		}
		return err
	})
	return id, err
}

// slotTaken is the unique slot index firing: the class type already runs at
// that start in that branch.
func slotTaken(startsAt time.Time, zone *time.Location) error {
	return schedulingError("Sesi jenis kelas ini pada " + localtime.Format(startsAt, zone) + " sudah ada di jadwal")
}

// claimSlot takes the schedule lock and rejects a slot whose coach or room
// is already busy.
func (s *Service) claimSlot(ctx context.Context, q Q, slot domain.Slot) error {
	if err := s.repo.LockSchedule(ctx, q); err != nil {
		return err
	}
	clash, err := s.findConflict(ctx, q, slot)
	if err == nil && clash != nil {
		err = schedulingError(clash.Message())
	}
	if err == nil {
		err = s.checkCoachLeave(ctx, q, slot)
	}
	return err
}

func (s *Service) findConflict(ctx context.Context, q Q, slot domain.Slot) (*domain.ScheduleConflict, error) {
	others, err := s.repo.ScheduleNeighbours(ctx, q, slot)
	if err != nil {
		return nil, err
	}
	return domain.FindScheduleConflict(slot, others), nil
}

// Optional is a PATCH field: Set=false keeps the stored value, Set with a nil
// Value clears it.
type Optional[T any] struct {
	Set   bool
	Value *T
}

// SessionPatch is sessionPatchSchema. ClassTypeID and CreditCost may change
// only while the session has no booking, BranchID only while it never had one.
type SessionPatch struct {
	ClassTypeID                    *string
	CoachID, BranchID, Area, Notes Optional[string]
	StartsAt                       *time.Time
	DurationMin                    *int
	Capacity                       *int
	CreditCost                     *int
}

func pick[T any](o Optional[T], stored *T) *T {
	if o.Set {
		return o.Value
	}
	return stored
}

func sameValue[T comparable](a, b *T) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// UpdateSession: capacity may not drop below the members already booked;
// moving the start re-derives the booking window, records the move for the
// late-cancel waiver and notifies members, as does a coach change. Moving to
// another branch re-derives the window under that branch's rules and checks
// its rooms and coaches.
func (s *Service) UpdateSession(ctx context.Context, id string, patch SessionPatch) error {
	now := s.now()
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
		classTypeID, creditCost, err := s.repricedSession(ctx, q, session, patch)
		if err != nil {
			return err
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
		branchID, err := s.rebranchedSession(ctx, q, session, patch.BranchID)
		if err != nil {
			return err
		}
		branchChanged := !sameValue(branchID, session.BranchID)
		if branchChanged {
			if session.Zone, err = localtime.BranchZone(ctx, q, branchID); err != nil {
				return err
			}
		}
		opens, closes := session.BookingOpensAt, session.BookingClosesAt
		if moved || branchChanged {
			rules, err := s.Rules.ForBranch(ctx, q, branchID)
			if err != nil {
				return err
			}
			opens, closes = domain.DeriveBookingWindow(startsAt, rules)
		}
		capacity := session.Capacity
		if patch.Capacity != nil {
			capacity = *patch.Capacity
		}
		coachID, area := pick(patch.CoachID, session.CoachID), pick(patch.Area, session.Area)
		coachChanged := !sameValue(coachID, session.CoachID)
		slot := domain.Slot{ID: id, CoachID: coachID, BranchID: branchID, Area: area,
			StartsAt: startsAt, EndsAt: startsAt.Add(time.Duration(duration) * time.Minute)}
		if moved || coachChanged || branchChanged || !slot.EndsAt.Equal(session.EndsAt) || !sameValue(area, session.Area) {
			if err := s.claimSlot(ctx, q, slot); err != nil {
				return err
			}
		}
		update := SessionUpdate{
			ClassTypeID: classTypeID, CoachID: coachID, BranchID: branchID, Area: area,
			Notes: pick(patch.Notes, session.Notes), StartsAt: startsAt, DurationMin: duration, Capacity: capacity,
			CreditCost: creditCost, BookingOpensAt: opens, BookingClosesAt: closes,
		}
		if moved {
			update.MovedAt, update.OriginalStartsAt = &now, &session.StartsAt
		}
		err = s.repo.UpdateSession(ctx, q, id, update)
		if database.IsUniqueViolation(err) {
			return slotTaken(startsAt, session.Zone)
		}
		if err != nil {
			return err
		}
		session.Capacity = capacity
		if err := s.syncSessionSeats(ctx, q, session); err != nil {
			return err
		}
		if _, err := s.PromoteFromWaitlist(ctx, q, id); err != nil {
			return err
		}
		if !moved && !coachChanged {
			return nil
		}
		rules, err := s.Rules.ForBranch(ctx, q, branchID)
		if err != nil {
			return err
		}
		kind := changeCoach
		if moved {
			kind = changeMoved
		}
		deliverAfter, err := s.stampChange(ctx, q, session, kind, startsAt, rules, coachChanged)
		if err != nil {
			return err
		}
		var notices []Notification
		if moved {
			notices = append(notices, Notification{
				Type:  "gym_session_moved",
				Title: "Jadwal berubah: " + session.ClassTypeName,
				Body:  "Kelas dipindah ke " + session.at(startsAt) + "." + freeCancelHint(rules),
			})
		}
		if coachChanged {
			n, err := s.coachChangedNotice(ctx, q, session.ClassTypeName, session.at(startsAt), coachID)
			if err != nil {
				return err
			}
			n.Body += freeCancelHint(rules)
			notices = append(notices, n)
		}
		for i := range notices {
			notices[i].DeliverAfter = deliverAfter
		}
		customers, err := s.repo.ActiveBookingCustomers(ctx, q, id)
		if err != nil {
			return err
		}
		for _, c := range customers {
			for _, n := range notices {
				if err := s.Notifier.NotifyMember(ctx, q, c, n); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// repricedSession applies a class type or credit cost change, allowed only
// while nobody is booked: members agreed to the class and price they booked.
func (s *Service) repricedSession(ctx context.Context, q Q, session *SessionRow, patch SessionPatch) (classTypeID string, creditCost int, err error) {
	classTypeID, creditCost = session.ClassTypeID, session.CreditCost
	typeChanged := patch.ClassTypeID != nil && *patch.ClassTypeID != classTypeID
	costChanged := patch.CreditCost != nil && *patch.CreditCost != creditCost
	if !typeChanged && !costChanged {
		return classTypeID, creditCost, nil
	}
	booked, err := s.repo.SessionHasActiveBookings(ctx, q, session.ID)
	if err != nil {
		return "", 0, err
	}
	if booked {
		return "", 0, schedulingError("Sesi ini sudah punya booking; jenis kelas dan biaya kredit tidak bisa diubah")
	}
	if typeChanged {
		def, err := s.repo.ClassTypeDefaults(ctx, q, *patch.ClassTypeID)
		if err != nil {
			return "", 0, err
		}
		if def == nil || def.Status != "active" {
			return "", 0, errClassTypeGone
		}
		classTypeID = *patch.ClassTypeID
	}
	if costChanged {
		creditCost = *patch.CreditCost
	}
	return classTypeID, creditCost, nil
}

// rebranchedSession is the branch the session ends up in. Members booked a
// class at a place, so the branch changes only while the session has no
// booking at all, cancelled ones included.
func (s *Service) rebranchedSession(ctx context.Context, q Q, session *SessionRow, patch Optional[string]) (*string, error) {
	branchID := pick(patch, session.BranchID)
	if sameValue(branchID, session.BranchID) {
		return branchID, nil
	}
	booked, err := s.repo.SessionHasBookings(ctx, q, session.ID)
	if err != nil {
		return nil, err
	}
	if booked {
		return nil, schedulingError("Sesi ini sudah punya booking; cabang tidak bisa diubah")
	}
	return branchID, nil
}

// coachChangedNotice tells booked members who now leads the class at when.
func (s *Service) coachChangedNotice(ctx context.Context, q Q, className, when string, coachID *string) (Notification, error) {
	body := "Coach kelas " + when + " sedang dicarikan pengganti. Kami kabari lagi."
	if coachID != nil {
		name, err := s.repo.CoachName(ctx, q, *coachID)
		if err != nil {
			return Notification{}, err
		}
		if name != nil {
			body = "Kelas " + when + " kini dipandu " + *name + "."
		}
	}
	return Notification{Type: "gym_session_coach_changed", Title: "Coach berganti: " + className, Body: body}, nil
}

// SessionAction runs publish, cancel or complete and returns
// {id, action} plus {notified, refundedCredits} or {completed, noShows, penaltyCredits}.
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

// cancelSession cancels every open booking, refunds the credits already
// taken for the session (check-in, late cancel, no-show), clears pass
// strikes and tells each member what came back. Refunds carry idempotency
// keys, so a repeated run never pays twice.
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
	charges, err := s.repo.SessionCharges(ctx, q, session.ID)
	if err != nil {
		return err
	}
	refunded, total := map[string]int{}, 0
	for _, c := range charges {
		if err := s.Credits.Refund(ctx, q, CreditMovement{
			CustomerID: c.CustomerID, Amount: c.Amount, SourceType: "class_booking", SourceID: c.BookingID,
			IdempotencyKey: "gym:session_cancel:" + c.Key, Note: "Kelas dibatalkan studio: " + session.label(),
		}); err != nil {
			return err
		}
		if !slices.Contains(customers, c.CustomerID) {
			customers = append(customers, c.CustomerID)
		}
		refunded[c.CustomerID] += c.Amount
		total += c.Amount
	}
	if err := s.repo.ClearPassStrikes(ctx, q, session.ID); err != nil {
		return err
	}
	rules, err := s.Rules.ForBranch(ctx, q, session.BranchID)
	if err != nil {
		return err
	}
	deliverAfter, err := s.stampChange(ctx, q, session, changeCancelled, session.StartsAt, rules, false)
	if err != nil {
		return err
	}
	for _, c := range customers {
		body := "Kelas " + session.when() + " dibatalkan studio. Kredit Anda tidak terpotong."
		if n := refunded[c]; n > 0 {
			body = "Kelas " + session.when() + " dibatalkan studio. " + strconv.Itoa(n) +
				" kredit dikembalikan ke saldo Anda."
		}
		if err := s.Notifier.NotifyMember(ctx, q, c, Notification{
			Type: "gym_session_cancelled", Title: "Kelas dibatalkan: " + session.ClassTypeName, Body: body,
			DeliverAfter: deliverAfter,
		}); err != nil {
			return err
		}
	}
	out.Set("notified", len(customers))
	out.Set("refundedCredits", total)
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

// CompletePastSessions closes every published or full session that ended
// more than graceMinutes before now, one transaction per session, the same
// way the "complete" action does (absent members become no-shows). It
// returns how many it closed; meant for a periodic job.
func (s *Service) CompletePastSessions(ctx context.Context, now time.Time, graceMinutes int) (int, error) {
	ids, err := s.repo.EndedOpenSessions(ctx, s.db, now.Add(-time.Duration(graceMinutes)*time.Minute))
	if err != nil {
		return 0, err
	}
	closed := 0
	for _, id := range ids {
		err := s.inTx(ctx, func(q Q) error {
			session, err := s.repo.LockSession(ctx, q, id)
			// Deleted or closed by staff since the list was read.
			if err != nil || session == nil || !domain.CanTransitionSession(session.Status, domain.SessionCompleted) {
				return err
			}
			if err := s.completeSession(ctx, q, session, newRow()); err != nil {
				return err
			}
			closed++
			return nil
		})
		if err != nil {
			return closed, err
		}
	}
	return closed, nil
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

var dateOnlyPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// localMidnight reads YYYY-MM-DD as 00:00 in loc the way
// `new Date("…T00:00:00+07:00")` does: month 1-12, day 1-31, and a day past
// the month's end rolls over.
func localMidnight(day string, loc *time.Location) (time.Time, bool) {
	if !dateOnlyPattern.MatchString(day) {
		return time.Time{}, false
	}
	y, _ := strconv.Atoi(day[0:4])
	m, _ := strconv.Atoi(day[5:7])
	d, _ := strconv.Atoi(day[8:10])
	if m < 1 || m > 12 || d < 1 || d > 31 {
		return time.Time{}, false
	}
	return time.Date(y, time.Month(m), d, 0, 0, 0, 0, loc), true
}

// DuplicateWeek copies every non-cancelled session of the source week
// (seven days from sourceWeek, each session's dates in its branch zone) to
// the target week, same local times and coach. A slot already taken in the
// target week, or whose coach or room is busy then, is skipped. The unique
// slot index keeps concurrent copies from duplicating.
func (s *Service) DuplicateWeek(ctx context.Context, sourceWeek, targetWeek string, publish bool, createdBy *string) (DuplicateWeekResult, error) {
	var out DuplicateWeekResult
	// Only the calendar dates matter here, so any zone reads them.
	source, ok1 := localMidnight(sourceWeek, localtime.Jakarta)
	target, ok2 := localMidnight(targetWeek, localtime.Jakarta)
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
		if err := s.repo.LockSchedule(ctx, q); err != nil {
			return err
		}
		rows, err := s.repo.SessionsInWeek(ctx, q, source.Format(time.DateOnly))
		if err != nil {
			return err
		}
		rulesFor := s.branchRules(q)
		for _, w := range rows {
			startsAt, endsAt := domain.ShiftDays(w.StartsAt, dayShift), domain.ShiftDays(w.EndsAt, dayShift)
			clash, err := s.findConflict(ctx, q, domain.Slot{
				CoachID: w.CoachID, BranchID: w.BranchID, Area: w.Area, StartsAt: startsAt, EndsAt: endsAt,
			})
			if err != nil {
				return err
			}
			if clash != nil {
				continue
			}
			rules, err := rulesFor(ctx, w.BranchID)
			if err != nil {
				return err
			}
			opens, closes := domain.DeriveBookingWindow(startsAt, rules)
			id, err := s.repo.InsertSessionIfFree(ctx, q, NewSession{
				ClassTypeID: w.ClassTypeID, CoachID: w.CoachID, BranchID: w.BranchID, Area: w.Area,
				StartsAt: startsAt, Capacity: w.Capacity, CreditCost: w.CreditCost,
				BookingOpensAt: opens, BookingClosesAt: closes,
				Status: status, Notes: w.Notes, CreatedBy: createdBy,
			}, endsAt)
			if err != nil {
				return err
			}
			if id != "" {
				out.Created++
			}
		}
		out.Skipped = len(rows) - out.Created
		return nil
	})
	return out, err
}
