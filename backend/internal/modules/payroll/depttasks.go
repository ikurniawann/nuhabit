package payroll

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/validate"
)

func ptrInt(i int) *int { return &i }

// Department tasks (lib/hris/dept-tasks-repo.ts). hris.department_task*
// belong to this module; employees and departments come through ports.

// taskActor is TaskActor: the workforce actor with its department, name
// and whether it heads anyone (has active direct reports).
type taskActor struct {
	*actor
	DepartmentID    *string
	FullName        *string
	HasSubordinates bool
}

func (s *service) loadTaskActor(ctx context.Context, a *actor) (*taskActor, error) {
	me := &taskActor{actor: a}
	if a.EmployeeID == nil {
		return me, nil
	}
	b, err := s.brief(ctx, *a.EmployeeID)
	if err != nil || b == nil {
		return me, err
	}
	me.DepartmentID, me.FullName = b.DepartmentID, &b.FullName
	reports, err := s.ports.Employees.DirectReports(ctx, s.db, *a.EmployeeID)
	me.HasSubordinates = len(reports) > 0
	return me, err
}

// targetDepartment: HR may pick a department; everyone else gets their own.
func targetDepartment(me *taskActor, requested *string) *string {
	if me.IsHR && requested != nil && uuidRE.MatchString(*requested) {
		return requested
	}
	return me.DepartmentID
}

// isDepartmentHead: the employee is in the department (and active when
// required) and has at least one active direct report.
func (s *service) isDepartmentHead(ctx context.Context, employeeID, departmentID string, requireActive bool) (bool, error) {
	b, err := s.brief(ctx, employeeID)
	if err != nil || b == nil || (requireActive && !b.IsActive) || b.DepartmentID == nil || *b.DepartmentID != departmentID {
		return false, err
	}
	reports, err := s.ports.Employees.DirectReports(ctx, s.db, employeeID)
	return len(reports) > 0, err
}

