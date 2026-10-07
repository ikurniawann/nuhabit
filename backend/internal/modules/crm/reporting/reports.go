package reporting

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/reporting/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// canManageShared: only admins change shared reports, the default
// dashboard and schedules.
func canManageShared(u *auth.User) bool { return u.Role == "super_admin" || u.Role == "admin" }

// visibilityWhere mirrors reportVisibilityWhere: global and own-company
// rows, minus other people's private reports.
func visibilityWhere(alias string, u *auth.User, s *kit.Scope, params *[]any) string {
	var parts []string
	if s.CompanyID != nil {
		*params = append(*params, *s.CompanyID)
		parts = append(parts, fmt.Sprintf("(%s.company_id IS NULL OR %s.company_id = $%d)", alias, alias, len(*params)))
	}
	*params = append(*params, u.ID)
	parts = append(parts, fmt.Sprintf("(%s.is_shared OR %s.created_by = $%d)", alias, alias, len(*params)))
	return strings.Join(parts, " AND ")
}

// reportResult is ReportResult.
type reportResult struct {
	Columns   []domain.Column `json:"columns"`
	Rows      []*kit.Row      `json:"rows"`
	Grouped   bool            `json:"grouped"`
	Dataset   string          `json:"dataset"`
	RowCount  int             `json:"row_count"`
	Truncated bool            `json:"truncated"`
}

// queryReport runs a built report like node-postgres: the simple protocol
// sends every value as an untyped literal, so PostgreSQL infers each type
// from its column exactly as it does for node-postgres text parameters.
func queryReport(ctx context.Context, q database.Querier, built domain.Built) ([]*kit.Row, error) {
	args := []any{pgx.QueryExecModeSimpleProtocol}
	for _, p := range built.Params {
		args = append(args, domain.NodeParam(p))
	}
	rows, err := q.Query(ctx, built.SQL, args...)
	if err != nil {
		return nil, err
	}
	return kit.CollectRows(rows)
}

// ownerRestriction: the sales role only sees its own records.
func ownerRestriction(u *auth.User) *string {
	if u.Role == "sales" {
		return &u.ID
	}
	return nil
}

// runDefinition mirrors runReportDefinition.
func (h *handler) runDefinition(ctx context.Context, q database.Querier, def domain.Definition, u *auth.User, s *kit.Scope) (*reportResult, error) {
	built := domain.BuildReportQuery(def, domain.BuildContext{
		CompanyID: s.CompanyID, RestrictOwnerUserID: ownerRestriction(u), Today: h.now().In(h.loc),
	})
	rows, err := queryReport(ctx, q, built)
	if err != nil {
		return nil, err
	}
	return &reportResult{Columns: built.Columns, Rows: rows, Grouped: built.Grouped, Dataset: def.Dataset,
		RowCount: len(rows), Truncated: len(rows) >= def.Limit}, nil
}

// loadAccessibleReport mirrors loadAccessibleReport: nil when missing or
// not visible to the user.
func (h *handler) loadAccessibleReport(ctx context.Context, id string, u *auth.User, s *kit.Scope) (*kit.Row, error) {
	params := []any{id}
	vis := visibilityWhere("r", u, s, &params)
	return kit.QueryOne(ctx, h.db, `SELECT r.id, r.company_id, r.name, r.description, r.dataset, r.definition, r.is_shared,
            r.created_by, r.created_at, r.updated_at, u.full_name AS creator_name
     FROM crm.crm_reports r
     LEFT JOIN configuration.users u ON u.id = r.created_by
     WHERE r.id = $1::text::uuid AND r.deleted_at IS NULL AND `+vis, params...)
}

func (h *handler) requireAccessibleReport(ctx context.Context, id string, u *auth.User, s *kit.Scope) (*kit.Row, error) {
	report, err := h.loadAccessibleReport(ctx, id, u, s)
	if err == nil && report == nil {
		err = httpx.NotFound("Report tidak ditemukan")
	}
	return report, err
}

