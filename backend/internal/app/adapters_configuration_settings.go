package app

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/configuration/settings"
	"nuhabit/backend/internal/modules/configuration/settings/domain"
	"nuhabit/backend/internal/modules/posops"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

func configurationSettingsPorts(d module.Deps) settings.Ports {
	return settings.Ports{
		Receipts: settingsReceipts{},
		Staff:    settingsStaff{},
		WhatsApp: whatsapp.New(d.Log),
	}
}

// settingsReceipts adapts pos-ops' receipt settings store.
type settingsReceipts struct{ pos posops.ReceiptStore }

func (r settingsReceipts) ActiveRows(ctx context.Context, q database.Querier) ([]domain.ReceiptRow, error) {
	rows, err := r.pos.ActiveRows(ctx, q)
	if err != nil {
		return nil, err
	}
	out := make([]domain.ReceiptRow, len(rows))
	for i, row := range rows {
		out[i] = domain.ReceiptRow(row)
	}
	return out, nil
}

func (r settingsReceipts) Update(ctx context.Context, q database.Querier, id string, in domain.ReceiptScope, at time.Time) error {
	return r.pos.Update(ctx, q, id, posops.ReceiptInput(in), at)
}

func (r settingsReceipts) Insert(ctx context.Context, q database.Querier, id *string, in domain.ReceiptScope, at time.Time) error {
	return r.pos.Insert(ctx, q, id, posops.ReceiptInput(in), at)
}

// settingsStaff reads hris.employees (HRIS-PEOPLE's table) with
// loadWaRecipients' query from lib/notifications/order-alert-server.ts.
type settingsStaff struct{}

func (settingsStaff) WaRecipients(ctx context.Context, q database.Querier, roles []string) ([]settings.WaRecipient, error) {
	rows, err := q.Query(ctx, `SELECT DISTINCT ON (e.id) e.full_name AS name, e.phone, COALESCE(r.code, u.role)::text AS role
     FROM hris.employees e
     JOIN configuration.users u ON u.id = e.user_id
     LEFT JOIN iam.user_roles ur ON ur.user_id = u.id
     LEFT JOIN iam.roles r ON r.id = ur.role_id
     WHERE COALESCE(e.is_active, true) = true
       AND COALESCE(u.status, 'active') = 'active'
       AND (r.code = ANY($1::text[]) OR u.role = ANY($1::text[]))
     ORDER BY e.id, e.full_name`, roles)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[settings.WaRecipient])
}
