// Package site is the public website's bounded context: editable page
// content, articles, public events, and the public reads of branch
// profiles. Staff edit through /api/site, visitors read through
// /api/public/site.
package site

import (
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "site"

type siteModule struct{ routes []module.Route }

func (siteModule) Name() string             { return Name }
func (m siteModule) Routes() []module.Route { return m.routes }

// New mounts the module on the shared pool.
func New(deps module.Deps, ports Ports) module.Module { return NewOn(deps, deps.DB, ports) }

// NewOn mounts the module on db: the pool in production, a rolled-back
// transaction in tests.
func NewOn(deps module.Deps, db database.DB, ports Ports) module.Module {
	svc := &Service{repo: Postgres{db: db}, branches: ports.Branches, now: deps.Now}
	h := &Handler{svc: svc, auth: deps.Auth, log: deps.Log}
	return siteModule{routes: h.Routes()}
}
