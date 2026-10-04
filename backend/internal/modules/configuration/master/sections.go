package master

import (
	"net/http"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// sectionReaders is READERS: HRIS or user settings menus.
var sectionReaders = append(append([]string{}, iam.Hris...), iam.SettingsUsers...)

func required(msg string, max int) validate.StrOpts {
	return validate.StrOpts{Trim: true, Max: max, Check: func(s string) (string, string, bool) {
		return "too_small", msg, s != ""
	}}
}

// GET /api/sections?brand_id=
func (h handler) listSections(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, sectionReaders...); err != nil {
		return err
	}
	var brandID *string
	if v := r.URL.Query().Get("brand_id"); v != "" {
		if !kit.IsUUID(v) {
			return httpx.BadRequest("Brand tidak valid")
		}
		brandID = &v
	}
	rows, err := h.sections.List(r.Context(), h.db, brandID)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, listBody{rows, len(rows)})
}

func (h handler) createSection(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.HrisOrganization...); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	brandID := f.Str("brand_id", validate.Rule{}, validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "invalid_format", "Brand tidak valid", validate.IsUUID(s)
	}})
	name := f.Str("name", validate.Rule{}, required("Nama wajib diisi", 100))
	code := f.Str("code", validate.Rule{}, required("Kode wajib diisi", 50))
	description := f.Str("description", nullish, validate.StrOpts{})
	color := f.Str("color", nullish, validate.StrOpts{Trim: true, Max: 20})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	s := Section{BrandID: *brandID, Name: *name, Code: *code, Color: "#6B7280"}
	if description != nil && *description != "" {
		s.Description = description // `v || null`
	}
	if color != nil && *color != "" {
		s.Color = *color // `v || "#6B7280"`
	}
	row, err := h.sections.Create(r.Context(), h.db, s)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, dataBody{row})
}
