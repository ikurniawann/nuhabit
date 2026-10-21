package referral

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/ratelimit"
)

// CreditGrant is a bonus credit lot for a referral reward. Key makes the
// grant idempotent.
type CreditGrant struct {
	CustomerID string
	Credits    int
	ExpiresAt  time.Time
	ReferralID string
	Key        string
	Note       string
}

// Credits grants bonus class credits (the gym credit ledger) in the
// caller's transaction.
type Credits interface {
	GrantBonus(ctx context.Context, q database.Querier, g CreditGrant) error
}

// Service holds the referral use cases.
type Service struct {
	db      database.DB
	credits Credits
	limits  *ratelimit.Limiter
	log     *slog.Logger
	now     func() time.Time
}

// New builds the service; credits may be nil, which leaves credit rewards
// out.
func New(db database.DB, credits Credits, log *slog.Logger, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, credits: credits, limits: ratelimit.New(db), log: log, now: now}
}

/* ── Sign-up ─────────────────────────────────────────────────────────── */

// Attach records a new member's sign-up: the device for later checks and,
// with a code of an active program, the referral (blocked when a fraud
// guard refuses it) plus the friend's voucher code. A bad or unknown code
// is ignored; it never fails the sign-up.
func (s *Service) Attach(ctx context.Context, refereeID, rawCode, deviceID string) error {
	device := HashDevice(deviceID)
	code := NormalizeCode(rawCode)
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := s.attach(ctx, tx, refereeID, code, device); err != nil {
			return err
		}
		return recordDevice(ctx, tx, device, refereeID)
	})
}

func (s *Service) attach(ctx context.Context, tx pgx.Tx, refereeID, code, device string) error {
	if code == "" {
		return nil
	}
	settings, err := loadSettings(ctx, tx)
	if err != nil || !settings.Active {
		return err
	}
	referrer, err := owner(ctx, tx, code)
	if err != nil || referrer == nil {
		return err
	}
	referee, err := memberByID(ctx, tx, refereeID)
	if err != nil || referee == nil {
		return err
	}
	seen, err := deviceSeen(ctx, tx, device, referrer.CustomerID)
	if err != nil {
		return err
	}
	reason := Screen(referrer.Party, referee.Party, seen)
	status := StatusJoined
	if reason != "" {
		status = StatusBlocked
	}
	id, err := insertReferral(ctx, tx, newReferral{
		ReferrerID: referrer.CustomerID, RefereeID: refereeID, Code: code, Status: status, Reason: reason, DeviceHash: device,
	})
	if err != nil || id == "" || status == StatusBlocked || settings.RefereeCampaignID == nil {
		return err
	}
	return s.issueWelcomeVoucher(ctx, tx, id, *settings.RefereeCampaignID)
}

// issueWelcomeVoucher gives the friend a single-use code of the referee
// campaign; a campaign that is off issues nothing.
func (s *Service) issueWelcomeVoucher(ctx context.Context, tx pgx.Tx, referralID, campaignID string) error {
	for range 5 {
		code, err := NewCode()
		if err != nil {
			return err
		}
		code = "TEMAN" + code[2:]
		ok, err := issueVoucher(ctx, tx, campaignID, code)
		if err != nil {
			return err
		}
		if ok {
			return setVoucher(ctx, tx, referralID, code)
		}
		c, err := campaign(ctx, tx, campaignID)
		if err != nil || c == nil || !c.IsActive {
			return err
		}
	}
	return errors.New("referral: no free voucher code after 5 tries")
}

/* ── Member screen ───────────────────────────────────────────────────── */

// Program is what the member screen says the program gives.
type Program struct {
	Active          bool      `json:"active"`
	ReferrerCredits int       `json:"referrer_credits"`
	ReferrerArkIdr  float64   `json:"referrer_ark_idr"`
	RefereeCredits  int       `json:"referee_credits"`
	RefereeDiscount *Discount `json:"referee_discount"`
	HoldDays        int       `json:"hold_days"`
}

// Discount is the referee campaign's discount.
type Discount struct {
	Type        string   `json:"type"`
	Value       float64  `json:"value"`
	MaxDiscount *float64 `json:"max_discount"`
}

// MemberView is the "Ajak teman" screen.
type MemberView struct {
	Code    string   `json:"code"`
	Program Program  `json:"program"`
	Stats   Stats    `json:"stats"`
	Friends []Friend `json:"friends"`
	Welcome *Welcome `json:"welcome"`
}

