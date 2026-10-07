// Package ticketing owns the venue ticketing context (/api/ticketing/**):
// the ticket master and its channel prices, the NFC band registry, walk-in
// visits with their two-way tab ledger, gate taps, website booking
// administration and redemption, season passes, venue settings, daily
// capacity and the ticketing report. Port of frontend/src/lib/ticketing.
//
// Concurrency follows the TS exactly so Go and Next can serve traffic side
// by side: visits, bands, bookings and passes are locked FOR UPDATE in the
// same order, and capacity checks take the same transactional advisory
// lock (hashtext(branch_id), hashtext(date)).
package ticketing

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Service holds the ticketing use cases.
type Service struct {
	db    database.DB
	ports Ports
	now   func() time.Time
	log   *slog.Logger
}

// NewService builds the service on a pool (or a test transaction).
func NewService(db database.DB, ports Ports, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, ports: ports, now: now, log: log}
}

// Venue is TicketingContext: the caller and the resolved venue.
type Venue struct {
	UserID    string
	CompanyID string
	BranchID  string
}

func (s *Service) inTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	return database.WithTx(ctx, s.db, fn)
}

func (s *Service) today() string { return domain.TodayJakarta(s.now()) }

// onDuplicate is conflictOnDuplicate: a unique violation becomes a 409
// with a specific message.
func onDuplicate(err error, msg string) error {
	if database.IsUniqueViolation(err) {
		return httpx.Conflict(msg)
	}
	return err
}

// lockOpenVisit is lockOpenVisit: FOR UPDATE on the venue's visit (the
// serialization point with gate taps, settlement and F&B charges); 404
// when missing, 409 closedMsg when not open.
func lockOpenVisit(ctx context.Context, q database.Querier, v Venue, visitID, closedMsg string) (paymentMode string, err error) {
	var status string
	err = q.QueryRow(ctx, `SELECT payment_mode, status FROM ticketing.ticket_visits
		WHERE id = $1 AND branch_id = $2 AND company_id = $3
		FOR UPDATE`, visitID, v.BranchID, v.CompanyID).Scan(&paymentMode, &status)
	if database.IsNoRows(err) {
		return "", httpx.NotFound("Kunjungan tidak ditemukan")
	}
	if err != nil {
		return "", err
	}
	if status != "open" {
		return "", httpx.Conflict(closedMsg)
	}
	return paymentMode, nil
}

// visitCharges loads the visit's ledger lines.
func visitCharges(ctx context.Context, q database.Querier, visitID string) ([]chargeLine, error) {
	var out []chargeLine
	err := scanAll(ctx, q, `SELECT band_id::text, direction, amount::float8 FROM ticketing.ticket_visit_charges WHERE visit_id = $1`,
		[]any{visitID}, func(scan func(...any) error) error {
			var c chargeLine
			err := scan(&c.BandID, &c.Direction, &c.Amount)
			out = append(out, c)
			return err
		})
	return out, err
}

type chargeLine struct {
	BandID    *string
	Direction string
	Amount    float64
}

func summarize(lines []chargeLine, keep func(chargeLine) bool) domain.TabSummary {
	entries := make([]domain.TabEntry, 0, len(lines))
	for _, l := range lines {
		if keep == nil || keep(l) {
			entries = append(entries, domain.TabEntry{Direction: l.Direction, Amount: l.Amount})
		}
	}
	return domain.ComputeTabSummary(entries)
}

// scanAll runs sql and hands each row's Scan to each.
func scanAll(ctx context.Context, q database.Querier, sql string, args []any, each func(scan func(...any) error) error) error {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := each(rows.Scan); err != nil {
			return err
		}
	}
	return rows.Err()
}
