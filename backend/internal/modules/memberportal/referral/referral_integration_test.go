package referral

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits"
	creditdomain "nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/testutil"
)

// Every test runs in one rolled-back transaction: members, purchases,
// settings and the credit ledger rows all disappear afterwards.

type gymLedger struct{ svc *gymcredits.Service }

func (g gymLedger) GrantBonus(ctx context.Context, q database.Querier, c CreditGrant) error {
	_, _, err := g.svc.GrantCredits(ctx, q, gymcredits.Grant{
		CustomerID: c.CustomerID, Type: creditdomain.Bonus, Credits: c.Credits, ExpiresAt: c.ExpiresAt,
		SourceType: "referral", SourceID: c.ReferralID, Note: c.Note, IdempotencyKey: c.Key,
	})
	return err
}

type fixture struct {
	t   *testing.T
	ctx context.Context
	tx  pgx.Tx
	svc *Service
	pkg string
}

// base is mid-month in WIB so the hold and the cap stay in one month.
var base = time.Date(2026, 10, 5, 10, 0, 0, 0, wib)

func newFixture(t *testing.T) *fixture {
	t.Helper()
	deps := testutil.Deps(t, nil)
	tx := testutil.Tx(t)
	f := &fixture{t: t, ctx: context.Background(), tx: tx}
	f.svc = New(tx, gymLedger{svc: gymcredits.NewDefaultService(deps, tx)}, deps.Log, func() time.Time { return base })
	f.exec(`UPDATE crm.referral_settings SET is_active = true, referrer_credits = 2, referrer_ark_idr = 50000,
		referee_credits = 1, referee_campaign_id = NULL, credit_validity_days = 30, hold_days = 7, monthly_cap = 10`)
	f.exec(`INSERT INTO crm.crm_settings (key, value) VALUES ('ark_coin_enabled', 'true'::jsonb)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`)
	f.pkg = f.scalar(`INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days) VALUES ('Referral Pack', 4, 300000, 30) RETURNING id::text`)
	return f
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("exec %q: %v", sql, err)
	}
}

func (f *fixture) scalar(sql string, args ...any) string {
	f.t.Helper()
	var out string
	if err := f.tx.QueryRow(f.ctx, sql, args...).Scan(&out); err != nil {
		f.t.Fatalf("query %q: %v", sql, err)
	}
	return out
}

func (f *fixture) member(email string) string {
	f.t.Helper()
	return f.scalar(`INSERT INTO pos.pos_customers (phone, name, email) VALUES ($1, 'Go Referral Member', NULLIF($2, '')) RETURNING id::text`,
		"0899"+testutil.RandomHex(4)[:8], email)
}

// codeOf opens the member screen once, which creates the code.
func (f *fixture) codeOf(customerID, device string) string {
	f.t.Helper()
	view, err := f.svc.MemberView(f.ctx, customerID, device)
	if err != nil {
		f.t.Fatal(err)
	}
	return view.Code
}

func (f *fixture) attach(referee, code, device string) {
	f.t.Helper()
	if err := f.svc.Attach(f.ctx, referee, code, device); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) referral(referee string) (status, reason string) {
	f.t.Helper()
	f.scalarInto(&status, `SELECT status FROM crm.referrals WHERE referee_id = $1`, referee)
	f.scalarInto(&reason, `SELECT COALESCE(reason, '') FROM crm.referrals WHERE referee_id = $1`, referee)
	return status, reason
}

func (f *fixture) scalarInto(dst any, sql string, args ...any) {
	f.t.Helper()
	if err := f.tx.QueryRow(f.ctx, sql, args...).Scan(dst); err != nil {
		f.t.Fatalf("query %q: %v", sql, err)
	}
}

// paid records a paid purchase of the package for the member.
func (f *fixture) paid(customerID string, at time.Time) string {
	f.t.Helper()
	return f.scalar(`INSERT INTO gym.credit_purchases (customer_id, package_id, credits, price_idr, total_idr, channel, payment_method, status, paid_at)
		VALUES ($1, $2, 4, 300000, 300000, 'member_portal', 'qris', 'paid', $3) RETURNING id::text`, customerID, f.pkg, at)
}

func (f *fixture) process(at time.Time) {
	f.t.Helper()
	if err := f.svc.Process(f.ctx, at); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) bonusCredits(customerID string) int {
	f.t.Helper()
	var n int
	f.scalarInto(&n, `SELECT COALESCE(sum(amount), 0)::int FROM gym.credit_ledger WHERE customer_id = $1 AND type = 'bonus' AND source_type = 'referral'`, customerID)
	return n
}

