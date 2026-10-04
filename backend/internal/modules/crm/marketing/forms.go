package marketing

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/marketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

func (h *handler) listForms(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.guard.RequireScope(r, kit.GateSegments)
	if err != nil {
		return err
	}
	where, params := companyFilter("f.deleted_at IS NULL", nil, "f.", scope)
	rows, err := kit.Query(r.Context(), h.db, `SELECT f.id, f.company_id, f.slug, f.name, f.title, f.description, f.fields, f.submit_label,
            f.success_message, f.redirect_url, f.default_source, f.notify_user_ids, f.notify_numbers,
            f.is_active, f.submission_count, f.created_at, f.updated_at,
            (SELECT COUNT(*) FROM crm.crm_form_submissions s WHERE s.form_id = f.id AND s.status = 'rejected') AS rejected_count,
            (SELECT MAX(s.created_at) FROM crm.crm_form_submissions s WHERE s.form_id = f.id) AS last_submission_at
     FROM crm.crm_forms f
     WHERE `+where+`
     ORDER BY f.created_at`, params...)
	if err != nil {
		return err
	}
	// The effective fields: a form never edited stores [] and renders the
	// default fields.
	for _, row := range rows {
		raw, err := decodeJSONColumn(row, "fields")
		if err != nil {
			return err
		}
		row.Set("fields", formFields(raw))
	}
	return kit.OK(w, rows)
}

