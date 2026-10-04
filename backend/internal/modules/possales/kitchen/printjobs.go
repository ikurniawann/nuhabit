package kitchen

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/modules/possales/kitchen/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// unknownError is the 500 body of every print-jobs failure: the TS rethrows
// the query shim's plain `{ message, code }` error objects, which are not
// Error instances, so getErrorMessage answers 'Unknown error'.
const unknownError = "Unknown error"

// InsertPrintJobs inserts rows built by domain.BuildKitchenPrintJobs in one
// statement, like `db.from('pos_print_jobs').insert(printJobs)`: a unique
// violation on (order_id, station, job_type) of an open job fails them all.
// The caller decides which errors to swallow, as each TS call site does.
func InsertPrintJobs(ctx context.Context, q database.Querier, rows []domain.PrintJobRow) error {
	if len(rows) == 0 {
		return nil
	}
	var values []string
	var args []any
	for _, row := range rows {
		payload, err := json.Marshal(row.Payload)
		if err != nil {
			return err
		}
		n := len(args)
		values = append(values, fmt.Sprintf("($%d::uuid, $%d, $%d, $%d, $%d::jsonb)", n+1, n+2, n+3, n+4, n+5))
		args = append(args, row.OrderID, row.Station, row.JobType, row.Status, string(payload))
	}
	_, err := q.Exec(ctx, `INSERT INTO pos.pos_print_jobs (order_id, station, job_type, status, payload) VALUES `+
		strings.Join(values, ", "), args...)
	return err
}

// printJobOrderSelect is `select('*, order:pos_orders(...)')` as the query
// shim expands the many-to-one embed.
const printJobOrderSelect = `SELECT *, (SELECT row_to_json(e) FROM (SELECT order_number, order_type, table_id,
	ordered_at, status, payment_status FROM pos.pos_orders WHERE id = pos_print_jobs.order_id) e) AS "order"
	FROM pos.pos_print_jobs`

// listPrintJobs is GET /api/pos/print-jobs?status=&station=&limit=.
func (h *Handler) listPrintJobs(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	limit := 100.0
	if f, err := strconv.ParseFloat(strings.TrimSpace(q.Get("limit")), 64); err == nil && f != 0 && !math.IsNaN(f) {
		limit = min(f, 250)
	}
	if limit < 0 || limit != math.Trunc(limit) {
		// PostgreSQL rejects a negative or fractional LIMIT.
		return h.printJobFail(w, r, "fetching", fmt.Errorf("invalid limit %v", limit))
	}

	sql := printJobOrderSelect
	var conds []string
	var args []any
	if status := domain.QueueStatus(q.Get("status")); status != "" {
		args = append(args, status)
		conds = append(conds, fmt.Sprintf("status = $%d", len(args)))
	}
	if station := q.Get("station"); station != "" && station != "all" {
		args = append(args, domain.QueueStation(station))
		conds = append(conds, fmt.Sprintf("station = $%d", len(args)))
	}
	if len(conds) > 0 {
		sql += " WHERE " + strings.Join(conds, " AND ")
	}
	args = append(args, int64(limit))
	sql += fmt.Sprintf(" ORDER BY requested_at DESC LIMIT $%d", len(args))

	rows, err := jsrow.Query(r.Context(), h.db, sql, args...)
	if err == nil {
		for _, row := range rows {
			if err = normalizeJSONColumns(row, "payload", "order"); err != nil {
				break
			}
		}
	}
	if err != nil {
		return h.printJobFail(w, r, "fetching", err)
	}
	return httpx.JSON(w, http.StatusOK, jsrow.Object("success", true, "data", rows))
}

