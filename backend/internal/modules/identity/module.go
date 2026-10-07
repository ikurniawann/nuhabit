package identity

import (
	"context"

	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "identity"

type mod struct{ handlers }

func (mod) Name() string { return Name }

// New builds the module. stalls is the warehouse port internal/app adapts.
func New(deps module.Deps, stalls Stalls) module.Module {
	warn := func(ctx context.Context, msg string, err error) { deps.Log.WarnContext(ctx, msg, "error", err) }
	svc := NewService(NewPostgres(deps.DB), stalls, deps.Auth, deps.Now, warn)
	return mod{handlers{svc: svc, log: deps.Log}}
}
