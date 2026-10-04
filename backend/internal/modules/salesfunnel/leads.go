package salesfunnel

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/members"
	"nuhabit/backend/internal/platform/validate"
)

// lib/sales-funnel/leads-server.ts

const (
	leadColumns = `
  l.id, l.company_id, l.branch_id, l.org_name, l.org_type, l.pic_name,
  l.pic_title, l.pic_phone, l.pic_email, l.city, l.source, l.temperature,
  l.status, l.notes, l.owner_user_id, l.customer_id, l.created_at,
  l.updated_at, l.score, l.account_id, l.contact_id, u.full_name AS owner_name`
	duplicateLead   = "Lead instansi ini dengan PIC yang sama sudah ada"
	invalidPicPhone = "No. WA PIC tidak valid"
)

// rethrowDuplicate maps the unique-index race to the duplicate 409.
func rethrowDuplicate(err error) error {
	if database.IsUniqueViolation(err) {
		return httpx.Conflict(duplicateLead)
	}
	return err
}

// paginate runs a COUNT(*) OVER() list and splits total_count off.
func paginate(ctx context.Context, q database.Querier, sql string, params []any, pg domain.Pagination) ([]*pgrow.Row, pageMeta, error) {
	rows, err := pgrow.Query(ctx, q, sql, params...)
	if err != nil {
		return nil, pageMeta{}, err
	}
	total := 0.0
	if len(rows) > 0 {
		total = rows[0].Num("total_count")
	}
	for _, row := range rows {
		row.Delete("total_count")
	}
	return rows, pageMeta{Page: pg.Page, Limit: pg.Limit, Total: total, TotalPages: pg.TotalPages(total)}, nil
}

func (h *handler) listLeads(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	s, err := h.salesScope(r.Context(), u)
	if err != nil {
		return err
	}
	q := domain.JSTrim(queryStr(r, "q"))
	sort := "l.created_at DESC"
	if queryStr(r, "sort") == "score" {
		sort = "l.score DESC, l.created_at DESC"
	}
	pg := domain.ParsePagination(queryStr(r, "page"), queryStr(r, "limit"))
	where := domain.NewWhere([]string{"l.deleted_at IS NULL"}, 1)
	domain.ScopeConditions(where, "l", u.ID, u.Role, s)
	for _, f := range []struct {
		col, key string
		allowed  []string
	}{
		{"l.status", "status", domain.LeadStatuses}, {"l.org_type", "org_type", domain.LeadOrgTypes},
		{"l.source", "source", domain.LeadSources}, {"l.temperature", "temperature", domain.LeadTemperatures},
	} {
		if v := queryStr(r, f.key); domain.Contains(f.allowed, v) {
			where.Add(f.col+" = ?", v)
		}
	}
	if owner := queryStr(r, "owner_user_id"); domain.IsUUID(owner) {
		where.Add("l.owner_user_id = ?", owner)
	}
	if q != "" {
		like := where.Param("%" + q + "%")
		where.Push("(l.org_name ILIKE " + like + " OR l.pic_name ILIKE " + like + " OR l.pic_phone ILIKE " + like + ")")
	}
	limit, offset := where.Param(domain.SQLNumber(pg.Limit)), where.Param(domain.SQLNumber(pg.Offset))
	rows, meta, err := paginate(r.Context(), h.db, `SELECT `+leadColumns+`, COUNT(*) OVER() AS total_count
     FROM crm.crm_sales_leads l
     LEFT JOIN configuration.users u ON u.id = l.owner_user_id
     WHERE `+where.SQL()+`
     ORDER BY `+sort+`
     LIMIT `+limit+` OFFSET `+offset, where.Params, pg)
	if err != nil {
		return err
	}
	return paginated(w, rows, meta)
}

// leadInput is createLeadSchema.
type leadInput struct {
	OrgName, OrgType, PicName, PicPhone string
	PicTitle, PicEmail, City, Notes     *string
	Source, Temperature, Status         string
	OwnerUserID                         *string
	Custom                              map[string]any
}

