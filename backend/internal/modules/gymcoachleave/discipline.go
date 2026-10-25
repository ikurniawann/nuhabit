package gymcoachleave

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/gym"
	"nuhabit/backend/internal/modules/gymcoachleave/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
)

// Incident is a recorded no-show, short notice leave or late arrival.
type Incident struct {
	ID               string     `json:"id"`
	CoachID          string     `json:"coach_id"`
	CoachName        string     `json:"coach_name"`
	Kind             string     `json:"kind"`
	OccurredOn       string     `json:"occurred_on"`
	SessionID        *string    `json:"session_id"`
	LeaveID          *string    `json:"leave_id"`
	MinutesLate      *int       `json:"minutes_late"`
	Note             string     `json:"note"`
	DeductionPercent float64    `json:"deduction_percent"`
	Status           string     `json:"status"`
	VoidReason       *string    `json:"void_reason"`
	VoidedAt         *time.Time `json:"voided_at"`
	CreatedAt        time.Time  `json:"created_at"`
}

const incidentSelect = `SELECT i.id::text, i.coach_id::text, c.name, i.kind, i.occurred_on::text, i.session_id::text,
       i.leave_id::text, i.minutes_late, i.note, i.deduction_percent::float8, i.status, i.void_reason, i.voided_at, i.created_at
  FROM gym.coach_incidents i JOIN gym.coaches c ON c.id = i.coach_id`

func scanIncident(r pgx.CollectableRow) (Incident, error) {
	var i Incident
	err := r.Scan(&i.ID, &i.CoachID, &i.CoachName, &i.Kind, &i.OccurredOn, &i.SessionID, &i.LeaveID, &i.MinutesLate,
		&i.Note, &i.DeductionPercent, &i.Status, &i.VoidReason, &i.VoidedAt, &i.CreatedAt)
	return i, err
}

// IncidentFilter narrows the incident list; empty fields are ignored.
type IncidentFilter struct {
	CoachID, From, To string
}

// Incidents lists incidents, newest first.
func (s *Service) Incidents(ctx context.Context, f IncidentFilter) ([]Incident, error) {
	rows, err := s.db.Query(ctx, incidentSelect+`
	  WHERE ($1 = '' OR i.coach_id::text = $1) AND ($2 = '' OR i.occurred_on >= $2::date) AND ($3 = '' OR i.occurred_on <= $3::date)
	  ORDER BY i.occurred_on DESC, i.created_at DESC LIMIT 500`, f.CoachID, f.From, f.To)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanIncident)
}

// NewIncident is a no-show or late arrival a Program Director records.
type NewIncident struct {
	CoachID     string  `json:"coach_id"`
	Kind        string  `json:"kind"`
	OccurredOn  string  `json:"occurred_on"`
	SessionID   *string `json:"session_id"`
	MinutesLate *int    `json:"minutes_late"`
	Note        string  `json:"note"`
}

