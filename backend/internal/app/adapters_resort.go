package app

import (
	"context"

	"nuhabit/backend/internal/modules/resort"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/scope"
)

// resortVenues is resolveVenue (lib/resort/server.ts): the raw company_id
// and branch_id of the user's business scope, then the CRM
// default_company_id / default_branch_id settings for what is missing. A
// crm_settings failure leaves the ids empty (the route answers 409), as the
// TS .catch(() => []) does. A non-string JSON value is its text with the
// double quotes removed (String(value).replace(/"/g, "")).
type resortVenues struct{ db database.Querier }

var _ resort.Venues = resortVenues{}

func (a resortVenues) Resolve(ctx context.Context, userID string) (string, string, error) {
	sc, err := scope.Load(ctx, a.db, userID)
	if err != nil {
		return "", "", err
	}
	var companyID, branchID string
	if sc.CompanyID != nil {
		companyID = *sc.CompanyID
	}
	if sc.BranchID != nil {
		branchID = *sc.BranchID
	}
	if companyID != "" && branchID != "" {
		return companyID, branchID, nil
	}
	rows, err := a.db.Query(ctx, `SELECT key, CASE jsonb_typeof(value)
	    WHEN 'string' THEN value #>> '{}'
	    WHEN 'null' THEN ''
	    ELSE replace(value::text, '"', '') END
	  FROM crm.crm_settings WHERE key IN ('default_company_id', 'default_branch_id')`)
	if err != nil {
		return companyID, branchID, nil
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var value *string
		if rows.Scan(&key, &value) != nil || value == nil || *value == "" {
			continue
		}
		switch {
		case key == "default_company_id" && companyID == "":
			companyID = *value
		case key == "default_branch_id" && branchID == "":
			branchID = *value
		}
	}
	return companyID, branchID, nil
}
