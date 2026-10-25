package gymcoachleave

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcoachleave/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Cover is one affected session of a leave with its substitute.
type Cover struct {
	ID                string             `json:"id"`
	LeaveID           string             `json:"leave_id"`
	Status            domain.CoverStatus `json:"status"`
	Kind              string             `json:"kind"` // class or pt
	SessionID         *string            `json:"session_id"`
	PTAppointmentID   *string            `json:"pt_appointment_id"`
	CoachID           string             `json:"coach_id"`
	CoachName         string             `json:"coach_name"`
	SubstituteCoachID *string            `json:"substitute_coach_id"`
	SubstituteName    *string            `json:"substitute_name"`
	RequestedAt       *time.Time         `json:"requested_at"`
	RespondBy         *time.Time         `json:"respond_by"`
	RespondedAt       *time.Time         `json:"responded_at"`
	CancelReason      *string            `json:"cancel_reason"`
	Note              *string            `json:"note"`
	AppliedAt         *time.Time         `json:"applied_at"`
	StartsAt          time.Time          `json:"starts_at"`
	EndsAt            time.Time          `json:"ends_at"`
	ClassName         string             `json:"class_name"`
	ClassTypeID       string             `json:"class_type_id"`
	TargetStatus      string             `json:"session_status"`
	BranchID          *string            `json:"branch_id"`
	Booked            int                `json:"booked"`
	Timezone          string             `json:"timezone"`
}

func (c *Cover) personal() bool { return c.Kind == "pt" }

// open reports whether the session still runs (a class not yet done or
// cancelled, a PT session requested or confirmed).
func (c *Cover) open() bool {
	switch c.TargetStatus {
	case "draft", "published", "full", "requested", "confirmed":
		return true
	}
	return false
}

const coverSelect = `SELECT cv.id::text, cv.leave_id::text, cv.status,
       CASE WHEN cv.session_id IS NOT NULL THEN 'class' ELSE 'pt' END,
       cv.session_id::text, cv.pt_appointment_id::text, cv.coach_id::text, oc.name,
       cv.substitute_coach_id::text, sc.name, cv.requested_at, cv.respond_by, cv.responded_at,
       cv.cancel_reason, cv.note, cv.applied_at,
       COALESCE(s.starts_at, a.starts_at), COALESCE(s.ends_at, a.ends_at), t.name, t.id::text,
       COALESCE(s.status, a.status), COALESCE(s.branch_id, a.branch_id)::text,
       CASE WHEN s.id IS NOT NULL
            THEN (SELECT count(*) FROM gym.bookings b WHERE b.session_id = s.id AND b.status IN ('confirmed', 'checked_in', 'waitlist'))
            ELSE (SELECT count(*) FROM gym.pt_participants p WHERE p.appointment_id = a.id AND p.status IN ('requested', 'confirmed'))
       END::int,
       COALESCE(br.timezone, 'Asia/Jakarta')
  FROM gym.coach_leave_covers cv
  JOIN gym.coaches oc ON oc.id = cv.coach_id
  LEFT JOIN gym.coaches sc ON sc.id = cv.substitute_coach_id
  LEFT JOIN gym.class_sessions s ON s.id = cv.session_id
  LEFT JOIN gym.pt_appointments a ON a.id = cv.pt_appointment_id
  JOIN gym.class_types t ON t.id = COALESCE(s.class_type_id, a.class_type_id)
  LEFT JOIN configuration.branches br ON br.id = COALESCE(s.branch_id, a.branch_id)`

func scanCover(r pgx.CollectableRow) (*Cover, error) {
	var c Cover
	err := r.Scan(&c.ID, &c.LeaveID, &c.Status, &c.Kind, &c.SessionID, &c.PTAppointmentID, &c.CoachID, &c.CoachName,
		&c.SubstituteCoachID, &c.SubstituteName, &c.RequestedAt, &c.RespondBy, &c.RespondedAt, &c.CancelReason, &c.Note,
		&c.AppliedAt, &c.StartsAt, &c.EndsAt, &c.ClassName, &c.ClassTypeID, &c.TargetStatus, &c.BranchID, &c.Booked, &c.Timezone)
	return &c, err
}

