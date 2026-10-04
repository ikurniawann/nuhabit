package gymcredits

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
)

// Purchase lifecycle: pending -> paid -> refunded. Money and credits are
// separate: a paid purchase PRODUCES a top_up entry and its lot; it never
// changes a balance itself.

// GymPurchaseRefPrefix prefixes the QRIS reference_id of package purchases;
// the Xendit webhook branches on it.
const GymPurchaseRefPrefix = "gymcp_"

// IsGymPurchaseReference reports whether a Xendit reference_id is a gym purchase.
func IsGymPurchaseReference(referenceID string) bool {
	return strings.HasPrefix(referenceID, GymPurchaseRefPrefix)
}

const qrDisplayTTL = 30 * time.Minute

func topUpKey(purchaseID string) string { return "gym-purchase:" + purchaseID }

// purchaseInput is createCreditPurchase's input.
type purchaseInput struct {
	CustomerID    string
	PackageID     string
	Channel       string // member_portal | front_desk
	PaymentMethod string
	DiscountIdr   float64
	BranchID      *string
	Note          *string
	CreatedBy     *string
}

// createPurchase records a pending purchase after the package eligibility rules.
func (s *Service) createPurchase(ctx context.Context, tx database.Querier, in purchaseInput) (*Purchase, error) {
	pkg, err := s.repo.PackageForPurchase(ctx, tx, in.PackageID)
	if err != nil {
		return nil, err
	}
	active, found, err := s.ports.Members.LockForPurchase(ctx, tx, in.CustomerID)
	if err != nil {
		return nil, err
	}
	if pkg == nil {
		return nil, fail(http.StatusNotFound, "Paket tidak ditemukan")
	}
	if !found {
		return nil, fail(http.StatusNotFound, "Member tidak ditemukan")
	}
	counts, err := s.repo.LivePurchaseCounts(ctx, tx, in.CustomerID)
	if err != nil {
		return nil, err
	}
	problem := domain.CheckPackagePurchase(domain.PurchasablePackage{
		ID: pkg.ID, Status: pkg.Status, PurchaseLimitPerMember: pkg.PurchaseLimitPerMember, BranchID: deref(pkg.BranchID),
	}, counts[pkg.ID], active, deref(in.BranchID))
	if problem != "" {
		return nil, fail(http.StatusConflict, domain.PurchaseProblemMessages[problem])
	}

	discount, total := domain.PurchaseTotal(pkg.PriceIdr, in.DiscountIdr)
	var note *string
	if in.Note != nil && strings.TrimSpace(*in.Note) != "" {
		trimmed := strings.TrimSpace(*in.Note)
		note = &trimmed
	}
	id, err := s.repo.InsertPurchase(ctx, tx, NewPurchase{
		CustomerID: in.CustomerID, PackageID: pkg.ID, Credits: pkg.Credits, PriceIdr: pkg.PriceIdr,
		DiscountIdr: discount, TotalIdr: total, Channel: in.Channel, PaymentMethod: in.PaymentMethod,
		BranchID: in.BranchID, Note: note, CreatedBy: in.CreatedBy,
	})
	if err != nil {
		return nil, err
	}
	return s.repo.Purchase(ctx, tx, id, false)
}

// markPaid marks the purchase paid and issues its credits (top_up + lot) in
// the caller's transaction. A duplicate webhook is safe: the row is locked
// and the second call sees status paid.
func (s *Service) markPaid(ctx context.Context, tx database.Querier, purchaseID string, meta map[string]any) (alreadyPaid bool, p *Purchase, err error) {
	purchase, err := s.repo.Purchase(ctx, tx, purchaseID, true)
	if err != nil {
		return false, nil, err
	}
	if purchase == nil {
		return false, nil, fail(http.StatusNotFound, "Pembelian tidak ditemukan")
	}
	if purchase.Status == "paid" {
		return true, purchase, nil
	}
	// A QR we marked expired can still be paid at the gateway: money that
	// really arrived still issues credits. Only a refund is final.
	if purchase.Status == "refunded" {
		return false, nil, fail(http.StatusConflict, "Pembelian yang sudah direfund tidak bisa dilunasi")
	}
	paidAt, validityDays, err := s.repo.MarkPurchasePaid(ctx, tx, purchaseID, meta)
	if err != nil {
		return false, nil, err
	}
	if _, _, err := s.GrantCredits(ctx, tx, Grant{
		CustomerID: purchase.CustomerID, Type: domain.TopUp, Credits: purchase.Credits,
		ExpiresAt: domain.LotExpiry(paidAt.Truncate(time.Millisecond), validityDays),
		PackageID: purchase.PackageID, PurchaseID: purchaseID, SourceType: "purchase", SourceID: purchaseID,
		Note: purchase.PackageName, IdempotencyKey: topUpKey(purchaseID), CreatedBy: deref(purchase.CreatedBy),
	}); err != nil {
		return false, nil, err
	}
	p, err = s.repo.Purchase(ctx, tx, purchaseID, false)
	return false, p, err
}

