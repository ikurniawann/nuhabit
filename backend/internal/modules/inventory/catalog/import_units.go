package catalog

import (
	"net/http"
	"slices"
	"strings"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	ps "nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/xlsx"
)

// POST /api/purchasing/import/units: CSV only, codes already used in the
// caller's company are skipped. A unit row holds kode, nama, tipe and
// deskripsi; conversion factors live per raw material
// (raw_materials.konversi_factor and raw_material_unit_conversions), so
// faktor_konversi and satuan_induk columns in the file are ignored.

var unitTypes = []string{"BESAR", "KECIL", "KONVERSI"}

// unitPayload is buildUnitPayload: tipe is case-insensitive and only
// status "active" is active. It returns the problem when tipe is invalid.
func unitPayload(data map[string]string, companyID *string) (*kit.Row, string) {
	tipe := strings.ToUpper(jsTrim(data["tipe"]))
	if !slices.Contains(unitTypes, tipe) {
		return nil, "Tipe satuan harus BESAR, KECIL atau KONVERSI"
	}
	return kit.Obj(
		"kode", jsTrim(data["kode"]),
		"nama", jsTrim(data["nama"]),
		"tipe", tipe,
		"deskripsi", emptyToNull(data["deskripsi"]),
		"is_active", strings.ToLower(data["status"]) == "active",
		"company_id", companyID,
	), ""
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
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
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
	companyID := ps.EffectiveCompanyID(scope)
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
		payload, problem := unitPayload(row.Data, companyID)
		if problem != "" {
			sum.skip(row.RowNumber, problem)
			continue
		}
		kode := payload.Str("kode")
		if taken, err := h.unitExists(ctx, kode, companyID, ""); err != nil {
			return err
		} else if taken {
			sum.skip(row.RowNumber, "Kode satuan "+kode+" sudah ada")
			continue
		}
		failed, err := h.importRow(ctx, func(q database.Querier) error {
			if _, err := kit.Insert(ctx, q, "units", []*kit.Row{payload}, "", false); err != nil {
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
