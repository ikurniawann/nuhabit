package gymcredits

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/localtime"
)

// Pass lifecycle: a paid pass is active (queued while its start is ahead),
// can be frozen and unfrozen within the yearly allowance, extended by staff,
// renewed automatically before it ends, then expires or is refunded. Every
// change is logged in gym.member_pass_events.

// Renewal payment choices (gym.member_passes.renew_with).
const (
	RenewWithArk     = "ark"
	RenewWithInvoice = "invoice"
	RenewWithSaved   = "saved_method"
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
				Body: "Masa beku selesai. Pass berlaku sampai " + localtime.FormatDate(endsAt, memberZone) + ".",
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
		if on && renewWith == RenewWithSaved && renewWith != p.RenewWith {
			_, _, usable, err := s.activeSavedMethod(ctx, tx, p.CustomerID)
			if err != nil {
				return err
			}
			if !usable {
				return fail(http.StatusConflict, "Tautkan kartu atau e-wallet dulu di menu Metode pembayaran")
			}
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

// envOrigin is the configured public origin of the app (NEXT_PUBLIC_APP_URL,
// else NEXT_PUBLIC_BASE_URL), "" when neither is set.
func envOrigin() string {
	origin := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL"))
	if origin == "" {
		origin = strings.TrimSpace(os.Getenv("NEXT_PUBLIC_BASE_URL"))
	}
	return strings.TrimRight(origin, "/")
}
