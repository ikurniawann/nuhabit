package salesfunnel

import (
	"net/http"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// lib/sales-funnel/accounts.ts, accounts-server.ts and contacts-server.ts

const accountColumns = `
  a.id, a.company_id, a.branch_id, a.name, a.account_type, a.industry,
  a.address, a.city, a.phone, a.email, a.website, a.npwp, a.notes,
  a.owner_user_id, a.custom, a.created_at, a.updated_at,
  u.full_name AS owner_name,
  (SELECT count(*) FROM crm.crm_contacts c WHERE c.account_id = a.id AND c.deleted_at IS NULL)::int AS contact_count,
  (SELECT count(*) FROM crm.crm_sales_leads l WHERE l.account_id = a.id AND l.deleted_at IS NULL)::int AS lead_count,
  (SELECT count(*) FROM crm.crm_sales_deals d JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     WHERE l.account_id = a.id AND d.deleted_at IS NULL AND d.closed_at IS NULL)::int AS open_deal_count,
  (SELECT COALESCE(sum(COALESCE(d.value_final, d.value_estimate)), 0)
     FROM crm.crm_sales_deals d JOIN crm.crm_sales_stages s ON s.id = d.stage_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     WHERE l.account_id = a.id AND d.deleted_at IS NULL AND s.is_won)::numeric AS won_value,
  (SELECT max(COALESCE(act.done_at, act.created_at)) FROM crm.crm_sales_activities act
     WHERE act.deleted_at IS NULL AND act.subject_type = 'account' AND act.subject_id = a.id) AS last_activity_at`

func (h *handler) listAccounts(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	s, err := h.salesScope(r.Context(), u)
	if err != nil {
		return err
	}
	q, city := domain.JSTrim(queryStr(r, "q")), domain.JSTrim(queryStr(r, "city"))
	pg := domain.ParsePagination(queryStr(r, "page"), queryStr(r, "limit"))
	where := domain.NewWhere([]string{"a.deleted_at IS NULL"}, 1)
	if s.HasCompany() {
		where.Add("a.company_id = ?", *s.CompanyID)
	}
	if s.IsBranch() {
		where.Add("a.branch_id = ?", *s.BranchID)
	}
	if u.Role == "sales" {
		me := where.Param(u.ID)
		where.Push(`(a.owner_user_id = ` + me + ` OR a.owner_user_id IS NULL
      OR EXISTS (SELECT 1 FROM crm.crm_sales_leads l
                  WHERE l.account_id = a.id AND l.deleted_at IS NULL AND l.owner_user_id = ` + me + `))`)
	}
	if t := queryStr(r, "account_type"); domain.Contains(domain.AccountTypes, t) {
		where.Add("a.account_type = ?", t)
	}
	if owner := queryStr(r, "owner_user_id"); domain.IsUUID(owner) {
		where.Add("a.owner_user_id = ?", owner)
	}
	if city != "" {
		where.Add("a.city ILIKE ?", "%"+city+"%")
	}
	if q != "" {
		like := where.Param("%" + q + "%")
		where.Push(`(a.name ILIKE ` + like + ` OR a.city ILIKE ` + like + ` OR a.phone ILIKE ` + like + ` OR a.email ILIKE ` + like + `
      OR EXISTS (SELECT 1 FROM crm.crm_contacts c WHERE c.account_id = a.id AND c.deleted_at IS NULL
                  AND (c.name ILIKE ` + like + ` OR c.phone ILIKE ` + like + `)))`)
	}
	limit, offset := where.Param(domain.SQLNumber(pg.Limit)), where.Param(domain.SQLNumber(pg.Offset))
	rows, meta, err := paginate(r.Context(), h.db, `SELECT `+accountColumns+`, COUNT(*) OVER() AS total_count
     FROM crm.crm_accounts a
     LEFT JOIN configuration.users u ON u.id = a.owner_user_id
     WHERE `+where.SQL()+`
     ORDER BY a.updated_at DESC
     LIMIT `+limit+` OFFSET `+offset, where.Params, pg)
	if err != nil {
		return err
	}
	return paginated(w, rows, meta)
}

// parseAccount is accountSchema; with partial it is
// patchSchemaOf(accountSchema.strict()): only the keys sent are read, so a
// PATCH never resets account_type to its "corporate" default.
func parseAccount(f *validate.Form, partial bool) (*domain.Fields, *string, bool, map[string]any, bool) {
	body := domain.NewFields()
	req := validate.Rule{}
	if partial {
		req = opt
	}
	if !partial || has(f, "name") {
		if s := f.Str("name", req, trimRange(1, 200)); s != nil {
			body.Set("name", *s)
		}
	}
	if partial {
		patchEnum(f, body, "account_type", domain.AccountTypes)
	} else {
		body.Set("account_type", enumDefault(f, "account_type", domain.AccountTypes, "corporate"))
	}
	for _, c := range []struct {
		key string
		max int
	}{{"industry", 100}, {"address", 1000}, {"city", 100}} {
		patchStr(f, body, c.key, true, trimMax(c.max))
	}
	phone, hasPhone := orEmpty(f, "phone", func(f *validate.Form, v any) string {
		s, _ := f.CheckString("phone", v, trimMax(30))
		return s
	})
	if v, present := emailOrEmpty(f, "email", 150); present {
		body.Set("email", ptrAny(v))
	}
	for _, c := range []struct {
		key string
		max int
	}{{"website", 200}, {"npwp", 40}, {"notes", 2000}} {
		patchStr(f, body, c.key, true, trimMax(c.max))
	}
	if has(f, "owner_user_id") {
		body.Set("owner_user_id", ptrAny(f.UUID("owner_user_id", optNull)))
	}
	custom, hasCustom := record(f, "custom")
	if partial {
		strict(f, "name", "account_type", "industry", "address", "city", "phone", "email", "website", "npwp", "notes", "owner_user_id", "custom")
	}
	return body, phone, hasPhone, custom, hasCustom
}

func (h *handler) createAccount(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	body, phoneIn, _, custom, _ := parseAccount(f, false)
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
	var phone any
	if str(phoneIn) != "" {
		if phone, err = requireValidPhone(*phoneIn, "Nomor telepon tidak valid"); err != nil {
			return err
		}
	}
	if err := h.assertOwner(ctx, u, body.Get("owner_user_id"), companyID); err != nil {
		return err
	}
	customJSON, err := h.resolveCustom(ctx, "account", &companyID, custom, nil, false)
	if err != nil {
		return err
	}
	dup, err := scanID(ctx, h.db, `SELECT id::text FROM crm.crm_accounts
     WHERE company_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL`, companyID, body.Get("name"))
	if err != nil {
		return err
	}
	if dup != nil {
		return &httpx.Error{Status: http.StatusConflict, Message: "Account dengan nama ini sudah ada", Details: pgrow.New("account_id", *dup)}
	}
	owner := emptyNull(body.Get("owner_user_id"))
	if owner == nil && u.Role == "sales" {
		owner = u.ID
	}
	row, err := pgrow.QueryOne(ctx, h.db, `INSERT INTO crm.crm_accounts
       (company_id, branch_id, name, account_type, industry, address, city, phone,
        email, website, npwp, notes, owner_user_id, custom, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::text::jsonb, $15)
     RETURNING id, name, account_type, city, owner_user_id, created_at`,
		companyID, branchID, body.Get("name"), body.Get("account_type"), emptyNull(body.Get("industry")), emptyNull(body.Get("address")),
		emptyNull(body.Get("city")), phone, emptyNull(body.Get("email")), emptyNull(body.Get("website")), emptyNull(body.Get("npwp")),
		emptyNull(body.Get("notes")), owner, customJSON, u.ID)
	if err != nil {
		return err
	}
	return created(w, row, "Account dibuat")
}

// emptyNull is `value || null` for a body value.
func emptyNull(v any) any {
	if s, ok := v.(string); ok && s == "" {
		return nil
	}
	return v
}

func (h *handler) accountDetail(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "account", id, u); err != nil {
		return err
	}
	account, err := pgrow.QueryOne(ctx, h.db, `SELECT a.id, a.company_id, a.branch_id, a.name, a.account_type, a.industry,
              a.address, a.city, a.phone, a.email, a.website, a.npwp, a.notes,
              a.owner_user_id, a.custom, a.created_at, a.updated_at,
              u.full_name AS owner_name, b.name AS branch_name
       FROM crm.crm_accounts a
       LEFT JOIN configuration.users u ON u.id = a.owner_user_id
       LEFT JOIN configuration.branches b ON b.id = a.branch_id
       WHERE a.id = $1`, id)
	if err != nil {
		return err
	}
	out := pgrow.New("account", account)
	for _, part := range []struct{ key, sql string }{
		{"contacts", `SELECT c.id, c.name, c.title, c.phone, c.email, c.is_primary, c.customer_id,
              c.owner_user_id, c.created_at, u.full_name AS owner_name
       FROM crm.crm_contacts c
       LEFT JOIN configuration.users u ON u.id = c.owner_user_id
       WHERE c.account_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.is_primary DESC, c.created_at ASC
       LIMIT 200`},
		{"leads", `SELECT l.id, l.org_name, l.pic_name, l.pic_phone, l.source, l.temperature,
              l.status, l.owner_user_id, l.created_at, u.full_name AS owner_name
       FROM crm.crm_sales_leads l
       LEFT JOIN configuration.users u ON u.id = l.owner_user_id
       WHERE l.account_id = $1 AND l.deleted_at IS NULL
       ORDER BY l.created_at DESC
       LIMIT 100`},
		{"deals", `SELECT d.id, d.lead_id, d.title, d.event_type, d.event_date, d.pax_estimate,
              d.value_estimate, d.value_final, d.closed_at, d.entered_stage_at, d.created_at,
              s.name AS stage_name, s.code AS stage_code, s.is_won, s.is_lost,
              lr.name AS lost_reason_name
       FROM crm.crm_sales_deals d
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       JOIN crm.crm_sales_stages s ON s.id = d.stage_id
       LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = d.lost_reason_id
       WHERE l.account_id = $1 AND d.deleted_at IS NULL
       ORDER BY d.created_at DESC
       LIMIT 100`},
		{"quotations", `SELECT q.id, q.deal_id, q.quote_number, q.status, q.total, q.valid_until, q.created_at
       FROM crm.crm_sales_quotations q
       JOIN crm.crm_sales_deals d ON d.id = q.deal_id
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       WHERE l.account_id = $1 AND q.deleted_at IS NULL
       ORDER BY q.created_at DESC
       LIMIT 50`},
		{"invoices", `SELECT i.id, i.deal_id, i.invoice_number, i.label, i.amount, i.due_date, i.status, i.created_at
       FROM crm.crm_sales_invoices i
       JOIN crm.crm_sales_deals d ON d.id = i.deal_id
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       WHERE l.account_id = $1 AND i.deleted_at IS NULL
       ORDER BY i.created_at DESC
       LIMIT 50`},
		{"tasks", `SELECT a.id, a.activity_type, a.title, a.notes, a.due_at, a.done_at, a.status,
              a.priority, a.subject_type, a.subject_id, a.created_at, u.full_name AS owner_name
       FROM crm.crm_sales_activities a
       LEFT JOIN configuration.users u ON u.id = a.owner_user_id
       WHERE a.deleted_at IS NULL
         AND ((a.subject_type = 'account' AND a.subject_id = $1)
              OR a.lead_id IN (SELECT id FROM crm.crm_sales_leads WHERE account_id = $1 AND deleted_at IS NULL)
              OR a.deal_id IN (SELECT d.id FROM crm.crm_sales_deals d JOIN crm.crm_sales_leads l ON l.id = d.lead_id
                               WHERE l.account_id = $1 AND d.deleted_at IS NULL)
              OR (a.subject_type = 'contact' AND a.subject_id IN
                    (SELECT id FROM crm.crm_contacts WHERE account_id = $1 AND deleted_at IS NULL)))
       ORDER BY COALESCE(a.due_at, a.created_at) DESC
       LIMIT 50`},
	} {
		rows, err := pgrow.Query(ctx, h.db, part.sql, id)
		if err != nil {
			return err
		}
		out.Set(part.key, rows)
	}
	return ok(w, out)
}

