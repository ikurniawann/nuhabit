package salesfunnel

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/members"
	pscope "nuhabit/backend/internal/platform/scope"
)

// user is SalesFunnelUser.
type user struct{ ID, Role string }

const (
	scopeMissing = "Scope bisnis user belum dikonfigurasi — hubungi admin"
	venueMissing = "Venue belum dikonfigurasi — set default_company_id/default_branch_id di CRM Settings atau lengkapi scope bisnis user"
	// venueMissingShort is the contact and member-task message.
	venueMissingShort = "Venue belum dikonfigurasi — lengkapi scope bisnis user atau venue default CRM"
)

// requireUser is requireSalesFunnelUser: a session and the sales-funnel menu.
func (h *handler) requireUser(r *http.Request) (user, error) {
	u, err := h.auth.RequireMenuPrefix(r, iam.SalesFunnel...)
	if err != nil {
		return user{}, err
	}
	return user{ID: u.ID, Role: u.Role}, nil
}

// requireFinance is requireFinanceRole: the accounting menu, or for invoice
// viewers (INVOICE_VIEWER_ROLES) accounting or sales-funnel.
func (h *handler) requireFinance(r *http.Request, viewer bool) (user, error) {
	prefixes := iam.Accounting
	if viewer {
		prefixes = slices.Concat(iam.Accounting, iam.SalesFunnel)
	}
	u, err := h.auth.RequireMenuPrefix(r, prefixes...)
	if err != nil {
		return user{}, err
	}
	return user{ID: u.ID, Role: u.Role}, nil
}

func requireRole(u user, msg string, roles ...string) error {
	if !slices.Contains(roles, u.Role) {
		return httpx.Forbidden(msg)
	}
	return nil
}

// scope is getApiUserScope reduced to what the sales funnel reads.
func (h *handler) scope(ctx context.Context, u user) (domain.Scope, error) {
	sc, err := pscope.Load(ctx, h.db, u.ID)
	if err != nil {
		return domain.Scope{}, err
	}
	return domain.Scope{CompanyID: nonEmpty(sc.CompanyID), BranchID: nonEmpty(sc.BranchID), BusinessScope: sc.BusinessScope}, nil
}

func nonEmpty(p *string) *string {
	if p == nil || *p == "" {
		return nil
	}
	return p
}

// salesScope is requireSalesScope: fail-closed for non-super_admin users
// without a company.
func (h *handler) salesScope(ctx context.Context, u user) (domain.Scope, error) {
	s, err := h.scope(ctx, u)
	if err != nil {
		return s, err
	}
	if !domain.HasCompanyScope(u.Role, s) {
		return s, httpx.Forbidden(scopeMissing)
	}
	return s, nil
}

// venue is resolveSalesVenue: the user's business ids, then the CRM default
// venue for whatever is missing.
func (h *handler) venue(ctx context.Context, s domain.Scope) (companyID, branchID *string, err error) {
	companyID = s.CompanyID
	if s.BusinessScope != nil && *s.BusinessScope == "branch" {
		branchID = s.BranchID
	}
	if companyID != nil && branchID != nil {
		return companyID, branchID, nil
	}
	defCompany, defBranch, err := h.ports.CRM.DefaultVenue(ctx, h.db)
	if err != nil {
		return nil, nil, err
	}
	if companyID == nil {
		companyID = defCompany
	}
	if branchID == nil {
		branchID = defBranch
	}
	return companyID, branchID, nil
}

// requireVenue is requireSalesVenue.
func (h *handler) requireVenue(ctx context.Context, s domain.Scope, msg string) (string, string, error) {
	c, b, err := h.venue(ctx, s)
	if err != nil {
		return "", "", err
	}
	if c == nil || b == nil {
		return "", "", httpx.BadRequest(msg)
	}
	return *c, *b, nil
}

// assignableOwnerError is validateAssignableOwner ("" when valid).
func (h *handler) assignableOwnerError(ctx context.Context, ownerID string, companyID *string) (string, error) {
	role, ownerCompany, found, err := h.ports.Directory.Assignee(ctx, h.db, ownerID)
	if err != nil {
		return "", err
	}
	switch {
	case !found:
		return "Penanggung jawab tidak ditemukan", nil
	case !slices.Contains(domain.SalesFunnelRoles, role):
		return "Penanggung jawab harus user ber-role sales atau super admin", nil
	case companyID != nil && *companyID != "" && ownerCompany != nil && *ownerCompany != *companyID:
		return "Penanggung jawab berada di luar venue lead/deal ini", nil
	}
	return "", nil
}

// assertOwner is assertOwnerAssignable (owner nil or "" skips).
func (h *handler) assertOwner(ctx context.Context, u user, owner any, companyID string) error {
	id, _ := owner.(string)
	if id == "" {
		return nil
	}
	if u.Role == "sales" && id != u.ID {
		return httpx.Forbidden("Role sales hanya boleh menjadi penanggung jawab sendiri")
	}
	msg, err := h.assignableOwnerError(ctx, id, &companyID)
	if err != nil {
		return err
	}
	if msg != "" {
		return httpx.BadRequest(msg)
	}
	return nil
}

