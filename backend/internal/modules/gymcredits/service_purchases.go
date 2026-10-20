package gymcredits

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	contracts "nuhabit/backend/internal/contracts/gymcredits"
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
	// VoucherCode is a promo code; its discount replaces DiscountIdr.
	VoucherCode string
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
	check := domain.CheckPackagePurchase
	if in.Channel == "front_desk" {
		check = domain.CheckFrontDeskSale
	}
	problem := check(domain.PurchasablePackage{
		ID: pkg.ID, Status: pkg.Status, PurchaseLimitPerMember: pkg.PurchaseLimitPerMember, BranchID: deref(pkg.BranchID),
	}, counts[pkg.ID], active, deref(in.BranchID))
	if problem != "" {
		return nil, fail(http.StatusConflict, domain.PurchaseProblemMessages[problem])
	}
	// The branch the member buys at may price the package differently.
	if in.BranchID != nil {
		price, err := s.repo.BranchPrice(ctx, tx, pkg.ID, *in.BranchID)
		if err != nil {
			return nil, err
		}
		if price != nil {
			pkg.PriceIdr = *price
		}
	}

	if in.VoucherCode != "" {
		quote, err := s.quoteVoucher(ctx, tx, in.CustomerID, in.VoucherCode, pkg.PriceIdr)
		if err != nil {
			return nil, err
		}
		in.DiscountIdr = quote.Discount
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
	if in.VoucherCode != "" {
		if err := s.holdVoucher(ctx, tx, in.CustomerID, in.VoucherCode, pkg.PriceIdr, discount, id); err != nil {
			return nil, err
		}
	}
	return s.repo.Purchase(ctx, tx, id, false)
}

// markPaid marks the purchase paid and issues what it bought in the
// caller's transaction: a credit lot with its top_up entry, or a pass that
// runs for the package validity. A duplicate webhook is safe: the row is
// locked and the second call sees status paid.
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
	if err := s.captureVoucher(ctx, tx, purchaseID); err != nil {
		return false, nil, err
	}
	paidAt = paidAt.Truncate(time.Millisecond)
	if purchase.Kind == KindPass {
		err = s.issuePass(ctx, tx, purchase, paidAt, validityDays, renewsPassID(purchase, meta))
	} else {
		_, _, err = s.GrantCredits(ctx, tx, Grant{
			CustomerID: purchase.CustomerID, Type: domain.TopUp, Credits: purchase.Credits,
			ExpiresAt: domain.LotExpiry(paidAt, validityDays),
			PackageID: purchase.PackageID, PurchaseID: purchaseID, SourceType: "purchase", SourceID: purchaseID,
			Note: purchase.PackageName, IdempotencyKey: topUpKey(purchaseID), CreatedBy: deref(purchase.CreatedBy),
		})
	}
	if err != nil {
		return false, nil, err
	}
	if p, err = s.repo.Purchase(ctx, tx, purchaseID, false); err != nil {
		return false, nil, err
	}
	return false, p, s.publishPurchaseJournal(ctx, tx, p, false, p.TotalIdr, deref(p.CreatedBy))
}

// issuePass inserts the pass a paid purchase bought. It starts at payment,
// or when the member's last live pass ends, so a member who buys early
// loses no days. A renewal keeps the auto-renew choice of the pass it renews.
func (s *Service) issuePass(ctx context.Context, tx database.Querier, purchase *Purchase, paidAt time.Time, validityDays int, renews string) error {
	if err := s.repo.LockMemberCredits(ctx, tx, purchase.CustomerID); err != nil {
		return err
	}
	lastEnd, err := s.repo.LastPassEnd(ctx, tx, purchase.CustomerID)
	if err != nil {
		return err
	}
	start := domain.StackedStart(paidAt, lastEnd)
	pass := NewPass{
		CustomerID: purchase.CustomerID, PackageID: purchase.PackageID, PurchaseID: purchase.ID,
		StartsAt: start, EndsAt: domain.LotExpiry(start, validityDays), RenewWith: RenewWithInvoice,
	}
	if renews != "" {
		prev, err := s.repo.Pass(ctx, tx, renews, false)
		if err != nil {
			return err
		}
		if prev != nil {
			pass.AutoRenew, pass.RenewWith = prev.AutoRenew, prev.RenewWith
		}
	}
	_, err = s.repo.InsertPass(ctx, tx, pass)
	return err
}

