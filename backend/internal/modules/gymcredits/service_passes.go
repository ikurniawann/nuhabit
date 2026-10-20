package gymcredits

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/pdfgen"
)

// Pass lifecycle: a paid pass is active (queued while its start is ahead),
// can be frozen and unfrozen within the yearly allowance, extended by staff,
// renewed automatically before it ends, then expires or is refunded. Every
// change is logged in gym.member_pass_events.

// Renewal payment choices (gym.member_passes.renew_with).
const (
	RenewWithArk     = "ark"
	RenewWithInvoice = "invoice"
)

const (
	day = 24 * time.Hour
	// maxRenewalLeadDays is the upper bound of the renewalLeadDays rule.
	maxRenewalLeadDays = 30
	// freezeWindow is the period the freeze allowance covers.
	freezeWindow = 365 * day
)

// PassActor is who changes a pass: StaffID for the dashboard, CustomerID
// for the member portal (the pass must be the member's own).
type PassActor struct {
	StaffID    string
	CustomerID string
}

// passRows returns the member's passes after due freezes end and lapsed
// passes expire.
func (s *Service) passRows(ctx context.Context, q database.Querier, customerID string, now time.Time) ([]PassRow, error) {
	if err := s.thawDue(ctx, q, customerID, now); err != nil {
		return nil, err
	}
	if err := s.repo.ExpireLapsedPasses(ctx, q, customerID, now); err != nil {
		return nil, err
	}
	return s.repo.Passes(ctx, q, customerID)
}

// freezeAllowance is the member's freeze budget under rules.
func (s *Service) freezeAllowance(ctx context.Context, q database.Querier, customerID string, rules domain.Rules) (domain.FreezeAllowance, error) {
	used, err := s.repo.FreezeDaysUsed(ctx, q, customerID, s.clock().Add(-freezeWindow))
	return domain.NewFreezeAllowance(rules, used), err
}

