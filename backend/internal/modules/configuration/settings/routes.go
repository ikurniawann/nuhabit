// Package settings is the dashboard settings area kept in
// configuration.app_settings and the configuration business tables:
// company profile, sales target, static QRIS, AI voice (TTS), company
// appearance, the business tree, receipt header/footer and order alerts
// (frontend/src/app/api/settings/*). The static QRIS image goes to the
// shared storage (static_qris_upload.go).
package settings

import (
	"context"
	"errors"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/modules/configuration/settings/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Ports are the capabilities of other bounded contexts this area uses.
type Ports struct {
	// Receipts is pos.pos_receipt_settings, owned by pos-ops.
	Receipts ReceiptStore
	// Staff resolves WhatsApp recipients from hris.employees.
	Staff StaffDirectory
	// WhatsApp sends through the self-hosted gateway; nil builds one from
	// the process environment.
	WhatsApp *whatsapp.Client
	// Endpoints are the outbound API roots; zero values use production.
	Endpoints Endpoints
}

// ReceiptStore reads and writes receipt settings rows on the caller's
// querier.
type ReceiptStore interface {
	// ActiveRows is every is_active row; an empty list when the table does
	// not exist yet (loadPosReceiptSettingsRows).
	ActiveRows(ctx context.Context, q database.Querier) ([]domain.ReceiptRow, error)
	// Update rewrites the lines and stall-name flag of row id.
	Update(ctx context.Context, q database.Querier, id string, in domain.ReceiptScope, at time.Time) error
	// Insert adds an active row for the scope; id is nil for a generated one.
	Insert(ctx context.Context, q database.Querier, id *string, in domain.ReceiptScope, at time.Time) error
}

// StaffDirectory reads employees for order alerts.
type StaffDirectory interface {
	// WaRecipients is loadWaRecipients' query: one row per active employee
	// whose user is active and holds one of roles (IAM role code or
	// configuration.users.role). Phone is the raw stored value.
	WaRecipients(ctx context.Context, q database.Querier, roles []string) ([]WaRecipient, error)
}

// WaRecipient is one WaRecipients row.
type WaRecipient struct {
	Name  string
	Phone *string
	Role  string
}

// Endpoints are the outbound API roots, overridable in tests.
type Endpoints struct {
	Telegram   string                     // https://api.telegram.org
	ElevenLabs string                     // https://api.elevenlabs.io
	Azure      func(region string) string // https://{region}.tts.speech.microsoft.com
}

func (e Endpoints) withDefaults() Endpoints {
	if e.Telegram == "" {
		e.Telegram = "https://api.telegram.org"
	}
	if e.ElevenLabs == "" {
		e.ElevenLabs = "https://api.elevenlabs.io"
	}
	if e.Azure == nil {
		e.Azure = func(region string) string { return "https://" + region + ".tts.speech.microsoft.com" }
	}
	return e
}

type handler struct {
	d        module.Deps
	db       database.DB
	settings kit.AppSettings
	receipts ReceiptStore
	staff    StaffDirectory
	wa       *whatsapp.Client
	urls     Endpoints
}

// Routes mounts this area.
func Routes(d module.Deps, db database.DB, p Ports) []module.Route {
	h := &handler{d: d, db: db, receipts: p.Receipts, staff: p.Staff, wa: p.WhatsApp, urls: p.Endpoints.withDefaults()}
	if h.wa == nil {
		h.wa = whatsapp.New(d.Log)
	}
	route := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	return []module.Route{
		route("GET /api/settings/company-profile", h.getCompanyProfile),
		route("PUT /api/settings/company-profile", h.putCompanyProfile),
		route("GET /api/settings/sales-target", h.getSalesTarget),
		route("PUT /api/settings/sales-target", h.putSalesTarget),
		route("GET /api/settings/static-qris", h.getStaticQris),
		route("PUT /api/settings/static-qris", h.putStaticQris),
		route("POST /api/settings/static-qris", h.postStaticQris),
		route("DELETE /api/settings/static-qris", h.deleteStaticQris),
		route("GET /api/settings/tts", h.getTts),
		route("PUT /api/settings/tts", h.putTts),
		route("POST /api/settings/tts/preview", h.previewTts),
		route("GET /api/settings/appearance", h.getAppearance),
		route("PUT /api/settings/appearance", h.putAppearance),
		route("GET /api/settings/business", h.getBusiness),
		route("POST /api/settings/business", h.createBusiness),
		route("PATCH /api/settings/business/{type}/{id}", h.updateBusiness),
		route("DELETE /api/settings/business/{type}/{id}", h.deleteBusiness),
		route("GET /api/settings/business/branch/{id}/profile", h.getBranchProfile),
		route("PUT /api/settings/business/branch/{id}/profile", h.putBranchProfile),
		route("GET /api/settings/receipt", h.getReceipt),
		route("PUT /api/settings/receipt", h.putReceipt),
		route("GET /api/settings/order-alerts", h.getOrderAlerts),
		route("PUT /api/settings/order-alerts", h.putOrderAlerts),
		route("POST /api/settings/order-alerts", h.postOrderAlerts),
	}
}

/* ── shared helpers ──────────────────────────────────────────────────── */

// errNullBody is the TypeError a route throws when it reads a property of
// a JSON null body: `request.json().catch(() => ({}))` only replaces a
// malformed body. apiHandler renders it as a 500.
var errNullBody = errors.New("settings: request body is JSON null")

// bodyObject mirrors `(await request.json().catch(() => ({}))) as Record`
// followed by property reads: a JSON null body fails like the TS does.
func bodyObject(r *http.Request) (map[string]any, error) {
	v, ok := validate.ReadBody(r)
	if ok && v == nil {
		return nil, errNullBody
	}
	obj, _ := v.(map[string]any)
	if obj == nil {
		obj = map[string]any{}
	}
	return obj, nil
}

// userFacing is rethrowUserFacing (lib/settings/route-errors.ts): an error
// whose message matches pattern becomes a 400 with that message. A
// PostgreSQL error matches on its primary message, as node-postgres's
// error.message is.
func userFacing(err error, pattern *regexp.Regexp) error {
	var he *httpx.Error
	if err == nil || errors.As(err, &he) {
		return err
	}
	msg := err.Error()
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		msg = pe.Message
	}
	if pattern.MatchString(msg) {
		return httpx.BadRequest(msg)
	}
	return err
}

// brandName is brandName() (lib/branding.ts).
func brandName() string {
	if name := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_NAME")); name != "" {
		return name
	}
	return "NüHabit"
}

// appOrigin is appOrigin(request) (lib/app-origin.ts). Behind the Next
// proxy the Go request host is the backend's, so the forwarded host and
// protocol win over r.Host when the proxy sets them.
func appOrigin(r *http.Request) string {
	origin := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL"))
	if origin == "" {
		origin = strings.TrimSpace(os.Getenv("NEXT_PUBLIC_BASE_URL"))
	}
	if origin == "" && r != nil {
		host := firstHeader(r, "X-Forwarded-Host")
		if host == "" {
			host = r.Host
		}
		proto := firstHeader(r, "X-Forwarded-Proto")
		if proto == "" {
			proto = "http"
			if r.TLS != nil {
				proto = "https"
			}
		}
		origin = proto + "://" + host
	}
	return strings.TrimRight(origin, "/")
}

// firstHeader is the first comma-separated value of a forwarding header.
func firstHeader(r *http.Request, name string) string {
	v, _, _ := strings.Cut(r.Header.Get(name), ",")
	return strings.TrimSpace(v)
}

// dataBody is NextResponse.json({ data }).
type dataBody struct {
	Data any `json:"data"`
}
