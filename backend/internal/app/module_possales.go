package app

import (
	"nuhabit/backend/internal/modules/possales"
	"nuhabit/backend/internal/modules/possales/adapters"
	"nuhabit/backend/internal/modules/possales/gofood"
	"nuhabit/backend/internal/modules/possales/kitchen"
	"nuhabit/backend/internal/modules/possales/lookup"
	"nuhabit/backend/internal/modules/possales/offers"
	"nuhabit/backend/internal/modules/possales/sales"
	"nuhabit/backend/internal/modules/possales/tableorder"
	"nuhabit/backend/internal/platform/module"
)

// pos-sales: cashier orders, central checkouts, QRIS, kitchen queue, GoFood,
// table self-order. Wallet and gift cards come from stored-value, XP from
// the CRM engine; the rest are pos-sales' stopgap adapters.
func init() {
	Register(possales.Name, func(d module.Deps) module.Module {
		set := adapters.New(d)
		loyalty := possalesLoyalty{crmLoyaltyForPos: newCrmLoyaltyForPos(d), KolComp: set.KolComp}
		wallet := newPossalesWallet(d)
		gofoodHandler := gofood.New(d)
		offersBackend := newPossalesOffers(d)
		salesHandler := sales.New(d, sales.Ports{
			Loyalty: loyalty, Wallet: wallet, GiftCards: newPossalesGiftCards(d),
			Tabs: set.Tabs, Merchandise: set.Merchandise, Catalog: set.Catalog,
			Directory: set.Directory, Notifier: set.Notifier,
			Offers: offersBackend, Xendit: sales.NewXenditHTTP(),
			GofoodReady: gofoodHandler.NotifyFoodReadyForPosOrder,
		})
		return possales.New(
			salesHandler,
			kitchen.New(d),
			gofoodHandler,
			tableorder.New(d, tableorder.Ports{Loyalty: loyalty, Wallet: wallet, Directory: set.Directory}),
			offers.NewWithBackend(d, offersBackend, offers.CrmSettingsVenue{}),
			lookup.New(d, possalesLookupPorts(d)),
		)
	})
}
