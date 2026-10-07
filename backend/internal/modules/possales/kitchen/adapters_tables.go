package kitchen

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// TablesSQL is the stopgap TableLookup on pos.pos_tables (owned by pos-ops):
// the `.from('pos_tables').select('id, table_number, qr_code').in('id', ids)`
// read of GET /api/pos/kds. Replace it with a pos-ops adapter in internal/app.
type TablesSQL struct{ DB database.Querier }

// Tables implements TableLookup.
func (s TablesSQL) Tables(ctx context.Context, ids []string) (map[string]TableRef, error) {
	rows, err := s.DB.Query(ctx, `SELECT id::text, table_number, COALESCE(qr_code, '')
		FROM pos.pos_tables WHERE id = ANY($1::text[]::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]TableRef{}
	for rows.Next() {
		var id string
		var t TableRef
		if err := rows.Scan(&id, &t.TableNumber, &t.QRCode); err != nil {
			return nil, err
		}
		out[id] = t
	}
	return out, rows.Err()
}
