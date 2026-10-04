package xp

import (
	"context"
	"math"
	"strconv"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp/domain"
	"nuhabit/backend/internal/platform/database"
)

// PosOrder is the XP payload of one paid POS order (PosOrderXpPayload).
type PosOrder struct {
	OrderID       string
	CustomerID    string
	TotalAmount   float64
	Items         []domain.Item
	OutletID      *string
	PaymentMethod string
}

var (
	noCustomer     = Result{Status: "skipped", Reason: "no_customer"}
	nonArk         = Result{Status: "skipped", Reason: "non_ark_payment"}
	schemaNotReady = Result{Status: "skipped", Reason: "crm_schema_not_ready"}
)

// failure mirrors xpFailure: a missing CRM schema is skipped, anything else
// is logged and reported as status "error". XP never fails the sale.
func (e *Engine) failure(err error, label string) Result {
	if kit.IsMissingCrmSchema(err) {
		return schemaNotReady
	}
	e.log().Error(label, "error", err)
	return Result{Status: "error", Reason: err.Error()}
}

// savepoint runs fn in a nested transaction so a failure leaves db usable.
func savepoint(ctx context.Context, db database.DB, fn func(tx database.DB) (Result, error)) (Result, error) {
	var res Result
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		var err error
		res, err = fn(tx)
		return err
	})
	return res, err
}

// AwardPosOrder mirrors awardCrmXpForPosOrder: product bonus XP (any payment
// method) plus spend XP (ARK Coin only).
func (e *Engine) AwardPosOrder(ctx context.Context, db database.DB, in PosOrder) Result {
	if in.CustomerID == "" {
		return noCustomer
	}
	bonus := e.awardProductBonus(ctx, db, in)
	spend := e.awardSpend(ctx, db, in)
	if bonus.XPAwarded <= 0 {
		return spend
	}
	return Result{Status: "posted", XPAwarded: spend.XPAwarded + bonus.XPAwarded, LedgerIDs: append(append([]string{}, spend.LedgerIDs...), bonus.LedgerIDs...)}
}

func productIDs(items []domain.Item) []string {
	seen := map[string]bool{}
	var out []string
	for _, it := range items {
		if it.ProductID != "" && !seen[it.ProductID] {
			seen[it.ProductID] = true
			out = append(out, it.ProductID)
		}
	}
	return out
}

func (e *Engine) orderLabel(ctx context.Context, q database.Querier, orderID string) string {
	if n := e.Pos.OrderNumber(ctx, q, orderID); n != "" {
		return "#" + n
	}
	if len(orderID) > 8 {
		return orderID[:8]
	}
	return orderID
}

func (e *Engine) awardProductBonus(ctx context.Context, db database.DB, in PosOrder) Result {
	res, err := savepoint(ctx, db, func(tx database.DB) (Result, error) {
		ids := productIDs(in.Items)
		if len(ids) == 0 {
			return Result{Status: "skipped"}, nil
		}
		bonus, err := e.Pos.ProductBonusXP(ctx, tx, ids)
		if err != nil {
			return Result{}, err
		}
		lines := make([]domain.BonusLine, len(in.Items))
		for i, it := range in.Items {
			q := 0.0
			if it.Quantity != nil {
				q = *it.Quantity
			}
			lines[i] = domain.BonusLine{ProductID: it.ProductID, Quantity: q}
		}
		amount := domain.ComputeProductBonusXP(lines, bonus)
		if amount <= 0 {
			return Result{Status: "skipped"}, nil
		}
		v := kit.DefaultVenue(ctx, tx)
		branch := v.BranchID
		if in.OutletID != nil {
			branch = in.OutletID
		}
		return e.AwardFlat(ctx, tx, FlatAward{
			CustomerID: in.CustomerID, XPAmount: amount, CompanyID: v.CompanyID, BranchID: branch,
			SourceType: "product_bonus", SourceID: in.OrderID, ReferenceTable: "pos_orders",
			IdempotencyKey: "pos:order:" + in.OrderID + ":product_bonus",
			Description:    "Bonus XP produk — order " + e.orderLabel(ctx, tx, in.OrderID),
		})
	})
	if err != nil {
		if kit.IsMissingCrmSchema(err) {
			return Result{Status: "skipped"}
		}
		e.log().Error("CRM product bonus XP failed", "error", err)
		return Result{Status: "error"}
	}
	return res
}