func (h *handler) updateAccount(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	account, err := h.require(ctx, "account", id, u)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	body, phone, hasPhone, custom, hasCustom := parseAccount(f, true)
	if err := validationErr(f); err != nil {
		return err
	}
	if err := h.assertOwner(ctx, u, body.Get("owner_user_id"), account.CompanyID); err != nil {
		return err
	}
	if name, _ := body.Get("name").(string); name != "" {
		dup, err := scanID(ctx, h.db, `SELECT id::text FROM crm.crm_accounts
       WHERE company_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL AND id <> $3`, account.CompanyID, name, account.ID)
		if err != nil {
			return err
		}
		if dup != nil {
			return httpx.Conflict("Account dengan nama ini sudah ada")
		}
	}
	set := domain.NewUpdateSet()
	body.Each(func(k string, v any) { set.Set(k, emptyNull(v), "") })
	if hasPhone {
		var v any
		if str(phone) != "" {
			if v, err = requireValidPhone(*phone, "Nomor telepon tidak valid"); err != nil {
				return err
			}
		}
		set.Set("phone", v, "")
	}
	if hasCustom {
		existing, err := h.existingCustom(ctx, "crm.crm_accounts", account.ID)
		if err != nil {
			return err
		}
		merged, err := h.resolveCustom(ctx, "account", &account.CompanyID, custom, existing, true)
		if err != nil {
			return err
		}
		set.Set("custom", merged, "::text::jsonb")
	}
	sql, values, idParam, okSet := set.Build(account.ID)
	if !okSet {
		return badRequest(domain.NoFieldsChanged)
	}
	row, err := pgrow.QueryOne(ctx, h.db, `UPDATE crm.crm_accounts SET `+sql+` WHERE id = `+idParam+`
     RETURNING id, name, account_type, city, owner_user_id, updated_at`, values...)
	if err != nil {
		return err
	}
	return okMsg(w, row, "Account diperbarui")
}

