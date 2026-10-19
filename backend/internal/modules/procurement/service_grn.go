package procurement

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Port of lib/purchasing/grn*.ts, grn-qc.ts and the GRN half of
// vendor-credit-service.ts. This file holds the helpers the service_grn_*.go
// files share: query (list, detail), validate, create, qc, posting (PO and
// delivery status, outbox events), credits (reject vendor credits) and
// update (continue, delete).

// receiveErr turns a receive-rule failure into the TS ApiError.badRequest.
func receiveErr(err error) error {
	var re *domain.ReceiveError
	if errors.As(err, &re) {
		return badRequest(re.Message)
	}
	return err
}

// serverMessage is ApiError.server(error.message || fallback): a 500 that
// carries the message.
func serverMessage(err error, fallback string) error {
	msg := pgMessage(err)
	if msg == "" {
		msg = fallback
	}
	return httpx.Status(500, msg)
}

/* ── List and detail ─────────────────────────────────────────────────── */

// lookup runs an id → text query (selectByIds) into a map; NULL texts are "".
func (s *Service) lookup(ctx context.Context, sql string, ids []string) (map[string]string, error) {
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(ctx, sql, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var v *string
		if err := rows.Scan(&id, &v); err != nil {
			return nil, err
		}
		out[id] = deref(v)
	}
	return out, rows.Err()
}

func intOr1(v any) any {
	if n, ok := v.(int32); ok && n != 0 {
		return n
	}
	return 1
}

// nonFatal runs fn in a savepoint; a failure is logged and rolled back,
// as the TS try/catch blocks around side effects did.
func (s *Service) nonFatal(ctx context.Context, q database.TxBeginner, label string, fn func(pgx.Tx) error) {
	if err := database.WithTx(ctx, q, fn); err != nil {
		s.log.ErrorContext(ctx, label+" (non-fatal)", "error", err)
	}
}

/* ── Vendor credits from rejects ─────────────────────────────────────── */

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func jsonOrNil(raw json.RawMessage) *string {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	s := string(raw)
	return &s
}

/* ── Create ──────────────────────────────────────────────────────────── */

// jsString is String(v) for a scalar column (null → "null").
func jsString(v any) string {
	if v == nil {
		return "null"
	}
	if s, ok := v.(string); ok {
		return s
	}
	b, _ := marshalJS(v)
	return string(b)
}
