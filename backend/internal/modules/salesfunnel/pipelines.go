package salesfunnel

import (
	"net/http"
	"regexp"
	"strconv"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// lib/sales-funnel/pipelines-server.ts

const stageColumns = `
  id, code, name, sort_order, is_won, is_lost, stuck_threshold_days,
  is_active, created_at, updated_at, pipeline_id, probability`

const adminOnly = "Hanya admin/super admin"

func (h *handler) listPipelines(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	s, err := h.scope(ctx, u)
	if err != nil {
		return err
	}
	all := queryStr(r, "all") == "1"
	activeOnly, stagesActive := "AND p.is_active", "AND is_active"
	if all {
		activeOnly, stagesActive = "", ""
	}
	pipelines, err := pgrow.Query(ctx, h.db, `SELECT p.id, p.code, p.name, p.description, p.is_default, p.sort_order, p.is_active, p.company_id,
            (SELECT count(*) FROM crm.crm_sales_deals d WHERE d.pipeline_id = p.id AND d.deleted_at IS NULL AND d.closed_at IS NULL)::int AS open_deals
     FROM crm.crm_pipelines p
     WHERE (p.company_id IS NULL OR p.company_id = $1) `+activeOnly+`
     ORDER BY p.is_default DESC, p.sort_order, p.name`, s.CompanyID)
	if err != nil {
		return err
	}
	stages, err := pgrow.Query(ctx, h.db, `SELECT id, pipeline_id, code, name, sort_order, is_won, is_lost, stuck_threshold_days, probability, is_active
     FROM crm.crm_sales_stages WHERE pipeline_id IS NOT NULL `+stagesActive+`
     ORDER BY sort_order, created_at`)
	if err != nil {
		return err
	}
	byPipeline := map[string][]*pgrow.Row{}
	for _, st := range stages {
		byPipeline[st.Str("pipeline_id")] = append(byPipeline[st.Str("pipeline_id")], st)
	}
	for _, p := range pipelines {
		list := byPipeline[p.Str("id")]
		if list == nil {
			list = []*pgrow.Row{}
		}
		p.Set("stages", list)
	}
	return ok(w, pipelines)
}

var pipelineCodeRe = regexp.MustCompile(`^[a-z0-9-]{2,40}$`)

func (h *handler) createPipeline(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	if err := requireRole(u, "Hanya admin/super admin yang boleh membuat pipeline", "super_admin", "admin"); err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	name := str(f.Str("name", validate.Rule{}, trimRange(1, 100)))
	code := f.Str("code", opt, validate.StrOpts{Trim: true, Check: regexCheck(pipelineCodeRe, `/^[a-z0-9-]{2,40}$/`, "")})
	description := f.Str("description", optNull, trimMax(500))
	type stageIn struct {
		name        string
		probability int
	}
	var stages []stageIn
	items := f.List("stages", validate.Rule{}, 12, func(sub *validate.Form, i int, v any) {
		it := sub.Item(i, v)
		st := stageIn{name: str(it.Str("name", validate.Rule{}, trimRange(1, 100))), probability: 10}
		if n := it.Int("probability", validate.Rule{HasDefault: true}, numRange(0, 100)); n != nil {
			st.probability = *n
		}
		stages = append(stages, st)
	})
	if items != nil && len(items) < 1 {
		f.Fail("stages", "too_small", "Too small: expected array to have >=1 items")
	}
	if err := validationErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	s, err := h.scope(ctx, u)
	if err != nil {
		return err
	}
	companyID := s.CompanyID
	pipelineCode := domain.Slugify(name, 40)
	if code != nil {
		pipelineCode = *code
	}
	dup, err := scanID(ctx, h.db, `SELECT id::text FROM crm.crm_pipelines WHERE code = $1`, pipelineCode)
	if err != nil {
		return err
	}
	if dup != nil {
		return httpx.Conflict("Kode pipeline sudah dipakai")
	}
	var pipelineID string
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO crm.crm_pipelines (company_id, code, name, description, sort_order)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(sort_order), 0) + 10 FROM crm.crm_pipelines)) RETURNING id::text`,
			companyID, pipelineCode, name, ptrAny(description)).Scan(&pipelineID); err != nil {
			return err
		}
		order := 10
		for _, st := range stages {
			if _, err := tx.Exec(ctx, `INSERT INTO crm.crm_sales_stages (code, name, sort_order, probability, pipeline_id, stuck_threshold_days)
         VALUES ($1, $2, $3, $4, $5, 7)`, pipelineCode+"-"+domain.Slugify(st.name, 30)+"-"+strconv.Itoa(order), st.name, order, st.probability, pipelineID); err != nil {
				return err
			}
			order += 10
		}
		if _, err := tx.Exec(ctx, `INSERT INTO crm.crm_sales_stages (code, name, sort_order, is_won, probability, pipeline_id, stuck_threshold_days) VALUES ($1, 'Menang', $2, true, 100, $3, 0)`,
			pipelineCode+"-menang", order, pipelineID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO crm.crm_sales_stages (code, name, sort_order, is_lost, probability, pipeline_id, stuck_threshold_days) VALUES ($1, 'Kalah', $2, true, 0, $3, 0)`,
			pipelineCode+"-kalah", order+10, pipelineID)
		return err
	})
	if err != nil {
		return err
	}
	return created(w, pgrow.New("id", pipelineID, "code", pipelineCode, "name", name), "Pipeline dibuat")
}

