package payroll

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/storage"
)

// SubtaskItem is a weighted sub-task with its tick on one occurrence.
type SubtaskItem struct {
	ID            string     `json:"id"`
	Title         string     `json:"title"`
	Weight        float64    `json:"weight"`
	SortOrder     int        `json:"sort_order"`
	IsChecked     bool       `json:"is_checked"`
	CheckedByName *string    `json:"checked_by_name"`
	CheckedAt     *time.Time `json:"checked_at"`
}

// TaskUpdate is one history line of an occurrence.
type TaskUpdate struct {
	ID              string          `json:"id"`
	Kind            string          `json:"kind"`
	Note            *string         `json:"note"`
	ProgressPercent *int            `json:"progress_percent"`
	AuthorName      *string         `json:"author_name"`
	AuthorUserID    *string         `json:"author_user_id"`
	Detail          json.RawMessage `json:"detail"`
	CreatedAt       time.Time       `json:"created_at"`
}

// TaskAttachment is a file on an occurrence; bytes come from the download route.
type TaskAttachment struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Mime           string    `json:"mime"`
	SizeBytes      int64     `json:"size_bytes"`
	UploadedBy     *string   `json:"uploaded_by_user_id"`
	UploadedByName string    `json:"uploaded_by_name"`
	CreatedAt      time.Time `json:"created_at"`
}

// TaskContribution is the KPI contribution an approved occurrence recorded.
type TaskContribution struct {
	IndicatorID string    `json:"indicator_id"`
	PeriodYear  int       `json:"period_year"`
	PeriodMonth int       `json:"period_month"`
	Amount      *float64  `json:"amount"`
	RecordedAt  time.Time `json:"recorded_at"`
}

// TaskDetail is an occurrence with everything attached to it.
type TaskDetail struct {
	TaskItem
	Subtasks     []SubtaskItem     `json:"subtasks"`
	Updates      []TaskUpdate      `json:"updates"`
	Attachments  []TaskAttachment  `json:"attachments"`
	Contribution *TaskContribution `json:"contribution"`
	WeeklyDay    *int              `json:"weekly_day"`
	MonthlyDay   *int              `json:"monthly_day"`
	DueDate      *string           `json:"due_date"`
}

