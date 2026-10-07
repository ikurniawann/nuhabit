package master

import (
	"net/http"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

var (
	optional        = validate.Rule{Optional: true}
	nullish         = validate.Rule{Optional: true, Nullable: true}
	brandNameCreate = validate.StrOpts{Trim: true, Max: 100, Check: func(s string) (string, string, bool) {
		return "too_small", "Nama brand wajib diisi", s != ""
	}}
)

// GET /api/brands (?active=true for active brands only), by name. Readers
// need an HRIS menu, as in the TS route.
func (h handler) listBrands(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Hris...); err != nil {
		return err
	}
	where := ""
	if r.URL.Query().Get("active") == "true" {
		where = "WHERE is_active = true"
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT * FROM item.brands `+where+` ORDER BY name`)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, listBody{rows, len(rows)})
}

func (h handler) createBrand(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.SettingsBusiness...); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	name := f.Str("name", validate.Rule{}, brandNameCreate)
	industry := f.Str("industry", nullish, validate.StrOpts{Trim: true, Max: 50})
	logo := f.Str("logo_url", nullish, validate.StrOpts{Trim: true, Max: 500})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	ind := "F&B" // `body.industry || "F&B"`
	if industry != nil && *industry != "" {
		ind = *industry
	}
	if logo != nil && *logo == "" {
		logo = nil
	}
	row, err := kit.QueryOne(r.Context(), h.db,
		"INSERT INTO item.brands (name, industry, logo_url) VALUES ($1, $2, $3) RETURNING *", *name, ind, logo)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, dataBody{row})
}

// PATCH /api/brands/{id}: only the fields sent change.
func (h handler) patchBrand(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.SettingsBusiness...); err != nil {
		return err
	}
	id := r.PathValue("id")
	if !kit.IsUUID(id) {
		return httpx.BadRequest("ID brand tidak valid")
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	// Columns in schema order, as zod writes the parsed object.
	var cols []string
	args := []any{id}
	add := func(col string, v any) {
		cols = append(cols, col+" = $"+strconv.Itoa(len(args)+1))
		args = append(args, v)
	}
	if v := f.Bool("is_active", optional); v != nil {
		add("is_active", *v)
	}
	if v := f.Str("name", optional, validate.StrOpts{Trim: true, Min: 1, Max: 100}); v != nil {
		add("name", *v)
	}
	if v := f.Str("industry", optional, validate.StrOpts{Trim: true, Max: 50}); v != nil {
		add("industry", *v)
	}
	logo := f.Str("logo_url", nullish, validate.StrOpts{Trim: true, Max: 500})
	if _, sent := f.Fields()["logo_url"]; sent {
		add("logo_url", logo) // null clears the logo
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	sql := "SELECT * FROM item.brands WHERE id = $1"
	if len(cols) > 0 {
		sql = "UPDATE item.brands SET " + strings.Join(cols, ", ") + " WHERE id = $1 RETURNING *"
	}
	row, err := kit.QueryOne(r.Context(), h.db, sql, args...)
	if err != nil {
		return err
	}
	if row == nil {
		return httpx.NotFound("Brand tidak ditemukan")
	}
	return httpx.JSON(w, http.StatusOK, dataBody{row})
}
