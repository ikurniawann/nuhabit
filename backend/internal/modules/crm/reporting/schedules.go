package reporting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/reporting/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// manageGate mirrors requireCrmScope + assertCanManageSchedules: only
// admins manage schedules (reports go to many recipients).
func (h *handler) manageGate(r *http.Request, action string) (*auth.User, *kit.Scope, error) {
	u, s, err := h.guard.RequireScope(r, kit.GateReports)
	if err == nil && !canManageShared(u) {
		err = httpx.Forbidden("Hanya admin yang bisa " + action)
	}
	return u, s, err
}

func (h *handler) listSchedules(w http.ResponseWriter, r *http.Request) error {
	_, s, err := h.guard.RequireScope(r, kit.GateReports)
	if err != nil {
		return err
	}
	params := []any{}
	where := "TRUE"
	if s.CompanyID != nil {
		params = append(params, *s.CompanyID)
		where = fmt.Sprintf("(s.company_id IS NULL OR s.company_id = $%d)", len(params))
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT s.id, s.company_id, s.report_id, s.name, s.frequency, s.hour, s.day_of_week, s.day_of_month,
            s.channel, s.recipients, s.is_active, s.last_run_at, s.last_status, s.last_error, s.next_run_at,
            s.created_at, r.name AS report_name, r.dataset
     FROM crm.crm_report_schedules s
     JOIN crm.crm_reports r ON r.id = s.report_id AND r.deleted_at IS NULL
     WHERE `+where+`
     ORDER BY s.is_active DESC, s.next_run_at NULLS LAST`, params...)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

func recipientsJSON(rs []recipient) string {
	b, _ := json.Marshal(rs)
	return string(b)
}

func (h *handler) createSchedule(w http.ResponseWriter, r *http.Request) error {
	u, s, err := h.manageGate(r, "membuat laporan terjadwal")
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in, err := parseSchedule(f, false)
	if err != nil {
		return err
	}
	if _, err := h.requireAccessibleReport(r.Context(), *in.ReportID, u, s); err != nil {
		return err
	}
	var next *time.Time
	if *in.IsActive {
		t := domain.ComputeNextRun(domain.SchedulePattern{Frequency: *in.Frequency, Hour: *in.Hour, DayOfWeek: in.DayOfWeek, DayOfMonth: in.DayOfMonth}, h.now())
		next = &t
	}
	row, err := kit.QueryOne(r.Context(), h.db, `INSERT INTO crm.crm_report_schedules
       (company_id, report_id, name, frequency, hour, day_of_week, day_of_month, channel, recipients, is_active, next_run_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
     RETURNING id, name, frequency, next_run_at`,
		kit.ScopedCompanyID(u, s), *in.ReportID, *in.Name, *in.Frequency, *in.Hour, in.DayOfWeek, in.DayOfMonth,
		*in.Channel, recipientsJSON(in.Recipients), *in.IsActive, next, u.ID)
	if err != nil {
		return err
	}
	return kit.Created(w, row, "Jadwal dibuat")
}

// scheduleRow is ScheduleRow in saved-reports-server.ts.
type scheduleRow struct {
	ID         string
	Frequency  string
	Hour       int
	DayOfWeek  *int
	DayOfMonth *int
	IsActive   bool
}

// requireSchedule mirrors manageableSchedule: the admin gate (403 before
// 404), then the schedule in the user's company scope.
func (h *handler) requireSchedule(r *http.Request, action string) (*scheduleRow, error) {
	_, s, err := h.manageGate(r, action)
	if err != nil {
		return nil, err
	}
	params := []any{r.PathValue("id")}
	where := "id = $1::text::uuid"
	if s.CompanyID != nil {
		params = append(params, *s.CompanyID)
		where += fmt.Sprintf(" AND (company_id IS NULL OR company_id = $%d)", len(params))
	}
	var row scheduleRow
	err = h.db.QueryRow(r.Context(), `SELECT id::text, frequency, hour, day_of_week, day_of_month, is_active
     FROM crm.crm_report_schedules WHERE `+where, params...).
		Scan(&row.ID, &row.Frequency, &row.Hour, &row.DayOfWeek, &row.DayOfMonth, &row.IsActive)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Jadwal tidak ditemukan")
	}
	return &row, err
}

func (h *handler) patchSchedule(w http.ResponseWriter, r *http.Request) error {
	current, err := h.requireSchedule(r, "mengubah jadwal")
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in, err := parseSchedule(f, true)
	if err != nil {
		return err
	}
	var l setList
	next := domain.SchedulePattern{Frequency: current.Frequency, Hour: current.Hour, DayOfWeek: current.DayOfWeek, DayOfMonth: current.DayOfMonth}
	active := current.IsActive
	if in.Name != nil {
		l.push("name", *in.Name, "")
	}
	if in.Frequency != nil {
		l.push("frequency", *in.Frequency, "")
		next.Frequency = *in.Frequency
	}
	if in.Hour != nil {
		l.push("hour", *in.Hour, "")
		next.Hour = *in.Hour
	}
	if in.HasDOW {
		l.push("day_of_week", in.DayOfWeek, "")
		next.DayOfWeek = in.DayOfWeek
	}
	if in.HasDOM {
		l.push("day_of_month", in.DayOfMonth, "")
		next.DayOfMonth = in.DayOfMonth
	}
	if in.Channel != nil {
		l.push("channel", *in.Channel, "")
	}
	if in.Recipients != nil {
		l.push("recipients", recipientsJSON(in.Recipients), "::jsonb")
	}
	if in.IsActive != nil {
		l.push("is_active", *in.IsActive, "")
		active = *in.IsActive
	}
	if len(l.values) == 0 {
		return httpx.BadRequest("Tidak ada field yang diubah")
	}
	// The next run is recomputed whenever the pattern or the active flag may have changed.
	var nextRun *time.Time
	if active {
		t := domain.ComputeNextRun(next, h.now())
		nextRun = &t
	}
	l.push("next_run_at", nextRun, "")
	row, err := kit.QueryOne(r.Context(), h.db, fmt.Sprintf(`UPDATE crm.crm_report_schedules SET %s WHERE id = $%d
     RETURNING id, name, frequency, is_active, next_run_at`, l.sql(), len(l.values)+1), append(l.values, current.ID)...)
	if err != nil {
		return err
	}
	return kit.OK(w, row, "Jadwal diperbarui")
}

func (h *handler) deleteSchedule(w http.ResponseWriter, r *http.Request) error {
	schedule, err := h.requireSchedule(r, "menghapus jadwal")
	if err != nil {
		return err
	}
	if _, err := h.db.Exec(r.Context(), `DELETE FROM crm.crm_report_schedules WHERE id = $1`, schedule.ID); err != nil {
		return err
	}
	return kit.NoContent(w)
}

// sendSchedule is POST = send now (a test run) without moving the next run.
func (h *handler) sendSchedule(w http.ResponseWriter, r *http.Request) error {
	schedule, err := h.requireSchedule(r, "mengirim uji coba")
	if err != nil {
		return err
	}
	result, err := h.runSchedule(r.Context(), schedule.ID)
	if err != nil {
		return err
	}
	if !result.OK {
		reason := result.Reason
		if reason == "" {
			reason = "Gagal mengirim"
		}
		return httpx.BadRequest(reason)
	}
	return kit.OK(w, result, fmt.Sprintf("Terkirim ke %d penerima", result.Sent))
}

// scheduleRunResult is ScheduleRunResult.
type scheduleRunResult struct {
	OK       bool   `json:"ok"`
	Sent     int    `json:"sent"`
	RowCount *int   `json:"rowCount,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

// runSchedule mirrors runReportSchedule(id, { advanceNextRun: false }): run
// the report as the schedule's creator, then deliver the summary in-app
// and/or over WhatsApp. The next run is left alone.
func (h *handler) runSchedule(ctx context.Context, id string) (*scheduleRunResult, error) {
	job, err := kit.QueryOne(ctx, h.db, `SELECT s.id, s.name, s.company_id, s.frequency, s.hour, s.day_of_week, s.day_of_month,
         s.channel, s.recipients, s.report_id,
         r.name AS report_name, r.dataset, r.definition,
         u.role AS creator_role, u.id AS creator_id
  FROM crm.crm_report_schedules s
  JOIN crm.crm_reports r ON r.id = s.report_id AND r.deleted_at IS NULL
  LEFT JOIN configuration.users u ON u.id = s.created_by WHERE s.id = $1`, id)
	if err != nil {
		return nil, err
	}
	if job == nil {
		return &scheduleRunResult{Reason: "Jadwal tidak ditemukan"}, nil
	}
	def, err := storedDefinition(job)
	if err != nil {
		return nil, err
	}
	var owner *string
	if job.Str("creator_role") == "sales" {
		// The schedule runs as its creator: the sales role still sees only its own records.
		owner = job.StrPtr("creator_id")
	}
	built := domain.BuildReportQuery(def, domain.BuildContext{CompanyID: job.StrPtr("company_id"), RestrictOwnerUserID: owner, Today: h.now().In(h.loc)})

	var rows []*kit.Row
	if err := database.WithTx(ctx, h.db, func(tx pgx.Tx) (err error) {
		rows, err = queryReport(ctx, tx, built)
		return err
	}); err != nil {
		reason := err.Error()
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			reason = pgErr.Message // node-postgres error.message
		}
		if err := h.markRun(ctx, id, "error", &reason); err != nil {
			return nil, err
		}
		return &scheduleRunResult{Reason: reason}, nil
	}

	plain := make([]domain.Row, len(rows))
	for i, row := range rows {
		plain[i] = plainRow(row)
	}
	reportName := job.Str("report_name")
	link := "/dashboard/crm/reports/builder?report=" + job.Str("report_id")
	message := domain.BuildScheduleMessage(reportName, domain.SummarizeRows(plain, built.Columns, h.loc), len(rows), domain.PeriodLabel(def), link)

	recipients := parseRecipients(job.Get("recipients"))
	var userIDs []string
	for _, rc := range recipients {
		if rc.Type == "user" {
			userIDs = append(userIDs, rc.UserID)
		}
	}
	sent := 0
	channel := job.Str("channel")
	if (channel == "in_app" || channel == "wa") && len(userIDs) > 0 {
		meta := struct {
			ScheduleID string `json:"schedule_id"`
			ReportID   string `json:"report_id"`
		}{job.Str("id"), job.Str("report_id")}
		n, err := h.ports.Notify.NotifyUsers(ctx, h.db, userIDs, "Laporan: "+reportName,
			fmt.Sprintf("%d baris · %s", len(rows), domain.PeriodLabel(def)), link, meta)
		if err != nil {
			return nil, err
		}
		sent += n
	}
	if channel == "wa" {
		if send := h.ports.WhatsApp.Gateway(ctx, h.db); send != nil {
			numbers, err := h.waNumbers(ctx, recipients, userIDs)
			if err != nil {
				return nil, err
			}
			for _, target := range numbers {
				if send(ctx, target, message) {
					sent++
				}
			}
		}
	}

	if err := h.markRun(ctx, id, "ok", nil); err != nil {
		return nil, err
	}
	count := len(rows)
	return &scheduleRunResult{OK: true, Sent: sent, RowCount: &count}, nil
}

// waNumbers collects the distinct valid numbers: typed numbers first, then
// each user's employee phone, in insertion order like a JS Set.
func (h *handler) waNumbers(ctx context.Context, recipients []recipient, userIDs []string) ([]string, error) {
	var out []string
	seen := map[string]bool{}
	add := func(p string) {
		if domain.IsValidNormalizedPhone(p) && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	for _, rc := range recipients {
		if rc.Type == "number" {
			add(domain.NormalizePhone(rc.Number))
		}
	}
	for _, uid := range userIDs {
		phone, err := h.ports.Staff.EmployeePhone(ctx, h.db, uid)
		if err != nil {
			return nil, err
		}
		if phone != "" {
			add(domain.NormalizePhone(phone))
		}
	}
	return out, nil
}

// markRun records the run; the send-now path never advances next_run_at.
func (h *handler) markRun(ctx context.Context, id, status string, reason *string) error {
	if reason != nil {
		if runes := []rune(*reason); len(runes) > 500 {
			s := string(runes[:500])
			reason = &s
		}
	}
	_, err := h.db.Exec(ctx, `UPDATE crm.crm_report_schedules
     SET last_run_at = now(), last_status = $2, last_error = $3,
         next_run_at = COALESCE($4::timestamptz, next_run_at), updated_at = now()
     WHERE id = $1`, id, status, reason, nil)
	return err
}

// parseRecipients keeps the well-formed stored recipients.
func parseRecipients(raw any) []recipient {
	b, ok := raw.(json.RawMessage)
	if !ok {
		return nil
	}
	var items []any
	if json.Unmarshal(b, &items) != nil {
		return nil
	}
	var out []recipient
	for _, item := range items {
		o, _ := item.(map[string]any)
		userID, isUserID := o["user_id"].(string)
		number, isNumber := o["number"].(string)
		switch {
		case o["type"] == "user" && isUserID:
			out = append(out, recipient{Type: "user", UserID: userID})
		case o["type"] == "number" && isNumber:
			out = append(out, recipient{Type: "number", Number: number})
		}
	}
	return out
}

// plainRow turns a node-postgres row into domain values (dates as time.Time).
func plainRow(row *kit.Row) domain.Row {
	out := domain.Row{}
	for _, k := range row.Keys() {
		v := row.Get(k)
		if t, ok := v.(kit.JSTime); ok {
			v = time.Time(t)
		}
		out[k] = v
	}
	return out
}
