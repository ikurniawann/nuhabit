package importer

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Lookups the import files share: the codes and emails a row names,
// resolved to the ids the create services take.

// BranchID resolves an active branch by code, else by name; "" when none.
func BranchID(ctx context.Context, q database.Querier, code string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM configuration.branches
		WHERE is_active AND (upper(code) = upper($1) OR lower(name) = lower($1))
		ORDER BY (upper(code) = upper($1)) DESC, created_at LIMIT 1`, code).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// StaffUserID resolves a staff account by email; "" when none.
func StaffUserID(ctx context.Context, q database.Querier, email string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM configuration.users WHERE lower(email) = lower($1) ORDER BY created_at LIMIT 1`, email).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}
