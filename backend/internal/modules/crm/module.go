// Package crm is the CRM bounded context: loyalty (XP, tiers, rewards,
// collectibles), members, engagement, marketing (segments, campaigns,
// forms), the CS inbox, sales-funnel rules and reporting. Each area lives in
// its own sub-package; this package mounts them as one module.
package crm

import (
	"nuhabit/backend/internal/modules/crm/advance"
	"nuhabit/backend/internal/modules/crm/collectibles"
	"nuhabit/backend/internal/modules/crm/engagement"
	"nuhabit/backend/internal/modules/crm/inbox"
	"nuhabit/backend/internal/modules/crm/loyalty"
	"nuhabit/backend/internal/modules/crm/marketing"
	"nuhabit/backend/internal/modules/crm/members"
	"nuhabit/backend/internal/modules/crm/partners"
	"nuhabit/backend/internal/modules/crm/publicforms"
	"nuhabit/backend/internal/modules/crm/reporting"
	"nuhabit/backend/internal/modules/crm/reports"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key of this module.
const Name = "crm"

// Ports are the adapters internal/app wires from other bounded contexts.
type Ports struct {
	// Pos backs the XP engine's POS reads (loyalty settings, product XP,
	// order numbers).
	Pos          xp.PosReads
	Loyalty      loyalty.Ports
	Members      members.Ports
	Collectibles collectibles.Ports
	Marketing    marketing.Ports
	Engagement   engagement.Ports
	Partners     partners.Ports
	Inbox        inbox.Ports
	Reports      reports.Ports
	Advance      advance.Ports
	Reporting    reporting.Ports
	FormLeads    publicforms.Leads
}

// Module is the mounted CRM context.
type Module struct{ routes []module.Route }

// NewEngine builds the XP engine on deps (exported so internal/app can adapt
// it to other modules' XP ports).
func NewEngine(d module.Deps, pos xp.PosReads) *xp.Engine {
	return &xp.Engine{Pos: pos, Log: d.Log, Now: d.Now}
}

// New mounts every CRM area and registers the CRM outbox subscribers.
func New(d module.Deps, p Ports) *Module {
	engine := NewEngine(d, p.Pos)
	loyalty.Subscribe(d.Events, engine)
	engagement.Subscribe(d.Events, d, p.Engagement)
	advance.Subscribe(d.Events, d, p.Advance)
	var routes []module.Route
	for _, rs := range [][]module.Route{
		loyalty.Routes(d, engine, p.Loyalty),
		members.Routes(d, engine, p.Members),
		collectibles.Routes(d, engine, p.Collectibles),
		marketing.Routes(d, engine, p.Marketing),
		engagement.Routes(d, engine, p.Engagement),
		partners.Routes(d, engine, p.Partners),
		inbox.Routes(d, engine, p.Inbox),
		reports.Routes(d, engine, p.Reports),
		advance.Routes(d, engine, p.Advance),
		reporting.Routes(d, engine, p.Reporting),
		publicforms.Routes(d, engine, p.Advance, p.FormLeads),
	} {
		routes = append(routes, rs...)
	}
	return &Module{routes: routes}
}

// Name implements module.Module.
func (m *Module) Name() string { return Name }

// Routes implements module.Module.
func (m *Module) Routes() []module.Route { return m.routes }