func (h *handler) deleteAccount(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "account", id, u); err != nil {
		return err
	}
	var n int
	if err := h.db.QueryRow(ctx, `SELECT count(*) FROM crm.crm_sales_leads WHERE account_id = $1 AND deleted_at IS NULL`, id).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return httpx.Conflict("Account masih punya lead aktif — hapus/pindahkan lead-nya dulu")
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_contacts SET account_id = NULL, updated_at = now() WHERE account_id = $1`, id); err != nil {
		return err
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_accounts SET deleted_at = now(), updated_at = now() WHERE id = $1`, id); err != nil {
		return err
	}
	return noContent(w)
}

/* ── Contacts ────────────────────────────────────────────────────────── */

const contactColumns = `
  c.id, c.company_id, c.branch_id, c.account_id, c.name, c.title, c.phone, c.email,
  c.is_primary, c.customer_id, c.notes, c.owner_user_id, c.custom, c.created_at, c.updated_at,
  a.name AS account_name, a.account_type,
  u.full_name AS owner_name,
  (SELECT count(*) FROM crm.crm_sales_leads l WHERE l.contact_id = c.id AND l.deleted_at IS NULL)::int AS lead_count,
  (SELECT max(COALESCE(act.done_at, act.created_at)) FROM crm.crm_sales_activities act
     WHERE act.deleted_at IS NULL AND act.subject_type = 'contact' AND act.subject_id = c.id) AS last_activity_at`

