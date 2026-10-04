package posops

import (
	"net/http"

	"nuhabit/backend/internal/platform/module"
)

// The TS rethrows QueryBuilder errors (plain objects), so failures answer
// the fixed message.
func (h *Handler) stockRoutes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/pos/stock-alerts", Handler: caught(fixed("Failed to fetch stock alerts"), h.stockAlerts)},
	}
}

func (h *Handler) stockAlerts(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	data, err := h.svc.StockAlerts(r.Context())
	if err != nil {
		return err
	}
	return okData(w, data)
}