// occurrenceDetail answers GET /api/hris/dept-tasks/occurrences/{id}.
func (s *service) occurrenceDetail(ctx context.Context, v *viewActor, id string) (*TaskDetail, error) {
	it, err := s.loadItem(ctx, v, id)
	if err != nil {
		return nil, err
	}
	d := &TaskDetail{TaskItem: *it, Subtasks: []SubtaskItem{}, Updates: []TaskUpdate{}, Attachments: []TaskAttachment{}}
	if err := s.db.QueryRow(ctx, `SELECT weekly_day, monthly_day, due_date::text FROM hris.department_tasks WHERE id = $1`, it.TaskID).
		Scan(&d.WeeklyDay, &d.MonthlyDay, &d.DueDate); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT st.id::text, st.title, st.weight::float8, st.sort_order, COALESCE(oi.is_checked, false), oi.checked_by_name, oi.checked_at
		  FROM hris.department_task_subtasks st
		  LEFT JOIN hris.department_task_occurrence_items oi ON oi.subtask_id = st.id AND oi.occurrence_id = $1
		 WHERE st.task_id = $2 ORDER BY st.sort_order, st.created_at`, id, it.TaskID)
	if err != nil {
		return nil, err
	}
	if d.Subtasks, err = pgx.CollectRows(rows, pgx.RowToStructByPos[SubtaskItem]); err != nil {
		return nil, err
	}
	rows, err = s.db.Query(ctx, `SELECT id::text, kind, note, progress_percent::int, author_name, author_user_id::text, detail, created_at
		  FROM hris.department_task_updates WHERE occurrence_id = $1 ORDER BY created_at DESC LIMIT 200`, id)
	if err != nil {
		return nil, err
	}
	if d.Updates, err = pgx.CollectRows(rows, pgx.RowToStructByPos[TaskUpdate]); err != nil {
		return nil, err
	}
	rows, err = s.db.Query(ctx, `SELECT id::text, name, mime, size_bytes, uploaded_by_user_id::text, uploaded_by_name, created_at
		  FROM hris.department_task_attachments WHERE occurrence_id = $1 ORDER BY created_at`, id)
	if err != nil {
		return nil, err
	}
	if d.Attachments, err = pgx.CollectRows(rows, pgx.RowToStructByPos[TaskAttachment]); err != nil {
		return nil, err
	}
	var c TaskContribution
	err = s.db.QueryRow(ctx, `SELECT indicator_id::text, period_year, period_month, amount::float8, recorded_at
		FROM hris.department_task_kpi_contributions WHERE occurrence_id = $1`, id).Scan(&c.IndicatorID, &c.PeriodYear, &c.PeriodMonth, &c.Amount, &c.RecordedAt)
	if err == nil {
		d.Contribution = &c
	} else if !database.IsNoRows(err) {
		return nil, err
	}
	if d.Subtasks == nil {
		d.Subtasks = []SubtaskItem{}
	}
	if d.Updates == nil {
		d.Updates = []TaskUpdate{}
	}
	if d.Attachments == nil {
		d.Attachments = []TaskAttachment{}
	}
	return d, nil
}

// logUpdate appends a history line to an occurrence.
func logUpdate(ctx context.Context, q database.Querier, occurrenceID string, a *actor, name, kind string, note *string, percent *int, detail map[string]any) error {
	if detail == nil {
		detail = map[string]any{}
	}
	raw, _ := json.Marshal(detail)
	var userID, employeeID *string
	if a != nil {
		userID, employeeID = &a.UserID, a.EmployeeID
	}
	_, err := q.Exec(ctx, `INSERT INTO hris.department_task_updates
		(occurrence_id, kind, note, progress_percent, author_employee_id, author_user_id, author_name, detail)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`, occurrenceID, kind, note, percent, employeeID, userID, name, string(raw))
	return err
}

/* ── Attachments ───────────────────────────────────────────────────────── */

// MaxAttachmentBytes is the largest file an occurrence takes.
const MaxAttachmentBytes = storage.MaxFileSize

var controlChars = regexp.MustCompile(`[\x00-\x1f\x7f]`)

func cleanFileName(name string) string {
	s := controlChars.ReplaceAllString(name, "")
	s = strings.NewReplacer(`\`, "-", "/", "-").Replace(s)
	s = strings.TrimSpace(s)
	if strings.Trim(s, ".") == "" {
		s = "lampiran"
	}
	if r := []rune(s); len(r) > 255 {
		s = string(r[:255])
	}
	return s
}

// resolveMime trusts the bytes first, then the client's type.
func resolveMime(f *storage.File) string {
	if m := storage.SniffDocument(f.Data); m != "" {
		return m
	}
	if m := http.DetectContentType(f.Data); m != "application/octet-stream" {
		return strings.SplitN(m, ";", 2)[0]
	}
	if c := strings.ToLower(strings.TrimSpace(f.Type)); strings.Count(c, "/") == 1 && len(c) <= 150 {
		return c
	}
	return "application/octet-stream"
}

// addAttachment stores the file under private/dept-tasks/YYYY/MM and its row.
func (s *service) addAttachment(ctx context.Context, v *viewActor, occurrenceID string, f *storage.File) (*TaskAttachment, error) {
	it, err := s.loadItem(ctx, v, occurrenceID)
	if err != nil {
		return nil, err
	}
	if !it.CanWork && !it.CanManage {
		return nil, httpx.Forbidden("Hanya penanggung jawab atau kepala departemen yang bisa melampirkan file")
	}
	if f.Size() > MaxAttachmentBytes {
		return nil, httpx.BadRequest("Ukuran file maksimal 10 MB")
	}
	if f.Size() == 0 {
		return nil, httpx.BadRequest("File kosong")
	}
	mime := resolveMime(f)
	token := make([]byte, 12)
	_, _ = rand.Read(token)
	now := s.now().In(v.Zone)
	rel := fmt.Sprintf("dept-tasks/%d/%02d/%s.%s", now.Year(), int(now.Month()), hex.EncodeToString(token), storage.SafeExtension(mime, f.Name))
	if err := s.ports.TaskStore.WritePrivate(rel, f.Data); err != nil {
		return nil, err
	}
	att := &TaskAttachment{Name: cleanFileName(f.Name), Mime: mime, SizeBytes: f.Size(), UploadedBy: &v.UserID, UploadedByName: v.Name}
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO hris.department_task_attachments
			(occurrence_id, name, mime, size_bytes, storage_path, uploaded_by_user_id, uploaded_by_name)
			VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text, created_at`,
			occurrenceID, att.Name, mime, att.SizeBytes, rel, v.UserID, v.Name).Scan(&att.ID, &att.CreatedAt); err != nil {
			return err
		}
		return logUpdate(ctx, tx, occurrenceID, v.actor, v.Name, "attachment", nil, nil, map[string]any{"name": att.Name})
	})
	if err != nil {
		s.ports.TaskStore.DeletePrivate(rel)
		return nil, err
	}
	return att, nil
}

// readAttachment returns the bytes, mime and name of an attachment the
// actor may see.
func (s *service) readAttachment(ctx context.Context, v *viewActor, occurrenceID, attID string) ([]byte, string, string, error) {
	if _, err := s.loadItem(ctx, v, occurrenceID); err != nil {
		return nil, "", "", err
	}
	var rel, name, mime string
	err := s.db.QueryRow(ctx, `SELECT storage_path, name, mime FROM hris.department_task_attachments WHERE id = $1 AND occurrence_id = $2`,
		attID, occurrenceID).Scan(&rel, &name, &mime)
	if database.IsNoRows(err) {
		return nil, "", "", httpx.NotFound("Lampiran tidak ditemukan")
	}
	if err != nil {
		return nil, "", "", err
	}
	data, _, err := s.ports.TaskStore.ReadPrivate(rel)
	if err != nil {
		return nil, "", "", httpx.NotFound("File lampiran tidak ada lagi di penyimpanan")
	}
	return data, mime, name, nil
}

// deleteAttachment removes the row and the file: the uploader, or whoever
// manages the department.
func (s *service) deleteAttachment(ctx context.Context, v *viewActor, occurrenceID, attID string) error {
	it, err := s.loadItem(ctx, v, occurrenceID)
	if err != nil {
		return err
	}
	var rel string
	var owner *string
	err = s.db.QueryRow(ctx, `SELECT storage_path, uploaded_by_user_id::text FROM hris.department_task_attachments WHERE id = $1 AND occurrence_id = $2`,
		attID, occurrenceID).Scan(&rel, &owner)
	if database.IsNoRows(err) {
		return httpx.NotFound("Lampiran tidak ditemukan")
	}
	if err != nil {
		return err
	}
	if (owner == nil || *owner != v.UserID) && !it.CanManage {
		return httpx.Forbidden("Hanya pengunggah atau kepala departemen yang bisa menghapus lampiran")
	}
	if _, err := s.db.Exec(ctx, `DELETE FROM hris.department_task_attachments WHERE id = $1`, attID); err != nil {
		return err
	}
	s.ports.TaskStore.DeletePrivate(rel)
	return nil
}
