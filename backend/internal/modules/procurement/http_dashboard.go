package procurement

import (
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/stall"
)

// Port of frontend/src/app/api/purchasing/dashboard: the body is
// PurchasingDashboardData itself, without an envelope. The stock panels
// follow the sidebar's active stall.
func (h *Handler) dashboardRoutes(add addRoute) {
	add("GET /api/purchasing/dashboard", h.dashboard)
}

func (h *Handler) dashboard(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	warehouseID, err := stall.Active(r.Context(), h.svc.db, r, user.ID)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	data, err := h.svc.PurchasingDashboard(r.Context(), q.Get("start_date"), q.Get("end_date"), warehouseID)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, data)
}