// changePass locks the pass, runs fn on it in one transaction and returns
// the pass as it is afterwards.
func (s *Service) changePass(ctx context.Context, id string, by PassActor, fn func(tx pgx.Tx, p *PassRow, now time.Time) error) (*PassView, error) {
	var view PassView
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		p, err := s.repo.Pass(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if p == nil || (by.CustomerID != "" && p.CustomerID != by.CustomerID) {
			return failCode(http.StatusNotFound, "PASS_NOT_FOUND", "Pass tidak ditemukan", nil)
		}
		now := s.clock()
		if err := fn(tx, p, now); err != nil {
			return err
		}
		if p, err = s.repo.Pass(ctx, tx, id, false); err != nil {
			return err
		}
		view = passView(*p, now)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &view, nil
}

func isLive(p *PassRow) bool { return p.Status == domain.PassActive || p.Status == domain.PassFrozen }

// FreezePass pauses a running pass for days from now. Bookings and gate
// entry need credits until it is unfrozen.
func (s *Service) FreezePass(ctx context.Context, id string, days int, by PassActor) (*PassView, error) {
	return s.changePass(ctx, id, by, func(tx pgx.Tx, p *PassRow, now time.Time) error {
		// Serializes freezes of one member so two cannot both fit the allowance.
		if err := s.repo.LockMemberCredits(ctx, tx, p.CustomerID); err != nil {
			return err
		}
		rules, err := s.Rules(ctx, tx, p.BranchID)
		if err != nil {
			return err
		}
		allowance, err := s.freezeAllowance(ctx, tx, p.CustomerID, rules)
		if err != nil {
			return err
		}
		if problem := domain.CheckFreeze(p.state(), now, days, allowance); problem.Code != "" {
			var params map[string]any
			if problem.Days > 0 {
				params = map[string]any{"days": problem.Days}
			}
			return failCode(http.StatusConflict, problem.Code, problem.Message, params)
		}
		if err := s.repo.FreezePass(ctx, tx, p.ID, now, now.Add(time.Duration(days)*day)); err != nil {
			return err
		}
		return s.repo.InsertPassEvent(ctx, tx, PassEvent{PassID: p.ID, CustomerID: p.CustomerID, Kind: EventFreeze, Days: days, ActorID: by.StaffID})
	})
}

// UnfreezePass ends a freeze early: ends_at moves out by the days frozen,
// and the allowance is charged at least the minimum freeze.
func (s *Service) UnfreezePass(ctx context.Context, id string, by PassActor) (*PassView, error) {
	return s.changePass(ctx, id, by, func(tx pgx.Tx, p *PassRow, now time.Time) error {
		if p.Status != domain.PassFrozen {
			return failCode(http.StatusConflict, "PASS_NOT_FROZEN", "Pass tidak sedang dibekukan", nil)
		}
		rules, err := s.Rules(ctx, tx, p.BranchID)
		if err != nil {
			return err
		}
		return s.thaw(ctx, tx, p, now, rules.MinFreezeDays, by.StaffID)
	})
}

// thaw ends the freeze of p at now. The passes queued behind it move by the
// same days so they still start when it ends.
func (s *Service) thaw(ctx context.Context, q database.Querier, p *PassRow, now time.Time, minDays int, actorID string) error {
	days := domain.UnfreezeDays(*p.FrozenAt, *p.FrozenUntil, now)
	if err := s.repo.ThawPass(ctx, q, p.ID, days); err != nil {
		return err
	}
	if err := s.repo.ShiftQueuedPasses(ctx, q, p.CustomerID, p.ID, p.EndsAt, time.Duration(days)*day); err != nil {
		return err
	}
	return s.repo.InsertPassEvent(ctx, q, PassEvent{
		PassID: p.ID, CustomerID: p.CustomerID, Kind: EventUnfreeze, Days: days, ActorID: actorID,
		Meta: map[string]any{"charged_days": domain.ChargedFreezeDays(days, minDays), "automatic": minDays == 0},
	})
}

// thawDue unfreezes the member's passes whose freeze has run out, in the
// caller's transaction (the wallet does it before listing passes).
func (s *Service) thawDue(ctx context.Context, q database.Querier, customerID string, now time.Time) error {
	ids, err := s.repo.DueFrozenPasses(ctx, q, customerID, now)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := s.thawIfDue(ctx, q, id, now); err != nil {
			return err
		}
	}
	return nil
}

// thawIfDue locks the pass and unfreezes it when its freeze has run out; nil
// when another run got there first.
func (s *Service) thawIfDue(ctx context.Context, q database.Querier, id string, now time.Time) (*PassRow, error) {
	p, err := s.repo.Pass(ctx, q, id, true)
	if err != nil || p == nil || p.Status != domain.PassFrozen || p.FrozenUntil.After(now) {
		return nil, err
	}
	return p, s.thaw(ctx, q, p, now, 0, "")
}

// SweepFrozen unfreezes every pass whose freeze ended by now and tells the
// member. Each pass commits on its own; it is safe to run repeatedly.
func (s *Service) SweepFrozen(ctx context.Context, now time.Time) error {
	ids, err := s.repo.DueFrozenPasses(ctx, s.db, "", now)
	if err != nil {
		return err
	}
	var errs []error
	for _, id := range ids {
		err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
			p, err := s.thawIfDue(ctx, tx, id, now)
			if err != nil || p == nil {
				return err
			}
			endsAt := p.EndsAt.Add(time.Duration(domain.UnfreezeDays(*p.FrozenAt, *p.FrozenUntil, now)) * day)
			return s.ports.Notifier.NotifyMember(ctx, tx, p.CustomerID, Notice{
				Type: "gym_pass_unfrozen", Title: "Pass aktif lagi: " + p.PackageName,
				Body: "Masa beku selesai. Pass berlaku sampai " + wibDate(endsAt) + ".",
			})
		})
		if err != nil {
			errs = append(errs, fmt.Errorf("unfreeze pass %s: %w", id, err))
		}
	}
	return errors.Join(errs...)
}

