// Package marketing is the CRM marketing area: dynamic segments with RFM,
// WA/in-app campaigns (list, create, start/schedule/pause/resume/cancel,
// funnel report, preview), the campaign sender config and opt-out list, and
// the admin side of public lead forms.
//
// Campaign delivery over WhatsApp is not here: starting a campaign builds
// the recipient queue and the in-app inbox rows; the TS watcher sends WA.
package marketing

import (
	"context"
	"strconv"
	"time"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// Settings reads and writes configuration.app_settings (settings context).
type Settings interface {
	Get(ctx context.Context, q database.Querier, key string) (*string, error)
	Set(ctx context.Context, q database.Querier, key, value string) error
}

// Conversion is a campaign's redeemed voucher count and discount total.
type Conversion struct {
	Count float64
	Value float64
}

// Promo is the promo context: batch vouchers issued while a campaign starts
// (same transaction as the recipient queue) and redemptions for the report.
type Promo interface {
	// IssueCode inserts a single-use code; false when the code already
	// exists in the branch.
	IssueCode(ctx context.Context, q database.Querier, companyID, branchID, promoCampaignID, code string) (bool, error)
	// BatchConversion counts redemptions of the given voucher codes.
	BatchConversion(ctx context.Context, q database.Querier, codes []string) (Conversion, error)
	// PublicConversion counts redemptions of a promo campaign by the given
	// phone numbers.
	PublicConversion(ctx context.Context, q database.Querier, promoCampaignID string, phones []string) (Conversion, error)
}

// SegmentMember is one sample row of a lead or contact segment.
type SegmentMember struct {
	ID    string  `json:"id"`
	Name  *string `json:"name"`
	Phone *string `json:"phone"`
}

// Lead is the sales-funnel lead a form submission created.
type Lead struct {
	OrgName  *string
	PicName  *string
	PicPhone *string
}

// Funnel is the sales-funnel context: lead and contact segment queries
// (built by domain.BuildSegmentQuery over its tables) and the leads behind
// form submissions.
type Funnel interface {
	SegmentCount(ctx context.Context, q database.Querier, sql string, args []any) (int, error)
	SegmentSample(ctx context.Context, q database.Querier, sql string, args []any) ([]SegmentMember, error)
	Leads(ctx context.Context, q database.Querier, ids []string) (map[string]Lead, error)
}

// Ports are the capabilities of other bounded contexts this area uses;
// internal/app/adapters_crm_marketing.go provides them.
type Ports struct {
	Settings Settings
	Promo    Promo
	Funnel   Funnel
}

type handler struct {
	db    database.DB
	auth  *auth.Service
	guard kit.Guard
	now   func() time.Time
	p     Ports
}

func newHandler(db database.DB, a *auth.Service, now func() time.Time, p Ports) *handler {
	return &handler{db: db, auth: a, guard: kit.Guard{Auth: a, DB: db}, now: now, p: p}
}

// Routes mounts the area's routes.
func Routes(d module.Deps, _ *xp.Engine, p Ports) []module.Route {
	return newHandler(d.DB, d.Auth, d.Now, p).routes()
}

func (h *handler) routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/crm/segments", Handler: httpx.Handle(h.listSegments)},
		{Pattern: "POST /api/crm/segments", Handler: httpx.Handle(h.createSegment)},
		{Pattern: "POST /api/crm/segments/preview", Handler: httpx.Handle(h.previewDefinition)},
		{Pattern: "GET /api/crm/segments/{id}", Handler: httpx.Handle(h.getSegment)},
		{Pattern: "PATCH /api/crm/segments/{id}", Handler: httpx.Handle(h.patchSegment)},
		{Pattern: "DELETE /api/crm/segments/{id}", Handler: httpx.Handle(h.deleteSegment)},
		{Pattern: "POST /api/crm/segments/{id}/preview", Handler: httpx.Handle(h.previewSaved)},

		{Pattern: "GET /api/crm/campaigns", Handler: httpx.Handle(h.listCampaigns)},
		{Pattern: "POST /api/crm/campaigns", Handler: httpx.Handle(h.createCampaign)},
		{Pattern: "POST /api/crm/campaigns/preview", Handler: httpx.Handle(h.previewCampaign)},
		{Pattern: "PATCH /api/crm/campaigns/{id}", Handler: httpx.Handle(h.patchCampaign)},
		{Pattern: "GET /api/crm/campaigns/{id}/report", Handler: httpx.Handle(h.campaignReport)},
		{Pattern: "GET /api/crm/campaign-config", Handler: httpx.Handle(h.getCampaignConfig)},
		{Pattern: "PUT /api/crm/campaign-config", Handler: httpx.Handle(h.putCampaignConfig)},
		{Pattern: "GET /api/crm/campaign-optouts", Handler: httpx.Handle(h.listOptouts)},
		{Pattern: "POST /api/crm/campaign-optouts", Handler: httpx.Handle(h.addOptout)},
		{Pattern: "DELETE /api/crm/campaign-optouts", Handler: httpx.Handle(h.removeOptout)},

		{Pattern: "GET /api/crm/forms", Handler: httpx.Handle(h.listForms)},
		{Pattern: "POST /api/crm/forms", Handler: httpx.Handle(h.createForm)},
		{Pattern: "GET /api/crm/forms/{id}", Handler: httpx.Handle(h.formSubmissions)},
		{Pattern: "PATCH /api/crm/forms/{id}", Handler: httpx.Handle(h.patchForm)},
		{Pattern: "DELETE /api/crm/forms/{id}", Handler: httpx.Handle(h.deleteForm)},
	}
}

// companyFilter appends the "company_id IS NULL OR company_id = $n" scope
// the segment and form lists share, when the user has a company.
func companyFilter(where string, params []any, alias string, s *kit.Scope) (string, []any) {
	if s == nil || s.CompanyID == nil {
		return where, params
	}
	params = append(params, *s.CompanyID)
	return where + " AND (" + alias + "company_id IS NULL OR " + alias + "company_id = $" + strconv.Itoa(len(params)) + ")", params
}
