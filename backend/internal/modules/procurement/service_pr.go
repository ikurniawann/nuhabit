package procurement

import (
	"context"
	"encoding/json"
	"math"
	"strconv"

	"github.com/jackc/pgx/v5"

	contracts "nuhabit/backend/internal/contracts/procurement"
	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
	pscope "nuhabit/backend/internal/platform/scope"
)

// Port of lib/purchasing/pr-queries.ts, pr-workflow.ts and pr-convert.ts.

// Scope is getApiUserScope for the signed-in user.
func (s *Service) Scope(ctx context.Context, userID string) (*pscope.Scope, error) {
	return pscope.Load(ctx, s.db, userID)
}

func uniqueStrings(values ...[]string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, list := range values {
		for _, v := range list {
			if v != "" && !seen[v] {
				seen[v] = true
				out = append(out, v)
			}
		}
	}
	return out
}

func column(rows []*Row, key string) []string {
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		if v := r.Str(key); v != "" {
			out = append(out, v)
		}
	}
	return out
}

/* ── List ────────────────────────────────────────────────────────────── */

// PrListParams are the GET /pr query params.
type PrListParams struct {
	Status, Search, DepartmentID *string
	ModuleType                   string
	Page, Limit                  int
}

// Pagination is the PR list pagination block (camelCase totalPages).
type Pagination struct {
	Page       int `json:"page"`
	Limit      int `json:"limit"`
	Total      int `json:"total"`
	TotalPages any `json:"totalPages"`
}

// PrList is the GET /pr body (no success wrapper).
type PrList struct {
	Data       []*Row     `json:"data"`
	Pagination Pagination `json:"pagination"`
}

// totalPages is Math.ceil(total / limit) as JSON.stringify writes it
// (Infinity and NaN become null).
func totalPages(total, limit int) any {
	v := math.Ceil(float64(total) / float64(limit))
	if math.IsInf(v, 0) || math.IsNaN(v) {
		return nil
	}
	return v
}

// ListPurchaseRequests is listPurchaseRequests.
func (s *Service) ListPurchaseRequests(ctx context.Context, p PrListParams, scope *pscope.Scope, user *auth.User) (*PrList, error) {
	w := newWhere()
	if c := pscope.CompanyFilter(scope); c != nil {
		w.add("company_id = %s::text::uuid", *c)
	}
	if b := pscope.BranchFilter(scope); b != nil {
		w.add("branch_id = %s::text::uuid", *b)
	}
	if p.Status != nil && *p.Status != "" && *p.Status != "all" {
		w.add("status = %s", *p.Status)
	}
	if p.Search != nil && *p.Search != "" {
		w.add("pr_number ILIKE %s", "%"+*p.Search+"%")
	}
	if p.DepartmentID != nil && *p.DepartmentID != "" {
		w.add("department_id = %s::text::uuid", *p.DepartmentID)
	}
	if p.ModuleType == "raw_material" || p.ModuleType == "product" || p.ModuleType == "general" {
		w.add("module_type = %s", p.ModuleType)
	}
	if domain.SeesOnlyOwnPrs(user.Role) {
		w.add("requester_id = %s::text::uuid", user.ID)
	}

	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM purchase_requests `+w.sql(), w.args...).Scan(&total); err != nil {
		return nil, err
	}
	from := (p.Page - 1) * p.Limit
	args := append(append([]any{}, w.args...), p.Limit, from)
	rows, err := s.rows.Query(ctx, s.db, `SELECT *, `+prItemsEmbed+` FROM purchase_requests `+w.sql()+
		` ORDER BY created_at DESC LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	users, err := s.ports.Directory.Users(ctx, s.db, uniqueStrings(column(rows, "requester_id")))
	if err != nil {
		return nil, err
	}
	departments, err := s.ports.Directory.DepartmentNames(ctx, s.db, uniqueStrings(column(rows, "department_id")))
	if err != nil {
		return nil, err
	}
	for _, pr := range rows {
		if u, ok := users[pr.Str("requester_id")]; ok {
			pr.Set("requester_name", u.FullName)
		}
		if name, ok := departments[pr.Str("department_id")]; ok {
			pr.Set("department_name", name)
		}
	}
	return &PrList{Data: rows, Pagination: Pagination{Page: p.Page, Limit: p.Limit, Total: total, TotalPages: totalPages(total, p.Limit)}}, nil
}