func queryCovers(ctx context.Context, q database.Querier, where string, args ...any) ([]*Cover, error) {
	rows, err := q.Query(ctx, coverSelect+` WHERE `+where+` ORDER BY 17`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanCover)
}

func loadCover(ctx context.Context, q database.Querier, id string) (*Cover, error) {
	list, err := queryCovers(ctx, q, `cv.id = $1`, id)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return list[0], nil
}

// leaveCovers are the covers of a leave that still count (not void).
func leaveCovers(ctx context.Context, q database.Querier, leaveID string) ([]*Cover, error) {
	return queryCovers(ctx, q, `cv.leave_id = $1 AND cv.status <> 'void'`, leaveID)
}

// syncCovers matches the covers with the sessions the leave touches today:
// a new session gets an open cover, a cover voided earlier for a session
// that is affected again reopens, and a session no longer affected (moved,
// cancelled, handed to another coach) voids its cover.
func syncCovers(ctx context.Context, q database.Querier, l *Leave) error {
	from, to, _, err := span(ctx, q, l.Coach.BranchID, l.StartDate, l.EndDate)
	if err != nil {
		return err
	}
	list, err := affectedSessions(ctx, q, l.Coach.ID, from, to)
	if err != nil {
		return err
	}
	var classes, pts []string
	for _, a := range list {
		if a.Kind == "class" {
			classes = append(classes, a.ID)
			_, err = q.Exec(ctx, `INSERT INTO gym.coach_leave_covers (leave_id, coach_id, session_id) VALUES ($1, $2, $3)
			    ON CONFLICT (leave_id, session_id) WHERE session_id IS NOT NULL DO UPDATE
			    SET status = 'open', note = NULL, updated_at = now()
			    WHERE coach_leave_covers.status = 'void' AND coach_leave_covers.applied_at IS NULL`, l.ID, l.Coach.ID, a.ID)
		} else {
			pts = append(pts, a.ID)
			_, err = q.Exec(ctx, `INSERT INTO gym.coach_leave_covers (leave_id, coach_id, pt_appointment_id) VALUES ($1, $2, $3)
			    ON CONFLICT (leave_id, pt_appointment_id) WHERE pt_appointment_id IS NOT NULL DO UPDATE
			    SET status = 'open', note = NULL, updated_at = now()
			    WHERE coach_leave_covers.status = 'void' AND coach_leave_covers.applied_at IS NULL`, l.ID, l.Coach.ID, a.ID)
		}
		if err != nil {
			return err
		}
	}
	_, err = q.Exec(ctx, `UPDATE gym.coach_leave_covers
	    SET status = 'void', note = 'Sesi tidak lagi terdampak cuti', updated_at = now()
	  WHERE leave_id = $1 AND status <> 'void' AND applied_at IS NULL
	    AND NOT (COALESCE(session_id = ANY ($2::uuid[]), false) OR COALESCE(pt_appointment_id = ANY ($3::uuid[]), false))`,
		l.ID, classes, pts)
	return err
}

// voidCovers voids every cover of a leave not applied yet.
func voidCovers(ctx context.Context, q database.Querier, leaveID, note string) error {
	_, err := q.Exec(ctx, `UPDATE gym.coach_leave_covers SET status = 'void', note = $2, updated_at = now()
	  WHERE leave_id = $1 AND status <> 'void' AND applied_at IS NULL`, leaveID, note)
	return err
}

// expireRequests turns requests past their deadline back to open.
func expireRequests(ctx context.Context, q database.Querier, now time.Time) error {
	_, err := q.Exec(ctx, `UPDATE gym.coach_leave_covers cv
	    SET status = 'open', substitute_coach_id = NULL, updated_at = now(),
	        note = 'Tidak dijawab ' || COALESCE((SELECT name FROM gym.coaches WHERE id = cv.substitute_coach_id), 'pengganti')
	               || ' sebelum batas waktu'
	  WHERE status = 'requested' AND respond_by < $1`, now)
	return err
}

// ── Substitute candidates ───────────────────────────────────────────────────

