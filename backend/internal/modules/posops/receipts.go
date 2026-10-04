package posops

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// ReceiptStore is pos.pos_receipt_settings with the SQL of
// lib/pos/receipt-settings.ts and lib/settings/receipt-scope.ts, for the
// configuration context's settings screen. Every method runs on the
// caller's Querier.
type ReceiptStore struct{}

// ReceiptRow is an active row as stored, with the JSON line columns decoded.
type ReceiptRow struct {
	ID, BranchID, WarehouseID *string
	HeaderLines, FooterLines  any
	ShowStallName             bool
}

// ReceiptInput is the scope and lines a save writes.
type ReceiptInput struct {
	WarehouseID, BranchID    *string
	HeaderLines, FooterLines []string
	ShowStallName            bool
}

// ActiveRows lists the active rows; none when the table does not exist yet.
func (ReceiptStore) ActiveRows(ctx context.Context, q database.Querier) ([]ReceiptRow, error) {
	rows, err := q.Query(ctx, `SELECT id::text, branch_id::text, warehouse_id::text, header_lines::text,
		footer_lines::text, show_stall_name FROM pos.pos_receipt_settings WHERE is_active = true`)
	if err != nil {
		if database.IsUndefinedTable(err) {
			return []ReceiptRow{}, nil
		}
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ReceiptRow, error) {
		var r ReceiptRow
		var header, footer string
		if err := row.Scan(&r.ID, &r.BranchID, &r.WarehouseID, &header, &footer, &r.ShowStallName); err != nil {
			return r, err
		}
		_ = json.Unmarshal([]byte(header), &r.HeaderLines)
		_ = json.Unmarshal([]byte(footer), &r.FooterLines)
		return r, nil
	})
}

func receiptLines(in ReceiptInput) (string, string) {
	header, _ := json.Marshal(in.HeaderLines)
	footer, _ := json.Marshal(in.FooterLines)
	return string(header), string(footer)
}

// Update rewrites the lines and the stall-name flag of row id.
func (ReceiptStore) Update(ctx context.Context, q database.Querier, id string, in ReceiptInput, at time.Time) error {
	header, footer := receiptLines(in)
	_, err := q.Exec(ctx, `UPDATE pos.pos_receipt_settings
		SET header_lines = $1::jsonb, footer_lines = $2::jsonb, show_stall_name = $3, updated_at = $4
		WHERE id = $5`, header, footer, in.ShowStallName, at, id)
	return err
}

// Insert adds an active row for the scope; a nil id takes a fresh uuid.
func (ReceiptStore) Insert(ctx context.Context, q database.Querier, id *string, in ReceiptInput, at time.Time) error {
	header, footer := receiptLines(in)
	_, err := q.Exec(ctx, `INSERT INTO pos.pos_receipt_settings
		(id, branch_id, warehouse_id, is_active, header_lines, footer_lines, show_stall_name, updated_at)
		VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3, true, $4::jsonb, $5::jsonb, $6, $7)`,
		id, in.BranchID, in.WarehouseID, header, footer, in.ShowStallName, at)
	return err
}