// prItemsEmbed is the query-builder embed `items:pr_items(*)`.
const prItemsEmbed = `COALESCE((SELECT json_agg(e) FROM (SELECT * FROM "purchasing"."pr_items" WHERE "pr_id" = "purchase_requests"."id") e), '[]'::json) AS "items"`

// ListPrsForPo is listPrsEligibleForPo.
func (s *Service) ListPrsForPo(ctx context.Context, moduleType string, scope *pscope.Scope) ([]*Row, error) {
	prs, err := s.rows.Query(ctx, s.db, `SELECT *, `+prItemsEmbed+` FROM purchase_requests
		WHERE status = 'approved' AND module_type = $1 AND converted_po_id IS NULL
		ORDER BY created_at DESC LIMIT 200`, moduleType)
	if err != nil {
		return nil, err
	}
	users, err := s.ports.Directory.Users(ctx, s.db, uniqueStrings(column(prs, "requester_id")))
	if err != nil {
		return nil, err
	}
	scoped := make([]*Row, 0, len(prs))
	for _, pr := range prs {
		if scope == nil || scope.Unscoped {
			scoped = append(scoped, pr)
			continue
		}
		company, branch := pr.StrPtr("company_id"), pr.StrPtr("branch_id")
		if u, ok := users[pr.Str("requester_id")]; ok {
			if company == nil {
				company = u.CompanyID
			}
			if branch == nil {
				branch = u.BranchID
			}
		}
		if pscope.RowInScope(scope, company, branch) {
			scoped = append(scoped, pr)
		}
	}

	linked := map[string]bool{}
	rows, err := s.db.Query(ctx, `SELECT pr_id::text FROM purchase_orders WHERE NOT (pr_id IS NULL) AND is_active = true`)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		linked[id] = true
	}
	eligible := make([]*Row, 0, len(scoped))
	for _, pr := range scoped {
		if !linked[pr.Str("id")] {
			eligible = append(eligible, pr)
		}
	}
	departments, err := s.ports.Directory.DepartmentNames(ctx, s.db, uniqueStrings(column(eligible, "department_id")))
	if err != nil {
		return nil, err
	}
	for _, pr := range eligible {
		var dept, requester any
		if name, ok := departments[pr.Str("department_id")]; ok && name != "" {
			dept = name
		}
		if u, ok := users[pr.Str("requester_id")]; ok && u.FullName != nil && *u.FullName != "" {
			requester = *u.FullName
		}
		pr.Set("department_name", dept)
		pr.Set("requester_name", requester)
	}
	return eligible, nil
}

/* ── Detail ──────────────────────────────────────────────────────────── */

