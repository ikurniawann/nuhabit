package gymcredits

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/pdfgen"
)

// Auto-renewal. Each auto-renewing pass gets one renewal purchase inside
// its renewal window (renewalLeadDays before it ends), paid with ARK Coin,
// the saved method or a Xendit invoice. When that purchase fails or
// expires the sweep tries again renewalRetryHours later, renewalRetryCount
// times at most, while the pass runs or within renewalGraceDays after it
// ended; then auto-renew turns off. A pass has at most one renewal purchase
// pending or paid at a time.

// Alert reasons (the gym_credits_alerts_total metric).
const (
	AlertRenewalNoAppURL     = "renewal_invoice_no_app_url"
	AlertSavedMethodsNoGatew = "saved_methods_gateway_inactive"
)

// errNoAppOrigin: an invoice renewal needs NEXT_PUBLIC_APP_URL (or
// NEXT_PUBLIC_BASE_URL) for the Xendit redirect back to the app.
var errNoAppOrigin = errors.New("NEXT_PUBLIC_APP_URL dan NEXT_PUBLIC_BASE_URL kosong: invoice perpanjangan tidak bisa dibuat")

// CheckRenewalSetup runs when the jobs start. It logs an error and raises
// an alert when passes renew by invoice (any renewal can fall back to one)
// and the app URL the invoice redirects to is not configured, and when saved
// methods are on without an active Xendit gateway.
func (s *Service) CheckRenewalSetup(ctx context.Context) error {
	n, err := s.repo.AutoRenewingPasses(ctx, s.db)
	if err != nil {
		return err
	}
	if n > 0 && envOrigin() == "" {
		s.alert(AlertRenewalNoAppURL)
		s.log.ErrorContext(ctx, "[gym-credits] perpanjangan otomatis lewat invoice butuh NEXT_PUBLIC_APP_URL atau NEXT_PUBLIC_BASE_URL",
			"auto_renewing_passes", n)
	}
	if savedMethodsFlagOn() && !s.SavedMethodsEnabled(ctx) {
		s.alert(AlertSavedMethodsNoGatew)
		s.log.ErrorContext(ctx, "[gym-credits] "+SavedMethodsFlag+" aktif tetapi gateway Xendit belum aktif di Pengaturan → Payment Gateways")
	}
	return nil
}

// rulesCache resolves branch rules once per sweep.
type rulesCache struct {
	s     *Service
	byKey map[string]domain.Rules
}

func (c *rulesCache) get(ctx context.Context, branchID *string) (domain.Rules, error) {
	key := deref(branchID)
	if r, ok := c.byKey[key]; ok {
		return r, nil
	}
	r, err := c.s.Rules(ctx, c.s.db, branchID)
	if err == nil {
		c.byKey[key] = r
	}
	return r, err
}

// SweepRenewals starts the renewals that are due, runs the retries that are
// due, then plans the retry (or the end) of every renewal that failed. It is
// safe to run repeatedly.
func (s *Service) SweepRenewals(ctx context.Context, now time.Time) error {
	rules := &rulesCache{s: s, byKey: map[string]domain.Rules{}}
	var errs []error
	noOrigin := 0
	keep := func(passID string, err error) {
		switch {
		case err == nil:
		case errors.Is(err, errNoAppOrigin):
			noOrigin++
		default:
			errs = append(errs, fmt.Errorf("renew pass %s: %w", passID, err))
		}
	}

	candidates, err := s.repo.RenewalCandidates(ctx, s.db, now, now.Add(maxRenewalLeadDays*day))
	if err != nil {
		return err
	}
	for _, p := range candidates {
		r, err := rules.get(ctx, p.BranchID)
		if err != nil {
			return errors.Join(append(errs, err)...)
		}
		if domain.RenewalDue(p.EndsAt, now, r.RenewalLeadDays) {
			keep(p.ID, s.renew(ctx, p))
		}
	}

	retries, err := s.repo.DueRenewalRetries(ctx, s.db, now)
	if err != nil {
		return errors.Join(append(errs, err)...)
	}
	for _, p := range retries {
		keep(p.ID, s.retryRenewal(ctx, p, now, rules))
	}

	failed, err := s.repo.FailedRenewals(ctx, s.db)
	if err != nil {
		return errors.Join(append(errs, err)...)
	}
	for _, p := range failed {
		keep(p.ID, s.planRetry(ctx, p, now, rules))
	}

	if noOrigin > 0 {
		s.alert(AlertRenewalNoAppURL)
		errs = append(errs, fmt.Errorf("%d perpanjangan menunggu: %w", noOrigin, errNoAppOrigin))
	}
	return errors.Join(errs...)
}

