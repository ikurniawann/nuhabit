// Package settings ports the integration settings pages: AI providers
// (settings/integrations), Google Business Profile, Instagram Messaging,
// payment gateways, the WhatsApp gateway (status, pairing QR, message log
// and resend) and the owner WhatsApp notifications (config and test send).
// Stored secrets never leave the server: responses carry masked values.
package settings

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// Guard is the auth the routes need (*auth.Service satisfies it).
type Guard interface {
	RequireUser(r *http.Request) (*auth.User, error)
	RequireMenuPrefix(r *http.Request, prefixes ...string) (*auth.User, error)
}

// SendResult is a WhatsApp send's outcome. MessageID nil is undefined.
type SendResult struct {
	Success   bool
	Reason    string
	MessageID *string
}

// MessageLog is crm.wa_messages, the WhatsApp message history the CRM
// inbox owns: the super-admin log page and the manual resend of a failed
// outbound message.
type MessageLog interface {
	List(ctx context.Context, q database.Querier, f MessageFilter) ([]MessageRow, MessageSummary, error)
	// Outbound is one outbound message (nil when missing).
	Outbound(ctx context.Context, q database.Querier, id string) (*OutboundMessage, error)
	// Resend sends body to phone again, logged as a new row on the same
	// conversation (sendWhatsAppText with meta).
	Resend(ctx context.Context, q database.DB, m OutboundMessage, sentByUserID string) SendResult
	// MarkResent flags the failed original so it cannot be resent twice.
	MarkResent(ctx context.Context, q database.Querier, id string) error
}

// FlashReports gathers the Daily Flash Report figures of one WIB date
// (gatherFlashReportData over POS sales).
type FlashReports interface {
	Gather(ctx context.Context, q database.Querier, dateWib string) (domain.FlashReportData, error)
}

// Ports are the other contexts these pages read and write.
type Ports struct {
	Messages MessageLog
	Flash    FlashReports
}

// Handler serves the settings routes.
type Handler struct {
	db     database.DB
	guard  Guard
	ports  Ports
	log    *slog.Logger
	now    func() time.Time
	getenv func(string) string
}

// New builds the handler on the pool.
func New(deps module.Deps, p Ports) *Handler {
	return NewHandler(deps.DB, deps.Auth, p, deps.Now, deps.Log, os.Getenv)
}

// NewHandler builds the handler on any pool or transaction (tests pass a
// rolled-back one) with an injectable environment.
func NewHandler(db database.DB, guard Guard, p Ports, now func() time.Time, log *slog.Logger, getenv func(string) string) *Handler {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Handler{db: db, guard: guard, ports: p, log: log, now: now, getenv: getenv}
}

// Routes lists the settings routes.
func (h *Handler) Routes() []module.Route {
	r := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	return []module.Route{
		r("GET /api/settings/integrations", h.getProviders),
		r("PUT /api/settings/integrations", h.putProviders),
		r("GET /api/settings/google-business", h.getGoogle),
		r("PUT /api/settings/google-business", h.putGoogle),
		r("DELETE /api/settings/google-business", h.deleteGoogle),
		r("GET /api/settings/instagram", h.getInstagram),
		r("PUT /api/settings/instagram", h.putInstagram),
		r("DELETE /api/settings/instagram", h.deleteInstagram),
		r("GET /api/settings/payment-gateways", h.listGateways),
		r("PUT /api/settings/payment-gateways", h.putGateway),
		r("GET /api/settings/wa-gateway", h.getWaGateway),
		r("PATCH /api/settings/wa-gateway", h.patchWaGateway),
		r("GET /api/settings/wa-gateway/messages", h.listMessages),
		r("POST /api/settings/wa-gateway/messages", h.resendMessage),
		r("GET /api/settings/wa-notifications", h.getWaNotif),
		r("PUT /api/settings/wa-notifications", h.putWaNotif),
		r("POST /api/settings/wa-notifications/test", h.testWaNotif),
	}
}

// requireSuperAdmin is requireApiRole(["super_admin"]).
func (h *Handler) requireSuperAdmin(r *http.Request) (*auth.User, error) {
	u, err := h.guard.RequireUser(r)
	if err != nil {
		return nil, err
	}
	if u.Role != "super_admin" {
		return nil, httpx.Forbidden("Insufficient permissions")
	}
	return u, nil
}

// errInvalidJSON is a body request.json() rejects: the TS lets the
// SyntaxError reach apiHandler, which answers 500.
var errInvalidJSON = errors.New("request body is not valid JSON")

// strictBody is `await request.json()`: the decoded body, or errInvalidJSON.
func strictBody(r *http.Request) (any, error) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	v, ok := domain.ParseJSON(raw)
	if !ok {
		return nil, errInvalidJSON
	}
	return v, nil
}

// lenientBody is `await request.json().catch(() => fallback)`.
func lenientBody(r *http.Request) (any, bool) {
	v, err := strictBody(r)
	return v, err == nil
}

func (h *Handler) brandName() string { return domain.BrandName(h.getenv("NEXT_PUBLIC_APP_NAME")) }
