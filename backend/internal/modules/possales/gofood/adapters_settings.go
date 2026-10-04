package gofood

import (
	"context"

	"nuhabit/backend/internal/modules/possales/gofood/domain"
	"nuhabit/backend/internal/platform/database"
)

// Stopgap adapters for data pos-sales reads from contexts that no wave owns
// yet (settings) or that CRM owns (crm_settings). Swap them for the owning
// module's service once one exists.

// SettingsSQL is loadGobizConfig over configuration.app_settings.
type SettingsSQL struct{}

// LoadConfig reads the gobiz_* settings.
func (SettingsSQL) LoadConfig(ctx context.Context, q database.Querier) (domain.Config, error) {
	rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`, domain.SettingKeys)
	if err != nil {
		return domain.Config{}, err
	}
	defer rows.Close()
	values := map[string]*string{}
	for rows.Next() {
		var key string
		var value *string
		if err := rows.Scan(&key, &value); err != nil {
			return domain.Config{}, err
		}
		values[key] = value
	}
	if err := rows.Err(); err != nil {
		return domain.Config{}, err
	}
	return domain.ConfigFromSettings(values), nil
}

// CrmVenueSQL is getCrmDefaultVenue: crm_settings default_company_id and
// default_branch_id when stored as JSON strings; any failure is "no venue".
type CrmVenueSQL struct{}

// DefaultVenue never fails, like the TS helper.
func (CrmVenueSQL) DefaultVenue(ctx context.Context, q database.Querier) Venue {
	var v Venue
	rows, err := q.Query(ctx, `SELECT key, value #>> '{}' FROM crm.crm_settings
		WHERE key IN ('default_company_id', 'default_branch_id') AND jsonb_typeof(value) = 'string'`)
	if err != nil {
		return v
	}
	defer rows.Close()
	for rows.Next() {
		var key, value string
		if rows.Scan(&key, &value) != nil {
			return Venue{}
		}
		if key == "default_company_id" {
			v.CompanyID = &value
		} else {
			v.BranchID = &value
		}
	}
	if rows.Err() != nil {
		return Venue{}
	}
	return v
}
