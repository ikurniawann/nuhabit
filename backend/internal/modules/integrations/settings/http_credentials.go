package settings

import (
	"net/http"
	"regexp"
	"strings"

	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/modules/integrations/internal/appsettings"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Credentials of the AI providers, Google Business Profile and Instagram
// Messaging in configuration.app_settings.

type providerKeys struct {
	apiKey, model, baseURL string
	defaults               domain.ProviderDefaults
}

var (
	deepseekKeys = providerKeys{"deepseek_api_key", "deepseek_model", "deepseek_base_url", domain.DeepSeekDefaults}
	openaiKeys   = providerKeys{"openai_api_key", "openai_model", "openai_base_url", domain.OpenAIDefaults}
)

type providerView struct {
	APIKeyMasked *string `json:"api_key_masked"`
	HasAPIKey    bool    `json:"has_api_key"`
	Model        string  `json:"model"`
	BaseURL      string  `json:"base_url"`
}

func (k providerKeys) view(s appsettings.Values) providerView {
	v := providerView{APIKeyMasked: appsettings.Mask(s[k.apiKey]), HasAPIKey: s.Str(k.apiKey) != "", Model: s.Str(k.model), BaseURL: s.Str(k.baseURL)}
	if v.Model == "" {
		v.Model = k.defaults.Model
	}
	if v.BaseURL == "" {
		v.BaseURL = k.defaults.BaseURL
	}
	return v
}

// GET /api/settings/integrations: DeepSeek and OpenAI, API keys masked.
func (h *Handler) getProviders(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	s, err := appsettings.GetMany(r.Context(), h.db, deepseekKeys.apiKey, deepseekKeys.model, deepseekKeys.baseURL,
		openaiKeys.apiKey, openaiKeys.model, openaiKeys.baseURL)
	if err != nil {
		return err
	}
	type views struct {
		DeepSeek providerView `json:"deepseek"`
		OpenAI   providerView `json:"openai"`
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Data views `json:"data"`
	}{views{deepseekKeys.view(s), openaiKeys.view(s)}})
}

var trailingSlashes = regexp.MustCompile(`/+$`)

// applyProvider is applyProviderConfig: an empty api_key deletes the key, a nil
// field leaves it unchanged.
func (h *Handler) applyProvider(r *http.Request, k providerKeys, in domain.ProviderInput) error {
	ctx := r.Context()
	switch {
	case in.APIKeyNull || (in.APIKey != nil && *in.APIKey == ""):
		if err := appsettings.Set(ctx, h.db, k.apiKey, nil); err != nil {
			return err
		}
	case in.APIKey != nil:
		key := validate.JSTrim(*in.APIKey)
		if err := appsettings.Set(ctx, h.db, k.apiKey, &key); err != nil {
			return err
		}
	}
	if in.Model != nil {
		model := validate.JSTrim(*in.Model)
		if err := appsettings.Set(ctx, h.db, k.model, &model); err != nil {
			return err
		}
	}
	if in.BaseURL != nil {
		base := trailingSlashes.ReplaceAllString(validate.JSTrim(*in.BaseURL), "")
		return appsettings.Set(ctx, h.db, k.baseURL, &base)
	}
	return nil
}

// PUT /api/settings/integrations: the flat api_key/model/base_url fields
// are DeepSeek (the old payload); OpenAI comes as `openai: {…}`. DeepSeek
// is saved before the OpenAI object is checked, as the TS does.
func (h *Handler) putProviders(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	raw, err := strictBody(r)
	if err != nil {
		return err
	}
	body, _ := raw.(map[string]any)
	in, msg := domain.ParseProviderInput(body, "")
	if msg != "" {
		return httpx.BadRequest(msg)
	}
	if err := h.applyProvider(r, deepseekKeys, in); err != nil {
		return err
	}
	if v, sent := body["openai"]; sent {
		var o map[string]any
		switch x := v.(type) {
		case map[string]any:
			o = x
		case []any: // typeof [] === "object": no field is set
		default:
			return httpx.BadRequest("openai tidak valid")
		}
		in, msg := domain.ParseProviderInput(o, "openai: ")
		if msg != "" {
			return httpx.BadRequest(msg)
		}
		if err := h.applyProvider(r, openaiKeys, in); err != nil {
			return err
		}
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Message string `json:"message"`
	}{"Konfigurasi tersimpan"})
}

