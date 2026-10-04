package app

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/configuration/settings"
	"nuhabit/backend/internal/modules/configuration/settings/domain"
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

// settingsReceipts is pos.pos_receipt_settings (pos-ops' table) with the
// SQL of lib/pos/receipt-settings.ts and lib/settings/receipt-scope.ts.
// pos-ops exposes no service that runs on the caller's querier, so the
// adapter holds the SQL.
type settingsReceipts struct{}

func (settingsReceipts) ActiveRows(ctx context.Context, q database.Querier) ([]domain.ReceiptRow, error) {
	rows, err := q.Query(ctx, `SELECT id::text, branch_id::text, warehouse_id::text, header_lines::text,
		footer_lines::text, show_stall_name FROM pos.pos_receipt_settings WHERE is_active = true`)
	if err != nil {
		if database.IsUndefinedTable(err) {
			return []domain.ReceiptRow{}, nil
		}
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.ReceiptRow, error) {
		var r domain.ReceiptRow
		var header, footer string
		if err := row.Scan(&r.ID, &r.BranchID, &r.WarehouseID, &header, &footer, &r.ShowStallName); err != nil {
			return r, err
		}
		_ = json.Unmarshal([]byte(header), &r.HeaderLines)
		_ = json.Unmarshal([]byte(footer), &r.FooterLines)
		return r, nil
	})
}

func receiptLines(in domain.ReceiptScope) (string, string) {
	header, _ := json.Marshal(in.HeaderLines)
	footer, _ := json.Marshal(in.FooterLines)
	return string(header), string(footer)
}

func (settingsReceipts) Update(ctx context.Context, q database.Querier, id string, in domain.ReceiptScope, at time.Time) error {
	header, footer := receiptLines(in)
	_, err := q.Exec(ctx, `UPDATE pos.pos_receipt_settings
		SET header_lines = $1::jsonb, footer_lines = $2::jsonb, show_stall_name = $3, updated_at = $4
		WHERE id = $5`, header, footer, in.ShowStallName, at, id)
	return err
}

func (settingsReceipts) Insert(ctx context.Context, q database.Querier, id *string, in domain.ReceiptScope, at time.Time) error {
	header, footer := receiptLines(in)
	_, err := q.Exec(ctx, `INSERT INTO pos.pos_receipt_settings
		(id, branch_id, warehouse_id, is_active, header_lines, footer_lines, show_stall_name, updated_at)
		VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3, true, $4::jsonb, $5::jsonb, $6, $7)`,
		id, in.BranchID, in.WarehouseID, header, footer, in.ShowStallName, at)
	return err
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
