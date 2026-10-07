package memberportal

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"

	"nuhabit/backend/internal/modules/memberportal/domain"
)

// TopupView is memberTopupView: what the portal polls.
type TopupView struct {
	ID           string  `json:"id"`
	Status       string  `json:"status"`
	Amount       float64 `json:"amount"`
	CreditIdr    float64 `json:"credit_idr"`
	PackageName  any     `json:"package_name"`
	QRString     any     `json:"qr_string"`
	ExpiresAt    any     `json:"expires_at"`
	Simulated    bool    `json:"simulated"`
	BalanceAfter float64 `json:"balance_after"`
	CreatedAt    jsTime  `json:"created_at"`
}

// metaOrNull is `meta[key] ?? null`.
func metaOrNull(meta map[string]any, key string) any {
	if v, has := meta[key]; has && v != nil {
		return v
	}
	return nil
}

func topupView(row *WalletRow) TopupView {
	bonus := domain.ToNumber(row.Metadata["bonus_idr"])
	v := TopupView{
		ID: row.ID, Status: row.Status, Amount: row.Amount, CreditIdr: row.Amount + bonus,
		PackageName:  metaOrNull(row.Metadata, "package_name"),
		ExpiresAt:    metaOrNull(row.Metadata, "expires_at"),
		Simulated:    row.Metadata["simulated"] == true,
		BalanceAfter: row.BalanceAfter,
		CreatedAt:    row.CreatedAt,
	}
	if row.Status == "pending" {
		v.QRString = metaOrNull(row.Metadata, "qr_string")
	}
	if row.Status == "completed" {
		v.BalanceAfter += bonus
	}
	return v
}

type topupPackageView struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	PriceIdr     float64  `json:"price_idr"`
	CreditIdr    float64  `json:"credit_idr"`
	BonusIdr     float64  `json:"bonus_idr"`
	ValidityDays *float64 `json:"validity_days"`
}

// TopupOptions is GET /topup.
type TopupOptions struct {
	Balance     float64            `json:"balance"`
	ArkRate     float64            `json:"ark_rate"`
	MinAmount   float64            `json:"min_amount"`
	MaxAmount   float64            `json:"max_amount"`
	Presets     []float64          `json:"presets"`
	Packages    []topupPackageView `json:"packages"`
	PendingID   *string            `json:"pending_id"`
	CanSimulate bool               `json:"can_simulate"`
}

var errArkCoinDisabled = &failure{Status: 409, Message: domain.ArkCoinDisabledError, Code: "ARK_COIN_DISABLED"}

// TopupOptions lists online packages, amount limits, balance and the last
// unpaid QR.
func (s *Service) TopupOptions(ctx context.Context, customerID string) (*TopupOptions, error) {
	if !s.wallet.ArkCoinEnabled(ctx) {
		return nil, errArkCoinDisabled
	}
	settings, err := s.wallet.Settings(ctx)
	if err != nil {
		return nil, err
	}
	loyalty, err := s.wallet.LoyaltySettings(ctx)
	if err != nil {
		return nil, err
	}
	packages, err := s.wallet.MemberPackages(ctx)
	if err != nil {
		return nil, err
	}
	balance, _, err := s.wallet.Balance(ctx, customerID)
	if err != nil {
		return nil, err
	}
	pending, err := s.wallet.LatestOpenMemberTopup(ctx, customerID)
	if err != nil {
		return nil, err
	}
	min := settings.TopupMinAmount
	if min < domain.QRISMinAmount {
		min = domain.QRISMinAmount
	}
	out := &TopupOptions{
		Balance: balance, ArkRate: settings.ArkRate, MinAmount: min, MaxAmount: settings.TopupMaxAmount,
		Presets:     domain.FilterPresets(loyalty.TopupPresets, min, settings.TopupMaxAmount),
		Packages:    []topupPackageView{},
		PendingID:   pending,
		CanSimulate: s.bypass().Active(),
	}
	for _, p := range packages {
		out.Packages = append(out.Packages, topupPackageView{
			ID: p.ID, Name: p.Name, Description: p.Description, PriceIdr: p.PriceIdr, CreditIdr: p.CreditIdr,
			BonusIdr: domain.PackageBonus(p.PriceIdr, p.CreditIdr), ValidityDays: p.ValidityDays,
		})
	}
	return out, nil
}