func (h *handler) updatePipeline(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	if err := requireRole(u, adminOnly, "super_admin", "admin"); err != nil {
		return err
	}
	id := r.PathValue("id")
	f, err := form(r)
	if err != nil {
		return err
	}
	body := domain.NewFields()
	patchStr(f, body, "name", false, trimRange(1, 100))
	patchStr(f, body, "description", true, trimMax(500))
	patchBool(f, body, "is_default")
	patchBool(f, body, "is_active")
	if has(f, "sort_order") {
		if n := f.Int("sort_order", opt, numRange(0, 1000)); n != nil {
			body.Set("sort_order", *n)
		}
	}
	if err := validationErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	existing, err := scanID(ctx, h.db, `SELECT id::text FROM crm.crm_pipelines WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if existing == nil {
		return httpx.NotFound("Pipeline tidak ditemukan")
	}
	if body.Get("is_default") == true {
		if _, err := h.db.Exec(ctx, `UPDATE crm.crm_pipelines SET is_default = false WHERE id <> $1`, id); err != nil {
			return err
		}
	}
	if body.Has("is_active") && body.Get("is_active") == false {
		var open int
		if err := h.db.QueryRow(ctx, `SELECT count(*) FROM crm.crm_sales_deals WHERE pipeline_id = $1 AND deleted_at IS NULL AND closed_at IS NULL`, id).Scan(&open); err != nil {
			return err
		}
		if open > 0 {
			return httpx.Conflict("Pipeline masih punya deal terbuka — pindahkan dulu")
		}
	}
	set := domain.NewUpdateSet()
	body.Each(func(k string, v any) { set.Set(k, v, "") })
	sql, values, idParam, okSet := set.Build(id)
	if !okSet {
		return badRequest(domain.NoFieldsChanged)
	}
	row, err := pgrow.QueryOne(ctx, h.db, `UPDATE crm.crm_pipelines SET `+sql+` WHERE id = `+idParam+` RETURNING id, code, name, is_default, is_active`, values...)
	if err != nil {
		return err
	}
	return okMsg(w, row, "Pipeline diperbarui")
}

func (h *handler) listStages(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	active := "AND is_active = true"
	if u.Role == "super_admin" && queryStr(r, "all") == "1" {
		active = ""
	}
	var pipelineID any
	if p := queryStr(r, "pipeline_id"); domain.IsUUID(p) {
		pipelineID = p
	}
	rows, err := pgrow.Query(r.Context(), h.db, `SELECT `+stageColumns+` FROM crm.crm_sales_stages
     WHERE ($1::uuid IS NULL OR pipeline_id = $1) `+active+`
     ORDER BY sort_order ASC, created_at ASC`, pipelineID)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) createStage(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	if err := requireRole(u, adminOnly, "super_admin", "admin"); err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	pipelineID := str(f.UUID("pipeline_id", validate.Rule{}))
	name := str(f.Str("name", validate.Rule{}, trimRange(1, 100)))
	sortOrder := f.Int("sort_order", opt, numRange(0, 1000))
	probability, stuck := 10, 7
	if n := f.Int("probability", validate.Rule{HasDefault: true}, numRange(0, 100)); n != nil {
		probability = *n
	}
	if n := f.Int("stuck_threshold_days", validate.Rule{HasDefault: true}, numRange(0, 365)); n != nil {
		stuck = *n
	}
	if err := validationErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	pipelineCode, err := scanID(ctx, h.db, `SELECT code FROM crm.crm_pipelines WHERE id = $1`, pipelineID)
	if err != nil {
		return err
	}
	if pipelineCode == nil {
		return httpx.NotFound("Pipeline tidak ditemukan")
	}
	code := *pipelineCode + "-" + domain.Slugify(name, 30) + "-" + strconv.FormatInt(h.now().UnixMilli(), 36)
	order := 0
	if sortOrder != nil {
		order = *sortOrder
	} else {
		if err := h.db.QueryRow(ctx, `SELECT COALESCE(max(sort_order), 0) FROM crm.crm_sales_stages WHERE pipeline_id = $1 AND NOT is_won AND NOT is_lost`, pipelineID).Scan(&order); err != nil {
			return err
		}
		order += 10
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_sales_stages SET sort_order = sort_order + 20 WHERE pipeline_id = $1 AND (is_won OR is_lost) AND sort_order <= $2`,
		pipelineID, order); err != nil {
		return err
	}
	row, err := pgrow.QueryOne(ctx, h.db, `INSERT INTO crm.crm_sales_stages (code, name, sort_order, probability, stuck_threshold_days, pipeline_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING `+stageColumns, code, name, order, probability, stuck, pipelineID)
	if err != nil {
		return err
	}
	return created(w, row, "Tahap ditambahkan")
}

