package gymcoachleave

import (
	"context"
	"strings"

	"nuhabit/backend/internal/modules/gymcoachleave/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
)

// The HRIS leave flow calls these through its CoachLeaves port (the adapter
// lives in internal/app). Each runs on the querier HRIS passes, the leave's
// transaction where there is one.

// LeaveRequest is a leave about to be stored.
type LeaveRequest struct {
	EmployeeID, LeaveType, StartDate, EndDate string
	BlackoutException, RecordedByHR           bool
}

// Screening is the verdict on a leave request; Coach false means the
// employee coaches no class.
type Screening struct {
	Coach       bool
	ShortNotice bool
	NoticeDays  int
	Refusal     string
}

// Screen applies the minimum notice and the blackout dates to a coach's
// request. The submission day is today in the coach's branch zone.
func (s *Service) Screen(ctx context.Context, q database.Querier, in LeaveRequest) (Screening, error) {
	coach, err := coachForEmployee(ctx, q, in.EmployeeID)
	if err != nil || coach == nil {
		return Screening{}, err
	}
	zone, err := localtime.BranchZone(ctx, q, coach.BranchID)
	if err != nil {
		return Screening{}, err
	}
	settings, err := loadSettings(ctx, q)
	if err != nil {
		return Screening{}, err
	}
	rule := settings.NoticeRules[in.LeaveType]
	verdict := domain.EvaluateNotice(rule, in.StartDate, localtime.DayKey(s.now(), zone), in.RecordedByHR)
	out := Screening{Coach: true, ShortNotice: verdict.ShortNotice, NoticeDays: verdict.NoticeDays}
	if !verdict.OK {
		out.Refusal = domain.NoticeRefusal(in.LeaveType, rule, verdict.EarliestStart)
		return out, nil
	}
	if in.BlackoutException || in.RecordedByHR {
		return out, nil
	}
	list, err := blackoutsFor(ctx, q, coach.BranchID, in.StartDate, in.EndDate)
	if err != nil {
		return Screening{}, err
	}
	if hits := domain.BlackoutConflicts(rule, list, in.StartDate, in.EndDate); len(hits) > 0 {
		out.Refusal = domain.BlackoutRefusal(in.LeaveType, hits)
	}
	return out, nil
}

// Submitted creates the covers of a new coach leave and tells the approvers.
func (s *Service) Submitted(ctx context.Context, q database.Querier, leaveID string) error {
	l, err := loadLeave(ctx, q, leaveID)
	if err != nil || l == nil {
		return err
	}
	if err := syncCovers(ctx, q, l); err != nil {
		return err
	}
	covers, err := leaveCovers(ctx, q, l.ID)
	if err != nil {
		return err
	}
	resolved, err := s.approvers(ctx, q, l.RequesterUserID)
	if err != nil {
		return err
	}
	title := "Cuti coach menunggu persetujuan: " + l.Coach.Name
	kind := "approval"
	if l.ShortNotice {
		title, kind = "Cuti mendadak coach: "+l.Coach.Name, "alert"
	}
	body := domain.Label(l.LeaveType) + " " + dateRange(l) + ". "
	if len(covers) > 0 {
		body += itoa(len(covers)) + " sesi perlu pengganti."
	} else {
		body += "Tidak ada sesi terdampak."
	}
	for _, a := range resolved.List {
		if err := notifyUser(ctx, q, a.UserID, inboxNotice{Title: title, Body: body, Link: queueLink, Kind: kind}); err != nil {
			return err
		}
	}
	return nil
}

// Decider tells whether the leave belongs to a coach and whether userID may
// decide it.
type Decider struct {
	Coach, Allowed bool
	Reason         string
}

// Decider is who may decide a leave.
func (s *Service) Decider(ctx context.Context, q database.Querier, leaveID, userID string) (Decider, error) {
	l, err := loadLeave(ctx, q, leaveID)
	if err != nil || l == nil {
		return Decider{}, err
	}
	ok, reason, err := s.canDecide(ctx, q, l, userID)
	return Decider{Coach: true, Allowed: ok, Reason: reason}, err
}

// Decision is a decided coach leave.
type Decision struct {
	LeaveID          string
	Approved         bool
	ActorUserID      string
	BlackoutOverride string
}