// candidates lists every other active coach of the branch with the facts
// the ranking needs.
func candidates(ctx context.Context, q database.Querier, c *Cover) ([]domain.Candidate, error) {
	rows, err := q.Query(ctx, `
	SELECT c.id::text, c.name,
	  (EXISTS (SELECT 1 FROM gym.class_sessions o WHERE o.coach_id = c.id AND o.status <> 'cancelled'
	           AND o.starts_at < $3 AND o.ends_at > $2)
	   OR EXISTS (SELECT 1 FROM gym.pt_appointments p WHERE p.coach_id = c.id AND p.status IN ('requested', 'confirmed')
	           AND p.starts_at < $3 AND p.ends_at > $2)
	   OR EXISTS (SELECT 1 FROM gym.coach_leave_covers x
	           LEFT JOIN gym.class_sessions xs ON xs.id = x.session_id
	           LEFT JOIN gym.pt_appointments xa ON xa.id = x.pt_appointment_id
	          WHERE x.substitute_coach_id = c.id AND x.id <> $6 AND x.applied_at IS NULL
	            AND x.status IN ('requested', 'accepted', 'assigned')
	            AND COALESCE(xs.starts_at, xa.starts_at) < $3 AND COALESCE(xs.ends_at, xa.ends_at) > $2)),
	  (EXISTS (SELECT 1 FROM gym.coach_availability_exceptions e
	          WHERE e.coach_id = c.id AND e.kind = 'off' AND e.date = ($2::timestamptz AT TIME ZONE $7)::date
	            AND (e.start_time IS NULL OR (e.start_time < ($3::timestamptz AT TIME ZONE $7)::time
	                                          AND e.end_time > ($2::timestamptz AT TIME ZONE $7)::time)))
	   OR EXISTS (SELECT 1 FROM hris.leaves l JOIN hris.employees he ON he.id = l.employee_id
	          WHERE he.user_id = c.user_id AND l.status = 'approved'
	            AND ($2::timestamptz AT TIME ZONE $7)::date BETWEEN l.start_date AND l.end_date)),
	  CASE WHEN $8 THEN EXISTS (SELECT 1 FROM gym.coach_availability w WHERE w.coach_id = c.id)
	       ELSE EXISTS (SELECT 1 FROM gym.class_sessions h WHERE h.coach_id = c.id AND h.class_type_id = $5 AND h.status <> 'cancelled')
	  END,
	  (SELECT count(*) FROM gym.class_sessions w WHERE w.coach_id = c.id AND w.status <> 'cancelled'
	      AND w.starts_at >= (date_trunc('week', $2::timestamptz AT TIME ZONE $7) AT TIME ZONE $7)
	      AND w.starts_at < ((date_trunc('week', $2::timestamptz AT TIME ZONE $7) + interval '7 days') AT TIME ZONE $7))::int
	  FROM gym.coaches c
	 WHERE c.status = 'active' AND c.id <> $1 AND ($4::uuid IS NULL OR c.branch_id IS NULL OR c.branch_id = $4)
	 ORDER BY c.name`, c.CoachID, c.StartsAt, c.EndsAt, c.BranchID, c.ClassTypeID, c.ID, c.Timezone, c.personal())
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Candidate, error) {
		var x domain.Candidate
		err := r.Scan(&x.CoachID, &x.Name, &x.Clash, &x.OnLeave, &x.Qualified, &x.WeekLoad)
		return x, err
	})
}

// Suggestions are the free coaches for a cover, best first.
func suggestions(ctx context.Context, q database.Querier, c *Cover) ([]domain.Candidate, error) {
	list, err := candidates(ctx, q, c)
	if err != nil {
		return nil, err
	}
	return domain.RankSubstitutes(list, c.personal()), nil
}

func requireSuggested(ctx context.Context, q database.Querier, c *Cover, coachID string) error {
	list, err := suggestions(ctx, q, c)
	if err != nil {
		return err
	}
	for _, x := range list {
		if x.CoachID == coachID {
			return nil
		}
	}
	return conflict("Coach ini tidak tersedia di jam itu (bentrok, sedang cuti, atau tidak memegang sesi PT)")
}

