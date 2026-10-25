// Package investor is the investor portal: read-only revenue, performance
// and progress pages for investors, the progress updates the directors
// write for them, and a daily email digest.
//
// It is a read model over gym, POS and accounting rows. The gym and
// accounting figures come through Ports; the revenue streams, PT sessions,
// ARK Coin balances and deferred revenue are read here. Heavy aggregations
// are cached in memory per branch and day. It owns schema investor.
package investor

import (
	"log/slog"
	"sync"
	"time"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/storage"
)

// Name is the MODULES key.
const Name = "investor"

// Service runs the portal reads, the updates editor and the digest.
type Service struct {
	db    database.DB
	ports Ports
	now   func() time.Time
	log   *slog.Logger
	store *storage.Store

	mu          sync.Mutex
	overview    map[string]cached[*Overview]
	performance map[string]cached[*Performance]
}

type cached[T any] struct {
	at  time.Time
	day string
	v   T
}

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module; ports come from internal/app.
func New(deps module.Deps, ports Ports) module.Module {
	return mod{h: &handler{svc: NewService(deps.DB, ports, deps.Now, deps.Log), guard: deps.Auth}}
}

// NewService builds the service on db (a pool, or a tx in tests).
func NewService(db database.DB, ports Ports, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, ports: ports, now: now, log: log, store: storage.FromEnv(),
		overview: map[string]cached[*Overview]{}, performance: map[string]cached[*Performance]{}}
}
