// Package branches is the configuration.branches read service other
// contexts reach through their ports. Every method runs on the caller's
// Querier, so it joins the caller's transaction.
package branches

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// Service reads configuration.branches.
type Service struct{}

// Name is the branch's name, nil when the branch does not exist.
func (Service) Name(ctx context.Context, q database.Querier, id string) (*string, error) {
	var name *string
	err := q.QueryRow(ctx, `SELECT name FROM configuration.branches WHERE id = $1`, id).Scan(&name)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return name, err
}