// ── Coach portal actions ────────────────────────────────────────────────────

// pendingLeaveCover loads a cover whose leave still waits for a decision.
func pendingLeaveCover(ctx context.Context, q database.Querier, id string) (*Cover, *Leave, error) {
	c, err := loadCover(ctx, q, id)
	if err != nil {
		return nil, nil, err
	}
	if c == nil {
		return nil, nil, httpx.NotFound("Sesi tidak ditemukan")
	}
	l, err := loadLeave(ctx, q, c.LeaveID)
	if err != nil {
		return nil, nil, err
	}
	if l == nil || l.Status != "pending" {
		return nil, nil, conflict("Cuti ini sudah diproses; pengganti tidak bisa diubah lagi")
	}
	return c, l, nil
}

// Candidates are the suggestions for a cover of coachID's leave (nil
// coachID: the Program Director, any cover).
func (s *Service) Candidates(ctx context.Context, coverID string, coachID *string) ([]domain.Candidate, error) {
	if err := expireRequests(ctx, s.db, s.now()); err != nil {
		return nil, err
	}
	c, err := loadCover(ctx, s.db, coverID)
	if err != nil {
		return nil, err
	}
	if c == nil || (coachID != nil && c.CoachID != *coachID) {
		return nil, httpx.NotFound("Sesi tidak ditemukan")
	}
	return suggestions(ctx, s.db, c)
}

// RequestSubstitute is the coach on leave asking substituteID to take a session.
func (s *Service) RequestSubstitute(ctx context.Context, coverID, coachID, substituteID string) (*Cover, error) {
	now := s.now()
	var out *Cover
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if err := expireRequests(ctx, tx, now); err != nil {
			return err
		}
		c, _, err := pendingLeaveCover(ctx, tx, coverID)
		if err != nil {
			return err
		}
		if c.CoachID != coachID {
			return httpx.NotFound("Sesi tidak ditemukan")
		}
		if _, ok := domain.Transition(c.Status, domain.EventRequest); !ok {
			return conflict("Sesi ini sudah punya pengganti atau sedang menunggu jawaban")
		}
		if err := requireSuggested(ctx, tx, c, substituteID); err != nil {
			return err
		}
		settings, err := loadSettings(ctx, tx)
		if err != nil {
			return err
		}
		respondBy := domain.RespondBy(now, settings.SubstituteResponseHours, c.StartsAt)
		tag, err := tx.Exec(ctx, `UPDATE gym.coach_leave_covers
		    SET status = 'requested', substitute_coach_id = $2, requested_at = $3, respond_by = $4,
		        responded_at = NULL, note = NULL, updated_at = now()
		  WHERE id = $1 AND status IN ('open', 'declined')`, coverID, substituteID, now, respondBy)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return conflict("Sesi ini baru saja berubah, muat ulang")
		}
		if err := notifyCoach(ctx, tx, substituteID, inboxNotice{
			Title: "Permintaan menggantikan: " + c.ClassName,
			Body:  c.CoachName + " cuti dan meminta Anda menggantikan " + c.ClassName + " " + when(c) + ". Jawab sebelum " + at(respondBy, c.Timezone) + ".",
			Link:  portalLink, Kind: "approval",
		}); err != nil {
			return err
		}
		out, err = loadCover(ctx, tx, coverID)
		return err
	})
	return out, err
}

