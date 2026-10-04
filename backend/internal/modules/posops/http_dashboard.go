package posops

import (
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

func (h *Handler) dashboardRoutes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/pos/dashboard", Handler: apiRoute(h.dashboard)},
	}
}

// dashboard is GET /api/pos/dashboard?period=today|week|month|custom
// [&date_from&date_to]: POS statistics in WIB.
func (h *Handler) dashboard(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	q := r.URL.Query()
	period, rng, ok := DashboardRangeFor(q.Get("period"), q.Get("date_from"), q.Get("date_to"), h.svc.now())
	if !ok {
		return httpx.BadRequest("Rentang tanggal tidak valid (maks 366 hari, format YYYY-MM-DD)")
	}
	return okData(w, h.svc.LoadDashboard(r.Context(), period, rng))
}
