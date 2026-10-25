package mail

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"nuhabit/backend/internal/platform/database"
)

// Provider names (Config.Provider and the log's provider column).
const (
	ProviderResend    = "resend"
	ProviderMicrosoft = "microsoft"
	// Log labels of the two Microsoft transports.
	ProviderGraph = "microsoft-graph"
	ProviderSMTP  = "microsoft-smtp"
)

// Microsoft transports.
const (
	TransportGraph = "graph"
	TransportSMTP  = "smtp"
)

// Config is the mailer configuration after settings and env are merged.
type Config struct {
	// Provider is resend, microsoft or "" (pick whichever has credentials).
	Provider  string
	FromEmail string
	FromName  string

	ResendAPIKey string

	// Transport is graph (default) or smtp for the Microsoft provider.
	Transport string
	// Graph: the Entra app registration and the mailbox to send as.
	TenantID     string
	ClientID     string
	ClientSecret string
	Sender       string
	// SMTP AUTH client submission.
	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
}

// Setting maps one Config field to its configuration.app_settings key and
// its env fallback.
type Setting struct {
	Key string
	Env string
	Set func(c *Config, v string)
}

// Settings lists every stored key, in form order. The settings page saves
// these keys; Load reads them with the env fallbacks.
var Settings = []Setting{
	{"mail_provider", "MAIL_PROVIDER", func(c *Config, v string) { c.Provider = strings.ToLower(v) }},
	{"mail_from_email", "FROM_EMAIL", func(c *Config, v string) { c.FromEmail = v }},
	{"mail_from_name", "MAIL_FROM_NAME", func(c *Config, v string) { c.FromName = v }},
	{"mail_resend_api_key", "RESEND_API_KEY", func(c *Config, v string) { c.ResendAPIKey = v }},
	{"mail_ms_transport", "MAIL_MS_TRANSPORT", func(c *Config, v string) { c.Transport = strings.ToLower(v) }},
	{"mail_ms_tenant_id", "MS_GRAPH_TENANT_ID", func(c *Config, v string) { c.TenantID = v }},
	{"mail_ms_client_id", "MS_GRAPH_CLIENT_ID", func(c *Config, v string) { c.ClientID = v }},
	{"mail_ms_client_secret", "MS_GRAPH_CLIENT_SECRET", func(c *Config, v string) { c.ClientSecret = v }},
	{"mail_ms_sender", "MS_GRAPH_SENDER", func(c *Config, v string) { c.Sender = v }},
	{"mail_smtp_host", "SMTP_HOST", func(c *Config, v string) { c.SMTPHost = v }},
	{"mail_smtp_port", "SMTP_PORT", func(c *Config, v string) { c.SMTPPort, _ = strconv.Atoi(v) }},
	{"mail_smtp_user", "SMTP_USER", func(c *Config, v string) { c.SMTPUser = v }},
	{"mail_smtp_password", "SMTP_PASSWORD", func(c *Config, v string) { c.SMTPPassword = v }},
}

// SecretKeys are the settings the API never returns in clear.
var SecretKeys = map[string]bool{"mail_resend_api_key": true, "mail_ms_client_secret": true, "mail_smtp_password": true}

// SettingKeys lists the configuration.app_settings keys.
func SettingKeys() []string {
	keys := make([]string, len(Settings))
	for i, s := range Settings {
		keys[i] = s.Key
	}
	return keys
}

// Load reads the stored settings and fills the gaps from env. Values are
// trimmed; an empty stored value falls back to env.
func Load(ctx context.Context, q database.Querier, getenv func(string) string) (Config, error) {
	stored := map[string]string{}
	rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`, SettingKeys())
	if err != nil {
		return Config{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var value *string
		if err := rows.Scan(&key, &value); err != nil {
			return Config{}, err
		}
		if value != nil {
			stored[key] = strings.TrimSpace(*value)
		}
	}
	if err := rows.Err(); err != nil {
		return Config{}, err
	}
	return merge(stored, getenv), nil
}

// FromEnv is the configuration without a database (tests, tooling).
func FromEnv(getenv func(string) string) Config { return merge(nil, getenv) }

func merge(stored map[string]string, getenv func(string) string) Config {
	var c Config
	for _, s := range Settings {
		v := stored[s.Key]
		if v == "" && getenv != nil {
			v = strings.TrimSpace(getenv(s.Env))
		}
		s.Set(&c, v)
	}
	return c
}

// ErrNotConfigured is returned when no provider has credentials.
var ErrNotConfigured = errors.New("email belum dikonfigurasi: isi Settings → Integrasi → Email")

// GraphReady reports whether the Graph credentials are complete.
func (c Config) GraphReady() bool {
	return c.TenantID != "" && c.ClientID != "" && c.ClientSecret != "" && c.Mailbox() != ""
}

// SMTPReady reports whether the SMTP credentials are complete.
func (c Config) SMTPReady() bool {
	return c.SMTPHost != "" && c.SMTPUser != "" && c.SMTPPassword != ""
}

// Mailbox is the Microsoft 365 mailbox messages go out from: the explicit
// sender, else the from address, else the SMTP user.
func (c Config) Mailbox() string {
	for _, v := range []string{c.Sender, c.FromEmail, c.SMTPUser} {
		if v != "" {
			return v
		}
	}
	return ""
}

// transport is the Microsoft transport in use: the explicit one, else Graph
// when its credentials are complete, else SMTP.
func (c Config) transport() string {
	switch {
	case c.Transport == TransportSMTP, c.Transport == TransportGraph:
		return c.Transport
	case c.GraphReady():
		return TransportGraph
	case c.SMTPReady():
		return TransportSMTP
	}
	return TransportGraph
}

// Resolved is the provider label that will send (resend, microsoft-graph,
// microsoft-smtp) or "" when nothing is configured.
func (c Config) Resolved() string {
	microsoft := func() string {
		switch c.transport() {
		case TransportSMTP:
			if c.SMTPReady() {
				return ProviderSMTP
			}
		default:
			if c.GraphReady() {
				return ProviderGraph
			}
		}
		return ""
	}
	switch c.Provider {
	case ProviderResend:
		if c.ResendAPIKey != "" {
			return ProviderResend
		}
		return ""
	case ProviderMicrosoft:
		return microsoft()
	}
	if p := microsoft(); p != "" {
		return p
	}
	if c.ResendAPIKey != "" {
		return ProviderResend
	}
	return ""
}

// Configured reports whether a send can go out: a provider with credentials
// and a sender address.
func (c Config) Configured() bool { return c.Resolved() != "" && c.SenderAddress() != "" }

// SenderAddress is the default From: the from address, else the Microsoft
// mailbox.
func (c Config) SenderAddress() string {
	if c.FromEmail != "" {
		return c.FromEmail
	}
	if c.Resolved() != ProviderResend {
		return c.Mailbox()
	}
	return ""
}