// RecordIncident stores an incident with today's deduction rule and
// proposes an SP when the threshold is reached.
func (s *Service) RecordIncident(ctx context.Context, actorID string, in NewIncident) (*Incident, error) {
	switch {
	case in.Kind != domain.IncidentNoShow && in.Kind != domain.IncidentLate:
		return nil, httpx.BadRequest("Jenis kejadian tidak dikenal")
	case !domain.ValidDate(in.OccurredOn):
		return nil, httpx.BadRequest("Tanggal kejadian tidak valid")
	case in.Kind == domain.IncidentLate && (in.MinutesLate == nil || *in.MinutesLate <= 0):
		return nil, httpx.BadRequest("Isi berapa menit terlambat")
	}
	if in.Kind != domain.IncidentLate {
		in.MinutesLate = nil
	}
	var id string
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		settings, err := loadSettings(ctx, tx)
		if err != nil {
			return err
		}
		err = tx.QueryRow(ctx, `INSERT INTO gym.coach_incidents (coach_id, kind, occurred_on, session_id, minutes_late, note, deduction_percent, recorded_by)
		    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
			in.CoachID, in.Kind, in.OccurredOn, in.SessionID, in.MinutesLate, strings.TrimSpace(in.Note),
			settings.DeductionPercent[in.Kind], actorID).Scan(&id)
		if database.PgCode(err) == "23503" {
			return httpx.BadRequest("Coach atau sesi tidak ditemukan")
		}
		if err != nil {
			return err
		}
		return s.proposeWarning(ctx, tx, in.CoachID, settings)
	})
	if err != nil {
		return nil, err
	}
	return s.incident(ctx, id)
}

func (s *Service) incident(ctx context.Context, id string) (*Incident, error) {
	rows, err := s.db.Query(ctx, incidentSelect+` WHERE i.id = $1`, id)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanIncident)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// recordShortNotice records the short notice incident of an approved
// leave (once per leave) on the approval's transaction.
func (s *Service) recordShortNotice(ctx context.Context, q database.Querier, l *Leave, actorID string) error {
	settings, err := loadSettings(ctx, q)
	if err != nil {
		return err
	}
	note := domain.Label(l.LeaveType) + " " + dateRange(l)
	if l.NoticeDays != nil {
		note += ", diajukan H-" + itoa(*l.NoticeDays)
	}
	if _, err := q.Exec(ctx, `INSERT INTO gym.coach_incidents (coach_id, kind, occurred_on, leave_id, note, deduction_percent, recorded_by)
	    VALUES ($1, 'short_notice_leave', $2, $3, $4, $5, $6)
	    ON CONFLICT (leave_id) WHERE leave_id IS NOT NULL DO NOTHING`,
		l.Coach.ID, l.StartDate, l.ID, note, settings.DeductionPercent[domain.IncidentShortNotice], nullUUID(actorID)); err != nil {
		return err
	}
	return s.proposeWarning(ctx, q, l.Coach.ID, settings)
}

// VoidIncident cancels an incident with a reason; it stops counting for
// deductions and future SP proposals.
func (s *Service) VoidIncident(ctx context.Context, id, actorID, reason string) (*Incident, error) {
	if len([]rune(strings.TrimSpace(reason))) < 5 {
		return nil, httpx.BadRequest("Alasan pembatalan minimal 5 karakter")
	}
	tag, err := s.db.Exec(ctx, `UPDATE gym.coach_incidents SET status = 'void', void_reason = $2, voided_by = $3, voided_at = now()
	  WHERE id = $1 AND status = 'active'`, id, strings.TrimSpace(reason), actorID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, httpx.NotFound("Kejadian tidak ditemukan atau sudah dibatalkan")
	}
	return s.incident(ctx, id)
}

// proposeWarning proposes the next SP when the active incidents of the
// window not counted by an earlier SP reach the threshold, and tells the
// approvers.
func (s *Service) proposeWarning(ctx context.Context, q database.Querier, coachID string, settings Settings) error {
	today := localtime.DayKey(s.now(), localtime.Jakarta)
	since := domain.AddDays(today, -settings.WarningWindowDays)
	rows, err := q.Query(ctx, `SELECT id::text, occurred_on::text FROM gym.coach_incidents
	   WHERE coach_id = $1 AND status = 'active' AND occurred_on >= $2::date ORDER BY occurred_on, created_at`, coachID, since)
	if err != nil {
		return err
	}
	incidents, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.IncidentRef, error) {
		var i domain.IncidentRef
		err := r.Scan(&i.ID, &i.OccurredOn)
		return i, err
	})
	if err != nil {
		return err
	}
	var counted []string
	var lastLevel int
	var open bool
	err = q.QueryRow(ctx, `SELECT COALESCE(array_agg(DISTINCT x)::text[], '{}'),
	        COALESCE(max(level) FILTER (WHERE status = 'issued'), 0),
	        bool_or(status = 'proposed') IS TRUE
	   FROM gym.coach_warnings w LEFT JOIN LATERAL unnest(w.incident_ids) x ON true
	  WHERE w.coach_id = $1`, coachID).Scan(&counted, &lastLevel, &open)
	if err != nil {
		return err
	}
	seen := make(map[string]bool, len(counted))
	for _, id := range counted {
		seen[id] = true
	}
	p := domain.ProposeWarning(incidents, seen, lastLevel, open, settings.WarningThreshold)
	if p == nil {
		return nil
	}
	if _, err := q.Exec(ctx, `INSERT INTO gym.coach_warnings (coach_id, level, window_from, window_to, incident_ids)
	    VALUES ($1, $2, $3, $4, $5::uuid[])`, coachID, p.Level, p.From, p.To, p.IncidentIDs); err != nil {
		return err
	}
	var name string
	if err := q.QueryRow(ctx, `SELECT name FROM gym.coaches WHERE id = $1`, coachID).Scan(&name); err != nil {
		return err
	}
	resolved, err := s.approvers(ctx, q, nil)
	if err != nil {
		return err
	}
	for _, a := range resolved.List {
		if err := notifyUser(ctx, q, a.UserID, inboxNotice{
			Title: "Usulan SP" + itoa(p.Level) + ": " + name,
			Body:  itoa(len(p.IncidentIDs)) + " kejadian disiplin sejak " + p.From + ". Tinjau di menu Cuti & Pengganti Coach.",
			Link:  queueLink + "?tab=discipline", Kind: "alert",
		}); err != nil {
			return err
		}
	}
	return nil
}

// Warning is an SP proposal or decision.
type Warning struct {
	ID           string     `json:"id"`
	CoachID      string     `json:"coach_id"`
	CoachName    string     `json:"coach_name"`
	Level        int        `json:"level"`
	Status       string     `json:"status"`
	WindowFrom   string     `json:"window_from"`
	WindowTo     string     `json:"window_to"`
	IncidentIDs  []string   `json:"incident_ids"`
	DecidedAt    *time.Time `json:"decided_at"`
	DecisionNote *string    `json:"decision_note"`
	CreatedAt    time.Time  `json:"created_at"`
}

// Warnings lists SP proposals and decisions, open ones first.
func (s *Service) Warnings(ctx context.Context) ([]Warning, error) {
	rows, err := s.db.Query(ctx, `SELECT w.id::text, w.coach_id::text, c.name, w.level, w.status, w.window_from::text,
	        w.window_to::text, w.incident_ids::text[], w.decided_at, w.decision_note, w.created_at
	   FROM gym.coach_warnings w JOIN gym.coaches c ON c.id = w.coach_id
	  ORDER BY (w.status = 'proposed') DESC, w.created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Warning, error) {
		var w Warning
		err := r.Scan(&w.ID, &w.CoachID, &w.CoachName, &w.Level, &w.Status, &w.WindowFrom, &w.WindowTo, &w.IncidentIDs,
			&w.DecidedAt, &w.DecisionNote, &w.CreatedAt)
		return w, err
	})
}

