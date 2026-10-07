package posops

import (
	"net/http"

	"nuhabit/backend/internal/platform/module"
)

// Customer routes (app/api/pos/customers). Failures answer a fixed text.
func (h *Handler) customerRoutes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/pos/customers", Handler: caught(always("Gagal memuat data customer"), h.listCustomers)},
		{Pattern: "POST /api/pos/customers", Handler: caught(always("Gagal menyimpan customer"), h.saveCustomer)},
	}
}

// always ignores the error, JS errors included.
func always(msg string) func(error) string { return func(error) string { return msg } }

func (h *Handler) listCustomers(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	f := customerFilter{Search: queryParam(r, "search"), Phone: queryParam(r, "phone"), Tier: queryParam(r, "tier")}
	f.NfcUID = normalizeNfcUID(r.URL.Query().Get("nfc_uid"))
	rows, err := h.svc.ListCustomers(r.Context(), f)
	if err != nil {
		return err
	}
	return okData(w, rows)
}

func (h *Handler) saveCustomer(w http.ResponseWriter, r *http.Request) error {
	user, err := h.requirePos(r, "Authentication required")
	if err != nil {
		return err
	}
	body, err := destructured(r, "phone")
	if err != nil {
		return err
	}
	saved, err := h.svc.SaveCustomer(r.Context(), user.ID, body)
	if err != nil {
		return err
	}
	status, msg := http.StatusOK, "Customer updated"
	if saved.Created {
		status, msg = http.StatusCreated, "Customer created"
	}
	return writeObj(w, status, NewObj("success", true, "data", saved.Customer, "message", msg))
}
