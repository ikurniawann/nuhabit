package salesfunnel

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
	"nuhabit/backend/internal/platform/whatsapp"
)

// lib/sales-funnel/deals-server.ts and deals.ts

const dealColumns = `
  d.id, d.company_id, d.branch_id, d.lead_id, d.title, d.event_type,
  d.event_date, d.is_event_date_fixed, d.pax_estimate, d.stage_id,
  d.value_estimate, d.value_final, d.owner_user_id, d.lost_reason_id,
  d.entered_stage_at, d.closed_at, d.created_at, d.updated_at,
  d.pipeline_id, d.forecast_category, d.custom, s.probability, s.name AS stage_name,
  l.org_name, l.org_type, l.pic_name, l.pic_phone, l.customer_id,
  s.code AS stage_code, s.is_won, s.is_lost, s.stuck_threshold_days,
  u.full_name AS owner_name, lr.name AS lost_reason_name`

const maxValue = 99_999_999_999

func (h *handler) listDeals(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	s, err := h.salesScope(r.Context(), u)
	if err != nil {
		return err
	}
	q := domain.JSTrim(queryStr(r, "q"))
	where := domain.NewWhere([]string{
		"d.deleted_at IS NULL",
		"(d.closed_at IS NULL OR d.closed_at >= now() - interval '90 days')",
	}, 1)
	domain.ScopeConditions(where, "d", u.ID, u.Role, s)
	if et := queryStr(r, "event_type"); domain.Contains(domain.DealEventTypes, et) {
		where.Add("d.event_type = ?", et)
	}
	if owner := queryStr(r, "owner_user_id"); domain.IsUUID(owner) {
		where.Add("d.owner_user_id = ?", owner)
	}
	if pipeline := queryStr(r, "pipeline_id"); domain.IsUUID(pipeline) {
		where.Add("d.pipeline_id = ?", pipeline)
	}
	if q != "" {
		like := where.Param("%" + q + "%")
		where.Push("(d.title ILIKE " + like + " OR l.org_name ILIKE " + like + " OR l.pic_name ILIKE " + like + ")")
	}
	rows, err := pgrow.Query(r.Context(), h.db, `SELECT `+dealColumns+`
     FROM crm.crm_sales_deals d
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     JOIN crm.crm_sales_stages s ON s.id = d.stage_id
     LEFT JOIN configuration.users u ON u.id = d.owner_user_id
     LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = d.lost_reason_id
     WHERE `+where.SQL()+`
     ORDER BY d.entered_stage_at DESC
     LIMIT 500`, where.Params...)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

// dateOrEmpty is `isoDate.optional().nullable().or(z.literal(""))`.
func dateOrEmpty(f *validate.Form, key string) (*string, bool) {
	return orEmpty(f, key, func(f *validate.Form, v any) string {
		s, _ := f.CheckString(key, v, validate.StrOpts{Check: isoDateCheck})
		return s
	})
}

// calendarOrEmpty is `calendarDate.optional().nullable().or(z.literal(""))`.
func calendarOrEmpty(f *validate.Form, key string) (*string, bool) {
	return orEmpty(f, key, func(f *validate.Form, v any) string {
		s, _ := calendarDate(f, key, v)
		return s
	})
}

func (h *handler) createDeal(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	leadID := str(f.UUID("lead_id", validate.Rule{}))
	title := str(f.Str("title", validate.Rule{}, trimRange(1, 200)))
	eventType := enumDefault(f, "event_type", domain.DealEventTypes, "lainnya")
	eventDate, _ := dateOrEmpty(f, "event_date")
	fixed := f.BoolDefault("is_event_date_fixed", false)
	pax := f.Int("pax_estimate", optNull, numRange(1, 100000))
	estimate := f.Num("value_estimate", optNull, numRange(0, maxValue))
	owner := f.UUID("owner_user_id", optNull)
	pipelineID := f.UUID("pipeline_id", optNull)
	custom, _ := record(f, "custom")
	if err := validationErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	s, err := h.salesScope(ctx, u)
	if err != nil {
		return err
	}
	lead, err := pgrow.QueryOne(ctx, h.db, `SELECT id, company_id, branch_id, owner_user_id, status, org_name
     FROM crm.crm_sales_leads WHERE id = $1 AND deleted_at IS NULL`, leadID)
	if err != nil {
		return err
	}
	if lead == nil {
		return httpx.NotFound("Lead tidak ditemukan")
	}
	venue := domain.Venue{CompanyID: lead.Str("company_id"), BranchID: lead.Str("branch_id"), OwnerUserID: lead.StrPtr("owner_user_id")}
	if (s.HasCompany() && venue.CompanyID != *s.CompanyID) || (s.IsBranch() && venue.BranchID != *s.BranchID) ||
		(u.Role == "sales" && venue.OwnerUserID != nil && *venue.OwnerUserID != u.ID) {
		return httpx.Forbidden("")
	}
	if str(eventDate) != "" && !domain.IsValidCalendarDate(*eventDate) {
		return badRequest("Tanggal acara tidak valid")
	}
	if err := h.assertOwner(ctx, u, ptrAny(owner), venue.CompanyID); err != nil {
		return err
	}
	var pipeline *string
	if str(pipelineID) != "" {
		pipeline, err = scanID(ctx, h.db, `SELECT id::text FROM crm.crm_pipelines WHERE id = $1 AND is_active`, *pipelineID)
	} else {
		pipeline, err = scanID(ctx, h.db, `SELECT id::text FROM crm.crm_pipelines WHERE is_active ORDER BY is_default DESC, sort_order LIMIT 1`)
	}
	if err != nil {
		return err
	}
	if pipeline == nil {
		return badRequest("Pipeline tidak ditemukan / nonaktif")
	}
	customJSON, err := h.resolveCustom(ctx, "deal", &venue.CompanyID, custom, nil, false)
	if err != nil {
		return err
	}
	var stageID string
	var probability float64
	err = h.db.QueryRow(ctx, `SELECT id::text, probability::float8 FROM crm.crm_sales_stages
     WHERE is_active = true AND is_won = false AND is_lost = false AND pipeline_id = $1
     ORDER BY sort_order ASC LIMIT 1`, *pipeline).Scan(&stageID, &probability)
	if database.IsNoRows(err) {
		return badRequest("Tidak ada tahap pipeline aktif")
	}
	if err != nil {
		return err
	}
	ownerValue := orNull(owner)
	if ownerValue == nil {
		if u.Role == "sales" {
			ownerValue = u.ID
		} else {
			ownerValue = ptrAny(venue.OwnerUserID)
		}
	}
	var row *pgrow.Row
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		row, err = pgrow.QueryOne(ctx, tx, `INSERT INTO crm.crm_sales_deals
         (company_id, branch_id, lead_id, title, event_type, event_date,
          is_event_date_fixed, pax_estimate, value_estimate, stage_id,
          owner_user_id, created_by, pipeline_id, forecast_category, custom)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::text::jsonb)
       RETURNING id, title, stage_id`,
			venue.CompanyID, venue.BranchID, leadID, title, eventType, orNull(eventDate), fixed, intOrNull(pax), numOrNull(estimate),
			stageID, ownerValue, u.ID, *pipeline, domain.CategoryFromStage(domain.StageFlags{Probability: probability}), customJSON)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO crm.crm_sales_deal_stage_history (deal_id, stage_id, created_by) VALUES ($1, $2, $3)`,
			row.Str("id"), stageID, u.ID); err != nil {
			return err
		}
		if status := lead.Str("status"); status == "baru" || status == "dihubungi" {
			if _, err := tx.Exec(ctx, `UPDATE crm.crm_sales_leads SET status = 'qualified', updated_at = now() WHERE id = $1`, leadID); err != nil {
				return err
			}
		}
		return emit(ctx, tx, crmEvent{eventType: "deal.created", subjectType: "deal", subjectID: row.Str("id"),
			companyID: venue.CompanyID, branchID: venue.BranchID, actorID: u.ID,
			payload: map[string]any{"title": row.Get("title"), "event_type": eventType}})
	})
	if err != nil {
		return err
	}
	return created(w, row, "Deal untuk "+lead.Str("org_name")+" berhasil dibuat")
}

func intOrNull(n *int) any {
	if n == nil {
		return nil
	}
	return *n
}

// parseUpdateDeal is updateDealSchema (custom last, as declared).
func parseUpdateDeal(f *validate.Form) (*domain.Fields, map[string]any, bool) {
	body := domain.NewFields()
	patchStr(f, body, "title", false, trimRange(1, 200))
	patchEnum(f, body, "event_type", domain.DealEventTypes)
	if v, present := dateOrEmpty(f, "event_date"); present {
		body.Set("event_date", ptrAny(v))
	}
	patchBool(f, body, "is_event_date_fixed")
	if has(f, "pax_estimate") {
		if n := f.Int("pax_estimate", optNull, numRange(1, 100000)); n != nil {
			body.Set("pax_estimate", *n)
		} else {
			body.Set("pax_estimate", nil)
		}
	}
	patchNum(f, body, "value_estimate", true, numRange(0, maxValue))
	patchNum(f, body, "value_final", true, numRange(0, maxValue))
	for _, k := range []string{"owner_user_id", "stage_id", "lost_reason_id"} {
		if has(f, k) {
			rule := optNull
			if k == "stage_id" {
				rule = opt
			}
			body.Set(k, ptrAny(f.UUID(k, rule)))
		}
	}
	patchEnum(f, body, "forecast_category", domain.ForecastCategories)
	custom, hasCustom := record(f, "custom")
	return body, custom, hasCustom
}

func (h *handler) updateDeal(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	deal, err := h.require(ctx, "deal", id, u)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	body, custom, hasCustom := parseUpdateDeal(f)
	if err := validationErr(f); err != nil {
		return err
	}
	if body.Has("event_date") && body.Get("event_date") == "" {
		body.Set("event_date", nil)
	}
	if d, _ := body.Get("event_date").(string); d != "" && !domain.IsValidCalendarDate(d) {
		return badRequest("Tanggal acara tidak valid")
	}
	if err := h.assertOwner(ctx, u, body.Get("owner_user_id"), deal.CompanyID); err != nil {
		return err
	}
	set := domain.NewUpdateSet()
	toStage, _ := body.Get("stage_id").(string)
	isStageMove := body.Has("stage_id") && toStage != deal.StageID
	if isStageMove {
		stage, err := pgrow.QueryOne(ctx, h.db, `SELECT is_won, is_lost, is_active, pipeline_id, probability FROM crm.crm_sales_stages WHERE id = $1`, toStage)
		if err != nil {
			return err
		}
		if stage == nil || !stage.Bool("is_active") {
			return badRequest("Tahap tujuan tidak valid")
		}
		current, err := scanNullable(ctx, h.db, `SELECT pipeline_id::text FROM crm.crm_sales_deals WHERE id = $1`, deal.ID)
		if err != nil {
			return err
		}
		if p := stage.Str("pipeline_id"); p != "" && current != nil && p != *current {
			set.Set("pipeline_id", p, "")
		}
		columns, err := domain.PlanStageMove(domain.StageFlags{IsWon: stage.Bool("is_won"), IsLost: stage.Bool("is_lost"), Probability: stage.Num("probability")},
			body, deal.ValueFinal, deal.EventDate, pgrow.ISO(h.now()))
		if err != nil {
			return badRequest(err.Error())
		}
		columns.Each(func(k string, v any) { set.Set(k, v, "") })
	}
	if hasCustom {
		existing, err := h.existingCustom(ctx, "crm.crm_sales_deals", deal.ID)
		if err != nil {
			return err
		}
		merged, err := h.resolveCustom(ctx, "deal", &deal.CompanyID, custom, existing, true)
		if err != nil {
			return err
		}
		set.Set("custom", merged, "::text::jsonb")
	}
	body.Each(func(k string, v any) { set.Set(k, v, "") })
	sql, values, idParam, okSet := set.Build(deal.ID)
	if !okSet {
		return badRequest(domain.NoFieldsChanged)
	}
	var row *pgrow.Row
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		row, err = pgrow.QueryOne(ctx, tx, `UPDATE crm.crm_sales_deals SET `+sql+`
       WHERE id = `+idParam+`
       RETURNING id, title, stage_id, closed_at`, values...)
		if err != nil {
			return err
		}
		if isStageMove {
			if _, err := tx.Exec(ctx, `INSERT INTO crm.crm_sales_deal_stage_history (deal_id, stage_id, created_by) VALUES ($1, $2, $3)`,
				deal.ID, toStage, u.ID); err != nil {
				return err
			}
		}
		ev := crmEvent{subjectType: "deal", subjectID: deal.ID, companyID: deal.CompanyID, branchID: deal.BranchID, actorID: u.ID}
		if isStageMove {
			to, err := pgrow.QueryOne(ctx, tx, `SELECT code, name, is_won, is_lost FROM crm.crm_sales_stages WHERE id = $1`, toStage)
			if err != nil {
				return err
			}
			code, name, won, lost := rowVal(to, "code"), rowVal(to, "name"), rowVal(to, "is_won"), rowVal(to, "is_lost")
			ev.eventType = "deal.stage_changed"
			ev.payload = map[string]any{"from_stage_id": deal.StageID, "to_stage_id": toStage, "to_stage": code,
				"to_stage_name": name, "is_won": won, "is_lost": lost}
			ev.changes = map[string]any{"stage_id": map[string]any{"from": deal.StageID, "to": toStage}, "stage_code": map[string]any{"to": code}}
		} else {
			ev.eventType = "deal.updated"
			ev.payload = map[string]any{"changed_fields": body.Keys()}
		}
		return emit(ctx, tx, ev)
	})
	if err != nil {
		return err
	}
	return okMsg(w, row, "Deal diperbarui")
}

// rowVal is row?.[key] (undefined, dropped from JSON, when row is nil).
func rowVal(row *pgrow.Row, key string) any {
	if row == nil {
		return nil
	}
	return row.Get(key)
}

// scanNullable returns a nullable first column of the first row.
func scanNullable(ctx context.Context, q database.Querier, sql string, args ...any) (*string, error) {
	var v *string
	err := q.QueryRow(ctx, sql, args...).Scan(&v)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return v, err
}

func (h *handler) deleteDeal(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "deal", id, u); err != nil {
		return err
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_sales_deals SET deleted_at = now(), updated_at = now() WHERE id = $1`, id); err != nil {
		return err
	}
	return noContent(w)
}