// parseStoredDefinition mirrors parseStoredDefinition: a broken stored row
// falls back to the dataset defaults instead of failing the API.
func parseStoredDefinition(dataset string, raw json.RawMessage) (domain.Definition, error) {
	obj := map[string]any{}
	if v, err := kit.DecodeLoose(raw); err == nil {
		if m, ok := v.(map[string]any); ok {
			obj = m
		}
	}
	obj["dataset"] = dataset
	f := validate.New(obj, true)
	def := parseDefinition(f)
	if f.Valid() {
		return def, nil
	}
	if !slices.Contains(domain.Datasets, dataset) {
		// reportDefinitionSchema.parse({ dataset }) throws: a 500.
		return def, fmt.Errorf("reporting: stored dataset %q is not a report dataset", dataset)
	}
	return domain.DefaultDefinition(dataset), nil
}

// storedDefinition parses a report row's dataset and definition columns.
func storedDefinition(row *kit.Row) (domain.Definition, error) {
	raw, _ := row.Get("definition").(json.RawMessage)
	return parseStoredDefinition(row.Str("dataset"), raw)
}

/* ── handlers ───────────────────────────────────────────────────────── */

func (h *handler) datasets(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateReports); err != nil {
		return err
	}
	type field struct {
		Key          string   `json:"key"`
		Label        string   `json:"label"`
		Type         string   `json:"type"`
		Options      []string `json:"options"`
		Aggregatable bool     `json:"aggregatable"`
	}
	type dataset struct {
		Key            string   `json:"key"`
		Label          string   `json:"label"`
		DateField      string   `json:"date_field"`
		DefaultColumns []string `json:"default_columns"`
		Fields         []field  `json:"fields"`
	}
	out := []dataset{}
	for _, key := range domain.Datasets {
		ds := domain.DatasetDef(key)
		fields := make([]field, len(ds.Fields))
		for i, f := range ds.Fields {
			fields[i] = field{f.Key, f.Label, f.Type, f.Options, f.Aggregatable}
		}
		out = append(out, dataset{key, ds.Label, ds.DateField, ds.DefaultColumns, fields})
	}
	return kit.OK(w, struct {
		Datasets     []dataset       `json:"datasets"`
		FilterOps    []domain.Option `json:"filter_ops"`
		DatePresets  []domain.Option `json:"date_presets"`
		DateBuckets  []domain.Option `json:"date_buckets"`
		Aggregations []domain.Option `json:"aggregations"`
		ChartTypes   []domain.Option `json:"chart_types"`
	}{out, domain.FilterOps, domain.DatePresets, domain.DateBuckets, domain.Aggregations, domain.ChartTypes})
}

