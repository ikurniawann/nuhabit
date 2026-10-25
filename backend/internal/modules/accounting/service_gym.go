package accounting

import (
	"context"
	"strings"

	"nuhabit/backend/internal/contracts/gym"
	"nuhabit/backend/internal/contracts/gymcredits"
	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
)

// PostGymCredits posts a gym package journal (sale, refund, credit usage,
// breakage, pass revenue) from its GYM_* mapping, keyed by the document.
func (s *Service) PostGymCredits(ctx context.Context, db database.DB, in gymcredits.Journal) (domain.PostResult, error) {
	amount := domain.Round2(in.Amount)
	switch {
	case !strings.HasPrefix(in.EventCode, "GYM_"):
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Event jurnal gym tidak dikenal: " + in.EventCode}, nil
	case !(amount > 0):
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Nilai jurnal gym 0"}, nil
	}
	return PostFromMapping(ctx, db, MappingPost{CompanyID: in.CompanyID, UserID: in.UserID, EventCode: in.EventCode,
		DocumentType: in.DocumentType, DocumentID: in.DocumentID, EntryDate: in.EntryDate, Amounts: domain.Amounts{"TOTAL": amount},
		SourceModule: "POS", Description: in.Description})
}

// PostGymCommission posts a coach commission journal (accrual, hand-over to
// payroll, direct payment) from its GYM_COMMISSION_* mapping, keyed by the
// document.
func (s *Service) PostGymCommission(ctx context.Context, db database.DB, in gym.CommissionJournal) (domain.PostResult, error) {
	amount := domain.Round2(in.Amount)
	switch {
	case !strings.HasPrefix(in.EventCode, "GYM_COMMISSION_"):
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Event jurnal komisi tidak dikenal: " + in.EventCode}, nil
	case !(amount > 0):
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Nilai jurnal komisi 0"}, nil
	}
	return PostFromMapping(ctx, db, MappingPost{CompanyID: in.CompanyID, UserID: in.UserID, EventCode: in.EventCode,
		DocumentType: in.DocumentType, DocumentID: in.DocumentID, EntryDate: in.EntryDate, Amounts: domain.Amounts{"TOTAL": amount},
		SourceModule: "PAYROLL", Description: in.Description})
}
