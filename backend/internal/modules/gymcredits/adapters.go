package gymcredits

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/members"
)

// Read adapters for data owned by other contexts (customers, branches, class
// types, staff names). Each query is the one the TS code ran; when those
// contexts move out, internal/app swaps these for clients of their modules.

// SQLMembers reads pos.pos_customers.
type SQLMembers struct{}

var _ Members = SQLMembers{}

const memberSummaryCols = `id, name, phone, email, COALESCE(is_active, true) AS is_active`

func collectMembers(rows pgx.Rows, err error) ([]MemberSummary, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (MemberSummary, error) {
		var m MemberSummary
		err := row.Scan(&m.ID, &m.Name, &m.Phone, &m.Email, &m.IsActive)
		return m, err
	})
}

func (SQLMembers) Search(ctx context.Context, db database.Querier, term string, limit int) ([]MemberSummary, error) {
	return collectMembers(db.Query(ctx,
		`SELECT `+memberSummaryCols+` FROM pos.pos_customers
		  WHERE name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1
		  ORDER BY name NULLS LAST LIMIT $2`, "%"+term+"%", limit))
}

func (SQLMembers) ByIDs(ctx context.Context, db database.Querier, ids []string) ([]MemberSummary, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	return collectMembers(db.Query(ctx,
		`SELECT `+memberSummaryCols+` FROM pos.pos_customers WHERE id = ANY($1::uuid[])`, ids))
}

func (SQLMembers) Profile(ctx context.Context, db database.Querier, id string) (*MemberProfile, error) {
	var m MemberProfile
	err := db.QueryRow(ctx,
		`SELECT id, name, phone, email, COALESCE(is_active, true) AS is_active, membership_tier,
		        COALESCE(ark_coin_balance, 0)::float AS ark_balance_idr
		   FROM pos.pos_customers WHERE id = $1`, id,
	).Scan(&m.ID, &m.Name, &m.Phone, &m.Email, &m.IsActive, &m.MembershipTier, &m.ArkBalanceIdr)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &m, err
}

func (SQLMembers) LockForPurchase(ctx context.Context, tx database.Querier, id string) (active, found bool, err error) {
	err = tx.QueryRow(ctx,
		`SELECT COALESCE(is_active, true) AS is_active FROM pos.pos_customers WHERE id = $1 FOR UPDATE`, id,
	).Scan(&active)
	if database.IsNoRows(err) {
		return false, false, nil
	}
	return active, err == nil, err
}

func (SQLMembers) IsActive(ctx context.Context, db database.Querier, id string) (bool, error) {
	m, err := members.Get(ctx, db, id)
	return m != nil && m.IsActive, err
}

// SQLDirectory reads configuration.branches, configuration.users and
// gym.class_types (owned by gym scheduling).
type SQLDirectory struct{}

var _ Directory = SQLDirectory{}

func (SQLDirectory) ActiveBranches(ctx context.Context, db database.Querier) ([]Branch, error) {
	rows, err := db.Query(ctx,
		`SELECT id, name FROM configuration.branches WHERE COALESCE(is_active, true) ORDER BY name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Branch])
}

func (SQLDirectory) BranchNames(ctx context.Context, db database.Querier, ids []string) (map[string]string, error) {
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := db.Query(ctx, `SELECT id, name FROM configuration.branches WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	var id, name string
	_, err = pgx.ForEachRow(rows, []any{&id, &name}, func() error {
		out[id] = name
		return nil
	})
	return out, err
}

func (SQLDirectory) ActiveClassTypes(ctx context.Context, db database.Querier) ([]ClassType, error) {
	var ready bool
	if err := db.QueryRow(ctx, `SELECT to_regclass('gym.class_types') IS NOT NULL`).Scan(&ready); err != nil {
		return nil, err
	}
	if !ready {
		return []ClassType{}, nil
	}
	rows, err := db.Query(ctx, `SELECT id, name FROM gym.class_types WHERE status = 'active' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[ClassType])
	if out == nil && err == nil {
		out = []ClassType{}
	}
	return out, err
}

func (SQLDirectory) StaffNames(ctx context.Context, db database.Querier, ids []string) (map[string]*string, error) {
	out := map[string]*string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := db.Query(ctx, `SELECT id, full_name FROM configuration.users WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	var id string
	var name *string
	_, err = pgx.ForEachRow(rows, []any{&id, &name}, func() error {
		out[id] = name
		name = nil
		return nil
	})
	return out, err
}
