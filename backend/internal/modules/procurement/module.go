// Package procurement is the purchasing bounded context (module name
// "procurement"): purchase requests, purchase orders, deliveries, goods
// receipts with QC, purchase returns, vendor credits, suppliers, vendors and
// their price lists. Port of frontend/src/app/api/purchasing/** and
// frontend/src/lib/purchasing/**.
package procurement

import (
	"log/slog"
	"time"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "procurement"

type procurementModule struct{ h *Handler }

func (m procurementModule) Name() string           { return Name }
func (m procurementModule) Routes() []module.Route { return m.h.Routes() }

// New mounts the module on the shared pool.
func New(deps module.Deps, ports Ports) module.Module {
	Subscribe(deps.Events, ports)
	return NewOn(deps, deps.DB, ports)
}

// NewOn mounts the module on db: the pool in production, a rolled-back
// transaction in tests. Auth still resolves sessions on deps.Auth.
func NewOn(deps module.Deps, db database.DB, ports Ports) module.Module {
	return procurementModule{h: &Handler{svc: NewService(db, ports, deps.Now, deps.Log, Location(deps.Config.TimeZone)), auth: deps.Auth}}
}

// Location loads the process time zone, falling back to Asia/Jakarta.
func Location(name string) *time.Location {
	if name == "" {
		name = "Asia/Jakarta"
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}

// Service holds the procurement use cases.
type Service struct {
	db    database.DB
	ports Ports
	now   func() time.Time
	log   *slog.Logger
	loc   *time.Location
	rows  RowReader
}

// NewService builds the service; now and log may be nil.
func NewService(db database.DB, ports Ports, now func() time.Time, log *slog.Logger, loc *time.Location) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	if loc == nil {
		loc = Location("")
	}
	return &Service{db: db, ports: ports, now: now, log: log, loc: loc, rows: RowReader{Loc: loc}}
}

// Handler serves the /api/purchasing routes of this context.
type Handler struct {
	svc  *Service
	auth *auth.Service
}
