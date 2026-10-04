package adapters

import (
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/module"
)

// Set holds the stopgap adapters of the pos-sales ports no wave module
// serves yet. Wallet, GiftCards and the CRM XP side of Loyalty come from
// stored-value and crm (wired in internal/app).
type Set struct {
	Catalog     ports.Catalog
	Merchandise ports.Merchandise
	Directory   ports.Directory
	Tabs        ports.Tabs
	Notifier    ports.Notifier
	// KolComp is ports.Loyalty's ValidateKolComp.
	KolComp KolComp
}

// New builds the stopgap adapters on deps.
func New(deps module.Deps) Set {
	return Set{
		Catalog:     Catalog{},
		Merchandise: Merchandise{Log: deps.Log},
		Directory:   Directory{Auth: deps.Auth, Log: deps.Log},
		Tabs:        Tabs{},
		Notifier:    NewNotifier(deps.DB, deps.Log, deps.Now),
		KolComp:     KolComp{Now: deps.Now},
	}
}