func (f *fixture) ark(customerID string) float64 {
	f.t.Helper()
	var v float64
	f.scalarInto(&v, `SELECT COALESCE(ark_coin_balance, 0)::float8 FROM pos.pos_customers WHERE id = $1`, customerID)
	return v
}

func TestIntegrationHoldThenRelease(t *testing.T) {
	f := newFixture(t)
	referrer := f.member("")
	code := f.codeOf(referrer, "device-referrer")
	if again := f.codeOf(referrer, ""); again != code {
		t.Fatalf("code changed: %s then %s", code, again)
	}
	friend := f.member("")
	f.attach(friend, " "+code[:4]+" "+code[4:]+" ", "device-friend")
	if status, _ := f.referral(friend); status != StatusJoined {
		t.Fatalf("after sign-up: %s", status)
	}

	// A free purchase does not qualify; the first paid one does.
	f.exec(`INSERT INTO gym.credit_purchases (customer_id, package_id, credits, price_idr, discount_idr, total_idr, channel, payment_method, status, paid_at)
		VALUES ($1, $2, 4, 300000, 300000, 0, 'front_desk', 'complimentary', 'paid', $3)`, friend, f.pkg, base.Add(-48*time.Hour))
	purchase := f.paid(friend, base.Add(-24*time.Hour))
	f.process(base)
	if status, _ := f.referral(friend); status != StatusHeld {
		t.Fatalf("after purchase: %s", status)
	}
	var holdUntil time.Time
	f.scalarInto(&holdUntil, `SELECT hold_until FROM crm.referrals WHERE referee_id = $1 AND purchase_id = $2`, friend, purchase)
	if want := base.Add(-24*time.Hour).AddDate(0, 0, 7); !holdUntil.Equal(want) {
		t.Fatalf("hold until %v, want %v", holdUntil, want)
	}

	// Still inside the hold: nothing is paid out.
	f.process(base.AddDate(0, 0, 5))
	if status, _ := f.referral(friend); status != StatusHeld || f.bonusCredits(referrer) != 0 {
		t.Fatalf("inside the hold: %s, credits %d", status, f.bonusCredits(referrer))
	}

	release := base.AddDate(0, 0, 7)
	f.process(release)
	if status, _ := f.referral(friend); status != StatusRewarded {
		t.Fatalf("after the hold: %s", status)
	}
	if f.bonusCredits(referrer) != 2 || f.bonusCredits(friend) != 1 || f.ark(referrer) != 50000 {
		t.Fatalf("rewards: referrer %d credits %v ARK, friend %d", f.bonusCredits(referrer), f.ark(referrer), f.bonusCredits(friend))
	}
	var expires time.Time
	f.scalarInto(&expires, `SELECT l.expires_at FROM gym.credit_lots l JOIN gym.credit_ledger e ON e.lot_id = l.id
		WHERE e.customer_id = $1 AND e.source_type = 'referral'`, referrer)
	if want := release.AddDate(0, 0, 30); !expires.Equal(want) {
		t.Fatalf("bonus lot expires %v, want %v", expires, want)
	}

	// A second run pays nothing twice.
	f.process(release.Add(time.Hour))
	if f.bonusCredits(referrer) != 2 || f.ark(referrer) != 50000 {
		t.Fatal("rewards paid twice")
	}

	view, err := f.svc.MemberView(f.ctx, referrer, "")
	if err != nil {
		t.Fatal(err)
	}
	if view.Stats != (Stats{Invited: 1, Joined: 1, Rewarded: 1}) || len(view.Friends) != 1 || view.Friends[0].Name != "Go R." {
		t.Fatalf("member view %+v", view)
	}
	if welcomed, err := f.svc.MemberView(f.ctx, friend, ""); err != nil || welcomed.Welcome == nil || welcomed.Welcome.Status != StatusRewarded {
		t.Fatalf("friend view %+v %v", welcomed, err)
	}
}

func TestIntegrationRefundInsideHoldVoids(t *testing.T) {
	f := newFixture(t)
	referrer := f.member("")
	code := f.codeOf(referrer, "")
	friend := f.member("")
	f.attach(friend, code, "")
	purchase := f.paid(friend, base)
	f.process(base)

	f.exec(`UPDATE gym.credit_purchases SET status = 'refunded', refunded_at = $2 WHERE id = $1`, purchase, base.Add(time.Hour))
	f.process(base.Add(2 * time.Hour))
	if status, reason := f.referral(friend); status != StatusVoid || reason != ReasonRefunded {
		t.Fatalf("refunded during the hold: %s %s", status, reason)
	}
	f.process(base.AddDate(0, 0, 10))
	if f.bonusCredits(referrer) != 0 || f.bonusCredits(friend) != 0 || f.ark(referrer) != 0 {
		t.Fatal("a voided referral paid out")
	}
}