// renew makes the first renewal attempt of a pass.
func (s *Service) renew(ctx context.Context, p PassRow) error {
	claimed, err := s.repo.ClaimRenewal(ctx, s.db, p.ID)
	if err != nil || !claimed {
		return err
	}
	return s.attemptRenewal(ctx, p, 1, func(cause error) error {
		if err := s.repo.ReleaseRenewal(ctx, s.db, p.ID); err != nil {
			return errors.Join(cause, err)
		}
		return cause
	})
}

// retryRenewal runs a due retry; a pass past its grace period stops instead.
func (s *Service) retryRenewal(ctx context.Context, p RenewalState, now time.Time, rules *rulesCache) error {
	r, err := rules.get(ctx, p.BranchID)
	if err != nil {
		return err
	}
	if !now.Before(domain.RenewalGraceEnd(p.EndsAt, r.RenewalGraceDays)) {
		return s.stopRenewal(ctx, p)
	}
	attempt, ok, err := s.repo.ClaimRenewalRetry(ctx, s.db, p.ID, now)
	if err != nil || !ok {
		return err
	}
	return s.attemptRenewal(ctx, p.PassRow, attempt, func(cause error) error {
		// A passing failure (gateway down, app URL missing) keeps the attempt for the next run.
		if err := s.repo.ReleaseRenewalRetry(ctx, s.db, p.ID, now); err != nil {
			return errors.Join(cause, err)
		}
		return cause
	})
}

// attemptRenewal buys the next pass. release undoes the claim when the
// attempt hit a passing failure so a later run tries again.
func (s *Service) attemptRenewal(ctx context.Context, p PassRow, attempt int, release func(error) error) error {
	logRenewal := func(meta map[string]any) error {
		meta["attempt"] = attempt
		return s.repo.InsertPassEvent(ctx, s.db, PassEvent{PassID: p.ID, CustomerID: p.CustomerID, Kind: EventRenewal, Meta: meta})
	}
	// The member already bought the pass that follows this one.
	lastEnd, err := s.repo.LastPassEnd(ctx, s.db, p.CustomerID)
	if err != nil {
		return release(err)
	}
	if lastEnd != nil && lastEnd.After(p.EndsAt) {
		if err := s.repo.ClearRenewalPurchase(ctx, s.db, p.ID); err != nil {
			return err
		}
		return logRenewal(map[string]any{"skipped": "already_renewed"})
	}

	view, err := s.buyRenewal(ctx, p)
	if err != nil {
		var ce *Error
		if !errors.As(err, &ce) || ce.Status >= http.StatusInternalServerError {
			return release(err)
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
	if view.Status == "failed" {
		return nil // planRetry tells the member in the same sweep
	}
	return s.ports.Notifier.NotifyMember(ctx, s.db, p.CustomerID, renewalNotice(p, view))
}

// buyRenewal buys the same package at the branch of the pass it renews:
// with ARK Coin or the saved method when chosen and usable, else by invoice.
func (s *Service) buyRenewal(ctx context.Context, p PassRow) (*MemberPurchaseView, error) {
	in := MemberPurchase{CustomerID: p.CustomerID, PackageID: p.PackageID, BranchID: p.BranchID, RenewsPassID: p.ID}
	switch p.RenewWith {
	case RenewWithArk:
		if s.ports.Wallet.Enabled(ctx, s.db) {
			view, err := s.BuyWithArk(ctx, in)
			var ce *Error
			if err == nil || !errors.As(err, &ce) || ce.Message != msgArkShort {
				return view, err
			}
		}
	case RenewWithSaved:
		m, rail, ok, err := s.activeSavedMethod(ctx, s.db, p.CustomerID)
		if err != nil {
			return nil, err
		}
		if ok {
			return s.BuyWithSavedMethod(ctx, in, m, rail)
		}
	}
	origin := envOrigin()
	if origin == "" {
		return nil, errNoAppOrigin
	}
	return s.StartInvoicePurchase(ctx, in, func(purchaseID string) string {
		return origin + "/member/wallet/pay/" + purchaseID
	})
}

// planRetry follows a renewal purchase that failed or expired: the next
// attempt, or auto-renew off when the retries or the grace period ran out.
func (s *Service) planRetry(ctx context.Context, p RenewalState, now time.Time, rules *rulesCache) error {
	lastEnd, err := s.repo.LastPassEnd(ctx, s.db, p.CustomerID)
	if err != nil {
		return err
	}
	if lastEnd != nil && lastEnd.After(p.EndsAt) {
		return s.repo.ClearRenewalPurchase(ctx, s.db, p.ID)
	}
	r, err := rules.get(ctx, p.BranchID)
	if err != nil {
		return err
	}
	next := domain.NextRenewalRetry(p.Attempts, now, p.EndsAt, r.RenewalRetryCount, r.RenewalRetryHours, r.RenewalGraceDays)
	if next.Final {
		return s.stopRenewal(ctx, p)
	}
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		planned, err := s.repo.ScheduleRenewalRetry(ctx, tx, p.ID, p.PurchaseID, next.At)
		if err != nil || !planned {
			return err
		}
		if err := s.repo.InsertPassEvent(ctx, tx, PassEvent{PassID: p.ID, CustomerID: p.CustomerID, Kind: EventRenewal, Meta: map[string]any{
			"attempt": p.Attempts, "purchase_id": p.PurchaseID, "status": p.PurchaseStatus, "retry_at": isoString(next.At),
		}}); err != nil {
			return err
		}
		return s.ports.Notifier.NotifyMember(ctx, tx, p.CustomerID, Notice{
			Type: "gym_pass_renewal", Title: "Perpanjangan otomatis belum berhasil",
			Body: "Pembayaran perpanjangan " + p.PackageName + " " + purchaseOutcome(p.PurchaseStatus) +
				". Kami coba lagi " + wibDateTime(next.At) + " (percobaan " + strconv.Itoa(p.Attempts+1) + " dari " +
				strconv.Itoa(r.RenewalRetryCount+1) + "). Pastikan saldo atau metode pembayaranmu siap.",
		})
	})
}

