// Package gymcomplaints owns member complaint tickets of the gym: tickets
// raised from the CRM WhatsApp inbox, the front desk, the member app or any
// staff screen, their owner, SLA deadlines, history, escalation and report.
//
// It is its own module rather than part of crm: a ticket links a member, a
// coach, a class session and a branch, follows gym SLA settings and feeds
// the coach KPI, while the inbox only lends a conversation and its flags.
// Members, coaches, sessions, branches and inbox conversations are read
// from their tables; WhatsApp goes through the Messenger port.
package gymcomplaints

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcomplaints/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/members"
)

// Q runs queries inside the caller's transaction.
type Q = database.Querier

// Messenger sends a WhatsApp text to a staff phone and reports whether it
// went out.
type Messenger interface {
	SendWhatsApp(ctx context.Context, phone, text string) bool
}

// Ports are the adapters internal/app wires in.
type Ports struct {
	// WhatsApp is nil when no provider is configured: escalations then reach
	// the staff inbox only.
	WhatsApp Messenger
	// AppOrigin prefixes dashboard links in WhatsApp; "" leaves them relative.
	AppOrigin string
}

// Service implements the ticket use cases and the escalation job.
type Service struct {
	db    database.DB
	ports Ports
	now   func() time.Time
	log   *slog.Logger
}

// NewService builds the service; now and log may be nil.
func NewService(db database.DB, ports Ports, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, ports: ports, now: now, log: log}
}

func (s *Service) inTx(ctx context.Context, fn func(q Q) error) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error { return fn(tx) })
}

// notifyMember writes the member inbox in a savepoint: a failure is logged
// and never rolls back the ticket change it reports.
func (s *Service) notifyMember(ctx context.Context, q Q, customerID *string, n members.Notice) {
	if customerID == nil || n.Title == "" {
		return
	}
	err := func() error {
		tb, ok := q.(database.TxBeginner)
		if !ok {
			return members.Notify(ctx, q, *customerID, n)
		}
		return database.WithTx(ctx, tb, func(sp pgx.Tx) error { return members.Notify(ctx, sp, *customerID, n) })
	}()
	if err != nil {
		s.log.Warn("[gym-complaints] notifikasi member gagal", "customer", *customerID, "error", err)
	}
}

// ticketLink is the dashboard page of a ticket.
func ticketLink(id string) string { return "/dashboard/gym/complaints/" + id }

// staffNotice writes the dashboard inbox (public.notifications) of each
// distinct user.
func staffNotice(ctx context.Context, q Q, userIDs []string, kind, title, message, link string, meta map[string]any) error {
	seen := map[string]bool{}
	for _, id := range userIDs {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		if _, err := q.Exec(ctx, `INSERT INTO public.notifications (user_id, title, message, type, link, metadata)
			VALUES ($1, $2, $3, $4, $5, $6)`, id, title, message, kind, link, meta); err != nil {
			return err
		}
	}
	return nil
}

// ── Settings ─────────────────────────────────────────────────────────────────

// Settings are the SLA and escalation settings of a branch. Inherited: the
// branch has no row of its own and shows the default.
type Settings struct {
	BranchID           *string    `json:"branch_id"`
	Inherited          bool       `json:"inherited"`
	SLA                domain.SLA `json:"sla"`
	WorkStart          string     `json:"work_start"`
	WorkEnd            string     `json:"work_end"`
	EscalationUserID   *string    `json:"escalation_user_id"`
	EscalationUserName *string    `json:"escalation_user_name"`
	EscalationPhone    *string    `json:"escalation_phone"`
}

func (st Settings) window() domain.Window {
	return domain.Window{Start: clockMinutes(st.WorkStart), End: clockMinutes(st.WorkEnd)}
}

// clockMinutes reads "HH:MM" as minutes after midnight, -1 when malformed.
func clockMinutes(s string) int {
	t, err := time.Parse("15:04", s)
	if err != nil {
		return -1
	}
	return t.Hour()*60 + t.Minute()
}

