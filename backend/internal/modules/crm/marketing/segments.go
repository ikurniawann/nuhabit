package marketing

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/marketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Segment builder queries run on the simple protocol: pgx then inlines every
// parameter as a quoted literal and PostgreSQL infers its type from the
// column, which is how node-postgres' untyped text parameters behave (a
// date filter value is a string compared with a timestamptz, a number
// compared with an int column, and so on).
func querySimple(ctx context.Context, q database.Querier, sql string, args []any) ([]*kit.Row, error) {
	return kit.Query(ctx, q, sql, append([]any{pgx.QueryExecModeSimpleProtocol}, args...)...)
}

func scanSimple(ctx context.Context, q database.Querier, sql string, args []any, dst ...any) error {
	return q.QueryRow(ctx, sql, append([]any{pgx.QueryExecModeSimpleProtocol}, args...)...).Scan(dst...)
}

const segmentColumns = `s.id, s.company_id, s.name, s.description, s.source, s.definition, s.is_active,
            s.last_count, s.last_counted_at, s.created_by, s.created_at, s.updated_at`

// requireSegment mirrors requireSegment: the segment in the user's company
// scope, 404 otherwise. The id goes through ::text::uuid so a malformed id
// fails in PostgreSQL (22P02, 400) as it does with node-postgres.
func (h *handler) requireSegment(ctx context.Context, id string, s *kit.Scope) (*kit.Row, error) {
	where, params := companyFilter("s.id = $1::text::uuid AND s.deleted_at IS NULL", []any{id}, "s.", s)
	row, err := kit.QueryOne(ctx, h.db, `SELECT `+segmentColumns+`
     FROM crm.crm_segments s WHERE `+where, params...)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, httpx.NotFound("Segmen tidak ditemukan")
	}
	return row, nil
}

func (h *handler) listSegments(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.guard.RequireScope(r, kit.GateSegments)
	if err != nil {
		return err
	}
	where, params := companyFilter("s.deleted_at IS NULL", nil, "s.", scope)
	rows, err := kit.Query(r.Context(), h.db, `SELECT `+segmentColumns+`,
            u.full_name AS creator_name
     FROM crm.crm_segments s
     LEFT JOIN configuration.users u ON u.id = s.created_by
     WHERE `+where+`
     ORDER BY s.is_active DESC, s.updated_at DESC`, params...)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

func (h *handler) createSegment(w http.ResponseWriter, r *http.Request) error {
	user, scope, err := h.guard.RequireScope(r, kit.GateSegments)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseSegment(f, false)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	def, err := kit.MarshalNoEscape(in.Definition)
	if err != nil {
		return err
	}
	row, err := kit.QueryOne(r.Context(), h.db, `INSERT INTO crm.crm_segments (company_id, name, description, source, definition, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING id, name, source, is_active`,
		kit.ScopedCompanyID(user, scope), *in.Name, in.Description, in.Definition.Source, string(def), *in.IsActive, user.ID)
	if err != nil {
		return err
	}
	return kit.Created(w, row, "Segmen dibuat")
}

func (h *handler) getSegment(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.guard.RequireScope(r, kit.GateSegments)
	if err != nil {
		return err
	}
	row, err := h.requireSegment(r.Context(), r.PathValue("id"), scope)
	if err != nil {
		return err
	}
	return kit.OK(w, row)
}

func (h *handler) patchSegment(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.guard.RequireScope(r, kit.GateSegments)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if _, err := h.requireSegment(r.Context(), id, scope); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseSegment(f, true)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	sets := []string{"updated_at = now()"}
	var values []any
	push := func(col string, v any, cast string) {
		values = append(values, v)
		sets = append(sets, col+" = $"+strconv.Itoa(len(values))+cast)
	}
	if in.Name != nil {
		push("name", *in.Name, "")
	}
	if in.HasDescription {
		push("description", in.Description, "")
	}
	if in.IsActive != nil {
		push("is_active", *in.IsActive, "")
	}
	if in.Definition != nil {
		def, err := kit.MarshalNoEscape(in.Definition)
		if err != nil {
			return err
		}
		push("definition", string(def), "::jsonb")
		push("source", in.Definition.Source, "")
		// A new definition invalidates the stored count.
		sets = append(sets, "last_count = NULL", "last_counted_at = NULL")
	}
	if len(values) == 0 {
		return httpx.BadRequest("Tidak ada field yang diubah")
	}
	values = append(values, id)
	row, err := kit.QueryOne(r.Context(), h.db, `UPDATE crm.crm_segments SET `+strings.Join(sets, ", ")+
		` WHERE id = $`+strconv.Itoa(len(values))+`::text::uuid AND deleted_at IS NULL
     RETURNING id, name, source, is_active`, values...)
	if err != nil {
		return err
	}
	return kit.OK(w, row, "Segmen diperbarui")
}

func (h *handler) deleteSegment(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.guard.RequireScope(r, kit.GateSegments)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	if _, err := h.requireSegment(ctx, id, scope); err != nil {
		return err
	}
	var used bool
	if err := h.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM crm.crm_campaigns
     WHERE segment_id = $1::text::uuid AND status IN ('draft', 'sending', 'paused'))`, id).Scan(&used); err != nil {
		return err
	}
	if used {
		return httpx.Conflict("Segmen masih dipakai kampanye yang berjalan")
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_segments SET deleted_at = now(), is_active = false WHERE id = $1::text::uuid`, id); err != nil {
		return err
	}
	return kit.NoContent(w)
}