// renewsPassID is the pass an auto-renewal purchase renews: stored in its
// payment_meta, or in the meta being written when it is paid at once.
func renewsPassID(p *Purchase, meta map[string]any) string {
	if id, _ := p.meta()["renews_pass_id"].(string); id != "" {
		return id
	}
	id, _ := meta["renews_pass_id"].(string)
	return id
}

const msgArkShort = "Saldo ARK Coin tidak cukup"

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
		return fail(http.StatusConflict, msgArkShort)
	}
	return err
}

// payWithArk debits the ARK Coin balance and issues what was bought; meta
// (non-nil) is added to payment_meta.
func (s *Service) payWithArk(ctx context.Context, tx database.Querier, p *Purchase, actorID *string, meta map[string]any) (*Purchase, error) {
	if err := s.moveArk(ctx, tx, p, -p.TotalIdr, "Beli paket kredit gym: "+p.PackageName, actorID); err != nil {
		return nil, err
	}
	meta["provider"] = "ark_coin"
	_, paid, err := s.markPaid(ctx, tx, p.ID, meta)
	return paid, err
}

// RefundQuoteView is what a refund pays back, shown before confirming. A
// pass offers the prorated amount and the full price; a credit pack pays
// for its unused credits only.
type RefundQuoteView struct {
	PurchaseID    string  `json:"purchase_id"`
	Kind          string  `json:"kind"`
	Credits       int     `json:"credits"`
	PaymentMethod *string `json:"payment_method"`
	FullIdr       float64 `json:"full_idr"`
	domain.RefundQuote
}

// RefundQuote prices the refund of a paid purchase.
func (s *Service) RefundQuote(ctx context.Context, purchaseID string) (*RefundQuoteView, error) {
	purchase, err := s.repo.Purchase(ctx, s.db, purchaseID, false)
	if err != nil {
		return nil, err
	}
	if purchase == nil {
		return nil, fail(http.StatusNotFound, "Pembelian tidak ditemukan")
	}
	if purchase.Status != "paid" {
		return nil, fail(http.StatusConflict, "Hanya pembelian lunas yang bisa direfund")
	}
	quote := domain.RefundQuote{ProratedIdr: purchase.TotalIdr}
	if purchase.Kind != KindPass {
		unused, err := s.unusedCredits(ctx, purchase)
		if err != nil {
			return nil, err
		}
		quote = domain.RefundQuote{UnusedCredits: unused, ProratedIdr: domain.PurchaseRefundIdr(purchase.TotalIdr, purchase.Credits, unused)}
	} else {
		pass, err := s.repo.PassByPurchase(ctx, s.db, purchaseID)
		if err != nil {
			return nil, err
		}
		if pass != nil {
			quote = domain.ProratedRefund(purchase.TotalIdr, pass.state(), s.clock())
		}
	}
	return &RefundQuoteView{
		PurchaseID: purchase.ID, Kind: purchase.Kind, Credits: purchase.Credits, PaymentMethod: purchase.PaymentMethod,
		FullIdr: purchase.TotalIdr, RefundQuote: quote,
	}, nil
}

