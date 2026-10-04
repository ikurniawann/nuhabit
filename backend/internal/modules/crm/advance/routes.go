// Package advance ports the CRM Advance rules (EPIC-050): quotation discount
// approval rules and the approval inbox, workflow rules and the workflow
// engine the approval decision triggers, lead scoring rules and recalculation,
// and the custom field registry.
package advance

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// SalesFunnel is the sales-funnel context: leads, deals, quotations and
// activities (crm.crm_sales_*), plus the B2B accounts and contacts the
// workflow engine reads and writes. Rows keep their node-postgres shapes.
type SalesFunnel interface {
	// InboxQuotations returns, per quotation id, the quotation, deal and lead
	// columns of the approval inbox (quotations without a deal or lead are
	// absent).
	InboxQuotations(ctx context.Context, q database.Querier, ids []string) (map[string]*kit.Row, error)
	// QuotationLink returns deal_id and quote_number, nil when missing.
	QuotationLink(ctx context.Context, q database.Querier, id string) (*QuotationLink, error)
	// ApprovalSubject returns what approver notifications name, nil when the
	// quotation, its deal or its lead is missing.
	ApprovalSubject(ctx context.Context, q database.Querier, quotationID string) (*ApprovalSubject, error)
	SetQuotationApprovalStatus(ctx context.Context, q database.Querier, id, status string) error

	// Snapshot is the record a workflow rule evaluates (nil when missing or
	// soft-deleted), with owner_name and the joined labels.
	Snapshot(ctx context.Context, q database.Querier, object, id string) (*kit.Row, error)
	CreateTask(ctx context.Context, q database.Querier, t Task) (*string, error)
	SetOwner(ctx context.Context, q database.Querier, object, id, userID string) error
	// UpdateField writes one whitelisted field; value is the node-postgres
	// text form (nil for NULL).
	UpdateField(ctx context.Context, q database.Querier, object, id, field string, value *string) error

	// AffectedLeadID is the lead an event on subjectType touches.
	AffectedLeadID(ctx context.Context, q database.Querier, subjectType, subjectID string) (*string, error)
	LeadVenue(ctx context.Context, q database.Querier, leadID string) (companyID, branchID *string, err error)
	ScoringLead(ctx context.Context, q database.Querier, leadID string) (*ScoringLead, error)
	// DoneTaskCounts counts done activities of the lead (and its deals) per
	// activity_type, within windowDays when set.
	DoneTaskCounts(ctx context.Context, q database.Querier, leadID string, windowDays *int) (map[string]int, error)
	DealCount(ctx context.Context, q database.Querier, leadID string, windowDays *int) (int, error)
	SentQuotationCount(ctx context.Context, q database.Querier, leadID string, windowDays *int) (int, error)
	SetLeadScore(ctx context.Context, q database.Querier, leadID string, score int, breakdown string) error
	// LeadIDs lists live leads, newest first, at most 5000.
	LeadIDs(ctx context.Context, q database.Querier, companyID *string) ([]string, error)
}

// QuotationLink identifies a quotation's deal.
type QuotationLink struct{ DealID, QuoteNumber string }

// ApprovalSubject names the quotation an approval request is about.
type ApprovalSubject struct{ QuoteNumber, DealTitle, OrgName string }

// Task is a crm_sales_activities row created by a create_task action.
type Task struct {
	CompanyID, BranchID    *string
	LeadID, DealID         *string
	SubjectType, SubjectID *string
	ActivityType, Title    string
	Notes                  *string
	DueAt                  time.Time
	Priority               string
	OwnerUserID, CreatedBy *string
}

// ScoringLead is the lead (and account) snapshot lead scoring reads.
type ScoringLead struct {
	ID, CompanyID, PicPhone string
	Score                   int
	// Fields holds source, org_type, temperature, status, city, pic_email,
	// pic_title, account_type and industry (nil for NULL).
	Fields map[string]*string
}

