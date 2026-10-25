package payroll

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/httpx"
)

/* ── Meta: who the reader is and what they may pick ────────────────────── */

// TaskIndicator is a KPI indicator a task can link to, with the
// departments that weight it.
type TaskIndicator struct {
	ID            string   `json:"id"`
	Code          string   `json:"code"`
	Name          string   `json:"name"`
	Unit          *string  `json:"unit"`
	Direction     string   `json:"direction"`
	DepartmentIDs []string `json:"department_ids"`
}

// TaskMeta is what the task pages need up front.
type TaskMeta struct {
	Me struct {
		UserID          string  `json:"user_id"`
		Name            string  `json:"name"`
		EmployeeID      *string `json:"employee_id"`
		DepartmentID    *string `json:"department_id"`
		HasSubordinates bool    `json:"has_subordinates"`
		IsHR            bool    `json:"is_hr"`
		TeamAll         bool    `json:"team_all"`
		KpiAll          bool    `json:"kpi_all"`
		Timezone        string  `json:"timezone"`
	} `json:"me"`
	TeamScope   string          `json:"team_scope"`
	Departments []*obj          `json:"departments"`
	Members     []*obj          `json:"members"`
	Indicators  []TaskIndicator `json:"indicators"`
	Today       string          `json:"today"`
}

// taskMeta answers GET /api/hris/dept-tasks/meta: the departments in reach
// (all with tasks.team or HR, the own one otherwise), their active members
// and every active indicator.
func (s *service) taskMeta(ctx context.Context, v *viewActor) (*TaskMeta, error) {
	m := &TaskMeta{TeamScope: v.teamScope(), Today: v.today(), Departments: []*obj{}, Members: []*obj{}, Indicators: []TaskIndicator{}}
	m.Me.UserID, m.Me.Name, m.Me.EmployeeID, m.Me.DepartmentID = v.UserID, v.Name, v.EmployeeID, v.DepartmentID
	m.Me.HasSubordinates, m.Me.IsHR, m.Me.TeamAll, m.Me.KpiAll, m.Me.Timezone = v.HasSubordinates, v.IsHR, v.TeamAll, v.KpiAll, v.Zone.String()
	var depts []Department
	if v.TeamAll {
		all, err := s.ports.Departments.All(ctx, s.db)
		if err != nil {
			return nil, err
		}
		depts = all
	} else if v.DepartmentID != nil {
		found, err := s.ports.Departments.ByIDs(ctx, s.db, []string{*v.DepartmentID})
		if err != nil {
			return nil, err
		}
		if d, ok := found[*v.DepartmentID]; ok {
			depts = []Department{d}
		}
	}
	m.Departments = departmentRows(depts)
	for _, d := range depts {
		if !v.managesDept(d.ID) && (v.DepartmentID == nil || *v.DepartmentID != d.ID) {
			continue
		}
		members, err := s.ports.Employees.DepartmentMembers(ctx, s.db, d.ID)
		if err != nil {
			return nil, err
		}
		for _, mem := range members {
			m.Members = append(m.Members, object("id", mem.ID, "full_name", mem.FullName, "department_id", d.ID))
		}
	}
	rows, err := s.db.Query(ctx, `SELECT k.id::text, k.code, k.name, k.unit, k.direction,
		  COALESCE((SELECT array_agg(department_id::text ORDER BY department_id) FROM performance.kpi_department_indicators di WHERE di.indicator_id = k.id), '{}')
		  FROM performance.kpi_indicators k WHERE k.is_active ORDER BY k.name`)
	if err != nil {
		return nil, err
	}
	if m.Indicators, err = pgx.CollectRows(rows, pgx.RowToStructByPos[TaskIndicator]); err != nil {
		return nil, err
	}
	if m.Indicators == nil {
		m.Indicators = []TaskIndicator{}
	}
	return m, nil
}

/* ── KPI view ──────────────────────────────────────────────────────────── */

// IndicatorTasks is one indicator of a department with its occurrences of
// the month and their completion.
type IndicatorTasks struct {
	IndicatorID       string     `json:"indicator_id"`
	Code              string     `json:"code"`
	Name              string     `json:"name"`
	Unit              *string    `json:"unit"`
	Direction         string     `json:"direction"`
	Weight            *float64   `json:"weight"`
	Total             int        `json:"total"`
	Approved          int        `json:"approved"`
	WaitingReview     int        `json:"waiting_review"`
	Open              int        `json:"open"`
	Overdue           int        `json:"overdue"`
	Rate              *float64   `json:"rate"`
	ExpectedTotal     float64    `json:"expected_total"`
	ContributionTotal float64    `json:"contribution_total"`
	Tasks             []TaskItem `json:"tasks"`
}

