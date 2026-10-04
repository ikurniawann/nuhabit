// Package database owns the PostgreSQL pool and the transaction boundary.
package database

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Querier is the subset of pgx repositories use. Both *pgxpool.Pool and
// pgx.Tx satisfy it, so a repository runs inside or outside a transaction.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

var (
	_ Querier = (*pgxpool.Pool)(nil)
	_ Querier = (pgx.Tx)(nil)
)

// SearchPath mirrors SEARCH_PATH in frontend/src/lib/db.ts: bare table
// names resolve the way the TS routes expect ("users" is configuration.users,
// "employees" is hris.employees). auth stays last on purpose.
const SearchPath = "public,iam,configuration,hris,performance,recruitment,item,purchasing,inventory,manufacturing,pos,crm,accounting,auth"

// TimeZone is the session time zone the TS pool forces, so ::date casts and
// timestamptz comparisons behave the same.
const TimeZone = "Asia/Jakarta"

// Open connects a pool with the TS session settings (search_path, timezone)
// and pings it once.
func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	if url == "" {
		return nil, errors.New("database: DATABASE_URL is empty")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("database: parse url: %w", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = SearchPath
	cfg.ConnConfig.RuntimeParams["timezone"] = TimeZone
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("database: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database: ping: %w", err)
	}
	return pool, nil
}

// TxBeginner starts a transaction. *pgxpool.Pool and pgx.Tx both satisfy
// it; Begin on a pgx.Tx opens a savepoint, so WithTx nests inside a test's
// rolled-back transaction.
type TxBeginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

var (
	_ TxBeginner = (*pgxpool.Pool)(nil)
	_ TxBeginner = (pgx.Tx)(nil)
)

// WithTx runs fn inside a transaction (a savepoint when db is a pgx.Tx):
// commit on nil, rollback otherwise (including on panic, which is re-raised).
func WithTx(ctx context.Context, db TxBeginner, fn func(pgx.Tx) error) (err error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// PgCode returns the SQLSTATE of a PostgreSQL error, or "".
func PgCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

// IsUniqueViolation reports SQLSTATE 23505.
func IsUniqueViolation(err error) bool { return PgCode(err) == "23505" }

// IsUndefinedTable reports SQLSTATE 42P01 (relation does not exist).
func IsUndefinedTable(err error) bool { return PgCode(err) == "42P01" }

// IsNoRows reports pgx.ErrNoRows.
func IsNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
