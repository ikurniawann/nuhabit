// Package storedvalue is the stored-value context: the ARK Coin wallet
// (ledger, top-ups, packages, corrections, expiry sweep), member bills,
// member cards and refund requests, with gift cards (giftcards) and promo
// codes and offers (promo) in sub-packages.
//
// POS checkout reaches the wallet, gift cards and promos through the
// exported services (NewWallet, NewGiftCards, NewPromo), whose money
// methods take the caller's database.Querier so they run inside its
// transaction.
package storedvalue

import (
	"os"
	"strings"

	"nuhabit/backend/internal/modules/storedvalue/giftcards"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/modules/storedvalue/promo"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/ratelimit"
)

// Name is the MODULES key.
const Name = "stored-value"

type storedValueModule struct{ routes []module.Route }

func (m storedValueModule) Name() string           { return Name }
func (m storedValueModule) Routes() []module.Route { return m.routes }

// Handler is the HTTP transport of the wallet, top-up, member bill and
// member card routes.
type Handler struct {
	kit    *kit.Kit
	wallet *Wallet
	bills  *memberBills
	cards  *memberCards
}

// New wires the module with the adapters internal/app passes in ports.
func New(deps module.Deps, ports Ports) module.Module { return newModule(deps, ports, deps.DB) }

// newModule runs every service on db (the pool, or a test transaction).
func newModule(deps module.Deps, ports Ports, db database.DB) module.Module {
	k := &kit.Kit{
		Auth: deps.Auth, Log: deps.Log, Now: deps.Now, DB: db, Dir: ports.Directory,
		Limiter: ratelimit.New(db), AppOrigin: appOriginFromEnv(),
	}
	h := &Handler{
		kit:    k,
		wallet: &Wallet{db: db, ports: ports, now: deps.Now, log: deps.Log},
		bills:  &memberBills{db: db, orders: ports.Orders, dir: ports.Directory, now: deps.Now, log: deps.Log},
		cards:  &memberCards{db: db, supervisors: ports.Supervisors, now: deps.Now, log: deps.Log},
	}
	var routes []module.Route
	routes = append(routes, h.walletRoutes()...)
	routes = append(routes, h.topupRoutes()...)
	routes = append(routes, h.memberBillRoutes()...)
	routes = append(routes, h.memberCardRoutes()...)
	routes = append(routes, giftcards.Routes(k, giftcards.NewService(db, ports.GiftCards, deps.Now, deps.Log))...)
	promoSvc := promo.NewService(db, ports.Promo, deps.Now, deps.Log)
	if deps.Events != nil {
		promo.Subscribe(deps.Events, promoSvc)
		subscribeQrisTopups(deps.Events, h.wallet)
	}
	routes = append(routes, promo.Routes(k, promoSvc)...)
	return storedValueModule{routes: routes}
}

// NewGiftCards builds the gift card service (POS checkout redeems through it).
func NewGiftCards(deps module.Deps, ports Ports) *giftcards.Service {
	return giftcards.NewService(deps.DB, ports.GiftCards, deps.Now, deps.Log)
}

// NewPromo builds the promo service (POS checkout applies codes through it).
func NewPromo(deps module.Deps, ports Ports) *promo.Service {
	return promo.NewService(deps.DB, ports.Promo, deps.Now, deps.Log)
}

// appOriginFromEnv is the configured part of lib/app-origin.
func appOriginFromEnv() string {
	for _, k := range []string{"NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_BASE_URL"} {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}
