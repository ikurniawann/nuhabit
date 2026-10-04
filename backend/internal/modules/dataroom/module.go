// Package dataroom ports /api/dataroom/** and /api/share/** (lib/dataroom):
// folders and their department access, file upload, download and delete on
// the storage shared with Next, share links with email codes, PIN attempt
// limits, recipient sessions and watermarked shared files.
package dataroom

import (
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/ratelimit"
)

// Name is the MODULES key.
const Name = "dataroom"

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module; ports come from internal/app.
func New(deps module.Deps, ports Ports) module.Module {
	svc := NewService(deps.DB, ports, deps.Now, deps.Log, deps.Config.IsProduction())
	return mod{h: newHandler(svc, deps.Auth)}
}

func newHandler(svc *Service, guard Guard) *handler {
	return &handler{svc: svc, guard: guard, limiter: ratelimit.New(svc.db)}
}
