package gymcredits

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// PackageOption is a package as another context lists it: the promo
// campaign form picks the packages a code applies to.
type PackageOption struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Status string `json:"status"`
}

// PackageOptions lists every package, active ones first, as the catalogue
// orders them.
func (s *Service) PackageOptions(ctx context.Context, q database.Querier) ([]PackageOption, error) {
	rows, err := s.repo.Packages(ctx, q)
	if err != nil {
		return nil, err
	}
	out := make([]PackageOption, 0, len(rows))
	for _, p := range rows {
		out = append(out, PackageOption{ID: p.ID, Name: p.Name, Kind: p.Kind, Status: p.Status})
	}
	return out, nil
}
