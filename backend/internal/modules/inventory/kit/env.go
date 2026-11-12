package kit

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	ps "nuhabit/backend/internal/platform/scope"
)

// Env is what every inventory handler needs. DB is the pool in production
// and a rolled-back transaction in tests.
type Env struct {
	DB   database.DB
	Auth *auth.Service
	Log  *slog.Logger
	Now  func() time.Time
}

// NewEnv builds an Env on db (deps.DB, or a test transaction).
func NewEnv(deps module.Deps, db database.DB) Env {
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	log := deps.Log
	if log == nil {
		log = slog.Default()
	}
	return Env{DB: db, Auth: deps.Auth, Log: log, Now: now}
}

// Scope is getApiUserScope for u.
func (e Env) Scope(ctx context.Context, u *auth.User) (*ps.Scope, error) {
	return ps.Load(ctx, e.DB, u.ID)
}

// Staff is a guard passing callers granted a menu under one of the prefixes.
func (e Env) Staff(prefixes []string) func(*http.Request) (*auth.User, error) {
	return func(r *http.Request) (*auth.User, error) {
		return e.Auth.RequireMenuPrefix(r, prefixes...)
	}
}

// Tx runs fn in a transaction (a savepoint under a test transaction).
func (e Env) Tx(ctx context.Context, fn func(q database.Querier) error) error {
	return database.WithTx(ctx, e.DB, func(tx pgx.Tx) error { return fn(tx) })
}

// Route wraps h in httpx.Handle under pattern.
func Route(pattern string, h httpx.HandlerFunc) module.Route {
	return module.Route{Pattern: pattern, Handler: httpx.Handle(h)}
}