// PurchaseRequestDetail is getPurchaseRequestDetail.
func (s *Service) PurchaseRequestDetail(ctx context.Context, id string, user *auth.User, hasApprovalGrant bool) (*Row, error) {
	pr, err := s.rows.One(ctx, s.db, `SELECT * FROM purchase_requests WHERE id = $1::text::uuid`, id)
	if err != nil || pr == nil {
		if err != nil {
			s.log.ErrorContext(ctx, "Error fetching PR header", "error", pgMessage(err))
		}
		return nil, notFound("PR tidak ditemukan")
	}
	items, err := s.rows.Query(ctx, s.db, `SELECT * FROM pr_items WHERE pr_id = $1::text::uuid`, id)
	if err != nil {
		return nil, err
	}
	refs := map[string]map[string]json.RawMessage{}
	for _, ref := range []struct {
		key    string
		entity Entity
		cols   string
	}{
		{"raw_material_id", EntityRawMaterial, "id, kode, nama"},
		{"satuan_id", EntityUnit, "id, nama"},
		{"product_id", EntityProduct, "id, kode, nama"},
		{"supply_item_id", EntitySupplyItem, "id, kode, nama"},
	} {
		m, err := s.ports.Catalog.Refs(ctx, s.db, ref.entity, ref.cols, uniqueStrings(column(items, ref.key)))
		if err != nil {
			return nil, err
		}
		refs[ref.key] = m
	}
	for _, item := range items {
		item.Set("raw_material", refOrNull(refs["raw_material_id"], item.Str("raw_material_id")))
		item.Set("satuan", refOrNull(refs["satuan_id"], item.Str("satuan_id")))
		item.Set("product", refOrNull(refs["product_id"], item.Str("product_id")))
		item.Set("supply_item", refOrNull(refs["supply_item_id"], item.Str("supply_item_id")))
	}

	keys := []string{"approved_by_head", "approved_by_finance", "approved_by_direksi", "rejected_by"}
	userIDs := []string{pr.Str("requester_id")}
	for _, k := range keys {
		userIDs = append(userIDs, pr.Str(k))
	}
	users, err := s.ports.Directory.Users(ctx, s.db, uniqueStrings(userIDs))
	if err != nil {
		return nil, err
	}
	var department any
	if dept := pr.Str("department_id"); dept != "" {
		d, err := s.ports.Directory.Department(ctx, s.db, dept)
		if err != nil {
			return nil, err
		}
		if d != nil {
			department = d
		}
	}

	pr.Set("items", items)
	pr.Set("department", department)
	requester := "-"
	if u, ok := users[pr.Str("requester_id")]; ok && u.FullName != nil && *u.FullName != "" {
		requester = *u.FullName
	}
	pr.Set("requester_name", requester)
	for i, name := range []string{"approved_head_name", "approved_finance_name", "approved_direksi_name", "rejected_by_name"} {
		userID := pr.Str(keys[i])
		if userID == "" {
			pr.Set(name, nil)
			continue
		}
		if u, ok := users[userID]; ok {
			pr.Set(name, u.FullName)
		}
	}
	pr.Set("permissions", domain.BuildPrPermissions(pr.Str("status"), pr.Str("requester_id"), pr.StrPtr("converted_po_id"), user.ID, user.Role, hasApprovalGrant))
	return pr, nil
}

// refOrNull is `id ? map.get(id) ?? null : null` for an embedded ref.
func refOrNull(m map[string]json.RawMessage, id string) any {
	if id == "" {
		return nil
	}
	if raw, ok := m[id]; ok {
		return jsJSON(raw)
	}
	return nil
}

/* ── Form data ───────────────────────────────────────────────────────── */

// PrFormData loads the PR form choices for a module type.
func (s *Service) PrFormData(ctx context.Context, moduleType string, scope *pscope.Scope) (any, error) {
	departments, err := s.ports.Directory.ActiveDepartments(ctx, s.db)
	if err != nil {
		departments = []*Row{}
	}
	units, err := s.ports.Catalog.ActiveUnits(ctx, s.db, "id, nama")
	if err != nil {
		units = []*Row{}
	}
	company, branch := pscope.CompanyFilter(scope), pscope.BranchFilter(scope)
	switch moduleType {
	case "product":
		products, err := s.ports.Catalog.FormProducts(ctx, s.db, company, branch)
		if err != nil {
			products = []*Row{}
		}
		return struct {
			Departments []*Row `json:"departments"`
			Products    []*Row `json:"products"`
			Units       []*Row `json:"units"`
		}{departments, products, units}, nil
	case "general":
		supplies, err := s.ports.Catalog.FormSupplies(ctx, s.db, company, branch)
		if err != nil {
			supplies = []*Row{}
		}
		return struct {
			Departments []*Row `json:"departments"`
			Supplies    []*Row `json:"supplies"`
			Units       []*Row `json:"units"`
		}{departments, supplies, units}, nil
	}
	materials, err := s.ports.Catalog.FormMaterials(ctx, s.db)
	if err != nil {
		materials = []*Row{}
	}
	return struct {
		Departments []*Row `json:"departments"`
		Materials   []*Row `json:"materials"`
		Units       []*Row `json:"units"`
	}{departments, materials, units}, nil
}

