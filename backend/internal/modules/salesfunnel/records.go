package salesfunnel

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Records is the sales-funnel write service other modules call on their own
// querier: CRM's approval sync and decisions, workflow actions and lead
// scoring (crm/advance), and the leads public web forms create
// (crm/publicforms). internal/app adapts these methods to CRM's ports.
type Records struct{}

// Objects whose owner and whitelisted fields CRM workflow actions write.
var recordTables = map[string]string{
	"lead":      "crm.crm_sales_leads",
	"deal":      "crm.crm_sales_deals",
	"account":   "crm.crm_accounts",
	"contact":   "crm.crm_contacts",
	"task":      "crm.crm_sales_activities",
	"quotation": "crm.crm_sales_quotations",
}

func recordTable(object string) (string, error) {
	table, ok := recordTables[object]
	if !ok {
		return "", fmt.Errorf("salesfunnel: unknown object %q", object)
	}
	return table, nil
}

// SetQuotationApprovalStatus sets a quotation's approval_status (an
// approval decision).
func (Records) SetQuotationApprovalStatus(ctx context.Context, q database.Querier, quotationID, status string) error {
	_, err := q.Exec(ctx, `UPDATE crm.crm_sales_quotations SET approval_status = $2 WHERE id = $1`, quotationID, status)
	return err
}

// SetQuotationApproval links a quotation to its discount approval request
// (nil when none is needed) and sets its approval_status.
func (Records) SetQuotationApproval(ctx context.Context, q database.Querier, quotationID, status string, requestID *string) error {
	_, err := q.Exec(ctx, `UPDATE crm.crm_sales_quotations SET approval_status = $2, approval_request_id = $3 WHERE id = $1`,
		quotationID, status, requestID)
	return err
}

// Task is a crm_sales_activities row a workflow create_task action adds.
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

// CreateTask inserts an open task (reminder at the due time) and returns its id.
func (Records) CreateTask(ctx context.Context, q database.Querier, t Task) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO crm.crm_sales_activities
       (company_id, branch_id, lead_id, deal_id, subject_type, subject_id, activity_type, title, notes,
        due_at, reminder_at, status, priority, owner_user_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, 'open', $11, $12, $13)
     RETURNING id::text`,
		t.CompanyID, t.BranchID, t.LeadID, t.DealID, t.SubjectType, t.SubjectID, t.ActivityType, t.Title, t.Notes,
		t.DueAt, t.Priority, t.OwnerUserID, t.CreatedBy).Scan(&id)
	return id, err
}

// SetOwner assigns a record (object: lead, deal, account, contact, task,
// quotation) to a user.
func (Records) SetOwner(ctx context.Context, q database.Querier, object, id, userID string) error {
	table, err := recordTable(object)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE `+table+` SET owner_user_id = $2, updated_at = now() WHERE id = $1`, id, userID)
	return err
}

// UpdateField writes one field the caller whitelisted (never user input as
// a column name). value is the node-postgres text form (nil for NULL); the
// simple protocol lets PostgreSQL coerce it to the column type.
func (Records) UpdateField(ctx context.Context, q database.Querier, object, id, field string, value *string) error {
	table, err := recordTable(object)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE `+table+` SET `+pgx.Identifier{field}.Sanitize()+` = $2, updated_at = now() WHERE id = $1`,
		pgx.QueryExecModeSimpleProtocol, id, value)
	return err
}

// SetLeadScore stores a lead's score and breakdown (JSON text).
func (Records) SetLeadScore(ctx context.Context, q database.Querier, leadID string, score int, breakdown string) error {
	_, err := q.Exec(ctx, `UPDATE crm.crm_sales_leads
     SET score = $2, score_breakdown = $3::text::jsonb, score_updated_at = now()
     WHERE id = $1`, leadID, score, breakdown)
	return err
}

// DuplicateLead is the live lead of the company with this phone and org
// name (case-insensitive), "" when none.
func (Records) DuplicateLead(ctx context.Context, q database.Querier, companyID, phone, orgName string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM crm.crm_sales_leads
		WHERE company_id = $1 AND pic_phone = $2 AND lower(org_name) = lower($3) AND deleted_at IS NULL
		LIMIT 1`, companyID, phone, orgName).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

// AppendLeadNote appends a paragraph to a lead's notes.
func (Records) AppendLeadNote(ctx context.Context, q database.Querier, leadID, note string) error {
	_, err := q.Exec(ctx, `UPDATE crm.crm_sales_leads
		SET notes = COALESCE(notes || E'\n\n', '') || $2, updated_at = now()
		WHERE id = $1`, leadID, note)
	return err
}

// FormLead is a lead a public web form submits (CRM public forms).
type FormLead struct {
	CompanyID                   string
	BranchID                    *string
	OrgName, OrgType, Source    string
	PicName, PicPhone, PicEmail *string
	City, Notes                 *string
	Custom                      string // jsonb text
	UtmSource, UtmMedium        *string
	UtmCampaign, UtmContent     *string
	UtmTerm                     *string
	LandingPage, Referrer       *string
}

// CreateFormLead inserts a 'hangat' / 'baru' lead with its attribution and
// returns its id.
func (Records) CreateFormLead(ctx context.Context, q database.Querier, in FormLead) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO crm.crm_sales_leads
		  (company_id, branch_id, org_name, org_type, pic_name, pic_phone, pic_email, city, notes,
		   source, temperature, status, custom,
		   utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page, referrer)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'hangat', 'baru', $11::jsonb,
		        $12, $13, $14, $15, $16, $17, $18)
		RETURNING id::text`,
		in.CompanyID, in.BranchID, in.OrgName, in.OrgType, in.PicName, in.PicPhone, in.PicEmail, in.City, in.Notes,
		in.Source, in.Custom, in.UtmSource, in.UtmMedium, in.UtmCampaign, in.UtmContent, in.UtmTerm, in.LandingPage, in.Referrer).Scan(&id)
	return id, err
}