func (h *handler) updateStage(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	if err := requireRole(u, "", "super_admin"); err != nil {
		return err
	}
	id := r.PathValue("id")
	f, err := form(r)
	if err != nil {
		return err
	}
	body := domain.NewFields()
	patchStr(f, body, "name", false, trimRange(1, 100))
	for _, c := range []struct {
		key string
		max float64
	}{{"sort_order", 1000}, {"stuck_threshold_days", 365}} {
		if has(f, c.key) {
			if n := f.Int(c.key, opt, numRange(0, c.max)); n != nil {
				body.Set(c.key, *n)
			}
		}
	}
	patchBool(f, body, "is_active")
	if has(f, "probability") {
		if n := f.Int("probability", opt, numRange(0, 100)); n != nil {
			body.Set("probability", *n)
		}
	}
	if err := validationErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	stage, err := pgrow.QueryOne(ctx, h.db, `SELECT id, is_won, is_lost FROM crm.crm_sales_stages WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if stage == nil {
		return httpx.NotFound("Tahap tidak ditemukan")
	}
	if body.Has("is_active") && body.Get("is_active") == false {
		if stage.Bool("is_won") || stage.Bool("is_lost") {
			return badRequest("Tahap Menang/Kalah tidak boleh dinonaktifkan")
		}
		open, err := scanID(ctx, h.db, `SELECT id::text FROM crm.crm_sales_deals
       WHERE stage_id = $1 AND deleted_at IS NULL AND closed_at IS NULL
       LIMIT 1`, id)
		if err != nil {
			return err
		}
		if open != nil {
			return badRequest("Masih ada deal berjalan di tahap ini — pindahkan dulu sebelum menonaktifkan")
		}
	}
	set := domain.NewUpdateSet()
	body.Each(func(k string, v any) { set.Set(k, v, "") })
	sql, values, idParam, okSet := set.Build(id)
	if !okSet {
		return badRequest(domain.NoFieldsChanged)
	}
	row, err := pgrow.QueryOne(ctx, h.db, `UPDATE crm.crm_sales_stages SET `+sql+`
     WHERE id = `+idParam+`
     RETURNING id, code, name, sort_order, is_won, is_lost,
               stuck_threshold_days, is_active`, values...)
	if err != nil {
		return err
	}
	return okMsg(w, row, "Tahap diperbarui")
}
