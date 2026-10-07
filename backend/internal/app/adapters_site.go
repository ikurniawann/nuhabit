package app

import (
	"context"
	"encoding/json"

	"nuhabit/backend/internal/modules/configuration/branches"
	"nuhabit/backend/internal/modules/site"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// SitePorts wires the site module on the shared pool.
func SitePorts(d module.Deps) site.Ports { return SitePortsOn(d.DB) }

// SitePortsOn wires the site module on q; integration tests pass their
// rolled-back transaction.
func SitePortsOn(q database.Querier) site.Ports {
	return site.Ports{Branches: siteBranches{db: q}}
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
