package memberportal

import (
	"net/http"
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key of this module.
const Name = "member-portal"

// Module is the mounted member portal.
type Module struct {
	handler *Handler
}

// Options carries the ports internal/app wires from other modules.
type Options struct {
	// Credits backs GET /app/home/me; without it that route stays in TS.
	Credits CreditWallet
}

// New builds the module with its in-package adapters.
func New(deps module.Deps, opts Options) *Module {
	getenv := os.Getenv
	repo := newStore(deps.DB)
	svc := &Service{
		repo:       repo,
		notifier:   newWhatsAppNotifier(deps.DB, getenv, deps.Log),
		loyalty:    &sqlLoyalty{db: deps.DB, log: deps.Log},
		log:        deps.Log,
		now:        deps.Now,
		ipLimiter:  domain.NewRateLimiter(),
		bypass:     bypassFromEnv(deps.Config.IsProduction(), getenv, deps.Config.DatabaseURL),
		brand:      domain.BrandName(getenv("NEXT_PUBLIC_APP_NAME")),
		production: deps.Config.IsProduction(),
		appOrigin:  firstNonEmpty(getenv("NEXT_PUBLIC_APP_URL"), getenv("NEXT_PUBLIC_BASE_URL")),
	}
	svc.wallet = &sqlWallet{pool: deps.DB, now: deps.Now}
	svc.payments = newXenditPayments(deps.DB, getenv)
	svc.pusher = &webPusher{db: deps.DB, getenv: getenv, client: &http.Client{Timeout: 30 * time.Second}, log: deps.Log, now: deps.Now}
	return &Module{handler: &Handler{svc: svc, auth: deps.Auth, log: deps.Log, credits: opts.Credits}}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v = strings.TrimSpace(v); v != "" {
			return v
		}
	}
	return ""
}

// Name implements module.Module.
func (m *Module) Name() string { return Name }

// Routes implements module.Module.
func (m *Module) Routes() []module.Route { return m.handler.Routes() }