// loadSettings reads the branch's row, else the default row.
func loadSettings(ctx context.Context, q Q, branchID *string) (Settings, error) {
	var st Settings
	var own *string
	var raw map[domain.Priority]domain.Rule
	err := q.QueryRow(ctx, `SELECT cs.branch_id::text, cs.sla, to_char(cs.work_start, 'HH24:MI'), to_char(cs.work_end, 'HH24:MI'),
	       cs.escalation_user_id::text, u.full_name, cs.escalation_phone
	  FROM gym.complaint_settings cs
	  LEFT JOIN configuration.users u ON u.id = cs.escalation_user_id
	 WHERE cs.branch_id = $1 OR cs.branch_id IS NULL
	 ORDER BY cs.branch_id NULLS LAST LIMIT 1`, branchID).
		Scan(&own, &raw, &st.WorkStart, &st.WorkEnd, &st.EscalationUserID, &st.EscalationUserName, &st.EscalationPhone)
	if database.IsNoRows(err) {
		err, st.WorkStart, st.WorkEnd = nil, "08:00", "21:00"
	}
	st.SLA = domain.SLA(raw).Normalize()
	st.BranchID = branchID
	st.Inherited = branchID != nil && own == nil
	return st, err
}

// clock is the settings, window and zone a ticket's deadlines use.
type clock struct {
	settings Settings
	window   domain.Window
	zone     *time.Location
}

func loadClock(ctx context.Context, q Q, branchID *string) (clock, error) {
	st, err := loadSettings(ctx, q, branchID)
	if err != nil {
		return clock{}, err
	}
	zone, err := localtime.BranchZone(ctx, q, branchID)
	return clock{settings: st, window: st.window(), zone: zone}, err
}

func (c clock) deadlines(start time.Time, p domain.Priority) (time.Time, time.Time) {
	return domain.Deadlines(start, p, c.settings.SLA, c.window, c.zone)
}

// Settings returns the settings a branch uses (nil: the default).
func (s *Service) Settings(ctx context.Context, branchID *string) (Settings, error) {
	return loadSettings(ctx, s.db, branchID)
}

// SettingsInput replaces a branch's settings (nil branch: the default).
type SettingsInput struct {
	BranchID         *string    `json:"branch_id"`
	SLA              domain.SLA `json:"sla"`
	WorkStart        string     `json:"work_start"`
	WorkEnd          string     `json:"work_end"`
	EscalationUserID *string    `json:"escalation_user_id"`
	EscalationPhone  *string    `json:"escalation_phone"`
	// Reset drops a branch's own row so it follows the default again.
	Reset bool `json:"reset"`
}

