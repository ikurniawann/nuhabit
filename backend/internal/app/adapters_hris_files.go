package app

import (
	"context"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/modules/hris"
	"nuhabit/backend/internal/platform/database"
)

// hrisCompany is the company identity on HR documents: the app settings
// (getSettings) and the oldest company's name (loadCompanyName).
type hrisCompany struct{ kit.AppSettings }

var _ hris.CompanyProfile = hrisCompany{}

func (hrisCompany) FirstCompanyName(ctx context.Context, q database.Querier) (*string, error) {
	var name *string
	err := q.QueryRow(ctx, `SELECT name FROM configuration.companies ORDER BY created_at LIMIT 1`).Scan(&name)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return name, err
}
