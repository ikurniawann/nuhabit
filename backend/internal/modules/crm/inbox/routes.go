// Package inbox ports the CS inbox: WhatsApp and Instagram conversations
// (list, detail, agent actions and replies), quick-reply templates, AI
// conversation insights, Google reviews (list, reply with approval, sync)
// and the Instagram Messaging webhook. Chat bodies are PII: every route
// except the signed webhook is behind the inbox (or settings) gate.
package inbox

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// SendResult is lib/whatsapp's WhatsAppResult. MessageID nil is undefined.
type SendResult struct {
	Success   bool
	Reason    string
	Provider  string
	MessageID *string
}

// WhatsApp dispatches free text through the configured provider
// (lib/whatsapp dispatchText). The inbox logs the send to crm.wa_messages
// itself.
type WhatsApp interface {
	SendText(ctx context.Context, q database.Querier, target, message string) SendResult
}

// InstagramWebhookConfig is what the webhook needs (app secret, verify token).
type InstagramWebhookConfig struct {
	AppSecret, VerifyToken string
}

// InstagramSend is InstagramSendResult. MessageID nil is null.
type InstagramSend struct {
	Success   bool
	Reason    string
	MessageID *string
}

// Instagram is the Instagram Messaging Graph API (lib/instagram/client).
type Instagram interface {
	// WebhookConfig is nil when the app secret or verify token is missing.
	WebhookConfig(ctx context.Context, q database.Querier) *InstagramWebhookConfig
	SendText(ctx context.Context, q database.Querier, recipientID, message string) InstagramSend
}

// InsightModel runs one chat completion for a conversation analysis and
// returns the answer and the model id stored with the insight.
type InsightModel interface {
	Complete(ctx context.Context, q database.Querier, messages []domain.ChatMessage) (content, model string, err error)
}

// GoogleFetch is fetchReviews' result.
type GoogleFetch struct {
	OK            bool
	Reviews       []json.RawMessage
	Reason        string
	NotConfigured bool
}

// GoogleReply is putReviewReply's result.
type GoogleReply struct {
	OK            bool
	Reason        string
	NotConfigured bool
}

// GoogleBusiness is the Google Business Profile API
// (lib/crm/google-business-client).
type GoogleBusiness interface {
	Status(ctx context.Context, q database.Querier) (configured bool, locationIDs []string)
	FetchReviews(ctx context.Context, q database.Querier) GoogleFetch
	PutReply(ctx context.Context, q database.Querier, reviewName, comment string) GoogleReply
}

// OwnerNotifier is fireOwnerNotification: a deduplicated WhatsApp message
// to the owner, fire-and-forget (it never fails or delays the caller).
type OwnerNotifier interface {
	Fire(notifType, dedupKey, message string)
}

// PosOrders reads a member's recent POS orders for the inbox member panel.
type PosOrders interface {
	RecentOrders(ctx context.Context, q database.Querier, customerID string) ([]*kit.Row, error)
}

// Ports are the capabilities of other bounded contexts this area uses;
// internal/app/adapters_crm_inbox.go provides them.
type Ports struct {
	WhatsApp  WhatsApp
	Instagram Instagram
	AI        InsightModel
	Google    GoogleBusiness
	Notifier  OwnerNotifier
	Orders    PosOrders
}

type handler struct {
	Ports
	db    database.DB
	guard kit.Guard
	log   *slog.Logger
	now   func() time.Time
}

// Routes mounts the area's routes.
func Routes(d module.Deps, _ *xp.Engine, p Ports) []module.Route {
	return newHandler(d.DB, d, p).routes()
}

func newHandler(db database.DB, d module.Deps, p Ports) *handler {
	now := d.Now
	if now == nil {
		now = time.Now
	}
	log := d.Log
	if log == nil {
		log = slog.Default()
	}
	return &handler{Ports: p, db: db, guard: kit.Guard{Auth: d.Auth, DB: db}, log: log, now: now}
}

func (h *handler) routes() []module.Route {
	r := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	return []module.Route{
		r("GET /api/crm/inbox/conversations", h.listConversations),
		r("GET /api/crm/inbox/conversations/{id}", h.conversationDetail),
		r("POST /api/crm/inbox/conversations/{id}", h.conversationAction),
		r("GET /api/crm/inbox/templates", h.listTemplates),
		r("POST /api/crm/inbox/templates", h.saveTemplate),
		r("DELETE /api/crm/inbox/templates", h.deleteTemplate),
		r("GET /api/crm/inbox/analytics", h.storedInsight),
		r("POST /api/crm/inbox/analytics", h.analyze),
		r("GET /api/crm/reviews", h.listReviews),
		r("POST /api/crm/reviews", h.reviewAction),
		r("GET /api/crm/instagram/webhook", h.instagramHandshake),
		r("POST /api/crm/instagram/webhook", h.instagramWebhook),
	}
}
