package settings

import (
	"errors"
	"html"
	"net/http"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/modules/integrations/internal/appsettings"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/mail"
	"nuhabit/backend/internal/platform/validate"
)

// Settings → Integrasi → Email: the outbound mail provider (Resend or
// Microsoft 365 through Graph or SMTP), a test send to the signed-in user
// and the outbound log with a manual resend. Secrets come back masked; an
// empty or masked value on save keeps the stored one, null deletes it.

// emailView is GET /api/settings/email.
type emailView struct {
	Provider             string  `json:"provider"`
	Transport            string  `json:"transport"`
	FromEmail            string  `json:"from_email"`
	FromName             string  `json:"from_name"`
	ResendAPIKeyMasked   *string `json:"resend_api_key_masked"`
	HasResendAPIKey      bool    `json:"has_resend_api_key"`
	MsTenantID           string  `json:"ms_tenant_id"`
	MsClientID           string  `json:"ms_client_id"`
	MsClientSecretMasked *string `json:"ms_client_secret_masked"`
	HasMsClientSecret    bool    `json:"has_ms_client_secret"`
	MsSender             string  `json:"ms_sender"`
	SMTPHost             string  `json:"smtp_host"`
	SMTPPort             int     `json:"smtp_port"`
	SMTPUser             string  `json:"smtp_user"`
	SMTPPasswordMasked   *string `json:"smtp_password_masked"`
	HasSMTPPassword      bool    `json:"has_smtp_password"`
	// Resolved is the provider that will send (resend, microsoft-graph,
	// microsoft-smtp) or "".
	Resolved   string `json:"resolved"`
	Configured bool   `json:"configured"`
	// FromEnv lists the setting keys whose value comes from the server env
	// because nothing is stored.
	FromEnv []string `json:"from_env"`
}

func (h *Handler) emailView(r *http.Request) (emailView, error) {
	ctx := r.Context()
	stored, err := appsettings.GetMany(ctx, h.db, mail.SettingKeys()...)
	if err != nil {
		return emailView{}, err
	}
	cfg, err := mail.Load(ctx, h.db, h.getenv)
	if err != nil {
		return emailView{}, err
	}
	v := emailView{
		Provider: cfg.Provider, Transport: cfg.Transport, FromEmail: cfg.FromEmail, FromName: cfg.FromName,
		ResendAPIKeyMasked: appsettings.Mask(appsettings.Ptr(cfg.ResendAPIKey)), HasResendAPIKey: cfg.ResendAPIKey != "",
		MsTenantID: cfg.TenantID, MsClientID: cfg.ClientID,
		MsClientSecretMasked: appsettings.Mask(appsettings.Ptr(cfg.ClientSecret)), HasMsClientSecret: cfg.ClientSecret != "",
		MsSender: cfg.Sender, SMTPHost: cfg.SMTPHost, SMTPPort: cfg.SMTPPort, SMTPUser: cfg.SMTPUser,
		SMTPPasswordMasked: appsettings.Mask(appsettings.Ptr(cfg.SMTPPassword)), HasSMTPPassword: cfg.SMTPPassword != "",
		Resolved: cfg.Resolved(), Configured: cfg.Configured(), FromEnv: []string{},
	}
	for _, s := range mail.Settings {
		if stored.Trimmed(s.Key) == "" && strings.TrimSpace(h.getenv(s.Env)) != "" {
			v.FromEnv = append(v.FromEnv, s.Key)
		}
	}
	return v, nil
}

// GET /api/settings/email
func (h *Handler) getEmail(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	v, err := h.emailView(r)
	if err != nil {
		return err
	}
	return httpx.OK(w, v)
}

// emailFields maps request fields to setting keys. Secrets keep the stored
// value on an empty or masked input.
var emailFields = []struct {
	field, key string
	secret     bool
}{
	{"provider", "mail_provider", false},
	{"from_email", "mail_from_email", false},
	{"from_name", "mail_from_name", false},
	{"resend_api_key", "mail_resend_api_key", true},
	{"transport", "mail_ms_transport", false},
	{"ms_tenant_id", "mail_ms_tenant_id", false},
	{"ms_client_id", "mail_ms_client_id", false},
	{"ms_client_secret", "mail_ms_client_secret", true},
	{"ms_sender", "mail_ms_sender", false},
	{"smtp_host", "mail_smtp_host", false},
	{"smtp_port", "mail_smtp_port", false},
	{"smtp_user", "mail_smtp_user", false},
	{"smtp_password", "mail_smtp_password", true},
}