// stopRenewal turns auto-renew off after the last failed attempt and tells the member.
func (s *Service) stopRenewal(ctx context.Context, p RenewalState) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		stopped, err := s.repo.StopAutoRenew(ctx, tx, p.ID, "renewal_failed")
		if err != nil || !stopped {
			return err
		}
		if err := s.repo.InsertPassEvent(ctx, tx, PassEvent{PassID: p.ID, CustomerID: p.CustomerID, Kind: EventAutoRenew, Meta: map[string]any{
			"auto_renew": false, "reason": "renewal_failed", "attempts": p.Attempts, "purchase_id": p.PurchaseID,
		}}); err != nil {
			return err
		}
		return s.ports.Notifier.NotifyMember(ctx, tx, p.CustomerID, Notice{
			Type: "gym_pass_renewal", Title: "Perpanjangan otomatis dimatikan",
			Body: p.PackageName + " tidak bisa diperpanjang setelah " + strconv.Itoa(p.Attempts) +
				" percobaan, jadi perpanjangan otomatis kami matikan. Beli pass baru dari menu Dompet.",
		})
	})
}

func purchaseOutcome(status string) string {
	if status == "expired" {
		return "kedaluwarsa sebelum dibayar"
	}
	return "gagal"
}

func renewalNotice(p PassRow, v *MemberPurchaseView) Notice {
	if v.Status == "paid" {
		via := ""
		switch deref(v.PaymentMethod) {
		case "ark_coin":
			via = " dengan ARK Coin (" + pdfgen.Rupiah(v.TotalIdr) + ")"
		case PaySavedMethod:
			via = " dengan metode tersimpan (" + pdfgen.Rupiah(v.TotalIdr) + ")"
		}
		return Notice{
			Type: "gym_pass_renewal", Title: "Pass diperpanjang: " + p.PackageName,
			Body: "Pass baru sudah dibayar" + via + " dan mulai saat pass sekarang berakhir pada " + wibDate(p.EndsAt) + ".",
		}
	}
	if deref(v.PaymentMethod) == PaySavedMethod {
		return Notice{
			Type: "gym_pass_renewal", Title: "Perpanjangan diproses: " + p.PackageName,
			Body: "Kami menagih " + pdfgen.Rupiah(v.TotalIdr) + " ke metode pembayaran tersimpanmu. Kabar berikutnya menyusul setelah pembayaran selesai.",
		}
	}
	return Notice{
		Type: "gym_pass_renewal", Title: "Perpanjang pass kamu: " + p.PackageName,
		Body: "Pass kamu berakhir pada " + wibDate(p.EndsAt) + ". Bayar " + pdfgen.Rupiah(v.TotalIdr) +
			" di menu Dompet supaya langsung lanjut tanpa jeda.",
	}
}

// wibDateTime renders a time in Jakarta time, e.g. "21 Okt 2026 pukul 14.00 WIB".
func wibDateTime(t time.Time) string {
	return wibDate(t) + " pukul " + t.In(wib).Format("15.04") + " WIB"
}
