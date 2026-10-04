package app

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/modules/ticketing"
	"nuhabit/backend/internal/platform/database"
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
	var companyID, branchID *string
	var scope *string
	err := a.db.QueryRow(ctx, `SELECT business_scope, company_id::text, branch_id::text
		FROM configuration.users WHERE id = $1`, userID).Scan(&scope, &companyID, &branchID)
	if err != nil && !database.IsNoRows(err) {
		return "", "", err
	}
	text := func(s *string) string {
		if s == nil {
			return ""
		}
		return *s
	}
	company, branch := text(companyID), ""
	if text(scope) == "branch" {
		branch = text(branchID)
	}
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
type ticketingMessenger struct{ wa *posOpsWhatsApp }

var _ ticketing.Messenger = ticketingMessenger{}

func (m ticketingMessenger) SendText(ctx context.Context, target, message string) error {
	cfg := m.wa.gatewayConfig(ctx)
	if cfg == nil {
		return ticketing.ErrMessengerNotConfigured
	}
	if res := m.wa.sendGateway(ctx, cfg, target, message); !res.delivered {
		return errors.New(res.reason)
	}
	return nil
}