/* ── Google Business Profile (super_admin) ───────────────────────────── */

const (
	googleClientID     = "google_bp_client_id"
	googleClientSecret = "google_bp_client_secret"
	googleRefreshToken = "google_bp_refresh_token"
	googleAccountID    = "google_bp_account_id"
	googleLocationID   = "google_bp_location_id"
)

type successOnly struct {
	Success bool `json:"success"`
}

// GET /api/settings/google-business: non-secret values in full, secrets as
// a flag and a masked form.
func (h *Handler) getGoogle(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireSuperAdmin(r); err != nil {
		return err
	}
	s, err := appsettings.GetMany(r.Context(), h.db, googleClientID, googleClientSecret, googleRefreshToken, googleAccountID, googleLocationID)
	if err != nil {
		return err
	}
	type view struct {
		ClientID           string  `json:"client_id"`
		AccountID          string  `json:"account_id"`
		LocationID         string  `json:"location_id"`
		HasClientSecret    bool    `json:"has_client_secret"`
		ClientSecretMasked *string `json:"client_secret_masked"`
		HasRefreshToken    bool    `json:"has_refresh_token"`
		RefreshTokenMasked *string `json:"refresh_token_masked"`
		Configured         bool    `json:"configured"`
	}
	v := view{
		ClientID: s.Str(googleClientID), AccountID: s.Str(googleAccountID), LocationID: s.Str(googleLocationID),
		HasClientSecret: s.Str(googleClientSecret) != "", ClientSecretMasked: appsettings.Mask(s[googleClientSecret]),
		HasRefreshToken: s.Str(googleRefreshToken) != "", RefreshTokenMasked: appsettings.Mask(s[googleRefreshToken]),
	}
	v.Configured = v.ClientID != "" && v.AccountID != "" && v.LocationID != "" && v.HasClientSecret && v.HasRefreshToken
	return httpx.Data(w, http.StatusOK, v)
}

// setting is one key to write; nil stores NULL.
type setting struct {
	key   string
	value *string
}

func (h *Handler) writeSettings(r *http.Request, list []setting) error {
	for _, s := range list {
		if err := appsettings.Set(r.Context(), h.db, s.key, s.value); err != nil {
			return err
		}
	}
	return nil
}

// credentialForm validates a z.object of optional trimmed strings; nil
// fields were not sent. ok=false is the TS 400 "Payload tidak valid".
func credentialForm(r *http.Request, fields []string, max map[string]int) (map[string]*string, bool, error) {
	raw, err := strictBody(r)
	if err != nil {
		return nil, false, err
	}
	f := validate.New(raw, true)
	out := map[string]*string{}
	for _, name := range fields {
		out[name] = f.Str(name, validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: max[name]})
	}
	return out, f.Valid(), nil
}

// PUT /api/settings/google-business: an empty secret field means "keep",
// not "delete". The CRM inbox's Google adapter keeps its cached access
// token until it expires (the TS reset its in-process cache here).
func (h *Handler) putGoogle(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireSuperAdmin(r); err != nil {
		return err
	}
	p, ok, err := credentialForm(r, []string{"client_id", "client_secret", "refresh_token", "account_id", "location_id"},
		map[string]int{"client_id": 300, "client_secret": 300, "refresh_token": 600, "account_id": 200, "location_id": 1000})
	if err != nil {
		return err
	}
	if !ok {
		return httpx.BadRequest("Payload tidak valid")
	}
	var updates []setting
	if v := p["client_id"]; v != nil {
		updates = append(updates, setting{googleClientID, appsettings.Ptr(*v)})
	}
	if v := p["account_id"]; v != nil {
		updates = append(updates, setting{googleAccountID, appsettings.Ptr(domain.WithPrefix(*v, "accounts"))})
	}
	if v := p["location_id"]; v != nil {
		updates = append(updates, setting{googleLocationID, appsettings.Ptr(strings.Join(domain.ParseLocationIDs(*v), ","))})
	}
	if v := p["client_secret"]; v != nil && *v != "" {
		updates = append(updates, setting{googleClientSecret, v})
	}
	if v := p["refresh_token"]; v != nil && *v != "" {
		updates = append(updates, setting{googleRefreshToken, v})
	}
	if err := h.writeSettings(r, updates); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, successOnly{true})
}

