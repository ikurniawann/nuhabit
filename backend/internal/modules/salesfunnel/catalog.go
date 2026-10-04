package salesfunnel

import (
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// lib/sales-funnel/catalog-server.ts: owners, catalog, member and material
// search, lost reasons, WhatsApp templates and product recipes.

func (h *handler) listOwners(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	s, err := h.scope(r.Context(), u)
	if err != nil {
		return err
	}
	rows, err := h.ports.Directory.Owners(r.Context(), h.db, s.CompanyID)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) listLostReasons(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireUser(r); err != nil {
		return err
	}
	rows, err := pgrow.Query(r.Context(), h.db, `SELECT id, code, name, sort_order FROM crm.crm_sales_lost_reasons
     WHERE is_active = true
     ORDER BY sort_order ASC, created_at ASC`)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) listProducts(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireUser(r); err != nil {
		return err
	}
	rows, err := h.ports.Catalog.Products(r.Context(), h.db)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) searchCustomers(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	if !h.limiter.allow("sales-funnel-customers:"+u.ID, 30, h.now()) {
		return tooMany("Terlalu banyak pencarian — coba lagi sebentar")
	}
	q := domain.JSTrim(queryStr(r, "q"))
	if validate.UTF16Len(q) < 3 {
		return ok(w, []any{})
	}
	byPhone := domain.NormalizePhone(q)
	if len(byPhone) < 5 {
		byPhone = q
	}
	rows, err := h.ports.Members.Search(r.Context(), h.db, "%"+q+"%", "%"+byPhone+"%")
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) searchRawMaterials(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	if !h.limiter.allow("sales-funnel-raw-materials:"+u.ID, 60, h.now()) {
		return tooMany("Terlalu banyak pencarian — coba lagi sebentar")
	}
	s, err := h.salesScope(r.Context(), u)
	if err != nil {
		return err
	}
	q := domain.JSTrim(queryStr(r, "q"))
	if validate.UTF16Len(q) < 2 {
		return ok(w, []any{})
	}
	var branchID *string
	if s.IsBranch() {
		branchID = s.BranchID
	}
	rows, err := h.ports.Catalog.SearchRawMaterials(r.Context(), h.db, q, s.CompanyID, branchID)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) customFields(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	object := queryStr(r, "object")
	if !domain.Contains(domain.CustomFieldObjects, object) {
		return badRequest("object wajib: lead|deal|account|contact")
	}
	s, err := h.scope(r.Context(), u)
	if err != nil {
		return err
	}
	rows, err := h.ports.CRM.CustomFieldRows(r.Context(), h.db, object, s.CompanyID)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

/* ── Recipes (super_admin) ───────────────────────────────────────────── */

func (h *handler) superAdmin(r *http.Request) (user, error) {
	u, err := h.requireUser(r)
	if err != nil {
		return u, err
	}
	return u, requireRole(u, "", "super_admin")
}

func (h *handler) getRecipe(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.superAdmin(r); err != nil {
		return err
	}
	productID := queryStr(r, "product_id")
	if productID == "" {
		return badRequest("product_id wajib")
	}
	rows, err := h.ports.Catalog.Recipe(r.Context(), h.db, productID)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) putRecipe(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.superAdmin(r); err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	productID := str(f.UUID("product_id", validate.Rule{}))
	var items []RecipeItem
	f.List("items", validate.Rule{}, 50, func(sub *validate.Form, i int, v any) {
		it := sub.Item(i, v)
		item := RecipeItem{RawMaterialID: str(it.UUID("raw_material_id", validate.Rule{}))}
		if n := it.Num("quantity_per_unit", validate.Rule{}, validate.NumOpts{Positive: true, Max: validate.Bound(1_000_000)}); n != nil {
			item.QuantityPerUnit = *n
		}
		if n := it.Num("waste_percentage", validate.Rule{HasDefault: true}, numRange(0, 100)); n != nil {
			item.WastePercentage = *n
		}
		items = append(items, item)
	})
	if err := validationErr(f); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, it := range items {
		seen[it.RawMaterialID] = true
	}
	if len(seen) != len(items) {
		return badRequest("Ada bahan baku yang dobel dalam resep")
	}
	ctx := r.Context()
	if err := database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		return h.ports.Catalog.ReplaceRecipe(ctx, tx, productID, items)
	}); err != nil {
		return err
	}
	return okMsg(w, pgrow.New("product_id", productID, "items", len(items)), "Resep disimpan")
}

/* ── WhatsApp templates (global; super_admin manages) ───────────────── */

func (h *handler) listWaTemplates(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireUser(r); err != nil {
		return err
	}
	rows, err := pgrow.Query(r.Context(), h.db, `SELECT id, name, body, is_active, created_at
     FROM crm.crm_sales_wa_templates
     WHERE is_active = true
     ORDER BY name ASC`)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func parseWaTemplate(f *validate.Form, partial bool) *domain.Fields {
	body := domain.NewFields()
	for _, c := range []struct {
		key string
		max int
	}{{"name", 100}, {"body", 2000}} {
		if partial {
			patchStr(f, body, c.key, false, trimRange(1, c.max))
		} else {
			body.Set(c.key, str(f.Str(c.key, validate.Rule{}, trimRange(1, c.max))))
		}
	}
	return body
}

func (h *handler) createWaTemplate(w http.ResponseWriter, r *http.Request) error {
	u, err := h.superAdmin(r)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	body := parseWaTemplate(f, false)
	if err := validationErr(f); err != nil {
		return err
	}
	row, err := pgrow.QueryOne(r.Context(), h.db, `INSERT INTO crm.crm_sales_wa_templates (name, body, created_by)
     VALUES ($1, $2, $3)
     RETURNING id, name, body, is_active`, body.Get("name"), body.Get("body"), u.ID)
	if err != nil {
		return err
	}
	return created(w, row, "Template dibuat")
}

func (h *handler) updateWaTemplate(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.superAdmin(r); err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	body := parseWaTemplate(f, true)
	if err := validationErr(f); err != nil {
		return err
	}
	set := domain.NewUpdateSet()
	body.Each(func(k string, v any) { set.Set(k, v, "") })
	sql, values, idParam, okSet := set.Build(r.PathValue("id"))
	if !okSet {
		return badRequest(domain.NoFieldsChanged)
	}
	row, err := pgrow.QueryOne(r.Context(), h.db, `UPDATE crm.crm_sales_wa_templates SET `+sql+`
     WHERE id = `+idParam+` AND is_active = true
     RETURNING id, name, body, is_active`, values...)
	if err != nil {
		return err
	}
	if row == nil {
		return httpx.NotFound("Template tidak ditemukan")
	}
	return okMsg(w, row, "Template diperbarui")
}

func (h *handler) deleteWaTemplate(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.superAdmin(r); err != nil {
		return err
	}
	id, err := scanID(r.Context(), h.db, `UPDATE crm.crm_sales_wa_templates
     SET is_active = false, updated_at = now()
     WHERE id = $1 AND is_active = true RETURNING id::text`, r.PathValue("id"))
	if err != nil {
		return err
	}
	if id == nil {
		return httpx.NotFound("Template tidak ditemukan")
	}
	return noContent(w)
}
