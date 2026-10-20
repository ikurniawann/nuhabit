package gymcredits

import (
	"context"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
)

// Voucher codes on member package purchases. The promo engine of the
// stored-value context decides whether a code applies and how much it takes
// off; this file holds the code for the purchase while it is pending,
// captures it when the purchase is paid and releases it when the purchase
// expires or fails, the way the shop holds promo codes on its orders.

// VoucherContextType is promo_redemptions.context_type of a package purchase.
const VoucherContextType = "gym_purchase"

// VoucherCheck is a code to evaluate for one package price.
type VoucherCheck struct {
	Code       string
	Subtotal   float64
	CustomerID string
	Phone      string
}

// VoucherQuote is the engine's answer: the discount and campaign name, or a
// member-facing Message and the engine's Reason when the code does not apply.
type VoucherQuote struct {
	OK       bool
	Discount float64
	Label    string
	Message  string
	Reason   string
}

// Vouchers is the promo-code port. Hold, Capture and Release run in the
// caller's transaction; Capture and Release are idempotent.
type Vouchers interface {
	Preview(ctx context.Context, q database.Querier, in VoucherCheck) (VoucherQuote, error)
	// Hold claims the code for the purchase; a refusal is a quote with OK false.
	Hold(ctx context.Context, q database.Querier, in VoucherCheck, purchaseID string) (VoucherQuote, error)
	Capture(ctx context.Context, q database.Querier, purchaseID string) error
	Release(ctx context.Context, q database.Querier, purchaseID string) error
}

// VoucherPreviewView is the member's quote for one package.
type VoucherPreviewView struct {
	Code        string  `json:"code"`
	Label       string  `json:"label"`
	PriceIdr    float64 `json:"price_idr"`
	DiscountIdr float64 `json:"discount_idr"`
	TotalIdr    float64 `json:"total_idr"`
}

// voucherCheck builds the engine input; per-member limits count the
// member's phone.
func (s *Service) voucherCheck(ctx context.Context, q database.Querier, customerID, code string, price float64) (VoucherCheck, error) {
	if s.ports.Vouchers == nil {
		return VoucherCheck{}, failCode(http.StatusUnprocessableEntity, "VOUCHER_UNAVAILABLE", "Kode voucher belum bisa dipakai untuk paket kelas", nil)
	}
	profile, err := s.ports.Members.Profile(ctx, q, customerID)
	if err != nil {
		return VoucherCheck{}, err
	}
	if profile == nil {
		return VoucherCheck{}, errMemberNotFound
	}
	return VoucherCheck{Code: strings.TrimSpace(code), Subtotal: price, CustomerID: customerID, Phone: profile.Phone}, nil
}

// voucherRejected is a 422 coded VOUCHER_<REASON> (VOUCHER_REJECTED when
// the engine gave no reason).
func voucherRejected(quote VoucherQuote) error {
	code := "VOUCHER_REJECTED"
	if quote.Reason != "" {
		code = "VOUCHER_" + strings.ToUpper(strings.ReplaceAll(quote.Reason, "-", "_"))
	}
	return failCode(http.StatusUnprocessableEntity, code, quote.Message, nil)
}

// quoteVoucher checks the code against price without claiming it; a code
// that does not apply is a 422 with the engine's message.
func (s *Service) quoteVoucher(ctx context.Context, q database.Querier, customerID, code string, price float64) (VoucherQuote, error) {
	check, err := s.voucherCheck(ctx, q, customerID, code, price)
	if err != nil {
		return VoucherQuote{}, err
	}
	quote, err := s.ports.Vouchers.Preview(ctx, q, check)
	if err != nil {
		return VoucherQuote{}, err
	}
	if !quote.OK {
		return VoucherQuote{}, voucherRejected(quote)
	}
	return quote, nil
}

// holdVoucher claims the code for the new purchase under the engine's lock.
// The purchase was priced with quoteVoucher, so a hold that grants a
// different discount fails the transaction.
func (s *Service) holdVoucher(ctx context.Context, tx database.Querier, customerID, code string, price, discount float64, purchaseID string) error {
	check, err := s.voucherCheck(ctx, tx, customerID, code, price)
	if err != nil {
		return err
	}
	quote, err := s.ports.Vouchers.Hold(ctx, tx, check, purchaseID)
	if err != nil {
		return err
	}
	if !quote.OK {
		return voucherRejected(quote)
	}
	if quote.Discount != discount {
		return failCode(http.StatusConflict, "VOUCHER_CHANGED", "Diskon voucher berubah, coba lagi", nil)
	}
	return nil
}

// captureVoucher makes the purchase's held code final once it is paid.
func (s *Service) captureVoucher(ctx context.Context, tx database.Querier, purchaseID string) error {
	if s.ports.Vouchers == nil {
		return nil
	}
	return s.ports.Vouchers.Capture(ctx, tx, purchaseID)
}

// closePurchase closes a pending purchase as expired or failed and gives
// its voucher code back in the same transaction. A purchase that is no
// longer pending (paid meanwhile) keeps its code.
func (s *Service) closePurchase(ctx context.Context, purchaseID, status string) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		purchase, err := s.repo.Purchase(ctx, tx, purchaseID, true)
		if err != nil || purchase == nil || purchase.Status != "pending" {
			return err
		}
		if err := s.repo.ClosePurchase(ctx, tx, purchaseID, status); err != nil {
			return err
		}
		if s.ports.Vouchers == nil {
			return nil
		}
		return s.ports.Vouchers.Release(ctx, tx, purchaseID)
	})
}

// PreviewVoucher quotes a code for a package at the member's price (the
// branch price when branchID has one) without claiming it.
func (s *Service) PreviewVoucher(ctx context.Context, customerID, packageID, code string, branchID *string) (*VoucherPreviewView, error) {
	pkg, err := s.repo.PackageForPurchase(ctx, s.db, packageID)
	if err != nil {
		return nil, err
	}
	if pkg == nil || pkg.Status != "active" {
		return nil, errPackageNotFound
	}
	price := pkg.PriceIdr
	if branchID != nil {
		branchPrice, err := s.repo.BranchPrice(ctx, s.db, pkg.ID, *branchID)
		if err != nil {
			return nil, err
		}
		if branchPrice != nil {
			price = *branchPrice
		}
	}
	quote, err := s.quoteVoucher(ctx, s.db, customerID, code, price)
	if err != nil {
		return nil, err
	}
	discount, total := domain.PurchaseTotal(price, quote.Discount)
	return &VoucherPreviewView{
		Code: strings.ToUpper(strings.TrimSpace(code)), Label: quote.Label,
		PriceIdr: price, DiscountIdr: discount, TotalIdr: total,
	}, nil
}
