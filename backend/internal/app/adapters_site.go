package app

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/configuration/branches"
	"nuhabit/backend/internal/modules/site"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// SitePorts wires the site module on the shared pool.
func SitePorts(d module.Deps) site.Ports { return SitePortsOn(d, d.DB) }

// SitePortsOn wires the site module on db; integration tests pass their
// rolled-back transaction.
func SitePortsOn(d module.Deps, db database.DB) site.Ports {
	return site.Ports{Branches: siteBranches{db: db}, Calendar: EventCalendar(d, db), News: siteNewsAudience{db: db}}
}

// siteNewsAudience tells the member news feed which branches a member
// trains at: those of the gym packages they bought in the last year and of
// the classes and PT sessions they booked in the last 90 days.
type siteNewsAudience struct{ db database.Querier }

var _ site.NewsAudience = siteNewsAudience{}

func (a siteNewsAudience) Branches(ctx context.Context) ([]site.BranchOption, error) {
	rows, err := a.db.Query(ctx, `SELECT id::text, name FROM configuration.branches WHERE is_active ORDER BY name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[site.BranchOption])
}

func (a siteNewsAudience) MemberBranches(ctx context.Context, customerID string) ([]string, error) {
	rows, err := a.db.Query(ctx, `
SELECT DISTINCT branch_id::text FROM (
  SELECT COALESCE(p.branch_id, k.branch_id) AS branch_id
    FROM gym.credit_purchases p JOIN gym.credit_packages k ON k.id = p.package_id
   WHERE p.customer_id = $1 AND p.status = 'paid' AND p.created_at > now() - interval '365 days'
  UNION ALL
  SELECT s.branch_id FROM gym.bookings b JOIN gym.class_sessions s ON s.id = b.session_id
   WHERE b.customer_id = $1 AND s.starts_at > now() - interval '90 days'
  UNION ALL
  SELECT ap.branch_id FROM gym.pt_participants pp JOIN gym.pt_appointments ap ON ap.id = pp.appointment_id
   WHERE pp.customer_id = $1 AND ap.starts_at > now() - interval '90 days'
) x WHERE branch_id IS NOT NULL`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// siteBranches reads public branch profiles from the configuration context.
type siteBranches struct{ db database.Querier }

var _ site.Branches = siteBranches{}

// toSiteBranch maps a configuration profile to the site's own type; the
// two share field names and JSON tags, so JSON carries it over.
func toSiteBranch(p branches.Profile) (site.Branch, error) {
	var b site.Branch
	raw, err := json.Marshal(p)
	if err != nil {
		return b, err
	}
	return b, json.Unmarshal(raw, &b)
}

func (s siteBranches) Public(ctx context.Context) ([]site.Branch, error) {
	list, err := (branches.Service{}).PublicProfiles(ctx, s.db)
	if err != nil {
		return nil, err
	}
	out := make([]site.Branch, 0, len(list))
	for _, p := range list {
		b, err := toSiteBranch(p)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, nil
}

func (s siteBranches) BySlug(ctx context.Context, slug string) (*site.Branch, error) {
	p, err := (branches.Service{}).PublicProfile(ctx, s.db, slug)
	if err != nil || p == nil {
		return nil, err
	}
	b, err := toSiteBranch(*p)
	if err != nil {
		return nil, err
	}
	return &b, nil
}