// loadRules is the active POS rules in priority order; nil when the CRM
// schema is missing.
func loadRules(ctx context.Context, q database.Querier) ([]domain.Rule, error) {
	rows, err := q.Query(ctx, `SELECT id::text, source_type, source_id, outlet_scope, outlet_id::text, xp_mode,
		xp_value::float8, amount_step::float8, min_amount::float8, max_xp_per_event::float8, tier_multiplier_enabled,
		starts_at, ends_at
		FROM crm.crm_xp_rules WHERE source_channel = 'pos' AND is_active = true ORDER BY priority ASC`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Rule, error) {
		var x domain.Rule
		err := r.Scan(&x.ID, &x.SourceType, &x.SourceID, &x.OutletScope, &x.OutletID, &x.XPMode, &x.XPValue,
			&x.AmountStep, &x.MinAmount, &x.MaxXPPerEvent, &x.TierMultiplierEnabled, &x.StartsAt, &x.EndsAt)
		return x, err
	})
}

// orderAmountXP mirrors resolveOrderAmountXp.
func (e *Engine) orderAmountXP(ctx context.Context, q database.Querier, rules []domain.Rule, outlet *string, amount float64) (float64, *string, error) {
	if r := domain.FindBestRule(rules, domain.Match{SourceType: "order_amount", OutletID: outlet, Amount: amount}, e.now()); r != nil {
		id := r.ID
		return domain.CalculateXP(*r, amount, 1), &id, nil
	}
	s, err := e.Pos.LoyaltySettings(ctx, q)
	if err != nil {
		return 0, nil, err
	}
	return domain.CalculateSpendXP(amount, s), nil, nil
}

func (e *Engine) awardSpend(ctx context.Context, db database.DB, in PosOrder) Result {
	if !domain.IsXPEligiblePayment(in.PaymentMethod) {
		return nonArk
	}
	res, err := savepoint(ctx, db, func(tx database.DB) (Result, error) {
		v := kit.DefaultVenue(ctx, tx)
		branch := v.BranchID
		if in.OutletID != nil {
			branch = in.OutletID
		}
		rules, err := loadRules(ctx, tx)
		if err != nil {
			return Result{}, err
		}
		productXP, err := e.Pos.ProductXP(ctx, tx, productIDs(in.Items))
		if err != nil {
			return Result{}, err
		}
		label := e.orderLabel(ctx, tx, in.OrderID)

		var ledger []string
		var awarded float64
		dup := 0
		collect := func(r Result) {
			if r.Status == "duplicate" {
				dup++
			}
			awarded += r.XPAwarded
			ledger = append(ledger, r.LedgerIDs...)
		}
		productPosted := false
		for index, it := range in.Items {
			if it.ProductID == "" {
				continue
			}
			qty := domain.ItemQuantity(it)
			amount := domain.ItemAmount(it)
			pid := it.ProductID
			rule := domain.FindBestRule(rules, domain.Match{SourceType: "product", SourceID: &pid, OutletID: in.OutletID, Amount: amount}, e.now())
			var xp float64
			switch {
			case rule != nil:
				xp = domain.CalculateXP(*rule, amount, qty)
			case productXP[pid] > 0:
				xp = math.Floor(productXP[pid] * qty)
			}
			if xp <= 0 {
				continue
			}
			productPosted = true
			var ruleID *string
			if rule != nil {
				ruleID = &rule.ID
			}
			r, err := e.PostEvent(ctx, tx, Event{
				CustomerID: in.CustomerID, SourceType: "product", SourceID: &pid, OutletID: in.OutletID,
				CompanyID: v.CompanyID, BranchID: branch, XPAmount: xp, RuleID: ruleID,
				ReferenceTable: "pos_orders", ReferenceID: in.OrderID,
				IdempotencyKey: "pos:order:" + in.OrderID + ":product:" + pid + ":" + strconv.Itoa(index),
				Description:    "XP produk POS — order " + label,
				Metadata:       map[string]any{"amount": amount, "quantity": qty, "product_id": pid},
			})
			if err != nil {
				return Result{}, err
			}
			collect(r)
		}
		if !productPosted {
			xp, ruleID, err := e.orderAmountXP(ctx, tx, rules, in.OutletID, in.TotalAmount)
			if err != nil {
				return Result{}, err
			}
			if xp > 0 {
				source, metaSource := "order_amount_settings", "pos_loyalty_settings"
				if ruleID != nil {
					source, metaSource = "order_amount", "crm_xp_rules"
				}
				r, err := e.PostEvent(ctx, tx, Event{
					CustomerID: in.CustomerID, SourceType: source, OutletID: in.OutletID,
					CompanyID: v.CompanyID, BranchID: branch, XPAmount: xp, RuleID: ruleID,
					ReferenceTable: "pos_orders", ReferenceID: in.OrderID,
					IdempotencyKey: "pos:order:" + in.OrderID + ":order_amount",
					Description:    "XP transaksi POS — order " + label + " (" + kit.FormatRupiah(in.TotalAmount) + ")",
					Metadata:       map[string]any{"amount": in.TotalAmount, "source": metaSource},
				})
				if err != nil {
					return Result{}, err
				}
				collect(r)
			}
		}
		if awarded > 0 {
			if err := e.SyncAfterEarn(ctx, tx, in.CustomerID, awarded); err != nil {
				return Result{}, err
			}
			return Result{Status: "posted", XPAwarded: awarded, LedgerIDs: ledger}, nil
		}
		if dup > 0 {
			return Result{Status: "duplicate", LedgerIDs: ledger}, nil
		}
		return Result{Status: "skipped", Reason: "no_matching_xp_rule"}, nil
	})
	if err != nil {
		return e.failure(err, "CRM XP order award failed")
	}
	return res
}

