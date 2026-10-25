package hris

import (
	"context"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// CoachLeaves applies the gym's coach leave rules to the leave of an
// employee whose account coaches classes (gym-coach-leave): minimum notice
// and blackout dates at submission, substitutes for the affected sessions,
// and the Program Director as the one who decides. Every method runs on the
// caller's querier, the leave's transaction where there is one. A nil port
// leaves every leave to HR and the direct manager.
type CoachLeaves interface {
	// Screen runs before a leave is stored.
	Screen(ctx context.Context, q database.Querier, in CoachLeaveRequest) (CoachLeaveScreen, error)
	// Submitted runs after the leave of a coach is inserted.
	Submitted(ctx context.Context, q database.Querier, leaveID string) error
	// Decider tells whether the leave belongs to a coach and whether userID
	// may decide it.
	Decider(ctx context.Context, q database.Querier, leaveID, userID string) (CoachLeaveDecider, error)
	// Decided runs after the status of a coach's leave changed to approved
	// or rejected; an error rolls the decision back.
	Decided(ctx context.Context, q database.Querier, in CoachLeaveDecision) error
	// Cancelled runs after a leave was cancelled.
	Cancelled(ctx context.Context, q database.Querier, leaveID string) error
}

// CoachLeaveRequest is a leave about to be stored. RecordedByHR: HR enters
// it for someone else, so a late notice is flagged instead of refused.
type CoachLeaveRequest struct {
	EmployeeID, LeaveType, StartDate, EndDate string
	BlackoutException, RecordedByHR           bool
}

// CoachLeaveScreen is the verdict on a leave request. Coach is false for an
// employee who coaches no class, and the rest is then empty. A non-empty
// Refusal rejects the request with that message.
type CoachLeaveScreen struct {
	Coach       bool
	ShortNotice bool
	NoticeDays  int
	Refusal     string
}

// CoachLeaveDecider: Allowed says whether the user may decide a coach's
// leave; Reason explains a refusal.
type CoachLeaveDecider struct {
	Coach   bool
	Allowed bool
	Reason  string
}

// CoachLeaveDecision is a decided coach leave.
type CoachLeaveDecision struct {
	LeaveID     string
	Approved    bool
	ActorUserID string
	// BlackoutOverride is the reason the approver gives for leave that falls
	// on a blackout date.
	BlackoutOverride string
}

// screenCoachLeave applies the coach rules to a new request; the zero
// screen when the port is off or the employee coaches no class.
func (s *Service) screenCoachLeave(ctx context.Context, a *Actor, employeeID string, in leaveRequest) (CoachLeaveScreen, error) {
	if s.coachLeaves == nil {
		return CoachLeaveScreen{}, nil
	}
	own := a.EmployeeID != nil && *a.EmployeeID == employeeID
	screen, err := s.coachLeaves.Screen(ctx, s.repo.querier(), CoachLeaveRequest{
		EmployeeID: employeeID, LeaveType: in.LeaveType, StartDate: in.StartDate, EndDate: in.EndDate,
		BlackoutException: in.BlackoutException, RecordedByHR: a.IsHR && !own,
	})
	if err != nil {
		return CoachLeaveScreen{}, err
	}
	if screen.Refusal != "" {
		return CoachLeaveScreen{}, httpx.BadRequest(screen.Refusal)
	}
	return screen, nil
}

// coachDecider is the port's Decider, or not a coach leave without the port.
func (s *Service) coachDecider(ctx context.Context, leaveID, userID string) (CoachLeaveDecider, error) {
	if s.coachLeaves == nil {
		return CoachLeaveDecider{}, nil
	}
	return s.coachLeaves.Decider(ctx, s.repo.querier(), leaveID, userID)
}