func (h *handler) listReports(w http.ResponseWriter, r *http.Request) error {
	u, s, err := h.guard.RequireScope(r, kit.GateReports)
	if err != nil {
		return err
	}
	params := []any{}
	vis := visibilityWhere("r", u, s, &params)
	extra := ""
	if ds := r.URL.Query().Get("dataset"); ds != "" {
		params = append(params, ds)
		extra = fmt.Sprintf(" AND r.dataset = $%d", len(params))
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT r.id, r.company_id, r.name, r.description, r.dataset, r.definition, r.is_shared,
            r.created_by, r.created_at, r.updated_at, u.full_name AS creator_name,
            (SELECT COUNT(*) FROM crm.crm_report_schedules s WHERE s.report_id = r.id AND s.is_active) AS active_schedules
     FROM crm.crm_reports r
     LEFT JOIN configuration.users u ON u.id = r.created_by
     WHERE r.deleted_at IS NULL AND `+vis+extra+`
     ORDER BY r.updated_at DESC`, params...)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

// sharedFlag: only admins create or mark shared reports; others get private ones.
func sharedFlag(requested bool, u *auth.User) bool { return requested && canManageShared(u) }

func definitionJSON(d domain.Definition) string {
	b, _ := d.MarshalJSON()
	return string(b)
}

func (h *handler) createReport(w http.ResponseWriter, r *http.Request) error {
	u, s, err := h.guard.RequireScope(r, kit.GateReports)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseReport(f, false)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := kit.QueryOne(r.Context(), h.db, `INSERT INTO crm.crm_reports (company_id, name, description, dataset, definition, is_shared, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING id, name, dataset, is_shared`,
		kit.ScopedCompanyID(u, s), *in.Name, in.Description.Val, in.Definition.Dataset, definitionJSON(*in.Definition),
		sharedFlag(*in.IsShared, u), u.ID)
	if err != nil {
		return err
	}
	return kit.Created(w, row, "Report disimpan")
}

func (h *handler) runReport(w http.ResponseWriter, r *http.Request) error {
	u, s, err := h.guard.RequireScope(r, kit.GateReports)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	def := parseDefinition(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	result, err := h.runDefinition(r.Context(), h.db, def, u, s)
	if err != nil {
		return err
	}
	return kit.OK(w, result)
}

func (h *handler) getReport(w http.ResponseWriter, r *http.Request) error {
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
	report.Set("definition", def)
	if r.URL.Query().Get("meta") == "1" {
		return kit.OK(w, struct {
			Report *kit.Row `json:"report"`
		}{report})
	}
	result, err := h.runDefinition(r.Context(), h.db, def, u, s)
	if err != nil {
		return err
	}
	return kit.OK(w, struct {
		Report *kit.Row      `json:"report"`
		Result *reportResult `json:"result"`
	}{report, result})
}

// requireEditableReport: only the creator or an admin edits or deletes.
func (h *handler) requireEditableReport(r *http.Request, verb string) (*auth.User, error) {
	u, s, err := h.guard.RequireScope(r, kit.GateReports)
	if err != nil {
		return nil, err
	}
	report, err := h.requireAccessibleReport(r.Context(), r.PathValue("id"), u, s)
	if err != nil {
		return nil, err
	}
	if report.Str("created_by") != u.ID && !canManageShared(u) {
		return nil, httpx.Forbidden("Hanya pembuat atau admin yang bisa " + verb + " report ini")
	}
	return u, nil
}

// setList collects "col = $n" assignments after updated_at = now().
type setList struct {
	sets   []string
	values []any
}

func (l *setList) push(col string, v any, cast string) {
	l.values = append(l.values, v)
	l.sets = append(l.sets, fmt.Sprintf("%s = $%d%s", col, len(l.values), cast))
}

func (l *setList) sql() string {
	return strings.Join(append([]string{"updated_at = now()"}, l.sets...), ", ")
}

func (h *handler) patchReport(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireEditableReport(r, "mengubah")
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseReport(f, true)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	var l setList
	if in.Name != nil {
		l.push("name", *in.Name, "")
	}
	if in.Description.Set {
		l.push("description", in.Description.Val, "")
	}
	if in.Definition != nil {
		l.push("definition", definitionJSON(*in.Definition), "::jsonb")
		l.push("dataset", in.Definition.Dataset, "")
	}
	if in.IsShared != nil {
		l.push("is_shared", sharedFlag(*in.IsShared, u), "")
	}
	if len(l.values) == 0 {
		return httpx.BadRequest("Tidak ada field yang diubah")
	}
	row, err := kit.QueryOne(r.Context(), h.db, fmt.Sprintf(`UPDATE crm.crm_reports SET %s WHERE id = $%d::text::uuid AND deleted_at IS NULL
     RETURNING id, name, dataset, is_shared`, l.sql(), len(l.values)+1), append(l.values, r.PathValue("id"))...)
	if err != nil {
		return err
	}
	return kit.OK(w, row, "Report diperbarui")
}

func (h *handler) deleteReport(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireEditableReport(r, "menghapus"); err != nil {
		return err
	}
	if _, err := h.db.Exec(r.Context(), `UPDATE crm.crm_reports SET deleted_at = now() WHERE id = $1::text::uuid`, r.PathValue("id")); err != nil {
		return err
	}
	return kit.NoContent(w)
}