// MemberView returns the member's code (created on first use), the
// program, the friends who signed up with it and what the member got when
// referred. The device is recorded for the same-device guard.
func (s *Service) MemberView(ctx context.Context, customerID, deviceID string) (*MemberView, error) {
	if err := recordDevice(ctx, s.db, HashDevice(deviceID), customerID); err != nil {
		return nil, err
	}
	code, err := s.ensureCode(ctx, customerID)
	if err != nil {
		return nil, err
	}
	settings, err := loadSettings(ctx, s.db)
	if err != nil {
		return nil, err
	}
	program, err := s.program(ctx, settings)
	if err != nil {
		return nil, err
	}
	view := &MemberView{Code: code, Program: program}
	if view.Stats, err = stats(ctx, s.db, customerID); err != nil {
		return nil, err
	}
	if view.Friends, err = friends(ctx, s.db, customerID); err != nil {
		return nil, err
	}
	if view.Welcome, err = welcome(ctx, s.db, customerID); err != nil {
		return nil, err
	}
	return view, nil
}

func (s *Service) program(ctx context.Context, settings Settings) (Program, error) {
	p := Program{
		Active: settings.Active, ReferrerCredits: settings.ReferrerCredits, ReferrerArkIdr: settings.ReferrerArkIdr,
		RefereeCredits: settings.RefereeCredits, HoldDays: settings.HoldDays,
	}
	if settings.ReferrerArkIdr > 0 && !arkCoinEnabled(ctx, s.db) {
		p.ReferrerArkIdr = 0
	}
	if settings.RefereeCampaignID == nil {
		return p, nil
	}
	c, err := campaign(ctx, s.db, *settings.RefereeCampaignID)
	if err != nil || c == nil || !c.IsActive {
		return p, err
	}
	p.RefereeDiscount = &Discount{Type: c.DiscountType, Value: c.Value, MaxDiscount: c.MaxDiscount}
	return p, nil
}

// ensureCode returns the member's code, creating one on first use.
func (s *Service) ensureCode(ctx context.Context, customerID string) (string, error) {
	for range 5 {
		code, err := codeOf(ctx, s.db, customerID)
		if err != nil || code != "" {
			return code, err
		}
		if code, err = NewCode(); err != nil {
			return "", err
		}
		if _, err := insertCode(ctx, s.db, customerID, code); err != nil {
			return "", err
		}
	}
	return "", errors.New("referral: no free code after 5 tries")
}

// Invite is the public answer for a shared code.
type Invite struct {
	Code            string    `json:"code"`
	ReferrerName    string    `json:"referrer_name"`
	RefereeCredits  int       `json:"referee_credits"`
	RefereeDiscount *Discount `json:"referee_discount"`
}

var (
	errInvalidCode  = httpx.Coded(http.StatusNotFound, "REFERRAL_INVALID", "Kode referral tidak ditemukan atau program sedang tidak aktif", nil)
	errTooManyCodes = httpx.Coded(http.StatusTooManyRequests, "REFERRAL_RATE_LIMITED", "Terlalu banyak permintaan. Coba lagi beberapa menit lagi", nil)
)

// lookupRule caps code lookups per network, against guessing codes.
const (
	lookupLimit  = 30
	lookupWindow = 10 * time.Minute
)

// Lookup describes a code for the sign-up screens: who invited and what the
// friend gets. Unknown codes and an inactive program are a 404.
func (s *Service) Lookup(ctx context.Context, ip, rawCode string) (*Invite, error) {
	allowed, _, err := s.limits.Sliding(ctx, "referral-lookup:"+ip, lookupLimit, lookupWindow, s.now())
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, errTooManyCodes
	}
	code := NormalizeCode(rawCode)
	if code == "" {
		return nil, errInvalidCode
	}
	settings, err := loadSettings(ctx, s.db)
	if err != nil {
		return nil, err
	}
	if !settings.Active {
		return nil, errInvalidCode
	}
	referrer, err := owner(ctx, s.db, code)
	if err != nil {
		return nil, err
	}
	if referrer == nil {
		return nil, errInvalidCode
	}
	program, err := s.program(ctx, settings)
	if err != nil {
		return nil, err
	}
	return &Invite{Code: code, ReferrerName: ShortName(referrer.Name), RefereeCredits: program.RefereeCredits, RefereeDiscount: program.RefereeDiscount}, nil
}

// Active reports whether new sign-ups can use codes.
func (s *Service) Active(ctx context.Context) (bool, error) {
	settings, err := loadSettings(ctx, s.db)
	return settings.Active, err
}

/* ── Settlement job ──────────────────────────────────────────────────── */

const settleBatch = 200

// Process is the referral job: friends with a first paid purchase move to
// held, a purchase refunded during the hold voids its referral, and held
// referrals past the hold release their rewards. Errors of single
// referrals come back joined after the batch.
func (s *Service) Process(ctx context.Context, now time.Time) error {
	settings, err := loadSettings(ctx, s.db)
	if err != nil {
		return err
	}
	if _, err := qualify(ctx, s.db, settings.HoldDays); err != nil {
		return fmt.Errorf("qualify: %w", err)
	}
	if _, err := voidRefunded(ctx, s.db, now); err != nil {
		return fmt.Errorf("void refunded: %w", err)
	}
	due, err := dueReferrals(ctx, s.db, now, settleBatch)
	if err != nil {
		return err
	}
	var errs []error
	for _, id := range due {
		if err := s.release(ctx, id, now); err != nil {
			errs = append(errs, fmt.Errorf("referral %s: %w", id, err))
		}
	}
	return errors.Join(errs...)
}

