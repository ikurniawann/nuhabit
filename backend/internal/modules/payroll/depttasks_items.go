package payroll

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/localtime"
)

// To-do views over department task occurrences (MOM item 13): the
// assignee's own list per day, week and month, the department board, the
// KPI view and the monitor. One row is one occurrence.

// viewActor is the task actor with the reach the IAM menus and the branch
// zone give it.
type viewActor struct {
	*taskActor
	Name string
	now  time.Time
	// Zone is the branch zone of the account; "today" is read in it.
	Zone *time.Location
	// TeamAll (HR, or menu tasks.team) sees every department's board.
	TeamAll bool
	// KpiAll (HR, tasks.kpi or hris.performance) reads every department's
	// KPI view and every employee's contributions.
	KpiAll bool
}

// viewActor builds the actor of a staff route's user.
func (h *handler) viewActor(ctx context.Context, u *auth.User) (*viewActor, error) {
	a := &actor{UserID: u.ID, Role: u.Role, IsHR: domain.IsHR(u.Role)}
	id, err := h.svc.ports.Employees.IDByUser(ctx, h.svc.db, u.ID)
	if err != nil {
		return nil, err
	}
	if id != "" {
		a.EmployeeID = &id
	}
	me, err := h.svc.loadTaskActor(ctx, a)
	if err != nil {
		return nil, err
	}
	v := &viewActor{taskActor: me, Name: u.FullName, now: h.svc.now()}
	if v.Name == "" {
		v.Name = u.Email
	}
	if me.FullName != nil {
		v.Name = *me.FullName
	}
	if v.Zone, err = localtime.BranchZone(ctx, h.svc.db, u.BranchID); err != nil {
		return nil, err
	}
	roleIDs, err := h.auth.ResolveRoleIDs(ctx, u.ID, u.Role)
	if err != nil {
		return nil, err
	}
	granted, err := h.auth.GrantedMenuActions(ctx, roleIDs)
	if err != nil {
		return nil, err
	}
	v.TeamAll = a.IsHR || iam.HasGrantedAction(granted, iam.TasksTeam, "read")
	v.KpiAll = v.TeamAll || iam.HasGrantedAction(granted, iam.TasksKpi, "read") || iam.HasGrantedAction(granted, iam.HrisPerformance, "read")
	return v, nil
}

// managesDept: every department with tasks.team or HR, otherwise the
// department the actor heads (active direct reports, same department).
func (v *viewActor) managesDept(departmentID string) bool {
	return v.TeamAll || (v.HasSubordinates && v.DepartmentID != nil && *v.DepartmentID == departmentID)
}

// teamScope is "all", "heads" or "none": what the board shows the actor.
func (v *viewActor) teamScope() string {
	switch {
	case v.TeamAll:
		return "all"
	case v.HasSubordinates && v.DepartmentID != nil:
		return "heads"
	default:
		return "none"
	}
}

func (v *viewActor) today() string { return domain.DayKey(v.now, v.Zone) }