// ensureOccurrences generates the missing occurrences of the department's
// active tasks in [start, end] (idempotent).
func (s *service) ensureOccurrences(ctx context.Context, departmentID, start, end string) error {
	rows, err := s.db.Query(ctx, `SELECT id::text, recurrence, weekly_day, monthly_day, due_date::text,
		(created_at AT TIME ZONE timezone)::date::text
		FROM hris.department_tasks WHERE department_id = $1 AND is_active = true`, departmentID)
	if err != nil {
		return err
	}
	type task struct {
		id string
		domain.TaskSchedule
	}
	tasks, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (task, error) {
		var t task
		return t, r.Scan(&t.id, &t.Recurrence, &t.WeeklyDay, &t.MonthlyDay, &t.DueDate, &t.CreatedDate)
	})
	if err != nil {
		return err
	}
	var ids, dates []string
	for _, t := range tasks {
		for _, d := range domain.OccurrenceDates(t.TaskSchedule, start, end) {
			ids, dates = append(ids, t.id), append(dates, d)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	_, err = s.db.Exec(ctx, `INSERT INTO hris.department_task_occurrences (task_id, occurrence_date)
		SELECT * FROM unnest($1::uuid[], $2::date[])
		ON CONFLICT (task_id, occurrence_date) DO NOTHING`, ids, dates)
	return err
}

func departmentRows(depts []Department) []*obj {
	out := make([]*obj, len(depts))
	for i, d := range depts {
		out[i] = object("id", d.ID, "name", d.Name)
	}
	return out
}

func (s *service) deptTaskBoard(ctx context.Context, me *taskActor, month string, requested *string) (*obj, error) {
	departmentID := targetDepartment(me, requested)
	departments := []*obj{}
	if me.IsHR {
		all, err := s.ports.Departments.All(ctx, s.db)
		if err != nil {
			return nil, err
		}
		departments = departmentRows(all)
	}
	if departmentID == nil {
		return object("department_id", nil, "tasks", []any{}, "occurrences", []any{}, "members", []any{},
			"departments", departments, "can_manage", me.IsHR, "is_hr", me.IsHR), nil
	}
	dept := *departmentID
	start, end := domain.MonthRange(month)
	if err := s.ensureOccurrences(ctx, dept, start, end); err != nil {
		return nil, err
	}
	tasks, err := queryObjs(ctx, s.db, `SELECT t.id, t.title, t.description, t.recurrence, t.weekly_day,
		       t.monthly_day, t.due_date::text, t.is_active, t.assignee_employee_id, NULL AS assignee_name,
		       t.created_by_name
		  FROM hris.department_tasks t
		 WHERE t.department_id = $1 AND t.is_active = true
		 ORDER BY t.created_at`, dept)
	if err != nil {
		return nil, err
	}
	if err := s.fillNames(ctx, tasks, "assignee_name", "assignee_employee_id"); err != nil {
		return nil, err
	}
	occurrences, err := queryObjs(ctx, s.db, `SELECT o.id, o.task_id, o.occurrence_date::text, o.status,
		       o.done_at, o.done_by_name, o.review_notes, o.reviewed_by_name
		  FROM hris.department_task_occurrences o
		  JOIN hris.department_tasks t ON t.id = o.task_id
		 WHERE t.department_id = $1 AND o.occurrence_date BETWEEN $2 AND $3
		 ORDER BY o.occurrence_date, t.created_at`, dept, start, end)
	if err != nil {
		return nil, err
	}
	members, err := s.ports.Employees.DepartmentMembers(ctx, s.db, dept)
	if err != nil {
		return nil, err
	}
	memberRows := make([]*obj, len(members))
	for i, m := range members {
		memberRows[i] = object("id", m.ID, "full_name", m.FullName)
	}
	subtasks, err := queryObjs(ctx, s.db, `SELECT st.id, st.task_id, st.title, st.weight, st.sort_order
		  FROM hris.department_task_subtasks st
		  JOIN hris.department_tasks t ON t.id = st.task_id
		 WHERE t.department_id = $1
		 ORDER BY st.task_id, st.sort_order, st.created_at`, dept)
	if err != nil {
		return nil, err
	}
	checked, err := queryObjs(ctx, s.db, `SELECT oi.occurrence_id, oi.subtask_id, oi.is_checked,
		       oi.checked_by_name, oi.checked_at
		  FROM hris.department_task_occurrence_items oi
		  JOIN hris.department_task_occurrences o ON o.id = oi.occurrence_id
		  JOIN hris.department_tasks t ON t.id = o.task_id
		 WHERE t.department_id = $1 AND o.occurrence_date BETWEEN $2 AND $3`, dept, start, end)
	if err != nil {
		return nil, err
	}
	return object("department_id", dept, "tasks", tasks, "occurrences", occurrences, "members", memberRows,
		"subtasks", subtasks, "checked_items", checked, "departments", departments,
		"can_manage", me.IsHR || me.HasSubordinates,
		"can_review", me.IsHR || (me.HasSubordinates && me.DepartmentID != nil && dept == *me.DepartmentID),
		"is_hr", me.IsHR, "my_employee_id", me.EmployeeID), nil
}

// fillNames sets alias to the full name of the employee in column (a LEFT
// JOIN on hris.employees in the TS).
func (s *service) fillNames(ctx context.Context, rows []*obj, alias, column string) error {
	var ids []string
	for _, r := range rows {
		if id := r.Str(column); id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		for _, r := range rows {
			r.Set(alias, nil)
		}
		return nil
	}
	briefs, err := s.ports.Employees.Briefs(ctx, s.db, ids)
	if err != nil {
		return err
	}
	for _, r := range rows {
		if b, ok := briefs[r.Str(column)]; ok {
			r.Set(alias, b.FullName)
		} else {
			r.Set(alias, nil)
		}
	}
	return nil
}

// taskExtras are the fields MOM item 13 added to a new task.
type taskExtras struct {
	Priority        string
	KpiIndicatorID  *string
	KpiContribution *float64
	// Timezone is the creator's branch zone; the task's dates are read in it.
	Timezone string
}

// createDeptTask files a task. HR files anywhere, a head in their own
// department; anyone else may file a task for themselves in their own
// department (a personal to-do). A task assigned to its creator needs no
// review: done is final.
func (s *service) createDeptTask(ctx context.Context, me *taskActor, deptParam, assigneeParam *string, task *domain.NormalizedTask, x taskExtras) (string, error) {
	departmentID := targetDepartment(me, deptParam)
	if departmentID == nil {
		return "", httpx.BadRequest("Departemen tidak diketahui")
	}
	self := assigneeParam != nil && me.EmployeeID != nil && *assigneeParam == *me.EmployeeID
	if !me.IsHR {
		if !me.HasSubordinates && !self {
			return "", httpx.Forbidden("Hanya HRD atau atasan (kepala tim) yang boleh membuat task departemen")
		}
		if me.DepartmentID == nil || *departmentID != *me.DepartmentID {
			return "", httpx.Forbidden("Hanya boleh membuat task untuk departemen sendiri")
		}
	}
	var assignee *string
	if assigneeParam != nil && uuidRE.MatchString(*assigneeParam) {
		b, err := s.brief(ctx, *assigneeParam)
		if err != nil {
			return "", err
		}
		if b == nil || !b.IsActive || b.DepartmentID == nil || *b.DepartmentID != *departmentID {
			return "", httpx.BadRequest("Penanggung jawab harus karyawan aktif di departemen yang sama")
		}
		assignee = assigneeParam
	}
	if x.Priority == "" {
		x.Priority = "normal"
	}
	if !domain.ValidPriority(x.Priority) {
		return "", httpx.BadRequest("Prioritas tidak valid")
	}
	if err := s.checkIndicator(ctx, x.KpiIndicatorID); err != nil {
		return "", err
	}
	if x.Timezone == "" {
		x.Timezone = localtime.Default
	}
	createdBy := "—"
	if me.FullName != nil {
		createdBy = *me.FullName
	}
	var id string
	err := s.db.QueryRow(ctx, `INSERT INTO hris.department_tasks
		   (department_id, assignee_employee_id, title, description, recurrence,
		    weekly_day, monthly_day, due_date, created_by, created_by_name,
		    priority, kpi_indicator_id, kpi_contribution, timezone, review_required, created_by_user_id, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING id::text`,
		*departmentID, assignee, task.Title, task.Description, task.Schedule.Recurrence,
		task.Schedule.WeeklyDay, task.Schedule.MonthlyDay, task.Schedule.DueDate, me.EmployeeID, createdBy,
		x.Priority, x.KpiIndicatorID, x.KpiContribution, x.Timezone, !self, me.UserID, s.now()).Scan(&id)
	if err != nil {
		return "", err
	}
	for i, st := range task.Subtasks {
		if _, err := s.db.Exec(ctx, `INSERT INTO hris.department_task_subtasks (task_id, title, weight, sort_order)
			VALUES ($1, $2, $3, $4)`, id, st.Title, numParam(st.Weight), i); err != nil {
			return "", err
		}
	}
	return id, nil
}

// assertTaskManager: HR, the head of the task's department, or the
// creator of a personal (review-free) task.
func (s *service) assertTaskManager(ctx context.Context, a *actor, id, verb string) error {
	var deptID string
	var creator *string
	var reviewRequired bool
	err := s.db.QueryRow(ctx, `SELECT department_id::text, created_by_user_id::text, review_required
		FROM hris.department_tasks WHERE id = $1 AND is_active`, id).Scan(&deptID, &creator, &reviewRequired)
	if database.IsNoRows(err) {
		return httpx.NotFound("Task tidak ditemukan")
	}
	if err != nil {
		return err
	}
	if a.IsHR || (!reviewRequired && creator != nil && *creator == a.UserID) {
		return nil
	}
	if a.EmployeeID == nil {
		return httpx.Forbidden("Akun tidak terhubung ke karyawan")
	}
	head, err := s.isDepartmentHead(ctx, *a.EmployeeID, deptID, false)
	if err != nil {
		return err
	}
	if !head {
		return httpx.Forbidden("Hanya HRD atau atasan departemen ini yang boleh " + verb + " task")
	}
	return nil
}

func (s *service) deactivateDeptTask(ctx context.Context, a *actor, id string) error {
	if err := s.assertTaskManager(ctx, a, id, "menonaktifkan"); err != nil {
		return err
	}
	_, err := s.db.Exec(ctx, `UPDATE hris.department_tasks SET is_active = false, updated_at = now() WHERE id = $1`, id)
	return err
}

// taskPatch edits a task; nil keeps a value. AssigneeSet with a nil
// assignee clears it; KpiSet likewise clears the indicator.
type taskPatch struct {
	Title, Description, Priority *string
	Assignee                     *string
	AssigneeSet                  bool
	KpiIndicatorID               *string
	KpiSet                       bool
	KpiContribution              *float64
	KpiContributionSet           bool
}

func (s *service) updateDeptTask(ctx context.Context, a *actor, id string, p taskPatch) error {
	if err := s.assertTaskManager(ctx, a, id, "mengubah"); err != nil {
		return err
	}
	sets, args := []string{"updated_at = now()"}, []any{}
	set := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = $%d", col, len(args)))
	}
	if p.Title != nil {
		t := strings.TrimSpace(*p.Title)
		if len([]rune(t)) < 3 {
			return httpx.BadRequest("Judul task minimal 3 karakter")
		}
		set("title", t)
	}
	if p.Description != nil {
		set("description", trimOrNil(p.Description))
	}
	if p.Priority != nil {
		if !domain.ValidPriority(*p.Priority) {
			return httpx.BadRequest("Prioritas tidak valid")
		}
		set("priority", *p.Priority)
	}
	if p.AssigneeSet {
		if p.Assignee != nil {
			var deptID string
			if err := s.db.QueryRow(ctx, `SELECT department_id::text FROM hris.department_tasks WHERE id = $1`, id).Scan(&deptID); err != nil {
				return err
			}
			b, err := s.brief(ctx, *p.Assignee)
			if err != nil {
				return err
			}
			if b == nil || !b.IsActive || b.DepartmentID == nil || *b.DepartmentID != deptID {
				return httpx.BadRequest("Penanggung jawab harus karyawan aktif di departemen yang sama")
			}
		}
		set("assignee_employee_id", p.Assignee)
	}
	if p.KpiSet {
		if err := s.checkIndicator(ctx, p.KpiIndicatorID); err != nil {
			return err
		}
		set("kpi_indicator_id", p.KpiIndicatorID)
	}
	if p.KpiContributionSet {
		set("kpi_contribution", p.KpiContribution)
	}
	args = append(args, id)
	_, err := s.db.Exec(ctx, fmt.Sprintf("UPDATE hris.department_tasks SET %s WHERE id = $%d", strings.Join(sets, ", "), len(args)), args...)
	return err
}

