package database

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// slowQueryTracer logs every statement that takes at least threshold. It
// logs the SQL text only, never the arguments, which may hold personal data.
type slowQueryTracer struct {
	threshold time.Duration
	log       *slog.Logger
}

type slowQueryKey struct{}

type slowQueryStart struct {
	at  time.Time
	sql string
}

func (t slowQueryTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	return context.WithValue(ctx, slowQueryKey{}, slowQueryStart{at: time.Now(), sql: data.SQL})
}

func (t slowQueryTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	start, ok := ctx.Value(slowQueryKey{}).(slowQueryStart)
	if !ok {
		return
	}
	took := time.Since(start.at)
	if took < t.threshold {
		return
	}
	attrs := []any{"duration_ms", took.Milliseconds(), "sql", compactSQL(start.sql), "rows", data.CommandTag.RowsAffected()}
	if data.Err != nil {
		attrs = append(attrs, "error", data.Err)
	}
	t.log.WarnContext(ctx, "slow query", attrs...)
}

// compactSQL collapses whitespace and caps the statement at 500 bytes so a
// log line stays one line.
func compactSQL(sql string) string {
	out := strings.Join(strings.Fields(sql), " ")
	if len(out) > 500 {
		out = out[:500] + "..."
	}
	return out
}
