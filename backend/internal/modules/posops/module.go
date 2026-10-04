// Package posops is the POS operations context: cashier shifts, tables and
// reservations, the POS catalog and customers, the POS dashboard and
// reports, and POS settings. Sales, member bills, CRM and configuration
// data are reached through Ports that internal/app wires.
package posops

import (
	"log/slog"
	"time"

	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "pos-ops"

type posOpsModule struct{ h *Handler }

func (m posOpsModule) Name() string           { return Name }
func (m posOpsModule) Routes() []module.Route { return m.h.Routes() }

// New mounts the module on the shared pool.
func New(deps module.Deps, ports Ports) module.Module { return NewOn(deps.DB, deps, ports) }

// NewOn mounts the module with every query on db: the pool in production, a
// rolled-back transaction in integration tests.
func NewOn(db database.DB, deps module.Deps, ports Ports) module.Module {
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	log := deps.Log
	if log == nil {
		log = slog.Default()
	}
	svc := &Service{db: db, ports: ports, now: now, log: log}
	if deps.Events != nil {
		deps.Events.Subscribe(possales.TopicTableStatusChanged, TableStatusSubscriber, svc.ApplyTableStatus)
	}
	return posOpsModule{h: &Handler{svc: svc, auth: deps.Auth}}
}

// Service holds the use cases. Every query runs on db or on a transaction
// opened from it; ports receive the same Querier.
type Service struct {
	db    database.DB
	ports Ports
	now   func() time.Time
	log   *slog.Logger
}
