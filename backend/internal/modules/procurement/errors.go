package procurement

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/platform/httpx"
)

// pgMessage is `error.message` of a node-postgres error: the server message
// for a PostgreSQL error, the Go error text otherwise.
func pgMessage(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Message
	}
	return err.Error()
}

// isPgError reports a server-side PostgreSQL error (the query builder
// returned those as { message, code } instead of throwing).
func isPgError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr)
}

// plainError drops the SQLSTATE so Handle answers 500, as the TS does when
// it rethrows `new Error(updateError.message)`.
func plainError(err error) error {
	if err == nil {
		return nil
	}
	return errors.New(pgMessage(err))
}

// errNoRows is the query builder's PGRST116 "No rows found" from .single():
// it carries no SQLSTATE, so routes that rethrow it answer 500.
var errNoRows = errors.New("No rows found")

var (
	badRequest = httpx.BadRequest
	notFound   = httpx.NotFound
	forbidden  = httpx.Forbidden
)