// TaskItem is one occurrence as the views return it.
type TaskItem struct {
	OccurrenceID     string     `json:"occurrence_id"`
	TaskID           string     `json:"task_id"`
	Title            string     `json:"title"`
	Description      string     `json:"description"`
	DepartmentID     string     `json:"department_id"`
	DepartmentName   string     `json:"department_name"`
	AssigneeID       *string    `json:"assignee_employee_id"`
	AssigneeName     *string    `json:"assignee_name"`
	CreatorUserID    *string    `json:"created_by_user_id"`
	CreatorName      string     `json:"created_by_name"`
	Date             string     `json:"occurrence_date"`
	Status           string     `json:"status"`
	ProgressPercent  *int       `json:"progress_percent"`
	StartedAt        *time.Time `json:"started_at"`
	DoneAt           *time.Time `json:"done_at"`
	DoneByName       *string    `json:"done_by_name"`
	ReviewNotes      *string    `json:"review_notes"`
	ReviewedByName   *string    `json:"reviewed_by_name"`
	Recurrence       string     `json:"recurrence"`
	Priority         string     `json:"priority"`
	ReviewRequired   bool       `json:"review_required"`
	Timezone         string     `json:"timezone"`
	KpiIndicatorID   *string    `json:"kpi_indicator_id"`
	KpiIndicatorCode *string    `json:"kpi_indicator_code"`
	KpiIndicatorName *string    `json:"kpi_indicator_name"`
	KpiContribution  *float64   `json:"kpi_contribution"`
	SubtaskTotal     *float64   `json:"-"`
	SubtaskDone      *float64   `json:"-"`
	SubtaskCount     int        `json:"subtask_count"`
	CommentCount     int        `json:"comment_count"`
	AttachmentCount  int        `json:"attachment_count"`
	LastNote         *string    `json:"last_note"`
	LastNoteBy       *string    `json:"last_note_by"`
	LastNoteAt       *time.Time `json:"last_note_at"`
	// Progress is the effective 0-100 progress; Overdue is an open row past
	// its day in the task's zone.
	Progress int  `json:"progress"`
	Overdue  bool `json:"overdue"`
	// Mine: assigned to the reader, unassigned in their department, or filed
	// by them. CanWork, CanReview and CanManage follow the occurrence rules.
	Mine      bool `json:"mine"`
	CanWork   bool `json:"can_work"`
	CanReview bool `json:"can_review"`
	CanManage bool `json:"can_manage"`
}

const itemSelect = `SELECT o.id::text, t.id::text, t.title, COALESCE(t.description, ''), t.department_id::text, d.name,
  t.assignee_employee_id::text, a.full_name, t.created_by_user_id::text, COALESCE(t.created_by_name, ''),
  o.occurrence_date::text, o.status, o.progress_percent::int, o.started_at, o.done_at, o.done_by_name, o.review_notes, o.reviewed_by_name,
  t.recurrence, t.priority, t.review_required, t.timezone,
  t.kpi_indicator_id::text, k.code, k.name, t.kpi_contribution::float8,
  st.total::float8, st.done::float8, COALESCE(st.n, 0)::int,
  (SELECT count(*)::int FROM hris.department_task_updates u WHERE u.occurrence_id = o.id AND u.kind = 'comment'),
  (SELECT count(*)::int FROM hris.department_task_attachments x WHERE x.occurrence_id = o.id),
  lu.note, lu.author_name, lu.created_at
  FROM hris.department_task_occurrences o
  JOIN hris.department_tasks t ON t.id = o.task_id
  JOIN hris.departments d ON d.id = t.department_id
  LEFT JOIN hris.employees a ON a.id = t.assignee_employee_id
  LEFT JOIN performance.kpi_indicators k ON k.id = t.kpi_indicator_id
  LEFT JOIN LATERAL (
    SELECT SUM(s.weight) AS total, SUM(s.weight) FILTER (WHERE oi.is_checked) AS done, count(*) AS n
      FROM hris.department_task_subtasks s
      LEFT JOIN hris.department_task_occurrence_items oi ON oi.subtask_id = s.id AND oi.occurrence_id = o.id
     WHERE s.task_id = t.id) st ON true
  LEFT JOIN LATERAL (
    SELECT note, author_name, created_at FROM hris.department_task_updates
     WHERE occurrence_id = o.id AND note IS NOT NULL ORDER BY created_at DESC LIMIT 1) lu ON true `

