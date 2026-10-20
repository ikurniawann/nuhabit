package app

import (
	"time"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/platform/module"
)

func init() {
	Register(gymcredits.Name, func(d module.Deps) module.Module {
		return gymcredits.New(d, newGymVouchers(d))
	})
	RegisterJob(gymcredits.Name, "gym-credits.purchase-reconcile", 2*time.Minute, creditsService, (*gymcredits.Service).ReconcilePendingPurchases)
	RegisterJob(gymcredits.Name, "gym-credits.reminders", time.Hour, creditsService, (*gymcredits.Service).SendCreditReminders)
	RegisterJob(gymcredits.Name, "gym-credits.pass-renewals", time.Hour, creditsService, (*gymcredits.Service).SweepRenewals)
	RegisterJob(gymcredits.Name, "gym-credits.pass-unfreeze", 15*time.Minute, creditsService, (*gymcredits.Service).SweepFrozen)
}

// creditsService is the gym-credits service for background jobs.
func creditsService(d module.Deps) *gymcredits.Service {
	return gymcredits.NewDefaultService(d, d.DB).WithVouchers(newGymVouchers(d))
}