// RefundPurchase refunds a paid purchase. A credit package gives back the
// credits still unused in its lot and pays price × unused / credits. A pass
// is marked refunded and pays the prorated amount unless full is set; the
// passes queued behind it move up into the days it leaves. ARK Coin goes
// back to the wallet; other methods are paid back by the cashier.
func (s *Service) RefundPurchase(ctx context.Context, tx database.Querier, purchaseID, reason, actorID string, full bool) (*Purchase, error) {
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
	refund, meta := purchase.TotalIdr, map[string]any{}
	if purchase.Kind == KindPass {
		if refund, err = s.refundPass(ctx, tx, purchase, full, actorID); err != nil {
			return nil, err
		}
	} else {
		credits, err := s.takeBackUnusedCredits(ctx, tx, purchase, reason, actorID)
		if err != nil {
			return nil, err
		}
		refund = domain.PurchaseRefundIdr(purchase.TotalIdr, purchase.Credits, credits)
		meta["refund_credits"] = credits
	}
	meta["refund_idr"] = refund
	if err := s.publishPurchaseJournal(ctx, tx, purchase, true, refund, actorID); err != nil {
		return nil, err
	}
	if deref(purchase.PaymentMethod) == "ark_coin" && refund > 0 {
		if err := s.moveArk(ctx, tx, purchase, refund, "Refund paket kredit gym: "+purchase.PackageName, &actorID); err != nil {
			return nil, err
		}
	}
	if err := s.repo.MarkPurchaseRefunded(ctx, tx, purchaseID, "Refund: "+strings.TrimSpace(reason), refund, meta); err != nil {
		return nil, err
	}
	return s.repo.Purchase(ctx, tx, purchaseID, false)
}

// refundPass marks the pass of a purchase refunded, moves the passes queued
// behind it up by the days it had left, and returns the amount to pay back.
// The revenue the daily release already recognised is trued up so the
// deferred revenue of the pass ends at zero: a full refund reverses all of
// it, a prorated one keeps what the used days earned.
func (s *Service) refundPass(ctx context.Context, tx database.Querier, p *Purchase, full bool, actorID string) (float64, error) {
	if err := s.repo.LockPassRevenue(ctx, tx); err != nil {
		return 0, err
	}
	pass, err := s.repo.PassByPurchase(ctx, tx, p.ID)
	if err != nil {
		return 0, err
	}
	now := s.clock()
	amount := p.TotalIdr
	if pass != nil {
		if !full {
			amount = domain.ProratedRefund(p.TotalIdr, pass.state(), now).ProratedIdr
		}
		if pass.Status == domain.PassActive || pass.Status == domain.PassFrozen {
			from := pass.StartsAt
			if now.After(from) {
				from = now
			}
			if left := pass.EndsAt.Sub(from); left > 0 {
				if err := s.repo.ShiftQueuedPasses(ctx, tx, pass.CustomerID, pass.ID, pass.EndsAt, -left); err != nil {
					return 0, err
				}
			}
		}
	}
	if err := s.repo.RefundPassByPurchase(ctx, tx, p.ID); err != nil {
		return 0, err
	}
	released, err := s.repo.PassRevenueReleased(ctx, tx, p.ID)
	if err != nil {
		return 0, err
	}
	company, err := s.repo.PurchaseCompany(ctx, tx, p.ID)
	if err != nil {
		return 0, err
	}
	// Kept revenue is total - amount; released beyond it is reversed, and
	// any shortfall is recognised now.
	journal := contracts.Journal{
		EventCode: "GYM_PASS_REVENUE_REVERSAL", DocumentType: "gym_purchase", DocumentID: p.ID, CompanyID: company,
		UserID: actorID, EntryDate: entryDate(now), Amount: released - (p.TotalIdr - amount),
		Description: "Refund pass gym " + p.PackageName,
	}
	if journal.Amount < 0 {
		journal.EventCode, journal.Amount = "GYM_PASS_REVENUE", -journal.Amount
	}
	return amount, s.publishJournal(ctx, tx, journal)
}