// createPrintJob is POST /api/pos/print-jobs.
func (h *Handler) createPrintJob(w http.ResponseWriter, r *http.Request) error {
	body, err := readJSBody(r)
	if err != nil {
		return h.printJobFail(w, r, "creating", err, err.Error())
	}
	if body == nil {
		return h.printJobFail(w, r, "creating", nil, "Cannot read properties of null (reading 'order_id')")
	}
	obj, _ := body.(*jsrow.Row)
	field := func(key string) any {
		if obj == nil {
			return nil
		}
		return obj.Get(key)
	}
	if !jsTruthy(field("order_id")) {
		return kit.Fail(w, http.StatusBadRequest, "order_id is required")
	}
	orderID, ok := field("order_id").(string)
	if !ok {
		// node-postgres would send it as a non-uuid literal; the insert fails.
		return h.printJobFail(w, r, "creating", fmt.Errorf("order_id is not a string"))
	}
	stationValue := ""
	if v := field("station"); jsTruthy(v) {
		stationValue = jsString(v)
	}
	station := domain.QueueStation(stationValue)
	jobType := domain.JobTypeForStation(station)
	if v := field("job_type"); jsTruthy(v) {
		s, ok := v.(string)
		if !ok {
			// Any non-string job_type fails pos_print_jobs_job_type_check.
			return h.printJobFail(w, r, "creating", fmt.Errorf("job_type is not a string"))
		}
		jobType = s
	}
	payload := "{}"
	if v := field("payload"); jsTruthy(v) {
		if s, ok := v.(string); ok {
			payload = s // the shim passes a string as is: PostgreSQL parses it as jsonb text
		} else {
			b, err := jsrow.Marshal(v)
			if err != nil {
				return err
			}
			payload = string(b)
		}
	}

	row, err := jsrow.QueryOne(r.Context(), h.db, `INSERT INTO pos.pos_print_jobs (order_id, station, job_type, status, payload)
		VALUES ($1::text::uuid, $2, $3, 'pending', $4::text::jsonb) RETURNING *`, orderID, station, jobType, payload)
	if err == nil {
		err = normalizeJSONColumns(row, "payload")
	}
	if err != nil {
		return h.printJobFail(w, r, "creating", err)
	}
	return httpx.JSON(w, http.StatusCreated, jsrow.Object("success", true, "data", row))
}

// updatePrintJob is PATCH /api/pos/print-jobs/{id}: the print worker (or a
// cashier) moves a job through pending → printing → printed/failed.
func (h *Handler) updatePrintJob(w http.ResponseWriter, r *http.Request) error {
	body, err := readJSBody(r)
	if err != nil {
		body = jsrow.New() // request.json().catch(() => ({}))
	}
	if body == nil {
		return h.printJobFail(w, r, "updating", nil, "Cannot read properties of null (reading 'action')")
	}
	obj, _ := body.(*jsrow.Row)
	if obj == nil {
		obj = jsrow.New()
	}
	action, _ := obj.Get("action").(string)
	statusValue := ""
	if v := obj.Get("status"); jsTruthy(v) {
		statusValue = jsString(v)
	}
	status := domain.ResolvePatchStatus(action, statusValue)
	if status == "" {
		return kit.Fail(w, http.StatusBadRequest, "Invalid print job status")
	}

	now := h.now().Truncate(time.Millisecond)
	args := []any{r.PathValue("id"), status, now}
	sets := []string{"status = $2", "updated_at = $3"}
	switch status {
	case "printing":
		// The TS reads attempts and writes attempts + 1 in two statements;
		// one UPDATE gives the same row without the race.
		sets = append(sets, "attempts = attempts + 1", "last_error = NULL")
	case "printed":
		sets = append(sets, "printed_at = $3", "last_error = NULL")
	case "failed":
		lastError := "Print failed"
		if v := obj.Get("error"); jsTruthy(v) {
			lastError = jsString(v)
		}
		args = append(args, lastError)
		sets = append(sets, "last_error = $4")
	}
	if action == "retry" {
		sets = append(sets, "printed_at = NULL", "last_error = NULL", "requested_at = $3")
	}

	row, err := jsrow.QueryOne(r.Context(), h.db, `UPDATE pos.pos_print_jobs SET `+strings.Join(sets, ", ")+
		` WHERE id = $1::text::uuid RETURNING *`, args...)
	if err == nil && row == nil {
		err = fmt.Errorf("No rows found")
	}
	if err == nil {
		err = normalizeJSONColumns(row, "payload")
	}
	if err != nil {
		return h.printJobFail(w, r, "updating", err)
	}
	return httpx.JSON(w, http.StatusOK, jsrow.Object("success", true, "data", row))
}

// printJobFail logs like `console.error('Error <verb> print job(s):', error)`
// and writes the 500 body: msg when given (a JS exception), else
// "Unknown error" (a query error object).
func (h *Handler) printJobFail(w http.ResponseWriter, r *http.Request, verb string, err error, msg ...string) error {
	h.log.ErrorContext(r.Context(), "Error "+verb+" print job", "error", err)
	body := unknownError
	if len(msg) > 0 {
		body = msg[0]
	}
	return kit.Fail(w, http.StatusInternalServerError, body)
}

// readJSBody is `await request.json()`: a parse failure carries the message
// of V8's SyntaxError for an empty body. JSON null yields (nil, nil).
func readJSBody(r *http.Request) (any, error) {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return nil, fmt.Errorf("Unexpected end of JSON input")
	}
	return jsParse(raw)
}

// normalizeJSONColumns re-encodes json/jsonb columns the way node-postgres
// parses them, so numbers print as JSON.stringify prints them.
func normalizeJSONColumns(row *jsrow.Row, cols ...string) error {
	for _, c := range cols {
		v, err := jsNormalize(row.Get(c))
		if err != nil {
			return err
		}
		row.Set(c, v)
	}
	return nil
}
