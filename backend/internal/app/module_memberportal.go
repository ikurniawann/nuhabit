package app

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/memberportal"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

func init() {
	Register(memberportal.Name, func(deps module.Deps) module.Module {
		return memberportal.New(deps, memberportal.Options{
			Credits: memberCredits{svc: gymcredits.NewDefaultService(deps, deps.DB), deps: deps},
			Loyalty: memberLoyalty{engine: crm.NewEngine(deps, crmPosReads{}), db: deps.DB},
			OTPMail: memberOTPMail{
				mail: &resendMailer{apiKey: strings.TrimSpace(os.Getenv("RESEND_API_KEY")), log: deps.Log, client: &http.Client{Timeout: 15 * time.Second}},
				from: strings.TrimSpace(firstNonEmptyStr(os.Getenv("GYM_FROM_EMAIL"), os.Getenv("FROM_EMAIL"))),
			},
		})
	})
}

// memberOTPMail emails member sign-in codes through Resend when
// RESEND_API_KEY and a sender (GYM_FROM_EMAIL or FROM_EMAIL) are set.
type memberOTPMail struct {
	mail *resendMailer
	from string
}

func (m memberOTPMail) Configured() bool { return m.mail.apiKey != "" && m.from != "" }

func (m memberOTPMail) Send(ctx context.Context, to, subject, html string) bool {
	return m.mail.Send(ctx, to, m.from, subject, html)
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
