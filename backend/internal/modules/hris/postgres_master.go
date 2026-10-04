package hris

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/hris/domain"
	"nuhabit/backend/internal/platform/database"
)

func (s *store) MasterList(ctx context.Context, table, columns string) ([]*Row, error) {
	return queryRows(ctx, s.db, `SELECT `+columns+` FROM `+table+` ORDER BY name`)
}

func (s *store) EmployeesUsing(ctx context.Context, column, value string) (int64, error) {
	return countRows(ctx, s.db, `SELECT count(*) FROM hris.employees WHERE `+column+` = $1`, value)
}

func (s *store) DeleteMaster(ctx context.Context, table, id string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM `+table+` WHERE id = $1`, id)
	return err
}

func (s *store) SaveDepartment(ctx context.Context, id *string, d masterInput) (*Row, error) {
	if id == nil {
		return queryRow(ctx, s.db, `INSERT INTO hris.departments (name, code, description, is_active)
			VALUES ($1, $2, $3, COALESCE($4, true)) RETURNING `+departmentFields, d.Name, d.Code, d.Description, d.IsActive)
	}
	return queryRow(ctx, s.db, `UPDATE hris.departments
		SET name = $2, code = $3, description = $4, is_active = COALESCE($5, is_active), updated_at = now()
		WHERE id = $1 RETURNING `+departmentFields, *id, d.Name, d.Code, d.Description, d.IsActive)
}

func (s *store) SaveEmploymentStatus(ctx context.Context, id *string, d masterInput) (*Row, error) {
	if id == nil {
		return queryRow(ctx, s.db, `INSERT INTO hris.employment_statuses (code, name, color, description, is_active)
			VALUES ($1, $2, COALESCE($3, 'gray'), $4, COALESCE($5, true)) RETURNING `+statusFields,
			d.Code, d.Name, d.Color, d.Description, d.IsActive)
	}
	return queryRow(ctx, s.db, `UPDATE hris.employment_statuses
		SET code = $2, name = $3, color = COALESCE($4, 'gray'), description = $5,
		    is_active = COALESCE($6, is_active), updated_at = now()
		WHERE id = $1 RETURNING `+statusFields, *id, d.Code, d.Name, d.Color, d.Description, d.IsActive)
}

func (s *store) EmploymentStatusCode(ctx context.Context, id string) (*string, error) {
	var code string
	err := s.db.QueryRow(ctx, `SELECT code FROM hris.employment_statuses WHERE id = $1`, id).Scan(&code)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &code, err
}

// SavePosition inserts or updates a position and returns its id (nil when
// the update matched nothing).
func (s *store) SavePosition(ctx context.Context, id *string, p masterInput) (*string, error) {
	var saved string
	var err error
	if id == nil {
		err = s.db.QueryRow(ctx, `INSERT INTO hris.positions (title, department, level, is_active, brand_id)
			VALUES ($1, COALESCE($2, 'Operations'), COALESCE($3, 'Staff'), COALESCE($4, true), $5) RETURNING id::text`,
			p.Title, p.Department, p.Level, p.IsActive, p.BrandID).Scan(&saved)
	} else {
		err = s.db.QueryRow(ctx, `UPDATE hris.positions
			SET title = $2, department = COALESCE($3, 'Operations'), level = COALESCE($4, 'Staff'),
			    is_active = COALESCE($5, is_active), brand_id = $6
			WHERE id = $1 RETURNING id::text`, *id, p.Title, p.Department, p.Level, p.IsActive, p.BrandID).Scan(&saved)
	}
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &saved, err
}

// Positions lists hris.positions (one when id is set); the brand name is
// added by the service through the Directory port.
func (s *store) Positions(ctx context.Context, id *string) ([]*Row, error) {
	if id != nil {
		return queryRows(ctx, s.db, `SELECT p.* FROM hris.positions p WHERE p.id = $1`, *id)
	}
	return queryRows(ctx, s.db, `SELECT p.* FROM hris.positions p ORDER BY p.title`)
}

func (s *store) ReportRows(ctx context.Context, start, end string) ([]domain.ReportEmployee, []domain.ReportDepartment, []domain.ReportAttendance, []domain.ReportLeave, error) {
	empRows, err := s.db.Query(ctx, `SELECT employment_status, is_active, department_id::text, join_date::text, end_date::text
		FROM hris.employees ORDER BY full_name`)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	emps, err := pgx.CollectRows(empRows, func(r pgx.CollectableRow) (domain.ReportEmployee, error) {
		var e domain.ReportEmployee
		err := r.Scan(&e.EmploymentStatus, &e.IsActive, &e.DepartmentID, &e.JoinDate, &e.EndDate)
		return e, err
	})
	if err != nil {
		return nil, nil, nil, nil, err
	}
	deptRows, err := s.db.Query(ctx, `SELECT id::text, name FROM hris.departments WHERE is_active = true ORDER BY name`)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	depts, err := pgx.CollectRows(deptRows, pgx.RowToStructByPos[domain.ReportDepartment])
	if err != nil {
		return nil, nil, nil, nil, err
	}
	attRows, err := s.db.Query(ctx, `SELECT status::text, COALESCE(is_late, false), COALESCE(work_hours, 0)::float8, date::text
		FROM hris.attendance WHERE date >= $1 AND date < $2`, start, end)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	att, err := pgx.CollectRows(attRows, pgx.RowToStructByPos[domain.ReportAttendance])
	if err != nil {
		return nil, nil, nil, nil, err
	}
	leaveRows, err := s.db.Query(ctx, `SELECT leave_type::text, status::text, COALESCE(total_days, 0)::float8
		FROM hris.leaves WHERE start_date >= $1 AND start_date < $2`, start, end)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	leaves, err := pgx.CollectRows(leaveRows, pgx.RowToStructByPos[domain.ReportLeave])
	return emps, depts, att, leaves, err
}

/* ── Checklists ──────────────────────────────────────────────────────── */

const person = "id, full_name, nip"

func (s *store) OnboardingTasks(ctx context.Context, employeeID string, category *string, completed *bool) ([]*Row, error) {
	args := []any{employeeID}
	where := "employee_id = $1"
	if category != nil {
		args = append(args, *category)
		where += fmt.Sprintf(" AND category = $%d", len(args))
	}
	if completed != nil {
		args = append(args, *completed)
		where += fmt.Sprintf(" AND completed = $%d", len(args))
	}
	return queryRows(ctx, s.db, `SELECT *, `+
		embedOne("employee", person+", photo_url, "+deptName+", "+
			embedOne("job_title", "title", "hris.positions", "id = employees.job_title_id")+", join_date",
			"hris.employees", "id = onboarding_checklists.employee_id")+", "+
		embedOne("completer", person, "hris.employees", "id = onboarding_checklists.completed_by")+", "+
		embedOne("assignee", person, "hris.employees", "id = onboarding_checklists.assigned_to")+
		` FROM hris.onboarding_checklists WHERE `+where+` ORDER BY priority ASC, due_date ASC`, args...)
}

func (s *store) OnboardingTaskAssignee(ctx context.Context, taskID, employeeID string) (*Row, error) {
	row, err := queryRow(ctx, s.db, `SELECT assigned_to FROM hris.onboarding_checklists WHERE id = $1 AND employee_id = $2`,
		taskID, employeeID)
	return row, ignoreBadInput(err)
}

func (s *store) UpdateOnboardingTask(ctx context.Context, taskID, employeeID string, f fields) (*Row, error) {
	return updateOne(ctx, s.db, "hris.onboarding_checklists", f, fields{{"id", taskID}, {"employee_id", employeeID}}, "*")
}

func (s *store) InsertOnboardingTask(ctx context.Context, f fields) (*Row, error) {
	return insertRow(ctx, s.db, "hris.onboarding_checklists", f, "*")
}

func (s *store) OffboardingChecklists(ctx context.Context, employeeID string) ([]*Row, error) {
	return queryRows(ctx, s.db, `SELECT *, `+
		embedOne("employee", person+", photo_url, "+deptName+", "+
			embedOne("job_title", "title", "hris.positions", "id = employees.job_title_id"),
			"hris.employees", "id = offboarding_checklists.employee_id")+", "+
		embedOne("interviewer", person, "hris.employees", "id = offboarding_checklists.exit_interview_conducted_by")+", "+
		embedOne("completer", person, "hris.employees", "id = offboarding_checklists.completed_by")+
		` FROM hris.offboarding_checklists WHERE employee_id = $1`, employeeID)
}

func (s *store) OffboardingEmployee(ctx context.Context, employeeID string) (*Row, error) {
	row, err := queryRow(ctx, s.db, `SELECT id, full_name, employment_status, is_active FROM hris.employees WHERE id = $1`, employeeID)
	return row, ignoreBadInput(err)
}

func (s *store) SubmittedOffboarding(ctx context.Context, employeeID string) (*string, error) {
	var id string
	err := s.db.QueryRow(ctx, `SELECT id::text FROM hris.offboarding_checklists
		WHERE employee_id = $1 AND status = 'submitted' LIMIT 1`, employeeID).Scan(&id)
	if database.IsNoRows(err) || database.PgCode(err) == "22P02" {
		return nil, nil
	}
	return &id, err
}

func (s *store) InsertOffboarding(ctx context.Context, f fields) (*Row, error) {
	return insertRow(ctx, s.db, "hris.offboarding_checklists", f, "*")
}

func (s *store) LatestOffboardingFull(ctx context.Context, employeeID string) (*Row, error) {
	row, err := queryRow(ctx, s.db, `SELECT * FROM hris.offboarding_checklists WHERE employee_id = $1
		ORDER BY created_at DESC LIMIT 1`, employeeID)
	return row, ignoreBadInput(err)
}

func (s *store) UpdateOffboarding(ctx context.Context, id string, f fields) (*Row, error) {
	return updateOne(ctx, s.db, "hris.offboarding_checklists", f, fields{{"id", id}}, "*")
}