func (h *handler) listContacts(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	s, err := h.salesScope(r.Context(), u)
	if err != nil {
		return err
	}
	q := domain.JSTrim(queryStr(r, "q"))
	pg := domain.ParsePagination(queryStr(r, "page"), queryStr(r, "limit"))
	where := domain.NewWhere([]string{"c.deleted_at IS NULL"}, 1)
	if s.HasCompany() {
		where.Add("c.company_id = ?", *s.CompanyID)
	}
	if s.IsBranch() {
		where.Add("c.branch_id = ?", *s.BranchID)
	}
	if u.Role == "sales" {
		me := where.Param(u.ID)
		where.Push(`(c.owner_user_id = ` + me + ` OR c.owner_user_id IS NULL
      OR EXISTS (SELECT 1 FROM crm.crm_sales_leads l
                  WHERE l.contact_id = c.id AND l.deleted_at IS NULL AND l.owner_user_id = ` + me + `))`)
	}
	if account := queryStr(r, "account_id"); domain.IsUUID(account) {
		where.Add("c.account_id = ?", account)
	}
	if owner := queryStr(r, "owner_user_id"); domain.IsUUID(owner) {
		where.Add("c.owner_user_id = ?", owner)
	}
	if q != "" {
		like := where.Param("%" + q + "%")
		where.Push(`(c.name ILIKE ` + like + ` OR c.phone ILIKE ` + like + ` OR c.email ILIKE ` + like + ` OR c.title ILIKE ` + like + ` OR a.name ILIKE ` + like + `)`)
	}
	limit, offset := where.Param(domain.SQLNumber(pg.Limit)), where.Param(domain.SQLNumber(pg.Offset))
	rows, meta, err := paginate(r.Context(), h.db, `SELECT `+contactColumns+`, COUNT(*) OVER() AS total_count
     FROM crm.crm_contacts c
     LEFT JOIN crm.crm_accounts a ON a.id = c.account_id
     LEFT JOIN configuration.users u ON u.id = c.owner_user_id
     WHERE `+where.SQL()+`
     ORDER BY c.updated_at DESC
     LIMIT `+limit+` OFFSET `+offset, where.Params, pg)
	if err != nil {
		return err
	}
	return paginated(w, rows, meta)
}