// PUT /api/settings/email: every field optional; a missing field is left
// alone, null clears it.
func (h *Handler) putEmail(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	raw, err := strictBody(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	opt := validate.Rule{Optional: true, Nullable: true}
	values := map[string]*string{}
	sent := map[string]bool{}
	for _, field := range emailFields {
		_, present := f.Fields()[field.field]
		if !present {
			continue
		}
		var value *string
		switch field.field {
		case "provider":
			value = f.Enum(field.field, opt, []string{"", mail.ProviderResend, mail.ProviderMicrosoft})
		case "transport":
			value = f.Enum(field.field, opt, []string{"", mail.TransportGraph, mail.TransportSMTP})
		case "smtp_port":
			if n := f.Int(field.field, opt, validate.NumOpts{Integer: true, Min: ptrFloat(1), Max: ptrFloat(65535)}); n != nil {
				s := strconv.Itoa(*n)
				value = &s
			}
		case "from_email":
			value = f.Str(field.field, opt, validate.StrOpts{Trim: true, Max: 320, Check: func(s string) (string, string, bool) {
				if s != "" && (!strings.Contains(s, "@") || strings.ContainsAny(s, " <>")) {
					return "invalid_format", "Alamat email pengirim tidak valid", false
				}
				return "", "", true
			}})
		default:
			value = f.Str(field.field, opt, validate.StrOpts{Trim: true, Max: 2000})
		}
		// An empty or masked secret keeps the stored one; null (value nil
		// with the field present) deletes it.
		if field.secret && f.Fields()[field.field] != nil && domain.KeepExistingSecret(value) {
			continue
		}
		sent[field.key] = true
		if value != nil && *value == "" {
			value = nil
		}
		values[field.key] = value
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	for key := range sent {
		if err := appsettings.Set(r.Context(), h.db, key, values[key]); err != nil {
			return err
		}
	}
	if h.ports.Mail != nil {
		h.ports.Mail.Invalidate()
	}
	v, err := h.emailView(r)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusOK, v, "Konfigurasi email tersimpan")
}

func ptrFloat(v float64) *float64 { return &v }

// POST /api/settings/email/test: one message to the signed-in user. A
// provider failure comes back as 502 with the provider's error verbatim.
func (h *Handler) testEmail(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.RequireMenuPrefix(r, iam.SettingsIntegrations...)
	if err != nil {
		return err
	}
	if h.ports.Mail == nil {
		return httpx.Status(http.StatusServiceUnavailable, "Mailer belum terpasang")
	}
	to := strings.TrimSpace(user.Email)
	if !strings.Contains(to, "@") {
		return httpx.BadRequest("Akun Anda belum punya alamat email; isi email di profil dulu")
	}
	ctx := r.Context()
	if !h.ports.Mail.Configured(ctx) {
		return httpx.BadRequest(mail.ErrNotConfigured.Error())
	}
	brand := h.brandName()
	now := domain.NowLabel(h.now())
	res := h.ports.Mail.Send(ctx, mail.Message{
		Kind: "test", To: to, Subject: brand + " — email uji", NoRetry: true,
		HTML: "<p>Email uji dari " + html.EscapeString(brand) + ".</p><p>Pengaturan email berfungsi; email ini dikirim " +
			html.EscapeString(now) + " WIB oleh " + html.EscapeString(user.FullName) + ".</p>",
	})
	if res.Err != nil {
		return httpx.Status(http.StatusBadGateway, res.Err.Error())
	}
	return httpx.OK(w, struct {
		To        string `json:"to"`
		Provider  string `json:"provider"`
		MessageID string `json:"message_id"`
		LogID     string `json:"log_id"`
	}{to, res.Provider, res.MessageID, res.ID})
}

// emailLogRow is one platform.mail_log entry for the dashboard.
type emailLogRow struct {
	ID            string        `json:"id"`
	Kind          string        `json:"kind"`
	To            string        `json:"to"`
	From          string        `json:"from"`
	Subject       string        `json:"subject"`
	Provider      string        `json:"provider"`
	Status        string        `json:"status"`
	Attempts      int           `json:"attempts"`
	MaxAttempts   int           `json:"max_attempts"`
	NextAttemptAt *httpx.JSTime `json:"next_attempt_at"`
	Error         *string       `json:"error"`
	MessageID     *string       `json:"message_id"`
	SentAt        *httpx.JSTime `json:"sent_at"`
	CreatedAt     *httpx.JSTime `json:"created_at"`
}

func toEmailLogRow(e mail.Entry) emailLogRow {
	created := e.CreatedAt
	return emailLogRow{
		ID: e.ID, Kind: e.Kind, To: e.To, From: e.From, Subject: e.Subject, Provider: e.Provider, Status: e.Status,
		Attempts: e.Attempts, MaxAttempts: e.MaxAttempts, NextAttemptAt: httpx.NewJSTime(e.NextAttemptAt), Error: e.Error,
		MessageID: e.MessageID, SentAt: httpx.NewJSTime(e.SentAt), CreatedAt: httpx.NewJSTime(&created),
	}
}

// GET /api/settings/email/log?status=&q=&limit=
func (h *Handler) listEmailLog(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	if h.ports.Mail == nil {
		return httpx.Status(http.StatusServiceUnavailable, "Mailer belum terpasang")
	}
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	entries, summary, err := h.ports.Mail.List(r.Context(), mail.Filter{Status: q.Get("status"), Search: q.Get("q"), Limit: limit})
	if err != nil {
		return err
	}
	rows := make([]emailLogRow, len(entries))
	for i, e := range entries {
		rows[i] = toEmailLogRow(e)
	}
	return httpx.OK(w, struct {
		Entries []emailLogRow   `json:"entries"`
		Summary emailLogSummary `json:"summary"`
	}{rows, emailLogSummary{summary.Sent, summary.Queued, summary.Failed}})
}

type emailLogSummary struct {
	Sent   int `json:"sent"`
	Queued int `json:"queued"`
	Failed int `json:"failed"`
}

// POST /api/settings/email/log/{id}/resend
func (h *Handler) resendEmail(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	if h.ports.Mail == nil {
		return httpx.Status(http.StatusServiceUnavailable, "Mailer belum terpasang")
	}
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	res, err := h.ports.Mail.Resend(r.Context(), id)
	switch {
	case errors.Is(err, mail.ErrNotResendable):
		return httpx.Conflict(err.Error())
	case err != nil:
		return err
	case res.ID == "":
		return httpx.NotFound("Email tidak ditemukan")
	case res.Err != nil:
		return httpx.Status(http.StatusBadGateway, res.Err.Error())
	}
	return httpx.OK(w, struct {
		Status    string `json:"status"`
		MessageID string `json:"message_id"`
	}{res.Status, res.MessageID})
}
