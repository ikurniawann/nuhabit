// Package webhooks ports the inbound webhooks: the Xendit QRIS payment
// callback, the self-hosted WhatsApp gateway's messages, the Telegram order
// alert bot and the loyalty partners' events. Each authenticates its caller
// (constant-time token or HMAC compare) before touching any data.
package webhooks

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Pending is a pending record a QR payment settles: its id and expected
// amount as PostgreSQL text.
type Pending struct {
	ID     string
	Amount string
}

// Payments reads the pending records other contexts own and settles a gym
// credit purchase (its result is the webhook's response).
type Payments interface {
	IsGymPurchaseReference(referenceID string) bool
	// GymPurchase is the gym.credit_purchases row of a reference (nil = none).
	GymPurchase(ctx context.Context, q database.Querier, referenceID string) (*Pending, error)
	// SettleGymPurchase is settleGymPurchaseByReference: its JSON result.
	SettleGymPurchase(ctx context.Context, db database.DB, referenceID string, paymentID *string) (any, error)
	// Topup is the pending ARK Coin top-up whose column (xendit_transaction_id
	// or reference_id) equals value; nil when none or ambiguous.
	Topup(ctx context.Context, q database.Querier, column, value string) (*Pending, error)
	// Checkout is the central checkout of a Xendit reference.
	Checkout(ctx context.Context, q database.Querier, referenceID string) (*Pending, error)
	// CheckoutChildren counts the orders a checkout already created.
	CheckoutChildren(ctx context.Context, q database.Querier, checkoutID string) (int, error)
	// Order is the standalone open-bill order of a Xendit reference.
	Order(ctx context.Context, q database.Querier, referenceID string) (*Pending, error)
}

// Inbox is the CRM inbox: record a gateway message on its conversation,
// apply the CS rules to an inbound one, send the auto-reply.
type Inbox interface {
	Record(ctx context.Context, db database.DB, m domain.GatewayInbound) (stored bool, conversationID string, err error)
	// OnInbound returns the auto-reply text to send (nil = none).
	OnInbound(ctx context.Context, db database.DB, conversationID string, body *string, at time.Time) (*string, error)
	// AutoReply sends text as a "system" message logged on the conversation.
	AutoReply(ctx context.Context, db database.DB, phone, conversationID, text string)
}

// Partner is a crm.crm_integration_partners row.
type Partner struct {
	ID            string
	IsActive      bool
	SigningSecret string
}

// PartnerEvent is ingestPartnerEvent's input.
type PartnerEvent struct {
	ExternalID string
	EventType  string
	Subject    *string
	OccurredAt *string
	// Payload is the event's JSON object.
	Payload []byte
}

// PartnerEventResult is the stored event and whether it was a resend.
type PartnerEventResult struct {
	ID        string
	Status    string
	XPAwarded int
	Duplicate bool
}

// Partners is the CRM loyalty partners area.
type Partners interface {
	// FindByCode is findPartnerByCode (code trimmed and upper-cased).
	FindByCode(ctx context.Context, q database.Querier, code string) (*Partner, error)
	// Ingest is ingestPartnerEvent: store the event once per external id,
	// match the member and award XP.
	Ingest(ctx context.Context, db database.DB, p Partner, e PartnerEvent) (PartnerEventResult, error)
}

// Ports are the other contexts the webhooks reach.
type Ports struct {
	Payments Payments
	Inbox    Inbox
	Partners Partners
}

// Handler serves the webhook routes.
type Handler struct {
	db       database.DB
	ports    Ports
	log      *slog.Logger
	now      func() time.Time
	getenv   func(string) string
	telegram string // Telegram Bot API base URL

	// authFailures are the recent wrong wa/inbound tokens (anti brute
	// force, per process like the TS module state).
	mu           sync.Mutex
	authFailures []time.Time
}

// New builds the handler on the pool.
func New(deps module.Deps, p Ports) *Handler {
	return NewHandler(deps.DB, p, deps.Now, deps.Log, os.Getenv, "https://api.telegram.org")
}

// NewHandler builds the handler on any pool or transaction with an
// injectable environment and Telegram API base.
func NewHandler(db database.DB, p Ports, now func() time.Time, log *slog.Logger, getenv func(string) string, telegramAPI string) *Handler {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Handler{db: db, ports: p, log: log, now: now, getenv: getenv, telegram: telegramAPI}
}

// Routes lists the webhook routes. They are public (auth.PublicAuthPrefixes)
// and authenticate the caller themselves.
func (h *Handler) Routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/payments/xendit/webhook", Handler: http.HandlerFunc(h.xenditProbe)},
		{Pattern: "POST /api/payments/xendit/webhook", Handler: http.HandlerFunc(h.xenditWebhook)},
		{Pattern: "POST /api/wa/inbound", Handler: http.HandlerFunc(h.waInbound)},
		{Pattern: "POST /api/integrations/telegram/webhook/{secret}", Handler: http.HandlerFunc(h.telegramWebhook)},
		{Pattern: "POST /api/integrations/loyalty-events/{partner}", Handler: http.HandlerFunc(h.loyaltyEvent)},
	}
}

// readBody reads the raw body up to limit+1 bytes.
func readBody(r *http.Request, limit int64) ([]byte, error) {
	if r.Body == nil {
		return nil, nil
	}
	return io.ReadAll(io.LimitReader(r.Body, limit+1))
}

func (h *Handler) brandName() string { return domain.BrandName(h.getenv("NEXT_PUBLIC_APP_NAME")) }
