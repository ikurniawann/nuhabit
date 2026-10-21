package promo

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/iam"
)

// GymPackage is a gym credit package as the campaign form lists it, so a
// campaign can be limited to some packages without reaching the gym menu.
type GymPackage struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Status string `json:"status"`
}

// GymPackages reads the gym packages (owned by gym credits); nil lists none.
type GymPackages interface {
	List(ctx context.Context, q database.Querier) ([]GymPackage, error)
}

// gymPackages serves GET /api/promo/gym-packages to anyone who may read
// the promo campaigns.
func (h *handler) gymPackages(w http.ResponseWriter, r *http.Request) error {
	if _, _, err := h.kit.Auth.RequireAnyGrant(r, iam.Grant{Action: "read", Prefixes: iam.Promo}); err != nil {
		return err
	}
	out := []GymPackage{}
	if h.svc.ports.GymPackages != nil {
		rows, err := h.svc.ports.GymPackages.List(r.Context(), h.svc.db)
		if err != nil {
			return err
		}
		out = append(out, rows...)
	}
	return kit.OK(w, http.StatusOK, out)
}
