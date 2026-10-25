package app

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/gymcoaching"
	"nuhabit/backend/internal/modules/gymcoachleave"
	"nuhabit/backend/internal/modules/gymscheduling"
	"nuhabit/backend/internal/modules/hris"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// gym-coach-leave: the Program Director's queue, substitutes, blackout
// dates, coach discipline and the schedule change report.
//
// Sessions change through gym-scheduling and PT sessions through
// gym-coaching, on the caller's transaction. HRIS calls the module through
// its CoachLeaves port (hrisCoachLeaves below) when a coach's leave is
// submitted, decided or cancelled.
func init() {
	Register(gymcoachleave.Name, func(d module.Deps) module.Module {
		return gymcoachleave.New(d, coachLeavePorts(d))
	})
}

func coachLeavePorts(d module.Deps) gymcoachleave.Ports {
	return gymcoachleave.Ports{Schedule: coachLeaveSchedule{d: d}}
}

// coachLeaveService is the service behind the HRIS hooks.
func coachLeaveService(d module.Deps) *gymcoachleave.Service {
	return gymcoachleave.NewService(d.DB, coachLeavePorts(d), d.Now, d.Log)
}

// coachLeaveSchedule builds the scheduling and coaching services on the
// transaction it is handed.
type coachLeaveSchedule struct{ d module.Deps }

var _ gymcoachleave.Schedule = coachLeaveSchedule{}

func (s coachLeaveSchedule) scheduling(db gymcoachleave.DB) *gymscheduling.Service {
	return gymscheduling.NewService(db, gymscheduling.Postgres{}, schedulingPortsOn(s.d, db), s.d.Now)
}

func (s coachLeaveSchedule) coaching(db gymcoachleave.DB) *gymcoaching.Service {
	return gymcoaching.NewService(db, coachingPortsOn(s.d, db), s.d.Now, s.d.Log)
}

func (s coachLeaveSchedule) SetSessionCoach(ctx context.Context, db gymcoachleave.DB, sessionID, coachID string) error {
	return s.scheduling(db).UpdateSession(ctx, sessionID, gymscheduling.SessionPatch{
		CoachID: gymscheduling.Optional[string]{Set: true, Value: &coachID},
	})
}

func (s coachLeaveSchedule) CancelSession(ctx context.Context, db gymcoachleave.DB, sessionID string) error {
	_, err := s.scheduling(db).SessionAction(ctx, sessionID, "cancel")
	return err
}

func (s coachLeaveSchedule) SetPTCoach(ctx context.Context, db gymcoachleave.DB, appointmentID, coachID string, startsAt time.Time) error {
	return s.coaching(db).Reschedule(ctx, gymcoaching.RescheduleInput{AppointmentID: appointmentID, StartsAt: startsAt, CoachID: coachID})
}

func (s coachLeaveSchedule) CancelPT(ctx context.Context, db gymcoachleave.DB, appointmentID, reason string) error {
	return s.coaching(db).CancelAppointment(ctx, appointmentID, reason)
}

// hrisCoachLeaves adapts the gym-coach-leave hooks to the HRIS port.
type hrisCoachLeaves struct{ svc *gymcoachleave.Service }

var _ hris.CoachLeaves = hrisCoachLeaves{}

func (h hrisCoachLeaves) Screen(ctx context.Context, q database.Querier, in hris.CoachLeaveRequest) (hris.CoachLeaveScreen, error) {
	out, err := h.svc.Screen(ctx, q, gymcoachleave.LeaveRequest(in))
	return hris.CoachLeaveScreen(out), err
}

func (h hrisCoachLeaves) Submitted(ctx context.Context, q database.Querier, leaveID string) error {
	return h.svc.Submitted(ctx, q, leaveID)
}

func (h hrisCoachLeaves) Decider(ctx context.Context, q database.Querier, leaveID, userID string) (hris.CoachLeaveDecider, error) {
	out, err := h.svc.Decider(ctx, q, leaveID, userID)
	return hris.CoachLeaveDecider(out), err
}

func (h hrisCoachLeaves) Decided(ctx context.Context, q database.Querier, in hris.CoachLeaveDecision) error {
	return h.svc.Decided(ctx, q, gymcoachleave.Decision(in))
}

func (h hrisCoachLeaves) Cancelled(ctx context.Context, q database.Querier, leaveID string) error {
	return h.svc.Cancelled(ctx, q, leaveID)
}