func parseCreateLead(f *validate.Form) leadInput {
	var in leadInput
	in.OrgName = str(f.Str("org_name", validate.Rule{}, trimRange(1, 200)))
	in.OrgType = enumDefault(f, "org_type", domain.LeadOrgTypes, "corporate")
	in.PicName = str(f.Str("pic_name", validate.Rule{}, trimRange(1, 150)))
	in.PicTitle = f.Str("pic_title", optNull, trimMax(100))
	in.PicPhone = str(f.Str("pic_phone", validate.Rule{}, trimRange(8, 30)))
	in.PicEmail, _ = emailOrEmpty(f, "pic_email", 150)
	in.City = f.Str("city", optNull, trimMax(100))
	in.Source = enumDefault(f, "source", domain.LeadSources, "lainnya")
	in.Temperature = enumDefault(f, "temperature", domain.LeadTemperatures, "hangat")
	in.Status = enumDefault(f, "status", domain.LeadStatuses, "baru")
	in.Notes = f.Str("notes", optNull, trimMax(2000))
	in.OwnerUserID = f.UUID("owner_user_id", optNull)
	in.Custom, _ = record(f, "custom")
	return in
}

// enumDefault is z.enum(options).default(def).
func enumDefault(f *validate.Form, key string, options []string, def string) string {
	if s := f.Enum(key, validate.Rule{HasDefault: true}, options); s != nil {
		return *s
	}
	return def
}

func (h *handler) createLead(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	in := parseCreateLead(f)
	if err := validationErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	s, err := h.salesScope(ctx, u)
	if err != nil {
		return err
	}
	companyID, branchID, err := h.requireVenue(ctx, s, venueMissing)
	if err != nil {
		return err
	}
	phone, err := requireValidPhone(in.PicPhone, invalidPicPhone)
	if err != nil {
		return err
	}
	if err := h.assertOwner(ctx, u, ptrAny(in.OwnerUserID), companyID); err != nil {
		return err
	}
	var dup string
	err = h.db.QueryRow(ctx, `SELECT id FROM crm.crm_sales_leads
     WHERE company_id = $1 AND pic_phone = $2
       AND lower(org_name) = lower($3) AND deleted_at IS NULL`, companyID, phone, in.OrgName).Scan(&dup)
	if err == nil {
		return httpx.Conflict(duplicateLead)
	}
	if !database.IsNoRows(err) {
		return err
	}
	custom, err := h.resolveCustom(ctx, "lead", &companyID, in.Custom, nil, false)
	if err != nil {
		return err
	}
	owner := orNull(in.OwnerUserID)
	if owner == nil && u.Role == "sales" {
		owner = u.ID
	}
	var row *pgrow.Row
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		row, err = pgrow.QueryOne(ctx, tx, `INSERT INTO crm.crm_sales_leads
       (company_id, branch_id, org_name, org_type, pic_name, pic_title,
        pic_phone, pic_email, city, source, temperature, status, notes,
        owner_user_id, created_by, custom)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::text::jsonb)
     RETURNING id, org_name, pic_name, pic_phone, status`,
			companyID, branchID, in.OrgName, in.OrgType, in.PicName, orNull(in.PicTitle), phone, orNull(in.PicEmail),
			orNull(in.City), in.Source, in.Temperature, in.Status, orNull(in.Notes), owner, u.ID, custom)
		if err != nil {
			return rethrowDuplicate(err)
		}
		if row == nil {
			return nil
		}
		id := row.Str("id")
		h.syncLeadAccountContact(ctx, tx, id)
		return emit(ctx, tx, crmEvent{eventType: "lead.created", subjectType: "lead", subjectID: id,
			companyID: companyID, branchID: branchID, actorID: u.ID,
			payload: map[string]any{"source": in.Source, "org_type": in.OrgType, "temperature": in.Temperature}})
	})
	if err != nil {
		return err
	}
	return created(w, row, "Lead berhasil dibuat")
}

