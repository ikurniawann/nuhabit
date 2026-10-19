package accounting

import (
	"context"

	"nuhabit/backend/internal/contracts/production"
	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
)

// Production journals: materials into WIP on an issue; conversion cost into
// WIP, output out of WIP into inventory, scrap out of WIP into COGS and
// abnormal scrap out of WIP into production loss on a receipt. Each journal is keyed by its document, so a redelivered event
// finds the entry it already wrote.

// PostProductionIssue posts PRODUCTION_MATERIAL_ISSUE.
func (s *Service) PostProductionIssue(ctx context.Context, db database.DB, in production.MaterialsIssued) (domain.PostResult, error) {
	amount := domain.Round2(in.Total)
	if !(amount > 0) {
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Nilai pengeluaran bahan 0"}, nil
	}
	return PostFromMapping(ctx, db, MappingPost{CompanyID: in.CompanyID, UserID: in.UserID, EventCode: "PRODUCTION_MATERIAL_ISSUE",
		DocumentType: "production_issue", DocumentID: in.IssueID, EntryDate: in.EntryDate, Amounts: domain.Amounts{"TOTAL": amount},
		SourceModule: "INVENTORY", Description: "Pengeluaran bahan " + in.IssueNumber + " ke produksi " + in.OrderNumber})
}

// PostProductionReceipt posts the conversion, output and scrap journals of
// a batch that carry an amount.
func (s *Service) PostProductionReceipt(ctx context.Context, db database.DB, in production.OutputReceived) ([]domain.PostResult, error) {
	var results []domain.PostResult
	for _, j := range []struct {
		event, label string
		amount       float64
	}{
		{"PRODUCTION_CONVERSION_COST", "Biaya konversi batch ", in.ConversionCost + in.AbnormalConversionCost},
		{"PRODUCTION_OUTPUT_RECEIPT", "Hasil produksi batch ", in.MaterialCost + in.ConversionCost},
		{"PRODUCTION_SCRAP", "Scrap produksi batch ", in.ScrapCost},
		{"PRODUCTION_ABNORMAL_SCRAP", "Scrap di atas toleransi batch ", in.AbnormalScrapCost},
	} {
		amount := domain.Round2(j.amount)
		if !(amount > 0) {
			continue
		}
		r, err := PostFromMapping(ctx, db, MappingPost{CompanyID: in.CompanyID, UserID: in.UserID, EventCode: j.event,
			DocumentType: "production_batch", DocumentID: in.BatchID, EntryDate: in.EntryDate, Amounts: domain.Amounts{"TOTAL": amount},
			SourceModule: "INVENTORY", Description: j.label + in.BatchNumber})
		if err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, nil
}