func scanItem(r pgx.CollectableRow) (TaskItem, error) {
	var i TaskItem
	err := r.Scan(&i.OccurrenceID, &i.TaskID, &i.Title, &i.Description, &i.DepartmentID, &i.DepartmentName,
		&i.AssigneeID, &i.AssigneeName, &i.CreatorUserID, &i.CreatorName,
		&i.Date, &i.Status, &i.ProgressPercent, &i.StartedAt, &i.DoneAt, &i.DoneByName, &i.ReviewNotes, &i.ReviewedByName,
		&i.Recurrence, &i.Priority, &i.ReviewRequired, &i.Timezone,
		&i.KpiIndicatorID, &i.KpiIndicatorCode, &i.KpiIndicatorName, &i.KpiContribution,
		&i.SubtaskTotal, &i.SubtaskDone, &i.SubtaskCount, &i.CommentCount, &i.AttachmentCount,
		&i.LastNote, &i.LastNoteBy, &i.LastNoteAt)
	return i, err
}

// finish fills the derived fields of an item for the reader.
func (i *TaskItem) finish(v *viewActor, now time.Time) {
	var manual, subtask *float64
	if i.ProgressPercent != nil {
		p := float64(*i.ProgressPercent)
		manual = &p
	}
	if i.SubtaskTotal != nil && *i.SubtaskTotal > 0 {
		done := 0.0
		if i.SubtaskDone != nil {
			done = *i.SubtaskDone
		}
		share := done / *i.SubtaskTotal * 100
		subtask = &share
	}
	i.Progress = domain.EffectiveProgress(i.Status, manual, subtask)
	i.Overdue = domain.OccurrenceOverdue(i.Date, i.Status, domain.DayKey(now, localtime.Zone(i.Timezone)))
	if v == nil {
		return
	}
	assignedToMe := v.EmployeeID != nil && i.AssigneeID != nil && *i.AssigneeID == *v.EmployeeID
	inMyDept := v.DepartmentID != nil && *v.DepartmentID == i.DepartmentID
	i.Mine = assignedToMe || (i.AssigneeID == nil && inMyDept) || (i.CreatorUserID != nil && *i.CreatorUserID == v.UserID)
	i.CanWork = v.IsHR || assignedToMe || (i.AssigneeID == nil && inMyDept)
	i.CanManage = v.managesDept(i.DepartmentID) || (i.CreatorUserID != nil && *i.CreatorUserID == v.UserID && !i.ReviewRequired)
	i.CanReview = i.ReviewRequired && v.managesDept(i.DepartmentID)
}

func (s *service) queryItems(ctx context.Context, v *viewActor, where string, args ...any) ([]TaskItem, error) {
	rows, err := s.db.Query(ctx, itemSelect+where, args...)
	if err != nil {
		return nil, err
	}
	items, err := pgx.CollectRows(rows, scanItem)
	if err != nil {
		return nil, err
	}
	now := s.now()
	for i := range items {
		items[i].finish(v, now)
	}
	if items == nil {
		items = []TaskItem{}
	}
	return items, nil
}

// loadItem reads one occurrence the actor may see; others look missing.
func (s *service) loadItem(ctx context.Context, v *viewActor, occurrenceID string) (*TaskItem, error) {
	items, err := s.queryItems(ctx, v, `WHERE o.id = $1`, occurrenceID)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httpx.NotFound("Kemunculan task tidak ditemukan")
	}
	it := &items[0]
	if !it.Mine && !it.CanWork && !it.CanManage && !v.KpiAll {
		return nil, httpx.NotFound("Kemunculan task tidak ditemukan")
	}
	return it, nil
}

// itemFilter selects occurrences. Scope "mine" is the actor's own list;
// "team" the department board. View picks the day span in the actor's
// zone, month overrides it; open rows past due always come along, first.
type itemFilter struct {
	Scope, View, Month, Q                         string
	DepartmentID, AssigneeID, Status, IndicatorID *string
}

