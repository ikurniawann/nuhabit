package kit

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// Venue is the single-venue company/branch stamp from crm_settings.
type Venue struct {
	CompanyID *string
	BranchID  *string
}

// DefaultVenue mirrors getCrmDefaultVenue: default_company_id and
// default_branch_id when they are JSON strings; any failure is an empty venue.
func DefaultVenue(ctx context.Context, q database.Querier) Venue {
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
		switch key {
		case "default_company_id":
			v.CompanyID = val
		case "default_branch_id":
			v.BranchID = val
		}
	}
	if rows.Err() != nil {
		return Venue{}
	}
	return v
}
