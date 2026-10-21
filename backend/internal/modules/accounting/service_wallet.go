package accounting

import (
	"context"

	"nuhabit/backend/internal/contracts/storedvalue"
	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
)

// PostWalletBonus posts ARK Coin given away (WALLET_REFERRAL_BONUS: debit
// the promotion expense, credit the ARK Coin liability) from its mapping,
// keyed by the wallet row. Without a company it is skipped, like a gym
// sale without one.
func (s *Service) PostWalletBonus(ctx context.Context, db database.DB, in storedvalue.WalletBonus) (domain.PostResult, error) {
	amount := domain.Round2(in.Amount)
	switch {
	case in.EventCode != "WALLET_REFERRAL_BONUS":
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Event bonus dompet tidak dikenal: " + in.EventCode}, nil
	case !(amount > 0):
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Nilai bonus dompet 0"}, nil
	case in.CompanyID == nil:
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Bonus dompet tanpa perusahaan: isi perusahaan default di aturan gym"}, nil
	}
	return PostFromMapping(ctx, db, MappingPost{CompanyID: in.CompanyID, EventCode: in.EventCode,
		DocumentType: "wallet_transaction", DocumentID: in.BonusID, EntryDate: in.EntryDate, Amounts: domain.Amounts{"TOTAL": amount},
		SourceModule: "POS", Description: in.Description})
}
