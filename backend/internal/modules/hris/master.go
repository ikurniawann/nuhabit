package hris

import (
	"context"
	"fmt"

	"nuhabit/backend/internal/modules/hris/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// HR master data (lib/hris/master-data), the monthly HRIS report
// (lib/hris/reports-summary) and the onboarding/offboarding checklists
// (lib/hris/onboarding-repo, offboarding-repo).

// MasterRepo is the master data, report and checklist storage.
type MasterRepo interface {
	MasterList(ctx context.Context, table, columns string) ([]*Row, error)
	EmployeesUsing(ctx context.Context, column, value string) (int64, error)
	DeleteMaster(ctx context.Context, table, id string) error
	SaveDepartment(ctx context.Context, id *string, d masterInput) (*Row, error)
	SaveEmploymentStatus(ctx context.Context, id *string, d masterInput) (*Row, error)
	EmploymentStatusCode(ctx context.Context, id string) (*string, error)
	SavePosition(ctx context.Context, id *string, p masterInput) (*string, error)
	Positions(ctx context.Context, id *string) ([]*Row, error)
	ReportRows(ctx context.Context, start, end string) ([]domain.ReportEmployee, []domain.ReportDepartment, []domain.ReportAttendance, []domain.ReportLeave, error)
}

// ChecklistRepo is the onboarding/offboarding storage.
type ChecklistRepo interface {
	OnboardingTasks(ctx context.Context, employeeID string, category *string, completed *bool) ([]*Row, error)
	OnboardingTaskAssignee(ctx context.Context, taskID, employeeID string) (*Row, error)
	UpdateOnboardingTask(ctx context.Context, taskID, employeeID string, f fields) (*Row, error)
	InsertOnboardingTask(ctx context.Context, f fields) (*Row, error)
	OffboardingChecklists(ctx context.Context, employeeID string) ([]*Row, error)
	OffboardingEmployee(ctx context.Context, employeeID string) (*Row, error)
	SubmittedOffboarding(ctx context.Context, employeeID string) (*string, error)
	InsertOffboarding(ctx context.Context, f fields) (*Row, error)
	LatestOffboardingFull(ctx context.Context, employeeID string) (*Row, error)
	UpdateOffboarding(ctx context.Context, id string, f fields) (*Row, error)
}

// masterInput is departmentSchema / employmentStatusSchema / positionSchema
// after their transforms.
type masterInput struct {
	Name, Code, Title                              string
	Description, Color, Department, Level, BrandID *string
	IsActive                                       *bool
}

const (
	departmentFields = "id, name, code, description, is_active, created_at, updated_at"
	statusFields     = "id, code, name, color, description, is_active, created_at, updated_at"
)

// uniqueAs400 is withUniqueMessage: a duplicate code is a 400 with message.
func uniqueAs400(row *Row, err error, message string) (*Row, error) {
	if database.IsUniqueViolation(err) {
		return nil, httpx.BadRequest(message)
	}
	return row, err
}

// assertUnused refuses to delete master data employees still use.
func (s *Service) assertUnused(ctx context.Context, column, value, what string) error {
	n, err := s.repo.EmployeesUsing(ctx, column, value)
	if err != nil {
		return err
	}
	if n > 0 {
		return httpx.BadRequest(fmt.Sprintf("Tidak dapat dihapus, masih ada %d karyawan %s", n, what))
	}
	return nil
}

func found(row *Row, err error, message string) (*Row, error) {
	if err == nil && row == nil {
		return nil, httpx.NotFound(message)
	}
	return row, err
}

func (s *Service) MasterDepartments(ctx context.Context) ([]*Row, error) {
	return s.repo.MasterList(ctx, "hris.departments", departmentFields)
}

func (s *Service) SaveDepartment(ctx context.Context, id *string, d masterInput) (*Row, error) {
	row, err := s.repo.SaveDepartment(ctx, id, d)
	row, err = uniqueAs400(row, err, "Kode departemen sudah digunakan")
	if id != nil {
		return found(row, err, "Departemen tidak ditemukan")
	}
	return row, err
}

func (s *Service) DeleteDepartment(ctx context.Context, id string) error {
	if err := s.assertUnused(ctx, "department_id", id, "di departemen ini"); err != nil {
		return err
	}
	return s.repo.DeleteMaster(ctx, "hris.departments", id)
}

func (s *Service) EmploymentStatuses(ctx context.Context) ([]*Row, error) {
	return s.repo.MasterList(ctx, "hris.employment_statuses", statusFields)
}

func (s *Service) SaveEmploymentStatus(ctx context.Context, id *string, d masterInput) (*Row, error) {
	row, err := s.repo.SaveEmploymentStatus(ctx, id, d)
	row, err = uniqueAs400(row, err, "Kode status sudah digunakan")
	if id != nil {
		return found(row, err, "Status kepegawaian tidak ditemukan")
	}
	return row, err
}

func (s *Service) DeleteEmploymentStatus(ctx context.Context, id string) error {
	code, err := s.repo.EmploymentStatusCode(ctx, id)
	if err != nil {
		return err
	}
	if code != nil {
		if err := s.assertUnused(ctx, "employment_status", *code, "dengan status ini"); err != nil {
			return err
		}
	}
	return s.repo.DeleteMaster(ctx, "hris.employment_statuses", id)
}

// Positions lists jabatan with their brand name ({name} or null).
func (s *Service) Positions(ctx context.Context, id *string) ([]*Row, error) {
	rows, err := s.repo.Positions(ctx, id)
	if err != nil || len(rows) == 0 {
		return rows, err
	}
	var brandIDs []string
	for _, r := range rows {
		if b := r.StrPtr("brand_id"); b != nil {
			brandIDs = append(brandIDs, *b)
		}
	}
	names := map[string]string{}
	if len(brandIDs) > 0 {
		if names, err = s.directory.BrandNames(ctx, s.repo.querier(), brandIDs); err != nil {
			return nil, err
		}
	}
	for _, r := range rows {
		var brand any
		if b := r.StrPtr("brand_id"); b != nil {
			if name, ok := names[*b]; ok {
				brand = obj("name", name)
			}
		}
		r.Set("brands", brand)
	}
	return rows, nil
}

func (s *Service) SavePosition(ctx context.Context, id *string, p masterInput) (*Row, error) {
	saved, err := s.repo.SavePosition(ctx, id, p)
	if err != nil {
		return nil, err
	}
	if saved == nil {
		if id != nil {
			return nil, httpx.NotFound("Jabatan tidak ditemukan")
		}
		return nil, nil
	}
	rows, err := s.Positions(ctx, saved)
	if err != nil || len(rows) == 0 {
		return nil, errOr(err, httpx.NotFound("Jabatan tidak ditemukan"))
	}
	return rows[0], nil
}

func (s *Service) DeletePosition(ctx context.Context, id string) error {
	if err := s.assertUnused(ctx, "job_title_id", id, "dengan jabatan ini"); err != nil {
		return err
	}
	return s.repo.DeleteMaster(ctx, "hris.positions", id)
}

// Report is loadHrisReport. The TS sums numeric columns as strings
// (string concatenation, so work hours and leave days come out wrong);
// here they are added as numbers, as reports-summary.test expects.
func (s *Service) Report(ctx context.Context, month, year int) (domain.HrisReport, error) {
	start, end := domain.MonthRange(month, year)
	emps, depts, att, leaves, err := s.repo.ReportRows(ctx, start, end)
	if err != nil {
		return domain.HrisReport{}, err
	}
	return domain.BuildHrisReport(emps, depts, att, leaves, month, year), nil
}

/* ── Checklists ──────────────────────────────────────────────────────── */

// OnboardingList is listOnboarding: tasks and the progress summary.
func (s *Service) OnboardingList(ctx context.Context, employeeID string, category *string, completed *bool) (*Row, error) {
	tasks, err := s.repo.OnboardingTasks(ctx, employeeID, category, completed)
	if err != nil {
		return nil, asPlainError(err)
	}
	done := 0
	for _, t := range tasks {
		if t.Bool("completed") {
			done++
		}
	}
	progress := 0.0
	if len(tasks) > 0 {
		progress = domain.JSRound(float64(done) / float64(len(tasks)) * 100)
	}
	return obj("data", tasks, "summary", obj("total", len(tasks), "completed", done,
		"pending", len(tasks)-done, "progress", progress)), nil
}

type onboardingTask struct {
	TaskName, Category, Description, DueDate, AssignedTo opt[string]
	Priority                                             opt[int]
}

// ActOnOnboarding: action=complete (managers or the assignee), action=add
// (managers). completed_by and assigned_to reference hris.employees.
func (s *Service) ActOnOnboarding(ctx context.Context, a *Actor, employeeID, action, taskID string, notes *string, t onboardingTask) (*Row, error) {
	isManager := isLineManagerRole(a.Role)
	isOwner := a.EmployeeID != nil && employeeID == *a.EmployeeID
	if !isManager && !isOwner {
		return nil, httpx.Forbidden("Forbidden")
	}
	if action == "complete" && taskID != "" {
		if !isManager {
			task, err := s.repo.OnboardingTaskAssignee(ctx, taskID, employeeID)
			if err != nil {
				return nil, err
			}
			if task == nil || a.EmployeeID == nil || task.Str("assigned_to") != *a.EmployeeID {
				return nil, httpx.Forbidden("Forbidden: Not authorized to complete this task")
			}
		}
		row, err := s.repo.UpdateOnboardingTask(ctx, taskID, employeeID, fields{
			{"completed", true}, {"completed_at", s.clock()}, {"completed_by", a.EmployeeID},
			{"completion_notes", nilIfEmpty(notes)}})
		if err != nil {
			return nil, err
		}
		return obj("message", "Task completed successfully", "data", row), nil
	}
	if action == "add" && isManager {
		if t.TaskName.Val == nil || *t.TaskName.Val == "" || t.Category.Val == nil {
			return nil, httpx.BadRequest("task_name dan category wajib diisi")
		}
		priority := 3
		if t.Priority.Val != nil && *t.Priority.Val != 0 {
			priority = *t.Priority.Val
		}
		assigned := a.EmployeeID
		if v := t.AssignedTo.Val; v != nil && *v != "" {
			assigned = v
		}
		row, err := s.repo.InsertOnboardingTask(ctx, fields{
			{"employee_id", employeeID}, {"task_name", *t.TaskName.Val}, {"category", *t.Category.Val},
			{"description", t.Description.Val}, {"priority", priority}, {"due_date", t.DueDate.Val}, {"assigned_to", assigned}})
		if err != nil {
			return nil, err
		}
		return obj("message", "Task added successfully", "data", row), nil
	}
	return nil, httpx.BadRequest(`Invalid action. Use "complete" with task_id or "add" with task details`)
}

// UpdateOnboardingTask lets HRD/managers edit one of the employee's tasks.
func (s *Service) UpdateOnboardingTask(ctx context.Context, a *Actor, employeeID, taskID string, t onboardingTask) (*Row, error) {
	if !isLineManagerRole(a.Role) {
		return nil, httpx.Forbidden("Forbidden: Only HRD or managers can update tasks")
	}
	var f fields
	add := func(col string, v opt[string]) {
		if v.Sent {
			f.add(col, v.Val)
		}
	}
	add("task_name", t.TaskName)
	add("category", t.Category)
	add("description", t.Description)
	if t.Priority.Sent {
		f.add("priority", t.Priority.Val)
	}
	add("due_date", t.DueDate)
	add("assigned_to", t.AssignedTo)
	row, err := s.repo.UpdateOnboardingTask(ctx, taskID, employeeID, f)
	if err != nil {
		return nil, err
	}
	return obj("message", "Task updated successfully", "data", row), nil
}

func (s *Service) Offboarding(ctx context.Context, employeeID string) ([]*Row, error) {
	rows, err := s.repo.OffboardingChecklists(ctx, employeeID)
	return rows, asPlainError(err)
}

type resignation struct {
	Type, ResignationDate, LastWorkingDay string
	Reason                                *string
}

// InitiateOffboarding: the employee may resign voluntarily; anything else is
// for HRD/managers. One submitted checklist per employee.
func (s *Service) InitiateOffboarding(ctx context.Context, a *Actor, employeeID string, in resignation) (*Row, error) {
	isOwner := a.EmployeeID != nil && employeeID == *a.EmployeeID
	if isOwner && in.Type != "voluntary" {
		return nil, httpx.Forbidden("Only HRD/Manager can initiate non-voluntary resignation")
	}
	if !isLineManagerRole(a.Role) && !isOwner {
		return nil, httpx.Forbidden("Forbidden")
	}
	emp, err := s.repo.OffboardingEmployee(ctx, employeeID)
	if err != nil {
		return nil, err
	}
	if emp == nil || !emp.Bool("is_active") {
		return nil, httpx.NotFound("Employee not found or inactive")
	}
	existing, err := s.repo.SubmittedOffboarding(ctx, employeeID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, httpx.BadRequest("Offboarding already initiated for this employee", obj("offboarding_id", *existing))
	}
	return s.repo.InsertOffboarding(ctx, fields{
		{"employee_id", employeeID}, {"resignation_type", in.Type}, {"resignation_date", in.ResignationDate},
		{"last_working_day", in.LastWorkingDay}, {"reason", nilIfEmpty(in.Reason)}, {"status", "submitted"},
		{"asset_return_status", map[string]any{}}})
}

type offboardingUpdate struct {
	ClearanceType *string
	Cleared       opt[bool]
	Notes         opt[string]
	AssetUpdates  *Row
	Status        *string
	Passthrough   fields
}

// UpdateOffboarding updates clearance, assets, status, exit interview or
// final pay on the employee's latest checklist (HRD/managers).
func (s *Service) UpdateOffboarding(ctx context.Context, a *Actor, employeeID string, in offboardingUpdate) (*Row, error) {
	if !isLineManagerRole(a.Role) {
		return nil, httpx.Forbidden("Forbidden: Only HRD or managers can update offboarding")
	}
	current, err := s.repo.LatestOffboardingFull(ctx, employeeID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, httpx.NotFound("Offboarding not found for this employee")
	}
	var f fields
	if in.ClearanceType != nil {
		if in.Cleared.Sent {
			f.add("clearance_"+*in.ClearanceType, in.Cleared.Val)
		}
		if in.Notes.Sent {
			f.add("clearance_"+*in.ClearanceType+"_notes", in.Notes.Val)
		}
	}
	if in.AssetUpdates != nil {
		merged := newRow()
		if prev := current.Child("asset_return_status"); prev != nil {
			for _, k := range prev.keys {
				merged.Set(k, prev.Get(k))
			}
		}
		for _, k := range in.AssetUpdates.keys {
			merged.Set(k, in.AssetUpdates.Get(k))
		}
		raw, err := marshal(merged)
		if err != nil {
			return nil, err
		}
		f.add("asset_return_status", string(raw))
	}
	if in.Status != nil {
		f.add("status", *in.Status)
		if *in.Status == "completed" {
			f.add("completed_at", s.clock())
			f.add("completed_by", a.EmployeeID)
		}
	}
	f = append(f, in.Passthrough...)
	return s.repo.UpdateOffboarding(ctx, current.Str("id"), f)
}
