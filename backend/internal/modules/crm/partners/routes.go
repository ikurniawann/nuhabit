// Package partners ports the CRM loyalty partner routes: partner admin
// (signing secrets shown once), the partner event log and manual or
// automatic re-matching of events to members (XP through the engine).
package partners

import (
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// Ports are the capabilities of other bounded contexts this area uses
// (none: every table it touches is CRM's).
type Ports struct{}

type handler struct {
	db     database.DB
	guard  kit.Guard
	events Events
}

// Routes mounts the area's routes.
func Routes(d module.Deps, engine *xp.Engine, _ Ports) []module.Route {
	return newHandler(d.DB, d, engine).routes()
}

func newHandler(db database.DB, d module.Deps, engine *xp.Engine) *handler {
	return &handler{db: db, guard: kit.Guard{Auth: d.Auth, DB: db}, events: NewEvents(engine)}
}

func (h *handler) routes() []module.Route {
	r := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	return []module.Route{
		r("GET /api/crm/partners", h.listPartners),
		r("POST /api/crm/partners", h.createPartner),
		r("PATCH /api/crm/partners/{id}", h.updatePartner),
		r("GET /api/crm/partners/events", h.listEvents),
		r("POST /api/crm/partners/events/rematch", h.rematch),
	}
}