// moveArk changes the ARK Coin balance for a purchase; the wallet keeps the
// balance from going negative.
func (s *Service) moveArk(ctx context.Context, tx database.Querier, p *Purchase, delta float64, notes string, actorID *string) error {
	err := s.ports.Wallet.Move(ctx, tx, ArkMove{
		CustomerID: p.CustomerID, Delta: delta, Notes: notes, PurchaseID: p.ID, BranchID: p.BranchID, ActorID: actorID,
	})
	switch {
	case errors.Is(err, ErrArkMemberNotFound):
		return fail(http.StatusNotFound, "Member tidak ditemukan")
	case errors.Is(err, ErrArkInsufficient):
		return fail(http.StatusConflict, "Saldo ARK Coin tidak cukup")
	}
	return err
}

// payWithArk debits the ARK Coin balance and issues the credits.
func (s *Service) payWithArk(ctx context.Context, tx database.Querier, p *Purchase, actorID *string) (*Purchase, error) {
	if err := s.moveArk(ctx, tx, p, -p.TotalIdr, "Beli paket kredit gym: "+p.PackageName, actorID); err != nil {
		return nil, err
	}
	_, paid, err := s.markPaid(ctx, tx, p.ID, map[string]any{"provider": "ark_coin"})
	return paid, err
}

// RefundPurchase refunds a paid purchase: status refunded plus a reversal of
// its top_up. Used credits make the balance short and the reversal fails.
// ARK Coin goes back to the wallet; other methods are paid back by the cashier.
func (s *Service) RefundPurchase(ctx context.Context, tx database.Querier, purchaseID, reason, actorID string) (*Purchase, error) {
	purchase, err := s.repo.Purchase(ctx, tx, purchaseID, true)
	if err != nil {
		return nil, err
	}
	if purchase == nil {
		return nil, fail(http.StatusNotFound, "Pembelian tidak ditemukan")
	}
	if purchase.Status != "paid" {
		return nil, fail(http.StatusConflict, "Hanya pembelian lunas yang bisa direfund")
	}
	entryID, err := s.repo.EntryIDByKey(ctx, tx, topUpKey(purchaseID))
	if err != nil {
		return nil, err
	}
	if entryID != "" {
		if _, err := s.Reverse(ctx, tx, entryID, reason, actorID); err != nil {
			return nil, err
		}
	}
	if deref(purchase.PaymentMethod) == "ark_coin" && purchase.TotalIdr > 0 {
		if err := s.moveArk(ctx, tx, purchase, purchase.TotalIdr, "Refund paket kredit gym: "+purchase.PackageName, &actorID); err != nil {
			return nil, err
		}
	}
	if err := s.repo.MarkPurchaseRefunded(ctx, tx, purchaseID, "Refund: "+strings.TrimSpace(reason)); err != nil {
		return nil, err
	}
	return s.repo.Purchase(ctx, tx, purchaseID, false)
}

// FrontDeskSale is a package sold at the front desk.
type FrontDeskSale struct {
	CustomerID    string
	PackageID     string
	PaymentMethod string
	DiscountIdr   float64
	BranchID      *string
	Note          *string
	CashierID     string
}

// SellPackage sells at the front desk: money is taken at the till (or from
// ARK Coin), so the purchase is paid and the credits issued at once.
func (s *Service) SellPackage(ctx context.Context, sale FrontDeskSale) (*Purchase, error) {
	var result *Purchase
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		discount := sale.DiscountIdr
		if sale.PaymentMethod == "complimentary" {
			// Complimentary = full discount (capped at the price by PurchaseTotal).
			discount = math.MaxFloat64
		}
		purchase, err := s.createPurchase(ctx, tx, purchaseInput{
			CustomerID: sale.CustomerID, PackageID: sale.PackageID, Channel: "front_desk", PaymentMethod: sale.PaymentMethod,
			DiscountIdr: discount, BranchID: sale.BranchID, Note: sale.Note, CreatedBy: &sale.CashierID,
		})
		if err != nil {
			return err
		}
		if sale.PaymentMethod == "ark_coin" {
			result, err = s.payWithArk(ctx, tx, purchase, &sale.CashierID)
			return err
		}
		_, result, err = s.markPaid(ctx, tx, purchase.ID, map[string]any{"provider": "front_desk", "cashier_id": sale.CashierID})
		return err
	})
	return result, err
}