// Notifications writes in-app notifications (public.notifications).
type Notifications interface {
	Notify(ctx context.Context, q database.Querier, userID, title, message string, link *string, metadata string) error
}

// Employees reads HRIS employee contact data.
type Employees interface {
	// Phone is the newest employee phone of a user, nil when none.
	Phone(ctx context.Context, q database.Querier, userID string) (*string, error)
}

// WhatsApp resolves the self-hosted WhatsApp gateway configuration.
type WhatsApp interface {
	// LoadGateway mirrors loadGatewayConfig: nil when no token is set.
	LoadGateway(ctx context.Context, q database.Querier) *Gateway
}

// Ports are the capabilities of other bounded contexts this area uses;
// internal/app/adapters_crm_advance.go provides them. Nil ports fall back
// to the stopgap SQL adapters in this package.
type Ports struct {
	Sales         SalesFunnel
	Notifications Notifications
	Employees     Employees
	WhatsApp      WhatsApp
}

type handler struct {
	db     database.DB
	auth   *auth.Service
	guard  kit.Guard
	ports  Ports
	log    *slog.Logger
	now    func() time.Time
	client *http.Client
}

// Routes mounts the area's routes.
func Routes(d module.Deps, _ *xp.Engine, p Ports) []module.Route {
	return newHandler(d.DB, d, p).routes()
}

func newHandler(db database.DB, d module.Deps, p Ports) *handler {
	now := d.Now
	if now == nil {
		now = time.Now
	}
	log := d.Log
	if log == nil {
		log = slog.Default()
	}
	if p.Sales == nil {
		p.Sales = SalesFunnelSQL{}
	}
	if p.Notifications == nil {
		p.Notifications = NotificationsSQL{}
	}
	if p.Employees == nil {
		p.Employees = EmployeesSQL{}
	}
	if p.WhatsApp == nil {
		p.WhatsApp = WhatsAppSettingsSQL{Getenv: os.Getenv}
	}
	return &handler{db: db, auth: d.Auth, guard: kit.Guard{Auth: d.Auth, DB: db}, ports: p, log: log, now: now, client: &http.Client{}}
}

func (h *handler) routes() []module.Route {
	r := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	return []module.Route{
		r("GET /api/crm/approval-rules", h.listApprovalRules),
		r("POST /api/crm/approval-rules", h.createApprovalRule),
		r("PATCH /api/crm/approval-rules/{id}", h.patchApprovalRule),
		r("DELETE /api/crm/approval-rules/{id}", h.deleteApprovalRule),
		r("GET /api/crm/approvals", h.approvalInbox),
		r("POST /api/crm/approvals/{id}/decide", h.decideApproval),

		r("GET /api/crm/workflow-rules", h.listWorkflowRules),
		r("POST /api/crm/workflow-rules", h.createWorkflowRule),
		r("GET /api/crm/workflow-rules/{id}", h.getWorkflowRule),
		r("PATCH /api/crm/workflow-rules/{id}", h.patchWorkflowRule),
		r("DELETE /api/crm/workflow-rules/{id}", h.deleteWorkflowRule),
		r("GET /api/crm/workflow-rules/{id}/runs", h.workflowRuleRuns),

		r("GET /api/crm/scoring-rules", h.listScoringRules),
		r("POST /api/crm/scoring-rules", h.createScoringRule),
		r("PATCH /api/crm/scoring-rules/{id}", h.patchScoringRule),
		r("DELETE /api/crm/scoring-rules/{id}", h.deleteScoringRule),
		r("POST /api/crm/scoring/recalculate", h.recalculateScores),

		r("GET /api/crm/custom-fields", h.listCustomFields),
		r("POST /api/crm/custom-fields", h.createCustomField),
		r("PATCH /api/crm/custom-fields/{id}", h.patchCustomField),
		r("DELETE /api/crm/custom-fields/{id}", h.deleteCustomField),
	}
}
