package app

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/memberportal"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

func init() {
	Register(memberportal.Name, func(deps module.Deps) module.Module {
		return memberportal.New(deps, memberportal.Options{
			Credits: memberCredits{svc: gymcredits.NewDefaultService(deps, deps.DB), deps: deps},
		})
	})
}

// memberCredits adapts the gym credit ledger to the member portal's
// CreditWallet port (loadCreditWallet inside a transaction, as the TS did).
type memberCredits struct {
	svc  *gymcredits.Service
	deps module.Deps
}

func (a memberCredits) CreditSummary(ctx context.Context, customerID string) (memberportal.CreditSummary, error) {
	var out memberportal.CreditSummary
	err := database.WithTx(ctx, a.deps.DB, func(tx pgx.Tx) error {
		view, err := a.svc.Wallet(ctx, tx, customerID, 1)
		if err != nil {
			return err
		}
		out = memberportal.CreditSummary{Balance: view.Balance, LowBalance: view.LowBalance, ExpiringCredits: view.ExpiringCredits}
		return nil
	})
	return out, err
}