/* ── Deal team ───────────────────────────────────────────────────────── */

var dealMemberRoles = []string{"owner", "support", "pre_sales", "account_manager", "finance"}

func (h *handler) listDealMembers(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "deal", id, u); err != nil {
		return err
	}
	rows, err := pgrow.Query(ctx, h.db, `SELECT m.id, m.user_id, m.role, m.split_percent, m.created_at, u.full_name, u.role AS user_role
     FROM crm.crm_deal_members m JOIN configuration.users u ON u.id = m.user_id
     WHERE m.deal_id = $1 ORDER BY m.created_at`, id)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) addDealMember(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	deal, err := h.require(ctx, "deal", id, u)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	userID := str(f.UUID("user_id", validate.Rule{}))
	role := enumDefault(f, "role", dealMemberRoles, "support")
	split := 0.0
	if n := f.Num("split_percent", validate.Rule{HasDefault: true}, numRange(0, 100)); n != nil {
		split = *n
	}
	if err := validationErr(f); err != nil {
		return err
	}
	msg, err := h.assignableOwnerError(ctx, userID, &deal.CompanyID)
	if err != nil {
		return err
	}
	if msg != "" {
		return badRequest(msg)
	}
	row, err := pgrow.QueryOne(ctx, h.db, `INSERT INTO crm.crm_deal_members (deal_id, user_id, role, split_percent, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (deal_id, user_id) DO UPDATE SET role = EXCLUDED.role, split_percent = EXCLUDED.split_percent
     RETURNING id, user_id, role, split_percent`, deal.ID, userID, role, split, u.ID)
	if err != nil {
		return err
	}
	return created(w, row, "Anggota tim ditambahkan")
}