// TopupRequest is a validated POST /topup body: a package or an amount.
type TopupRequest struct {
	PackageID string
	Amount    float64
}

// CreateTopup creates a dynamic Xendit QRIS and a pending top-up; the
// balance moves once it is paid. In local dev without Xendit the QR is
// simulated (same guards as the OTP bypass).
func (s *Service) CreateTopup(ctx context.Context, customerID string, req TopupRequest, webhookURL func(configured string) string) (*TopupView, error) {
	open, err := s.wallet.CountRecentMemberTopups(ctx, customerID)
	if err != nil {
		return nil, err
	}
	if open >= domain.MaxOpenMemberTopups {
		return nil, fail(429, "Terlalu banyak QR yang belum dibayar. Selesaikan atau tunggu 30 menit.")
	}
	settings, err := s.wallet.Settings(ctx)
	if err != nil {
		return nil, err
	}
	amount := req.Amount
	var pkgMeta map[string]any
	var packageID *string
	if req.PackageID != "" {
		pkg, err := s.wallet.PackageForMember(ctx, req.PackageID)
		if err != nil {
			return nil, err
		}
		if pkg == nil {
			return nil, fail(404, "Paket top-up tidak tersedia")
		}
		amount = pkg.PriceIdr
		pkgMeta = map[string]any{
			"package_id": pkg.ID, "package_name": pkg.Name,
			"bonus_idr": domain.PackageBonus(pkg.PriceIdr, pkg.CreditIdr), "validity_days": pkg.ValidityDays,
		}
		packageID = &pkg.ID
	} else {
		min := settings.TopupMinAmount
		if min < domain.QRISMinAmount {
			min = domain.QRISMinAmount
		}
		if problem := domain.CheckFreeAmount(amount, min, settings.TopupMaxAmount); problem != "" {
			return nil, fail(400, problem)
		}
	}
	balance, found, err := s.wallet.Balance(ctx, customerID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fail(404, "Member tidak ditemukan")
	}
	venue := s.repo.DefaultVenue(ctx)
	allowSimulated := s.bypass().Active()

	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return nil, err
	}
	referenceID := "topup_" + hex.EncodeToString(b[:])
	cfg, cfgErr := s.payments.LoadConfig(ctx)
	if cfgErr != nil && !allowSimulated {
		return nil, fail(503, "Pembayaran QRIS belum tersedia: "+cfgErr.Error())
	}
	var qr *XenditQR
	if cfgErr == nil {
		qr, err = s.payments.CreateDynamicQR(ctx, cfg.SecretKey, referenceID, amount, webhookURL(cfg.CallbackURL),
			"ARK topup "+jsNumberString(amount))
		if err != nil {
			return nil, err
		}
	}
	qrString := "DEV-SIMULATED-QRIS-" + referenceID
	expiresAt := isoString(s.now().Add(domain.QRDisplayTTL))
	var xenditStatus any
	provider, environment := "dev_simulated", "local"
	if qr != nil {
		qrString, xenditStatus, provider, environment = qr.QRString, qr.Status, "xendit", cfg.Environment
		if qr.ExpiresAt != "" {
			expiresAt = qr.ExpiresAt
		}
	}
	meta := map[string]any{
		"provider": provider, "environment": environment, "qr_string": qrString, "expires_at": expiresAt,
		"xendit_status": xenditStatus, "source": "member", "simulated": qr == nil,
	}
	for k, v := range pkgMeta {
		meta[k] = v
	}
	var xenditTx *string
	if qr != nil {
		xenditTx = &qr.ID
	}
	row, err := s.wallet.InsertPendingTopup(ctx, NewPendingTopup{
		CustomerID: customerID, Amount: amount, BalanceBefore: balance, ArkRate: settings.ArkRate,
		ReferenceID: referenceID, Notes: "Top-up mandiri member, menunggu pembayaran QRIS",
		Metadata: meta, XenditTransactionID: xenditTx, PackageID: packageID,
		CompanyID: venue.CompanyID, BranchID: venue.BranchID,
	})
	if err != nil {
		return nil, err
	}
	v := topupView(row)
	return &v, nil
}

