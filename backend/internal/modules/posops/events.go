package posops

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
)

// TableStatusSubscriber is the outbox subscriber name of ApplyTableStatus.
const TableStatusSubscriber = "pos-ops.table-status"

// ApplyTableStatus handles pos.table.status_changed: a bill merge or item
// transfer in pos-sales freed or occupied a table, which the TS routes
// wrote inline (status and updated_at). Setting a status is idempotent.
// The TS ignored a failing table update, so a bad table id or status is
// dropped (in a savepoint) instead of retried.
func (s *Service) ApplyTableStatus(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
	var p possales.TableStatusChanged
	if err := e.Decode(&p); err != nil {
		s.log.WarnContext(ctx, "pos-ops: bad table status event", "event", e.ID, "error", err)
		return nil
	}
	if p.Status != "available" && p.Status != "occupied" {
		return nil
	}
	if p.IfNoOtherActiveOrder && p.Status == "available" {
		busy, err := s.ports.Sales.TableHasActiveOrder(ctx, tx, p.TableID, p.ExceptOrderID)
		if err != nil {
			return err
		}
		if busy {
			return nil
		}
	}
	err := database.WithTx(ctx, tx, func(sp pgx.Tx) error {
		_, err := sp.Exec(ctx, `UPDATE pos.pos_tables SET status = $2::pos_table_status, updated_at = $3
			WHERE id = $1::text::uuid`, p.TableID, p.Status, e.CreatedAt)
		return err
	})
	if err != nil {
		s.log.WarnContext(ctx, "pos-ops: table status not applied", "table_id", p.TableID, "error", err)
	}
	return nil
}
