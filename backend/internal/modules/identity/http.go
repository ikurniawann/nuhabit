package identity

import (
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

type handlers struct{ svc *Service }

func (h handlers) me(w http.ResponseWriter, r *http.Request) error {
	me, err := h.svc.Me(r)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, me)
}

// Routes lists the module's routes.
func (h handlers) Routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/auth/me", Handler: httpx.Handle(h.me)},
	}
}