// DecideWarning issues or dismisses an SP proposal.
func (s *Service) DecideWarning(ctx context.Context, id, actorID string, issue bool, note string) error {
	status := "dismissed"
	if issue {
		status = "issued"
	}
	tag, err := s.db.Exec(ctx, `UPDATE gym.coach_warnings SET status = $2, decided_by = $3, decided_at = now(), decision_note = NULLIF($4, '')
	  WHERE id = $1 AND status = 'proposed'`, id, status, actorID, strings.TrimSpace(note))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Usulan SP tidak ditemukan atau sudah diputus")
	}
	return nil
}

// ── Port for the coach commission ───────────────────────────────────────────

// IncidentsSQL reads a coach's active incidents for the commission
// deduction; the commission declares its port over IncidentsFor.
type IncidentsSQL struct{}

// IncidentsFor lists the active incidents of coachID in month (YYYY-MM).
func (IncidentsSQL) IncidentsFor(ctx context.Context, q database.Querier, coachID, month string) ([]gym.CoachIncident, error) {
	start, err := time.Parse("2006-01", month)
	if err != nil {
		return nil, httpx.BadRequest("Bulan tidak valid")
	}
	rows, err := q.Query(ctx, `SELECT id::text, kind, occurred_on::text, session_id::text, leave_id::text, deduction_percent::float8
	   FROM gym.coach_incidents
	  WHERE coach_id = $1 AND status = 'active' AND occurred_on >= $2::date AND occurred_on < $3::date
	  ORDER BY occurred_on, created_at`, coachID, start.Format(domain.DateLayout), start.AddDate(0, 1, 0).Format(domain.DateLayout))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (gym.CoachIncident, error) {
		var i gym.CoachIncident
		err := r.Scan(&i.ID, &i.Kind, &i.OccurredOn, &i.SessionID, &i.LeaveID, &i.DeductionPercent)
		return i, err
	})
}
