package salesfunnel

import (
	"context"
	"math"
	"net/http"
	"regexp"
	"strconv"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/members"
	"nuhabit/backend/internal/platform/validate"
)

// Forecast and targets (forecast-server.ts), the funnel report
// (reports-server.ts) and the record timeline (timeline-server.ts).

func (h *handler) month(r *http.Request) (string, error) {
	m, valid := domain.ParseMonth(query(r, "month"), h.now())
	if !valid {
		return "", badRequest("month: YYYY-MM")
	}
	return m, nil
}

func (h *handler) forecast(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	s, err := h.salesScope(ctx, u)
	if err != nil {
		return err
	}
	month, err := h.month(r)
	if err != nil {
		return err
	}
	var pipelineID *string
	if p := queryStr(r, "pipeline_id"); domain.IsUUID(p) {
		pipelineID = &p
	}
	from, to := domain.MonthRange(month)
	params := []any{from, to, s.CompanyID}
	extra := ""
	if pipelineID != nil {
		params = append(params, *pipelineID)
		extra += " AND d.pipeline_id = $4"
	}
	isSales := u.Role == "sales"
	if isSales {
		params = append(params, u.ID)
		extra += " AND (d.owner_user_id = $" + itoa(len(params)) + " OR d.owner_user_id IS NULL)"
	}
	deals, err := pgrow.Query(ctx, h.db, `SELECT d.id AS deal_id, d.title, l.org_name, d.owner_user_id, u.full_name AS owner_name, d.pipeline_id,
            COALESCE(d.value_final, d.value_estimate, 0)::numeric AS value,
            s.probability, s.name AS stage_name, d.event_date::text AS event_date,
            CASE WHEN s.is_won THEN 'closed_won' WHEN s.is_lost THEN 'closed_lost' ELSE d.forecast_category END AS category
     FROM crm.crm_sales_deals d
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     JOIN crm.crm_sales_stages s ON s.id = d.stage_id
     LEFT JOIN configuration.users u ON u.id = d.owner_user_id
     WHERE d.deleted_at IS NULL
       AND ($3::uuid IS NULL OR d.company_id = $3)
       AND (
         (s.is_won AND d.closed_at >= $1::date AND d.closed_at < $2::date)
         OR (NOT s.is_won AND NOT s.is_lost AND COALESCE(d.event_date, d.created_at::date) >= $1::date AND COALESCE(d.event_date, d.created_at::date) < $2::date)
       )`+extra+`
     ORDER BY d.event_date NULLS LAST`, params...)
	if err != nil {
		return err
	}
	targetRows, err := pgrow.Query(ctx, h.db, `SELECT user_id, target_value, target_deals FROM crm.crm_sales_targets
     WHERE period_month = $1::date AND ($2::uuid IS NULL OR company_id = $2)
       AND ($3::uuid IS NULL OR pipeline_id IS NULL OR pipeline_id = $3)`, from, s.CompanyID, pipelineID)
	if err != nil {
		return err
	}
	var only *string
	if isSales {
		only = &u.ID
	}
	users, err := h.ports.Directory.ForecastUsers(ctx, h.db, s.CompanyID, only)
	if err != nil {
		return err
	}
	targets := make([]domain.Target, len(targetRows))
	for i, t := range targetRows {
		targets[i] = domain.Target{UserID: t.StrPtr("user_id"), TargetValue: t.Num("target_value")}
		if n, ok := t.Get("target_deals").(int64); ok {
			targets[i].TargetDeals = &n
		}
	}
	company, _ := domain.SplitTargets(targets)
	forecastDeals := make([]domain.ForecastDeal, len(deals))
	dealRows := make([]*pgrow.Row, len(deals))
	for i, d := range deals {
		forecastDeals[i] = domain.ForecastDeal{OwnerUserID: d.StrPtr("owner_user_id"), OwnerName: d.StrPtr("owner_name"),
			Value: d.Num("value"), Probability: d.Num("probability"), Category: d.Str("category")}
		dealRows[i] = pgrow.New("id", d.Get("deal_id"), "title", d.Get("title"), "org_name", d.Get("org_name"),
			"owner_user_id", d.Get("owner_user_id"), "owner_name", d.Get("owner_name"), "value", jsNum(d.Num("value")),
			"probability", d.Get("probability"), "category", d.Get("category"), "stage_name", d.Get("stage_name"),
			"event_date", d.Get("event_date"), "pipeline_id", d.Get("pipeline_id"))
	}
	rows := domain.AggregateForecast(forecastDeals, targets, users)
	return ok(w, pgrow.New("month", month, "rows", rows, "company_target", company,
		"total", domain.SumForecast(rows, company), "deals", dealRows))
}