// SplitPayment is the XP payload of one paid split (awardCrmXpForSplitPayment).
type SplitPayment struct {
	OrderID       string
	SplitID       string
	CustomerID    string
	TotalAmount   float64
	OutletID      *string
	PaymentMethod string
}

// AwardSplitPayment mirrors awardCrmXpForSplitPayment.
func (e *Engine) AwardSplitPayment(ctx context.Context, db database.DB, in SplitPayment) Result {
	if in.CustomerID == "" {
		return noCustomer
	}
	if !domain.IsXPEligiblePayment(in.PaymentMethod) {
		return nonArk
	}
	res, err := savepoint(ctx, db, func(tx database.DB) (Result, error) {
		v := kit.DefaultVenue(ctx, tx)
		rules, err := loadRules(ctx, tx)
		if err != nil {
			return Result{}, err
		}
		xp, ruleID, err := e.orderAmountXP(ctx, tx, rules, in.OutletID, in.TotalAmount)
		if err != nil {
			return Result{}, err
		}
		if xp <= 0 {
			return Result{Status: "skipped", Reason: "no_matching_xp_rule"}, nil
		}
		branch := v.BranchID
		if in.OutletID != nil {
			branch = in.OutletID
		}
		metaSource := "pos_loyalty_settings"
		if ruleID != nil {
			metaSource = "crm_xp_rules"
		}
		posted, err := e.PostEvent(ctx, tx, Event{
			CustomerID: in.CustomerID, SourceType: "split_payment", SourceID: &in.SplitID, OutletID: in.OutletID,
			CompanyID: v.CompanyID, BranchID: branch, XPAmount: xp, RuleID: ruleID,
			ReferenceTable: "pos_order_splits", ReferenceID: in.SplitID,
			IdempotencyKey: "pos:split:" + in.SplitID + ":order_amount",
			Description:    "XP split payment POS — order " + e.orderLabel(ctx, tx, in.OrderID) + " (" + kit.FormatRupiah(in.TotalAmount) + ")",
			Metadata: map[string]any{
				"amount": in.TotalAmount, "order_id": in.OrderID, "split_id": in.SplitID, "source": metaSource,
			},
		})
		if err != nil {
			return Result{}, err
		}
		if posted.XPAwarded > 0 {
			if err := e.SyncAfterEarn(ctx, tx, in.CustomerID, posted.XPAwarded); err != nil {
				return Result{}, err
			}
		}
		return posted, nil
	})
	if err != nil {
		return e.failure(err, "CRM XP split award failed")
	}
	return res
}

// AwardTopup mirrors awardCrmXpForTopup.
func (e *Engine) AwardTopup(ctx context.Context, db database.DB, customerID string, amount float64, transactionID string) Result {
	if customerID == "" {
		return noCustomer
	}
	res, err := savepoint(ctx, db, func(tx database.DB) (Result, error) {
		v := kit.DefaultVenue(ctx, tx)
		s, err := e.Pos.LoyaltySettings(ctx, tx)
		if err != nil {
			return Result{}, err
		}
		xp := domain.CalculateTopupXP(amount, s)
		if xp <= 0 {
			return Result{Status: "skipped", Reason: "topup_xp_disabled_or_zero"}, nil
		}
		posted, err := e.PostEvent(ctx, tx, Event{
			CustomerID: customerID, SourceType: "topup", SourceID: &transactionID,
			CompanyID: v.CompanyID, BranchID: v.BranchID, XPAmount: xp,
			ReferenceTable: "pos_wallet_transactions", ReferenceID: transactionID,
			IdempotencyKey: "pos:topup:" + transactionID,
			Description:    "XP topup ARK — " + kit.FormatRupiah(amount),
			Metadata:       map[string]any{"amount": amount, "source": "pos_loyalty_settings", "topup_xp_mode": s.TopupXPMode},
		})
		if err != nil {
			return Result{}, err
		}
		if posted.XPAwarded > 0 {
			if err := e.SyncAfterEarn(ctx, tx, customerID, posted.XPAwarded); err != nil {
				return Result{}, err
			}
		}
		return posted, nil
	})
	if err != nil {
		return e.failure(err, "CRM XP topup award failed")
	}
	return res
}