// unusedCredits is what is left of a credit purchase's lot now, without
// writing the expirations a refund would.
func (s *Service) unusedCredits(ctx context.Context, p *Purchase) (int, error) {
	topUpID, err := s.repo.EntryIDByKey(ctx, s.db, topUpKey(p.ID))
	if err != nil || topUpID == "" {
		return p.Credits, err
	}
	topUp, err := s.repo.Entry(ctx, s.db, topUpID)
	if err != nil {
		return 0, err
	}
	state, err := s.loadState(ctx, s.db, p.CustomerID)
	if err != nil {
		return 0, err
	}
	for _, lot := range state.lots {
		if lot.ID == topUp.LotID && !lot.ExpiresAt.After(s.clock()) {
			return 0, nil
		}
	}
	return domain.RemainingIn(domain.LotRemainders(state.lots, state.entries), topUp.LotID), nil
}

// takeBackUnusedCredits reverses the unused part of a credit purchase's
// top-up and returns how many credits it took back.
func (s *Service) takeBackUnusedCredits(ctx context.Context, tx database.Querier, p *Purchase, reason, actorID string) (int, error) {
	topUpID, err := s.repo.EntryIDByKey(ctx, tx, topUpKey(p.ID))
	if err != nil || topUpID == "" {
		return p.Credits, err
	}
	topUp, err := s.repo.Entry(ctx, tx, topUpID)
	if err != nil {
		return 0, err
	}
	if err := s.repo.LockMemberCredits(ctx, tx, p.CustomerID); err != nil {
		return 0, err
	}
	state, _, err := s.expireLapsedLots(ctx, tx, p.CustomerID, s.clock())
	if err != nil {
		return 0, err
	}
	unused := domain.RemainingIn(domain.LotRemainders(state.lots, state.entries), topUp.LotID)
	if unused <= 0 {
		return 0, fail(http.StatusConflict, "Semua kredit dari pembelian ini sudah terpakai atau kedaluwarsa, tidak ada yang bisa direfund")
	}
	_, err = s.repo.InsertEntry(ctx, tx, NewEntry{
		CustomerID: p.CustomerID, Type: domain.Reversal, Amount: -unused, LotID: topUp.LotID,
		SourceType: topUp.SourceType, SourceID: topUp.SourceID, ReversesEntryID: topUp.ID,
		Note: strings.TrimSpace(reason), CreatedBy: actorID,
	})
	return unused, err
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
			result, err = s.payWithArk(ctx, tx, purchase, &sale.CashierID, map[string]any{})
			return err
		}
		_, result, err = s.markPaid(ctx, tx, purchase.ID, map[string]any{"provider": "front_desk", "cashier_id": sale.CashierID})
		return err
	})
	return result, err
}

/* ── Member portal payments ──────────────────────────────────────────── */

// BuyWithArk buys a package with ARK Coin: debit and credits in one
// transaction, at the price of the branch the member buys at.
func (s *Service) BuyWithArk(ctx context.Context, in MemberPurchase) (*MemberPurchaseView, error) {
	var view *MemberPurchaseView
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		purchase, err := s.createPurchase(ctx, tx, purchaseInput{
			CustomerID: in.CustomerID, PackageID: in.PackageID, Channel: "member_portal", PaymentMethod: "ark_coin", BranchID: in.BranchID, VoucherCode: in.VoucherCode,
		})
		if err != nil {
			return err
		}
		paid, err := s.payWithArk(ctx, tx, purchase, nil, in.tag(map[string]any{}))
		if err != nil {
			return err
		}
		view = memberPurchaseView(paid)
		return nil
	})
	return view, err
}

// MemberPurchase is a package bought from the member portal or the public
// checkout: BranchID applies that branch's price. RenewsPassID is set when
// the auto-renew sweep buys it.
type MemberPurchase struct {
	CustomerID   string
	PackageID    string
	BranchID     *string
	RenewsPassID string
	// VoucherCode is an optional promo code ("" for none).
	VoucherCode string
}

// tag adds the renewed pass to the payment_meta being written and returns it.
func (in MemberPurchase) tag(meta map[string]any) map[string]any {
	if in.RenewsPassID != "" {
		meta["renews_pass_id"] = in.RenewsPassID
	}
	return meta
}

