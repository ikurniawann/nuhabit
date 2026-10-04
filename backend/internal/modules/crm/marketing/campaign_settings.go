package marketing

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/marketing/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// campaignConfigKey is CAMPAIGN_CONFIG_KEY in app_settings.
const campaignConfigKey = "crm_campaign_config"

// readConfig mirrors readConfig in the campaign-config route: a stored value
// that is not JSON throws (500), a missing one is the defaults.
func (h *handler) readConfig(ctx context.Context) (domain.CampaignConfig, error) {
	raw, err := h.p.Settings.Get(ctx, h.db, campaignConfigKey)
	if err != nil || raw == nil || *raw == "" {
		return domain.ParseCampaignConfig(nil), err
	}
	v, err := kit.DecodeLoose([]byte(*raw))
	if err != nil {
		return domain.CampaignConfig{}, err
	}
	return domain.ParseCampaignConfig(v), nil
}

func (h *handler) getCampaignConfig(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateCampaign); err != nil {
		return err
	}
	cfg, err := h.readConfig(r.Context())
	if err != nil {
		return err
	}
	return kit.OK(w, cfg)
}

// putCampaignConfig saves the sender config, master switch included; only
// the crm menu (super admin and owners) may turn sending on.
func (h *handler) putCampaignConfig(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Crm...); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseConfig(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	ctx := r.Context()
	next, err := h.readConfig(ctx)
	if err != nil {
		return err
	}
	if in.Enabled != nil {
		next.Enabled = *in.Enabled
	}
	if in.DailyCap != nil {
		next.DailyCap = *in.DailyCap
	}
	raw, err := kit.MarshalNoEscape(next)
	if err != nil {
		return err
	}
	if err := h.p.Settings.Set(ctx, h.db, campaignConfigKey, string(raw)); err != nil {
		return err
	}
	return kit.OK(w, next, "Konfigurasi tersimpan")
}

func (h *handler) listOptouts(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateCampaign); err != nil {
		return err
	}
	ctx := r.Context()
	v := kit.DefaultVenue(ctx, h.db)
	rows, err := kit.Query(ctx, h.db, `SELECT id, phone, source, note, created_at
     FROM crm.crm_marketing_optouts
     WHERE branch_id = $1::text::uuid
     ORDER BY created_at DESC LIMIT 500`, v.BranchID)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

func (h *handler) addOptout(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateCampaign)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	rawPhone, note := parseOptout(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	phone := domain.NormalizePhoneDigits(rawPhone)
	if phone == "" {
		return httpx.BadRequest("Nomor tidak valid")
	}
	ctx := r.Context()
	v := kit.DefaultVenue(ctx, h.db)
	row, err := kit.QueryOne(ctx, h.db, `INSERT INTO crm.crm_marketing_optouts
       (company_id, branch_id, phone, source, note, created_by)
     VALUES ($1::text::uuid, $2::text::uuid, $3, 'manual', $4, $5)
     ON CONFLICT (branch_id, phone) DO UPDATE SET
       note = COALESCE(EXCLUDED.note, crm_marketing_optouts.note)
     RETURNING id`, v.CompanyID, v.BranchID, phone, note, user.ID)
	if err != nil {
		return err
	}
	return kit.OK(w, row, "Nomor masuk daftar opt-out")
}

func (h *handler) removeOptout(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateCampaign); err != nil {
		return err
	}
	id := r.URL.Query().Get("id")
	if !validate.IsUUID(id) {
		return httpx.BadRequest("id tidak valid")
	}
	ctx := r.Context()
	v := kit.DefaultVenue(ctx, h.db)
	tag, err := h.db.Exec(ctx, `DELETE FROM crm.crm_marketing_optouts
     WHERE id = $1 AND branch_id = $2::text::uuid`, id, v.BranchID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Tidak ditemukan")
	}
	return kit.OK(w, idData{id}, "Nomor dikeluarkan dari opt-out")
}
