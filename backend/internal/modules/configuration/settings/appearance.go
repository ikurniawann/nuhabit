package settings

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/modules/configuration/settings/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/scope"
)

// appearanceCompany is AppearanceCompany.
type appearanceCompany struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type appearanceData struct {
	CompanyID   *string             `json:"company_id"`
	CompanyName *string             `json:"company_name"`
	Companies   []appearanceCompany `json:"companies"`
	Theme       domain.Appearance   `json:"theme"`
}

func newAppearanceData(companyID *string, companies []appearanceCompany, theme domain.Appearance) appearanceData {
	d := appearanceData{CompanyID: companyID, Companies: companies, Theme: theme}
	if companyID != nil {
		for _, c := range companies {
			if c.ID == *companyID {
				name := c.Name
				d.CompanyName = &name
				break
			}
		}
	}
	return d
}

// unscopedAppearance is the isUnscoped || super_admin check of
// lib/theme/company-appearance.ts.
func unscopedAppearance(s *scope.Scope) bool {
	return s.Unscoped || (s.Role != nil && *s.Role == "super_admin")
}

// listAppearanceCompanies is listAccessibleAppearanceCompanies.
func listAppearanceCompanies(ctx context.Context, q database.Querier, s *scope.Scope) ([]appearanceCompany, error) {
	var rows pgx.Rows
	var err error
	switch {
	case unscopedAppearance(s):
		rows, err = q.Query(ctx, `SELECT id::text, name FROM configuration.companies WHERE is_active = true ORDER BY name`)
	case s.CompanyID == nil || *s.CompanyID == "":
		return []appearanceCompany{}, nil
	default:
		rows, err = q.Query(ctx, `SELECT id::text, name FROM configuration.companies WHERE id = $1 AND is_active = true`,
			*s.CompanyID)
	}
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[appearanceCompany])
}

// canAccessAppearanceCompany is canAccessAppearanceCompany.
func canAccessAppearanceCompany(s *scope.Scope, companyID string) bool {
	return unscopedAppearance(s) || (s.CompanyID != nil && *s.CompanyID == companyID)
}

// defaultAppearanceCompany is resolveDefaultCompanyId.
func defaultAppearanceCompany(s *scope.Scope, companies []appearanceCompany) *string {
	if s.CompanyID != nil && *s.CompanyID != "" {
		for _, c := range companies {
			if c.ID == *s.CompanyID {
				return s.CompanyID
			}
		}
	}
	if len(companies) > 0 {
		return &companies[0].ID
	}
	return nil
}

// companyAppearance is getCompanyAppearance.
func companyAppearance(ctx context.Context, q database.Querier, companyID string) (domain.Appearance, error) {
	var raw []byte
	err := q.QueryRow(ctx, `SELECT theme::text FROM configuration.company_appearance WHERE company_id = $1`,
		companyID).Scan(&raw)
	if err != nil && !database.IsNoRows(err) {
		return domain.Appearance{}, err
	}
	return domain.ParseAppearance(decodeJSON(raw)), nil
}

// decodeJSON is JSON.parse with numbers kept as json.Number; nil for
// missing or malformed input.
func decodeJSON(raw []byte) any {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if dec.Decode(&v) != nil {
		return nil
	}
	return v
}

func (h *handler) getAppearance(w http.ResponseWriter, r *http.Request) error {
	u, err := h.d.Auth.CurrentUser(r)
	if err != nil {
		return err
	}
	if u == nil {
		// Without a session the login page gets the default theme.
		return httpx.JSON(w, http.StatusOK, dataBody{newAppearanceData(nil, []appearanceCompany{}, domain.DefaultAppearance)})
	}
	s, err := scope.Load(r.Context(), h.db, u.ID)
	if err != nil {
		return err
	}
	companies, err := listAppearanceCompanies(r.Context(), h.db, s)
	if err != nil {
		return err
	}
	requested := r.URL.Query().Get("company_id")
	allowed := requested != "" && canAccessAppearanceCompany(s, requested)
	companyID := defaultAppearanceCompany(s, companies)
	if allowed {
		companyID = &requested
	}
	if companyID == nil {
		return httpx.JSON(w, http.StatusOK, dataBody{newAppearanceData(nil, companies, domain.DefaultAppearance)})
	}
	if requested != "" && !allowed {
		return httpx.Forbidden("Company tidak dapat diakses")
	}
	theme, err := companyAppearance(r.Context(), h.db, *companyID)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, dataBody{newAppearanceData(companyID, companies, theme)})
}

type appearanceSaved struct {
	Message string         `json:"message"`
	Data    appearanceData `json:"data"`
}

func (h *handler) putAppearance(w http.ResponseWriter, r *http.Request) error {
	u, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsAppearance...)
	if err != nil {
		return err
	}
	s, err := scope.Load(r.Context(), h.db, u.ID)
	if err != nil {
		return err
	}
	raw, err := kit.ReadJSON(r)
	if err != nil {
		return err
	}
	body, _ := raw.(map[string]any) // `?? {}`, and a primitive has no fields
	companyID, _ := body["company_id"].(string)
	if companyID == "" {
		return httpx.BadRequest("company_id wajib")
	}
	if !canAccessAppearanceCompany(s, companyID) {
		return httpx.Forbidden("Company tidak dapat diakses")
	}
	companies, err := listAppearanceCompanies(r.Context(), h.db, s)
	if err != nil {
		return err
	}
	found := false
	for _, c := range companies {
		found = found || c.ID == companyID
	}
	if !found {
		return httpx.NotFound("Company tidak ditemukan")
	}
	theme := domain.ParseAppearance(body["theme"])
	stored, err := json.Marshal(theme)
	if err != nil {
		return err
	}
	if _, err := h.db.Exec(r.Context(), `INSERT INTO configuration.company_appearance (company_id, theme, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (company_id) DO UPDATE SET
       theme = EXCLUDED.theme,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by`, companyID, string(stored), u.ID); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, appearanceSaved{"Tema perusahaan tersimpan",
		newAppearanceData(&companyID, companies, theme)})
}
