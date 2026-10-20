package app

import (
	"context"
	"errors"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/storedvalue"
	"nuhabit/backend/internal/modules/storedvalue/promo"
	promodomain "nuhabit/backend/internal/modules/storedvalue/promo/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// gymVouchers adapts the stored-value promo service to gym-credits: codes
// of the default CRM venue on the "gym" channel, so campaigns scoped to
// class packages or to every channel apply. A package is no catalog
// product, so campaigns that target products or categories turn it away;
// campaigns may instead target gym packages.
type gymVouchers struct{ s *promo.Service }

var _ gymcredits.Vouchers = gymVouchers{}

const gymVoucherChannel = "gym"

func newGymVouchers(d module.Deps) gymVouchers {
	return gymVouchers{s: storedvalue.NewPromo(d, storedValuePorts(d))}
}

// gymVoucherMessage is the member-facing text of a rejection; the scope and
// product reasons speak of carts and channels, so packages get their own.
func gymVoucherMessage(r promodomain.RejectReason) string {
	switch r {
	case promodomain.RejectScope, promodomain.RejectProductMismatch:
		return "Kode voucher ini tidak berlaku untuk paket kelas"
	case promodomain.RejectPackageMismatch:
		return "Kode voucher ini tidak berlaku untuk paket ini"
	}
	return promodomain.RejectMessages[r]
}

func rejectedVoucher(r promodomain.RejectReason) gymcredits.VoucherQuote {
	return gymcredits.VoucherQuote{Message: gymVoucherMessage(r)}
}

func (v gymVouchers) Preview(ctx context.Context, q database.Querier, in gymcredits.VoucherCheck) (gymcredits.VoucherQuote, error) {
	scope, ok := shopPromo{}.scope(ctx, q)
	if !ok {
		return rejectedVoucher(promodomain.RejectInactive), nil
	}
	res, err := v.s.PreviewPromoCode(ctx, q, promo.PreviewInput{
		Scope: scope, Code: in.Code, Channel: gymVoucherChannel, Subtotal: in.Subtotal, Phone: &in.Phone, CustomerID: &in.CustomerID,
		GymPackageID: in.PackageID,
	})
	if err != nil || !res.OK {
		return rejectedVoucher(res.Reason), err
	}
	return gymcredits.VoucherQuote{OK: true, Discount: res.Discount, Label: res.CampaignName}, nil
}

func (v gymVouchers) Hold(ctx context.Context, q database.Querier, in gymcredits.VoucherCheck, purchaseID string) (gymcredits.VoucherQuote, error) {
	scope, ok := shopPromo{}.scope(ctx, q)
	if !ok {
		return rejectedVoucher(promodomain.RejectInactive), nil
	}
	hold, err := v.s.HoldPromoRedemption(ctx, q, promo.HoldInput{
		Scope: scope, Code: in.Code, Channel: gymVoucherChannel, ContextType: gymcredits.VoucherContextType, ContextID: purchaseID,
		Subtotal: in.Subtotal, Phone: &in.Phone, CustomerID: &in.CustomerID, GymPackageID: in.PackageID,
	})
	if rej, ok := errors.AsType[*promo.PromoRejectedError](err); ok {
		return rejectedVoucher(rej.Reason), nil
	}
	if err != nil {
		return gymcredits.VoucherQuote{}, err
	}
	return gymcredits.VoucherQuote{OK: true, Discount: hold.Discount, Label: hold.CampaignName}, nil
}

func (v gymVouchers) Capture(ctx context.Context, q database.Querier, purchaseID string) error {
	_, err := v.s.CapturePromoRedemption(ctx, q, gymcredits.VoucherContextType, purchaseID)
	return err
}

func (v gymVouchers) Release(ctx context.Context, q database.Querier, purchaseID string) (bool, error) {
	return v.s.ReleasePromoRedemption(ctx, q, gymcredits.VoucherContextType, purchaseID)
}

func (v gymVouchers) Recapture(ctx context.Context, q database.Querier, purchaseID string) (gymcredits.VoucherRecapture, error) {
	result, err := v.s.RecapturePromoRedemption(ctx, q, gymcredits.VoucherContextType, purchaseID)
	return gymcredits.VoucherRecapture(result), err
}
