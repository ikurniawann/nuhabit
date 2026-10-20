package app

import (
	"time"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/platform/module"
)

func init() {
	Register(gymcredits.Name, gymcredits.New)
	RegisterJob(gymcredits.Name, "gym-credits.purchase-reconcile", 2*time.Minute, creditsService, (*gymcredits.Service).ReconcilePendingPurchases)
	RegisterJob(gymcredits.Name, "gym-credits.reminders", time.Hour, creditsService, (*gymcredits.Service).SendCreditReminders)
}

// creditsService is the gym-credits service for background jobs.
func creditsService(d module.Deps) *gymcredits.Service { return gymcredits.NewDefaultService(d, d.DB) }
