package app

import (
	"context"

	"nuhabit/backend/internal/modules/accounting"
	"nuhabit/backend/internal/platform/database"
)

// The faktur pajak attachment column of crm.crm_sales_invoices
// (app/api/finance/invoices/[id]/faktur-pajak/route.ts).

func (accountingSales) FakturPajakInvoice(ctx context.Context, q database.Querier, id string) (*accounting.FakturPajakInvoice, error) {
	var inv accounting.FakturPajakInvoice
	err := q.QueryRow(ctx, `
SELECT id::text, deal_id::text, invoice_number, faktur_pajak_url
  FROM crm.crm_sales_invoices WHERE id = $1 AND deleted_at IS NULL`, id).
		Scan(&inv.ID, &inv.DealID, &inv.InvoiceNumber, &inv.FakturPajakURL)
	if noRow(err) {
		return nil, nil
	}
	return &inv, err
}

func (accountingSales) SetFakturPajak(ctx context.Context, q database.Querier, id string, path *string) error {
	_, err := q.Exec(ctx, `UPDATE crm.crm_sales_invoices SET faktur_pajak_url = $2, updated_at = now() WHERE id = $1`, id, path)
	return err
}