// jsNum is a number JSON.stringify writes as null when NaN.
func jsNum(f float64) any {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return nil
	}
	return f
}

func itoa(n int) string { return strconv.Itoa(n) }

func (h *handler) listTargets(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	s, err := h.salesScope(ctx, u)
	if err != nil {
		return err
	}
	month, err := h.month(r)
	if err != nil {
		return err
	}
	from, _ := domain.MonthRange(month)
	sql := `SELECT t.id, t.user_id, u.full_name, t.period_month::text AS period_month, t.target_value, t.target_deals, t.pipeline_id
     FROM crm.crm_sales_targets t LEFT JOIN configuration.users u ON u.id = t.user_id
     WHERE t.period_month = $1::date AND ($2::uuid IS NULL OR t.company_id = $2)`
	params := []any{from, s.CompanyID}
	if u.Role == "sales" {
		sql += ` AND (t.user_id = $3 OR t.user_id IS NULL)`
		params = append(params, u.ID)
	}
	rows, err := pgrow.Query(ctx, h.db, sql+`
     ORDER BY t.user_id IS NOT NULL, u.full_name`, params...)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

var monthRe = regexp.MustCompile(`^\d{4}-\d{2}$`)

func (h *handler) saveTargets(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	if u.Role == "sales" {
		return httpx.Forbidden("Target ditetapkan admin/super admin")
	}
	ctx := r.Context()
	s, err := h.salesScope(ctx, u)
	if err != nil {
		return err
	}
	companyID, _, err := h.venue(ctx, s)
	if err != nil {
		return err
	}
	if companyID == nil {
		return badRequest("Venue belum dikonfigurasi")
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	type target struct {
		userID, month, pipelineID any
		value                     float64
		deals                     any
	}
	var targets []target
	items := f.List("targets", validate.Rule{}, 200, func(sub *validate.Form, i int, v any) {
		it := sub.Item(i, v)
		t := target{userID: ptrAny(it.UUID("user_id", nullReq))}
		t.month = str(it.Str("period_month", validate.Rule{}, validate.StrOpts{Check: regexCheck(monthRe, "", "format YYYY-MM")}))
		if n := it.Num("target_value", validate.Rule{}, numRange(0, maxValue)); n != nil {
			t.value = *n
		}
		t.deals = intOrNull(it.Int("target_deals", optNull, numRange(0, 10_000)))
		t.pipelineID = ptrAny(it.UUID("pipeline_id", optNull))
		targets = append(targets, t)
	})
	if items != nil && len(items) < 1 {
		f.Fail("targets", "too_small", "Too small: expected array to have >=1 items")
	}
	if err := validationErr(f); err != nil {
		return err
	}
	for _, t := range targets {
		from, _ := domain.MonthRange(t.month.(string))
		if _, err := h.db.Exec(ctx, `INSERT INTO crm.crm_sales_targets (company_id, user_id, period_month, target_value, target_deals, pipeline_id, created_by)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7)
       ON CONFLICT (company_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), period_month, COALESCE(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET target_value = EXCLUDED.target_value, target_deals = EXCLUDED.target_deals, updated_at = now()`,
			*companyID, t.userID, from, t.value, t.deals, t.pipelineID, u.ID); err != nil {
			return err
		}
	}
	return okMsg(w, pgrow.New("saved", len(targets)), itoa(len(targets))+" target disimpan")
}

/* ── Funnel report (Fase E) ──────────────────────────────────────────── */

func (h *handler) report(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	s, err := h.salesScope(ctx, u)
	if err != nil {
		return err
	}
	period := domain.ResolveReportPeriod(queryStr(r, "from"), queryStr(r, "to"), h.now())
	periodScope, scopeParams := domain.DealScopeSQL(u.ID, u.Role, s, 3)
	periodParams := append([]any{period.From, period.To}, scopeParams...)
	createdIn := `
    d.deleted_at IS NULL
    AND d.created_at >= $1::date AND d.created_at < ($2::date + 1)
    ` + periodScope
	closedIn := `
    d.deleted_at IS NULL
    AND d.closed_at >= $1::date AND d.closed_at < ($2::date + 1)
    ` + periodScope
	nowScope, nowParams := domain.DealScopeSQL(u.ID, u.Role, s, 1)

	breakdown := func(key, join, tail string) ([]*pgrow.Row, error) {
		leadJoin, ownerJoin := "", ""
		switch join {
		case "lead":
			leadJoin = "JOIN crm.crm_sales_leads l ON l.id = d.lead_id"
		case "owner":
			ownerJoin = "LEFT JOIN configuration.users u ON u.id = d.owner_user_id"
		}
		return pgrow.Query(ctx, h.db, `SELECT `+key+` AS key, COUNT(*) AS total,
              COUNT(*) FILTER (WHERE s.is_won) AS won,
              SUM(d.value_final) FILTER (WHERE s.is_won) AS won_value
       FROM crm.crm_sales_deals d
       `+leadJoin+`
       JOIN crm.crm_sales_stages s ON s.id = d.stage_id
       `+ownerJoin+`
       WHERE `+createdIn+`
       GROUP BY `+key+` `+tail, periodParams...)
	}
	funnel, err := pgrow.Query(ctx, h.db, `SELECT s.id, s.name, s.code, s.sort_order, s.is_won,
                COUNT(DISTINCT h.deal_id) AS reached
         FROM crm.crm_sales_stages s
         LEFT JOIN crm.crm_sales_deal_stage_history h ON h.stage_id = s.id
           AND h.deal_id IN (
             SELECT d.id FROM crm.crm_sales_deals d WHERE `+createdIn+`
           )
         WHERE s.is_active = true AND s.is_lost = false
         GROUP BY s.id, s.name, s.code, s.sort_order, s.is_won
         ORDER BY s.sort_order ASC`, periodParams...)
	if err != nil {
		return err
	}
	closed, err := pgrow.QueryOne(ctx, h.db, `SELECT COUNT(*) FILTER (WHERE s.is_won) AS won,
                COUNT(*) FILTER (WHERE s.is_lost) AS lost,
                SUM(d.value_final) FILTER (WHERE s.is_won) AS won_value
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         WHERE `+closedIn, periodParams...)
	if err != nil {
		return err
	}
	createdTotal, err := pgrow.QueryOne(ctx, h.db, `SELECT COUNT(*) AS total FROM crm.crm_sales_deals d
         WHERE `+createdIn, periodParams...)
	if err != nil {
		return err
	}
	pipelineNow, err := pgrow.QueryOne(ctx, h.db, `SELECT COUNT(*) AS open_count,
                SUM(COALESCE(d.value_final, d.value_estimate)) AS pipeline_value
         FROM crm.crm_sales_deals d
         WHERE d.deleted_at IS NULL AND d.closed_at IS NULL `+nowScope, nowParams...)
	if err != nil {
		return err
	}
	out := pgrow.New("period", period, "funnel", funnel, "summary", pgrow.New(
		"total_created", rowVal(createdTotal, "total"),
		"won", rowVal(closed, "won"),
		"lost", rowVal(closed, "lost"),
		"won_value", rowVal(closed, "won_value"),
		"open_count", rowVal(pipelineNow, "open_count"),
		"pipeline_value", rowVal(pipelineNow, "pipeline_value"),
	))
	for _, k := range []string{"total_created", "won", "lost", "open_count"} {
		summary := out.Get("summary").(*pgrow.Row)
		summary.Set(k, pgrow.ToNumber(summary.Get(k)))
	}
	for _, b := range []struct{ name, key, join, tail string }{
		{"by_org_type", "l.org_type", "lead", "ORDER BY total DESC"},
		{"by_event_type", "d.event_type", "", "ORDER BY total DESC"},
		{"by_source", "l.source", "lead", "ORDER BY total DESC"},
		{"by_owner", "COALESCE(u.full_name, 'Tanpa PJ')", "owner", "ORDER BY won DESC, total DESC LIMIT 15"},
	} {
		rows, err := breakdown(b.key, b.join, b.tail)
		if err != nil {
			return err
		}
		out.Set(b.name, rows)
	}
	upcoming, err := pgrow.Query(ctx, h.db, `SELECT d.id, d.title, d.event_type, d.event_date, d.pax_estimate,
                d.value_final, l.org_name, l.pic_name, l.pic_phone
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_leads l ON l.id = d.lead_id
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         WHERE d.deleted_at IS NULL AND s.is_won = true
           AND d.event_date >= CURRENT_DATE `+nowScope+`
         ORDER BY d.event_date ASC
         LIMIT 20`, nowParams...)
	if err != nil {
		return err
	}
	lost, err := pgrow.Query(ctx, h.db, `SELECT COALESCE(lr.name, 'Tanpa alasan') AS key, COUNT(*) AS total
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = d.lost_reason_id
         WHERE s.is_lost = true AND `+closedIn+`
         GROUP BY COALESCE(lr.name, 'Tanpa alasan')
         ORDER BY total DESC`, periodParams...)
	if err != nil {
		return err
	}
	out.Set("upcoming_events", upcoming)
	out.Set("lost_reasons", lost)
	return ok(w, out)
}

/* ── Record timeline (EPIC-050 T-1.4) ────────────────────────────────── */

func (h *handler) timeline(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	subjectType, subjectID := queryStr(r, "subject_type"), queryStr(r, "subject_id")
	limit := math.Min(300, math.Max(10, domain.OrDefault(domain.JSNumber(queryStr(r, "limit")), 100)))
	if !domain.Contains(domain.TaskSubjectTypes, subjectType) || !domain.IsUUID(subjectID) {
		return badRequest("subject_type & subject_id wajib")
	}
	ctx := r.Context()
	if _, err := h.requireSubject(ctx, subjectType, subjectID, u); err != nil {
		return err
	}
	events, err := h.loadTimeline(ctx, subjectType, subjectID, int(limit))
	if err != nil {
		return err
	}
	return ok(w, events)
}

func jsDate(v any) any {
	if t, ok := v.(pgrow.JSTime); ok {
		return domain.JSDate(t)
	}
	return v
}

func (h *handler) loadTimeline(ctx context.Context, subjectType, id string, limit int) ([]domain.TimelineEvent, error) {
	sc := domain.TimelineScopeSQL(subjectType)
	dealIDs := `SELECT d.id FROM crm.crm_sales_deals d WHERE d.deleted_at IS NULL AND ` + sc.DealWhere
	var src domain.TimelineSources
	tasks, err := pgrow.Query(ctx, h.db, `SELECT a.id, a.activity_type, a.title, a.notes, a.due_at, a.done_at, a.status,
            a.priority, a.created_at, u.full_name AS owner_name, d.title AS deal_title
     FROM crm.crm_sales_activities a
     LEFT JOIN configuration.users u ON u.id = a.owner_user_id
     LEFT JOIN crm.crm_sales_deals d ON d.id = a.deal_id
     WHERE a.deleted_at IS NULL
       AND (`+sc.TaskExtra+`
            OR a.deal_id IN (`+dealIDs+`)
            OR a.lead_id IN (SELECT l.id FROM crm.crm_sales_leads l WHERE l.deleted_at IS NULL AND `+sc.LeadWhere+`))
     ORDER BY COALESCE(a.done_at, a.due_at, a.created_at) DESC
     LIMIT 200`, id)
	if err != nil {
		return nil, err
	}
	for _, t := range tasks {
		src.Tasks = append(src.Tasks, domain.TimelineTask{ID: t.Str("id"), ActivityType: t.Str("activity_type"), Status: t.Str("status"),
			Priority: t.Str("priority"), Title: t.StrPtr("title"), Notes: t.StrPtr("notes"), OwnerName: t.StrPtr("owner_name"),
			DealTitle: t.StrPtr("deal_title"), DueAt: jsDate(t.Get("due_at")), DoneAt: jsDate(t.Get("done_at")), CreatedAt: jsDate(t.Get("created_at"))})
	}
	if subjectType != "member" {
		stages, err := pgrow.Query(ctx, h.db, `SELECT h.id, h.deal_id, d.title AS deal_title, s.name AS stage_name, h.entered_at,
              u.full_name AS actor_name
       FROM crm.crm_sales_deal_stage_history h
       JOIN crm.crm_sales_deals d ON d.id = h.deal_id
       JOIN crm.crm_sales_stages s ON s.id = h.stage_id
       LEFT JOIN configuration.users u ON u.id = h.created_by
       WHERE h.deal_id IN (`+dealIDs+`)
       ORDER BY h.entered_at DESC LIMIT 100`, id)
		if err != nil {
			return nil, err
		}
		for _, s := range stages {
			src.Stages = append(src.Stages, domain.TimelineStage{ID: s.Str("id"), DealID: s.Str("deal_id"), DealTitle: s.Str("deal_title"),
				StageName: s.Str("stage_name"), EnteredAt: jsDate(s.Get("entered_at")), ActorName: s.StrPtr("actor_name")})
		}
		quotations, err := pgrow.Query(ctx, h.db, `SELECT q.id, q.deal_id, q.quote_number, q.status, q.total, q.created_at
       FROM crm.crm_sales_quotations q
       WHERE q.deleted_at IS NULL AND q.deal_id IN (`+dealIDs+`)
       ORDER BY q.created_at DESC LIMIT 50`, id)
		if err != nil {
			return nil, err
		}
		for _, q := range quotations {
			src.Quotations = append(src.Quotations, domain.TimelineQuotation{ID: q.Str("id"), DealID: q.Str("deal_id"),
				QuoteNumber: q.Str("quote_number"), Status: q.Str("status"), Total: domain.ToNumber(q.Get("total")), CreatedAt: jsDate(q.Get("created_at"))})
		}
		invoices, err := pgrow.Query(ctx, h.db, `SELECT i.id, i.deal_id, i.invoice_number, i.label, i.status, i.amount, i.created_at
       FROM crm.crm_sales_invoices i
       WHERE i.deleted_at IS NULL AND i.deal_id IN (`+dealIDs+`)
       ORDER BY i.created_at DESC LIMIT 50`, id)
		if err != nil {
			return nil, err
		}
		for _, i := range invoices {
			src.Invoices = append(src.Invoices, domain.TimelineInvoice{ID: i.Str("id"), DealID: i.Str("deal_id"), InvoiceNumber: i.Str("invoice_number"),
				Status: i.Str("status"), Label: i.StrPtr("label"), Amount: domain.ToNumber(i.Get("amount")), CreatedAt: jsDate(i.Get("created_at"))})
		}
		if subjectType == "account" || subjectType == "contact" {
			leads, err := pgrow.Query(ctx, h.db, `SELECT l.id, l.org_name, l.status, l.created_at, u.full_name AS owner_name
         FROM crm.crm_sales_leads l LEFT JOIN configuration.users u ON u.id = l.owner_user_id
         WHERE l.deleted_at IS NULL AND `+sc.LeadWhere+`
         ORDER BY l.created_at DESC LIMIT 50`, id)
			if err != nil {
				return nil, err
			}
			for _, l := range leads {
				src.Leads = append(src.Leads, domain.TimelineLead{ID: l.Str("id"), OrgName: l.Str("org_name"), Status: l.Str("status"),
					CreatedAt: jsDate(l.Get("created_at")), OwnerName: l.StrPtr("owner_name")})
			}
		}
		if subjectType != "deal" {
			deals, err := pgrow.Query(ctx, h.db, `SELECT d.id, d.title, s.name AS stage_name, d.created_at, u.full_name AS owner_name
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         LEFT JOIN configuration.users u ON u.id = d.owner_user_id
         WHERE d.deleted_at IS NULL AND `+sc.DealWhere+`
         ORDER BY d.created_at DESC LIMIT 50`, id)
			if err != nil {
				return nil, err
			}
			for _, d := range deals {
				src.Deals = append(src.Deals, domain.TimelineDeal{ID: d.Str("id"), Title: d.Str("title"), StageName: d.Str("stage_name"),
					CreatedAt: jsDate(d.Get("created_at")), OwnerName: d.StrPtr("owner_name")})
			}
		}
	}
	phones, err := h.subjectPhones(ctx, subjectType, id)
	if err != nil {
		return nil, err
	}
	if suffixes := domain.PhoneSuffixes(phones); len(suffixes) > 0 {
		msgs, err := h.ports.CRM.WaMessages(ctx, h.db, suffixes)
		if err != nil {
			return nil, err
		}
		for _, m := range msgs {
			src.WaMessages = append(src.WaMessages, domain.TimelineWa{ID: m.Str("id"), Direction: m.Str("direction"), Body: m.StrPtr("body"),
				Status: m.StrPtr("status"), SenderName: m.StrPtr("sender_name"), CreatedAt: jsDate(m.Get("created_at"))})
		}
	}
	return domain.MergeTimeline(src, limit), nil
}

// subjectPhones is loadSubjectPhones.
func (h *handler) subjectPhones(ctx context.Context, subjectType, id string) ([]string, error) {
	single := func(sql string) ([]string, error) {
		phone, err := scanNullable(ctx, h.db, sql, id)
		if err != nil || phone == nil || *phone == "" {
			return nil, err
		}
		return []string{*phone}, nil
	}
	switch subjectType {
	case "lead":
		return single(`SELECT pic_phone FROM crm.crm_sales_leads WHERE id = $1`)
	case "deal":
		return single(`SELECT l.pic_phone FROM crm.crm_sales_deals d JOIN crm.crm_sales_leads l ON l.id = d.lead_id WHERE d.id = $1`)
	case "contact":
		return single(`SELECT phone FROM crm.crm_contacts WHERE id = $1`)
	case "member":
		m, err := members.Get(ctx, h.db, id)
		if err != nil || m == nil || m.Phone == "" {
			return nil, err
		}
		return []string{m.Phone}, nil
	}
	rows, err := pgrow.Query(ctx, h.db, `SELECT phone FROM crm.crm_contacts WHERE account_id = $1 AND deleted_at IS NULL LIMIT 20`, id)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, row := range rows {
		out = append(out, row.Str("phone"))
	}
	return out, nil
}
