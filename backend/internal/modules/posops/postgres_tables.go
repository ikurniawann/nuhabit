package posops

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/database"
)

const tableColumns = `id::text, table_number, name, floor, area, capacity, status::text, qr_code, notes, is_active, pos_x::text, pos_y::text`

func scanTable(row pgx.Row) (domain.TableRow, error) {
	var t domain.TableRow
	err := row.Scan(&t.ID, &t.TableNumber, &t.Name, &t.Floor, &t.Area, &t.Capacity, &t.Status, &t.QrCode,
		&t.Notes, &t.IsActive, &t.PosX, &t.PosY)
	return t, err
}

func listTables(ctx context.Context, q database.Querier, includeInactive bool) ([]domain.TableRow, error) {
	sql := `SELECT ` + tableColumns + ` FROM pos.pos_tables`
	if !includeInactive {
		sql += ` WHERE is_active = true`
	}
	rows, err := q.Query(ctx, sql+` ORDER BY table_number ASC`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.TableRow, error) { return scanTable(r) })
}

func insertTable(ctx context.Context, q database.Querier, p domain.TablePayload, status string) (domain.TableRow, error) {
	return scanTable(q.QueryRow(ctx, `INSERT INTO pos.pos_tables
		(table_number, name, floor, area, qr_code, notes, capacity, is_active, status, current_order_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::pos_table_status, NULL)
		RETURNING `+tableColumns,
		p.TableNumber, p.Name, p.Floor, p.Area, p.QrCode, p.Notes, p.Capacity, p.IsActive, status))
}

// updateTable returns pgx.ErrNoRows when the id matches nothing.
func updateTable(ctx context.Context, q database.Querier, id string, p domain.TablePayload) (domain.TableRow, error) {
	return scanTable(q.QueryRow(ctx, `UPDATE pos.pos_tables SET
		table_number = $2, name = $3, floor = $4, area = $5, qr_code = $6, notes = $7, capacity = $8,
		is_active = $9, status = $10::text::pos_table_status, updated_at = now()
		WHERE id = $1::text::uuid RETURNING `+tableColumns,
		id, p.TableNumber, p.Name, p.Floor, p.Area, p.QrCode, p.Notes, p.Capacity, p.IsActive, p.Status))
}

// deactivateTable soft-deletes; false when the id matches nothing.
func deactivateTable(ctx context.Context, q database.Querier, id string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE pos.pos_tables SET is_active = false, status = 'maintenance', updated_at = now()
		WHERE id = $1::text::uuid`, id)
	return tag.RowsAffected() > 0, err
}

func moveTable(ctx context.Context, q database.Querier, id string, x, y float64) (*Obj, error) {
	return QueryObj(ctx, q, `UPDATE pos.pos_tables SET pos_x = $2, pos_y = $3, updated_at = now()
		WHERE id = $1::text::uuid RETURNING id, pos_x, pos_y`, id, x, y)
}