func ptrAny(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func (h *handler) leadDetail(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "lead", id, u); err != nil {
		return err
	}
	lead, err := pgrow.QueryOne(ctx, h.db, `SELECT l.id, l.company_id, l.branch_id, l.org_name, l.org_type,
            l.pic_name, l.pic_title, l.pic_phone, l.pic_email, l.city,
            l.source, l.temperature, l.status, l.notes, l.owner_user_id,
            l.customer_id, l.account_id, l.contact_id, l.score, l.score_breakdown, l.score_updated_at, l.custom, l.created_at, l.updated_at,
            l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content, l.utm_term, l.landing_page, l.referrer,
            u.full_name AS owner_name, b.name AS branch_name, acc.name AS account_name
     FROM crm.crm_sales_leads l
     LEFT JOIN configuration.users u ON u.id = l.owner_user_id
     LEFT JOIN configuration.branches b ON b.id = l.branch_id
     LEFT JOIN crm.crm_accounts acc ON acc.id = l.account_id
     WHERE l.id = $1`, id)
	if err != nil {
		return err
	}
	deals, err := pgrow.Query(ctx, h.db, `SELECT d.id, d.title, d.event_type, d.event_date, d.is_event_date_fixed,
            d.pax_estimate, d.value_estimate, d.value_final, d.closed_at,
            d.entered_stage_at, d.created_at,
            s.name AS stage_name, s.code AS stage_code, s.is_won, s.is_lost,
            lr.name AS lost_reason_name
     FROM crm.crm_sales_deals d
     JOIN crm.crm_sales_stages s ON s.id = d.stage_id
     LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = d.lost_reason_id
     WHERE d.lead_id = $1 AND d.deleted_at IS NULL
     ORDER BY d.created_at DESC
     LIMIT 100`, id)
	if err != nil {
		return err
	}
	activities, err := pgrow.Query(ctx, h.db, `SELECT a.id, a.deal_id, a.activity_type, a.notes, a.due_at, a.done_at,
            a.created_at, u.full_name AS owner_name, d.title AS deal_title
     FROM crm.crm_sales_activities a
     LEFT JOIN configuration.users u ON u.id = a.owner_user_id
     LEFT JOIN crm.crm_sales_deals d ON d.id = a.deal_id
     WHERE a.deleted_at IS NULL
       AND (a.lead_id = $1
            OR a.deal_id IN (SELECT id FROM crm.crm_sales_deals
                             WHERE lead_id = $1 AND deleted_at IS NULL))
     ORDER BY COALESCE(a.due_at, a.created_at) DESC
     LIMIT 30`, id)
	if err != nil {
		return err
	}
	customer, orders, err := h.memberCard(ctx, lead)
	if err != nil {
		return err
	}
	return ok(w, pgrow.New("lead", lead, "deals", deals, "activities", activities, "customer", customer, "recent_orders", orders))
}

// memberCard is the loyalty summary of a linked member (and, for leads,
// their last orders); orders stay [] without a member.
func (h *handler) memberCard(ctx context.Context, rec *pgrow.Row) (*pgrow.Row, []*pgrow.Row, error) {
	orders := []*pgrow.Row{}
	if rec == nil || rec.Str("customer_id") == "" {
		return nil, orders, nil
	}
	customer, err := h.ports.Members.Summary(ctx, h.db, rec.Str("customer_id"))
	if err != nil || customer == nil {
		return customer, orders, err
	}
	orders, err = h.ports.Members.RecentOrders(ctx, h.db, rec.Str("customer_id"))
	return customer, orders, err
}

// parseUpdateLead is updateLeadSchema (custom first, as declared).
func parseUpdateLead(f *validate.Form) (map[string]any, bool, *domain.Fields) {
	custom, hasCustom := record(f, "custom")
	body := domain.NewFields()
	patchStr(f, body, "org_name", false, trimRange(1, 200))
	patchEnum(f, body, "org_type", domain.LeadOrgTypes)
	patchStr(f, body, "pic_name", false, trimRange(1, 150))
	patchStr(f, body, "pic_title", true, trimMax(100))
	patchStr(f, body, "pic_phone", false, trimRange(8, 30))
	if v, present := emailOrEmpty(f, "pic_email", 150); present {
		body.Set("pic_email", ptrAny(v))
	}
	patchStr(f, body, "city", true, trimMax(100))
	patchEnum(f, body, "source", domain.LeadSources)
	patchEnum(f, body, "temperature", domain.LeadTemperatures)
	patchEnum(f, body, "status", domain.LeadStatuses)
	patchStr(f, body, "notes", true, trimMax(2000))
	if has(f, "owner_user_id") {
		body.Set("owner_user_id", ptrAny(f.UUID("owner_user_id", optNull)))
	}
	return custom, hasCustom, body
}

