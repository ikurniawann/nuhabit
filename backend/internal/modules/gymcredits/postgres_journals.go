package gymcredits

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/localtime"
)

// Books of lots and companies for the gym journals.

func (Postgres) SetLotBooks(ctx context.Context, q database.Querier, lotID string, valueSen int64, companyID *string) error {
	_, err := q.Exec(ctx, `UPDATE gym.credit_lots SET value_sen = $2, company_id = $3 WHERE id = $1`, lotID, valueSen, companyID)
	return err
}

func (Postgres) CompanyFor(ctx context.Context, q database.Querier, branchID *string) (*string, *time.Location, error) {
	var company *string
	zone := localtime.Default
	err := q.QueryRow(ctx,
		`SELECT COALESCE((SELECT b.company_id FROM configuration.branches b WHERE b.id = $1::uuid),
		                 `+defaultCompany+`)::text,
		        COALESCE((SELECT b.timezone FROM configuration.branches b WHERE b.id = $1::uuid), 'Asia/Jakarta')`,
		branchID).Scan(&company, &zone)
	if database.IsNoRows(err) {
		err = nil
	}
	return company, localtime.Zone(zone), err
}

func (Postgres) Companies(ctx context.Context, q database.Querier) ([]Company, error) {
	rows, err := q.Query(ctx, `SELECT id::text, name FROM configuration.companies WHERE is_active ORDER BY name, id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Company])
}