/* ── Writes ──────────────────────────────────────────────────────────── */

// nextNumber is generatePRNumber / generatePONumber: the last number with
// the prefix, ordered descending, plus one.
func (s *Service) nextNumber(ctx context.Context, q database.Querier, table, col, prefix string) (string, error) {
	var last *string
	err := q.QueryRow(ctx, `SELECT `+col+` FROM `+table+` WHERE `+col+` ILIKE $1 ORDER BY `+col+` DESC LIMIT 1`, prefix+"-%").Scan(&last)
	if err != nil && !database.IsNoRows(err) {
		return "", err
	}
	return domain.NextDocumentNumber(prefix, last), nil
}

// CreatePurchaseRequest is createPurchaseRequest.
func (s *Service) CreatePurchaseRequest(ctx context.Context, body any, user *auth.User, scope *pscope.Scope) (*Row, error) {
	moduleType := domain.ModuleType(bodyString(body, "module_type"))
	write, err := parsePrWrite(body, moduleType)
	if err != nil {
		return nil, err
	}
	var pr *Row
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		number, err := s.nextNumber(ctx, tx, "purchase_requests", "pr_number", domain.DailyPrefix("PR", s.now().In(s.loc)))
		if err != nil {
			return err
		}
		pr, err = s.rows.One(ctx, tx, `INSERT INTO purchase_requests
			(pr_number, requester_id, company_id, branch_id, department_id, status, total_amount, priority, notes, required_date, module_type, current_approval_level)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
			number, user.ID, pscope.EffectiveCompanyID(scope), pscope.EffectiveBranchID(scope), write.DepartmentID,
			write.Status, write.Total, write.Priority, write.Notes, write.RequiredDate, moduleType, domain.ApprovalLevelFor(write.Status))
		if err != nil {
			return prWriteError(err, "Gagal menyimpan header PR")
		}
		if err := insertPrItems(ctx, tx, pr.Str("id"), write.Items); err != nil {
			return prWriteError(err, "Gagal menyimpan item PR")
		}
		return s.publishUrgent(ctx, tx, pr.Str("id"), number, write, user.FullName)
	})
	if err != nil {
		return nil, err
	}
	return pr, nil
}

// prWriteError is `ApiError.badRequest(extractPrErrorMessage(error))` for a
// query error; anything that is not a database error passes through.
func prWriteError(err error, fallback string) error {
	if !isPgError(err) {
		return err
	}
	msg := pgMessage(err)
	if msg == "" {
		msg = fallback
	}
	return badRequest(domain.MapPrPgErrorMessage(msg))
}

func insertPrItems(ctx context.Context, q database.Querier, prID string, items []prItemInput) error {
	for _, item := range items {
		_, err := q.Exec(ctx, `INSERT INTO pr_items
			(pr_id, product_id, raw_material_id, supply_item_id, satuan_id, description, qty, unit, estimated_price, total)
			VALUES ($1, $2::text::uuid, $3::text::uuid, $4::text::uuid, $5::text::uuid, $6, $7, $8, $9, $10)`,
			prID, item.ProductID, item.RawMaterialID, item.SupplyItemID, item.SatuanID,
			item.Description, item.Line.Qty, item.Unit, item.Line.EstimatedPrice, item.Line.Total)
		if err != nil {
			return err
		}
	}
	return nil
}

// publishUrgent is notifyIfUrgent: the WhatsApp alert goes through the outbox.
func (s *Service) publishUrgent(ctx context.Context, tx pgx.Tx, prID, prNumber string, write *prWrite, requesterName string) error {
	if !domain.IsUrgentPriority(write.Priority) {
		return nil
	}
	items := make([]contracts.PurchaseRequestUrgentItem, len(write.Items))
	for i, item := range write.Items {
		unit := item.Unit
		items[i] = contracts.PurchaseRequestUrgentItem{Description: item.Description, Qty: item.Line.Qty, Unit: &unit}
	}
	return outbox.Publish(ctx, tx, contracts.TopicPurchaseRequestUrgent, prID, contracts.PurchaseRequestUrgent{
		PrID: prID, PrNumber: prNumber, Priority: write.Priority, Status: write.Status,
		RequesterName: requesterName, DepartmentID: &write.DepartmentID, TotalAmount: write.Total,
		RequiredDate: write.RequiredDate, Notes: write.Notes, Items: items,
		DedupKey: prID + ":" + write.Status,
	})
}

// UpdatePurchaseRequest is updatePurchaseRequest: replace header and items of
// a draft PR.
func (s *Service) UpdatePurchaseRequest(ctx context.Context, id string, body any, user *auth.User) (map[string]string, error) {
	existing, err := s.rows.One(ctx, s.db, `SELECT id, pr_number, requester_id, status, module_type FROM purchase_requests WHERE id = $1::text::uuid`, id)
	if err != nil || existing == nil {
		return nil, notFound("PR tidak ditemukan")
	}
	write, err := parsePrWrite(body, domain.ModuleType(existing.Str("module_type")))
	if err != nil {
		return nil, err
	}
	if !domain.CanEditPrOf(existing.Str("requester_id"), user.ID, user.Role) {
		return nil, forbidden("Anda tidak memiliki akses mengubah PR ini")
	}
	if existing.Str("status") != domain.PrDraft {
		return nil, badRequest("Hanya PR draft yang bisa diedit")
	}
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM pr_items WHERE pr_id = $1`, existing.Str("id")); err != nil {
			return err
		}
		if err := insertPrItems(ctx, tx, existing.Str("id"), write.Items); err != nil {
			return prWriteError(err, "Gagal mengubah PR")
		}
		if _, err := tx.Exec(ctx, `UPDATE purchase_requests SET department_id = $2, priority = $3, required_date = $4,
			notes = $5, total_amount = $6, status = $7, current_approval_level = $8, updated_at = $9 WHERE id = $1`,
			existing.Str("id"), write.DepartmentID, write.Priority, write.RequiredDate, write.Notes, write.Total,
			write.Status, domain.ApprovalLevelFor(write.Status), s.now()); err != nil {
			return err
		}
		number := existing.Str("pr_number")
		if number == "" {
			number = id
		}
		return s.publishUrgent(ctx, tx, existing.Str("id"), number, write, user.FullName)
	})
	if err != nil {
		return nil, err
	}
	return map[string]string{"id": id, "status": write.Status}, nil
}