// RespondToRequest is the asked substitute accepting or declining.
func (s *Service) RespondToRequest(ctx context.Context, coverID, coachID string, accept bool) (*Cover, error) {
	now := s.now()
	var out *Cover
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if err := expireRequests(ctx, tx, now); err != nil {
			return err
		}
		c, _, err := pendingLeaveCover(ctx, tx, coverID)
		if err != nil {
			return err
		}
		if c.SubstituteCoachID == nil || *c.SubstituteCoachID != coachID || c.Status != domain.CoverRequested {
			return conflict("Permintaan ini sudah tidak berlaku (sudah dijawab, lewat batas waktu, atau dialihkan)")
		}
		ev, note := domain.EventDecline, "Ditolak "+derefOr(c.SubstituteName, "pengganti")
		if accept {
			ev, note = domain.EventAccept, ""
			list, err := candidates(ctx, tx, c)
			if err != nil {
				return err
			}
			for _, x := range list {
				if x.CoachID == coachID && (x.Clash || x.OnLeave) {
					return conflict("Anda sudah punya jadwal atau cuti di jam itu")
				}
			}
		}
		to, _ := domain.Transition(c.Status, ev)
		if _, err := tx.Exec(ctx, `UPDATE gym.coach_leave_covers
		    SET status = $2, responded_at = $3, note = NULLIF($4, ''), updated_at = now()
		  WHERE id = $1`, coverID, to, now, note); err != nil {
			return err
		}
		verb := "menerima"
		if !accept {
			verb = "menolak"
		}
		if err := notifyCoach(ctx, tx, c.CoachID, inboxNotice{
			Title: "Jawaban pengganti: " + c.ClassName,
			Body:  derefOr(c.SubstituteName, "Pengganti") + " " + verb + " menggantikan " + c.ClassName + " " + when(c) + ".",
			Link:  portalLink, Kind: "status_change",
		}); err != nil {
			return err
		}
		out, err = loadCover(ctx, tx, coverID)
		return err
	})
	return out, err
}

// IncomingRequests are the covers asked of or given to coachID that are
// not applied yet.
func (s *Service) IncomingRequests(ctx context.Context, coachID string) ([]*Cover, error) {
	if err := expireRequests(ctx, s.db, s.now()); err != nil {
		return nil, err
	}
	return queryCovers(ctx, s.db, `cv.substitute_coach_id = $1 AND cv.status IN ('requested', 'accepted', 'assigned')
	    AND cv.applied_at IS NULL
	    AND EXISTS (SELECT 1 FROM hris.leaves l WHERE l.id = cv.leave_id AND l.status = 'pending')`, coachID)
}

// ── Program Director actions ────────────────────────────────────────────────

// decidable loads a cover the actor may decide: its leave is pending and
// the actor is one of its approvers.
func (s *Service) decidable(ctx context.Context, q database.Querier, coverID, actorID string) (*Cover, error) {
	c, l, err := pendingLeaveCover(ctx, q, coverID)
	if err != nil {
		return nil, err
	}
	if c.Status == domain.CoverVoid {
		return nil, conflict("Sesi ini sudah tidak terdampak cuti")
	}
	ok, reason, err := s.canDecide(ctx, q, l, actorID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, httpx.Forbidden(reason)
	}
	return c, nil
}

// AssignSubstitute is the Program Director appointing a substitute.
func (s *Service) AssignSubstitute(ctx context.Context, coverID, actorID, substituteID string) (*Cover, error) {
	var out *Cover
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		c, err := s.decidable(ctx, tx, coverID, actorID)
		if err != nil {
			return err
		}
		if err := requireSuggested(ctx, tx, c, substituteID); err != nil {
			return err
		}
		to, _ := domain.Transition(c.Status, domain.EventAssign)
		if _, err := tx.Exec(ctx, `UPDATE gym.coach_leave_covers
		    SET status = $2, substitute_coach_id = $3, decided_by = $4, respond_by = NULL, cancel_reason = NULL,
		        note = NULL, updated_at = now()
		  WHERE id = $1`, coverID, to, substituteID, actorID); err != nil {
			return err
		}
		if err := notifyCoach(ctx, tx, substituteID, inboxNotice{
			Title: "Anda ditunjuk sebagai pengganti: " + c.ClassName,
			Body:  "Program Director menunjuk Anda menggantikan " + c.CoachName + " di " + c.ClassName + " " + when(c) + ". Jadwal berlaku setelah cuti disetujui.",
			Link:  portalLink, Kind: "status_change",
		}); err != nil {
			return err
		}
		out, err = loadCover(ctx, tx, coverID)
		return err
	})
	return out, err
}

