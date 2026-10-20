package gymcredits

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

var _ SavedMethodStore = Postgres{}

/* ── Saved methods ───────────────────────────────────────────────────── */

const savedMethodSelect = `SELECT id, customer_id, link_reference, session_id, xendit_customer_id, token_id, channel_code,
       method_type, label, status, failure_code, simulated, linked_at, created_at
  FROM gym.member_payment_methods`

func scanSavedMethod(row pgx.CollectableRow) (SavedMethod, error) {
	var m SavedMethod
	err := row.Scan(&m.ID, &m.CustomerID, &m.LinkReference, &m.SessionID, &m.XenditCustomerID, &m.TokenID, &m.ChannelCode,
		&m.MethodType, &m.Label, &m.Status, &m.FailureCode, &m.Simulated, &m.LinkedAt, &m.CreatedAt)
	return m, err
}

func (Postgres) InsertSavedMethod(ctx context.Context, q database.Querier, customerID, reference string, simulated bool) (string, error) {
	var id string
	err := q.QueryRow(ctx,
		`INSERT INTO gym.member_payment_methods (customer_id, link_reference, simulated) VALUES ($1, $2, $3) RETURNING id`,
		customerID, reference, simulated).Scan(&id)
	return id, err
}

var savedMethodKeys = map[string]bool{"id": true, "link_reference": true, "token_id": true}

func (Postgres) SavedMethod(ctx context.Context, q database.Querier, column, value string, lock bool) (*SavedMethod, error) {
	if !savedMethodKeys[column] {
		return nil, fmt.Errorf("gym-credits: unknown saved method key %q", column)
	}
	sql := savedMethodSelect + ` WHERE ` + column + `::text = $1`
	if lock {
		sql += ` FOR UPDATE`
	}
	rows, err := q.Query(ctx, sql, value)
	if err != nil {
		return nil, err
	}
	found, err := pgx.CollectRows(rows, scanSavedMethod)
	if err != nil || len(found) == 0 {
		return nil, err
	}
	return &found[0], nil
}

func (Postgres) SavedMethodsOf(ctx context.Context, q database.Querier, customerID string) ([]SavedMethod, error) {
	rows, err := q.Query(ctx, savedMethodSelect+`
		 WHERE customer_id = $1 AND status IN ('active', 'pending') ORDER BY created_at DESC LIMIT 10`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanSavedMethod)
}