/* ── Member portal payments ──────────────────────────────────────────── */

// BuyWithArk buys a package with ARK Coin: debit and credits in one transaction.
func (s *Service) BuyWithArk(ctx context.Context, customerID, packageID string) (*MemberPurchaseView, error) {
	var view *MemberPurchaseView
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		purchase, err := s.createPurchase(ctx, tx, purchaseInput{
			CustomerID: customerID, PackageID: packageID, Channel: "member_portal", PaymentMethod: "ark_coin",
		})
		if err != nil {
			return err
		}
		paid, err := s.payWithArk(ctx, tx, purchase, nil)
		if err != nil {
			return err
		}
		view = memberPurchaseView(paid)
		return nil
	})
	return view, err
}

// StartQRISPurchase buys a package through a dynamic QRIS. Without an active
// gateway only local dev (the dev-bypass guard) gets a simulated QR.
// callbackURL maps the configured gateway callback ("" when unset) to the
// webhook URL Xendit should call.
func (s *Service) StartQRISPurchase(ctx context.Context, customerID, packageID string, callbackURL func(configured string) string) (*MemberPurchaseView, error) {
	referenceID := GymPurchaseRefPrefix + randomHex(12)
	var purchase *Purchase
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		purchase, err = s.createPurchase(ctx, tx, purchaseInput{
			CustomerID: customerID, PackageID: packageID, Channel: "member_portal", PaymentMethod: "qris",
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	if purchase.TotalIdr <= 0 {
		var paid *Purchase
		err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
			var err error
			_, paid, err = s.markPaid(ctx, tx, purchase.ID, map[string]any{"provider": "free"})
			return err
		})
		if err != nil {
			return nil, err
		}
		return memberPurchaseView(paid), nil
	}

	meta, err := s.createQR(ctx, purchase, referenceID, callbackURL)
	if err != nil {
		if closeErr := s.repo.ClosePurchase(ctx, s.db, purchase.ID, "failed"); closeErr != nil {
			s.log.ErrorContext(ctx, "gym-credits: close failed purchase", "purchase_id", purchase.ID, "error", closeErr)
		}
		return nil, err
	}
	if err := s.repo.AttachQR(ctx, s.db, purchase.ID, referenceID, meta); err != nil {
		return nil, err
	}
	reloaded, err := s.repo.Purchase(ctx, s.db, purchase.ID, false)
	if err != nil {
		return nil, err
	}
	return memberPurchaseView(reloaded), nil
}

func (s *Service) createQR(ctx context.Context, purchase *Purchase, referenceID string, callbackURL func(string) string) (map[string]any, error) {
	config, err := s.ports.Gateway.ActiveConfig(ctx, s.db)
	if err != nil {
		if !s.canSimulate() {
			return nil, fail(http.StatusServiceUnavailable, "Pembayaran QRIS belum tersedia: "+err.Error())
		}
		config = nil
	}
	var qr *QRCode
	if config != nil {
		qr, err = s.ports.Gateway.CreateDynamicQR(ctx, QRRequest{
			SecretKey: config.SecretKey, ReferenceID: referenceID, Amount: purchase.TotalIdr,
			CallbackURL: callbackURL(config.CallbackURL), Description: "Paket kredit " + purchase.PackageName,
		})
		if err != nil {
			return nil, err
		}
	}
	if qr == nil {
		return map[string]any{
			"provider": "dev_simulated", "environment": "local", "qr_id": nil,
			"qr_string": "DEV-SIMULATED-QRIS-" + referenceID, "expires_at": isoString(s.clock().Add(qrDisplayTTL)), "simulated": true,
		}, nil
	}
	expiresAt := qr.ExpiresAt
	if expiresAt == "" {
		expiresAt = isoString(s.clock().Add(qrDisplayTTL))
	}
	return map[string]any{
		"provider": "xendit", "environment": config.Environment, "qr_id": qr.ID,
		"qr_string": qr.QRString, "expires_at": expiresAt, "simulated": false,
	}, nil
}

// SettleResult is the outcome of a gateway payment notification.
type SettleResult struct {
	Status     string `json:"status"` // not_found | paid | already_paid
	PurchaseID string `json:"purchase_id,omitempty"`
}

