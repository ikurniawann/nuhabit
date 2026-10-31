package settings

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// DefaultLogoURL is the brand wordmark the letterhead shows until a logo is
// uploaded (frontend/public/brand).
const DefaultLogoURL = "/brand/wordmark-black.png"

// Letterhead is the company block quotations and invoices print on top.
// Optional fields are nil when unset.
type Letterhead struct {
	LegalName string  `json:"legal_name"`
	Address   *string `json:"address"`
	City      *string `json:"city"`
	Email     *string `json:"email"`
	Phone     *string `json:"phone"`
	NPWP      *string `json:"npwp"`
	Website   *string `json:"website"`
	LogoURL   string  `json:"logo_url"`
	// CustomLogo is false while LogoURL is the brand wordmark.
	CustomLogo bool `json:"custom_logo"`
}

// LoadLetterhead reads the stored company profile without fallbacks:
// LegalName and LogoURL are "" when unset.
func LoadLetterhead(ctx context.Context, q database.Querier) (Letterhead, error) {
	keys := []string{"company_legal_name", "company_address", "company_city", "company_email",
		"company_phone", "company_npwp", "company_website", companyLogoKey}
	s, err := kit.AppSettings{}.GetMany(ctx, q, keys)
	if err != nil {
		return Letterhead{}, err
	}
	text := func(key string) *string {
		if v := s[key]; v != nil {
			if t := validate.JSTrim(*v); t != "" {
				return &t
			}
		}
		return nil
	}
	return Letterhead{
		LegalName: kit.Deref(text("company_legal_name")), Address: text("company_address"), City: text("company_city"),
		Email: text("company_email"), Phone: text("company_phone"), NPWP: text("company_npwp"),
		Website: text("company_website"), LogoURL: kit.Deref(text(companyLogoKey)),
	}, nil
}

// GET /api/settings/letterhead[?company_id=]: any signed-in staff user reads
// it, since every quotation and invoice screen shows it. An empty legal
// name falls back to the company's name, then to the brand; an empty logo
// to the brand wordmark.
func (h *handler) getLetterhead(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireUser(r); err != nil {
		return err
	}
	companyID := r.URL.Query().Get("company_id")
	if companyID != "" && !validate.IsUUID(companyID) {
		return httpx.BadRequest("company_id tidak valid")
	}
	ctx := r.Context()
	lh, err := LoadLetterhead(ctx, h.db)
	if err != nil {
		return err
	}
	if lh.LegalName == "" && companyID != "" {
		var name *string
		err := h.db.QueryRow(ctx, `SELECT name FROM configuration.companies WHERE id = $1`, companyID).Scan(&name)
		if err != nil && !database.IsNoRows(err) {
			return err
		}
		if name != nil {
			lh.LegalName = validate.JSTrim(*name)
		}
	}
	if lh.LegalName == "" {
		lh.LegalName = brandName()
	}
	lh.CustomLogo = lh.LogoURL != ""
	if !lh.CustomLogo {
		lh.LogoURL = DefaultLogoURL
	}
	return httpx.OK(w, lh)
}
