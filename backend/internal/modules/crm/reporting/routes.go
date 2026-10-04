// Package reporting ports the CRM report builder (EPIC-050 phase 4): saved
// reports and ad-hoc runs, dashboards of report widgets and scheduled
// reports. GET /api/crm/report-builder/{id}/export stays in TS (xlsx).
//
// The report datasets read sales-funnel tables as read models; see
// domain/registry.go.
package reporting

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Notifier writes in-app notifications (public.notifications, owned by the
// notifications context).
type Notifier interface {
	// NotifyUsers mirrors notifyUsers in lib/crm/workflow-engine.ts and
	// returns how many users were notified.
	NotifyUsers(ctx context.Context, q database.Querier, userIDs []string, title, message, link string, metadata any) (int, error)
}

// StaffPhones reads HRIS employee phones.
type StaffPhones interface {
	// EmployeePhone is the newest non-null hris.employees phone of a user
	// ("" when none).
	EmployeePhone(ctx context.Context, q database.Querier, userID string) (string, error)
}

// TextSender sends one WhatsApp text and reports whether it was accepted.
type TextSender func(ctx context.Context, target, message string) bool

// WhatsApp is the self-hosted WhatsApp gateway.
type WhatsApp interface {
	// Gateway mirrors loadGatewayConfig: a sender when the gateway is
	// configured, else nil.
	Gateway(ctx context.Context, q database.Querier) TextSender
}

// Ports are the capabilities of other bounded contexts this area uses;
// internal/app/adapters_crm_reporting.go provides them.
type Ports struct {
	Notify   Notifier
	Staff    StaffPhones
	WhatsApp WhatsApp
}

type handler struct {
	db    database.DB
	guard kit.Guard
	ports Ports
	now   func() time.Time
	loc   *time.Location
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
	if p.Notify == nil {
		p.Notify = NotificationsSQL{}
	}
	if p.Staff == nil {
		p.Staff = EmployeesSQL{}
	}
	if p.WhatsApp == nil {
		p.WhatsApp = WhatsAppGateway{Client: whatsapp.New(d.Log)}
	}
	loc, err := time.LoadLocation(database.TimeZone)
	if err != nil {
		loc = time.FixedZone("WIB", 7*3600)
	}
	return &handler{db: db, guard: kit.Guard{Auth: d.Auth, DB: db}, ports: p, now: now, loc: loc}
}

func (h *handler) routes() []module.Route {
	route := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	return []module.Route{
		route("GET /api/crm/report-builder", h.listReports),
		route("POST /api/crm/report-builder", h.createReport),
		route("GET /api/crm/report-builder/datasets", h.datasets),
		route("POST /api/crm/report-builder/run", h.runReport),
		route("GET /api/crm/report-builder/{id}", h.getReport),
		route("PATCH /api/crm/report-builder/{id}", h.patchReport),
		route("DELETE /api/crm/report-builder/{id}", h.deleteReport),

		route("GET /api/crm/dashboards", h.listDashboards),
		route("POST /api/crm/dashboards", h.createDashboard),
		route("GET /api/crm/dashboards/{id}", h.getDashboard),
		route("PATCH /api/crm/dashboards/{id}", h.patchDashboard),
		route("DELETE /api/crm/dashboards/{id}", h.deleteDashboard),

		route("GET /api/crm/report-schedules", h.listSchedules),
		route("POST /api/crm/report-schedules", h.createSchedule),
		route("PATCH /api/crm/report-schedules/{id}", h.patchSchedule),
		route("DELETE /api/crm/report-schedules/{id}", h.deleteSchedule),
		route("POST /api/crm/report-schedules/{id}", h.sendSchedule),
	}
}
