// Package dataroom ports /api/dataroom/** and /api/share/** (lib/dataroom)
// except the routes that read or write file bytes in Next's local storage:
// folders and their department access, share links with email codes, PIN
// attempt limits and recipient sessions.
package dataroom

import (
	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "dataroom"

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module; ports come from internal/app.
func New(deps module.Deps, ports Ports) module.Module {
	svc := NewService(deps.DB, ports, deps.Now, deps.Log, deps.Config.IsProduction())
	return mod{h: &handler{svc: svc, guard: deps.Auth, limiter: domain.NewRateLimiter()}}
}
