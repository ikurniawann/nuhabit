package hris

import (
	"math"
	"net/http"

	"nuhabit/backend/internal/modules/hris/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

func pagination(page, limit int, total int64) *Row {
	return obj("page", page, "limit", limit, "total", total,
		"totalPages", int64(math.Ceil(float64(total)/float64(limit))))
}

func (h handlers) listAttendance(w http.ResponseWriter, r *http.Request, a *Actor) error {
	p, err := resolveAttendanceListParams(queryOf(r), a)
	if err != nil {
		return err
	}
	if p == nil {
		return ok(w, obj("data", []any{}, "pagination", obj("page", 1, "limit", 0, "total", 0, "totalPages", 0)))
	}
	rows, total, err := h.svc.ListAttendance(r.Context(), *p)
	if err != nil {
		return err
	}
	return ok(w, obj("data", rows, "pagination", pagination(p.Page, p.Limit, total)))
}

func (h handlers) getAttendance(w http.ResponseWriter, r *http.Request, a *Actor) error {
	row, err := h.svc.Attendance(r.Context(), r.PathValue("id"), a)
	if err != nil {
		return err
	}
	return ok(w, dataOf(row))
}

func (h handlers) updateAttendance(w http.ResponseWriter, r *http.Request, a *Actor) error {
	if !a.IsHR {
		return httpx.Forbidden("Forbidden: Only HRD or managers can update attendance")
	}
	const message = "Validation failed"
	f, err := readForm(r, message)
	if err != nil {
		return err
	}
	var c fields
	for _, field := range []struct {
		key  string
		rule validate.Rule
		max  int
	}{{"status", optional, 30}, {"notes", nullish, 5000}, {"validation_notes", nullish, 5000}} {
		if v := str(f, field.key, field.rule, validate.StrOpts{Max: field.max}); v.Sent {
			c.add(field.key, v.Val)
		}
	}
	validated := f.Bool("validated", optional)
	if err := formErr(f, message); err != nil {
		return err
	}
	row, err := h.svc.UpdateAttendance(r.Context(), r.PathValue("id"), c, validated != nil && *validated, a)
	if err != nil {
		return err
	}
	return ok(w, obj("message", "Attendance updated successfully", "data", row))
}

func (h handlers) deleteAttendance(w http.ResponseWriter, r *http.Request, a *Actor) error {
	if a.Role != "super_admin" && a.Role != "admin" && a.Role != "hrd" {
		return httpx.Forbidden("Forbidden: Only HRD can delete attendance records")
	}
	if err := h.svc.DeleteAttendance(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	return ok(w, msgOf("Attendance deleted successfully"))
}

func (h handlers) dailyRoster(w http.ResponseWriter, r *http.Request, a *Actor) error {
	if !a.IsHR {
		return httpx.Forbidden("Forbidden")
	}
	requested := r.URL.Query().Get("date")
	if requested != "" && !domain.DateRe.MatchString(requested) {
		return httpx.BadRequest("Format tanggal tidak valid")
	}
	today := domain.TodayWIB(h.svc.now())
	date := requested
	if date == "" {
		date = today
	}
	out, err := h.svc.DailyRoster(r.Context(), date, today)
	if err != nil {
		return err
	}
	return ok(w, dataOf(out))
}

func (h handlers) attendanceSchedule(w http.ResponseWriter, r *http.Request, a *Actor) error {
	var employeeID string
	switch requested := r.URL.Query().Get("employee_id"); {
	case !a.IsHR:
		if a.EmployeeID == nil {
			return httpx.Forbidden("Akun ini tidak terhubung ke data karyawan")
		}
		employeeID = *a.EmployeeID
	case requested == "" || requested == "me":
		employeeID = strOr(a.EmployeeID)
	default:
		employeeID = requested
	}
	if !domain.IsUUID(employeeID) {
		return httpx.BadRequest("ID karyawan tidak valid")
	}
	rows, err := h.svc.ScheduleRows(r.Context(), employeeID)
	if err != nil {
		return err
	}
	return ok(w, dataOf(rows))
}

func (h handlers) attendanceStats(w http.ResponseWriter, r *http.Request, a *Actor) error {
	q := r.URL.Query()
	month, year := statsPeriod(q.Get("month"), q.Get("year"), h.svc.now())
	out, err := h.svc.AttendanceStats(r.Context(), a, month, year)
	if err != nil {
		return err
	}
	return ok(w, dataOf(out))
}
