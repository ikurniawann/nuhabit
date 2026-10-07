package offers

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// Venue is the CRM default venue; nil fields are not configured.
type Venue struct {
	CompanyID *string
	BranchID  *string
}

// Venues reads the CRM default venue (crm.crm_settings, owned by CRM).
type Venues interface {
	DefaultVenue(ctx context.Context, q database.Querier) Venue
}

// CrmSettingsVenue is the stopgap adapter: getCrmDefaultVenue in
// lib/crm/server.ts. Only JSON string values count; any failure is an
// unconfigured venue.
type CrmSettingsVenue struct{}

var _ Venues = CrmSettingsVenue{}

func (CrmSettingsVenue) DefaultVenue(ctx context.Context, q database.Querier) Venue {
	var v Venue
	rows, err := q.Query(ctx, `SELECT key, value #>> '{}' FROM crm.crm_settings
		WHERE key IN ('default_company_id', 'default_branch_id') AND jsonb_typeof(value) = 'string'`)
	if err != nil {
		return v
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var val *string
		if rows.Scan(&key, &val) != nil {
			return Venue{}
		}
		if key == "default_company_id" {
			v.CompanyID = val
		} else {
			v.BranchID = val
		}
	}
	if rows.Err() != nil {
		return Venue{}
	}
	return v
}
