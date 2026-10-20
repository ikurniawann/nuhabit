package app

import (
	"context"
	"sync"
	"time"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/platform/metrics"
	"nuhabit/backend/internal/platform/module"
)

func init() {
	Register(gymcredits.Name, func(d module.Deps) module.Module {
		return gymcredits.New(d, newGymVouchers(d))
	})
	RegisterJob(gymcredits.Name, "gym-credits.purchase-reconcile", 2*time.Minute, creditsService, (*gymcredits.Service).ReconcilePendingPurchases)
	RegisterJob(gymcredits.Name, "gym-credits.reminders", time.Hour, creditsService, (*gymcredits.Service).SendCreditReminders)
	RegisterJob(gymcredits.Name, "gym-credits.pass-renewals", time.Hour, renewalService, (*gymcredits.Service).SweepRenewals)
	RegisterJob(gymcredits.Name, "gym-credits.pass-unfreeze", 15*time.Minute, creditsService, (*gymcredits.Service).SweepFrozen)
	RegisterJob(gymcredits.Name, "gym-credits.expiry", time.Hour, creditsService,
		func(s *gymcredits.Service, ctx context.Context, now time.Time) error {
			_, err := s.SweepExpiry(ctx, now)
			return err
		})
	RegisterJob(gymcredits.Name, "gym-credits.pass-revenue", time.Hour, creditsService,
		func(s *gymcredits.Service, ctx context.Context, now time.Time) error {
			_, err := s.SweepPassRevenue(ctx, now)
			return err
		})
}

// creditsService is the gym-credits service for background jobs.
func creditsService(d module.Deps) *gymcredits.Service {
	return gymcredits.NewDefaultService(d, d.DB).WithVouchers(newGymVouchers(d)).WithAlerts(gymAlerts(d))
}

// renewalService is built when the jobs start, so it checks the renewal
// setup then: a missing app URL or gateway is an error at startup, not a
// silent failure on every run.
func renewalService(d module.Deps) *gymcredits.Service {
	svc := creditsService(d)
	if d.DB == nil { // job listing in tests
		return svc
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := svc.CheckRenewalSetup(ctx); err != nil {
		d.Log.Error("gym-credits: cek pengaturan perpanjangan gagal", "error", err)
	}
	return svc
}

var gymAlertCounter struct {
	once sync.Once
	vec  *metrics.CounterVec
}

// gymAlerts counts gym-credits alerts on gym_credits_alerts_total{reason};
// nil without a registry (tests).
func gymAlerts(d module.Deps) func(reason string) {
	if d.Metrics == nil {
		return nil
	}
	gymAlertCounter.once.Do(func() {
		gymAlertCounter.vec = d.Metrics.NewCounterVec("gym_credits_alerts_total",
			"Gym credit problems an operator must fix, such as auto-renew by invoice without NEXT_PUBLIC_APP_URL.", "reason")
	})
	return func(reason string) { gymAlertCounter.vec.Inc(reason) }
}
