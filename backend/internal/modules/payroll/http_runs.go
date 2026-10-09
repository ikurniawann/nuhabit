package payroll

import (
	"net/http"

	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

type dataBody struct {
	Data any `json:"data"`
}

type messageBody struct {
	Message string `json:"message"`
}

var optional = validate.Rule{Optional: true}
var nullish = validate.Rule{Optional: true, Nullable: true}

// GET /api/hris/payroll?year&status
func (h *handler) listRuns(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...); err != nil {
		return err
	}
	q := queryForm(r)
	year := coerceInt(q, "year", numRule{Rule: optional})
	status := q.Str("status", optional, validate.StrOpts{Min: 1})
	if err := issuesErr(q, ""); err != nil {
		return err
	}
	rows, err := h.svc.listRuns(r.Context(), year, status)
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store, max-age=0")
	return writeJSON(w, dataBody{rows})
}

// POST /api/hris/payroll { period_month, period_year, run_name? }
func (h *handler) createRun(w http.ResponseWriter, r *http.Request) error {
	u, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...)
	if err != nil {
		return err
	}
	const msg = "Bulan dan tahun periode wajib diisi dengan benar"
	f, err := readJSON(r, msg)
	if err != nil {
		return err
	}
	month := coerceInt(f, "period_month", numRule{NumOpts: validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(12)}})
	year := coerceInt(f, "period_year", numRule{NumOpts: validate.NumOpts{Min: validate.Bound(2000), Max: validate.Bound(2100)}})
	name := f.Str("run_name", nullish, validate.StrOpts{})
	if err := issuesErr(f, msg); err != nil {
		return err
	}
	row, err := h.svc.createRun(r.Context(), u.ID, *month, *year, name)
	if err != nil {
		return err
	}
	return writeJSON(w, messageData{Data: row, Message: "Payroll run berhasil dibuat"})
}

// GET /api/hris/payroll/{id}
func (h *handler) getRun(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...); err != nil {
		return err
	}
	row, err := h.svc.getRun(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return writeJSON(w, dataBody{row})
}

// PUT /api/hris/payroll/{id} { status?, notes? }
func (h *handler) updateRun(w http.ResponseWriter, r *http.Request) error {
	u, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...)
	if err != nil {
		return err
	}
	f, err := readJSON(r, "")
	if err != nil {
		return err
	}
	var in runUpdate
	if s := f.Str("status", optional, validate.StrOpts{}); s != nil {
		in.Status = *s
	}
	in.Notes = f.Str("notes", nullish, validate.StrOpts{})
	_, in.NotesSet = field(f, "notes")
	if err := issuesErr(f, ""); err != nil {
		return err
	}
	out, err := h.svc.updateRun(r.Context(), u.ID, r.PathValue("id"), in)
	if err != nil {
		return err
	}
	return writeJSON(w, out)
}

// DELETE /api/hris/payroll/{id}
func (h *handler) deleteRun(w http.ResponseWriter, r *http.Request) error {
	u, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...)
	if err != nil {
		return err
	}
	if u.Role != "super_admin" {
		return httpx.Forbidden("Hanya superadmin yang dapat menghapus payroll run")
	}
	if err := h.svc.deleteRun(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	return writeJSON(w, messageBody{"Payroll run berhasil dihapus"})
}

// POST /api/hris/payroll/{id}/calculate { include_thr? }
func (h *handler) calculateRun(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...); err != nil {
		return err
	}
	f := readOptionalJSON(r)
	thr := f.Bool("include_thr", nullish)
	if err := issuesErr(f, ""); err != nil {
		return err
	}
	out, err := h.svc.calculateRun(r.Context(), r.PathValue("id"), thr != nil && *thr)
	if err != nil {
		return err
	}
	return writeJSON(w, out)
}