func (s *service) checkIndicator(ctx context.Context, id *string) error {
	if id == nil {
		return nil
	}
	var ok bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM performance.kpi_indicators WHERE id = $1 AND is_active)`, *id).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return httpx.BadRequest("Indikator KPI tidak ditemukan")
	}
	return nil
}

type occurrence struct {
	ID, Status, TaskID, DepartmentID string
	Assignee                         *string
	ReviewRequired                   bool
	Date                             string
}

// assertWorker: the assignee, or any active department member when the task
// has none; HR as an administrative fallback. Approved is final.
func (s *service) assertWorker(ctx context.Context, a *actor, occ occurrence) error {
	if occ.Status == "approved" {
		return httpx.BadRequest("Sudah disetujui — tidak bisa diubah")
	}
	if a.IsHR {
		return nil
	}
	if a.EmployeeID == nil {
		return httpx.Forbidden("Akun ini tidak terhubung ke data karyawan")
	}
	if occ.Assignee != nil {
		if *occ.Assignee != *a.EmployeeID {
			return httpx.Forbidden("Hanya penanggung jawab task ini yang boleh mengerjakannya")
		}
		return nil
	}
	b, err := s.brief(ctx, *a.EmployeeID)
	if err != nil {
		return err
	}
	if b == nil || !b.IsActive || b.DepartmentID == nil || *b.DepartmentID != occ.DepartmentID {
		return httpx.Forbidden("Hanya anggota departemen ini yang boleh mengerjakannya")
	}
	return nil
}

type occurrenceAction struct {
	Action    string
	Notes     *string
	SubtaskID *string
	Checked   *bool
	// Note and ProgressPercent belong to the progress and comment actions.
	Note            *string
	ProgressPercent *int
}

// occurrenceActions are the PATCH actions: done, approve, reject and
// check_subtask (owner 2026-08-31), progress (EPIC-068: in_progress with a
// note and, for tasks without sub-tasks, 0-99%), start, reopen and comment.
var occurrenceActions = []string{"done", "approve", "reject", "check_subtask", "progress", "start", "reopen", "comment"}

func (s *service) occurrenceAction(ctx context.Context, a *actor, id string, in occurrenceAction) (any, error) {
	var occ occurrence
	err := s.db.QueryRow(ctx, `SELECT o.id::text, o.status, o.task_id::text, t.department_id::text, t.assignee_employee_id::text,
	          t.review_required, o.occurrence_date::text
		  FROM hris.department_task_occurrences o JOIN hris.department_tasks t ON t.id = o.task_id
		 WHERE o.id = $1`, id).Scan(&occ.ID, &occ.Status, &occ.TaskID, &occ.DepartmentID, &occ.Assignee, &occ.ReviewRequired, &occ.Date)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Kemunculan task tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	myName := "HRD"
	if a.EmployeeID != nil {
		myName = "—"
		if b, err := s.brief(ctx, *a.EmployeeID); err != nil {
			return nil, err
		} else if b != nil {
			myName = b.FullName
		}
	}
	log := func(kind string, note *string, percent *int, detail map[string]any) error {
		return logUpdate(ctx, s.db, id, a, myName, kind, note, percent, detail)
	}

	switch in.Action {
	case "comment":
		if err := s.assertParticipant(ctx, a, occ); err != nil {
			return nil, err
		}
		note := trimOrNil(in.Note)
		if note == nil {
			return nil, httpx.BadRequest("Komentar wajib diisi")
		}
		if err := log("comment", note, nil, nil); err != nil {
			return nil, err
		}
		return messageBody{"Komentar dikirim"}, nil
	case "check_subtask":
		if err := s.assertWorker(ctx, a, occ); err != nil {
			return nil, err
		}
		return s.checkSubtask(ctx, a, occ, in, myName)
	case "start":
		if err := s.assertWorker(ctx, a, occ); err != nil {
			return nil, err
		}
		if occ.Status == "done" {
			return nil, httpx.BadRequest("Task sudah ditandai selesai — menunggu review")
		}
		if _, err := s.db.Exec(ctx, `UPDATE hris.department_task_occurrences
			SET status = 'in_progress', started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1`, id); err != nil {
			return nil, err
		}
		if err := log("status", nil, nil, map[string]any{"status": "in_progress"}); err != nil {
			return nil, err
		}
		return messageBody{"Task mulai dikerjakan"}, nil
	case "progress":
		if err := s.assertWorker(ctx, a, occ); err != nil {
			return nil, err
		}
		if occ.Status == "done" {
			return nil, httpx.BadRequest("Task sudah ditandai selesai — menunggu review")
		}
		note := trimOrNil(in.Note)
		if note == nil {
			note = trimOrNil(in.Notes)
		}
		var percent *int
		if in.ProgressPercent != nil {
			var n int
			if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM hris.department_task_subtasks WHERE task_id = $1`, occ.TaskID).Scan(&n); err != nil {
				return nil, err
			}
			if n > 0 {
				return nil, httpx.BadRequest("Task ini memakai sub-task — progres dihitung dari ceklis sub-task")
			}
			if *in.ProgressPercent < 0 || *in.ProgressPercent > 99 {
				return nil, httpx.BadRequest("Progres 0–99% (untuk 100% pakai Tandai Selesai)")
			}
			percent = in.ProgressPercent
		}
		if note == nil && percent == nil {
			return nil, httpx.BadRequest("Isi catatan atau persen progres")
		}
		if _, err := s.db.Exec(ctx, `UPDATE hris.department_task_occurrences
			SET status = 'in_progress', started_at = COALESCE(started_at, now()),
			    progress_percent = COALESCE($2::smallint, progress_percent), updated_at = now()
			WHERE id = $1`, id, percent); err != nil {
			return nil, err
		}
		if err := log("progress", note, percent, nil); err != nil {
			return nil, err
		}
		return messageBody{"Progres dicatat — status Sedang dikerjakan"}, nil
	case "reopen":
		if err := s.assertReopener(ctx, a, occ); err != nil {
			return nil, err
		}
		if _, err := s.db.Exec(ctx, `UPDATE hris.department_task_occurrences
			SET status = 'pending', done_at = NULL, done_by = NULL, done_by_name = NULL, progress_percent = NULL,
			    review_notes = NULL, reviewed_by = NULL, reviewed_by_name = NULL, reviewed_at = NULL, updated_at = now()
			WHERE id = $1`, id); err != nil {
			return nil, err
		}
		if err := s.dropContribution(ctx, id); err != nil {
			return nil, err
		}
		if err := log("status", trimOrNil(in.Note), nil, map[string]any{"status": "pending"}); err != nil {
			return nil, err
		}
		return messageBody{"Task dibuka lagi"}, nil
	case "done":
		if err := s.assertWorker(ctx, a, occ); err != nil {
			return nil, err
		}
		if !occ.ReviewRequired {
			// A personal task: done is final, as if its owner approved it.
			if _, err := s.db.Exec(ctx, `UPDATE hris.department_task_occurrences
				SET status = 'approved', done_at = now(), done_by = $2, done_by_name = $3,
				    review_notes = NULL, reviewed_by = $2, reviewed_by_name = $3, reviewed_at = now(), updated_at = now()
				WHERE id = $1`, id, a.EmployeeID, myName); err != nil {
				return nil, err
			}
			if err := s.recordContribution(ctx, occ); err != nil {
				return nil, err
			}
			if err := log("status", nil, nil, map[string]any{"status": "approved"}); err != nil {
				return nil, err
			}
			return messageBody{"Tugas selesai"}, nil
		}
		if _, err := s.db.Exec(ctx, `UPDATE hris.department_task_occurrences
			SET status = 'done', done_at = now(), done_by = $2, done_by_name = $3,
			    review_notes = NULL, reviewed_by = NULL, reviewed_by_name = NULL,
			    reviewed_at = NULL, updated_at = now()
			WHERE id = $1`, id, a.EmployeeID, myName); err != nil {
			return nil, err
		}
		if err := log("status", nil, nil, map[string]any{"status": "done"}); err != nil {
			return nil, err
		}
		return messageBody{"Task ditandai selesai — menunggu review Head Division"}, nil
	}

	// reviewed_by holds the reviewer's employee id (like done_by/created_by).
	if a.EmployeeID == nil {
		return nil, httpx.Forbidden("Akun ini tidak terhubung ke data karyawan, tidak bisa mereview task")
	}
	reviewer := *a.EmployeeID
	if !a.IsHR {
		head, err := s.isDepartmentHead(ctx, reviewer, occ.DepartmentID, true)
		if err != nil {
			return nil, err
		}
		if !head {
			return nil, httpx.Forbidden("Hanya Head Division departemen ini (atau HRD) yang boleh mereview task")
		}
	}
	if occ.Status != "done" && !(in.Action == "reject" && occ.Status == "approved") {
		return nil, httpx.BadRequest("Hanya task berstatus selesai yang bisa direview")
	}
	status, msg := "rejected", "Task ditolak — penanggung jawab bisa memperbaiki"
	if in.Action == "approve" {
		status, msg = "approved", "Task disetujui"
	}
	if _, err := s.db.Exec(ctx, `UPDATE hris.department_task_occurrences
		SET status = $2, review_notes = $3, reviewed_by = $4, reviewed_by_name = $5,
		    reviewed_at = now(), updated_at = now()
		WHERE id = $1`, id, status, trimOrNil(in.Notes), reviewer, myName); err != nil {
		return nil, err
	}
	if status == "approved" {
		err = s.recordContribution(ctx, occ)
	} else {
		err = s.dropContribution(ctx, id)
	}
	if err != nil {
		return nil, err
	}
	if err := log("review", trimOrNil(in.Notes), nil, map[string]any{"status": status}); err != nil {
		return nil, err
	}
	return messageBody{msg}, nil
}