// Decided runs inside the HRIS decision. Approving needs every affected
// session resolved and, on a blackout, the approver's reason; it hands the
// sessions over, turns the leave into time off and records a short notice
// incident. Rejecting voids the covers.
func (s *Service) Decided(ctx context.Context, q database.Querier, in Decision) error {
	l, err := loadLeave(ctx, q, in.LeaveID)
	if err != nil || l == nil {
		return err
	}
	if !in.Approved {
		if err := voidCovers(ctx, q, l.ID, "Cuti ditolak"); err != nil {
			return err
		}
		return notifyCoach(ctx, q, l.Coach.ID, inboxNotice{
			Title: "Cuti ditolak", Body: domain.Label(l.LeaveType) + " " + dateRange(l) + " ditolak.", Link: portalLink, Kind: "status_change",
		})
	}
	db, err := asDB(q)
	if err != nil {
		return err
	}
	// Uncovered sessions are the first thing to fix, so they are checked
	// before the blackout; an error later rolls the hand-over back.
	if err := syncCovers(ctx, db, l); err != nil {
		return err
	}
	if _, err := s.applyCovers(ctx, db, l); err != nil {
		return err
	}
	if err := s.checkBlackout(ctx, db, l, in); err != nil {
		return err
	}
	if err := syncTimeOff(ctx, db, l, in.ActorUserID); err != nil {
		return err
	}
	if l.ShortNotice {
		if err := s.recordShortNotice(ctx, db, l, in.ActorUserID); err != nil {
			return err
		}
	}
	return notifyCoach(ctx, db, l.Coach.ID, inboxNotice{
		Title: "Cuti disetujui", Body: domain.Label(l.LeaveType) + " " + dateRange(l) + " disetujui.", Link: portalLink, Kind: "status_change",
	})
}

// checkBlackout refuses approval on a blackout without the approver's
// reason and stores the reason given.
func (s *Service) checkBlackout(ctx context.Context, q database.Querier, l *Leave, in Decision) error {
	settings, err := loadSettings(ctx, q)
	if err != nil {
		return err
	}
	list, err := blackoutsFor(ctx, q, l.Coach.BranchID, l.StartDate, l.EndDate)
	if err != nil {
		return err
	}
	hits := domain.BlackoutConflicts(settings.NoticeRules[l.LeaveType], list, l.StartDate, l.EndDate)
	if len(hits) == 0 {
		return nil
	}
	reason := strings.TrimSpace(in.BlackoutOverride)
	if len([]rune(reason)) < domain.MinOverrideReason {
		return httpx.Coded(400, "BLACKOUT_OVERRIDE_REQUIRED",
			"Cuti ini jatuh di tanggal blackout: "+domain.DescribeBlackouts(hits)+
				". Tulis alasan pengecualian (minimal 10 karakter) untuk menyetujuinya.", nil)
	}
	_, err = q.Exec(ctx, `UPDATE hris.leaves SET blackout_override_reason = $2, blackout_override_by = $3, blackout_override_at = now()
	  WHERE id = $1`, l.ID, reason, in.ActorUserID)
	return err
}

// Cancelled voids the covers not applied yet and removes the time off.
// Sessions already handed to a substitute stay with them.
func (s *Service) Cancelled(ctx context.Context, q database.Querier, leaveID string) error {
	if err := voidCovers(ctx, q, leaveID, "Cuti dibatalkan"); err != nil {
		return err
	}
	return removeTimeOff(ctx, q, leaveID)
}

// ── Time off ────────────────────────────────────────────────────────────────

// syncTimeOff turns an approved leave into full-day time off for each of
// its days, after checking the coach teaches nothing left in the range.
func syncTimeOff(ctx context.Context, db DB, l *Leave, actorID string) error {
	from, to, _, err := span(ctx, db, l.Coach.BranchID, l.StartDate, l.EndDate)
	if err != nil {
		return err
	}
	left, err := affectedSessions(ctx, db, l.Coach.ID, from, to)
	if err != nil {
		return err
	}
	if len(left) > 0 {
		return httpx.Coded(409, "COACH_STILL_SCHEDULED",
			"Coach masih memegang "+itoa(len(left))+" sesi di tanggal cuti ("+left[0].ClassName+" "+
				at(left[0].StartsAt, left[0].Timezone)+"). Pindahkan dulu sesinya.", map[string]any{"count": len(left)})
	}
	_, err = db.Exec(ctx, `INSERT INTO gym.coach_availability_exceptions (coach_id, date, kind, note, created_by, leave_id)
	    SELECT $1, d::date, 'off', $4, $5, $6 FROM generate_series($2::date, $3::date, interval '1 day') d
	    ON CONFLICT (leave_id, date) WHERE leave_id IS NOT NULL DO NOTHING`,
		l.Coach.ID, l.StartDate, l.EndDate, "Cuti: "+domain.Label(l.LeaveType), nullUUID(actorID), l.ID)
	return err
}

// removeTimeOff deletes the time off a leave created; manual time off stays.
func removeTimeOff(ctx context.Context, q database.Querier, leaveID string) error {
	_, err := q.Exec(ctx, `DELETE FROM gym.coach_availability_exceptions WHERE leave_id = $1`, leaveID)
	return err
}

func dateRange(l *Leave) string {
	if l.StartDate == l.EndDate {
		return l.StartDate
	}
	return l.StartDate + " s.d. " + l.EndDate
}

func nullUUID(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
