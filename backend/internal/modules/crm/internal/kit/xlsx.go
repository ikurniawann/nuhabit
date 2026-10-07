package kit

import (
	"net/http"

	"nuhabit/backend/internal/platform/xlsx"
)

// XlsxResponse mirrors xlsxResponse in lib/reports/xlsx.ts: the workbook as
// a no-store attachment.
func XlsxResponse(w http.ResponseWriter, filename string, sheets ...xlsx.SheetSpec) error {
	file, err := xlsx.Build(sheets...)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", xlsx.ContentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "no-store")
	_, err = w.Write(file)
	return err
}
