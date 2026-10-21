package gymcredits

import (
	"context"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
)

// CanCover reports whether the member's live lots can pay for the credits
// their upcoming bookings (pending) will draw at check-in plus next: some
// assignment of lots to classes exists (see domain.CanCover). Booking calls
// it instead of subtracting reserved credits across class types.
func (s *Service) CanCover(ctx context.Context, q database.Querier, customerID string, pending []domain.Demand, next domain.Demand) (bool, error) {
	now := s.clock()
	state, _, err := s.expireLapsedLots(ctx, q, customerID, now)
	if err != nil {
		return false, err
	}
	coverage, err := s.repo.PackageCoverage(ctx, q)
	if err != nil {
		return false, err
	}
	demands := append(append([]domain.Demand(nil), pending...), next)
	return domain.CanCover(domain.LotRemainders(state.lots, state.entries), coverage, demands, now), nil
}