// SaveSettings upserts a branch's settings.
func (s *Service) SaveSettings(ctx context.Context, userID string, in SettingsInput) (Settings, error) {
	if in.Reset {
		if in.BranchID == nil {
			return Settings{}, httpx.BadRequest("Pengaturan default tidak bisa dihapus")
		}
		if _, err := s.db.Exec(ctx, `DELETE FROM gym.complaint_settings WHERE branch_id = $1`, *in.BranchID); err != nil {
			return Settings{}, err
		}
		return s.Settings(ctx, in.BranchID)
	}
	w := domain.Window{Start: clockMinutes(in.WorkStart), End: clockMinutes(in.WorkEnd)}
	if !w.Valid() || w.Start < 0 {
		return Settings{}, httpx.BadRequest("Jam kerja tidak valid: jam selesai harus setelah jam mulai")
	}
	if in.EscalationUserID != nil {
		if err := requireActiveUser(ctx, s.db, *in.EscalationUserID); err != nil {
			return Settings{}, err
		}
	}
	phone := trimmed(in.EscalationPhone)
	err := s.inTx(ctx, func(q Q) error {
		if in.BranchID != nil {
			var ok bool
			if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM configuration.branches WHERE id = $1)`, *in.BranchID).Scan(&ok); err != nil {
				return err
			}
			if !ok {
				return httpx.NotFound("Cabang tidak ditemukan")
			}
		}
		tag, err := q.Exec(ctx, `UPDATE gym.complaint_settings SET sla = $2, work_start = $3::time, work_end = $4::time,
		         escalation_user_id = $5, escalation_phone = $6, updated_by = $7, updated_at = now()
		   WHERE branch_id IS NOT DISTINCT FROM $1::uuid`,
			in.BranchID, in.SLA.Normalize(), in.WorkStart, in.WorkEnd, in.EscalationUserID, phone, userID)
		if err != nil || tag.RowsAffected() > 0 {
			return err
		}
		_, err = q.Exec(ctx, `INSERT INTO gym.complaint_settings (branch_id, sla, work_start, work_end, escalation_user_id, escalation_phone, updated_by)
		  VALUES ($1, $2, $3::time, $4::time, $5, $6, $7)`,
			in.BranchID, in.SLA.Normalize(), in.WorkStart, in.WorkEnd, in.EscalationUserID, phone, userID)
		return err
	})
	if err != nil {
		return Settings{}, err
	}
	return s.Settings(ctx, in.BranchID)
}

// ── Categories ───────────────────────────────────────────────────────────────

// Category is one entry of the configurable category list.
type Category struct {
	Code      string `json:"code"`
	Label     string `json:"label"`
	SortOrder int    `json:"sort_order"`
	IsActive  bool   `json:"is_active"`
}

// Categories lists the categories, the inactive ones too when all is set.
func (s *Service) Categories(ctx context.Context, all bool) ([]Category, error) {
	rows, err := s.db.Query(ctx, `SELECT code, label, sort_order, is_active FROM gym.complaint_categories
	  WHERE is_active OR $1 ORDER BY sort_order, label`, all)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Category, error) {
		var c Category
		return c, r.Scan(&c.Code, &c.Label, &c.SortOrder, &c.IsActive)
	})
}

// SaveCategories upserts the list. A category in use is switched off, never
// deleted, so old tickets keep their label.
func (s *Service) SaveCategories(ctx context.Context, list []Category) ([]Category, error) {
	active := 0
	for _, c := range list {
		if c.IsActive {
			active++
		}
	}
	if active == 0 {
		return nil, httpx.BadRequest("Minimal satu kategori aktif")
	}
	err := s.inTx(ctx, func(q Q) error {
		for _, c := range list {
			_, err := q.Exec(ctx, `INSERT INTO gym.complaint_categories (code, label, sort_order, is_active) VALUES ($1, $2, $3, $4)
			  ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order,
			    is_active = EXCLUDED.is_active, updated_at = now()`, c.Code, c.Label, c.SortOrder, c.IsActive)
			if database.PgCode(err) == "23514" {
				return httpx.BadRequest("Kode kategori " + c.Code + " tidak valid: huruf kecil, angka atau garis bawah")
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Categories(ctx, true)
}

// categoryLabel is the label of an active category, 400 when unknown.
func categoryLabel(ctx context.Context, q Q, code string) (string, error) {
	var label string
	err := q.QueryRow(ctx, `SELECT label FROM gym.complaint_categories WHERE code = $1 AND is_active`, code).Scan(&label)
	if database.IsNoRows(err) {
		return "", httpx.Coded(400, "COMPLAINT_CATEGORY_INVALID", "Kategori tidak dikenal", nil)
	}
	return label, err
}

// ── Lookups ──────────────────────────────────────────────────────────────────

func requireActiveUser(ctx context.Context, q Q, userID string) error {
	var ok bool
	if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM configuration.users WHERE id = $1 AND status = 'active')`, userID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return httpx.BadRequest("PIC harus user staf yang aktif")
	}
	return nil
}

// coachForUser is the active coach linked to a staff account, "" when none.
func coachForUser(ctx context.Context, q Q, userID string) (string, string, error) {
	var id, name string
	err := q.QueryRow(ctx, `SELECT id::text, name FROM gym.coaches WHERE user_id = $1 AND status = 'active'
	  ORDER BY created_at LIMIT 1`, userID).Scan(&id, &name)
	if database.IsNoRows(err) {
		return "", "", nil
	}
	return id, name, err
}

func trimmed(s *string) *string {
	if s == nil {
		return nil
	}
	v := strings.TrimSpace(*s)
	if v == "" {
		return nil
	}
	return &v
}
