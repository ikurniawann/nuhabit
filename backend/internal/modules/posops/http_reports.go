package posops

import (
	"net/http"
	"regexp"

	"nuhabit/backend/internal/platform/module"
)

// Report routes (app/api/pos/reports). The xlsx exports and the
// ?format=xlsx variants live in http_reports_xlsx.go.
func (h *Handler) reportRoutes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/pos/reports/rush-hour", Handler: rendered(h.rushHourReport, rushHourStatus("Gagal memuat laporan rush hour"))},
		{Pattern: "GET /api/pos/reports/rush-hour/export", Handler: rendered(h.rushHourExport, rushHourStatus("Gagal export rush hour"))},
		{Pattern: "GET /api/pos/reports/product-sales", Handler: caught(pgMessage, h.productSalesReport)},
		{Pattern: "GET /api/pos/reports/transactions", Handler: caught(pgMessage, h.transactionReport)},
		{Pattern: "GET /api/pos/reports/export", Handler: caught(func(error) string { return "Gagal membuat file Excel" }, h.exportReport)},
		{Pattern: "GET /api/pos/reports/voids", Handler: caught(pgMessage, h.voidReport)},
		{Pattern: "GET /api/pos/reports/payment-methods", Handler: caught(pgMessage, h.paymentMethodReport)},
		{Pattern: "GET /api/pos/reports/profit", Handler: caught(fixed("Gagal memuat laporan profit POS"), h.profitReport)},
		{Pattern: "GET /api/pos/reports/revenue-composition", Handler: caught(fixed("Gagal memuat laporan komposisi pendapatan"), h.revenueCompositionReport)},
		{Pattern: "GET /api/pos/reports/closing", Handler: caught(fixed("Failed to load cashier closing report"), h.closingReport)},
	}
}

var knownRushHourError = regexp.MustCompile(`(?i)tanggal|stall`)

// rushHourStatus answers a range or stall error with 400 and its message,
// anything else with 500 and fallback.
func rushHourStatus(fallback string) func(error) (int, string) {
	return func(err error) (int, string) {
		if msg := pgMessage(err); knownRushHourError.MatchString(msg) {
			return http.StatusBadRequest, msg
		}
		return http.StatusInternalServerError, fallback
	}
}

func (h *Handler) rushHourReport(w http.ResponseWriter, r *http.Request) error {
	user, err := h.requirePos(r, "Authentication required")
	if err != nil {
		return err
	}
	q := r.URL.Query()
	data, err := h.svc.RushHourReport(r.Context(), user.ID, q.Get("date_from"), q.Get("date_to"), q.Get("warehouse_id"))
	if err != nil {
		return err
	}
	return okData(w, data)
}

func (h *Handler) voidReport(w http.ResponseWriter, r *http.Request) error {
	user, err := h.requirePos(r, "Authentication required")
	if err != nil {
		return err
	}
	q := r.URL.Query()
	data, err := h.svc.VoidReport(r.Context(), user.ID, q.Get("date_from"), q.Get("date_to"), q.Get("warehouse_id"))
	if err != nil {
		return err
	}
	return okData(w, data)
}

func (h *Handler) paymentMethodReport(w http.ResponseWriter, r *http.Request) error {
	user, err := h.requirePos(r, "Authentication required")
	if err != nil {
		return err
	}
	q := r.URL.Query()
	data, err := h.svc.PaymentMethodReport(r.Context(), user.ID, q.Get("date_from"), q.Get("date_to"),
		q.Get("warehouse_id"), q.Get("granularity"))
	if err != nil {
		return err
	}
	return okData(w, data)
}

func (h *Handler) profitReport(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	data, err := h.svc.ProfitReport(r.Context(), r.URL.Query().Get("date_from"), r.URL.Query().Get("date_to"))
	if err != nil {
		return err
	}
	return okData(w, data)
}

func (h *Handler) revenueCompositionReport(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	data, err := h.svc.RevenueCompositionReport(r.Context(), r.URL.Query().Get("date_from"), r.URL.Query().Get("date_to"))
	if err != nil {
		return err
	}
	return okData(w, data)
}

func (h *Handler) closingReport(w http.ResponseWriter, r *http.Request) error {
	user, err := h.requirePos(r, "Authentication required")
	if err != nil {
		return err
	}
	printedBy := user.FullName
	if printedBy == "" {
		printedBy = user.ID
	}
	data, err := h.svc.ClosingReport(r.Context(), r.URL.Query().Get("date"), queryParam(r, "shift_id"), printedBy)
	if err != nil {
		return err
	}
	return okData(w, data)
}