type segmentPreview struct {
	Total   int  `json:"total"`
	Sample  any  `json:"sample"`
	WithRfm bool `json:"with_rfm"`
}

// previewSegment mirrors previewSegment in segments-server: the member
// count plus up to 10 sample rows. Lead and contact sources live in the
// sales funnel and run through its port.
func (h *handler) previewSegment(ctx context.Context, def domain.Definition, companyID *string) (segmentPreview, error) {
	counted := domain.BuildSegmentQuery(def, companyID, true)
	sampleDef := def
	sampleDef.Limit = min(def.Limit, 10)
	listed := domain.BuildSegmentQuery(sampleDef, companyID, false)
	out := segmentPreview{WithRfm: listed.WithRfm}
	if def.Source != "member" {
		total, err := h.p.Funnel.SegmentCount(ctx, h.db, counted.SQL, counted.Params)
		if err != nil {
			return out, err
		}
		sample, err := h.p.Funnel.SegmentSample(ctx, h.db, listed.SQL, listed.Params)
		if sample == nil {
			sample = []SegmentMember{}
		}
		out.Total, out.Sample = total, sample
		return out, err
	}
	if err := scanSimple(ctx, h.db, counted.SQL, counted.Params, &out.Total); err != nil {
		return out, err
	}
	sample, err := querySimple(ctx, h.db, listed.SQL, listed.Params)
	out.Sample = sample
	return out, err
}

func (h *handler) previewDefinition(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.guard.RequireScope(r, kit.GateSegments)
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
	out, err := h.previewSegment(r.Context(), def, scope.CompanyID)
	if err != nil {
		return err
	}
	return kit.OK(w, out)
}

func (h *handler) previewSaved(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.guard.RequireScope(r, kit.GateSegments)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	row, err := h.requireSegment(ctx, id, scope)
	if err != nil {
		return err
	}
	raw, err := decodeJSONColumn(row, "definition")
	if err != nil {
		return err
	}
	out, err := h.previewSegment(ctx, parseStoredSegment(row.Str("source"), raw), scope.CompanyID)
	if err != nil {
		return err
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_segments SET last_count = $2, last_counted_at = now(), updated_at = now()
     WHERE id = $1::text::uuid`, id, out.Total); err != nil {
		return err
	}
	return kit.OK(w, out, strconv.Itoa(out.Total)+" anggota")
}

// decodeJSONColumn decodes a json/jsonb column keeping numbers as
// json.Number, which the validate package reads.
func decodeJSONColumn(row *kit.Row, key string) (any, error) {
	raw, ok := row.Get(key).(json.RawMessage)
	if !ok {
		return nil, nil
	}
	return kit.DecodeLoose(raw)
}