// KpiTasksView is the per indicator picture of one department for a month.
type KpiTasksView struct {
	DepartmentID string           `json:"department_id"`
	Month        string           `json:"month"`
	Indicators   []IndicatorTasks `json:"indicators"`
}

// kpiTasks answers GET /api/hris/dept-tasks/kpi: for each indicator the
// department weights (and any other its tasks link to), the occurrences
// due in the month and how many were approved. Rate is approved over the
// rows due up to today.
func (s *service) kpiTasks(ctx context.Context, v *viewActor, departmentID *string, month string) (*KpiTasksView, error) {
	if month == "" {
		month = v.today()[:7]
	}
	span, ok := domain.MonthSpan(month)
	if !ok {
		return nil, httpx.BadRequest("Bulan tidak valid, pakai format YYYY-MM")
	}
	if departmentID == nil {
		departmentID = v.DepartmentID
	}
	if departmentID == nil {
		return nil, httpx.BadRequest("Pilih departemen")
	}
	if !v.KpiAll && (v.DepartmentID == nil || *v.DepartmentID != *departmentID) {
		return nil, httpx.Forbidden("Anda tidak punya akses ke KPI departemen ini")
	}
	if err := s.ensureOccurrences(ctx, *departmentID, span.Start, span.End); err != nil {
		return nil, err
	}
	items, err := s.queryItems(ctx, v, `WHERE t.department_id = $1 AND t.kpi_indicator_id IS NOT NULL AND t.is_active
		AND o.occurrence_date BETWEEN $2::date AND $3::date ORDER BY o.occurrence_date, t.created_at`, *departmentID, span.Start, span.End)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT k.id::text, k.code, k.name, k.unit, k.direction, di.weight::float8
		  FROM performance.kpi_indicators k
		  LEFT JOIN performance.kpi_department_indicators di ON di.indicator_id = k.id AND di.department_id = $1
		 WHERE k.is_active AND (di.id IS NOT NULL OR k.id IN (
		       SELECT kpi_indicator_id FROM hris.department_tasks WHERE department_id = $1 AND is_active AND kpi_indicator_id IS NOT NULL))
		 ORDER BY di.weight DESC NULLS LAST, k.name`, *departmentID)
	if err != nil {
		return nil, err
	}
	view := &KpiTasksView{DepartmentID: *departmentID, Month: month, Indicators: []IndicatorTasks{}}
	index := map[string]int{}
	for rows.Next() {
		var it IndicatorTasks
		if err := rows.Scan(&it.IndicatorID, &it.Code, &it.Name, &it.Unit, &it.Direction, &it.Weight); err != nil {
			return nil, err
		}
		it.Tasks = []TaskItem{}
		index[it.IndicatorID] = len(view.Indicators)
		view.Indicators = append(view.Indicators, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	today := v.today()
	due := map[string]int{}
	for _, t := range items {
		i, ok := index[*t.KpiIndicatorID]
		if !ok {
			continue
		}
		it := &view.Indicators[i]
		it.Tasks = append(it.Tasks, t)
		it.Total++
		if t.Date <= today {
			due[it.IndicatorID]++
		}
		switch t.Status {
		case domain.StatusApproved:
			it.Approved++
		case domain.StatusDone:
			it.WaitingReview++
		default:
			it.Open++
			if t.Overdue {
				it.Overdue++
			}
		}
		if t.KpiContribution != nil {
			it.ExpectedTotal += *t.KpiContribution
		}
	}
	for i := range view.Indicators {
		it := &view.Indicators[i]
		if n := due[it.IndicatorID]; n > 0 {
			rate := float64(it.Approved) / float64(n)
			it.Rate = &rate
		}
	}
	rows, err = s.db.Query(ctx, `SELECT c.indicator_id::text, COALESCE(sum(c.amount), 0)::float8
		  FROM hris.department_task_kpi_contributions c
		  JOIN hris.department_task_occurrences o ON o.id = c.occurrence_id
		  JOIN hris.department_tasks t ON t.id = o.task_id
		 WHERE t.department_id = $1 AND o.occurrence_date BETWEEN $2::date AND $3::date GROUP BY 1`, *departmentID, span.Start, span.End)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var sum float64
		if err := rows.Scan(&id, &sum); err != nil {
			return nil, err
		}
		if i, ok := index[id]; ok {
			view.Indicators[i].ContributionTotal = sum
		}
	}
	return view, rows.Err()
}

/* ── Contributions beside a scorecard ──────────────────────────────────── */

// ContributionSummary is what the scorecard shows beside an indicator:
// the employee's linked occurrences in the period and what they added.
type ContributionSummary struct {
	IndicatorID       string  `json:"indicator_id"`
	Code              string  `json:"code"`
	TasksTotal        int     `json:"tasks_total"`
	TasksDone         int     `json:"tasks_done"`
	ContributionTotal float64 `json:"contribution_total"`
}

// contributions answers GET /api/hris/dept-tasks/kpi/contributions.
// KPI readers see anyone; heads their department; others themselves.
func (s *service) contributions(ctx context.Context, v *viewActor, employeeID, month string) ([]ContributionSummary, error) {
	span, ok := domain.MonthSpan(month)
	if !ok {
		return nil, httpx.BadRequest("Bulan tidak valid, pakai format YYYY-MM")
	}
	b, err := s.brief(ctx, employeeID)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, httpx.NotFound("Karyawan tidak ditemukan")
	}
	self := v.EmployeeID != nil && *v.EmployeeID == employeeID
	if !v.KpiAll && !self && (b.DepartmentID == nil || !v.managesDept(*b.DepartmentID)) {
		return nil, httpx.Forbidden("Anda tidak punya akses ke kontribusi karyawan ini")
	}
	rows, err := s.db.Query(ctx, `SELECT k.id::text, k.code, count(o.id)::int, count(o.id) FILTER (WHERE o.status = 'approved')::int,
	       COALESCE(sum(c.amount), 0)::float8
	  FROM hris.department_task_occurrences o
	  JOIN hris.department_tasks t ON t.id = o.task_id
	  JOIN performance.kpi_indicators k ON k.id = t.kpi_indicator_id
	  LEFT JOIN hris.department_task_kpi_contributions c ON c.occurrence_id = o.id
	 WHERE t.assignee_employee_id = $1 AND o.occurrence_date BETWEEN $2::date AND $3::date
	 GROUP BY k.id, k.code ORDER BY k.code`, employeeID, span.Start, span.End)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[ContributionSummary])
	if out == nil {
		out = []ContributionSummary{}
	}
	return out, err
}

/* ── Monitor (EPIC-068) ────────────────────────────────────────────────── */

// MonitorData is GET /api/hris/dept-tasks/monitor: per department and per
// assignee, the overdue rows with their last note and the rows waiting
// for review.
type MonitorData struct {
	Start         string                     `json:"start"`
	End           string                     `json:"end"`
	Today         string                     `json:"today"`
	Summary       domain.MonitorSummary      `json:"summary"`
	Departments   []domain.DepartmentSummary `json:"departments"`
	Overdue       []domain.MonitorRow        `json:"overdue"`
	WaitingReview []domain.MonitorRow        `json:"waiting_review"`
	IsHR          bool                       `json:"is_hr"`
	Scope         string                     `json:"scope"`
}

func (s *service) monitor(ctx context.Context, v *viewActor, requested *string, month string) (*MonitorData, error) {
	span, ok := domain.MonthSpan(month)
	if !ok {
		return nil, httpx.BadRequest("Parameter month wajib (YYYY-MM)")
	}
	var depts []string
	scope := "own"
	switch {
	case v.TeamAll:
		scope = "all"
		if requested != nil {
			depts = []string{*requested}
		} else {
			all, err := s.ports.Departments.All(ctx, s.db)
			if err != nil {
				return nil, err
			}
			for _, d := range all {
				depts = append(depts, d.ID)
			}
		}
	case v.DepartmentID != nil:
		depts = []string{*v.DepartmentID}
	}
	for _, d := range depts {
		if err := s.ensureOccurrences(ctx, d, span.Start, span.End); err != nil {
			return nil, err
		}
	}
	items, err := s.queryItems(ctx, v, `WHERE t.department_id::text = ANY($1) AND t.is_active
		AND o.occurrence_date BETWEEN $2::date AND $3::date ORDER BY o.occurrence_date`, depts, span.Start, span.End)
	if err != nil {
		return nil, err
	}
	rows := make([]domain.MonitorRow, len(items))
	for i, it := range items {
		rows[i] = domain.MonitorRow{OccurrenceID: it.OccurrenceID, TaskID: it.TaskID, Title: it.Title, DepartmentID: it.DepartmentID,
			DepartmentName: it.DepartmentName, AssigneeID: it.AssigneeID, AssigneeName: it.AssigneeName, Date: it.Date,
			Status: it.Status, Progress: it.Progress, LastNote: it.LastNote}
		if it.LastNoteAt != nil {
			at := it.LastNoteAt.Format(time.RFC3339)
			rows[i].LastNoteAt = &at
		}
	}
	today := v.today()
	return &MonitorData{Start: span.Start, End: span.End, Today: today, Summary: domain.Summarize(rows, today),
		Departments: domain.GroupByDepartment(rows, today), Overdue: domain.OverdueList(rows, today, 50),
		WaitingReview: domain.WaitingReview(rows, 50), IsHR: v.IsHR, Scope: scope}, nil
}
