package gymcredits

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
)

// NewTransfer is a credit transfer to record. Empty strings are NULL.
type NewTransfer struct {
	FromCustomerID string
	ToCustomerID   string
	Credits        int
	Channel        string // staff | member
	Note           string
	IdempotencyKey string
	CreatedBy      string
}

// TransferRow is a recorded transfer.
type TransferRow struct {
	ID             string
	FromCustomerID string
	ToCustomerID   string
	Credits        int
}

func (Postgres) InsertTransfer(ctx context.Context, q database.Querier, t NewTransfer) (string, error) {
	rows, err := q.Query(ctx,
		`INSERT INTO gym.credit_transfers (from_customer_id, to_customer_id, credits, channel, note, idempotency_key, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (idempotency_key) DO NOTHING RETURNING id::text`,
		t.FromCustomerID, t.ToCustomerID, t.Credits, t.Channel, null(t.Note), t.IdempotencyKey, null(t.CreatedBy))
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil || len(ids) == 0 {
		return "", err
	}
	return ids[0], nil
}

func (Postgres) TransferByKey(ctx context.Context, q database.Querier, key string) (*TransferRow, error) {
	rows, err := q.Query(ctx,
		`SELECT id::text, from_customer_id::text, to_customer_id::text, credits
		   FROM gym.credit_transfers WHERE idempotency_key = $1`, key)
	if err != nil {
		return nil, err
	}
	row, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[TransferRow])
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &row, err
}

func (Postgres) InsertTransferLot(ctx context.Context, q database.Querier, transferID, sourceLotID, targetLotID string, credits int) error {
	_, err := q.Exec(ctx,
		`INSERT INTO gym.credit_transfer_lots (transfer_id, source_lot_id, target_lot_id, credits) VALUES ($1, $2, $3, $4)`,
		transferID, sourceLotID, targetLotID, credits)
	return err
}

func (Postgres) CreditsSentSince(ctx context.Context, q database.Querier, customerID string, since time.Time) (int, error) {
	var n int
	err := q.QueryRow(ctx,
		`SELECT COALESCE(sum(credits), 0)::int FROM gym.credit_transfers WHERE from_customer_id = $1 AND created_at >= $2`,
		customerID, since).Scan(&n)
	return n, err
}

// UpcomingBookings is the credits the member's confirmed bookings for
// classes after now will draw at check-in (scheduling's tables, read
// until scheduling exposes them).
func (SQLDirectory) UpcomingBookings(ctx context.Context, db database.Querier, customerID string, now time.Time) ([]domain.Demand, error) {
	var ready bool
	if err := db.QueryRow(ctx, `SELECT to_regclass('gym.bookings') IS NOT NULL`).Scan(&ready); err != nil || !ready {
		return nil, err
	}
	rows, err := db.Query(ctx,
		`SELECT COALESCE(s.class_type_id::text, ''), s.credit_cost, s.starts_at
		   FROM gym.bookings b JOIN gym.class_sessions s ON s.id = b.session_id
		  WHERE b.customer_id = $1 AND b.status = 'confirmed' AND s.starts_at > $2 AND s.credit_cost > 0`, customerID, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Demand, error) {
		var d domain.Demand
		return d, r.Scan(&d.ClassTypeID, &d.Credits, &d.At)
	})
}