// DELETE /api/settings/google-business clears every credential.
func (h *Handler) deleteGoogle(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireSuperAdmin(r); err != nil {
		return err
	}
	if err := h.writeSettings(r, []setting{{googleClientID, nil}, {googleAccountID, nil}, {googleLocationID, nil},
		{googleClientSecret, nil}, {googleRefreshToken, nil}}); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, successOnly{true})
}

/* ── Instagram Messaging (super_admin) ───────────────────────────────── */

const (
	igAppSecret   = "ig_app_secret"
	igVerifyToken = "ig_verify_token"
	igAccessToken = "ig_access_token"
	igAccountID   = "ig_account_id"
)

// GET /api/settings/instagram: the verify token (ours, copied to Meta) and
// account id in full, the app secret and access token masked.
func (h *Handler) getInstagram(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireSuperAdmin(r); err != nil {
		return err
	}
	s, err := appsettings.GetMany(r.Context(), h.db, igAppSecret, igVerifyToken, igAccessToken, igAccountID)
	if err != nil {
		return err
	}
	type view struct {
		VerifyToken       string  `json:"verify_token"`
		AccountID         string  `json:"account_id"`
		HasAppSecret      bool    `json:"has_app_secret"`
		AppSecretMasked   *string `json:"app_secret_masked"`
		HasAccessToken    bool    `json:"has_access_token"`
		AccessTokenMasked *string `json:"access_token_masked"`
		WebhookReady      bool    `json:"webhook_ready"`
		Configured        bool    `json:"configured"`
	}
	v := view{
		VerifyToken: s.Str(igVerifyToken), AccountID: s.Str(igAccountID),
		HasAppSecret: s.Str(igAppSecret) != "", AppSecretMasked: appsettings.Mask(s[igAppSecret]),
		HasAccessToken: s.Str(igAccessToken) != "", AccessTokenMasked: appsettings.Mask(s[igAccessToken]),
	}
	v.WebhookReady = v.HasAppSecret && v.VerifyToken != ""
	v.Configured = v.WebhookReady && v.HasAccessToken && v.AccountID != ""
	return httpx.Data(w, http.StatusOK, v)
}

// PUT /api/settings/instagram: an empty secret means "keep".
func (h *Handler) putInstagram(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireSuperAdmin(r); err != nil {
		return err
	}
	p, ok, err := credentialForm(r, []string{"app_secret", "verify_token", "access_token", "account_id"},
		map[string]int{"app_secret": 300, "verify_token": 300, "access_token": 1000, "account_id": 200})
	if err != nil {
		return err
	}
	if !ok {
		return httpx.BadRequest("Payload tidak valid")
	}
	var updates []setting
	if v := p["verify_token"]; v != nil {
		updates = append(updates, setting{igVerifyToken, appsettings.Ptr(*v)})
	}
	if v := p["account_id"]; v != nil {
		updates = append(updates, setting{igAccountID, appsettings.Ptr(*v)})
	}
	if v := p["app_secret"]; v != nil && *v != "" {
		updates = append(updates, setting{igAppSecret, v})
	}
	if v := p["access_token"]; v != nil && *v != "" {
		updates = append(updates, setting{igAccessToken, v})
	}
	if err := h.writeSettings(r, updates); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, successOnly{true})
}

// DELETE /api/settings/instagram clears every credential.
func (h *Handler) deleteInstagram(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireSuperAdmin(r); err != nil {
		return err
	}
	if err := h.writeSettings(r, []setting{{igVerifyToken, nil}, {igAccountID, nil}, {igAppSecret, nil}, {igAccessToken, nil}}); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, successOnly{true})
}
