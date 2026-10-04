package settings

import (
	"encoding/json"
	"net/http"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/modules/configuration/settings/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

/* ── company profile ─────────────────────────────────────────────────── */

// companyFields are the profile fields in schema order with their
// configuration.app_settings keys.
var companyFields = [][2]string{
	{"legal_name", "company_legal_name"},
	{"address", "company_address"},
	{"city", "company_city"},
	{"signer_name", "company_signer_name"},
	{"signer_title", "company_signer_title"},
}

func (h *handler) getCompanyProfile(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsBusiness...); err != nil {
		return err
	}
	keys := make([]string, len(companyFields))
	for i, f := range companyFields {
		keys[i] = f[1]
	}
	stored, err := h.settings.GetMany(r.Context(), h.db, keys)
	if err != nil {
		return err
	}
	data := kit.Obj()
	for _, f := range companyFields {
		data.Set(f[0], stored[f[1]])
	}
	return httpx.JSON(w, http.StatusOK, dataBody{data})
}

func (h *handler) putCompanyProfile(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsBusiness...); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	type update struct {
		key   string
		value *string
	}
	var updates []update
	for _, field := range companyFields {
		_, sent := f.Fields()[field[0]]
		v := f.Str(field[0], validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Max: 500})
		if !sent {
			continue
		}
		// value ? value.trim() : null
		var value *string
		if v != nil && *v != "" {
			trimmed := validate.JSTrim(*v)
			value = &trimmed
		}
		updates = append(updates, update{field[1], value})
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	for _, u := range updates {
		if err := h.settings.Put(r.Context(), h.db, u.key, u.value); err != nil {
			return err
		}
	}
	return httpx.JSON(w, http.StatusOK, map[string]string{"message": "Profil perusahaan tersimpan"})
}

/* ── sales target ────────────────────────────────────────────────────── */

type salesTargetBody struct {
	Config domain.SalesTarget `json:"config"`
}

func (h *handler) getSalesTarget(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsBusiness...); err != nil {
		return err
	}
	raw, err := h.settings.Get(r.Context(), h.db, domain.SalesTargetKey)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, dataBody{salesTargetBody{domain.ParseSalesTarget(raw)}})
}

func (h *handler) putSalesTarget(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsBusiness...); err != nil {
		return err
	}
	body, err := bodyObject(r)
	if err != nil {
		return err
	}
	if _, ok := domain.ApplySalesTargetInput(domain.SalesTarget{}, body); !ok {
		return httpx.BadRequest("Nilai target tidak valid (angka Rp, maksimal 100 M)")
	}
	raw, err := h.settings.Get(r.Context(), h.db, domain.SalesTargetKey)
	if err != nil {
		return err
	}
	next, _ := domain.ApplySalesTargetInput(domain.ParseSalesTarget(raw), body)
	stored, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if err := h.settings.Set(r.Context(), h.db, domain.SalesTargetKey, string(stored)); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, dataBody{salesTargetBody{next}})
}

/* ── static QRIS (GET and PUT; upload and delete in static_qris_upload.go) */

// staticQris is StaticQrisConfig (lib/payments/static-qris.ts).
type staticQris struct {
	Enabled   bool    `json:"enabled"`
	ImageURL  *string `json:"imageUrl"`
	Available bool    `json:"available"`
}

func (h *handler) loadStaticQris(r *http.Request) (staticQris, error) {
	s, err := h.settings.GetMany(r.Context(), h.db, []string{"static_qris_enabled", "static_qris_image_url"})
	if err != nil {
		return staticQris{}, err
	}
	var image *string
	if v := s["static_qris_image_url"]; v != nil {
		if t := validate.JSTrim(*v); t != "" {
			image = &t
		}
	}
	enabled := kit.Deref(s["static_qris_enabled"]) == "true"
	return staticQris{Enabled: enabled, ImageURL: image, Available: enabled && image != nil}, nil
}

func (h *handler) respondStaticQris(w http.ResponseWriter, r *http.Request) error {
	cfg, err := h.loadStaticQris(r)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, cfg)
}

func (h *handler) getStaticQris(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsPaymentGateways...); err != nil {
		return err
	}
	return h.respondStaticQris(w, r)
}

func (h *handler) putStaticQris(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsPaymentGateways...); err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	enabled := f.Bool("enabled", validate.Rule{})
	if !f.Valid() {
		return httpx.BadRequest("Data tidak valid")
	}
	if *enabled {
		cfg, err := h.loadStaticQris(r)
		if err != nil {
			return err
		}
		if cfg.ImageURL == nil {
			return httpx.BadRequest("Unggah gambar QRIS dulu sebelum mengaktifkan")
		}
	}
	value := "false"
	if *enabled {
		value = "true"
	}
	if err := h.settings.Set(r.Context(), h.db, "static_qris_enabled", value); err != nil {
		return err
	}
	return h.respondStaticQris(w, r)
}