// CancelSession is the Program Director deciding the session is called off
// when the leave is approved.
func (s *Service) CancelSession(ctx context.Context, coverID, actorID, reason string) (*Cover, error) {
	var out *Cover
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		c, err := s.decidable(ctx, tx, coverID, actorID)
		if err != nil {
			return err
		}
		to, _ := domain.Transition(c.Status, domain.EventCancel)
		if _, err := tx.Exec(ctx, `UPDATE gym.coach_leave_covers
		    SET status = $2, substitute_coach_id = NULL, decided_by = $3, respond_by = NULL, cancel_reason = $4,
		        note = NULL, updated_at = now()
		  WHERE id = $1`, coverID, to, actorID, reason); err != nil {
			return err
		}
		out, err = loadCover(ctx, tx, coverID)
		return err
	})
	return out, err
}

// ── Approval ────────────────────────────────────────────────────────────────

// applyCovers hands each resolved session to its substitute or cancels it,
// on the approval's transaction. Every cover must be resolved first.
func (s *Service) applyCovers(ctx context.Context, db DB, l *Leave) ([]*Cover, error) {
	if _, err := db.Exec(ctx, `SELECT 1 FROM gym.coach_leave_covers WHERE leave_id = $1 FOR UPDATE`, l.ID); err != nil {
		return nil, err
	}
	covers, err := queryCovers(ctx, db, `cv.leave_id = $1 AND cv.status <> 'void' AND cv.applied_at IS NULL`, l.ID)
	if err != nil {
		return nil, err
	}
	statuses := make([]domain.CoverStatus, len(covers))
	for i, c := range covers {
		statuses[i] = c.Status
	}
	if n := domain.Blockers(statuses); n > 0 {
		return nil, httpx.Coded(409, "COVERS_PENDING",
			"Masih ada "+itoa(n)+" sesi tanpa pengganti. Tunjuk pengganti atau batalkan sesinya dulu.", map[string]any{"count": n})
	}
	var applied []*Cover
	for _, c := range covers {
		if !c.open() {
			if _, err := db.Exec(ctx, `UPDATE gym.coach_leave_covers SET status = 'void', note = 'Sesi sudah tidak terjadwal', updated_at = now()
			   WHERE id = $1`, c.ID); err != nil {
				return nil, err
			}
			continue
		}
		if err := s.applyCover(ctx, db, c, l); err != nil {
			return nil, err
		}
		if _, err := db.Exec(ctx, `UPDATE gym.coach_leave_covers SET applied_at = now(), updated_at = now() WHERE id = $1`, c.ID); err != nil {
			return nil, err
		}
		applied = append(applied, c)
	}
	return applied, nil
}

func (s *Service) applyCover(ctx context.Context, db DB, c *Cover, l *Leave) error {
	reason := derefOr(c.CancelReason, "Coach cuti")
	switch {
	case c.Status == domain.CoverCancelled && c.Kind == "class":
		return s.ports.Schedule.CancelSession(ctx, db, *c.SessionID)
	case c.Status == domain.CoverCancelled:
		return s.ports.Schedule.CancelPT(ctx, db, *c.PTAppointmentID, reason)
	case c.Kind == "class":
		if err := s.ports.Schedule.SetSessionCoach(ctx, db, *c.SessionID, *c.SubstituteCoachID); err != nil {
			return err
		}
		_, err := db.Exec(ctx, `UPDATE gym.class_sessions SET original_coach_id = COALESCE(original_coach_id, $2) WHERE id = $1`,
			*c.SessionID, c.CoachID)
		if err != nil {
			return err
		}
	default:
		if err := s.ports.Schedule.SetPTCoach(ctx, db, *c.PTAppointmentID, *c.SubstituteCoachID, c.StartsAt); err != nil {
			return err
		}
		_, err := db.Exec(ctx, `UPDATE gym.pt_appointments SET original_coach_id = COALESCE(original_coach_id, $2) WHERE id = $1`,
			*c.PTAppointmentID, c.CoachID)
		if err != nil {
			return err
		}
	}
	return notifyCoach(ctx, db, *c.SubstituteCoachID, inboxNotice{
		Title: "Jadwal pengganti: " + c.ClassName,
		Body:  "Cuti " + l.Coach.Name + " disetujui. Anda memegang " + c.ClassName + " " + when(c) + ".",
		Link:  "/dashboard/gym/my-classes", Kind: "status_change",
	})
}