func (h *handler) createForm(w http.ResponseWriter, r *http.Request) error {
	user, scope, err := h.guard.RequireScope(r, kit.GateSegments)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseForm(f, false)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	ctx := r.Context()
	var dup bool
	if err := h.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM crm.crm_forms WHERE slug = $1)`, *in.Slug).Scan(&dup); err != nil {
		return err
	}
	if dup {
		return httpx.Conflict("Slug sudah dipakai form lain")
	}
	fields, err := jsonText(in.Fields)
	if err != nil {
		return err
	}
	userIDs, _ := jsonText(in.NotifyUserIDs)
	numbers, _ := jsonText(in.NotifyNumbers)
	row, err := kit.QueryOne(ctx, h.db, `INSERT INTO crm.crm_forms
       (company_id, slug, name, title, description, fields, submit_label, success_message, redirect_url,
        default_source, notify_user_ids, notify_numbers, is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14)
     RETURNING id, slug, name`,
		kit.ScopedCompanyID(user, scope), *in.Slug, *in.Name, *in.Title, in.Description.Value, fields,
		*in.SubmitLabel, *in.SuccessMessage, in.RedirectURL.Value, *in.DefaultSource,
		userIDs, numbers, *in.IsActive, user.ID)
	if err != nil {
		return err
	}
	return kit.Created(w, row, "Form dibuat")
}

func jsonText(v any) (string, error) {
	b, err := kit.MarshalNoEscape(v)
	return string(b), err
}

type formRef struct{ id, slug string }

// accessibleForm mirrors requireForm: the form in the user's company scope,
// 404 otherwise.
func (h *handler) accessibleForm(r *http.Request) (formRef, error) {
	_, scope, err := h.guard.RequireScope(r, kit.GateSegments)
	if err != nil {
		return formRef{}, err
	}
	where, params := companyFilter("id = $1::text::uuid AND deleted_at IS NULL", []any{r.PathValue("id")}, "", scope)
	var f formRef
	err = h.db.QueryRow(r.Context(), `SELECT id::text, slug FROM crm.crm_forms WHERE `+where, params...).Scan(&f.id, &f.slug)
	if database.IsNoRows(err) {
		return f, httpx.NotFound("Form tidak ditemukan")
	}
	return f, err
}

// formSubmissions lists the last 50 submissions with the lead each created
// (spam and conversion monitoring).
func (h *handler) formSubmissions(w http.ResponseWriter, r *http.Request) error {
	form, err := h.accessibleForm(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	rows, err := kit.Query(ctx, h.db, `SELECT s.id, s.lead_id, s.status, s.reason, s.utm, s.created_at
     FROM crm.crm_form_submissions s
     WHERE s.form_id = $1
     ORDER BY s.created_at DESC
     LIMIT 50`, form.id)
	if err != nil {
		return err
	}
	if err := h.attachLeads(ctx, rows); err != nil {
		return err
	}
	return kit.OK(w, rows)
}

// attachLeads adds org_name, pic_name and pic_phone of each submission's
// lead (null when there is none), as the TS LEFT JOIN did.
func (h *handler) attachLeads(ctx context.Context, rows []*kit.Row) error {
	var ids []string
	for _, row := range rows {
		if id := row.StrPtr("lead_id"); id != nil {
			ids = append(ids, *id)
		}
	}
	leads := map[string]Lead{}
	if len(ids) > 0 {
		var err error
		if leads, err = h.p.Funnel.Leads(ctx, h.db, ids); err != nil {
			return err
		}
	}
	for _, row := range rows {
		lead := leads[row.Str("lead_id")]
		row.Set("org_name", lead.OrgName)
		row.Set("pic_name", lead.PicName)
		row.Set("pic_phone", lead.PicPhone)
	}
	return nil
}

func (h *handler) patchForm(w http.ResponseWriter, r *http.Request) error {
	form, err := h.accessibleForm(r)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseForm(f, true)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	// The slug never changes: shared public URLs would break.
	sets := []string{"updated_at = now()"}
	var values []any
	set := func(col string, v any, cast string) {
		values = append(values, v)
		sets = append(sets, col+" = $"+strconv.Itoa(len(values))+cast)
	}
	setJSON := func(col string, v any) error {
		s, err := jsonText(v)
		if err == nil {
			set(col, s, "::jsonb")
		}
		return err
	}
	if in.Name != nil {
		set("name", *in.Name, "")
	}
	if in.Title != nil {
		set("title", *in.Title, "")
	}
	if in.Description.Set {
		set("description", in.Description.Value, "")
	}
	if in.Fields != nil {
		if err := setJSON("fields", in.Fields); err != nil {
			return err
		}
	}
	if in.SubmitLabel != nil {
		set("submit_label", *in.SubmitLabel, "")
	}
	if in.SuccessMessage != nil {
		set("success_message", *in.SuccessMessage, "")
	}
	if in.RedirectURL.Set {
		set("redirect_url", in.RedirectURL.Value, "")
	}
	if in.DefaultSource != nil {
		set("default_source", *in.DefaultSource, "")
	}
	if in.NotifyUserIDs != nil {
		if err := setJSON("notify_user_ids", in.NotifyUserIDs); err != nil {
			return err
		}
	}
	if in.NotifyNumbers != nil {
		if err := setJSON("notify_numbers", in.NotifyNumbers); err != nil {
			return err
		}
	}
	if in.IsActive != nil {
		set("is_active", *in.IsActive, "")
	}
	if len(values) == 0 {
		return httpx.BadRequest("Tidak ada field yang diubah")
	}
	values = append(values, form.id)
	row, err := kit.QueryOne(r.Context(), h.db, `UPDATE crm.crm_forms SET `+strings.Join(sets, ", ")+
		` WHERE id = $`+strconv.Itoa(len(values))+` RETURNING id, slug, name, is_active`, values...)
	if err != nil {
		return err
	}
	return kit.OK(w, row, "Form diperbarui")
}

func (h *handler) deleteForm(w http.ResponseWriter, r *http.Request) error {
	form, err := h.accessibleForm(r)
	if err != nil {
		return err
	}
	if form.slug == domain.MainFormSlug {
		return httpx.Conflict("Form utama /public tidak bisa dihapus — nonaktifkan saja")
	}
	if _, err := h.db.Exec(r.Context(), `UPDATE crm.crm_forms SET deleted_at = now(), is_active = false WHERE id = $1`, form.id); err != nil {
		return err
	}
	return kit.NoContent(w)
}
