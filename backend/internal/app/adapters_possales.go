package app

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/adapters"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/modules/storedvalue"
	"nuhabit/backend/internal/modules/storedvalue/giftcards"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// possalesLoyalty is pos-sales' Loyalty port: the CRM XP engine plus the KOL
// comp quota check (pos.pos_customers / pos.pos_orders, a pos-sales concern).
type possalesLoyalty struct {
	crmLoyaltyForPos
	adapters.KolComp
}

var _ ports.Loyalty = possalesLoyalty{}

/* ── ARK Coin wallet → stored-value ──────────────────────────────────── */

type possalesWallet struct{ w *storedvalue.Wallet }

var _ ports.Wallet = possalesWallet{}

func newPossalesWallet(d module.Deps) possalesWallet {
	return possalesWallet{w: storedvalue.NewWallet(d, storedValuePorts(d))}
}

// Move runs update_ark_coin_balance in a savepoint so a rejection leaves the
// sale's transaction usable; any failure other than an insufficient balance
// is ErrArkFailed (the TS answers "Gagal memproses ARK Coin" for both).
func (a possalesWallet) Move(ctx context.Context, q database.Querier, m ports.ArkMove) (*float64, error) {
	var after float64
	run := func(q database.Querier) error {
		var err error
		after, err = a.w.MoveArkCoins(ctx, q, storedvalue.ArkMovement{
			CustomerID: m.CustomerID, Amount: m.Amount, Type: m.Type, OrderID: optional(m.OrderID), Notes: m.Notes,
		})
		return err
	}
	var err error
	if b, ok := q.(database.TxBeginner); ok {
		err = database.WithTx(ctx, b, func(tx pgx.Tx) error { return run(tx) })
	} else {
		err = run(q)
	}
	switch {
	case errors.Is(err, storedvalue.ErrArkInsufficient), err != nil && strings.Contains(err.Error(), "Insufficient"):
		return nil, ports.ErrArkInsufficient
	case err != nil:
		return nil, ports.ErrArkFailed
	}
	return &after, nil
}

func (a possalesWallet) Balance(ctx context.Context, q database.Querier, customerID string) (*float64, error) {
	var b *float64
	err := q.QueryRow(ctx, `SELECT ark_coin_balance::float8 FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&b)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return b, err
}

func (a possalesWallet) OrderRows(ctx context.Context, q database.Querier, orderIDs []string) ([]ports.WalletRow, error) {
	rows, err := a.w.OrderWalletRows(ctx, q, orderIDs)
	out := make([]ports.WalletRow, len(rows))
	for i, r := range rows {
		out[i] = ports.WalletRow{OrderID: r.OrderID, Type: r.Type, Amount: r.Amount}
	}
	return out, err
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

/* ── gift cards → stored-value ───────────────────────────────────────── */

type possalesGiftCards struct{ s *giftcards.Service }

var _ ports.GiftCards = possalesGiftCards{}

func newPossalesGiftCards(d module.Deps) possalesGiftCards {
	return possalesGiftCards{s: storedvalue.NewGiftCards(d, storedValuePorts(d))}
}

func (g possalesGiftCards) PrepareSale(ctx context.Context, q database.Querier, lines []ports.GiftSaleLine) ([]float64, string, error) {
	in := make([]giftcards.SaleLine, len(lines))
	for i, l := range lines {
		in[i] = giftcards.SaleLine{ProductID: l.ProductID, Quantity: l.Quantity, UnitPrice: l.UnitPrice,
			VariantPriceAdjustment: l.VariantPriceAdjustment, ModifierPriceAdjustment: l.ModifierPriceAdjustment}
	}
	plan, err := g.s.PrepareGiftCardSale(ctx, q, in)
	if err != nil {
		return nil, "", err
	}
	if !plan.OK {
		return nil, plan.Reason, nil
	}
	return plan.Nominals, "", nil
}

func (g possalesGiftCards) Redeem(ctx context.Context, q database.Querier, in ports.GiftRedeem) (ports.GiftOutcome, error) {
	out, err := g.s.RedeemGiftCardForPosOrder(ctx, q, giftcards.RedeemInput{
		Scope: giftcards.Scope{CompanyID: in.Scope.CompanyID, BranchID: in.Scope.BranchID},
		Code:  in.Code, Amount: in.Amount, OrderID: in.OrderID, CreatedBy: in.CreatedBy,
	})
	return ports.GiftOutcome{OK: out.OK, Reason: out.Reason, Status: out.Status}, err
}

func (g possalesGiftCards) Refund(ctx context.Context, q database.Querier, scope ports.GiftScope, orderID, createdBy, note string) (bool, error) {
	return g.s.RefundGiftCardForPosOrder(ctx, q, giftcards.RefundInput{
		Scope: giftcards.Scope{CompanyID: scope.CompanyID, BranchID: scope.BranchID}, OrderID: orderID, CreatedBy: createdBy, Note: note,
	})
}

func (g possalesGiftCards) Issue(ctx context.Context, q database.Querier, in ports.GiftIssue) ([]ports.IssuedGiftCard, error) {
	cards, err := g.s.IssueGiftCardsForPosOrder(ctx, q, giftcards.IssueInput{
		Scope: giftcards.Scope{CompanyID: in.Scope.CompanyID, BranchID: in.Scope.BranchID}, OrderID: in.OrderID,
		Nominals: in.Nominals, BuyerName: in.BuyerName, BuyerPhone: in.BuyerPhone, CreatedBy: in.CreatedBy,
	})
	if err != nil {
		return nil, err
	}
	out := make([]ports.IssuedGiftCard, len(cards))
	for i, c := range cards {
		exp := []byte("null")
		if c.ExpiresAt != nil {
			exp, _ = c.ExpiresAt.MarshalJSON()
		}
		out[i] = ports.IssuedGiftCard{ID: c.ID, Code: c.Code, InitialValue: c.InitialValue, ExpiresAt: exp}
	}
	return out, nil
}

func (g possalesGiftCards) VoidIssued(ctx context.Context, q database.Querier, orderID, note string) (int, error) {
	n, err := g.s.VoidIssuedGiftCardsForPosOrder(ctx, q, giftcards.VoidInput{OrderID: orderID, Note: note})
	var used *giftcards.IssuedGiftCardAlreadyUsedError
	if errors.As(err, &used) {
		return n, &ports.IssuedCardUsedError{Code: used.Code}
	}
	return n, err
}