// SettleByReference marks the purchase with a QRIS reference_id paid. The
// Xendit webhook (still in TS: /api/payments/xendit/webhook) calls the TS
// twin of this for gymcp_ references; it is exposed here for when the
// webhook moves to Go.
func (s *Service) SettleByReference(ctx context.Context, referenceID string, paymentID *string) (*SettleResult, error) {
	var result *SettleResult
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		id, err := s.repo.PurchaseIDByReference(ctx, tx, referenceID)
		if err != nil {
			return err
		}
		if id == "" {
			result = &SettleResult{Status: "not_found"}
			return nil
		}
		var payment any
		if paymentID != nil {
			payment = *paymentID
		}
		already, _, err := s.markPaid(ctx, tx, id, map[string]any{"xendit_payment_id": payment})
		if err != nil {
			return err
		}
		result = &SettleResult{Status: "paid", PurchaseID: id}
		if already {
			result.Status = "already_paid"
		}
		return nil
	})
	return result, err
}

// paidStatuses are the Xendit payment statuses that mean money arrived.
var paidStatuses = map[string]bool{"SUCCEEDED": true, "SUCCESS": true, "COMPLETED": true, "PAID": true}

// pickPaidPayment returns the id of the first successful payment, or "".
func pickPaidPayment(rows []map[string]any) (string, bool) {
	for _, row := range rows {
		if !paidStatuses[strings.ToUpper(jsString(row["status"]))] {
			continue
		}
		id := jsString(row["id"])
		if id == "" {
			id = jsString(row["payment_id"])
		}
		return id, true
	}
	return "", false
}

// jsString is String(v || "") for the JSON scalars a gateway sends.
func jsString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		if x == 0 {
			return ""
		}
		return jsNum(x)
	case bool:
		if x {
			return "true"
		}
	}
	return ""
}

// RefreshMemberPurchase is the member's purchase status for polling. While
// pending it asks Xendit directly (the webhook can be late) and closes a QR
// past its expiry. nil means not found or not the member's.
func (s *Service) RefreshMemberPurchase(ctx context.Context, customerID, purchaseID string) (*MemberPurchaseView, error) {
	row, err := s.repo.Purchase(ctx, s.db, purchaseID, false)
	if err != nil || row == nil || row.CustomerID != customerID {
		return nil, err
	}
	if row.Status != "pending" {
		return memberPurchaseView(row), nil
	}
	meta := row.meta()
	if qrID, _ := meta["qr_id"].(string); qrID != "" {
		settled, err := s.reconcileQR(ctx, purchaseID, qrID)
		if err != nil {
			s.log.WarnContext(ctx, "[gym-credits] rekonsiliasi QR gagal", "qr_id", qrID, "error", err)
		} else if settled != nil {
			return memberPurchaseView(settled), nil
		}
	}
	if expiresAt, ok := meta["expires_at"].(string); ok {
		if t, err := time.Parse(time.RFC3339Nano, expiresAt); err == nil && t.Before(s.clock()) {
			if err := s.repo.ClosePurchase(ctx, s.db, purchaseID, "expired"); err != nil {
				return nil, err
			}
			reloaded, err := s.repo.Purchase(ctx, s.db, purchaseID, false)
			if err != nil {
				return nil, err
			}
			return memberPurchaseView(reloaded), nil
		}
	}
	return memberPurchaseView(row), nil
}

func (s *Service) reconcileQR(ctx context.Context, purchaseID, qrID string) (*Purchase, error) {
	config, err := s.ports.Gateway.ActiveConfig(ctx, s.db)
	if err != nil {
		return nil, err
	}
	payments, err := s.ports.Gateway.QRPayments(ctx, config.SecretKey, qrID)
	if err != nil {
		return nil, err
	}
	paymentID, paid := pickPaidPayment(payments)
	if !paid {
		return nil, nil
	}
	var settled *Purchase
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		_, settled, err = s.markPaid(ctx, tx, purchaseID, map[string]any{"xendit_payment_id": paymentID, "reconciled": true})
		return err
	})
	return settled, err
}

// SimulatePaid settles a simulated QR through the webhook path (local dev
// only; the handler checks the guard). nil means not found.
func (s *Service) SimulatePaid(ctx context.Context, customerID, purchaseID string) (*MemberPurchaseView, error) {
	row, err := s.repo.Purchase(ctx, s.db, purchaseID, false)
	if err != nil || row == nil || row.CustomerID != customerID {
		return nil, err
	}
	var paid *Purchase
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		_, paid, err = s.markPaid(ctx, tx, purchaseID, map[string]any{"xendit_payment_id": "dev_sim_" + purchaseID})
		return err
	})
	if err != nil {
		return nil, err
	}
	return memberPurchaseView(paid), nil
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
