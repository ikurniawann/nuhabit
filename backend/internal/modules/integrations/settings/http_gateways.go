package settings

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Payment gateways (configuration.payment_gateways): Xendit and Midtrans
// credentials. Secrets come back only masked; an empty or masked value on
// save keeps the stored one.

// gatewayRow is a payment_gateways row.
type gatewayRow struct {
	ID            string
	Provider      string
	DisplayName   string
	IsActive      bool
	Environment   string
	SecretKey     *string
	PublicKey     *string
	WebhookSecret *string
	CallbackURL   *string
	Metadata      json.RawMessage
	UpdatedAt     *time.Time
}

const gatewayColumns = `id::text, provider, display_name, is_active, environment, secret_key, public_key,
  webhook_secret, callback_url, metadata, updated_at`

func scanGateway(row pgx.Row) (*gatewayRow, error) {
	var g gatewayRow
	err := row.Scan(&g.ID, &g.Provider, &g.DisplayName, &g.IsActive, &g.Environment, &g.SecretKey, &g.PublicKey,
		&g.WebhookSecret, &g.CallbackURL, &g.Metadata, &g.UpdatedAt)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &g, err
}

// gatewayPublic is PaymentGatewayPublic.
type gatewayPublic struct {
	ID                  string          `json:"id"`
	Provider            string          `json:"provider"`
	DisplayName         string          `json:"display_name"`
	IsActive            bool            `json:"is_active"`
	Environment         string          `json:"environment"`
	SecretKeyMasked     *string         `json:"secret_key_masked"`
	PublicKeyMasked     *string         `json:"public_key_masked"`
	WebhookSecretMasked *string         `json:"webhook_secret_masked"`
	HasSecretKey        bool            `json:"has_secret_key"`
	HasPublicKey        bool            `json:"has_public_key"`
	HasWebhookSecret    bool            `json:"has_webhook_secret"`
	CallbackURL         *string         `json:"callback_url"`
	Metadata            json.RawMessage `json:"metadata"`
	ComingSoon          bool            `json:"coming_soon"`
	UpdatedAt           *httpx.JSTime   `json:"updated_at"`
}

// metadata is `row.metadata && typeof row.metadata === "object" ? row.metadata : {}`:
// the raw JSON to echo and its fields (empty for an array).
func (g *gatewayRow) metadata() (json.RawMessage, map[string]any) {
	v, _ := domain.ParseJSON(g.Metadata)
	switch x := v.(type) {
	case map[string]any:
		return g.Metadata, x
	case []any:
		return g.Metadata, map[string]any{}
	}
	return json.RawMessage(`{}`), map[string]any{}
}

// public is toPaymentGatewayPublic.
func (g *gatewayRow) public() gatewayPublic {
	raw, meta := g.metadata()
	env := "sandbox"
	if g.Environment == "live" {
		env = "live"
	}
	return gatewayPublic{
		ID: g.ID, Provider: g.Provider, DisplayName: g.DisplayName, IsActive: g.IsActive, Environment: env,
		SecretKeyMasked: domain.MaskGatewaySecret(g.SecretKey), PublicKeyMasked: domain.MaskGatewaySecret(g.PublicKey),
		WebhookSecretMasked: domain.MaskGatewaySecret(g.WebhookSecret),
		HasSecretKey:        domain.HasGatewaySecret(g.SecretKey), HasPublicKey: domain.HasGatewaySecret(g.PublicKey),
		HasWebhookSecret: domain.HasGatewaySecret(g.WebhookSecret), CallbackURL: g.CallbackURL,
		Metadata: raw, ComingSoon: domain.Truthy(meta["coming_soon"]), UpdatedAt: httpx.NewJSTime(g.UpdatedAt),
	}
}

// GET /api/settings/payment-gateways
func (h *Handler) listGateways(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.SettingsPaymentGateways...); err != nil {
		return err
	}
	rows, err := h.db.Query(r.Context(), `SELECT `+gatewayColumns+` FROM configuration.payment_gateways ORDER BY display_name ASC`)
	if err != nil {
		return err
	}
	out := []gatewayPublic{}
	for rows.Next() {
		g, err := scanGateway(rows)
		if err != nil {
			rows.Close()
			return err
		}
		out = append(out, g.public())
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, out)
}

