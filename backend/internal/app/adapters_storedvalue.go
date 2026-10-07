package app

import (
	"context"
	"encoding/json"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/modules/storedvalue"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Adapters of the stored-value ports. Reads of identity/org settings,
// POS orders and payment methods use the SQL the TS routes ran; XP goes
// through the CRM engine; WhatsApp, Xendit and the supervisor PIN live in
// adapters_storedvalue_external.go.

/* ── Directory ───────────────────────────────────────────────────────── */

type svDirectory struct{}

var _ storedvalue.Directory = svDirectory{}

// DefaultVenue is getCrmDefaultVenue: only JSON string values count; any
// failure is an empty venue.
func (svDirectory) DefaultVenue(ctx context.Context, q database.Querier) storedvalue.Venue {
	var v storedvalue.Venue
	rows, err := q.Query(ctx, `SELECT key, value FROM crm.crm_settings WHERE key IN ('default_company_id', 'default_branch_id')`)
	if err != nil {
		return v
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var raw json.RawMessage
		if rows.Scan(&key, &raw) != nil {
			return storedvalue.Venue{}
		}
		var s string
		if json.Unmarshal(raw, &s) != nil || s == "" {
			continue
		}
		if key == "default_company_id" {
			v.CompanyID = &s
		} else {
			v.BranchID = &s
		}
	}
	if rows.Err() != nil {
		return storedvalue.Venue{}
	}
	return v
}

func (svDirectory) BranchCompany(ctx context.Context, q database.Querier, branchID string) (*string, error) {
	var company *string
	err := q.QueryRow(ctx, `SELECT company_id::text FROM configuration.branches WHERE id = $1`, branchID).Scan(&company)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return company, err
}

func (svDirectory) ActiveBranches(ctx context.Context, q database.Querier) ([]storedvalue.Branch, error) {
	rows, err := q.Query(ctx, `SELECT id::text, name FROM configuration.branches WHERE is_active ORDER BY name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[storedvalue.Branch])
}

func (svDirectory) FirstCompanyName(ctx context.Context, q database.Querier) (*string, error) {
	var name *string
	err := q.QueryRow(ctx, `SELECT name FROM configuration.companies ORDER BY created_at LIMIT 1`).Scan(&name)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return name, err
}

// ArkCoinEnabled is getLoyaltyFeatures().arkCoin: crm_settings
// ark_coin_enabled, on when missing or unreadable.
func (svDirectory) ArkCoinEnabled(ctx context.Context, q database.Querier) bool {
	var raw json.RawMessage
	err := q.QueryRow(ctx, `SELECT value FROM crm.crm_settings WHERE key = 'ark_coin_enabled'`).Scan(&raw)
	if err != nil {
		return true
	}
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return true
	}
	switch x := v.(type) {
	case bool:
		return x
	case string:
		if x == "true" || x == "1" {
			return true
		}
		if x == "false" || x == "0" {
			return false
		}
	case float64:
		if x == 1 {
			return true
		}
		if x == 0 {
			return false
		}
	}
	return true
}

func (svDirectory) OrderNumbers(ctx context.Context, q database.Querier, ids []string) (map[string]string, error) {
	out := map[string]string{}
	rows, err := q.Query(ctx, `SELECT id::text, order_number FROM pos.pos_orders WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	var id string
	var number *string
	_, err = pgx.ForEachRow(rows, []any{&id, &number}, func() error {
		if number != nil {
			out[id] = *number
		}
		return nil
	})
	return out, err
}

/* ── Loyalty (CRM XP engine) ─────────────────────────────────────────── */

type svLoyalty struct{ engine *xp.Engine }

func (l svLoyalty) AwardTopupXP(ctx context.Context, db database.DB, customerID string, amountIdr float64, transactionID string) storedvalue.CrmXP {
	r := l.engine.AwardTopup(ctx, db, customerID, amountIdr, transactionID)
	return storedvalue.CrmXP{Status: r.Status, XPAwarded: r.XPAwarded, Reason: r.Reason, LedgerIDs: r.LedgerIDs}
}

/* ── Member bill orders (pos-sales tables) ───────────────────────────── */

type svBillOrders struct{}

var _ storedvalue.MemberBillOrders = svBillOrders{}

// openOrderSQL is OPEN_ORDER_SQL: unpaid, not cancelled, no split bill.
const openOrderSQL = `
  o.payment_status = 'unpaid'
  AND o.status NOT IN ('cancelled', 'voided', 'merged')
  AND NOT EXISTS (
    SELECT 1 FROM pos.pos_order_splits s
    WHERE s.order_id = o.id AND s.status <> 'cancelled'
  )`

func (svBillOrders) OpenOrderSummaries(ctx context.Context, q database.Querier) ([]storedvalue.OpenOrderSummary, error) {
	rows, err := q.Query(ctx,
		`SELECT o.customer_id::text, count(*)::int, sum(o.total_amount)::float, min(o.ordered_at)
		   FROM pos.pos_orders o
		  WHERE o.customer_id IS NOT NULL AND `+openOrderSQL+`
		  GROUP BY o.customer_id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[storedvalue.OpenOrderSummary])
}

func (svBillOrders) OpenOrders(ctx context.Context, q database.Querier, customerID string, forUpdate bool) ([]storedvalue.OpenOrder, error) {
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE OF o"
	}
	rows, err := q.Query(ctx,
		`SELECT o.id::text, o.order_number, o.queue_number, o.ordered_at, o.order_type::text, o.status::text,
		        o.total_amount::float, o.checkout_id::text, o.company_id::text, o.branch_id::text
		   FROM pos.pos_orders o
		  WHERE o.customer_id = $1 AND `+openOrderSQL+`
		  ORDER BY o.ordered_at ASC`+lock, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[storedvalue.OpenOrder])
}

func (svBillOrders) OrderItems(ctx context.Context, q database.Querier, orderIDs []string) ([]storedvalue.BillOrderItem, error) {
	rows, err := q.Query(ctx,
		`SELECT order_id::text, product_id::text, product_name, quantity::float, unit_price::float,
		        total_amount::float, COALESCE(variants, 'null'::jsonb), COALESCE(modifiers, 'null'::jsonb)
		   FROM pos.pos_order_items WHERE order_id = ANY($1::uuid[])
		  ORDER BY created_at ASC`, orderIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[storedvalue.BillOrderItem])
}

func (svBillOrders) SettledOrders(ctx context.Context, q database.Querier, customerID string) ([]storedvalue.SettledOrder, error) {
	rows, err := q.Query(ctx,
		`SELECT o.id::text, o.order_number, o.ordered_at, o.total_amount::float, s.created_at
		   FROM pos.pos_orders o
		   JOIN pos.pos_member_bill_settlements s ON s.id = o.member_bill_settlement_id
		  WHERE o.customer_id = $1
		  ORDER BY s.created_at DESC, o.ordered_at DESC
		  LIMIT 100`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (storedvalue.SettledOrder, error) {
		var o storedvalue.SettledOrder
		var ordered, settled time.Time
		err := r.Scan(&o.ID, &o.OrderNumber, &ordered, &o.TotalAmount, &settled)
		o.OrderedAt, o.SettledAt = httpx.JSTime(ordered), httpx.JSTime(settled)
		return o, err
	})
}

// SettleOrders marks the orders paid by member bill and closes multi-stall
// checkouts whose child orders are all paid, on the caller's transaction.
// pos_checkouts.payment_method is an enum and payment_method_code text, so
// $2 is cast for each or Postgres cannot type it (42P08).
func (svBillOrders) SettleOrders(ctx context.Context, q database.Querier, orderIDs, checkoutIDs []string, settlementID string) error {
	if _, err := q.Exec(ctx,
		`UPDATE pos.pos_orders
		    SET payment_status = 'paid', payment_method = $2, payment_method_code = $2, payment_method_name = $3,
		        amount_paid = total_amount, change_amount = 0, member_bill_settlement_id = $4, updated_at = now()
		  WHERE id = ANY($1::uuid[])`, orderIDs, "member_bill", "Tagihan Member", settlementID); err != nil {
		return err
	}
	if len(checkoutIDs) == 0 {
		return nil
	}
	_, err := q.Exec(ctx,
		`UPDATE pos.pos_checkouts c
		    SET payment_status = 'paid', payment_method = $2::text::pos_payment_method, payment_method_code = $2::text,
		        payment_method_name = $3, amount_paid = c.total_amount, change_amount = 0, updated_at = now()
		  WHERE c.id = ANY($1::uuid[])
		    AND NOT EXISTS (
		      SELECT 1 FROM pos.pos_orders o
		       WHERE o.checkout_id = c.id AND o.payment_status <> 'paid'
		         AND o.status NOT IN ('cancelled', 'voided', 'merged')
		    )`, checkoutIDs, "member_bill", "Tagihan Member")
	return err
}

// paymentCodePattern is PAYMENT_METHOD_CODE_PATTERN.
var paymentCodePattern = regexp.MustCompile(`^[a-z0-9_-]{2,40}$`)

var posHandlers = map[string]bool{"cash": true, "qris": true, "credit": true, "ark_wallet": true, "nfc_tab": true, "gift_card": true}

// ActivePaymentMethod is the code's row in listPosPaymentMethods({activeOnly}).
func (svBillOrders) ActivePaymentMethod(ctx context.Context, q database.Querier, code string) (*storedvalue.PaymentMethod, error) {
	var m storedvalue.PaymentMethod
	err := q.QueryRow(ctx, `SELECT code, name, handler FROM pos.payment_methods WHERE is_active = true AND code = $1`, code).
		Scan(&m.Code, &m.Name, &m.Handler)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !paymentCodePattern.MatchString(m.Code) || !posHandlers[m.Handler] {
		return nil, nil
	}
	if m.Code == "ark_coin" && !(svDirectory{}).ArkCoinEnabled(ctx, q) {
		return nil, nil
	}
	return &m, nil
}

func (svBillOrders) ActiveShift(ctx context.Context, q database.Querier, shiftID string) (*string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM pos.pos_shifts WHERE id = $1 AND status = 'active'`, shiftID).Scan(&id)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}