// SubmitPurchaseRequest is submitPurchaseRequest.
func (s *Service) SubmitPurchaseRequest(ctx context.Context, id string, user *auth.User) (*Row, error) {
	pr, err := s.rows.One(ctx, s.db, `SELECT * FROM purchase_requests WHERE id = $1::text::uuid`, id)
	if err != nil || pr == nil {
		return nil, notFound("PR tidak ditemukan")
	}
	if pr.Str("requester_id") != user.ID {
		return nil, forbidden("Anda tidak memiliki akses")
	}
	if pr.Str("status") != domain.PrDraft {
		return nil, badRequest("Hanya PR dengan status draft yang bisa disubmit")
	}
	return s.rows.One(ctx, s.db, `UPDATE purchase_requests SET status = 'pending_head', current_approval_level = 'head_dept',
		updated_at = $2 WHERE id = $1 RETURNING *`, pr.Str("id"), s.now())
}

// PrDecision is prDecisionSchema.
type PrDecision struct {
	Action string
	Reason *string
}

// DecidePurchaseRequest is decidePurchaseRequest.
func (s *Service) DecidePurchaseRequest(ctx context.Context, id string, d PrDecision, user *auth.User) (*Row, error) {
	pr, err := s.rows.One(ctx, s.db, `SELECT * FROM purchase_requests WHERE id = $1::text::uuid`, id)
	if err != nil || pr == nil {
		return nil, notFound("PR tidak ditemukan")
	}
	status := pr.Str("status")
	if domain.IsFinalPr(status) {
		return nil, badRequest("PR sudah final")
	}
	if !domain.IsAwaitingPrApproval(status) {
		return nil, forbidden("Anda tidak memiliki akses untuk melakukan approval")
	}
	now := s.now()
	if d.Action == "approve" {
		company, branch := pr.StrPtr("company_id"), pr.StrPtr("branch_id")
		if company == nil || branch == nil {
			users, err := s.ports.Directory.Users(ctx, s.db, []string{pr.Str("requester_id")})
			if err != nil {
				users = nil
			}
			scope, err := s.Scope(ctx, user.ID)
			if err != nil {
				return nil, err
			}
			requester := users[pr.Str("requester_id")]
			company = firstNonNil(company, requester.CompanyID, pscope.EffectiveCompanyID(scope))
			branch = firstNonNil(branch, requester.BranchID, pscope.EffectiveBranchID(scope))
		}
		return s.rows.One(ctx, s.db, `UPDATE purchase_requests SET updated_at = $2, approved_by_head = $3, approved_at_head = $2,
			status = 'approved', current_approval_level = NULL, company_id = $4, branch_id = $5 WHERE id = $1 RETURNING *`,
			pr.Str("id"), now, user.ID, company, branch)
	}
	var reason *string
	if d.Reason != nil && *d.Reason != "" {
		reason = d.Reason
	}
	return s.rows.One(ctx, s.db, `UPDATE purchase_requests SET updated_at = $2, status = 'rejected', rejected_by = $3,
		rejected_at = $2, rejection_reason = $4 WHERE id = $1 RETURNING *`, pr.Str("id"), now, user.ID, reason)
}

