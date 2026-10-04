package app

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/modules/ticketing"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Adapters for the ticketing ports.

// ticketingVenues is resolveTicketingVenue(getApiUserScope()): the
// company of a scoped user, the branch only for branch-scoped users, then
// the CRM default_company_id / default_branch_id settings for what is
// missing. A crm_settings failure leaves the ids empty (the route answers
// 400), as the TS catch does.
type ticketingVenues struct{ db *pgxpool.Pool }

var _ ticketing.Venues = ticketingVenues{}

func (a ticketingVenues) Resolve(ctx context.Context, userID string) (string, string, error) {
	sc, err := scope.Load(ctx, a.db, userID)
	if err != nil {
		return "", "", err
	}
	text := func(s *string) string {
		if s == nil {
			return ""
		}
		return *s
	}
	companyID, branchID := scope.ImportBusinessIDs(sc)
	company, branch := text(companyID), text(branchID)
	if company != "" && branch != "" {
		return company, branch, nil
	}
	rows, err := a.db.Query(ctx, `SELECT key, CASE WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}' END
		FROM crm.crm_settings WHERE key IN ('default_company_id', 'default_branch_id')`)
	if err != nil {
		return company, branch, nil
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var value *string
		if rows.Scan(&key, &value) != nil || value == nil || *value == "" {
			continue
		}
		switch {
		case key == "default_company_id" && company == "":
			company = *value
		case key == "default_branch_id" && branch == "":
			branch = *value
		}
	}
	return company, branch, nil
}

// ticketingEmployees reads hris.employees for staff band pairing and the
// gate (the TS joins the table inline), on the caller's Querier.
type ticketingEmployees struct{}

var _ ticketing.Employees = ticketingEmployees{}

func (ticketingEmployees) Find(ctx context.Context, q database.Querier, ids []string, pattern string) ([]ticketing.Employee, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := q.Query(ctx, `SELECT id::text, full_name, nip, is_active,
		  $2 <> '' AND (full_name ILIKE $2 OR COALESCE(nip ILIKE $2, false))
		FROM hris.employees WHERE id = ANY($1::uuid[])
		ORDER BY full_name`, ids, pattern)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ticketing.Employee
	for rows.Next() {
		var e ticketing.Employee
		if err := rows.Scan(&e.ID, &e.FullName, &e.NIP, &e.IsActive, &e.Matched); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ticketingMessenger sends booking texts through the self-hosted gateway
// only (booking-wa.ts calls loadGatewayConfig + sendGatewayText directly,
// without the provider switch or the crm.wa_messages log).
type ticketingMessenger struct {
	db *pgxpool.Pool
	wa *whatsapp.Client
}

var _ ticketing.Messenger = ticketingMessenger{}

func (m ticketingMessenger) SendText(ctx context.Context, target, message string) error {
	gateway := m.wa.LoadGateway(ctx, m.db)
	if gateway == nil {
		return ticketing.ErrMessengerNotConfigured
	}
	if res := gateway.SendText(ctx, target, message); !res.Success {
		return errors.New(res.Reason)
	}
	return nil
}
