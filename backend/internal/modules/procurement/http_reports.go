package procurement

import (
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Port of frontend/src/app/api/purchasing/reports/{po-summary,po-detail,
// supplier-performance,production-in-house}. stock-card and
// inventory-valuation follow the sidebar's active stall (getUser), which
// the Go platform does not resolve yet; they stay in TS.
func (h *Handler) reportRoutes(add addRoute) {
	add("GET /api/purchasing/reports/po-summary", h.poSummaryReport)
	add("GET /api/purchasing/reports/po-detail", h.poDetailReport)
	add("GET /api/purchasing/reports/supplier-performance", h.supplierPerformanceReport)
	add("GET /api/purchasing/reports/production-in-house", h.productionInHouseReport)
}

func (h *Handler) productionInHouseReport(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	f := queryForm(r)
	p := ReportParams{Export: "json", DateField: "completed_at", OutputType: "all"}
	p.DateFrom = f.Str("date_from", optional, validate.StrOpts{})
	p.DateTo = f.Str("date_to", optional, validate.StrOpts{})
	if v := enumField(f, "date_field", validate.Rule{HasDefault: true}, []string{"completed_at", "created_at"}); v != nil {
		p.DateField = *v
	}
	p.Status = f.Str("status", optional, validate.StrOpts{})
	if v := enumField(f, "output_type", validate.Rule{HasDefault: true}, []string{"all", "FINISHED_GOOD", "WIP"}); v != nil {
		p.OutputType = *v
	}
	p.ProductID = f.UUID("product_id", optional)
	p.WarehouseID = f.UUID("warehouse_id", optional)
	if v := enumField(f, "export", validate.Rule{HasDefault: true}, []string{"json", "csv"}); v != nil {
		p.Export = *v
	}
	if err := f.Err("Invalid query params"); err != nil {
		return err
	}
	report, rows, err := h.svc.ProductionInHouse(r.Context(), p)
	if err != nil {
		return err
	}
	// A warehouse without active products answers JSON even for export=csv.
	if rows != nil {
		return h.csvResponse(w, quotedCSV(productionCSVHeader, rows), "production-in-house")
	}
	return writeOK(w, http.StatusOK, report)
}

// reportQuery is parseReportQuery: 400 "Invalid query params" with issues.
func reportQuery(r *http.Request, partyKey string) (ReportParams, error) {
	f := queryForm(r)
	p := ReportParams{Export: "json"}
	p.DateFrom = f.Str("date_from", optional, validate.StrOpts{})
	p.DateTo = f.Str("date_to", optional, validate.StrOpts{})
	party := f.UUID(partyKey, optional)
	if partyKey == "vendor_id" {
		p.VendorID = party
		p.Status = f.Str("status", optional, validate.StrOpts{})
	} else {
		p.SupplierID = party
	}
	if v := enumField(f, "export", validate.Rule{HasDefault: true}, []string{"json", "csv"}); v != nil {
		p.Export = *v
	}
	return p, f.Err("Invalid query params")
}

// csvResponse is csvResponse: <prefix>-YYYY-MM-DD.csv (UTC date).
func (h *Handler) csvResponse(w http.ResponseWriter, content, prefix string) error {
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", `attachment; filename="`+prefix+"-"+h.svc.now().UTC().Format("2006-01-02")+`.csv"`)
	w.WriteHeader(http.StatusOK)
	_, err := w.Write([]byte(content))
	return err
}

func (h *Handler) poSummaryReport(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	p, err := reportQuery(r, "vendor_id")
	if err != nil {
		return err
	}
	report, csv, err := h.svc.PoSummaryReport(r.Context(), p)
	if err != nil {
		return err
	}
	if p.Export == "csv" {
		return h.csvResponse(w, csv, "po-summary")
	}
	return writeOK(w, http.StatusOK, report)
}

func (h *Handler) poDetailReport(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	p, err := reportQuery(r, "vendor_id")
	if err != nil {
		return err
	}
	report, rows, err := h.svc.PoDetailReport(r.Context(), p)
	if err != nil {
		return err
	}
	// Without POs the TS answers JSON even for export=csv.
	if p.Export == "csv" && rows != nil {
		return h.csvResponse(w, quotedCSV(poDetailCSVHeader, rows), "po-detail")
	}
	return writeOK(w, http.StatusOK, report)
}

func (h *Handler) supplierPerformanceReport(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	p, err := reportQuery(r, "supplier_id")
	if err != nil {
		return err
	}
	ranked, err := h.svc.SupplierPerformance(r.Context(), p)
	if err != nil {
		return err
	}
	if ranked == nil {
		var period = periodOf(p)
		return httpx.JSON(w, http.StatusOK, okData{Success: true, Data: obj(
			"summary", obj("total_suppliers", 0, "period", period, "top_supplier", nil, "total_spend_all_suppliers", 0),
			"vendors", []*Row{}, "suppliers", []*Row{})})
	}
	if p.Export == "csv" {
		return h.csvResponse(w, supplierPerformanceCSV(ranked), "supplier-performance")
	}
	return writeOK(w, http.StatusOK, supplierPerformanceSummary(ranked, p))
}
