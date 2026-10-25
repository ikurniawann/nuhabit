// Package importer is the shared machinery of the CSV/XLSX data imports:
// a column spec per dataset, the template download, the uploaded file read
// into rows, and a runner that applies one handler per row inside a single
// transaction. A dry run executes the same handlers and rolls the
// transaction back, so the preview reports exactly what a commit would do.
package importer

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/xlsx"
)

// Column is one column of a template. Key is the CSV header; Label names
// the column in error messages and is accepted as a header too.
type Column struct {
	Key      string
	Label    string
	Required bool
	// Help is the one-line description the documentation prints.
	Help string
}

// Spec describes one dataset: its columns and sample rows.
type Spec struct {
	// Entity is the audit.audit_log entity of a commit, e.g. "gym.class_types".
	Entity string
	// FileName is the template file name, e.g. "template-jenis-kelas.csv".
	FileName string
	Columns  []Column
	// Sample rows fill the template, in column order.
	Sample [][]string
	// MaxRows caps the data rows of one upload; 0 is DefaultMaxRows.
	MaxRows int
}

// DefaultMaxRows is the cap on data rows per upload.
const DefaultMaxRows = 2000

// Row is one data row keyed by column key. Number is the row in the file,
// the header being row 1.
type Row struct {
	Number int
	Data   map[string]string
}

// Get returns the trimmed value of key.
func (r Row) Get(key string) string { return strings.TrimSpace(r.Data[key]) }

// Status of one row after its handler ran.
type Status string

const (
	Created   Status = "created"
	Updated   Status = "updated"
	Unchanged Status = "unchanged"
	Skipped   Status = "skipped"
	Failed    Status = "error"
)

// Result is what a handler reports for one row.
type Result struct {
	Status Status `json:"status"`
	// Label names the row in the report, e.g. the class type name.
	Label   string `json:"label"`
	Message string `json:"message,omitempty"`
}

// RowResult is Result with its row number.
type RowResult struct {
	Row int `json:"row"`
	Result
}

// RowError is one failed row.
type RowError struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}

// Report is the outcome of a run, dry or committed.
type Report struct {
	DryRun    bool        `json:"dry_run"`
	Total     int         `json:"total"`
	Created   int         `json:"created"`
	Updated   int         `json:"updated"`
	Unchanged int         `json:"unchanged"`
	Skipped   int         `json:"skipped"`
	Failed    int         `json:"failed"`
	Rows      []RowResult `json:"rows"`
	Errors    []RowError  `json:"errors"`
}

func (r *Report) add(row int, res Result) {
	r.Rows = append(r.Rows, RowResult{Row: row, Result: res})
	switch res.Status {
	case Created:
		r.Created++
	case Updated:
		r.Updated++
	case Unchanged:
		r.Unchanged++
	case Skipped:
		r.Skipped++
	case Failed:
		r.Failed++
		r.Errors = append(r.Errors, RowError{Row: row, Message: res.Message})
	}
}

// Rejection is a row the handler refused with a message for the report.
type Rejection struct{ Message string }

func (e *Rejection) Error() string { return e.Message }

// Reject returns a Rejection.
func Reject(msg string) error { return &Rejection{Message: msg} }

// Upload is a parsed request: the data rows and whether it is a dry run.
type Upload struct {
	Rows     []Row
	DryRun   bool
	FileName string
}

// Read parses the multipart body: the file part "file" (CSV or XLSX) and
// the text field "dry_run" ("1" or "true"). Headers are matched by column
// key or label, case-insensitively; every required column must be present.
// Blank rows are dropped.
func Read(r *http.Request, spec Spec) (Upload, error) {
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if err != nil {
		if errors.Is(err, storage.ErrBodyTooLarge) {
			return Upload{}, httpx.BadRequest("File terlalu besar (maksimal 10 MB)")
		}
		return Upload{}, httpx.BadRequest("Unggah file CSV atau XLSX di field \"file\"")
	}
	file := form.File("file")
	if file == nil {
		return Upload{}, httpx.BadRequest("File belum dipilih")
	}
	up := Upload{FileName: file.Name}
	switch strings.ToLower(form.Value("dry_run")) {
	case "1", "true", "ya":
		up.DryRun = true
	}
	matrix, err := xlsx.SpreadsheetMatrix(file.Data, file.Name)
	if err != nil {
		if errors.Is(err, xlsx.ErrTooLarge) {
			return Upload{}, httpx.BadRequest(err.Error())
		}
		return Upload{}, httpx.BadRequest("File tidak terbaca; simpan sebagai CSV (UTF-8) atau XLSX")
	}
	if len(matrix) < 2 {
		return Upload{}, httpx.BadRequest("File harus berisi baris header dan minimal satu baris data")
	}
	normalize := xlsx.HeaderNormalizer(spec.aliases())
	seen := map[string]bool{}
	for _, h := range matrix[0] {
		seen[normalize(h)] = true
	}
	var missing []string
	for _, c := range spec.Columns {
		if c.Required && !seen[c.Key] {
			missing = append(missing, c.Key)
		}
	}
	if len(missing) > 0 {
		return Upload{}, httpx.BadRequest("Kolom wajib tidak ditemukan: " + strings.Join(missing, ", ") + ". Unduh template dan pakai header yang sama.")
	}
	keys := make([]string, len(spec.Columns))
	for i, c := range spec.Columns {
		keys[i] = c.Key
	}
	for _, raw := range xlsx.MatrixToRows(matrix, normalize) {
		if xlsx.IsBlankRow(raw.Data, keys...) {
			continue
		}
		up.Rows = append(up.Rows, Row{Number: raw.RowNumber, Data: raw.Data})
	}
	max := spec.MaxRows
	if max <= 0 {
		max = DefaultMaxRows
	}
	if len(up.Rows) > max {
		return Upload{}, httpx.BadRequest(fmt.Sprintf("Maksimal %d baris data per file", max))
	}
	if len(up.Rows) == 0 {
		return Upload{}, httpx.BadRequest("File tidak berisi baris data")
	}
	return up, nil
}

