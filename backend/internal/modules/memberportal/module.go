package memberportal

import (
	"crypto/sha256"
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/ratelimit"
	"nuhabit/backend/internal/platform/safehttp"
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
	// Loyalty is the CRM XP engine (profile, challenge, badge and top-up XP).
	Loyalty Loyalty
}

// New builds the module with its in-package adapters.
func New(deps module.Deps, opts Options) *Module {
	getenv := os.Getenv
	repo := newStore(deps.DB)
	svc := &Service{
		repo:       repo,
		notifier:   newWhatsAppNotifier(deps.DB, getenv, deps.Log),
		loyalty:    opts.Loyalty,
		log:        deps.Log,
		now:        deps.Now,
		limits:     ratelimit.New(deps.DB),
		bypass:     bypassFromEnv(deps.Config.IsProduction(), getenv, deps.Config.DatabaseURL),
		brand:      domain.BrandName(getenv("NEXT_PUBLIC_APP_NAME")),
		production: deps.Config.IsProduction(),
		appOrigin:  firstNonEmpty(getenv("NEXT_PUBLIC_APP_URL"), getenv("NEXT_PUBLIC_BASE_URL")),
	}
	svc.wallet = &sqlWallet{pool: deps.DB, now: deps.Now}
	svc.payments = newXenditPayments(deps.DB, getenv)
	svc.pusher = &webPusher{db: deps.DB, getenv: getenv, client: safehttp.NewClient(30 * time.Second), log: deps.Log, now: deps.Now}
	if svc.googleAudience = strings.TrimSpace(getenv("GOOGLE_CLIENT_ID")); svc.googleAudience != "" {
		svc.google = newGoogleKeys(GoogleJWKSURL, safehttp.NewClient(10*time.Second), deps.Now)
	}
	svc.ticketSecret = ticketSecret(getenv("MEMBER_TICKET_SECRET"), deps.Config.DatabaseURL)
	return &Module{handler: &Handler{svc: svc, auth: deps.Auth, log: deps.Log, credits: opts.Credits}}
}

// ticketSecret signs Google tickets: MEMBER_TICKET_SECRET, else a key
// derived from the database URL so every replica agrees without extra
// configuration.
func ticketSecret(configured, databaseURL string) []byte {
	if configured = strings.TrimSpace(configured); configured != "" {
		return []byte(configured)
	}
	sum := sha256.Sum256([]byte("member-portal-ticket:" + databaseURL))
	return sum[:]
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