// listItems answers GET /api/hris/dept-tasks/items. Occurrences of the
// departments in reach are generated for the span first (idempotent), so
// a weekly task shows up in Minggu ini before its day.
func (s *service) listItems(ctx context.Context, v *viewActor, f itemFilter) ([]TaskItem, error) {
	today := v.today()
	where := []string{"t.is_active"}
	var args []any
	arg := func(x any) string {
		args = append(args, x)
		return fmt.Sprintf("$%d", len(args))
	}
	var depts []string
	switch f.Scope {
	case "team":
		switch {
		case v.TeamAll:
			if f.DepartmentID != nil {
				depts = []string{*f.DepartmentID}
			} else {
				all, err := s.ports.Departments.All(ctx, s.db)
				if err != nil {
					return nil, err
				}
				for _, d := range all {
					depts = append(depts, d.ID)
				}
			}
		case v.teamScope() == "none":
			return nil, httpx.Forbidden("Papan tim hanya untuk kepala departemen")
		case f.DepartmentID != nil && *f.DepartmentID != *v.DepartmentID:
			return nil, httpx.Forbidden("Anda bukan kepala departemen ini")
		default:
			depts = []string{*v.DepartmentID}
		}
		where = append(where, "t.department_id::text = ANY("+arg(depts)+")")
	default:
		if v.DepartmentID != nil {
			depts = []string{*v.DepartmentID}
		}
		emp := ""
		if v.EmployeeID != nil {
			emp = *v.EmployeeID
		}
		where = append(where, "(t.assignee_employee_id::text = "+arg(emp)+
			" OR (t.assignee_employee_id IS NULL AND t.department_id::text = "+arg(strOr(v.DepartmentID))+")"+
			" OR t.created_by_user_id = "+arg(v.UserID)+")")
	}

	span, ranged := domain.ViewRange(f.View, s.now(), v.Zone), true
	switch {
	case f.Month != "":
		var ok bool
		if span, ok = domain.MonthSpan(f.Month); !ok {
			return nil, httpx.BadRequest("Bulan tidak valid, pakai format YYYY-MM")
		}
	case f.View == "all":
		ranged = false
	}
	if ranged {
		// Generate from the start of the span's month so this month's
		// earlier rows exist for the overdue list.
		from := span.Start
		if monthStart := span.Start[:7] + "-01"; monthStart < from {
			from = monthStart
		}
		for _, d := range depts {
			if err := s.ensureOccurrences(ctx, d, from, span.End); err != nil {
				return nil, err
			}
		}
		where = append(where, "((o.occurrence_date BETWEEN "+arg(span.Start)+"::date AND "+arg(span.End)+"::date)"+
			" OR (o.status IN ('pending','in_progress','rejected') AND o.occurrence_date < "+arg(today)+"::date))")
	}
	if f.AssigneeID != nil {
		where = append(where, "t.assignee_employee_id = "+arg(*f.AssigneeID))
	}
	if f.Status != nil {
		where = append(where, "o.status = "+arg(*f.Status))
	}
	if f.IndicatorID != nil {
		where = append(where, "t.kpi_indicator_id = "+arg(*f.IndicatorID))
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		where = append(where, "(t.title ILIKE "+arg("%"+q+"%")+" OR t.description ILIKE "+arg("%"+q+"%")+")")
	}
	sql := "WHERE " + strings.Join(where, " AND ") + ` ORDER BY
	  (o.status IN ('pending','in_progress','rejected') AND o.occurrence_date < ` + arg(today) + `::date) DESC,
	  o.occurrence_date, array_position(ARRAY['urgent','high','normal','low'], t.priority), t.created_at`
	return s.queryItems(ctx, v, sql, args...)
}

func strOr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// inboxNotice writes a dashboard inbox row (public.notifications).
func inboxNotice(ctx context.Context, q database.Querier, userID, title, body, link, kind string) error {
	_, err := q.Exec(ctx, `INSERT INTO public.notifications (user_id, title, message, type, link, metadata)
		VALUES ($1, $2, $3, 'reminder', $4, jsonb_build_object('tasks_kind', $5::text))`, userID, title, body, link, kind)
	return err
}