// assertParticipant: whoever may work the row (approved or not), its
// department head, or HR.
func (s *service) assertParticipant(ctx context.Context, a *actor, occ occurrence) error {
	open := occ
	open.Status = "pending"
	if err := s.assertWorker(ctx, a, open); err == nil {
		return nil
	}
	if a.EmployeeID != nil {
		head, err := s.isDepartmentHead(ctx, *a.EmployeeID, occ.DepartmentID, true)
		if err != nil {
			return err
		}
		if head {
			return nil
		}
	}
	return httpx.Forbidden("Hanya yang terlibat di task ini yang bisa berkomentar")
}

// assertReopener: the worker may reopen their own done or sent-back row;
// an approved row only HR or the department head.
func (s *service) assertReopener(ctx context.Context, a *actor, occ occurrence) error {
	if occ.Status != "approved" {
		return s.assertWorker(ctx, a, occ)
	}
	if a.IsHR {
		return nil
	}
	if a.EmployeeID == nil {
		return httpx.Forbidden("Akun ini tidak terhubung ke data karyawan")
	}
	head, err := s.isDepartmentHead(ctx, *a.EmployeeID, occ.DepartmentID, true)
	if err != nil {
		return err
	}
	if !head {
		return httpx.Forbidden("Hanya Head Division departemen ini (atau HRD) yang boleh membuka task yang sudah disetujui")
	}
	return nil
}