// A refund that lands after qualification but before the job's void pass
// still voids at release.
func TestIntegrationRefundBeforeReleaseVoids(t *testing.T) {
	f := newFixture(t)
	referrer := f.member("")
	friend := f.member("")
	f.attach(friend, f.codeOf(referrer, ""), "")
	purchase := f.paid(friend, base)
	f.process(base)
	held := f.scalar(`SELECT id::text FROM crm.referrals WHERE referee_id = $1`, friend)
	f.exec(`UPDATE gym.credit_purchases SET status = 'refunded' WHERE id = $1`, purchase)
	if err := f.svc.release(f.ctx, held, base.AddDate(0, 0, 8)); err != nil {
		t.Fatal(err)
	}
	if status, reason := f.referral(friend); status != StatusVoid || reason != ReasonRefunded || f.bonusCredits(referrer) != 0 {
		t.Fatalf("release of a refunded purchase: %s %s", status, reason)
	}
}

func TestIntegrationMonthlyCap(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE crm.referral_settings SET monthly_cap = 1`)
	referrer := f.member("")
	code := f.codeOf(referrer, "")
	first, second := f.member(""), f.member("")
	f.attach(first, code, "device-1")
	f.attach(second, code, "device-2")
	f.paid(first, base)
	f.paid(second, base.Add(time.Minute))
	f.process(base)
	f.process(base.AddDate(0, 0, 8))

	statuses := map[string]string{}
	for _, friend := range []string{first, second} {
		statuses[friend], _ = f.referral(friend)
	}
	if statuses[first] != StatusRewarded || statuses[second] != StatusCapped {
		t.Fatalf("statuses %v", statuses)
	}
	// The referrer is paid once; both friends still get their credits.
	if f.bonusCredits(referrer) != 2 || f.ark(referrer) != 50000 || f.bonusCredits(first) != 1 || f.bonusCredits(second) != 1 {
		t.Fatalf("credits: referrer %d, friends %d %d", f.bonusCredits(referrer), f.bonusCredits(first), f.bonusCredits(second))
	}
}

func TestIntegrationFraudGuards(t *testing.T) {
	f := newFixture(t)
	referrer := f.member("owner@example.com")
	code := f.codeOf(referrer, "shared-phone")

	// Self-referral.
	f.attach(referrer, code, "")
	if status, reason := f.referral(referrer); status != StatusBlocked || reason != ReasonSelf {
		t.Fatalf("self: %s %s", status, reason)
	}

	sameEmail := f.member("OWNER@example.com")
	f.attach(sameEmail, code, "")
	if status, reason := f.referral(sameEmail); status != StatusBlocked || reason != ReasonSameContact {
		t.Fatalf("same email: %s %s", status, reason)
	}

	sameDevice := f.member("")
	f.attach(sameDevice, code, "shared-phone")
	if status, reason := f.referral(sameDevice); status != StatusBlocked || reason != ReasonSameDevice {
		t.Fatalf("referrer's device: %s %s", status, reason)
	}

	first, second := f.member(""), f.member("")
	f.attach(first, code, "friend-phone")
	f.attach(second, code, "friend-phone")
	if status, _ := f.referral(first); status != StatusJoined {
		t.Fatalf("first friend: %s", status)
	}
	if status, reason := f.referral(second); status != StatusBlocked || reason != ReasonSameDevice {
		t.Fatalf("second sign-up from one device: %s %s", status, reason)
	}

	// Blocked referrals never qualify.
	f.paid(sameEmail, base)
	f.process(base.AddDate(0, 0, 8))
	if status, _ := f.referral(sameEmail); status != StatusBlocked || f.bonusCredits(referrer) != 0 {
		t.Fatalf("blocked referral after a purchase: %s", status)
	}
}

func TestIntegrationInactiveProgramAndLookup(t *testing.T) {
	f := newFixture(t)
	referrer := f.member("")
	code := f.codeOf(referrer, "")

	invite, err := f.svc.Lookup(f.ctx, "go-test-"+testutil.RandomHex(4), code)
	if err != nil || invite.RefereeCredits != 1 || invite.ReferrerName != "Go R." {
		t.Fatalf("lookup %+v %v", invite, err)
	}
	if _, err := f.svc.Lookup(f.ctx, "go-test-"+testutil.RandomHex(4), "NHNOPE99"); !isCode(err, "REFERRAL_INVALID") {
		t.Fatalf("unknown code: %v", err)
	}

	f.exec(`UPDATE crm.referral_settings SET is_active = false`)
	friend := f.member("")
	f.attach(friend, code, "")
	var n int
	f.scalarInto(&n, `SELECT count(*)::int FROM crm.referrals WHERE referee_id = $1`, friend)
	if n != 0 {
		t.Fatal("an inactive program recorded a referral")
	}
	if _, err := f.svc.Lookup(f.ctx, "go-test-"+testutil.RandomHex(4), code); !isCode(err, "REFERRAL_INVALID") {
		t.Fatalf("inactive lookup: %v", err)
	}
}

func TestIntegrationWelcomeVoucher(t *testing.T) {
	f := newFixture(t)
	org := testutil.CreateOrg(t, f.tx)
	campaign := f.scalar(`INSERT INTO promo.promo_campaigns (company_id, branch_id, name, discount_type, value, scope)
		VALUES ($1, $2, 'Teman baru', 'percent', 20, 'gym') RETURNING id::text`, org.CompanyID, org.BranchID)
	view, err := f.svc.SaveSettings(f.ctx, Settings{
		Active: true, RefereeCampaignID: &campaign, CreditValidityDays: 30, HoldDays: 7, MonthlyCap: 10,
	}, "")
	if err != nil || view.Settings.RefereeCampaignID == nil {
		t.Fatalf("save %+v %v", view, err)
	}
	referrer := f.member("")
	friend := f.member("")
	f.attach(friend, f.codeOf(referrer, ""), "")
	voucher := f.scalar(`SELECT referee_voucher_code FROM crm.referrals WHERE referee_id = $1`, friend)
	var limit int
	f.scalarInto(&limit, `SELECT usage_limit FROM promo.promo_codes WHERE code = $1 AND campaign_id = $2`, voucher, campaign)
	if limit != 1 || len(voucher) != 11 || voucher[:5] != "TEMAN" {
		t.Fatalf("voucher %q limit %d", voucher, limit)
	}
	welcome, err := f.svc.MemberView(f.ctx, friend, "")
	if err != nil || welcome.Welcome == nil || welcome.Welcome.VoucherCode == nil || *welcome.Welcome.VoucherCode != voucher ||
		welcome.Program.RefereeDiscount == nil || welcome.Program.RefereeDiscount.Value != 20 {
		t.Fatalf("welcome %+v %v", welcome, err)
	}

	if _, err := f.svc.SaveSettings(f.ctx, Settings{Active: true, CreditValidityDays: 30}, ""); !isStatus(err, http.StatusBadRequest) {
		t.Fatalf("active without a reward: %v", err)
	}
}

func TestIntegrationLeaderboardAndList(t *testing.T) {
	f := newFixture(t)
	referrer := f.member("")
	code := f.codeOf(referrer, "")
	friend := f.member("")
	f.attach(friend, code, "")
	f.paid(friend, base)
	f.process(base)
	f.process(base.AddDate(0, 0, 8))

	from, to := MonthBounds(base)
	leaders, err := f.svc.Leaderboard(f.ctx, from, to)
	if err != nil {
		t.Fatal(err)
	}
	var mine *Leader
	for i := range leaders {
		if leaders[i].ID == referrer {
			mine = &leaders[i]
		}
	}
	if mine == nil || mine.Rewarded != 1 || mine.Joined != 1 || mine.Credits != 2 || mine.ArkIdr != 50000 {
		t.Fatalf("leaderboard %+v", leaders)
	}
	page, err := f.svc.List(f.ctx, ListFilter{Status: StatusRewarded, Search: code, Limit: 10})
	if err != nil || page.Total != 1 || page.Rows[0].Referee.ID != friend || page.Rows[0].ReferrerCredits != 2 || page.Counts[StatusRewarded] < 1 {
		t.Fatalf("list %+v %v", page, err)
	}
}

func isCode(err error, code string) bool {
	var he *httpx.Error
	return errors.As(err, &he) && he.Code == code
}

func isStatus(err error, status int) bool {
	var he *httpx.Error
	return errors.As(err, &he) && he.Status == status
}
