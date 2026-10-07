package gymcredits

import (
	"context"
	"encoding/json"
	"log/slog"
	"math"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/jsmath"
)

// SQLArkWallet is the ARK Coin wallet adapter: the SQL of
// frontend/src/lib/wallet/server.ts (lockCustomer, insertWalletRow,
// setCustomerBalance, loadWalletSettings) and the CRM feature flag of
// loyalty-features-server.ts. It is isolated here so internal/app can point
// the ArkWallet port at a wallet module once one exists.
type SQLArkWallet struct {
	Log *slog.Logger
}

var _ ArkWallet = SQLArkWallet{}

// defaultArkRate is DEFAULT_SETTINGS.ark_rate.
const defaultArkRate = 1000

// roundIdr is Math.round(value * 100) / 100.
func roundIdr(v float64) float64 { return jsmath.RoundTo(v, 2) }

// Move locks the customer row, refuses a negative balance, appends the
// wallet transaction and stores the new balance, all in the caller's tx.
func (w SQLArkWallet) Move(ctx context.Context, tx database.Querier, m ArkMove) error {
	var customerID string
	var balance float64
	err := tx.QueryRow(ctx,
		`SELECT id, COALESCE(ark_coin_balance, 0)::float AS balance FROM pos.pos_customers WHERE id = $1 FOR UPDATE`,
		m.CustomerID,
	).Scan(&customerID, &balance)
	if database.IsNoRows(err) {
		return ErrArkMemberNotFound
	}
	if err != nil {
		return err
	}
	after := balance + m.Delta
	if after < 0 {
		return ErrArkInsufficient
	}
	rate, err := w.Rate(ctx, tx)
	if err != nil {
		return err
	}
	kind := "refund"
	if m.Delta < 0 {
		kind = "payment"
	}
	var actor any
	if m.ActorID != nil {
		actor = *m.ActorID
	}
	metadata, err := json.Marshal(map[string]any{"source": "gym_credit_purchase", "purchase_id": m.PurchaseID, "actor_id": actor})
	if err != nil {
		return err
	}
	amount := math.Abs(m.Delta)
	if _, err := tx.Exec(ctx,
		`INSERT INTO pos.pos_wallet_transactions
		   (customer_id, type, amount, ark_coins, balance_before, balance_after, status, notes, metadata,
		    payment_method, reference_id, expires_at, package_id, company_id, branch_id, xendit_transaction_id)
		 VALUES ($1,$2,$3,$4,$5,$6,'completed',$7,$8::jsonb,NULL,NULL,NULL,NULL,NULL,$9,NULL)`,
		customerID, kind, roundIdr(amount), roundIdr(amount/math.Max(1, rate)), roundIdr(balance), roundIdr(after),
		m.Notes, string(metadata), m.BranchID,
	); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE pos.pos_customers SET ark_coin_balance = $2, updated_at = now() WHERE id = $1`,
		customerID, roundIdr(after))
	return err
}

// Balance is the customer's ARK Coin balance in rupiah (0 when unknown).
func (SQLArkWallet) Balance(ctx context.Context, db database.Querier, customerID string) (float64, error) {
	var balance float64
	err := db.QueryRow(ctx,
		`SELECT COALESCE(ark_coin_balance, 0)::float FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&balance)
	if database.IsNoRows(err) {
		return 0, nil
	}
	return balance, err
}

// Rate is the active loyalty settings' rupiah per ARK Coin.
func (SQLArkWallet) Rate(ctx context.Context, db database.Querier) (float64, error) {
	var rate float64
	err := db.QueryRow(ctx,
		`SELECT ark_rate::float FROM pos.pos_loyalty_settings WHERE is_active ORDER BY updated_at DESC LIMIT 1`).Scan(&rate)
	if database.IsNoRows(err) {
		return defaultArkRate, nil
	}
	return rate, err
}

// Enabled reads crm.crm_settings ark_coin_enabled; unreadable means enabled
// so old instances keep their menus.
func (w SQLArkWallet) Enabled(ctx context.Context, db database.Querier) bool {
	var value any
	err := db.QueryRow(ctx, `SELECT value FROM crm.crm_settings WHERE key = 'ark_coin_enabled'`).Scan(&value)
	if database.IsNoRows(err) {
		return true
	}
	if err != nil {
		if w.Log != nil {
			w.Log.ErrorContext(ctx, "[loyalty-features] gagal membaca crm_settings, pakai default aktif", "error", err)
		}
		return true
	}
	switch v := value.(type) {
	case bool:
		return v
	case string:
		if v == "true" || v == "1" {
			return true
		}
		if v == "false" || v == "0" {
			return false
		}
	case float64:
		if v == 1 {
			return true
		}
		if v == 0 {
			return false
		}
	}
	return true
}