// ExtendPass adds days to a live pass (staff only), with the reason logged.
func (s *Service) ExtendPass(ctx context.Context, id string, days int, reason, staffID string) (*PassView, error) {
	return s.changePass(ctx, id, PassActor{StaffID: staffID}, func(tx pgx.Tx, p *PassRow, _ time.Time) error {
		if !isLive(p) {
			return fail(http.StatusConflict, "Hanya pass aktif atau dibekukan yang bisa diperpanjang")
		}
		if err := s.repo.ExtendPass(ctx, tx, p.ID, days); err != nil {
			return err
		}
		if err := s.repo.ShiftQueuedPasses(ctx, tx, p.CustomerID, p.ID, p.EndsAt, time.Duration(days)*day); err != nil {
			return err
		}
		return s.repo.InsertPassEvent(ctx, tx, PassEvent{
			PassID: p.ID, CustomerID: p.CustomerID, Kind: EventExtend, Days: days, Reason: reason, ActorID: staffID,
		})
	})
}

// SetAutoRenew turns renewal on or off for a live pass. renewWith "" keeps
// the current payment choice.
func (s *Service) SetAutoRenew(ctx context.Context, id string, on bool, renewWith string, by PassActor) (*PassView, error) {
	return s.changePass(ctx, id, by, func(tx pgx.Tx, p *PassRow, _ time.Time) error {
		if !isLive(p) {
			return failCode(http.StatusConflict, "PASS_ENDED", "Pass sudah berakhir", nil)
		}
		if renewWith == "" {
			renewWith = p.RenewWith
		}
		if err := s.repo.SetAutoRenew(ctx, tx, p.ID, on, renewWith); err != nil {
			return err
		}
		return s.repo.InsertPassEvent(ctx, tx, PassEvent{
			PassID: p.ID, CustomerID: p.CustomerID, Kind: EventAutoRenew, ActorID: by.StaffID,
			Meta: map[string]any{"auto_renew": on, "renew_with": renewWith},
		})
	})
}

/* ── Auto-renewal ────────────────────────────────────────────────────── */

// SweepRenewals buys the next pass for every auto-renewing pass inside its
// renewal window (renewalLeadDays before it ends). With renew_with 'ark'
// and enough ARK Coin it pays at once; otherwise it opens a Xendit invoice
// and tells the member to pay it. Each pass renews at most once: the claim
// on renewal_handled_at is taken before buying and released only when the
// attempt hit a passing failure (gateway or database), so a later run retries.
func (s *Service) SweepRenewals(ctx context.Context, now time.Time) error {
	candidates, err := s.repo.RenewalCandidates(ctx, s.db, now, now.Add(maxRenewalLeadDays*day))
	if err != nil {
		return err
	}
	rulesOf := map[string]domain.Rules{}
	var errs []error
	for _, p := range candidates {
		key := deref(p.BranchID)
		rules, ok := rulesOf[key]
		if !ok {
			if rules, err = s.Rules(ctx, s.db, p.BranchID); err != nil {
				return errors.Join(append(errs, err)...)
			}
			rulesOf[key] = rules
		}
		if !domain.RenewalDue(p.EndsAt, now, rules.RenewalLeadDays) {
			continue
		}
		if err := s.renew(ctx, p); err != nil {
			errs = append(errs, fmt.Errorf("renew pass %s: %w", p.ID, err))
		}
	}
	return errors.Join(errs...)
}

