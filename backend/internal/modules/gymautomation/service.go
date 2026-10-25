package gymautomation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/jobs"
)

// Service holds the use cases.
type Service struct {
	db    database.Querier
	ports Ports
	now   func() time.Time
}

/* ── Jobs ────────────────────────────────────────────────────────────── */

// SettingValue is a job setting with the value in force.
type SettingValue struct {
	Setting
	Value int `json:"value"`
}

// JobView is one job on the page.
type JobView struct {
	Name         string         `json:"name"`
	Module       string         `json:"module"`
	Label        string         `json:"label"`
	Description  string         `json:"description"`
	EverySeconds int            `json:"everySeconds"`
	Enabled      bool           `json:"enabled"`
	Settings     []SettingValue `json:"settings"`
	Rules        []RuleLink     `json:"rules"`
	// Status: never (no run yet), running, ok or failed (the last run).
	Status          string        `json:"status"`
	LastStartedAt   *httpx.JSTime `json:"lastStartedAt"`
	LastFinishedAt  *httpx.JSTime `json:"lastFinishedAt"`
	LastSucceededAt *httpx.JSTime `json:"lastSucceededAt"`
	LastError       *string       `json:"lastError"`
}

type jobState struct {
	enabled                      bool
	config                       map[string]any
	started, finished, succeeded *time.Time
	lastError                    *string
}

func (s *Service) states(ctx context.Context) (map[string]*jobState, error) {
	rows, err := s.db.Query(ctx, `
SELECT n.name, COALESCE(js.enabled, true), COALESCE(js.config, '{}'::jsonb),
       r.last_started_at, r.last_finished_at, r.last_succeeded_at, r.last_error
  FROM (SELECT name FROM platform.job_runs UNION SELECT name FROM platform.job_settings) n
  LEFT JOIN platform.job_runs r ON r.name = n.name
  LEFT JOIN platform.job_settings js ON js.name = n.name`)
	if err != nil {
		return nil, err
	}
	out := map[string]*jobState{}
	var name string
	var raw []byte
	var st jobState
	_, err = pgx.ForEachRow(rows, []any{&name, &st.enabled, &raw, &st.started, &st.finished, &st.succeeded, &st.lastError}, func() error {
		v := st
		if err := json.Unmarshal(raw, &v.config); err != nil {
			return err
		}
		out[name] = &v
		return nil
	})
	return out, err
}

func status(st *jobState) string {
	switch {
	case st == nil || st.started == nil:
		return "never"
	case st.finished == nil || st.finished.Before(*st.started):
		return "running"
	case st.lastError != nil:
		return "failed"
	}
	return "ok"
}

// intSetting is config[key] when it holds a whole number, else def.
func intSetting(config map[string]any, key string, def int) int {
	if v, ok := config[key].(float64); ok && v == float64(int(v)) {
		return int(v)
	}
	return def
}

// Jobs lists the gym jobs in registration order with their state.
func (s *Service) Jobs(ctx context.Context) ([]JobView, error) {
	states, err := s.states(ctx)
	if err != nil {
		return nil, err
	}
	rules, err := s.ports.Rules.GlobalRules(ctx)
	if err != nil {
		return nil, err
	}
	out := []JobView{}
	for _, j := range s.ports.Jobs.List() {
		info, known := catalog[j.Name]
		if !known {
			info = jobInfo{Label: j.Name}
		}
		st := states[j.Name]
		v := JobView{
			Name: j.Name, Module: j.Module, Label: info.Label, Description: info.Description,
			EverySeconds: int(j.Every / time.Second), Enabled: st == nil || st.enabled,
			Settings: []SettingValue{}, Rules: ruleLinks(rules, info.Rules), Status: status(st),
		}
		var config map[string]any
		if st != nil {
			config = st.config
			v.LastStartedAt, v.LastFinishedAt, v.LastSucceededAt = httpx.NewJSTime(st.started), httpx.NewJSTime(st.finished), httpx.NewJSTime(st.succeeded)
			v.LastError = st.lastError
		}
		for _, set := range info.Settings {
			v.Settings = append(v.Settings, SettingValue{Setting: set, Value: intSetting(config, set.Key, set.Default)})
		}
		out = append(out, v)
	}
	return out, nil
}

func (s *Service) job(name string) (Job, error) {
	for _, j := range s.ports.Jobs.List() {
		if j.Name == name {
			return j, nil
		}
	}
	return Job{}, httpx.NotFound("Job tidak ditemukan")
}

// JobPatch turns a job on or off and sets its settings; nil keeps a value.
type JobPatch struct {
	Enabled  *bool
	Settings map[string]int
}

