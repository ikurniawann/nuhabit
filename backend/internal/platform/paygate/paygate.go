// Package paygate is the payment gateway port: one interface for creating
// a QRIS, a hosted checkout page, reading a payment's status and canceling
// it, with an adapter per provider (Xendit, Midtrans). The active provider
// and its keys come from configuration.payment_gateways (Settings →
// Payment Gateways); Router picks the adapter for that row.
package paygate

import (
	"context"
	"errors"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// Provider is a payment_gateways.provider value.
type Provider string

const (
	Xendit   Provider = "xendit"
	Midtrans Provider = "midtrans"
)

// Config is the active gateway row. SecretKey is Xendit's secret key or
// Midtrans' server key; PublicKey is Midtrans' client key (unused by
// Xendit). WebhookSecret is Xendit's callback token; Midtrans signs its
// notifications with the server key instead.
type Config struct {
	Provider      Provider
	Environment   string // sandbox | live
	SecretKey     string
	PublicKey     string
	WebhookSecret string
	CallbackURL   string
	MerchantID    string
}

// Live reports the production environment.
func (c *Config) Live() bool { return c != nil && c.Environment == "live" }

// QRRequest creates a dynamic QRIS for one payment.
type QRRequest struct {
	// ReferenceID is our payment reference (Xendit reference_id, Midtrans
	// order_id). It must be unique per gateway.
	ReferenceID string
	Amount      float64
	Description string
	// CallbackURL is the webhook Xendit should call; Midtrans takes the
	// notification URL from its dashboard and ignores it.
	CallbackURL string
	// Expiry bounds how long the QR can be paid (0 = the gateway default).
	Expiry time.Duration
}

// QR is a created dynamic QRIS.
type QR struct {
	// ID is the gateway's id of the QR (Xendit qr id, Midtrans transaction_id).
	ID       string
	QRString string
	// ImageURL is a rendered PNG of the QR when the gateway serves one.
	ImageURL string
	// ExpiresAt is RFC 3339, "" when the gateway sent none.
	ExpiresAt string
}

// HostedRequest creates a hosted checkout page (Xendit invoice, Midtrans Snap).
type HostedRequest struct {
	ReferenceID string
	Amount      float64
	Description string
	PayerName   string
	PayerEmail  string
	PayerPhone  string
	// RedirectURL is where the payer lands after paying.
	RedirectURL string
	Expiry      time.Duration
}

// Hosted is a created checkout page. Mock is set by a dev-only mock mode:
// the URL is the redirect URL itself and Status reports it paid.
type Hosted struct {
	ID        string
	URL       string
	ExpiresAt time.Time
	Mock      bool
}

// Ref names a payment to look up or cancel: the reference it was created
// with plus the id the gateway gave the QR or the hosted page.
type Ref struct {
	ReferenceID string
	QRID        string
	HostedID    string
}

// State is a payment's state as the port reports it.
type State string

const (
	StatePending  State = "pending"
	StatePaid     State = "paid"
	StateExpired  State = "expired"
	StateCanceled State = "canceled"
	StateFailed   State = "failed"
	StateRefunded State = "refunded"
)

// Closed reports a state the payer can no longer pay from: the payment
// never happened. A refund is money going back after a payment and is
// recorded by hand, so it is not closed.
func (s State) Closed() bool {
	return s == StateExpired || s == StateCanceled || s == StateFailed
}

// Status is a payment's current state.
type Status struct {
	State State
	// PaymentID is the gateway's id of the payment that settled it.
	PaymentID string
	// Raw is the gateway's status word (Xendit SUCCEEDED, Midtrans settlement).
	Raw string
	// Amount is the paid amount when the gateway reports it (0 otherwise).
	Amount float64
}

// ErrQRUnavailable is returned by CreateQR when the merchant account has no
// QRIS channel; the caller falls back to a hosted page.
var ErrQRUnavailable = errors.New("QRIS belum aktif di akun gateway")

// ErrNotCancelable is returned by Cancel when the payment already settled or
// closed at the gateway; the caller re-reads its status.
var ErrNotCancelable = errors.New("pembayaran tidak bisa dibatalkan lagi")

// Adapter is one provider's client. cfg is the active row of that provider.
type Adapter interface {
	Provider() Provider
	// HostedProblem is "" when a hosted page can be created, else the
	// user-facing reason it cannot.
	HostedProblem(cfg *Config) string
	CreateQR(ctx context.Context, cfg *Config, req QRRequest) (*QR, error)
	CreateHosted(ctx context.Context, cfg *Config, req HostedRequest) (*Hosted, error)
	Status(ctx context.Context, cfg *Config, ref Ref) (*Status, error)
	// Cancel closes a pending payment at the gateway; ErrNotCancelable when
	// it already settled or closed.
	Cancel(ctx context.Context, cfg *Config, ref Ref) error
}

// Gateway resolves a provider's adapter and configuration.
type Gateway interface {
	// Resolve loads the active row and its adapter. Without an active row
	// cfg is nil and err says why (user-facing); the adapter then defaults
	// to Xendit, whose hosted invoices run on environment keys.
	Resolve(ctx context.Context, q database.Querier) (Adapter, *Config, error)
	// Lookup loads one provider's row, active or not, with its adapter: a
	// payment created under a gateway is reconciled there even after the
	// active gateway changed. cfg is nil (with err) when the row has no key.
	Lookup(ctx context.Context, q database.Querier, provider Provider) (Adapter, *Config, error)
}

// Router is the Gateway over the registered adapters.
type Router struct {
	adapters map[Provider]Adapter
}

// NewRouter registers the adapters.
func NewRouter(adapters ...Adapter) *Router {
	r := &Router{adapters: map[Provider]Adapter{}}
	for _, a := range adapters {
		r.adapters[a.Provider()] = a
	}
	return r
}

func (r *Router) adapter(provider Provider) (Adapter, error) {
	adapter, ok := r.adapters[provider]
	if !ok {
		return nil, errors.New("Payment gateway " + string(provider) + " belum didukung")
	}
	return adapter, nil
}

// Resolve implements Gateway.
func (r *Router) Resolve(ctx context.Context, q database.Querier) (Adapter, *Config, error) {
	cfg, err := LoadActive(ctx, q)
	provider := Xendit
	if cfg != nil {
		provider = cfg.Provider
	}
	adapter, adapterErr := r.adapter(provider)
	if adapterErr != nil {
		return nil, nil, adapterErr
	}
	return adapter, cfg, err
}

// Lookup implements Gateway.
func (r *Router) Lookup(ctx context.Context, q database.Querier, provider Provider) (Adapter, *Config, error) {
	adapter, err := r.adapter(provider)
	if err != nil {
		return nil, nil, err
	}
	cfg, err := Load(ctx, q, provider)
	return adapter, cfg, err
}

// Capabilities is what the active gateway offers the member app.
type Capabilities struct {
	Provider Provider `json:"provider"`
	// Active is false when no gateway row is active.
	Active bool `json:"active"`
	// SavedMethods: cards and e-wallets saved for auto-renew (Xendit only).
	SavedMethods bool `json:"saved_methods"`
}

// Caps describes the active gateway; savedMethods is whether the Xendit
// saved-method rail is switched on.
func Caps(cfg *Config, savedMethods bool) Capabilities {
	if cfg == nil {
		return Capabilities{Provider: Xendit}
	}
	return Capabilities{Provider: cfg.Provider, Active: true, SavedMethods: savedMethods && cfg.Provider == Xendit}
}

// Messages of LoadActive, shared with the modules that still read the
// Xendit row themselves.
const (
	MsgNotConfigured = "QRIS payment gateway is not configured. Set it in Settings → Payment Gateways."
	MsgInactive      = "QRIS payment gateway is inactive. Enable it in Settings → Payment Gateways."
	MsgNoSecret      = "Payment gateway secret key is missing."
)

const gatewayColumns = `provider, environment, is_active, secret_key, public_key, webhook_secret, callback_url, metadata->>'merchant_id'`

// gatewayRow is one payment_gateways row; cfg is nil when it has no key.
type gatewayRow struct {
	active bool
	keyed  bool
	cfg    *Config
}

func scanGateway(rows interface{ Scan(...any) error }) (gatewayRow, error) {
	var provider, environment string
	var active bool
	var secret, public, webhook, callback, merchant *string
	if err := rows.Scan(&provider, &environment, &active, &secret, &public, &webhook, &callback, &merchant); err != nil {
		return gatewayRow{}, err
	}
	row := gatewayRow{active: active, keyed: trim(secret) != ""}
	if row.keyed {
		row.cfg = &Config{
			Provider: Provider(provider), Environment: "sandbox", SecretKey: trim(secret), PublicKey: trim(public),
			WebhookSecret: trim(webhook), CallbackURL: trim(callback), MerchantID: trim(merchant),
		}
		if environment == "live" {
			row.cfg.Environment = "live"
		}
	}
	return row, nil
}

// LoadActive reads the active gateway. Settings keep at most one row
// active; the most recently updated wins if two are. No active row: an
// inactive row with a key means "inactive", none means "not configured".
func LoadActive(ctx context.Context, q database.Querier) (*Config, error) {
	rows, err := q.Query(ctx, `SELECT `+gatewayColumns+` FROM configuration.payment_gateways ORDER BY is_active DESC, updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keyed := false
	for rows.Next() {
		row, err := scanGateway(rows)
		if err != nil {
			return nil, err
		}
		if !row.active {
			keyed = keyed || row.keyed
			continue
		}
		if row.cfg == nil {
			return nil, errors.New(MsgNoSecret)
		}
		return row.cfg, nil
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if keyed {
		return nil, errors.New(MsgInactive)
	}
	return nil, errors.New(MsgNotConfigured)
}

// Load reads one provider's row whether or not it is active; a missing row
// or key is an error.
func Load(ctx context.Context, q database.Querier, provider Provider) (*Config, error) {
	row, err := scanGateway(q.QueryRow(ctx, `SELECT `+gatewayColumns+` FROM configuration.payment_gateways WHERE provider = $1`, string(provider)))
	if database.IsNoRows(err) {
		return nil, errors.New(MsgNotConfigured)
	}
	if err != nil {
		return nil, err
	}
	if row.cfg == nil {
		return nil, errors.New(MsgNoSecret)
	}
	return row.cfg, nil
}

func trim(s *string) string {
	if s == nil {
		return ""
	}
	return strings.TrimSpace(*s)
}