func (h *handler) removeDealMember(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "deal", id, u); err != nil {
		return err
	}
	memberID := queryStr(r, "member_id")
	if memberID == "" {
		return badRequest("member_id wajib")
	}
	if _, err := h.db.Exec(ctx, `DELETE FROM crm.crm_deal_members WHERE id = $1 AND deal_id = $2`, memberID, id); err != nil {
		return err
	}
	return noContent(w)
}

/* ── Quick WhatsApp to the deal's PIC (EPIC-022 Fase C) ─────────────── */

// assertWaCooldown is assertWaCooldown: one send per deal per 60 seconds.
func (h *handler) assertWaCooldown(ctx context.Context, dealID string) error {
	recent, err := scanID(ctx, h.db, `SELECT id::text FROM crm.crm_sales_activities
     WHERE deal_id = $1 AND activity_type = 'wa' AND deleted_at IS NULL
       AND created_at > now() - interval '60 seconds'
     LIMIT 1`, dealID)
	if err != nil {
		return err
	}
	if recent != nil {
		return tooMany("Tunggu sebentar — pesan ke PIC deal ini baru saja dikirim")
	}
	return nil
}

// sendWaText is sendWaText: a failed send is a 502 with the gateway reason.
func (h *handler) sendWaText(ctx context.Context, gw *whatsapp.Gateway, target, message string) (any, error) {
	res := gw.SendText(ctx, target, message)
	if !res.Success {
		reason := res.Reason
		if reason == "" {
			reason = "Gagal mengirim WA"
		}
		return nil, httpx.Status(http.StatusBadGateway, reason)
	}
	if res.MessageID == "" {
		return nil, nil
	}
	return res.MessageID, nil
}

