package app

import (
	"context"
	"encoding/json"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/xp"
	xpdomain "nuhabit/backend/internal/modules/crm/xp/domain"
	"nuhabit/backend/internal/platform/database"
)

// crmPosReads adapts the POS-owned reads of the CRM XP engine (SQL ported
// from lib/pos/loyalty-settings.ts and lib/crm/loyalty-pos-earn.ts) until
// pos-ops exposes them as a service. Every read runs in a savepoint so a
// missing column cannot abort the caller's transaction.
type crmPosReads struct{}

var _ xp.PosReads = crmPosReads{}

func readInSavepoint(ctx context.Context, q database.Querier, fn func(q database.Querier) error) error {
	if b, ok := q.(database.TxBeginner); ok {
		return database.WithTx(ctx, b, func(tx pgx.Tx) error { return fn(tx) })
	}
	return fn(q)
}

// LoyaltySettings mirrors loadPosLoyaltySettings + normalizeLoyaltySettings
// (XP fields): defaults when the table or row is missing.
func (crmPosReads) LoyaltySettings(ctx context.Context, q database.Querier) (xpdomain.PosSettings, error) {
	s := xpdomain.DefaultPosSettings()
	var topupEnabled, spendEnabled *bool
	var mode *string
	var topupValue, topupStep, spendStep, spendMin *float64
	err := readInSavepoint(ctx, q, func(q database.Querier) error {
		return q.QueryRow(ctx, `SELECT topup_xp_enabled, topup_xp_mode, topup_xp_value::float8, topup_xp_amount_step::float8,
			spend_xp_enabled, spend_xp_amount_step::float8, spend_xp_min::float8
			FROM pos.pos_loyalty_settings WHERE is_active = true ORDER BY updated_at DESC LIMIT 1`).
			Scan(&topupEnabled, &mode, &topupValue, &topupStep, &spendEnabled, &spendStep, &spendMin)
	})
	if database.IsNoRows(err) || database.IsUndefinedTable(err) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	if topupEnabled != nil {
		s.TopupXPEnabled = *topupEnabled
	}
	s.TopupXPMode = "per_amount"
	if mode != nil && strings.ToLower(*mode) == "fixed" {
		s.TopupXPMode = "fixed"
	}
	if topupValue != nil {
		s.TopupXPValue = math.Max(0, *topupValue)
	}
	if topupStep != nil {
		s.TopupXPAmountStep = math.Max(1, *topupStep)
	}
	if spendEnabled != nil {
		s.SpendXPEnabled = *spendEnabled
	}
	if spendStep != nil {
		s.SpendXPAmountStep = math.Max(1, *spendStep)
	}
	if spendMin != nil {
		s.SpendXPMin = math.Max(0, math.Floor(*spendMin))
	}
	return s, nil
}

func productNumbers(ctx context.Context, q database.Querier, column string, ids []string) (map[string]float64, error) {
	out := map[string]float64{}
	if len(ids) == 0 {
		return out, nil
	}
	err := readInSavepoint(ctx, q, func(q database.Querier) error {
		rows, err := q.Query(ctx, `SELECT id::text, `+column+`::text FROM pos.pos_products WHERE id::text = ANY($1::text[])`, ids)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			var v *string
			if err := rows.Scan(&id, &v); err != nil {
				return err
			}
			out[id] = toNumberText(v)
		}
		return rows.Err()
	})
	if database.PgCode(err) == "42703" {
		return map[string]float64{}, nil
	}
	return out, err
}

func toNumberText(v *string) float64 {
	if v == nil {
		return 0
	}
	var f float64
	if err := json.Unmarshal([]byte(strings.TrimSpace(*v)), &f); err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
		return 0
	}
	return f
}

// ProductXP is pos_products.xp_points (loadProductXpMap).
func (crmPosReads) ProductXP(ctx context.Context, q database.Querier, ids []string) (map[string]float64, error) {
	return productNumbers(ctx, q, "xp_points", ids)
}

// ProductBonusXP is pos_products.bonus_xp (awardProductBonusXp).
func (crmPosReads) ProductBonusXP(ctx context.Context, q database.Querier, ids []string) (map[string]float64, error) {
	return productNumbers(ctx, q, "bonus_xp", ids)
}

// OrderNumber mirrors orderLabel's lookup; "" on any failure.
func (crmPosReads) OrderNumber(ctx context.Context, q database.Querier, orderID string) string {
	var n *string
	err := readInSavepoint(ctx, q, func(q database.Querier) error {
		return q.QueryRow(ctx, `SELECT order_number FROM pos.pos_orders WHERE id::text = $1`, orderID).Scan(&n)
	})
	if err != nil || n == nil {
		return ""
	}
	return *n
}