// release settles one held referral in a transaction: a refunded purchase
// voids it; otherwise the friend gets their credits and the referrer theirs
// unless the monthly cap is reached. Amounts come from the settings at
// release time.
func (s *Service) release(ctx context.Context, id string, now time.Time) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		held, err := lockHeld(ctx, tx, id)
		if err != nil || held == nil {
			return err
		}
		if held.PurchaseStatus != "paid" {
			return settle(ctx, tx, id, settlement{Status: StatusVoid, Reason: ReasonRefunded}, now)
		}
		settings, err := loadSettings(ctx, tx)
		if err != nil {
			return err
		}
		if err := lockReferrer(ctx, tx, held.ReferrerID); err != nil {
			return err
		}
		from, to := MonthBounds(now)
		rewarded, err := rewardedIn(ctx, tx, held.ReferrerID, from, to)
		if err != nil {
			return err
		}
		expires := now.AddDate(0, 0, settings.CreditValidityDays)
		out := settlement{Status: StatusCapped}
		if out.RefereeCredits, err = s.grant(ctx, tx, held.RefereeID, settings.RefereeCredits, expires, id, "referee",
			"Bonus referral: selamat bergabung"); err != nil {
			return err
		}
		if !CapReached(rewarded, settings.MonthlyCap) {
			out.Status = StatusRewarded
			if out.ReferrerCredits, err = s.grant(ctx, tx, held.ReferrerID, settings.ReferrerCredits, expires, id, "referrer",
				"Bonus referral: teman bergabung"); err != nil {
				return err
			}
			if settings.ReferrerArkIdr > 0 && arkCoinEnabled(ctx, tx) {
				if err := creditArk(ctx, tx, held.ReferrerID, settings.ReferrerArkIdr, id, now); err != nil {
					return err
				}
				out.ReferrerArkIdr = settings.ReferrerArkIdr
			}
		}
		return settle(ctx, tx, id, out, now)
	})
}

// grant writes a bonus credit lot and returns the credits granted (0 when
// the amount is 0 or credits are not wired).
func (s *Service) grant(ctx context.Context, tx pgx.Tx, customerID string, credits int, expires time.Time, referralID, side, note string) (int, error) {
	if credits <= 0 || s.credits == nil {
		return 0, nil
	}
	err := s.credits.GrantBonus(ctx, tx, CreditGrant{
		CustomerID: customerID, Credits: credits, ExpiresAt: expires, ReferralID: referralID,
		Key: "referral:" + referralID + ":" + side, Note: note,
	})
	return credits, err
}

/* ── Staff ───────────────────────────────────────────────────────────── */

// SettingsView is the dashboard settings form: the settings and the
// campaigns the referee discount can come from.
type SettingsView struct {
	Settings  Settings   `json:"settings"`
	Campaigns []Campaign `json:"campaigns"`
}

// Settings returns the dashboard settings form.
func (s *Service) Settings(ctx context.Context) (*SettingsView, error) {
	settings, err := loadSettings(ctx, s.db)
	if err != nil {
		return nil, err
	}
	campaigns, err := gymCampaigns(ctx, s.db)
	if err != nil {
		return nil, err
	}
	return &SettingsView{Settings: settings, Campaigns: campaigns}, nil
}

// SaveSettings validates and stores the settings.
func (s *Service) SaveSettings(ctx context.Context, in Settings, actorID string) (*SettingsView, error) {
	if msg := in.Problem(); msg != "" {
		return nil, httpx.BadRequest(msg)
	}
	if in.RefereeCampaignID != nil {
		c, err := campaign(ctx, s.db, *in.RefereeCampaignID)
		if err != nil {
			return nil, err
		}
		if c == nil || (c.Scope != "gym" && c.Scope != "semua") {
			return nil, httpx.BadRequest("Campaign diskon teman harus campaign promo untuk gym")
		}
	}
	if err := saveSettings(ctx, s.db, in, actorID); err != nil {
		return nil, err
	}
	return s.Settings(ctx)
}

// ListView is a page of the staff referral list with the status counts.
type ListView struct {
	Rows   []Row          `json:"rows"`
	Total  int            `json:"total"`
	Counts map[string]int `json:"counts"`
}

// List pages the referrals for staff.
func (s *Service) List(ctx context.Context, f ListFilter) (*ListView, error) {
	rows, total, err := list(ctx, s.db, f)
	if err != nil {
		return nil, err
	}
	counts, err := statusCounts(ctx, s.db)
	if err != nil {
		return nil, err
	}
	return &ListView{Rows: rows, Total: total, Counts: counts}, nil
}

// Leaderboard ranks the referrers of a WIB month.
func (s *Service) Leaderboard(ctx context.Context, from, to time.Time) ([]Leader, error) {
	return leaderboard(ctx, s.db, from, to, 20)
}
