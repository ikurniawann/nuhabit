package gymcredits

import (
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "gym-credits"

type creditsModule struct{ routes []module.Route }

func (m creditsModule) Name() string           { return Name }
func (m creditsModule) Routes() []module.Route { return m.routes }

// New wires the module on the shared database. Customers, branches, staff
// names, class types, the ARK Coin wallet and Xendit are reached through the
// Ports; the adapters in adapters*.go implement them with the TS SQL until
// internal/app points them at their own modules.
func New(deps module.Deps) module.Module {
	return creditsModule{routes: newHandler(deps, deps.DB).Routes()}
}

// NewDefaultService builds the service on db with the default adapters; other
// modules (gym scheduling, check-in) reach the ledger through it.
func NewDefaultService(deps module.Deps, db DB) *Service {
	xendit := NewXenditGateway()
	ports := Ports{
		Members:   SQLMembers{},
		Wallet:    SQLArkWallet{Log: deps.Log},
		Directory: SQLDirectory{},
		Gateway:   xendit,
		Invoices:  xendit,
	}
	canSimulate := func() bool { return deps.Auth != nil && deps.Auth.MemberOTPDevCode() != "" }
	return NewService(db, Postgres{}, ports, deps.Now, deps.Log, canSimulate)
}

func newHandler(deps module.Deps, db DB) *Handler {
	return &Handler{svc: NewDefaultService(deps, db), auth: deps.Auth}
}