func (s *Service) renew(ctx context.Context, p PassRow) error {
	claimed, err := s.repo.ClaimRenewal(ctx, s.db, p.ID)
	if err != nil || !claimed {
		return err
	}
	logRenewal := func(meta map[string]any) error {
		return s.repo.InsertPassEvent(ctx, s.db, PassEvent{PassID: p.ID, CustomerID: p.CustomerID, Kind: EventRenewal, Meta: meta})
	}
	// The member already bought the pass that follows this one.
	lastEnd, err := s.repo.LastPassEnd(ctx, s.db, p.CustomerID)
	if err != nil {
		return s.releaseRenewal(ctx, p.ID, err)
	}
	if lastEnd != nil && lastEnd.After(p.EndsAt) {
		return logRenewal(map[string]any{"skipped": "already_renewed"})
	}

	view, err := s.buyRenewal(ctx, p)
	if err != nil {
		var ce *Error
		if !errors.As(err, &ce) || ce.Status >= http.StatusInternalServerError {
			return s.releaseRenewal(ctx, p.ID, err)
		}
		// A rule failure (package archived, member inactive) repeats on
		// every run: record it and tell the member instead of retrying.
		if err := logRenewal(map[string]any{"error": ce.Message}); err != nil {
			return err
		}
		return s.ports.Notifier.NotifyMember(ctx, s.db, p.CustomerID, Notice{
			Type: "gym_pass_renewal", Title: "Perpanjangan otomatis gagal",
			Body: p.PackageName + " tidak bisa diperpanjang otomatis: " + ce.Message + ". Beli pass baru dari menu Dompet.",
		})
	}
	if err := s.repo.SetRenewalPurchase(ctx, s.db, p.ID, view.ID); err != nil {
		return err
	}
	if err := logRenewal(map[string]any{"purchase_id": view.ID, "payment_method": deref(view.PaymentMethod), "status": view.Status}); err != nil {
		return err
	}
	return s.ports.Notifier.NotifyMember(ctx, s.db, p.CustomerID, renewalNotice(p, view))
}

func (s *Service) releaseRenewal(ctx context.Context, passID string, cause error) error {
	if err := s.repo.ReleaseRenewal(ctx, s.db, passID); err != nil {
		return errors.Join(cause, err)
	}
	return cause
}

// buyRenewal buys the same package at the branch of the pass it renews:
// with ARK Coin when chosen, enabled and the balance covers it, else by
// invoice.
func (s *Service) buyRenewal(ctx context.Context, p PassRow) (*MemberPurchaseView, error) {
	in := MemberPurchase{CustomerID: p.CustomerID, PackageID: p.PackageID, BranchID: p.BranchID, RenewsPassID: p.ID}
	if p.RenewWith == RenewWithArk && s.ports.Wallet.Enabled(ctx, s.db) {
		view, err := s.BuyWithArk(ctx, in)
		var ce *Error
		if err == nil || !errors.As(err, &ce) || ce.Message != msgArkShort {
			return view, err
		}
	}
	return s.StartInvoicePurchase(ctx, in, func(purchaseID string) string {
		return envOrigin() + "/member/wallet/pay/" + purchaseID
	})
}

func renewalNotice(p PassRow, v *MemberPurchaseView) Notice {
	if v.Status == "paid" {
		via := ""
		if deref(v.PaymentMethod) == "ark_coin" {
			via = " dengan ARK Coin (" + pdfgen.Rupiah(v.TotalIdr) + ")"
		}
		return Notice{
			Type: "gym_pass_renewal", Title: "Pass diperpanjang: " + p.PackageName,
			Body: "Pass baru sudah dibayar" + via + " dan mulai saat pass sekarang berakhir pada " + wibDate(p.EndsAt) + ".",
		}
	}
	return Notice{
		Type: "gym_pass_renewal", Title: "Perpanjang pass kamu: " + p.PackageName,
		Body: "Pass kamu berakhir pada " + wibDate(p.EndsAt) + ". Bayar " + pdfgen.Rupiah(v.TotalIdr) +
			" di menu Dompet supaya langsung lanjut tanpa jeda.",
	}
}

// envOrigin is the configured public origin of the app (NEXT_PUBLIC_APP_URL,
// else NEXT_PUBLIC_BASE_URL), "" when neither is set.
func envOrigin() string {
	origin := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL"))
	if origin == "" {
		origin = strings.TrimSpace(os.Getenv("NEXT_PUBLIC_BASE_URL"))
	}
	return strings.TrimRight(origin, "/")
}

var wibMonths = [...]string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}

// wibDate renders a date in Jakarta time, e.g. "21 Okt 2026".
func wibDate(t time.Time) string {
	w := t.In(wib)
	return strconv.Itoa(w.Day()) + " " + wibMonths[w.Month()-1] + " " + strconv.Itoa(w.Year())
}
