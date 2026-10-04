package domain

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/xlsx"
)

// ExportReport is what buildReportSheets reads of a saved report and its
// run.
type ExportReport struct {
	Name        string
	Description *string
	Columns     []Column
	Rows        []Row
	Grouped     bool
	Truncated   bool
}

// ReportSheets mirrors buildReportSheets in lib/crm/report-builder-server.ts:
// a Data sheet (header, then numbers as numbers and everything else as
// formatted text) and an Info sheet describing the definition.
func ReportSheets(rep ExportReport, def Definition, generatedAt time.Time, loc *time.Location) []xlsx.SheetSpec {
	header := make([]any, len(rep.Columns))
	for i, c := range rep.Columns {
		header[i] = c.Label
	}
	data := [][]any{header}
	for _, row := range rep.Rows {
		cells := make([]any, len(rep.Columns))
		for i, c := range rep.Columns {
			v := row[c.Key]
			switch {
			case v == nil:
				cells[i] = ""
			case c.Type == "number" || c.Type == "currency":
				// Number(v) || 0
				n := cellNumber(v)
				if math.IsNaN(n) {
					n = 0
				}
				cells[i] = n
			default:
				cells[i] = FormatCellValue(c.Type, v, loc)
			}
		}
		data = append(data, cells)
	}

	description := "—"
	if rep.Description != nil {
		description = *rep.Description
	}
	period := def.DatePreset
	if period == "custom" {
		period = PeriodLabel(def)
	}
	mode := "Tabel"
	if rep.Grouped {
		mode = "Agregasi"
	}
	info := [][]any{
		{"Report", rep.Name},
		{"Deskripsi", description},
		{"Dataset", DatasetDef(def.Dataset).Label},
		{"Periode", period},
		{"Mode", mode},
		{"Jumlah baris", len(rep.Rows)},
		{"Dibuat", formatWIB(generatedAt, true)},
	}
	if rep.Truncated {
		info = append(info, []any{"Catatan", fmt.Sprintf("Dipotong pada batas %d baris", def.Limit)})
	}
	return []xlsx.SheetSpec{{Name: "Data", Rows: data}, {Name: "Info", Rows: info}}
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// ReportFileName mirrors reportFileName: a slug of at most 40 characters
// (or "report") and the UTC date.
func ReportFileName(name string, generatedAt time.Time) string {
	slug := strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if len(slug) > 40 {
		slug = slug[:40]
	}
	if slug == "" {
		slug = "report"
	}
	return slug + "-" + generatedAt.UTC().Format("2006-01-02") + ".xlsx"
}
