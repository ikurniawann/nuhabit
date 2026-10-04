// Package accounting is the accounting bounded context: chart of accounts,
// account types, fiscal years and periods, journal entries and the journal
// mappings operational modules post through, beginning balances, cash &
// bank, AP and AR, the subsidiary ledger, financial reports and the
// dashboard, plus the Finance B2B invoice API. It owns every journal: POS
// sales, member bill instalments, GRNs, purchase returns and stock
// movements arrive as outbox events and are posted here.
//
// Port of frontend/src/lib/accounting/**, frontend/src/lib/finance/** and the
// posting helpers in lib/pos, lib/purchasing and lib/inventory.
package accounting

import (
	"context"
	"log/slog"
	"time"

	"nuhabit/backend/internal/platform/database"
	pscope "nuhabit/backend/internal/platform/scope"
)

// Service holds the accounting use cases. db is the pool in production and
// a test transaction in integration tests; writes nest as savepoints.
type Service struct {
	db    database.DB
	ports Ports
	log   *slog.Logger
	now   func() time.Time
}

// NewService builds the service.
func NewService(db database.DB, ports Ports, log *slog.Logger, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{db: db, ports: ports, log: log, now: now}
}

// today is new Date().toISOString().slice(0, 10): the UTC calendar date,
// which is what the TS stores use for default dates and document numbers.
func (s *Service) today() string { return s.now().UTC().Format("2006-01-02") }

// todayCompact is the YYYYMMDD of the server-local (UTC) date, used by the
// AP/AR document numbers (getFullYear/getMonth/getDate).
func (s *Service) todayCompact() string { return s.now().UTC().Format("20060102") }

// Scope resolves the user's business scope.
func (s *Service) Scope(ctx context.Context, userID string) (*pscope.Scope, error) {
	return pscope.Load(ctx, s.db, userID)
}
