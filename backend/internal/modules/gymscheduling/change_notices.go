package gymscheduling

import (
	"context"
	"strconv"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/localtime"
)

// Studio changes members hear about: a move, a coach change or a
// cancellation. Each stamps the session for the Program Director's change
// report and the free cancel window, and its notices wait out the quiet
// hours of the branch.

const (
	changeCoach     = "coach_changed"
	changeMoved     = "moved"
	changeCancelled = "cancelled"
)

// stampChange records the change on the session (late when announced less
// than changeNoticeMinHours before startsAt; coach_changed_at when the coach
// changed, alone or with a move) and returns when its notices may be
// delivered.
func (s *Service) stampChange(ctx context.Context, q Q, session *SessionRow, kind string, startsAt time.Time, rules domain.Rules, coachChanged bool) (time.Time, error) {
	now := s.now()
	late := domain.ChangeNoticeLate(startsAt, now, rules.ChangeNoticeMinHours)
	_, err := q.Exec(ctx, `UPDATE gym.class_sessions
	    SET changed_at = $2, change_kind = $3, change_notice_late = $4,
	        coach_changed_at = CASE WHEN $5 THEN $2 ELSE coach_changed_at END
	  WHERE id = $1`, session.ID, now, kind, late, coachChanged)
	if err != nil {
		return time.Time{}, err
	}
	return domain.ChangeNoticeAt(now, startsAt, session.Zone), nil
}

// freeCancelHint tells members booked before a change how long they may
// cancel free; empty when the rule is off.
func freeCancelHint(rules domain.Rules) string {
	if rules.ChangeFreeCancelHours <= 0 {
		return ""
	}
	return " Bila tidak bisa hadir, batalkan dari portal dalam " + strconv.Itoa(rules.ChangeFreeCancelHours) +
		" jam tanpa potongan kredit."
}

// checkCoachLeave rejects a slot whose coach has the day off for an
// approved leave (time off synced from HRIS, linked by leave_id).
func (s *Service) checkCoachLeave(ctx context.Context, q Q, slot domain.Slot) error {
	if slot.CoachID == nil {
		return nil
	}
	zone, err := localtime.BranchZone(ctx, q, slot.BranchID)
	if err != nil {
		return err
	}
	var onLeave bool
	err = q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gym.coach_availability_exceptions e
	    WHERE e.coach_id = $1 AND e.leave_id IS NOT NULL AND e.kind = 'off'
	      AND e.date >= ($2::timestamptz AT TIME ZONE $4)::date AND e.date <= ($3::timestamptz AT TIME ZONE $4)::date)`,
		*slot.CoachID, slot.StartsAt, slot.EndsAt.Add(-time.Nanosecond), localtime.Name(zone)).Scan(&onLeave)
	if err != nil || !onLeave {
		return err
	}
	return schedulingError("Coach sedang cuti pada tanggal ini")
}
