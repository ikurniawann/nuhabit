// Package reports ports the fixed CRM reports: loyalty (top spenders,
// frequent visitors, ARK reconciliation per venue) and customer service.
// GET /api/crm/reports/conversations stays in TS (it can return xlsx).
package reports

import (
	"context"
	"net/http"
	"time"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/reports/domain"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// PosReports are the POS and wallet aggregates the loyalty report reads
// (pos_orders, pos_wallet_transactions, pos_customers balances). Rows keep
// the node-postgres shapes the TS mappers read.
type PosReports interface {
	TopSpenders(ctx context.Context, q database.Querier, from, to string) ([]*kit.Row, error)
	FrequentVisitors(ctx context.Context, q database.Querier, from, to string) ([]*kit.Row, error)
	VenueReconciliation(ctx context.Context, q database.Querier, from, to string) ([]*kit.Row, error)
	UntaggedTopups(ctx context.Context, q database.Querier, from, to string) (*kit.Row, error)
	MemberSummary(ctx context.Context, q database.Querier) (*kit.Row, error)
}

// Ports are the capabilities of other bounded contexts this area uses.
type Ports struct {
	Pos PosReports
}

type handler struct {
	db    database.DB
	guard kit.Guard
	pos   PosReports
	now   func() time.Time
}

// Routes mounts the area's routes.
func Routes(d module.Deps, _ *xp.Engine, p Ports) []module.Route {
	return newHandler(d.DB, d, p).routes()
}

func newHandler(db database.DB, d module.Deps, p Ports) *handler {
	now := d.Now
	if now == nil {
		now = time.Now
	}
	pos := p.Pos
	if pos == nil {
		pos = PosReportsSQL{}
	}
	return &handler{db: db, guard: kit.Guard{Auth: d.Auth, DB: db}, pos: pos, now: now}
}

func (h *handler) routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/crm/reports", Handler: httpx.Handle(h.loyalty)},
		{Pattern: "GET /api/crm/reports/cs", Handler: httpx.Handle(h.cs)},
	}
}

// requirePeriod mirrors requireReportPeriod.
func (h *handler) requirePeriod(r *http.Request) (*domain.Period, error) {
	q := r.URL.Query()
	p := domain.ResolvePeriod(q.Get("from"), q.Get("to"), h.now())
	if p == nil {
		return nil, httpx.BadRequest("Periode tidak valid (format YYYY-MM-DD, from <= to, maksimal 366 hari)")
	}
	return p, nil
}