func (h *handler) sendDealWa(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	deal, err := h.require(ctx, "deal", id, u)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	templateID := f.UUID("template_id", optNull)
	message := f.Str("message", optNull, trimMax(2000))
	if !aborted(f) && str(templateID) == "" && str(message) == "" {
		f.Fail(nil, "custom", "Pilih template atau tulis pesan")
	}
	if err := validationErr(f); err != nil {
		return err
	}
	gw := h.ports.Gateway.LoadGateway(ctx, h.db)
	if gw == nil {
		return httpx.Status(http.StatusServiceUnavailable, "WA gateway belum dikonfigurasi")
	}
	if err := h.assertWaCooldown(ctx, deal.ID); err != nil {
		return err
	}
	dc, err := pgrow.QueryOne(ctx, h.db, `SELECT d.event_type, d.event_date::text AS event_date, l.org_name, l.pic_name, l.pic_phone, b.name AS venue_name
     FROM crm.crm_sales_deals d
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN configuration.branches b ON b.id = d.branch_id
     WHERE d.id = $1`, deal.ID)
	if err != nil {
		return err
	}
	if dc == nil {
		return httpx.NotFound("Deal tidak ditemukan")
	}
	template := domain.JSTrim(str(message))
	if str(templateID) != "" {
		body, err := scanID(ctx, h.db, `SELECT body FROM crm.crm_sales_wa_templates WHERE id = $1 AND is_active = true`, *templateID)
		if err != nil {
			return err
		}
		if body == nil {
			return httpx.NotFound("Template tidak ditemukan")
		}
		template = *body
	}
	acara, okLabel := domain.EventTypeMessageLabels[dc.Str("event_type")]
	if !okLabel {
		acara = "acara"
	}
	tanggal := domain.FormatDateLong(dc.Str("event_date"), "")
	text := domain.RenderWaTemplate(template, map[string]*string{
		"pic": dc.StrPtr("pic_name"), "instansi": dc.StrPtr("org_name"), "acara": &acara,
		"tanggal_acara": &tanggal, "venue": dc.StrPtr("venue_name"),
	})
	if text == "" {
		return badRequest("Pesan kosong setelah render template")
	}
	target, err := requireValidPhone(dc.Str("pic_phone"), "No. WA PIC tidak valid")
	if err != nil {
		return err
	}
	messageID, err := h.sendWaText(ctx, gw, target, text)
	if err != nil {
		return err
	}
	picName := dc.Str("pic_name")
	if _, err := h.db.Exec(ctx, `INSERT INTO crm.crm_sales_activities
       (company_id, branch_id, deal_id, activity_type, notes, done_at, owner_user_id, created_by)
     VALUES ($1, $2, $3, 'wa', $4, now(), $5, $5)`,
		deal.CompanyID, deal.BranchID, deal.ID, "Kirim WA ke "+picName+": "+domain.SliceUTF16(text, 500), u.ID); err != nil {
		return err
	}
	return okMsg(w, pgrow.New("message_id", messageID), "Pesan terkirim ke "+picName)
}