// StartQRISPurchase buys a package through a dynamic QRIS. Without an active
// gateway only local dev (the dev-bypass guard) gets a simulated QR.
// callbackURL maps the configured gateway callback ("" when unset) to the
// webhook URL Xendit should call.
func (s *Service) StartQRISPurchase(ctx context.Context, in MemberPurchase, callbackURL func(configured string) string) (*MemberPurchaseView, error) {
	return s.startPendingPurchase(ctx, in, "qris", func(purchase *Purchase, referenceID string) (map[string]any, error) {
		return s.createQR(ctx, purchase, referenceID, callbackURL)
	})
}

// StartInvoicePurchase buys a package through a hosted Xendit invoice: the
// member pays on the invoice URL and lands on redirectURL(purchaseID), the
// status page, which polls until the invoice is paid.
func (s *Service) StartInvoicePurchase(ctx context.Context, in MemberPurchase, redirectURL func(purchaseID string) string) (*MemberPurchaseView, error) {
	if !s.ports.Invoices.InvoiceConfigured() {
		return nil, fail(http.StatusServiceUnavailable, "Pembayaran online belum tersedia: XENDIT_SECRET_KEY belum dikonfigurasi")
	}
	return s.startPendingPurchase(ctx, in, "invoice", func(purchase *Purchase, referenceID string) (map[string]any, error) {
		profile, err := s.ports.Members.Profile(ctx, s.db, purchase.CustomerID)
		if err != nil {
			return nil, err
		}
		payer := "Member"
		if profile != nil && profile.Name != nil && *profile.Name != "" {
			payer = *profile.Name
		}
		inv, err := s.ports.Invoices.CreateInvoice(ctx, InvoiceRequest{
			ExternalID: referenceID, Amount: purchase.TotalIdr, PayerName: payer,
			Description: "Paket " + purchase.PackageName, RedirectURL: redirectURL(purchase.ID),
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"provider": "xendit_invoice", "invoice_id": inv.ID, "invoice_url": inv.URL,
			"expires_at": isoString(inv.ExpiresAt), "simulated": inv.Mock,
		}, nil
	})
}

// startPendingPurchase records the purchase, settles a free one at once,
// else asks the gateway for its payment handle (QR or invoice) and stores it
// in payment_meta under the gymcp_ reference.
func (s *Service) startPendingPurchase(ctx context.Context, in MemberPurchase, method string, handle func(*Purchase, string) (map[string]any, error)) (*MemberPurchaseView, error) {
	referenceID := GymPurchaseRefPrefix + randomHex(12)
	var purchase *Purchase
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		purchase, err = s.createPurchase(ctx, tx, purchaseInput{
			CustomerID: in.CustomerID, PackageID: in.PackageID, Channel: "member_portal", PaymentMethod: method, BranchID: in.BranchID,
			VoucherCode: in.VoucherCode,
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
			_, paid, err = s.markPaid(ctx, tx, purchase.ID, in.tag(map[string]any{"provider": "free"}))
			return err
		})
		if err != nil {
			return nil, err
		}
		return memberPurchaseView(paid), nil
	}

	meta, err := handle(purchase, referenceID)
	if err != nil {
		if closeErr := s.closePurchase(ctx, purchase.ID, "failed"); closeErr != nil {
			s.log.ErrorContext(ctx, "gym-credits: close failed purchase", "purchase_id", purchase.ID, "error", closeErr)
		}
		return nil, err
	}
	if err := s.repo.AttachQR(ctx, s.db, purchase.ID, referenceID, in.tag(meta)); err != nil {
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
// pending it reconciles with Xendit (see reconcilePending). nil means not
// found or not the member's.
func (s *Service) RefreshMemberPurchase(ctx context.Context, customerID, purchaseID string) (*MemberPurchaseView, error) {
	row, err := s.repo.Purchase(ctx, s.db, purchaseID, false)
	if err != nil || row == nil || row.CustomerID != customerID {
		return nil, err
	}
	if row.Status != "pending" {
		return memberPurchaseView(row), nil
	}
	current, err := s.reconcilePending(ctx, row)
	if err != nil {
		return nil, err
	}
	return memberPurchaseView(current), nil
}

// pendingSweepAge leaves a purchase's first minute to the member's own polling.
const (
	pendingSweepAge   = time.Minute
	pendingSweepBatch = 200
)

// ReconcilePendingPurchases is the background twin of the member's polling:
// every QRIS or invoice purchase still pending a minute after it started is
// asked about at Xendit (the webhook can be late or lost), and one past its
// expiry is closed. Front-desk sales without a gateway reference are left
// alone. The errors of single purchases come back joined after the sweep.
func (s *Service) ReconcilePendingPurchases(ctx context.Context, now time.Time) error {
	rows, err := s.repo.PendingGatewayPurchases(ctx, s.db, now.Add(-pendingSweepAge), pendingSweepBatch)
	if err != nil {
		return err
	}
	var errs []error
	for i := range rows {
		if _, err := s.reconcilePending(ctx, &rows[i]); err != nil {
			errs = append(errs, fmt.Errorf("purchase %s: %w", rows[i].ID, err))
		}
	}
	return errors.Join(errs...)
}

// reconcilePending asks Xendit about a pending purchase and settles a paid
// one, then closes a QR or invoice past its expiry. It returns the purchase
// as it stands afterwards. Gateway failures are logged, not returned, so the
// expiry check still runs.
func (s *Service) reconcilePending(ctx context.Context, row *Purchase) (*Purchase, error) {
	meta := row.meta()
	if qrID, _ := meta["qr_id"].(string); qrID != "" {
		settled, err := s.reconcileQR(ctx, row.ID, qrID)
		if err != nil {
			s.log.WarnContext(ctx, "[gym-credits] rekonsiliasi QR gagal", "qr_id", qrID, "error", err)
		} else if settled != nil {
			return settled, nil
		}
	}
	if invoiceID, _ := meta["invoice_id"].(string); invoiceID != "" {
		settled, err := s.reconcileInvoice(ctx, row.ID, invoiceID)
		if err != nil {
			s.log.WarnContext(ctx, "[gym-credits] rekonsiliasi invoice gagal", "invoice_id", invoiceID, "error", err)
		} else if settled != nil {
			return settled, nil
		}
	}
	if requestID, _ := meta["payment_request_id"].(string); requestID != "" {
		// The charge closes only once Xendit has canceled it (see
		// reconcileCharge), so a late success cannot meet a retry.
		settled, err := s.reconcileCharge(ctx, row, requestID)
		if err != nil {
			s.log.WarnContext(ctx, "[gym-credits] rekonsiliasi tagihan metode tersimpan gagal", "purchase_id", row.ID, "error", err)
			return row, nil
		}
		if settled != nil {
			return settled, nil
		}
		return row, nil
	}
	if expiresAt, ok := meta["expires_at"].(string); ok {
		if t, err := time.Parse(time.RFC3339Nano, expiresAt); err == nil && t.Before(s.clock()) {
			if err := s.closePurchase(ctx, row.ID, "expired"); err != nil {
				return nil, err
			}
			return s.repo.Purchase(ctx, s.db, row.ID, false)
		}
	}
	return row, nil
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

// reconcileInvoice asks Xendit for the invoice status and settles a paid
// one; nil means still pending (an expired invoice closes the purchase).
func (s *Service) reconcileInvoice(ctx context.Context, purchaseID, invoiceID string) (*Purchase, error) {
	status, err := s.ports.Invoices.InvoiceStatus(ctx, invoiceID)
	if err != nil {
		return nil, err
	}
	switch status {
	case "PAID", "SETTLED":
	case "EXPIRED":
		if err := s.closePurchase(ctx, purchaseID, "expired"); err != nil {
			return nil, err
		}
		return s.repo.Purchase(ctx, s.db, purchaseID, false)
	default:
		return nil, nil
	}
	var settled *Purchase
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		_, settled, err = s.markPaid(ctx, tx, purchaseID, map[string]any{"xendit_invoice_status": status, "reconciled": true})
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