// aliases maps every normalized label (and key) to its key.
func (s Spec) aliases() map[string]string {
	out := map[string]string{}
	for _, c := range s.Columns {
		out[c.Key] = c.Key
		out[normalizeHeader(c.Label)] = c.Key
	}
	return out
}

func normalizeHeader(h string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(h))), "_")
}

// WriteTemplate answers the template CSV: a UTF-8 BOM so Excel reads it as
// UTF-8, the column keys as header, then the sample rows.
func WriteTemplate(w http.ResponseWriter, spec Spec) error {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+spec.FileName+`"`)
	w.Header().Set("Cache-Control", "no-store")
	if _, err := w.Write([]byte(xlsx.BOM)); err != nil {
		return err
	}
	cw := csv.NewWriter(w)
	header := make([]string, len(spec.Columns))
	for i, c := range spec.Columns {
		header[i] = c.Key
	}
	if err := cw.Write(header); err != nil {
		return err
	}
	for _, row := range spec.Sample {
		if err := cw.Write(row); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// Handler applies one row on tx and reports what happened. A returned
// Rejection or *httpx.Error becomes the row's error message; any other
// error is logged and reported as a generic failure.
type Handler func(ctx context.Context, tx pgx.Tx, row Row) (Result, error)

// Options configure a run.
type Options struct {
	DryRun bool
	// Entity is the audit entity; ActorID and ActorName the signed-in staff.
	Entity    string
	ActorID   string
	ActorName string
	// Request fills the audit row's IP and user agent; nil leaves them empty.
	Request *http.Request
	Log     *slog.Logger
}

var errDryRun = errors.New("importer: dry run")

// Run applies fn to every row inside one transaction on db. Each row runs
// in its own savepoint, so a failed row is reported and the others go
// through. A dry run rolls everything back; a commit with at least one
// change writes one audit row.
func Run(ctx context.Context, db database.DB, opts Options, rows []Row, fn Handler) (*Report, error) {
	report := &Report{DryRun: opts.DryRun, Total: len(rows), Rows: []RowResult{}, Errors: []RowError{}}
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		for _, row := range rows {
			var res Result
			err := database.WithTx(ctx, tx, func(sp pgx.Tx) error {
				var err error
				res, err = fn(ctx, sp, row)
				return err
			})
			if err != nil {
				res = Result{Status: Failed, Message: rowMessage(err, opts.Log, row.Number)}
			}
			if res.Status == "" {
				res.Status = Unchanged
			}
			report.add(row.Number, res)
		}
		if opts.DryRun {
			return errDryRun
		}
		if report.Created+report.Updated == 0 {
			return nil
		}
		entry := audit.Entry{
			ActorID: opts.ActorID, Action: "import", Entity: opts.Entity,
			After: map[string]any{
				"total": report.Total, "created": report.Created, "updated": report.Updated,
				"unchanged": report.Unchanged, "skipped": report.Skipped, "failed": report.Failed,
			},
		}
		if opts.ActorName != "" {
			entry.ActorName = &opts.ActorName
		}
		if opts.Request != nil {
			entry = entry.WithRequest(opts.Request)
		}
		return audit.Write(ctx, tx, entry)
	})
	if err != nil && !errors.Is(err, errDryRun) {
		return nil, err
	}
	return report, nil
}

// rowMessage is the message the report shows for a failed row.
func rowMessage(err error, log *slog.Logger, row int) string {
	var rej *Rejection
	if errors.As(err, &rej) {
		return rej.Message
	}
	var apiErr *httpx.Error
	if errors.As(err, &apiErr) {
		return apiErr.Message
	}
	if database.IsUniqueViolation(err) {
		return "Data sudah ada (duplikat)"
	}
	if log != nil {
		log.Error("[import] row failed", "row", row, "error", err)
	}
	return "Gagal menyimpan baris"
}

// Respond writes the report as the data of a success envelope.
func Respond(w http.ResponseWriter, report *Report) error { return httpx.OK(w, report) }