// resolveCustom is resolveCustomValues: raw validated against the active
// definitions; with existing (PATCH) the check is partial and merged.
func (h *handler) resolveCustom(ctx context.Context, object string, companyID *string, raw map[string]any, existing map[string]any, partial bool) (string, error) {
	defs, err := h.ports.CRM.CustomFieldDefs(ctx, h.db, object, companyID)
	if err != nil {
		return "", err
	}
	values, errs := domain.ValidateCustomValues(defs, raw, partial)
	if len(errs) > 0 {
		return "", httpx.BadRequest(domain.JoinCustomErrors(errs), errs)
	}
	if partial {
		merged := map[string]any{}
		for k, v := range existing {
			merged[k] = v
		}
		for k, v := range values {
			merged[k] = v
		}
		values = merged
	}
	b, err := json.Marshal(values)
	return string(b), err
}

// existingCustom is loadExistingCustom.
func (h *handler) existingCustom(ctx context.Context, table, id string) (map[string]any, error) {
	var raw []byte
	err := h.db.QueryRow(ctx, `SELECT custom FROM `+table+` WHERE id = $1`, id).Scan(&raw)
	if database.IsNoRows(err) || raw == nil {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return out, nil
}

// requireValidPhone normalises a WhatsApp number or answers 400 msg.
func requireValidPhone(raw, msg string) (string, error) {
	phone := domain.NormalizePhone(raw)
	if !domain.IsValidNormalizedPhone(phone) {
		return "", httpx.BadRequest(msg)
	}
	return phone, nil
}

/* ── Row access (lib/sales-funnel/access.ts) ─────────────────────────── */

// accessible is AccessibleLead/AccessibleDeal: the venue plus, for deals,
// lead_id, stage_id, event_date and value_final as PostgreSQL returned them.
type accessible struct {
	ID string
	domain.Venue
	LeadID, StageID string
	EventDate       any
	ValueFinal      any
}

var accessSQL = map[string]string{
	"lead":     `SELECT id, company_id, branch_id, owner_user_id FROM crm.crm_sales_leads WHERE id = $1 AND deleted_at IS NULL`,
	"deal":     `SELECT id, company_id, branch_id, owner_user_id, lead_id, stage_id, event_date, value_final FROM crm.crm_sales_deals WHERE id = $1 AND deleted_at IS NULL`,
	"activity": `SELECT id, company_id, branch_id, owner_user_id FROM crm.crm_sales_activities WHERE id = $1 AND deleted_at IS NULL`,
	"account":  `SELECT id, company_id, branch_id, owner_user_id FROM crm.crm_accounts WHERE id = $1 AND deleted_at IS NULL`,
	"contact":  `SELECT id, company_id, branch_id, owner_user_id FROM crm.crm_contacts WHERE id = $1 AND deleted_at IS NULL`,
}

// find is findAccessible*: the row (nil when missing) and whether the user
// may not reach it.
func (h *handler) find(ctx context.Context, kind, id string, u user) (*accessible, bool, error) {
	row, err := pgrow.QueryOne(ctx, h.db, accessSQL[kind], id)
	if err != nil {
		return nil, false, err
	}
	s, err := h.scope(ctx, u)
	if err != nil {
		return nil, false, err
	}
	if !domain.HasCompanyScope(u.Role, s) {
		return nil, true, nil
	}
	if row == nil {
		return nil, false, nil
	}
	a := &accessible{ID: row.Str("id"), Venue: domain.Venue{CompanyID: row.Str("company_id"), BranchID: row.Str("branch_id"), OwnerUserID: row.StrPtr("owner_user_id")},
		LeadID: row.Str("lead_id"), StageID: row.Str("stage_id"), EventDate: row.Get("event_date"), ValueFinal: row.Get("value_final")}
	if domain.RowForbidden(u.ID, u.Role, s, a.Venue) {
		return nil, true, nil
	}
	return a, false, nil
}

var notFoundMessages = map[string]string{
	"lead": "Lead tidak ditemukan", "deal": "Deal tidak ditemukan", "activity": "Aktivitas tidak ditemukan",
	"account": "Account tidak ditemukan", "contact": "Contact tidak ditemukan",
}

// require is requireAccessible*: 403 out of reach, 404 missing.
func (h *handler) require(ctx context.Context, kind, id string, u user) (*accessible, error) {
	a, forbidden, err := h.find(ctx, kind, id, u)
	switch {
	case err != nil:
		return nil, err
	case forbidden:
		return nil, httpx.Forbidden("")
	case a == nil:
		return nil, httpx.NotFound(notFoundMessages[kind])
	}
	return a, nil
}

// requireSubject is requireAccessibleSubject: the subject's venue (nil for a
// member, global by design) or 403/404 "Subjek tidak ditemukan".
func (h *handler) requireSubject(ctx context.Context, subjectType, id string, u user) (*accessible, error) {
	if subjectType == "member" {
		m, err := members.Get(ctx, h.db, id)
		if err != nil {
			return nil, err
		}
		if m == nil {
			return nil, httpx.NotFound("Subjek tidak ditemukan")
		}
		return nil, nil
	}
	a, forbidden, err := h.find(ctx, subjectType, id, u)
	switch {
	case err != nil:
		return nil, err
	case forbidden:
		return nil, httpx.Forbidden("")
	case a == nil:
		return nil, httpx.NotFound("Subjek tidak ditemukan")
	}
	return a, nil
}

// requireDealChild is requireDealChildAccess: 404 without the row, then the
// parent deal must be reachable (403 otherwise).
func (h *handler) requireDealChild(ctx context.Context, row *pgrow.Row, u user, notFound string) (*accessible, error) {
	if row == nil {
		return nil, httpx.NotFound(notFound)
	}
	deal, forbidden, err := h.find(ctx, "deal", row.Str("deal_id"), u)
	if err != nil {
		return nil, err
	}
	if forbidden || deal == nil {
		return nil, httpx.Forbidden("")
	}
	return deal, nil
}