func (Postgres) LastXenditCustomer(ctx context.Context, q database.Querier, customerID string) (string, error) {
	var id string
	err := q.QueryRow(ctx,
		`SELECT xendit_customer_id FROM gym.member_payment_methods
		  WHERE customer_id = $1 AND xendit_customer_id IS NOT NULL AND NOT simulated
		  ORDER BY created_at DESC LIMIT 1`, customerID).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

func (Postgres) SetLinkSession(ctx context.Context, q database.Querier, id, sessionID, xenditCustomerID string) error {
	_, err := q.Exec(ctx,
		`UPDATE gym.member_payment_methods
		    SET session_id = $2, xendit_customer_id = COALESCE($3, xendit_customer_id), updated_at = now()
		  WHERE id = $1`, id, sessionID, null(xenditCustomerID))
	return err
}

func (Postgres) ActivateSavedMethod(ctx context.Context, q database.Querier, id string, t SavedToken) error {
	_, err := q.Exec(ctx,
		`UPDATE gym.member_payment_methods
		    SET status = 'active', token_id = $2, channel_code = $3, method_type = $4, label = $5,
		        linked_at = now(), updated_at = now()
		  WHERE id = $1`, id, t.ID, null(t.ChannelCode), null(t.Type), null(t.Label))
	return err
}

func (Postgres) SetSavedMethodDetails(ctx context.Context, q database.Querier, id string, t SavedToken) error {
	_, err := q.Exec(ctx,
		`UPDATE gym.member_payment_methods
		    SET channel_code = $2, method_type = $3, label = $4, updated_at = now()
		  WHERE id = $1`, id, null(t.ChannelCode), null(t.Type), null(t.Label))
	return err
}

func (Postgres) CloseSavedMethod(ctx context.Context, q database.Querier, id, status, failureCode string) error {
	_, err := q.Exec(ctx,
		`UPDATE gym.member_payment_methods
		    SET status = $2, failure_code = COALESCE($3, failure_code),
		        canceled_at = CASE WHEN $2 = 'canceled' THEN now() ELSE canceled_at END, updated_at = now()
		  WHERE id = $1`, id, status, null(failureCode))
	return err
}

func (Postgres) SwitchSavedRenewals(ctx context.Context, q database.Querier, customerID string) ([]string, error) {
	rows, err := q.Query(ctx,
		`UPDATE gym.member_passes SET renew_with = 'invoice', updated_at = now()
		  WHERE customer_id = $1 AND renew_with = 'saved_method' AND status IN ('active', 'frozen', 'expired')
		  RETURNING id::text`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

/* ── Renewal retries ─────────────────────────────────────────────────── */

// renewalSelect is a pass with its attempts and latest renewal purchase.
// A pass that ended stays renewable through the grace period, so expired
// passes are listed too; the service checks the grace period.
const renewalSelect = `SELECT ` + passCols + `, mp.renewal_attempts, COALESCE(rp.id::text, ''), COALESCE(rp.status, '')` + passFrom + `
  LEFT JOIN gym.credit_purchases rp ON rp.id = mp.renewal_purchase_id
 WHERE mp.auto_renew AND mp.status IN ('active', 'frozen', 'expired')`

func collectRenewals(rows pgx.Rows, err error) ([]RenewalState, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (RenewalState, error) {
		var r RenewalState
		err := row.Scan(append(r.scanTargets(), &r.Attempts, &r.RenewalPurchaseID, &r.RenewalStatus)...)
		r.truncate()
		return r, err
	})
}

func (Postgres) FailedRenewals(ctx context.Context, q database.Querier) ([]RenewalState, error) {
	return collectRenewals(q.Query(ctx, renewalSelect+`
		   AND mp.renewal_retry_at IS NULL AND rp.status IN ('failed', 'expired')
		 ORDER BY mp.ends_at`))
}

func (Postgres) DueRenewalRetries(ctx context.Context, q database.Querier, now time.Time) ([]RenewalState, error) {
	return collectRenewals(q.Query(ctx, renewalSelect+`
		   AND mp.renewal_retry_at <= $1
		 ORDER BY mp.renewal_retry_at`, now))
}

func (Postgres) ScheduleRenewalRetry(ctx context.Context, q database.Querier, id, purchaseID string, at time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE gym.member_passes SET renewal_retry_at = $3, updated_at = now()
		  WHERE id = $1 AND auto_renew AND renewal_retry_at IS NULL AND renewal_purchase_id = $2`, id, purchaseID, at)
	return tag.RowsAffected() == 1, err
}

func (Postgres) ClaimRenewalRetry(ctx context.Context, q database.Querier, id string, now time.Time) (int, bool, error) {
	var attempt int
	err := q.QueryRow(ctx,
		`UPDATE gym.member_passes mp
		    SET renewal_retry_at = NULL, renewal_attempts = renewal_attempts + 1, renewal_handled_at = now(), updated_at = now()
		  WHERE id = $1 AND auto_renew AND renewal_retry_at <= $2
		    AND NOT EXISTS (SELECT 1 FROM gym.credit_purchases cp
		                     WHERE cp.id = mp.renewal_purchase_id AND cp.status IN ('pending', 'paid'))
		  RETURNING renewal_attempts`, id, now).Scan(&attempt)
	if database.IsNoRows(err) {
		return 0, false, nil
	}
	return attempt, err == nil, err
}

func (Postgres) ReleaseRenewalRetry(ctx context.Context, q database.Querier, id string, at time.Time) error {
	_, err := q.Exec(ctx,
		`UPDATE gym.member_passes SET renewal_retry_at = $2, renewal_attempts = renewal_attempts - 1 WHERE id = $1`, id, at)
	return err
}

func (Postgres) StopAutoRenew(ctx context.Context, q database.Querier, id, reason string) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE gym.member_passes
		    SET auto_renew = false, auto_renew_off_reason = $2, renewal_retry_at = NULL, updated_at = now()
		  WHERE id = $1 AND auto_renew`, id, reason)
	return tag.RowsAffected() == 1, err
}

func (Postgres) ClearRenewalPurchase(ctx context.Context, q database.Querier, id string) error {
	_, err := q.Exec(ctx,
		`UPDATE gym.member_passes SET renewal_purchase_id = NULL, renewal_retry_at = NULL, updated_at = now() WHERE id = $1`, id)
	return err
}

func (Postgres) AutoRenewingPasses(ctx context.Context, q database.Querier) (int, error) {
	var n int
	err := q.QueryRow(ctx,
		`SELECT count(*)::int FROM gym.member_passes WHERE auto_renew AND status IN ('active', 'frozen')`).Scan(&n)
	return n, err
}