func firstNonNil(values ...*string) *string {
	for _, v := range values {
		if v != nil {
			return v
		}
	}
	return nil
}

// RevisePurchaseRequest copies a rejected PR into a new draft.
func (s *Service) RevisePurchaseRequest(ctx context.Context, id string, user *auth.User) (map[string]string, error) {
	pr, err := s.rows.One(ctx, s.db, `SELECT id, status, requester_id FROM purchase_requests WHERE id = $1::text::uuid`, id)
	if err != nil || pr == nil {
		return nil, notFound("PR tidak ditemukan")
	}
	if pr.Str("status") != domain.PrRejected {
		return nil, badRequest("Hanya PR rejected yang bisa direvisi")
	}
	if !domain.CanEditPrOf(pr.Str("requester_id"), user.ID, user.Role) {
		return nil, forbidden("Anda tidak memiliki akses membuat revisi PR ini")
	}
	var newID string
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		number, err := s.nextNumber(ctx, tx, "purchase_requests", "pr_number", domain.DailyPrefix("PR", s.now().In(s.loc)))
		if err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `INSERT INTO purchase_requests
			(pr_number, requester_id, department_id, status, total_amount, priority, notes, required_date, module_type, company_id, branch_id, current_approval_level)
			SELECT $2, $3, department_id, 'draft', total_amount, priority, NULLIF(notes, ''), required_date,
			       COALESCE(module_type, 'raw_material'), company_id, branch_id, NULL
			FROM purchase_requests WHERE id = $1 RETURNING id::text`, pr.Str("id"), number, user.ID).Scan(&newID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO pr_items
			(pr_id, product_id, raw_material_id, supply_item_id, satuan_id, description, qty, unit, estimated_price, total)
			SELECT $2, product_id, raw_material_id, supply_item_id, satuan_id, description, qty, unit, estimated_price, total
			FROM pr_items WHERE pr_id = $1`, pr.Str("id"), newID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return map[string]string{"id": newID}, nil
}

// bodyString is `(body as { key?: string } | null)?.key` for a string value.
func bodyString(body any, key string) string {
	m, ok := body.(map[string]any)
	if !ok {
		return ""
	}
	v, _ := m[key].(string)
	return v
}
