package catalog

import (
	"context"
	"errors"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/xlsx"
)

// Shared parts of the item master spreadsheet import and export
// (/api/purchasing/import/*, /api/purchasing/export/*): port of
// lib/purchasing/import-spreadsheet.ts, import-lookups.ts and
// export-scope.ts.

// readUploadedSheet is readUploadedSheet: the `file` part (CSV or XLSX) as
// rows keyed by normalized header. A body that is not multipart fails like
// the unguarded request.formData().
func readUploadedSheet(r *http.Request, normalize func(string) string) ([]xlsx.ImportRow, error) {
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if err != nil {
		return nil, err
	}
	file := form.File("file")
	if file == nil {
		return nil, httpx.BadRequest("File not found")
	}
	matrix, err := xlsx.SpreadsheetMatrix(file.Data, file.Name)
	if err != nil {
		return nil, err
	}
	if len(matrix) < 2 {
		return nil, httpx.BadRequest("File must include a header row and at least one data row")
	}
	return xlsx.MatrixToRows(matrix, normalize), nil
}

type importIssue struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}

// importSummary is ImportTally.summary().
type importSummary struct {
	Success  bool          `json:"success"`
	Imported int           `json:"imported"`
	Updated  int           `json:"updated"`
	Skipped  int           `json:"skipped"`
	Errors   []importIssue `json:"errors"`
}

func newImportSummary() *importSummary {
	return &importSummary{Success: true, Errors: []importIssue{}}
}

func (t *importSummary) skip(row int, msg string) {
	t.Errors = append(t.Errors, importIssue{row, msg})
	t.Skipped++
}

// rowFailure ends one import row with this message.
type rowFailure string

func (e rowFailure) Error() string { return string(e) }

// dbFailure is the row message of a failed write: `error.message` of the
// query builder, the server message for a PostgreSQL error.
func dbFailure(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return rowFailure(pgErr.Message)
	}
	return rowFailure(err.Error())
}

// importRow runs one row's writes in a transaction (a savepoint under a
// test transaction). The TS writes autocommit and stop at the first failing
// statement; here the row's writes roll back together and the next row
// continues. It returns the skip message of a rowFailure.
func (h *handler) importRow(ctx context.Context, fn func(q database.Querier) error) (string, error) {
	err := h.env.Tx(ctx, fn)
	var fail rowFailure
	if errors.As(err, &fail) {
		return string(fail), nil
	}
	return "", err
}

// jsTrim is String.prototype.trim.
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == 0xFEFF })
}

// emptyToNull is emptyToNull: the trimmed cell, nil when blank.
func emptyToNull(v string) *string {
	if v = jsTrim(v); v == "" {
		return nil
	}
	return &v
}

// parseNumberCell is parseNumberCell: thousands commas dropped ("1,250.5");
// blank or invalid is fallback.
func parseNumberCell(v string, fallback float64) float64 {
	if jsTrim(v) == "" {
		return fallback
	}
	n := kit.JSNumber(strings.ReplaceAll(v, ",", ""))
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return fallback
	}
	return n
}

// parseOptionalIntCell is parseOptionalIntCell: parseInt, nil when blank
// or not a number.
func parseOptionalIntCell(v string) *float64 {
	if jsTrim(v) == "" {
		return nil
	}
	n, ok := kit.ParseInt(v)
	if !ok {
		return nil
	}
	f := float64(n)
	return &f
}

// parseActiveCell is parseActiveCell: blank is active, inactive/nonaktif/
// false/0/no is not.
func parseActiveCell(v string) bool {
	switch strings.ToLower(jsTrim(v)) {
	case "inactive", "nonaktif", "false", "0", "no":
		return false
	}
	return true
}

var trailingSequence = regexp.MustCompile(`-(\d+)$`)

// nextCodeSequence is nextCodeSequence: "BHN-2026-0007" → 8, else 1.
func nextCodeSequence(last string) int {
	m := trailingSequence.FindStringSubmatch(last)
	if m == nil {
		return 1
	}
	n, _ := strconv.Atoi(m[1])
	return n + 1
}

// exactScope is exactScope: company and branch equal, NULL matching NULL.
func exactScope(a *kit.Args, companyID, branchID *string) string {
	return `company_id IS NOT DISTINCT FROM ` + a.Add(companyID) + `::uuid AND branch_id IS NOT DISTINCT FROM ` + a.Add(branchID) + `::uuid`
}

// warehouseByCode is resolveWarehouseIdByCode: an active stall whose code
// matches case-insensitively (ILIKE, as the query builder), in branchID
// when set. Results are cached per branch and code.
func (h *handler) warehouseByCode(ctx context.Context, code string, branchID *string, cache map[string]string) (string, error) {
	normalized := strings.ToUpper(jsTrim(code))
	key := kit.FirstNonEmpty(kit.Deref(branchID), "global") + ":" + normalized
	if id, ok := cache[key]; ok {
		return id, nil
	}
	a := &kit.Args{}
	sql := `SELECT id::text FROM configuration.warehouses WHERE code ILIKE ` + a.Add(normalized) + ` AND is_active = true`
	if kit.Deref(branchID) != "" {
		sql += ` AND branch_id = ` + a.Add(*branchID)
	}
	row, err := kit.QueryOne(ctx, h.env.DB, sql+` LIMIT 1`, a.Values...)
	if err != nil {
		return "", err
	}
	id := ""
	if row != nil {
		id = row.Str("id")
	}
	cache[key] = id
	return id, nil
}

// exportSheet runs sql, whose columns are text in header order, and
// answers the rows as `<base>-YYYY-MM-DD.xlsx` with header as the first
// row. Cells are spreadsheetCell of the node-postgres value: NULL is "",
// text trimmed.
func (h *handler) exportSheet(w http.ResponseWriter, r *http.Request, sheet, base string, header []string, sql string, args ...any) error {
	rows, err := h.env.DB.Query(r.Context(), sql, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	headerRow := make([]any, len(header))
	for i, k := range header {
		headerRow[i] = k
	}
	out := [][]any{headerRow}
	for rows.Next() {
		cells := make([]*string, len(header))
		dest := make([]any, len(cells))
		for i := range cells {
			dest[i] = &cells[i]
		}
		if err := rows.Scan(dest...); err != nil {
			return err
		}
		line := make([]any, len(cells))
		for i, c := range cells {
			line[i] = ""
			if c != nil {
				line[i] = jsTrim(*c)
			}
		}
		out = append(out, line)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	book, err := xlsx.Build(xlsx.SheetSpec{Name: sheet, Rows: out})
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", xlsx.ContentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+base+`-`+h.env.Now().UTC().Format(time.DateOnly)+`.xlsx"`)
	_, err = w.Write(book)
	return err
}