// parseContact is contactSchema; partial is
// patchSchemaOf(contactSchema.strict()) (a PATCH without is_primary keeps it).
func parseContact(f *validate.Form, partial bool) (*domain.Fields, *string, bool, map[string]any, bool) {
	body := domain.NewFields()
	req := validate.Rule{}
	if partial {
		req = opt
	}
	if has(f, "account_id") {
		body.Set("account_id", ptrAny(f.UUID("account_id", optNull)))
	}
	if !partial || has(f, "name") {
		if s := f.Str("name", req, trimRange(1, 150)); s != nil {
			body.Set("name", *s)
		}
	}
	patchStr(f, body, "title", true, trimMax(100))
	var phone *string
	hasPhone := has(f, "phone")
	if !partial || hasPhone {
		phone = f.Str("phone", req, trimRange(8, 30))
	}
	if v, present := emailOrEmpty(f, "email", 150); present {
		body.Set("email", ptrAny(v))
	}
	if partial {
		patchBool(f, body, "is_primary")
	} else {
		body.Set("is_primary", f.BoolDefault("is_primary", false))
	}
	for _, k := range []string{"customer_id"} {
		if has(f, k) {
			body.Set(k, ptrAny(f.UUID(k, optNull)))
		}
	}
	patchStr(f, body, "notes", true, trimMax(2000))
	if has(f, "owner_user_id") {
		body.Set("owner_user_id", ptrAny(f.UUID("owner_user_id", optNull)))
	}
	custom, hasCustom := record(f, "custom")
	if partial {
		strict(f, "account_id", "name", "title", "phone", "email", "is_primary", "customer_id", "notes", "owner_user_id", "custom")
	}
	return body, phone, hasPhone, custom, hasCustom
}

func (h *handler) createContact(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	body, phoneIn, _, custom, _ := parseContact(f, false)
	if err := validationErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	s, err := h.salesScope(ctx, u)
	if err != nil {
		return err
	}
	accountID, _ := body.Get("account_id").(string)
	var companyID, branchID string
	if accountID != "" {
		account, err := h.require(ctx, "account", accountID, u)
		if err != nil {
			return err
		}
		companyID, branchID = account.CompanyID, account.BranchID
	} else if companyID, branchID, err = h.requireVenue(ctx, s, venueMissingShort); err != nil {
		return err
	}
	phone, err := requireValidPhone(str(phoneIn), "Nomor WA tidak valid")
	if err != nil {
		return err
	}
	if err := h.assertOwner(ctx, u, body.Get("owner_user_id"), companyID); err != nil {
		return err
	}
	customJSON, err := h.resolveCustom(ctx, "contact", &companyID, custom, nil, false)
	if err != nil {
		return err
	}
	dup, err := pgrow.QueryOne(ctx, h.db, `SELECT id, name FROM crm.crm_contacts WHERE company_id = $1 AND phone = $2 AND deleted_at IS NULL`, companyID, phone)
	if err != nil {
		return err
	}
	if dup != nil {
		return &httpx.Error{Status: http.StatusConflict, Message: "Nomor ini sudah terdaftar atas nama " + dup.Str("name"),
			Details: pgrow.New("contact_id", dup.Get("id"))}
	}
	isPrimary := body.Get("is_primary").(bool)
	if isPrimary && accountID != "" {
		if _, err := h.db.Exec(ctx, `UPDATE crm.crm_contacts SET is_primary = false, updated_at = now()
       WHERE account_id = $1 AND deleted_at IS NULL`, accountID); err != nil {
			return err
		}
	}
	owner := emptyNull(body.Get("owner_user_id"))
	if owner == nil && u.Role == "sales" {
		owner = u.ID
	}
	row, err := pgrow.QueryOne(ctx, h.db, `INSERT INTO crm.crm_contacts
       (company_id, branch_id, account_id, name, title, phone, email, is_primary,
        customer_id, notes, owner_user_id, custom, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text::jsonb, $13)
     RETURNING id, account_id, name, phone, is_primary, created_at`,
		companyID, branchID, body.Get("account_id"), body.Get("name"), emptyNull(body.Get("title")), phone,
		emptyNull(body.Get("email")), isPrimary, body.Get("customer_id"), emptyNull(body.Get("notes")), owner, customJSON, u.ID)
	if err != nil {
		return err
	}
	return created(w, row, "Contact dibuat")
}