// TopupStatus is the member's top-up for polling. While pending, the server
// asks Xendit directly (the cashier reconciliation path) so the balance
// lands even when the webhook is late.
func (s *Service) TopupStatus(ctx context.Context, customerID, id string) (*TopupView, error) {
	row, err := s.wallet.MemberTopup(ctx, customerID, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fail(404, "Top-up tidak ditemukan")
	}
	if row.Status == "pending" && row.XenditTransactionID != nil && *row.XenditTransactionID != "" {
		credited, err := s.reconcileTopup(ctx, id)
		if err != nil {
			return nil, err
		}
		if credited {
			if again, err := s.wallet.MemberTopup(ctx, customerID, id); err == nil && again != nil {
				row = again
			} else if err != nil {
				return nil, err
			}
		}
	}
	v := topupView(row)
	return &v, nil
}

// reconcileTopup mirrors reconcilePendingTopup: the QR's payment list is the
// source of truth, the QR object a fallback. Gateway failures only mean
// "still pending".
func (s *Service) reconcileTopup(ctx context.Context, id string) (bool, error) {
	tx, err := s.wallet.TopupForReconcile(ctx, id)
	if err != nil || tx == nil {
		return false, err
	}
	if tx.Status != "pending" || strings.ToLower(tx.PaymentMethod) != "qris" || tx.XenditTransactionID == "" {
		return false, nil
	}
	cfg, err := s.payments.LoadConfig(ctx)
	if err != nil {
		return false, nil
	}
	paymentID, ok := "", false
	if rows, err := s.payments.QRPayments(ctx, cfg.SecretKey, tx.XenditTransactionID); err == nil {
		paymentID, _, ok = domain.PickPaidXenditPayment(rows)
	} else {
		s.log.Warn("[topup-reconcile] gagal baca payments QR", "qr", tx.XenditTransactionID, "error", err.Error())
	}
	if !ok {
		if remote, err := s.payments.QRCode(ctx, cfg.SecretKey, tx.XenditTransactionID); err == nil {
			if domain.IsXenditQrPaid(remote) {
				paymentID = domain.JSString(remote["payment_id"])
				if paymentID == "" {
					paymentID = domain.JSString(remote["id"])
				}
				ok = true
			}
		} else {
			s.log.Warn("[topup-reconcile] gagal baca QR", "qr", tx.XenditTransactionID, "error", err.Error())
		}
	}
	if !ok {
		return false, nil
	}
	outcome, err := s.creditTopup(ctx, id, paymentID, "Top-up QRIS (rekonsiliasi Xendit)")
	if err != nil {
		return false, err
	}
	return outcome.Status == "completed", nil
}

// creditTopup credits the top-up, then awards the top-up XP outside the
// transaction (creditPendingTopup).
func (s *Service) creditTopup(ctx context.Context, id, paymentID, notes string) (CreditOutcome, error) {
	outcome, err := s.wallet.CreditPendingTopup(ctx, id, paymentID, notes)
	if err != nil || outcome.Status != "completed" {
		return outcome, err
	}
	if _, err := s.loyalty.AwardTopupXP(ctx, outcome.CustomerID, outcome.Amount, id); err != nil {
		return outcome, err
	}
	return outcome, nil
}

// SimulateTopupPaid marks a pending top-up paid through the webhook credit
// path. Local dev only: outside the dev-bypass guards it is a 404.
func (s *Service) SimulateTopupPaid(ctx context.Context, customerID, id string) (*TopupView, error) {
	row, err := s.wallet.MemberTopup(ctx, customerID, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fail(404, "Top-up tidak ditemukan")
	}
	if row.Status != "pending" {
		return nil, fail(400, "Top-up tidak dalam status menunggu pembayaran")
	}
	if _, err := s.creditTopup(ctx, id, "dev_sim_"+id, "Top-up QRIS (simulasi dev lokal)"); err != nil {
		return nil, err
	}
	updated, err := s.wallet.MemberTopup(ctx, customerID, id)
	if err != nil || updated == nil {
		return nil, err
	}
	v := topupView(updated)
	return &v, nil
}
