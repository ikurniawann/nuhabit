package app

import (
	"context"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/storedvalue/promo"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// promoGymPackages lists gym packages for the promo campaign form through
// the gym-credits service. The service is built without the voucher port:
// the voucher adapter is built from the promo service, which this adapter
// feeds, so wiring it here would loop.
type promoGymPackages struct{ svc *gymcredits.Service }

var _ promo.GymPackages = promoGymPackages{}

func newPromoGymPackages(d module.Deps) promoGymPackages {
	return promoGymPackages{svc: gymcredits.NewDefaultService(d, d.DB)}
}

func (p promoGymPackages) List(ctx context.Context, q database.Querier) ([]promo.GymPackage, error) {
	rows, err := p.svc.PackageOptions(ctx, q)
	if err != nil {
		return nil, err
	}
	out := make([]promo.GymPackage, 0, len(rows))
	for _, r := range rows {
		out = append(out, promo.GymPackage{ID: r.ID, Name: r.Name, Kind: r.Kind, Status: r.Status})
	}
	return out, nil
}
