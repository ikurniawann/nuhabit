package identity

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// Postgres implements Repository.
type Postgres struct{ db database.Querier }

// NewPostgres builds the repository on a pool or transaction.
func NewPostgres(db database.Querier) *Postgres { return &Postgres{db: db} }

// Profile reads configuration.users. email is not selected: that column is
// optional there, the session (auth.users) supplies it.
func (p *Postgres) Profile(ctx context.Context, userID string) (*Profile, error) {
	var out Profile
	err := p.db.QueryRow(ctx,
		`SELECT id::text, full_name, role, brand_id::text FROM configuration.users WHERE id = $1`, userID).
		Scan(&out.ID, &out.FullName, &out.Role, &out.BrandID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}
