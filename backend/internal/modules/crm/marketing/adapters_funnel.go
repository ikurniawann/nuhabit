package marketing

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// FunnelSQL is the stopgap Funnel adapter on the sales-funnel tables
// (crm.crm_sales_leads, crm.crm_contacts, crm.crm_accounts).
// Stopgap adapter: moves to the sales-funnel context.
type FunnelSQL struct{}

var _ Funnel = FunnelSQL{}

// SegmentCount runs a count query built by domain.BuildSegmentQuery.
func (FunnelSQL) SegmentCount(ctx context.Context, q database.Querier, sql string, args []any) (int, error) {
	var n int
	err := scanSimple(ctx, q, sql, args, &n)
	return n, err
}

// SegmentSample runs a sample query built by domain.BuildSegmentQuery.
func (FunnelSQL) SegmentSample(ctx context.Context, q database.Querier, sql string, args []any) ([]SegmentMember, error) {
	rows, err := q.Query(ctx, sql, append([]any{pgx.QueryExecModeSimpleProtocol}, args...)...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SegmentMember, error) {
		var m SegmentMember
		return m, r.Scan(&m.ID, &m.Name, &m.Phone)
	})
}

// Leads returns org_name, pic_name and pic_phone by lead id.
func (FunnelSQL) Leads(ctx context.Context, q database.Querier, ids []string) (map[string]Lead, error) {
	rows, err := q.Query(ctx, `SELECT id::text, org_name, pic_name, pic_phone FROM crm.crm_sales_leads WHERE id = ANY($1::text[]::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Lead{}
	for rows.Next() {
		var id string
		var l Lead
		if err := rows.Scan(&id, &l.OrgName, &l.PicName, &l.PicPhone); err != nil {
			return nil, err
		}
		out[id] = l
	}
	return out, rows.Err()
}