// recordContribution writes the KPI contribution of an approved occurrence
// in the month of its day; a task without an indicator records nothing.
func (s *service) recordContribution(ctx context.Context, occ occurrence) error {
	_, err := s.db.Exec(ctx, `INSERT INTO hris.department_task_kpi_contributions
	    (occurrence_id, indicator_id, department_id, employee_id, period_year, period_month, amount)
	  SELECT $1, t.kpi_indicator_id, t.department_id, t.assignee_employee_id, $2::int, $3::int, t.kpi_contribution
	    FROM hris.department_tasks t WHERE t.id = $4 AND t.kpi_indicator_id IS NOT NULL
	  ON CONFLICT (occurrence_id) DO UPDATE SET indicator_id = EXCLUDED.indicator_id, department_id = EXCLUDED.department_id,
	    employee_id = EXCLUDED.employee_id, period_year = EXCLUDED.period_year, period_month = EXCLUDED.period_month,
	    amount = EXCLUDED.amount, recorded_at = now()`, occ.ID, occ.Date[:4], occ.Date[5:7], occ.TaskID)
	return err
}

func (s *service) dropContribution(ctx context.Context, occurrenceID string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM hris.department_task_kpi_contributions WHERE occurrence_id = $1`, occurrenceID)
	return err
}

type progressData struct {
	Progress float64 `json:"progress"`
	Complete bool    `json:"complete"`
}

type subtaskResult struct {
	Message string       `json:"message"`
	Data    progressData `json:"data"`
}

func (s *service) checkSubtask(ctx context.Context, a *actor, occ occurrence, in occurrenceAction, myName string) (any, error) {
	subtaskID := ""
	if in.SubtaskID != nil {
		subtaskID = *in.SubtaskID
	}
	if !uuidRE.MatchString(subtaskID) {
		return nil, httpx.BadRequest("ID sub-task tidak valid")
	}
	var found string
	err := s.db.QueryRow(ctx, `SELECT id::text FROM hris.department_task_subtasks WHERE id = $1 AND task_id = $2`, subtaskID, occ.TaskID).Scan(&found)
	if database.IsNoRows(err) {
		return nil, httpx.BadRequest("Sub-task bukan milik task ini")
	}
	if err != nil {
		return nil, err
	}
	checked := in.Checked != nil && *in.Checked
	if _, err := s.db.Exec(ctx, `INSERT INTO hris.department_task_occurrence_items
		   (occurrence_id, subtask_id, is_checked, checked_at, checked_by_name, updated_at)
		VALUES ($1, $2, $3, CASE WHEN $3 THEN now() END, CASE WHEN $3 THEN $4 END, now())
		ON CONFLICT (occurrence_id, subtask_id) DO UPDATE SET
		  is_checked = EXCLUDED.is_checked, checked_at = EXCLUDED.checked_at,
		  checked_by_name = EXCLUDED.checked_by_name, updated_at = now()`, occ.ID, subtaskID, checked, myName); err != nil {
		return nil, err
	}
	var total, done string
	if err := s.db.QueryRow(ctx, `SELECT COALESCE(SUM(st.weight), 0)::text, COALESCE(SUM(st.weight) FILTER (WHERE oi.is_checked), 0)::text
		  FROM hris.department_task_subtasks st
		  LEFT JOIN hris.department_task_occurrence_items oi ON oi.subtask_id = st.id AND oi.occurrence_id = $1
		 WHERE st.task_id = $2`, occ.ID, occ.TaskID).Scan(&total, &done); err != nil {
		return nil, err
	}
	progress, sum := domain.JSNumber(done), domain.JSNumber(total)
	complete := sum > 0 && progress >= sum-0.01
	// All ticked: done (final for a personal task); some: in progress.
	status := "pending"
	switch {
	case complete && !occ.ReviewRequired:
		status = "approved"
	case complete:
		status = "done"
	case progress > 0:
		status = "in_progress"
	}
	if _, err := s.db.Exec(ctx, `UPDATE hris.department_task_occurrences
		SET status = $2::text,
		    started_at = CASE WHEN $5::float8 > 0 THEN COALESCE(started_at, now()) ELSE started_at END,
		    done_at = CASE WHEN $6::boolean THEN now() END,
		    done_by = CASE WHEN $6::boolean THEN $3::uuid END,
		    done_by_name = CASE WHEN $6::boolean THEN $4 END,
		    reviewed_by = CASE WHEN $2::text = 'approved' THEN $3::uuid END,
		    reviewed_by_name = CASE WHEN $2::text = 'approved' THEN $4 END,
		    reviewed_at = CASE WHEN $2::text = 'approved' THEN now() END,
		    updated_at = now()
		WHERE id = $1`, occ.ID, status, a.EmployeeID, myName, progress, complete); err != nil {
		return nil, err
	}
	if status == "approved" {
		if err := s.recordContribution(ctx, occ); err != nil {
			return nil, err
		}
	} else if err := s.dropContribution(ctx, occ.ID); err != nil {
		return nil, err
	}
	if err := logUpdate(ctx, s.db, occ.ID, a, myName, "progress", nil, ptrInt(int(domain.Round(progress))),
		map[string]any{"subtask_id": subtaskID, "checked": checked}); err != nil {
		return nil, err
	}
	msg := fmt.Sprintf("Progres %v%%", domain.Round(progress))
	if complete {
		msg = "Semua sub-task selesai (100%) — menunggu review Head Division"
	}
	return subtaskResult{msg, progressData{progress, complete}}, nil
}

var monthRE = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)

// GET /api/hris/dept-tasks?month=YYYY-MM[&department_id=]
func (h *handler) deptTaskBoard(w http.ResponseWriter, r *http.Request) error {
	a, err := h.requireActor(r)
	if err != nil {
		return err
	}
	me, err := h.svc.loadTaskActor(r.Context(), a)
	if err != nil {
		return err
	}
	month := r.URL.Query().Get("month")
	if !monthRE.MatchString(month) {
		return httpx.BadRequest("Parameter month wajib (YYYY-MM)")
	}
	var dept *string
	if r.URL.Query().Has("department_id") {
		d := r.URL.Query().Get("department_id")
		dept = &d
	}
	data, err := h.svc.deptTaskBoard(r.Context(), me, month, dept)
	if err != nil {
		return err
	}
	return writeJSON(w, dataBody{data})
}

// dayField is z.union([z.number(), z.string()]).nullable().optional().
func dayField(f *validate.Form, key string) any {
	v, ok := field(f, key)
	if !ok || v == nil {
		return nil
	}
	switch x := v.(type) {
	case json.Number:
		n, _ := x.Float64()
		return n
	case string:
		return x
	}
	f.Fail(key, "invalid_union", "Invalid input")
	return nil
}

// POST /api/hris/dept-tasks
func (h *handler) createDeptTask(w http.ResponseWriter, r *http.Request) error {
	a, err := h.requireActor(r)
	if err != nil {
		return err
	}
	me, err := h.svc.loadTaskActor(r.Context(), a)
	if err != nil {
		return err
	}
	f, err := readJSON(r, "")
	if err != nil {
		return err
	}
	var b domain.TaskBody
	dept := f.Str("department_id", nullish, validate.StrOpts{})
	assignee := f.Str("assignee_employee_id", nullish, validate.StrOpts{})
	b.Title = f.Str("title", optional, validate.StrOpts{Max: 255})
	b.Description = f.Str("description", nullish, validate.StrOpts{Max: 5000})
	b.Recurrence = f.Str("recurrence", optional, validate.StrOpts{Max: 20})
	b.WeeklyDay = dayField(f, "weekly_day")
	b.MonthlyDay = dayField(f, "monthly_day")
	b.DueDate = f.Str("due_date", nullish, validate.StrOpts{Max: 10})
	priority := f.Str("priority", nullish, validate.StrOpts{Max: 10})
	kpi := f.Str("kpi_indicator_id", nullish, validate.StrOpts{Check: validate.UUIDCheck})
	contribution := f.Num("kpi_contribution", nullish, validate.NumOpts{})
	f.List("subtasks", optional, math.MaxInt, func(sub *validate.Form, i int, v any) {
		item := sub.Item(i, v)
		b.Subtasks = append(b.Subtasks, item.Str("title", optional, validate.StrOpts{Max: 255}))
	})
	if err := issuesErr(f, ""); err != nil {
		return err
	}
	task, msg := domain.NormalizeDeptTask(b)
	if msg != "" {
		return httpx.BadRequest(msg)
	}
	x := taskExtras{Priority: strOr(priority), KpiIndicatorID: kpi, KpiContribution: contribution}
	if u, err := h.auth.CurrentUser(r); err == nil && u != nil {
		zone, err := localtime.BranchZone(r.Context(), h.svc.db, u.BranchID)
		if err != nil {
			return err
		}
		x.Timezone = localtime.Name(zone)
	}
	id, err := h.svc.createDeptTask(r.Context(), me, dept, assignee, task, x)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, struct {
		Message string `json:"message"`
		Data    any    `json:"data"`
	}{"Task dibuat", object("id", id)})
}

// PATCH /api/hris/dept-tasks/{id}: without a body (or with is_active
// false) the task is deactivated; with fields it is edited.
func (h *handler) deactivateDeptTask(w http.ResponseWriter, r *http.Request) error {
	a, err := h.requireActor(r)
	if err != nil {
		return err
	}
	id, err := requireUUID(r.PathValue("id"), "")
	if err != nil {
		return err
	}
	f := readOptionalJSON(r)
	var p taskPatch
	p.Title = f.Str("title", optional, validate.StrOpts{Max: 255})
	p.Description = f.Str("description", nullish, validate.StrOpts{Max: 5000})
	p.Priority = f.Str("priority", optional, validate.StrOpts{Max: 10})
	if _, sent := field(f, "assignee_employee_id"); sent {
		p.AssigneeSet = true
		p.Assignee = f.Str("assignee_employee_id", nullish, validate.StrOpts{Check: validate.UUIDCheck})
	}
	if _, sent := field(f, "kpi_indicator_id"); sent {
		p.KpiSet = true
		p.KpiIndicatorID = f.Str("kpi_indicator_id", nullish, validate.StrOpts{Check: validate.UUIDCheck})
	}
	if _, sent := field(f, "kpi_contribution"); sent {
		p.KpiContributionSet = true
		p.KpiContribution = f.Num("kpi_contribution", nullish, validate.NumOpts{})
	}
	active := f.Bool("is_active", nullish)
	if err := issuesErr(f, ""); err != nil {
		return err
	}
	if p.Title != nil || p.Description != nil || p.Priority != nil || p.AssigneeSet || p.KpiSet || p.KpiContributionSet {
		if err := h.svc.updateDeptTask(r.Context(), a, id, p); err != nil {
			return err
		}
		if active == nil || *active {
			return writeJSON(w, messageBody{"Task diperbarui"})
		}
	}
	if err := h.svc.deactivateDeptTask(r.Context(), a, id); err != nil {
		return err
	}
	return writeJSON(w, messageBody{"Task dinonaktifkan"})
}

// PATCH /api/hris/dept-tasks/occurrences/{id} { action, notes?, subtask_id?, checked? }
func (h *handler) occurrenceAction(w http.ResponseWriter, r *http.Request) error {
	a, err := h.requireActor(r)
	if err != nil {
		return err
	}
	id, err := requireUUID(r.PathValue("id"), "")
	if err != nil {
		return err
	}
	f, err := readJSON(r, "")
	if err != nil {
		return err
	}
	var in occurrenceAction
	before := len(f.Issues())
	action := f.Enum("action", validate.Rule{}, occurrenceActions)
	for i := before; i < len(f.Issues()); i++ {
		f.Issues()[i].Message = "Aksi tidak dikenal"
	}
	in.Notes = f.Str("notes", nullish, validate.StrOpts{Max: 2000})
	in.Note = f.Str("note", nullish, validate.StrOpts{Max: 2000})
	in.ProgressPercent = f.Int("progress_percent", nullish, validate.NumOpts{})
	in.SubtaskID = f.Str("subtask_id", optional, validate.StrOpts{})
	in.Checked = f.Bool("checked", optional)
	if err := issuesErr(f, ""); err != nil {
		return err
	}
	in.Action = *action
	out, err := h.svc.occurrenceAction(r.Context(), a, id, in)
	if err != nil {
		return err
	}
	return writeJSON(w, out)
}