// gatewayUpdate is PaymentGatewayUpdate after validation.
type gatewayUpdate struct {
	provider, environment         string
	displayName                   *string
	isActive                      bool
	secretKey, publicKey, webhook *string
	callbackURL                   *string
}

// PUT /api/settings/payment-gateways
func (h *Handler) putGateway(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.RequireMenuPrefix(r, iam.SettingsPaymentGateways...)
	if err != nil {
		return err
	}
	raw, err := strictBody(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	var in gatewayUpdate
	if p := f.Enum("provider", validate.Rule{}, []string{"xendit", "midtrans"}); p != nil {
		in.provider = *p
	}
	in.displayName = f.Str("display_name", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Min: 1, Max: 120})
	if b := f.Bool("is_active", validate.Rule{}); b != nil {
		in.isActive = *b
	}
	if e := f.Enum("environment", validate.Rule{}, []string{"sandbox", "live"}); e != nil {
		in.environment = *e
	}
	opt := validate.Rule{Optional: true, Nullable: true}
	in.secretKey = f.Str("secret_key", opt, validate.StrOpts{})
	in.publicKey = f.Str("public_key", opt, validate.StrOpts{})
	in.webhook = f.Str("webhook_secret", opt, validate.StrOpts{})
	in.callbackURL = f.Str("callback_url", opt, validate.StrOpts{Trim: true, Max: 500})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	var out gatewayPublic
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		current, err := scanGateway(tx.QueryRow(r.Context(), `SELECT `+gatewayColumns+` FROM configuration.payment_gateways WHERE provider = $1`, in.provider))
		if err != nil {
			return err
		}
		if current == nil {
			return httpx.NotFound("Provider " + in.provider + " belum terdaftar")
		}
		updated, err := updateGateway(r.Context(), tx, current, in, user.ID, h.now())
		if err != nil {
			return err
		}
		out = updated.public()
		return nil
	})
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusOK, out, "Payment gateway settings saved")
}

// updateGateway is buildPaymentGatewayPatch + the update: a coming-soon
// gateway cannot be activated, an active one needs a secret key (new or
// stored).
func updateGateway(ctx context.Context, q database.Querier, current *gatewayRow, in gatewayUpdate, userID string, now time.Time) (*gatewayRow, error) {
	if _, meta := current.metadata(); domain.Truthy(meta["coming_soon"]) && in.isActive {
		return nil, httpx.BadRequest(current.DisplayName + " belum tersedia (coming soon)")
	}
	secret := func(v *string) *string {
		if domain.KeepExistingSecret(v) {
			return nil
		}
		t := validate.JSTrim(*v)
		return &t
	}
	secretKey, publicKey, webhook := secret(in.secretKey), secret(in.publicKey), secret(in.webhook)
	if in.isActive && secretKey == nil && (current.SecretKey == nil || *current.SecretKey == "") {
		return nil, httpx.BadRequest("Secret key wajib diisi sebelum mengaktifkan gateway")
	}
	var callback *string
	if in.callbackURL != nil && *in.callbackURL != "" {
		callback = in.callbackURL
	}
	var displayName *string
	if in.displayName != nil && *in.displayName != "" {
		displayName = in.displayName
	}
	return scanGateway(q.QueryRow(ctx, `UPDATE configuration.payment_gateways
		SET is_active = $2, environment = $3, callback_url = $4, updated_by = $5, updated_at = $6,
		    display_name = COALESCE($7, display_name),
		    secret_key = CASE WHEN $8::boolean THEN $9 ELSE secret_key END,
		    public_key = CASE WHEN $10::boolean THEN $11 ELSE public_key END,
		    webhook_secret = CASE WHEN $12::boolean THEN $13 ELSE webhook_secret END
		WHERE provider = $1
		RETURNING `+gatewayColumns,
		in.provider, in.isActive, in.environment, callback, userID, now,
		displayName, secretKey != nil, secretKey, publicKey != nil, publicKey, webhook != nil, webhook))
}
