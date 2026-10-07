package stock

import (
	"context"

	contracts "nuhabit/backend/internal/contracts/inventory"

	"nuhabit/backend/internal/platform/database"
)

// VarianceLine is one material's quantity difference at a unit cost
// (StockVarianceLine in frontend/src/lib/inventory/accounting-posting.ts).
type VarianceLine = contracts.VarianceLine

// OpnameJournal is postStockOpnameAccounting's input.
type OpnameJournal struct {
	CompanyID    *string
	UserID       string
	OpnameID     string
	OpnameNumber string
	OpnameDate   string // YYYY-MM-DD
	Lines        []VarianceLine
}

// AdjustmentJournal is postStockAdjustmentAccounting's input.
type AdjustmentJournal struct {
	CompanyID     *string
	UserID        string
	DocumentID    string
	EntryDate     string
	RawMaterialID string
	QtyDiff       float64
	UnitCost      float64
	Notes         *string
}

// TransferJournal is postStockTransferAccounting's input.
type TransferJournal struct {
	CompanyID           *string
	UserID              string
	TransferID          string
	TransferNumber      string
	EntryDate           string
	RawMaterialID       string
	Qty                 float64
	UnitCost            float64
	SourceWarehouseName string
	DestWarehouseName   string
}

// Journals posts inventory journals in the accounting context. The TS
// routes post after the stock commit and show the outcome ("jurnal
// posted", "jurnal draft: …", or the AccountingPostError message) as
// accounting_note; a nil note means nothing to show. Implementations turn
// posting failures into the note and return an error only for failures the
// TS route would answer with a 500.
type Journals interface {
	PostStockOpname(ctx context.Context, q database.Querier, in OpnameJournal) (*string, error)
	PostStockAdjustment(ctx context.Context, q database.Querier, in AdjustmentJournal) (*string, error)
	PostStockTransfer(ctx context.Context, q database.Querier, in TransferJournal) (*string, error)
}

// companyOfBranch is `SELECT company_id FROM configuration.branches`.
func companyOfBranch(ctx context.Context, q database.Querier, branchID *string) (*string, error) {
	if branchID == nil || *branchID == "" {
		return nil, nil
	}
	var company *string
	err := q.QueryRow(ctx, `SELECT company_id::text FROM configuration.branches WHERE id = $1`, *branchID).Scan(&company)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return company, err
}
