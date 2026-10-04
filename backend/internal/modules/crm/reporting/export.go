package reporting

import (
	"net/http"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/reporting/domain"
)

// exportReport is GET /api/crm/report-builder/{id}/export: the saved report
// run now, as an xlsx with a Data and an Info sheet.
func (h *handler) exportReport(w http.ResponseWriter, r *http.Request) error {
	u, s, err := h.guard.RequireScope(r, kit.GateReports)
	if err != nil {
		return err
	}
	report, err := h.requireAccessibleReport(r.Context(), r.PathValue("id"), u, s)
	if err != nil {
		return err
	}
	def, err := storedDefinition(report)
	if err != nil {
		return err
	}
	result, err := h.runDefinition(r.Context(), h.db, def, u, s)
	if err != nil {
		return err
	}
	rows := make([]domain.Row, len(result.Rows))
	for i, row := range result.Rows {
		rows[i] = plainRow(row)
	}
	now := h.now()
	sheets := domain.ReportSheets(domain.ExportReport{
		Name: report.Str("name"), Description: report.StrPtr("description"),
		Columns: result.Columns, Rows: rows, Grouped: result.Grouped, Truncated: result.Truncated,
	}, def, now, h.loc)
	return kit.XlsxResponse(w, domain.ReportFileName(report.Str("name"), now), sheets...)
}
