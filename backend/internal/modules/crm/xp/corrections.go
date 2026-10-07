package xp

import (
	"context"
	"math"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp/domain"
	"nuhabit/backend/internal/platform/database"
)

func totalXP(ctx context.Context, q database.Querier, customerID string) (float64, error) {
	var v *float64
	err := q.QueryRow(ctx, `SELECT total_xp::float8 FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&v)
	if database.IsNoRows(err) || v == nil {
		return 0, nil
	}
	return *v, err
}

// ReverseVoidedOrders mirrors reverseCrmXpForVoidedOrders: one idempotent
// `reverse` row per voided order for its unreversed earn XP (clamped so XP
// never goes negative), then the tier is re-evaluated (it may go down).
func (e *Engine) ReverseVoidedOrders(ctx context.Context, db database.DB, orderIDs []string, voidReason string) (float64, error) {
	if len(orderIDs) == 0 {
		return 0, nil
	}
	var reversed float64
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT customer_id::text, member_id::text, xp_delta::float8, outlet_id::text,
			company_id::text, branch_id::text, reference_id
			FROM crm.crm_xp_ledger
			WHERE reference_table = 'pos_orders' AND direction = 'earn' AND reference_id = ANY($1::text[])`, orderIDs)
		if err != nil {
			return err
		}
		earn, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.EarnRow, error) {
			var x domain.EarnRow
			var customer *string
			err := r.Scan(&customer, &x.MemberID, &x.XPDelta, &x.OutletID, &x.CompanyID, &x.BranchID, &x.ReferenceID)
			if customer != nil {
				x.CustomerID = *customer
			}
			return x, err
		})
		if err != nil || len(earn) == 0 {
			return err
		}
		keys := make([]string, len(orderIDs))
		for i, id := range orderIDs {
			keys[i] = domain.VoidReverseKey(id)
		}
		krows, err := tx.Query(ctx, `SELECT idempotency_key FROM crm.crm_xp_ledger WHERE idempotency_key = ANY($1::text[])`, keys)
		if err != nil {
			return err
		}
		done, err := pgx.CollectRows(krows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		already := map[string]bool{}
		for _, k := range done {
			already[k] = true
		}
		byOrder := domain.SumUnreversedEarnByOrder(earn, already)
		if len(byOrder) == 0 {
			return nil
		}
		customerID := byOrder[0].Row.CustomerID
		suffix := ""
		if voidReason != "" {
			suffix = " (" + voidReason + ")"
		}
		for _, entry := range byOrder {
			if entry.XP <= 0 {
				continue
			}
			before, err := totalXP(ctx, tx, customerID)
			if err != nil {
				return err
			}
			delta := math.Min(entry.XP, before)
			if delta <= 0 {
				continue
			}
			after := before - delta
			inserted := true
			err = database.WithTx(ctx, tx, func(sp pgx.Tx) error {
				_, err := sp.Exec(ctx, `INSERT INTO crm.crm_xp_ledger
					(member_id, customer_id, direction, source_channel, source_type, source_id, outlet_id, company_id, branch_id,
					 xp_delta, balance_before, balance_after, lifetime_before, lifetime_after, reference_table, reference_id,
					 idempotency_key, description, metadata)
					VALUES ($1, $2, 'reverse', 'pos', 'order_void', $3, $4, $5, $6, $7, $8, $9, $8, $9, 'pos_orders', $3, $10, $11, '{"void":true}'::jsonb)`,
					entry.Row.MemberID, customerID, entry.OrderID, entry.Row.OutletID, entry.Row.CompanyID, entry.Row.BranchID,
					-int64(delta), int64(before), int64(after), domain.VoidReverseKey(entry.OrderID),
					"Pembatalan XP — void order"+suffix)
				return err
			})
			if database.IsUniqueViolation(err) {
				inserted = false
			} else if err != nil {
				return err
			}
			if !inserted {
				continue
			}
			now := e.now()
			if _, err := tx.Exec(ctx, `UPDATE pos.pos_customers SET total_xp = $2, updated_at = $3 WHERE id = $1`, customerID, int64(after), now); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE crm.crm_member_profiles SET lifetime_xp = $2::int, loyalty_score = $2::int WHERE id = $1`, entry.Row.MemberID, int64(after)); err != nil {
				return err
			}
			reversed += delta
		}
		if reversed > 0 {
			return e.SyncTier(ctx, tx, customerID)
		}
		return nil
	})
	if err != nil {
		if kit.IsMissingCrmSchema(err) {
			return 0, nil
		}
		return 0, err
	}
	return reversed, nil
}

// Adjustment is an admin XP correction request.
type Adjustment struct {
	CustomerID string
	Delta      float64
	Reason     string
	ActorID    string
	RequestID  string
	CompanyID  *string
	BranchID   *string
}

// AdjustResult mirrors adjustMemberXp's result.
type AdjustResult struct {
	Status  string  `json:"status"` // posted | duplicate | skipped
	XPDelta float64 `json:"xpDelta"`
	TotalXP float64 `json:"totalXp"`
}

// Adjust mirrors adjustMemberXp: one ledger row per request id, deductions
// clamped at zero, tier re-evaluated (it may go down).
func (e *Engine) Adjust(ctx context.Context, db database.DB, in Adjustment) (AdjustResult, error) {
	key := "admin-adjust:" + in.RequestID
	var out AdjustResult
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		var existing string
		err := tx.QueryRow(ctx, `SELECT id::text FROM crm.crm_xp_ledger WHERE idempotency_key = $1 LIMIT 1`, key).Scan(&existing)
		found := err == nil
		if err != nil && !database.IsNoRows(err) {
			return err
		}
		before, err := totalXP(ctx, tx, in.CustomerID)
		if err != nil {
			return err
		}
		if found {
			out = AdjustResult{Status: "duplicate", TotalXP: before}
			return nil
		}
		applied := domain.ClampXPAdjustment(in.Delta, before)
		var member *Profile
		if applied != 0 {
			if member, err = e.EnsureProfile(ctx, tx, in.CustomerID); err != nil {
				return err
			}
		}
		if member == nil || applied == 0 {
			out = AdjustResult{Status: "skipped", TotalXP: before}
			return nil
		}
		after := before + applied
		meta, _ := kit.MarshalNoEscape(map[string]any{
			"reason": in.Reason, "actor_id": in.ActorID, "requested_delta": math.Trunc(in.Delta),
		})
		err = database.WithTx(ctx, tx, func(sp pgx.Tx) error {
			_, err := sp.Exec(ctx, `INSERT INTO crm.crm_xp_ledger
				(member_id, customer_id, direction, source_channel, source_type, source_id, company_id, branch_id,
				 xp_delta, balance_before, balance_after, lifetime_before, lifetime_after, reference_table, reference_id,
				 idempotency_key, description, metadata)
				VALUES ($1, $2, 'adjust', 'manual', 'admin_adjustment', $3, $4, $5, $6, $7, $8, $7, $8, 'pos_customers', $12, $9, $10, $11::jsonb)`,
				member.ID, in.CustomerID, in.ActorID, in.CompanyID, in.BranchID, int64(applied), int64(before), int64(after),
				key, "Penyesuaian admin: "+in.Reason, string(meta), in.CustomerID)
			return err
		})
		if database.IsUniqueViolation(err) {
			out = AdjustResult{Status: "duplicate", TotalXP: before}
			return nil
		}
		if err != nil {
			return err
		}
		now := e.now()
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_customers SET total_xp = $2, updated_at = $3 WHERE id = $1`, in.CustomerID, int64(after), now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE crm.crm_member_profiles SET lifetime_xp = $2::int, loyalty_score = $2::int, last_activity_at = $3 WHERE id = $1`,
			member.ID, int64(after), now); err != nil {
			return err
		}
		if err := e.SyncTier(ctx, tx, in.CustomerID); err != nil {
			return err
		}
		out = AdjustResult{Status: "posted", XPDelta: applied, TotalXP: after}
		return nil
	})
	return out, err
}