// SaveJob stores the switch and settings of a job. Settings must be ones
// the job has, inside their range.
func (s *Service) SaveJob(ctx context.Context, name string, p JobPatch, userID string) error {
	if _, err := s.job(name); err != nil {
		return err
	}
	specs := catalog[name].Settings
	for key, value := range p.Settings {
		i := slices.IndexFunc(specs, func(set Setting) bool { return set.Key == key })
		if i < 0 {
			return httpx.BadRequest(fmt.Sprintf("Job ini tidak punya pengaturan %s", key))
		}
		if set := specs[i]; value < set.Min || value > set.Max {
			return httpx.BadRequest(fmt.Sprintf("%s harus %d sampai %d %s", set.Label, set.Min, set.Max, set.Unit))
		}
	}
	patch, err := json.Marshal(p.Settings)
	if err != nil {
		return err
	}
	if p.Settings == nil {
		patch = []byte("{}")
	}
	_, err = s.db.Exec(ctx, `
INSERT INTO platform.job_settings (name, enabled, config, updated_by, updated_at)
VALUES ($1, COALESCE($2, true), $3::jsonb, $4, $5)
ON CONFLICT (name) DO UPDATE SET
  enabled = COALESCE($2, platform.job_settings.enabled),
  config = platform.job_settings.config || EXCLUDED.config,
  updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
		name, p.Enabled, patch, userID, s.now())
	return err
}

// RunJob runs a job once now; a job that is running refuses with 409 and a
// failed run answers its error.
func (s *Service) RunJob(ctx context.Context, name string) error {
	if _, err := s.job(name); err != nil {
		return err
	}
	err := s.ports.Jobs.Run(ctx, name, s.now())
	switch {
	case errors.Is(err, jobs.ErrBusy):
		return httpx.Conflict("Job sedang berjalan. Coba lagi setelah selesai.")
	case errors.Is(err, ErrUnknownJob):
		return httpx.NotFound("Job tidak ditemukan")
	case err != nil:
		return httpx.Status(500, "Job gagal: "+err.Error())
	}
	return nil
}

/* ── Member notification log ─────────────────────────────────────────── */

// MemberHit is a member a search found.
type MemberHit struct {
	ID    string  `json:"id"`
	Name  *string `json:"name"`
	Phone *string `json:"phone"`
}

// SearchMembers finds up to 20 members by name or phone; under two
// characters it finds none.
func (s *Service) SearchMembers(ctx context.Context, term string) ([]MemberHit, error) {
	term = strings.TrimSpace(term)
	if len([]rune(term)) < 2 {
		return []MemberHit{}, nil
	}
	rows, err := s.db.Query(ctx, `
SELECT id::text, name, phone FROM pos.pos_customers
 WHERE name ILIKE '%' || $1 || '%' OR phone LIKE '%' || $1 || '%'
 ORDER BY name NULLS LAST, id
 LIMIT 20`, term)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[MemberHit])
}

// Reminder is one reminder the sent log recorded for the member.
type Reminder struct {
	Kind      string       `json:"kind"`
	SubjectID string       `json:"subjectId"`
	Period    string       `json:"period"`
	SentAt    httpx.JSTime `json:"sentAt"`
}

// Notification is one row of the member inbox.
type Notification struct {
	ID        string        `json:"id"`
	Type      string        `json:"type"`
	Title     string        `json:"title"`
	Body      string        `json:"body"`
	CreatedAt httpx.JSTime  `json:"createdAt"`
	ReadAt    *httpx.JSTime `json:"readAt"`
}

// MemberLog is what a member received, newest first, at most 100 of each.
type MemberLog struct {
	Member        MemberHit      `json:"member"`
	Reminders     []Reminder     `json:"reminders"`
	Notifications []Notification `json:"notifications"`
}

// MemberLog lists the reminders sent to a member and their inbox.
func (s *Service) MemberLog(ctx context.Context, customerID string) (*MemberLog, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, name, phone FROM pos.pos_customers WHERE id = $1`, customerID)
	if err != nil {
		return nil, err
	}
	member, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[MemberHit])
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Member tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	out := &MemberLog{Member: member, Reminders: []Reminder{}, Notifications: []Notification{}}
	rows, err = s.db.Query(ctx, `
SELECT kind, subject_id, period, sent_at FROM platform.reminder_sends
 WHERE customer_id = $1 ORDER BY sent_at DESC LIMIT 100`, customerID)
	if err != nil {
		return nil, err
	}
	var r Reminder
	var sent time.Time
	if _, err := pgx.ForEachRow(rows, []any{&r.Kind, &r.SubjectID, &r.Period, &sent}, func() error {
		r.SentAt = httpx.JSTime(sent)
		out.Reminders = append(out.Reminders, r)
		return nil
	}); err != nil {
		return nil, err
	}
	rows, err = s.db.Query(ctx, `
SELECT id::text, type, title, body, created_at, read_at FROM crm.member_notifications
 WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 100`, customerID)
	if err != nil {
		return nil, err
	}
	var n Notification
	var created time.Time
	var read *time.Time
	_, err = pgx.ForEachRow(rows, []any{&n.ID, &n.Type, &n.Title, &n.Body, &created, &read}, func() error {
		n.CreatedAt, n.ReadAt = httpx.JSTime(created), httpx.NewJSTime(read)
		out.Notifications = append(out.Notifications, n)
		return nil
	})
	return out, err
}
