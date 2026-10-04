package app

import (
	"context"
	"errors"
	"strconv"

	"nuhabit/backend/internal/modules/possales/offers"
	"nuhabit/backend/internal/modules/storedvalue"
	"nuhabit/backend/internal/modules/storedvalue/promo"
	promodomain "nuhabit/backend/internal/modules/storedvalue/promo/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// possalesOffers is the POS offer and promo-code backend: the stored-value
// promo service with pos-sales types. Every call runs on the caller's
// Querier, so the sale flow claims inside its own transaction.
type possalesOffers struct{ s *promo.Service }

var _ offers.Backend = possalesOffers{}

func newPossalesOffers(d module.Deps) possalesOffers {
	return possalesOffers{s: storedvalue.NewPromo(d, storedValuePorts(d))}
}

/* ── offers ──────────────────────────────────────────────────────────── */

func (o possalesOffers) FindByUnlockCode(ctx context.Context, q database.Querier, companyID, branchID, code string) (*offers.UnlockedOffer, error) {
	found, err := o.s.FindOfferByUnlockCode(ctx, q, promo.UnlockCodeInput{
		CompanyID: companyID, BranchID: branchID, Code: code, TodayISODate: o.s.TodayJakarta(),
	})
	if found == nil || err != nil {
		return nil, err
	}
	return &offers.UnlockedOffer{ID: found.ID, Name: found.Name}, nil
}

func (o possalesOffers) ActiveRules(ctx context.Context, q database.Querier, companyID, branchID, customerID string) ([]offers.ActiveRule, error) {
	details, rules, err := o.s.LoadActiveOfferEvalRules(ctx, q, companyID, branchID, optional(customerID))
	if err != nil {
		return nil, err
	}
	evalByID := make(map[string]promodomain.OfferEvalRule, len(rules))
	for _, r := range rules {
		evalByID[r.ID] = r
	}
	out := make([]offers.ActiveRule, len(details))
	for i, d := range details {
		items := make([]offers.RuleItem, len(d.Items))
		for j, it := range d.Items {
			qty, _ := strconv.ParseFloat(it.Qty, 64)
			items[j] = offers.RuleItem{Role: it.Role, ProductID: it.ProductID, Qty: qty, ProductName: it.ProductName, CategoryName: it.CategoryName}
		}
		out[i] = offers.ActiveRule{
			ID: d.ID, OfferType: d.OfferType, Name: d.Name, Description: d.Description,
			ValidFrom: d.ValidFrom, ValidUntil: d.ValidUntil, BundlePrice: numeric(d.BundlePrice),
			BuyQty: d.BuyQty, GetQty: d.GetQty, GetMode: d.GetMode, VolumeBasis: d.VolumeBasis,
			VolumeMin: numeric(d.VolumeMin), DiscountType: d.DiscountType, DiscountValue: numeric(d.DiscountValue),
			RequiresCode: d.UnlockCode != nil && *d.UnlockCode != "", IsExclusive: d.IsExclusive, Items: items,
		}
		if eval, ok := evalByID[d.ID]; ok {
			out[i].Eval = eval
		}
	}
	return out, nil
}

func strValue(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// numeric parses a numeric column read as text.
func numeric(s *string) *float64 {
	if s == nil {
		return nil
	}
	v, _ := strconv.ParseFloat(*s, 64)
	return &v
}

func (o possalesOffers) EvaluateForPosCart(ctx context.Context, q database.Querier, companyID, branchID *string, items []offers.CartLine, code, customerID string) (offers.CartEvaluation, error) {
	cart := make([]promodomain.OfferCartLine, len(items))
	for i, l := range items {
		cart[i] = promodomain.OfferCartLine{ProductID: l.ProductID, Quantity: l.Quantity, UnitPrice: l.UnitPrice}
	}
	res, err := o.s.EvaluateActiveOffersForPosCart(ctx, q, promo.PosCartInput{
		CompanyID: strValue(companyID), BranchID: strValue(branchID), Items: cart, Code: code, CustomerID: optional(customerID),
	})
	return offers.CartEvaluation{OfferDiscount: res.OfferDiscount, Applied: toPosApplied(res.Applied), UnlockedRuleID: res.UnlockedRuleID}, err
}

func (o possalesOffers) RecordUsage(ctx context.Context, q database.Querier, in offers.UsageInput) error {
	applied := make([]promodomain.AppliedOffer, len(in.Applied))
	for i, a := range in.Applied {
		applied[i] = promodomain.AppliedOffer{RuleID: a.RuleID, OfferType: a.OfferType, Name: a.Name, Discount: a.Discount}
	}
	err := o.s.RecordOfferUsage(ctx, q, promo.RecordOfferUsageInput{
		CompanyID: in.CompanyID, BranchID: in.BranchID, OrderID: in.OrderID, CustomerID: optional(in.CustomerID),
		Applied: applied, Status: in.Status, Enforce: in.Enforce,
	})
	if capErr, ok := errors.AsType[*promo.OfferCapReachedError](err); ok {
		return &offers.CapReachedError{OfferName: capErr.OfferName}
	}
	return err
}

func (o possalesOffers) CaptureUsage(ctx context.Context, q database.Querier, orderID string) error {
	return o.s.CaptureOfferUsage(ctx, q, orderID)
}

func (o possalesOffers) ReleaseUsage(ctx context.Context, q database.Querier, orderID string) error {
	return o.s.ReleaseOfferUsage(ctx, q, orderID)
}

func toPosApplied(applied []promodomain.AppliedOffer) []offers.AppliedOffer {
	out := make([]offers.AppliedOffer, len(applied))
	for i, a := range applied {
		out[i] = offers.AppliedOffer{RuleID: a.RuleID, OfferType: a.OfferType, Name: a.Name, Discount: a.Discount}
		if a.FreeUnits != nil {
			out[i].FreeUnits = make([]offers.FreeUnit, len(a.FreeUnits))
			for j, f := range a.FreeUnits {
				out[i].FreeUnits[j] = offers.FreeUnit{ProductID: f.ProductID, Qty: f.Qty, UnitPrice: f.UnitPrice}
			}
		}
	}
	return out
}

/* ── promo codes ─────────────────────────────────────────────────────── */

func (o possalesOffers) PreviewPromo(ctx context.Context, q database.Querier, in offers.PreviewInput) (offers.PromoPreview, error) {
	p, err := o.s.PreviewPromoCode(ctx, q, promo.PreviewInput{
		Scope: promo.VenueScope{CompanyID: in.CompanyID, BranchID: in.BranchID}, Code: in.Code, Channel: in.Channel,
		Subtotal: in.Subtotal, Lines: toPromoLines(in.Lines), CustomerID: optional(in.CustomerID),
	})
	return offers.PromoPreview{
		OK: p.OK, Discount: p.Discount, CampaignName: p.CampaignName, DiscountType: p.DiscountType,
		Reason: string(p.Reason), Message: p.Message, Label: promodomain.RejectLabels[p.Reason],
	}, err
}

func (o possalesOffers) HoldPromo(ctx context.Context, q database.Querier, in offers.HoldInput) (*offers.PromoHold, error) {
	hold, err := o.s.HoldPromoRedemption(ctx, q, promo.HoldInput{
		Scope: promo.VenueScope{CompanyID: in.CompanyID, BranchID: in.BranchID}, Code: in.Code, Channel: in.Channel,
		ContextType: in.ContextType, ContextID: in.ContextID, Subtotal: in.Subtotal,
		CustomerID: optional(in.CustomerID), Lines: toPromoLines(in.Lines),
	})
	if rej, ok := errors.AsType[*promo.PromoRejectedError](err); ok {
		return nil, &offers.PromoRejectedError{Reason: string(rej.Reason), Message: rej.Error()}
	}
	if err != nil {
		return nil, err
	}
	return &offers.PromoHold{RedemptionID: hold.RedemptionID, CodeID: hold.CodeID, CampaignName: hold.CampaignName, Discount: hold.Discount}, nil
}

func (o possalesOffers) CapturePromo(ctx context.Context, q database.Querier, contextType, contextID string) error {
	_, err := o.s.CapturePromoRedemption(ctx, q, contextType, contextID)
	return err
}

func (o possalesOffers) ReleasePromo(ctx context.Context, q database.Querier, contextType, contextID string) error {
	_, err := o.s.ReleasePromoRedemption(ctx, q, contextType, contextID)
	return err
}

// toPromoLines keeps nil (lines not sent) apart from an empty list.
func toPromoLines(lines []offers.PromoLineInput) []promo.LineInput {
	if lines == nil {
		return nil
	}
	out := make([]promo.LineInput, len(lines))
	for i, l := range lines {
		out[i] = promo.LineInput{ProductID: l.ProductID, Amount: l.Amount}
	}
	return out
}