func (h *handler) updateLead(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	lead, err := h.require(ctx, "lead", id, u)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	custom, hasCustom, body := parseUpdateLead(f)
	if err := validationErr(f); err != nil {
		return err
	}
	beforeRow, err := pgrow.QueryOne(ctx, h.db, `SELECT org_name, org_type, pic_name, pic_phone, pic_email, city, source, temperature,
              status, notes, owner_user_id FROM crm.crm_sales_leads WHERE id = $1`, lead.ID)
	if err != nil {
		return err
	}
	before := map[string]any{}
	if beforeRow != nil {
		for _, k := range []string{"org_name", "org_type", "pic_name", "pic_phone", "pic_email", "city", "source", "temperature", "status", "notes", "owner_user_id"} {
			before[k] = beforeRow.Get(k)
		}
	}
	if body.Has("pic_phone") {
		phone, err := requireValidPhone(body.Get("pic_phone").(string), invalidPicPhone)
		if err != nil {
			return err
		}
		body.Set("pic_phone", phone)
	}
	if body.Has("pic_phone") || body.Has("org_name") {
		phone, org := coalesceStr(body.Get("pic_phone"), before["pic_phone"]), coalesceStr(body.Get("org_name"), before["org_name"])
		var dup string
		err := h.db.QueryRow(ctx, `SELECT id FROM crm.crm_sales_leads
       WHERE company_id = $1 AND pic_phone = $2
         AND lower(org_name) = lower($3) AND id <> $4 AND deleted_at IS NULL`, lead.CompanyID, phone, org, lead.ID).Scan(&dup)
		if err == nil {
			return httpx.Conflict(duplicateLead)
		}
		if !database.IsNoRows(err) {
			return err
		}
	}
	if body.Has("pic_email") && body.Get("pic_email") == "" {
		body.Set("pic_email", nil)
	}
	if err := h.assertOwner(ctx, u, body.Get("owner_user_id"), lead.CompanyID); err != nil {
		return err
	}
	set := domain.NewUpdateSet()
	if hasCustom {
		existing, err := h.existingCustom(ctx, "crm.crm_sales_leads", lead.ID)
		if err != nil {
			return err
		}
		merged, err := h.resolveCustom(ctx, "lead", &lead.CompanyID, custom, existing, true)
		if err != nil {
			return err
		}
		set.Set("custom", merged, "::text::jsonb")
	}
	body.Each(func(k string, v any) { set.Set(k, v, "") })
	sql, values, idParam, okSet := set.Build(lead.ID)
	if !okSet {
		return badRequest(domain.NoFieldsChanged)
	}
	var row *pgrow.Row
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		row, err = pgrow.QueryOne(ctx, tx, `UPDATE crm.crm_sales_leads SET `+sql+`
     WHERE id = `+idParam+`
     RETURNING id, org_name, pic_name, pic_phone, status`, values...)
		if err != nil {
			return rethrowDuplicate(err)
		}
		h.syncLeadAccountContact(ctx, tx, lead.ID)
		changes := domain.DiffChanges(before, body)
		return emit(ctx, tx, crmEvent{eventType: "lead.updated", subjectType: "lead", subjectID: lead.ID,
			companyID: lead.CompanyID, branchID: lead.BranchID, actorID: u.ID,
			payload: map[string]any{"changed_fields": changes.Keys()}, changes: fieldsMap(changes)})
	})
	if err != nil {
		return err
	}
	return okMsg(w, row, "Lead diperbarui")
}

