package app

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/modules/gymcredits"
	creditdomain "nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/modules/memberportal"
	"nuhabit/backend/internal/modules/memberportal/referral"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

func init() {
	Register(memberportal.Name, func(deps module.Deps) module.Module {
		return memberportal.New(deps, memberportal.Options{
			Credits:         memberCredits{svc: gymcredits.NewDefaultService(deps, deps.DB), deps: deps},
			Loyalty:         memberLoyalty{engine: crm.NewEngine(deps, crmPosReads{}), db: deps.DB},
			ReferralCredits: referralCredits{svc: gymcredits.NewDefaultService(deps, deps.DB)},
			OTPMail: memberOTPMail{
				svc:  newMailService(deps),
				from: strings.TrimSpace(firstNonEmptyStr(os.Getenv("GYM_FROM_EMAIL"), os.Getenv("FROM_EMAIL"))),
			},
		})
	})
	RegisterJob(memberportal.Name, "member-portal.referral-rewards", 15*time.Minute, referralService, (*referral.Service).Process)
}

// referralService is the referral program for the settlement job.
func referralService(d module.Deps) *referral.Service {
	return referral.New(d.DB, referralCredits{svc: gymcredits.NewDefaultService(d, d.DB)}, d.Log, d.Now)
}

// referralCredits grants referral rewards as bonus lots on the gym credit
// ledger, sourced to the referral.
type referralCredits struct {
	svc *gymcredits.Service
}

func (c referralCredits) GrantBonus(ctx context.Context, q database.Querier, g referral.CreditGrant) error {
	_, _, err := c.svc.GrantCredits(ctx, q, gymcredits.Grant{
		CustomerID: g.CustomerID, Type: creditdomain.Bonus, Credits: g.Credits, ExpiresAt: g.ExpiresAt,
		SourceType: "referral", SourceID: g.ReferralID, Note: g.Note, IdempotencyKey: g.Key,
	})
	return err
}

// memberLoyalty adapts the CRM XP engine to the member portal's Loyalty
// port. Like the TS, the awards run on the pool, outside any caller
// transaction.
type memberLoyalty struct {
	engine *xp.Engine
	db     database.DB
}

func (l memberLoyalty) AwardFlatXP(ctx context.Context, a memberportal.XPAward) (memberportal.XPResult, error) {
	r, err := l.engine.AwardFlat(ctx, l.db, xp.FlatAward{
		CustomerID: a.CustomerID, XPAmount: a.XPAmount, CompanyID: a.CompanyID, BranchID: a.BranchID,
		SourceType: a.SourceType, SourceID: a.SourceID, ReferenceTable: a.ReferenceTable,
		IdempotencyKey: a.IdempotencyKey, Description: a.Description,
	})
	return memberportal.XPResult{Status: r.Status, XPAwarded: r.XPAwarded}, err
}

// AwardTopupXP never fails the top-up: the engine reports failures as
// status "error" or "skipped".
func (l memberLoyalty) AwardTopupXP(ctx context.Context, customerID string, amountIdr float64, transactionID string) (memberportal.XPResult, error) {
	r := l.engine.AwardTopup(ctx, l.db, customerID, amountIdr, transactionID)
	return memberportal.XPResult{Status: r.Status, XPAwarded: r.XPAwarded}, nil
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
