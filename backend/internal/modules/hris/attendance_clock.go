package hris

import (
	"context"
	"encoding/json"
	"regexp"

	"nuhabit/backend/internal/modules/hris/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Clock-in and clock-out (lib/hris/attendance-repo.ts clockIn/clockOut):
// a selfie is required both ways, a non-HR account only clocks itself, one
// attendance row per employee and date, and the clock-in snapshots the
// scheduled shift and its lateness.

const maxSelfieBytes = 2 * 1024 * 1024

// selfiePrefix and selfieOpts are photoSchema: a JPG/PNG/WebP data URL prefix.
var selfiePrefix = regexp.MustCompile(`^data:image/(jpeg|png|webp);base64,`)
var selfieOpts = validate.StrOpts{Check: func(s string) (string, string, bool) {
	return "invalid_format", "Foto selfie wajib disertakan", selfiePrefix.MatchString(s)
}}

// clockInput is clockInSchema / clockOutSchema after parsing; Location is
// the location object with only its schema keys (zod strips the rest).
type clockInput struct {
	EmployeeID, Date, AttendanceID *string
	Photo                          string
	Location                       *Row
	Notes                          *string
}

// location is locationSchema.optional() at key.
func location(f *validate.Form, key string) *Row {
	if _, sent := f.Fields()[key]; !sent {
		return nil
	}
	c := f.Child(key)
	if c.Fields() == nil {
		return nil
	}
	loc := newRow()
	for _, k := range []string{"latitude", "longitude", "accuracy"} {
		rule := validate.Rule{Optional: k == "accuracy"}
		if v := c.Num(k, rule, validate.NumOpts{}); v != nil {
			loc.Set(k, *v)
		}
	}
	for _, k := range []string{"address", "ip_address"} {
		if v := c.Str(k, optional, validate.StrOpts{}); v != nil {
			loc.Set(k, *v)
		}
	}
	return loc
}

// parseClockIn validates clockInSchema.
func parseClockIn(f *validate.Form) clockInput {
	var in clockInput
	in.EmployeeID = f.UUID("employee_id", optional)
	in.Date = f.Str("date", optional, validate.StrOpts{})
	if p := f.Str("photo", validate.Rule{}, selfieOpts); p != nil {
		in.Photo = *p
	}
	in.Location = location(f, "clock_in_location")
	in.Notes = f.Str("notes", optional, validate.StrOpts{})
	return in
}

// parseClockOut validates clockOutSchema.
func parseClockOut(f *validate.Form) clockInput {
	var in clockInput
	in.AttendanceID = f.UUID("attendance_id", validate.Rule{})
	if p := f.Str("photo", validate.Rule{}, selfieOpts); p != nil {
		in.Photo = *p
	}
	in.Location = location(f, "clock_out_location")
	in.Notes = f.Str("notes", optional, validate.StrOpts{})
	return in
}

// locationJSON is `location || null` for a jsonb column.
func locationJSON(loc *Row) any {
	if loc == nil {
		return nil
	}
	raw, _ := json.Marshal(loc)
	return string(raw)
}

func (s *Service) saveSelfie(photo, employeeID string) (string, error) {
	return s.saveImage(photo, maxSelfieBytes, "attendance/"+employeeID,
		"Format foto tidak valid", "Ukuran foto maksimal 2 MB")
}

// ClockIn records today's (or in.Date's) attendance. existing is the
// attendance id when the employee already clocked in that day.
func (s *Service) ClockIn(ctx context.Context, a *Actor, in clockInput) (row *Row, existing *string, err error) {
	employeeID := a.EmployeeID
	if a.IsHR && in.EmployeeID != nil && *in.EmployeeID != "" {
		employeeID = in.EmployeeID
	}
	if employeeID == nil {
		return nil, nil, httpx.NotFound("Akun ini tidak terhubung ke data karyawan")
	}
	date := strOr(in.Date)
	if date == "" {
		date = domain.TodayWIB(s.now())
	}
	if existing, err = s.repo.AttendanceIDOn(ctx, *employeeID, date); err != nil || existing != nil {
		return nil, existing, err
	}
	photo, err := s.saveSelfie(in.Photo, *employeeID)
	if err != nil {
		return nil, nil, err
	}
	clockIn := s.clock()
	snap, err := s.shiftSnapshot(ctx, *employeeID, date)
	if err != nil {
		return nil, nil, err
	}
	var f fields
	f.add("employee_id", *employeeID)
	f.add("date", date)
	f.add("clock_in", clockIn)
	f.add("clock_in_location", locationJSON(in.Location))
	f.add("clock_in_photo_url", photo)
	f.add("shift_id", nil)
	f.add("scheduled_start", nil)
	f.add("scheduled_end", nil)
	f.add("is_late", false)
	f.add("late_minutes", 0)
	if snap != nil {
		start, end := domain.ScheduledWindow(date, snap.times)
		late, minutes := domain.Lateness(clockIn, date, snap.times)
		f.set("shift_id", snap.shiftID)
		f.set("scheduled_start", start)
		f.set("scheduled_end", end)
		f.set("is_late", late)
		f.set("late_minutes", minutes)
	}
	f.add("notes", nilIfEmpty(in.Notes))
	f.add("status", "present")
	row, err = s.repo.InsertAttendance(ctx, f)
	return row, nil, err
}

type shiftSnap struct {
	shiftID string
	times   domain.ShiftTimes
}

// shiftSnapshot is the shift that applies on date with its times, nil
// without a schedule or on a day off (attendance is recorded without a
// lateness verdict).
func (s *Service) shiftSnapshot(ctx context.Context, employeeID, date string) (*shiftSnap, error) {
	rows, err := s.repo.ShiftPattern(ctx, employeeID)
	if err != nil {
		return nil, err
	}
	pattern := make([]domain.ScheduleRow, len(rows))
	for i, r := range rows {
		pattern[i] = domain.ScheduleRow{DayOfWeek: int(r.Num("day_of_week")), ShiftID: r.StrPtr("shift_id"),
			EffectiveFrom: r.Str("effective_from"), EffectiveTo: r.StrPtr("effective_to")}
	}
	idx := domain.ResolveScheduleRow(pattern, date)
	if idx < 0 || pattern[idx].ShiftID == nil {
		return nil, nil
	}
	shiftID := *pattern[idx].ShiftID
	for _, r := range rows {
		if r.Str("shift_id") != shiftID || r.Str("name") == "" {
			continue
		}
		if r.Str("start_time") == "" || r.Str("end_time") == "" {
			return nil, nil
		}
		return &shiftSnap{shiftID, domain.ShiftTimes{StartTime: r.Str("start_time"), EndTime: r.Str("end_time"),
			IsOvernight: r.Bool("is_overnight"), LateToleranceMinutes: int(r.Num("late_tolerance_minutes"))}}, nil
	}
	return nil, nil
}

// ClockOut closes an attendance row; non-HR only their own.
func (s *Service) ClockOut(ctx context.Context, a *Actor, in clockInput) (*Row, error) {
	id := strOr(in.AttendanceID)
	att, err := s.repo.AttendanceRecord(ctx, id)
	if err != nil || att == nil {
		return nil, errOr(err, httpx.NotFound("Attendance record not found"))
	}
	employeeID := att.Str("employee_id")
	if !a.IsHR && (a.EmployeeID == nil || employeeID != *a.EmployeeID) {
		return nil, httpx.Forbidden("Tidak boleh mengubah absensi karyawan lain")
	}
	if att.Get("clock_out") != nil {
		return nil, httpx.BadRequest("Sudah clock-out untuk absensi ini")
	}
	photo, err := s.saveSelfie(in.Photo, employeeID)
	if err != nil {
		return nil, err
	}
	notes := att.Get("notes")
	if n := strOr(in.Notes); n != "" {
		notes = domain.JSTrim(att.Str("notes") + "\n" + n)
	}
	var f fields
	f.add("clock_out", s.clock()) // work_hours comes from the table's trigger
	f.add("clock_out_location", locationJSON(in.Location))
	f.add("clock_out_photo_url", photo)
	f.add("notes", notes)
	return s.repo.UpdateAttendance(ctx, id, f)
}
