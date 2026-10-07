// Package members is the shared read model of members (pos.pos_customers,
// owned by the POS/CRM context). Modules that only need a member's display
// fields read them here instead of querying the table themselves.
package members

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Member is the display subset of pos.pos_customers. Nullable columns are
// pointers so null stays null in JSON.
type Member struct {
	ID       string
	Name     *string
	Phone    string
	Email    *string
	PhotoURL *string
	// IsActive is pos_customers.is_active; a NULL counts as active, matching
	// the column default.
	IsActive bool
}

const selectMember = `SELECT id::text, name, phone, email, photo_url, COALESCE(is_active, true)
  FROM pos.pos_customers`

func scan(row pgx.Row) (Member, error) {
	var m Member
	err := row.Scan(&m.ID, &m.Name, &m.Phone, &m.Email, &m.PhotoURL, &m.IsActive)
	return m, err
}

// Get returns one member, or nil, nil when the id does not exist. q is the
// pool or an open transaction.
func Get(ctx context.Context, q database.Querier, id string) (*Member, error) {
	m, err := scan(q.QueryRow(ctx, selectMember+` WHERE id = $1`, id))
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// GetMany returns the members that exist among ids, keyed by id.
func GetMany(ctx context.Context, q database.Querier, ids []string) (map[string]Member, error) {
	out := make(map[string]Member, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, selectMember+` WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Member, error) { return scan(r) })
	if err != nil {
		return nil, err
	}
	for _, m := range list {
		out[m.ID] = m
	}
	return out, nil
}