// coalesceStr is `a ?? b ?? ""` for string values.
func coalesceStr(vals ...any) string {
	for _, v := range vals {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func fieldsMap(f *domain.Fields) map[string]any {
	out := map[string]any{}
	f.Each(func(k string, v any) { out[k] = v })
	return out
}

func (h *handler) deleteLead(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "lead", id, u); err != nil {
		return err
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_sales_leads SET deleted_at = now(), updated_at = now() WHERE id = $1`, id); err != nil {
		return err
	}
	return noContent(w)
}

func (h *handler) leadByPhone(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	if err := h.limit(r, "sales-funnel-pic-lookup:"+u.ID, 30, "Terlalu banyak pencarian — coba lagi sebentar"); err != nil {
		return err
	}
	ctx := r.Context()
	s, err := h.salesScope(ctx, u)
	if err != nil {
		return err
	}
	phone := domain.NormalizePhone(domain.JSTrim(queryStr(r, "phone")))
	if !domain.IsValidNormalizedPhone(phone) {
		return ok(w, nil)
	}
	where := domain.NewWhere([]string{"l.deleted_at IS NULL"}, 1)
	where.Add("l.pic_phone = ?", phone)
	domain.ScopeConditions(where, "l", u.ID, u.Role, s)
	rows, err := pgrow.Query(ctx, h.db, `SELECT l.id, l.org_name, l.status, l.pic_name, l.pic_title, l.pic_email
     FROM crm.crm_sales_leads l
     WHERE `+where.SQL()+`
     ORDER BY l.updated_at DESC
     LIMIT 10`, where.Params...)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return ok(w, nil)
	}
	leads := make([]*pgrow.Row, len(rows))
	for i, row := range rows {
		leads[i] = pgrow.New("id", row.Get("id"), "org_name", row.Get("org_name"), "status", row.Get("status"))
	}
	first := rows[0]
	return ok(w, pgrow.New(
		"pic", pgrow.New("name", first.Get("pic_name"), "title", first.Get("pic_title"), "email", first.Get("pic_email")),
		"leads", leads))
}

func (h *handler) linkLeadCustomer(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "lead", id, u); err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	customerID := f.UUID("customer_id", optNull)
	createFromPic := f.BoolDefault("create_from_pic", false)
	if !aborted(f) && str(customerID) == "" && !createFromPic {
		f.Fail(nil, "custom", "Pilih member atau buat dari PIC")
	}
	if err := validationErr(f); err != nil {
		return err
	}
	lead, err := pgrow.QueryOne(ctx, h.db, `SELECT org_name, pic_name, pic_phone, pic_email, city FROM crm.crm_sales_leads WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if lead == nil {
		return httpx.NotFound("Lead tidak ditemukan")
	}
	var linked string
	if str(customerID) != "" {
		m, err := members.Get(ctx, h.db, *customerID)
		if err != nil {
			return err
		}
		if m == nil || !m.IsActive {
			return httpx.NotFound("Member tidak ditemukan")
		}
		if m.Phone == "" || m.Phone != lead.Str("pic_phone") {
			return badRequest("No. WA member tidak sama dengan no. WA PIC — hanya member milik PIC yang bisa ditautkan")
		}
		linked = m.ID
	} else {
		linked, err = h.ports.Members.UpsertFromPic(ctx, h.db, PicLead{OrgName: lead.Str("org_name"), PicName: lead.Str("pic_name"),
			PicPhone: lead.Str("pic_phone"), PicEmail: lead.StrPtr("pic_email"), City: lead.StrPtr("city")})
		if err != nil {
			return err
		}
	}
	if linked == "" {
		return httpx.Status(http.StatusInternalServerError, "Gagal menyiapkan member")
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_sales_leads SET customer_id = $1, updated_at = now() WHERE id = $2`, linked, id); err != nil {
		return err
	}
	return okMsg(w, pgrow.New("customer_id", linked), "PIC tertaut ke member loyalty")
}

func (h *handler) unlinkLeadCustomer(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "lead", id, u); err != nil {
		return err
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_sales_leads SET customer_id = NULL, updated_at = now() WHERE id = $1`, id); err != nil {
		return err
	}
	return okMsg(w, pgrow.New("customer_id", nil), "Tautan member dilepas")
}

// syncLeadAccountContact is account-sync.ts: upsert the lead's account (by
// company + name) and contact (by company + phone) and link them. Failures
// are logged, never surfaced; it runs in a savepoint so a failure leaves
// the caller's transaction usable.
func (h *handler) syncLeadAccountContact(ctx context.Context, q database.DB, leadID string) {
	err := database.WithTx(ctx, q, func(tx pgx.Tx) error { return syncAccountContact(ctx, tx, leadID) })
	if err != nil {
		h.log.Error("[sales-funnel] sync account/contact gagal", "error", err)
	}
}

func syncAccountContact(ctx context.Context, q database.Querier, leadID string) error {
	lead, err := pgrow.QueryOne(ctx, q, `SELECT id, company_id, branch_id, org_name, org_type, pic_name, pic_title,
            pic_phone, pic_email, city, owner_user_id, customer_id, created_by,
            account_id, contact_id
     FROM crm.crm_sales_leads WHERE id = $1 AND deleted_at IS NULL`, leadID)
	if err != nil || lead == nil {
		return err
	}
	companyID := lead.Str("company_id")
	accountID := lead.StrPtr("account_id")
	existing, err := scanID(ctx, q, `SELECT id::text FROM crm.crm_accounts
     WHERE company_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL`, companyID, lead.Str("org_name"))
	if err != nil {
		return err
	}
	switch {
	case existing != nil:
		accountID = existing
	case accountID == nil:
		if accountID, err = scanID(ctx, q, `INSERT INTO crm.crm_accounts
         (company_id, branch_id, name, account_type, city, owner_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING
       RETURNING id::text`, companyID, lead.Str("branch_id"), lead.Str("org_name"), lead.Str("org_type"),
			lead.Get("city"), lead.Get("owner_user_id"), lead.Get("created_by")); err != nil {
			return err
		}
	default:
		if _, err := q.Exec(ctx, `UPDATE crm.crm_accounts SET name = $2, account_type = $3, city = COALESCE(city, $4), updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM crm.crm_accounts x WHERE x.company_id = $5 AND lower(x.name) = lower($2) AND x.id <> $1 AND x.deleted_at IS NULL)`,
			*accountID, lead.Str("org_name"), lead.Str("org_type"), lead.Get("city"), companyID); err != nil {
			return err
		}
	}

	contactID := lead.StrPtr("contact_id")
	existingContact, err := scanID(ctx, q, `SELECT id::text FROM crm.crm_contacts
     WHERE company_id = $1 AND phone = $2 AND deleted_at IS NULL`, companyID, lead.Str("pic_phone"))
	if err != nil {
		return err
	}
	if existingContact != nil {
		contactID = existingContact
		if _, err := q.Exec(ctx, `UPDATE crm.crm_contacts
         SET name = COALESCE(NULLIF(name, ''), $2),
             title = COALESCE(title, $3),
             email = COALESCE(email, NULLIF($4, '')),
             customer_id = COALESCE(customer_id, $5),
             account_id = COALESCE(account_id, $6),
             updated_at = now()
       WHERE id = $1`, *contactID, lead.Str("pic_name"), lead.Get("pic_title"), lead.Get("pic_email"),
			lead.Get("customer_id"), accountID); err != nil {
			return err
		}
	} else {
		createdID, err := scanID(ctx, q, `INSERT INTO crm.crm_contacts
         (company_id, branch_id, account_id, name, title, phone, email, is_primary,
          customer_id, owner_user_id, created_by)
       VALUES ($1, $2, $3::uuid, $4, $5, $6, NULLIF($7, ''),
               NOT EXISTS (SELECT 1 FROM crm.crm_contacts c WHERE c.account_id = $3::uuid AND c.deleted_at IS NULL AND c.is_primary),
               $8, $9, $10)
       ON CONFLICT DO NOTHING
       RETURNING id::text`, companyID, lead.Str("branch_id"), accountID, lead.Str("pic_name"), lead.Get("pic_title"),
			lead.Str("pic_phone"), lead.Get("pic_email"), lead.Get("customer_id"), lead.Get("owner_user_id"), lead.Get("created_by"))
		if err != nil {
			return err
		}
		if createdID != nil {
			contactID = createdID
		}
	}

	if !samePtr(accountID, lead.StrPtr("account_id")) || !samePtr(contactID, lead.StrPtr("contact_id")) {
		_, err = q.Exec(ctx, `UPDATE crm.crm_sales_leads SET account_id = $2, contact_id = $3, updated_at = now() WHERE id = $1`,
			leadID, accountID, contactID)
	}
	return err
}

// scanID returns the first column of the first row, nil when none.
func scanID(ctx context.Context, q database.Querier, sql string, args ...any) (*string, error) {
	var id string
	err := q.QueryRow(ctx, sql, args...).Scan(&id)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func samePtr(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
