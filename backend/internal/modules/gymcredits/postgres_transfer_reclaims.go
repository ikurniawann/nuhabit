package gymcredits

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
)

// TransferDetail is a transfer with the lots it moved.
type TransferDetail struct {
	TransferRow
	Channel   string
	Note      *string
	CreatedBy *string
	CreatedAt time.Time
	Lots      []domain.TransferLotState
}

// LotTransferOut is credits of one lot that a transfer moved to another
// member and that no reclaim brought back.
type LotTransferOut struct {
	TransferID   string
	ToCustomerID string
	Credits      int
}

const transferDetailCols = `t.id::text, t.from_customer_id::text, t.to_customer_id::text, t.credits, t.channel, t.note, t.created_by::text, t.created_at`

func scanTransferDetail(row pgx.CollectableRow) (TransferDetail, error) {
	var d TransferDetail
	err := row.Scan(&d.ID, &d.FromCustomerID, &d.ToCustomerID, &d.Credits, &d.Channel, &d.Note, &d.CreatedBy, &d.CreatedAt)
	return d, err
}

func transferLots(ctx context.Context, q database.Querier, transferIDs []string) (map[string][]domain.TransferLotState, error) {
	rows, err := q.Query(ctx,
		`SELECT transfer_id::text, id::text, source_lot_id::text, target_lot_id::text, credits, reclaimed_credits
		   FROM gym.credit_transfer_lots WHERE transfer_id = ANY($1::uuid[]) ORDER BY id`, transferIDs)
	if err != nil {
		return nil, err
	}
	out := map[string][]domain.TransferLotState{}
	var transferID string
	var l domain.TransferLotState
	_, err = pgx.ForEachRow(rows, []any{&transferID, &l.ID, &l.SourceLotID, &l.TargetLotID, &l.Credits, &l.Reclaimed}, func() error {
		out[transferID] = append(out[transferID], l)
		return nil
	})
	return out, err
}

// TransferForReclaim locks the transfer row and returns it with its lots;
// nil when the transfer does not exist.
func (Postgres) TransferForReclaim(ctx context.Context, q database.Querier, id string) (*TransferDetail, error) {
	rows, err := q.Query(ctx, `SELECT `+transferDetailCols+` FROM gym.credit_transfers t WHERE t.id = $1 FOR UPDATE`, id)
	if err != nil {
		return nil, err
	}
	found, err := pgx.CollectRows(rows, scanTransferDetail)
	if err != nil || len(found) == 0 {
		return nil, err
	}
	lots, err := transferLots(ctx, q, []string{id})
	if err != nil {
		return nil, err
	}
	found[0].Lots = lots[id]
	return &found[0], nil
}

// AddReclaimed records credits a reclaim took back from one moved lot.
func (Postgres) AddReclaimed(ctx context.Context, q database.Querier, transferLotID string, credits int) error {
	_, err := q.Exec(ctx, `UPDATE gym.credit_transfer_lots SET reclaimed_credits = reclaimed_credits + $2 WHERE id = $1`, transferLotID, credits)
	return err
}

// TransfersOf lists the member's transfers, sent or received, newest first.
func (Postgres) TransfersOf(ctx context.Context, q database.Querier, customerID string, limit int) ([]TransferDetail, error) {
	rows, err := q.Query(ctx, `SELECT `+transferDetailCols+` FROM gym.credit_transfers t
		  WHERE t.from_customer_id = $1 OR t.to_customer_id = $1 ORDER BY t.created_at DESC LIMIT $2`, customerID, limit)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, scanTransferDetail)
	if err != nil || len(out) == 0 {
		return out, err
	}
	ids := make([]string, len(out))
	for i, t := range out {
		ids[i] = t.ID
	}
	lots, err := transferLots(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Lots = lots[out[i].ID]
	}
	return out, nil
}

// LotTransfersOut lists what transfers moved out of lotID and still hold
// at the receivers: credits moved minus credits reclaimed, per transfer.
func (Postgres) LotTransfersOut(ctx context.Context, q database.Querier, lotID string) ([]LotTransferOut, error) {
	rows, err := q.Query(ctx,
		`SELECT t.id::text, t.to_customer_id::text, tl.credits - tl.reclaimed_credits
		   FROM gym.credit_transfer_lots tl JOIN gym.credit_transfers t ON t.id = tl.transfer_id
		  WHERE tl.source_lot_id = $1 AND tl.credits > tl.reclaimed_credits
		  ORDER BY t.created_at`, lotID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[LotTransferOut])
}
