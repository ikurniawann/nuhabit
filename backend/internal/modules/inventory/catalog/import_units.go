package catalog

import (
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/xlsx"
)

// Port of POST /api/purchasing/import/units (route.ts inline logic): CSV
// only, existing codes are skipped.

var floatPrefix = regexp.MustCompile(`^[+-]?(Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)`)

// parseFloat is JavaScript's parseFloat: the longest numeric prefix after
// leading whitespace, NaN when there is none.
func parseFloat(s string) float64 {
	m := floatPrefix.FindString(strings.TrimLeftFunc(s, func(r rune) bool { return jsTrim(string(r)) == "" }))
	switch strings.TrimLeft(m, "+-") {
	case "":
		return math.NaN()
	case "Infinity":
		if strings.HasPrefix(m, "-") {
			return math.Inf(-1)
		}
		return math.Inf(1)
	}
	f, _ := strconv.ParseFloat(m, 64)
	return f
}

// unitPayload is buildUnitPayload: only status "active" is active. The
// TS writes faktor_konversi and satuan_induk, which item.units does not
// have, so every insert fails with PostgreSQL's message; the port keeps
// that until the route itself is fixed.
func unitPayload(data map[string]string) *kit.Row {
	faktor := parseFloat(data["faktor_konversi"])
	if math.IsNaN(faktor) || faktor == 0 {
		faktor = 1
	}
	orNil := func(key string) *string { return kit.OrNil(kit.Ptr(data[key])) }
	return kit.Obj(
		"kode", data["kode"],
		"nama", data["nama"],
		"tipe", orNil("tipe"),
		"faktor_konversi", faktor,
		"satuan_induk", orNil("satuan_induk"),
		"deskripsi", orNil("deskripsi"),
		"is_active", strings.ToLower(data["status"]) == "active",
	)
}

// unitImportSummary is the units route's own summary (no `updated`).
type unitImportSummary struct {
	Success  bool          `json:"success"`
	Imported int           `json:"imported"`
	Skipped  int           `json:"skipped"`
	Errors   []importIssue `json:"errors"`
}

/* POST /api/purchasing/import/units: form-data `file` (CSV) */
func (h *handler) importUnits(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.itemsStaff(r); err != nil {
		return err
	}
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if err != nil {
		return err
	}
	file := form.File("file")
	if file == nil {
		return httpx.BadRequest("File tidak ditemukan")
	}
	// file.text() decodes UTF-8 and drops a byte order mark.
	matrix := xlsx.ParseCSVMatrix(strings.TrimPrefix(strings.ToValidUTF8(string(file.Data), "\uFFFD"), "\uFEFF"))
	if len(matrix) < 2 {
		return httpx.BadRequest("File CSV harus memiliki header dan minimal 1 data")
	}
	ctx := r.Context()
	sum := newImportSummary()
	for _, row := range xlsx.MatrixToRows(matrix, xlsx.HeaderNormalizer(nil)) {
		var missing []string
		for _, field := range []string{"kode", "nama"} {
			if jsTrim(row.Data[field]) == "" {
				missing = append(missing, field)
			}
		}
		if len(missing) > 0 {
			sum.skip(row.RowNumber, "Field wajib kosong: "+strings.Join(missing, ", "))
			continue
		}
		existing, err := kit.QueryOne(ctx, h.env.DB, `SELECT id FROM units WHERE kode = $1 LIMIT 1`, row.Data["kode"])
		if err != nil {
			return err
		}
		if existing != nil {
			sum.skip(row.RowNumber, "Kode satuan "+row.Data["kode"]+" sudah ada")
			continue
		}
		failed, err := h.importRow(ctx, func(q database.Querier) error {
			if _, err := kit.Insert(ctx, q, "units", []*kit.Row{unitPayload(row.Data)}, "", false); err != nil {
				return dbFailure(err)
			}
			return nil
		})
		switch {
		case err != nil:
			return err
		case failed != "":
			sum.skip(row.RowNumber, failed)
		default:
			sum.Imported++
		}
	}
	return httpx.JSON(w, http.StatusOK, unitImportSummary{Success: true, Imported: sum.Imported, Skipped: sum.Skipped, Errors: sum.Errors})
}
