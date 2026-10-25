package gymscheduling

import (
	"net/http"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/validate"
)

// Template Jadwal: weekly templates and the "Generate sekarang" button.

var (
	clockOpts = validate.StrOpts{Check: func(s string) (string, string, bool) {
		_, ok := domain.ParseClock(s)
		return "invalid_format", "Jam harus HH:MM", ok && len(s) == 5
	}}
	dateOpts = validate.StrOpts{Check: func(s string) (string, string, bool) {
		_, ok := localMidnight(s, localtime.Jakarta)
		return "invalid_format", "Tanggal harus YYYY-MM-DD", ok
	}}
)

// templateFields reads the template body; partial makes every field optional.
func templateFields(f *validate.Form, partial bool) TemplatePatch {
	req := validate.Rule{Optional: partial}
	var p TemplatePatch
	p.ClassTypeID = f.UUID("class_type_id", req)
	p.CoachID = optionalField(f, "coach_id", f.UUID("coach_id", nullableOptional))
	p.BranchID = optionalField(f, "branch_id", f.UUID("branch_id", nullableOptional))
	p.Area = optionalField(f, "area", f.Str("area", nullableOptional, validate.StrOpts{Trim: true, Max: 80}))
	p.Weekday = f.Int("weekday", req, between(1, 7))
	p.StartTime = f.Str("start_time", req, clockOpts)
	p.DurationMin = f.Int("duration_min", nullableOptional, between(15, 240))
	p.Capacity = f.Int("capacity", nullableOptional, between(1, 200))
	p.CreditCost = f.Int("credit_cost", nullableOptional, between(1, 20))
	p.ValidFrom = f.Str("valid_from", optional, dateOpts)
	p.ValidUntil = optionalField(f, "valid_until", f.Str("valid_until", nullableOptional, dateOpts))
	p.Active = f.Bool("active", optional)
	p.SkipHolidays = f.Bool("skip_holidays", optional)
	return p
}

func (h *handler) listTemplates(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.ListTemplates(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) createTemplate(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	f := form(r)
	p := templateFields(f, false)
	if err := invalid(f); err != nil {
		return err
	}
	in := TemplateInput{
		ClassTypeID: *p.ClassTypeID, CoachID: p.CoachID.Value, BranchID: p.BranchID.Value, Area: p.Area.Value,
		Weekday: *p.Weekday, StartTime: *p.StartTime, DurationMin: p.DurationMin, Capacity: p.Capacity,
		CreditCost: p.CreditCost, ValidUntil: p.ValidUntil.Value, Active: p.Active == nil || *p.Active,
		SkipHolidays: p.SkipHolidays == nil || *p.SkipHolidays,
	}
	if p.ValidFrom != nil {
		in.ValidFrom = *p.ValidFrom
	}
	id, err := h.svc.CreateTemplate(r.Context(), in, &user.ID)
	if err != nil {
		return err
	}
	return httpx.OK(w, object("id", id))
}

func (h *handler) updateTemplate(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	f := form(r)
	p := templateFields(f, true)
	if err := invalid(f); err != nil {
		return err
	}
	if err := h.svc.UpdateTemplate(r.Context(), id, p); err != nil {
		return err
	}
	return httpx.OK(w, object("id", id))
}

func (h *handler) deleteTemplate(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteTemplate(r.Context(), id); err != nil {
		return err
	}
	return httpx.OK(w, object("id", id))
}

// generateTemplates is "Generate sekarang": horizon_days is optional and
// defaults to the scheduleHorizonDays rule.
func (h *handler) generateTemplates(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	f := form(r)
	horizon := f.Int("horizon_days", nullableOptional, between(1, 90))
	if err := invalid(f); err != nil {
		return err
	}
	out, err := h.svc.generateFromTemplates(r.Context(), h.svc.now(), deref(horizon))
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}