func (h *handler) contactDetail(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "contact", id, u); err != nil {
		return err
	}
	contact, err := pgrow.QueryOne(ctx, h.db, `SELECT c.id, c.company_id, c.branch_id, c.account_id, c.name, c.title, c.phone,
            c.email, c.is_primary, c.customer_id, c.notes, c.owner_user_id, c.custom,
            c.created_at, c.updated_at,
            a.name AS account_name, a.account_type, u.full_name AS owner_name
     FROM crm.crm_contacts c
     LEFT JOIN crm.crm_accounts a ON a.id = c.account_id
     LEFT JOIN configuration.users u ON u.id = c.owner_user_id
     WHERE c.id = $1`, id)
	if err != nil {
		return err
	}
	leads, err := pgrow.Query(ctx, h.db, `SELECT l.id, l.org_name, l.source, l.temperature, l.status, l.created_at
     FROM crm.crm_sales_leads l WHERE l.contact_id = $1 AND l.deleted_at IS NULL
     ORDER BY l.created_at DESC LIMIT 50`, id)
	if err != nil {
		return err
	}
	var customer *pgrow.Row
	if contact != nil && contact.Str("customer_id") != "" {
		if customer, err = h.ports.Members.Summary(ctx, h.db, contact.Str("customer_id")); err != nil {
			return err
		}
	}
	return ok(w, pgrow.New("contact", contact, "leads", leads, "customer", customer))
}

func (h *handler) updateContact(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	contact, err := h.require(ctx, "contact", id, u)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	body, phoneIn, hasPhone, custom, hasCustom := parseContact(f, true)
	if err := validationErr(f); err != nil {
		return err
	}
	if accountID, _ := body.Get("account_id").(string); accountID != "" {
		account, err := h.require(ctx, "account", accountID, u)
		if err != nil {
			return err
		}
		if account.CompanyID != contact.CompanyID {
			return badRequest("Account berada di venue lain")
		}
	}
	if err := h.assertOwner(ctx, u, body.Get("owner_user_id"), contact.CompanyID); err != nil {
		return err
	}
	set := domain.NewUpdateSet()
	body.Each(func(k string, v any) { set.Set(k, emptyNull(v), "") })
	if hasPhone {
		phone, err := requireValidPhone(str(phoneIn), "Nomor WA tidak valid")
		if err != nil {
			return err
		}
		dup, err := scanID(ctx, h.db, `SELECT id::text FROM crm.crm_contacts
       WHERE company_id = $1 AND phone = $2 AND deleted_at IS NULL AND id <> $3`, contact.CompanyID, phone, contact.ID)
		if err != nil {
			return err
		}
		if dup != nil {
			return httpx.Conflict("Nomor ini sudah dipakai contact lain")
		}
		set.Set("phone", phone, "")
	}
	if hasCustom {
		existing, err := h.existingCustom(ctx, "crm.crm_contacts", contact.ID)
		if err != nil {
			return err
		}
		merged, err := h.resolveCustom(ctx, "contact", &contact.CompanyID, custom, existing, true)
		if err != nil {
			return err
		}
		set.Set("custom", merged, "::text::jsonb")
	}
	sql, values, idParam, okSet := set.Build(contact.ID)
	if !okSet {
		return badRequest(domain.NoFieldsChanged)
	}
	row, err := pgrow.QueryOne(ctx, h.db, `UPDATE crm.crm_contacts SET `+sql+` WHERE id = `+idParam+`
     RETURNING id, account_id, name, phone, is_primary, updated_at`, values...)
	if err != nil {
		return err
	}
	if row != nil && row.Bool("is_primary") && row.Str("account_id") != "" {
		if _, err := h.db.Exec(ctx, `UPDATE crm.crm_contacts SET is_primary = false, updated_at = now()
       WHERE account_id = $1 AND id <> $2 AND deleted_at IS NULL AND is_primary`, row.Str("account_id"), contact.ID); err != nil {
			return err
		}
	}
	return okMsg(w, row, "Contact diperbarui")
}

func (h *handler) deleteContact(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "contact", id, u); err != nil {
		return err
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_sales_leads SET contact_id = NULL, updated_at = now() WHERE contact_id = $1`, id); err != nil {
		return err
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_contacts SET deleted_at = now(), updated_at = now() WHERE id = $1`, id); err != nil {
		return err
	}
	return noContent(w)
}
