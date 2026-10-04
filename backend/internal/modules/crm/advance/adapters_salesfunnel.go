package advance

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
)

// SalesFunnelSQL is a stopgap adapter: moves to the sales-funnel context
// (in no migration wave yet). SQL ported from lib/crm/approvals-server.ts,
// workflow-engine.ts, events.ts and scoring-server.ts. It writes
// quotation approval status, lead scores, tasks, owners and whitelisted
// fields of sales-funnel records.
type SalesFunnelSQL struct{}

var _ SalesFunnel = SalesFunnelSQL{}

func (SalesFunnelSQL) InboxQuotations(ctx context.Context, q database.Querier, ids []string) (map[string]*kit.Row, error) {
	rows, err := kit.Query(ctx, q, `SELECT q.id, q.quote_number, q.total, q.subtotal, q.discount_nominal, q.status AS quotation_status,
            d.id AS deal_id, d.title AS deal_title, l.org_name, l.pic_name
     FROM crm.crm_sales_quotations q
     JOIN crm.crm_sales_deals d ON d.id = q.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     WHERE q.id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[string]*kit.Row, len(rows))
	for _, r := range rows {
		out[r.Str("id")] = r
	}
	return out, nil
}

func (SalesFunnelSQL) QuotationLink(ctx context.Context, q database.Querier, id string) (*QuotationLink, error) {
	var l QuotationLink
	err := q.QueryRow(ctx, `SELECT deal_id::text, quote_number FROM crm.crm_sales_quotations WHERE id = $1`, id).Scan(&l.DealID, &l.QuoteNumber)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

func (SalesFunnelSQL) ApprovalSubject(ctx context.Context, q database.Querier, quotationID string) (*ApprovalSubject, error) {
	var s ApprovalSubject
	err := q.QueryRow(ctx, `SELECT q.quote_number, d.title, l.org_name
     FROM crm.crm_sales_quotations q
     JOIN crm.crm_sales_deals d ON d.id = q.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     WHERE q.id = $1`, quotationID).Scan(&s.QuoteNumber, &s.DealTitle, &s.OrgName)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (SalesFunnelSQL) SetQuotationApprovalStatus(ctx context.Context, q database.Querier, id, status string) error {
	_, err := q.Exec(ctx, `UPDATE crm.crm_sales_quotations SET approval_status = $2 WHERE id = $1`, id, status)
	return err
}

var snapshotSQL = map[string]string{
	"lead": `SELECT l.*, u.full_name AS owner_name, a.name AS account_name,
                (SELECT max(COALESCE(x.done_at, x.created_at)) FROM crm.crm_sales_activities x
                  WHERE x.deleted_at IS NULL AND (x.lead_id = l.id OR (x.subject_type='lead' AND x.subject_id = l.id))) AS last_activity_at
         FROM crm.crm_sales_leads l
         LEFT JOIN configuration.users u ON u.id = l.owner_user_id
         LEFT JOIN crm.crm_accounts a ON a.id = l.account_id
         WHERE l.id = $1 AND l.deleted_at IS NULL`,
	"deal": `SELECT d.*, u.full_name AS owner_name, s.name AS stage_name, s.code AS stage_code,
                s.is_won, s.is_lost, l.org_name, l.pic_name, l.pic_phone, l.source, l.org_type,
                (SELECT max(COALESCE(x.done_at, x.created_at)) FROM crm.crm_sales_activities x
                  WHERE x.deleted_at IS NULL AND x.deal_id = d.id) AS last_activity_at
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_leads l ON l.id = d.lead_id
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         LEFT JOIN configuration.users u ON u.id = d.owner_user_id
         WHERE d.id = $1 AND d.deleted_at IS NULL`,
	"account": `SELECT a.*, u.full_name AS owner_name
            FROM crm.crm_accounts a LEFT JOIN configuration.users u ON u.id = a.owner_user_id
            WHERE a.id = $1 AND a.deleted_at IS NULL`,
	"contact": `SELECT c.*, u.full_name AS owner_name, a.name AS account_name
            FROM crm.crm_contacts c
            LEFT JOIN configuration.users u ON u.id = c.owner_user_id
            LEFT JOIN crm.crm_accounts a ON a.id = c.account_id
            WHERE c.id = $1 AND c.deleted_at IS NULL`,
	"task": `SELECT t.*, u.full_name AS owner_name
         FROM crm.crm_sales_activities t LEFT JOIN configuration.users u ON u.id = t.owner_user_id
         WHERE t.id = $1 AND t.deleted_at IS NULL`,
	"quotation": `SELECT q.*, d.title AS deal_title, d.owner_user_id, u.full_name AS owner_name,
                     l.org_name, l.pic_name, l.pic_phone
              FROM crm.crm_sales_quotations q
              JOIN crm.crm_sales_deals d ON d.id = q.deal_id
              JOIN crm.crm_sales_leads l ON l.id = d.lead_id
              LEFT JOIN configuration.users u ON u.id = d.owner_user_id
              WHERE q.id = $1 AND q.deleted_at IS NULL`,
}

var tableByObject = map[string]string{
	"lead":      "crm.crm_sales_leads",
	"deal":      "crm.crm_sales_deals",
	"account":   "crm.crm_accounts",
	"contact":   "crm.crm_contacts",
	"task":      "crm.crm_sales_activities",
	"quotation": "crm.crm_sales_quotations",
}

func (SalesFunnelSQL) Snapshot(ctx context.Context, q database.Querier, object, id string) (*kit.Row, error) {
	sql, ok := snapshotSQL[object]
	if !ok {
		return nil, nil
	}
	return kit.QueryOne(ctx, q, sql, id)
}

func (SalesFunnelSQL) CreateTask(ctx context.Context, q database.Querier, t Task) (*string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO crm.crm_sales_activities
       (company_id, branch_id, lead_id, deal_id, subject_type, subject_id, activity_type, title, notes,
        due_at, reminder_at, status, priority, owner_user_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, 'open', $11, $12, $13)
     RETURNING id::text`,
		t.CompanyID, t.BranchID, t.LeadID, t.DealID, t.SubjectType, t.SubjectID, t.ActivityType, t.Title, t.Notes,
		t.DueAt, t.Priority, t.OwnerUserID, t.CreatedBy).Scan(&id)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func (SalesFunnelSQL) SetOwner(ctx context.Context, q database.Querier, object, id, userID string) error {
	_, err := q.Exec(ctx, `UPDATE `+tableByObject[object]+` SET owner_user_id = $2, updated_at = now() WHERE id = $1`, id, userID)
	return err
}

// UpdateField runs on the simple protocol so the value reaches PostgreSQL
// as an untyped literal, coerced to the column type like node-postgres'
// text parameters.
func (SalesFunnelSQL) UpdateField(ctx context.Context, q database.Querier, object, id, field string, value *string) error {
	_, err := q.Exec(ctx, `UPDATE `+tableByObject[object]+` SET `+field+` = $2, updated_at = now() WHERE id = $1`,
		pgx.QueryExecModeSimpleProtocol, id, value)
	return err
}

func (SalesFunnelSQL) AffectedLeadID(ctx context.Context, q database.Querier, subjectType, subjectID string) (*string, error) {
	var sql string
	switch subjectType {
	case "lead":
		return &subjectID, nil
	case "deal":
		sql = `SELECT lead_id::text FROM crm.crm_sales_deals WHERE id = $1`
	case "task":
		sql = `SELECT COALESCE(a.lead_id,
                  CASE WHEN a.subject_type = 'lead' THEN a.subject_id END,
                  (SELECT d.lead_id FROM crm.crm_sales_deals d WHERE d.id = a.deal_id))::text
       FROM crm.crm_sales_activities a WHERE a.id = $1`
	case "quotation":
		sql = `SELECT d.lead_id::text FROM crm.crm_sales_quotations q JOIN crm.crm_sales_deals d ON d.id = q.deal_id WHERE q.id = $1`
	default:
		return nil, nil
	}
	var leadID *string
	err := q.QueryRow(ctx, sql, subjectID).Scan(&leadID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return leadID, err
}

func (SalesFunnelSQL) LeadVenue(ctx context.Context, q database.Querier, leadID string) (*string, *string, error) {
	var companyID, branchID *string
	err := q.QueryRow(ctx, `SELECT company_id::text, branch_id::text FROM crm.crm_sales_leads WHERE id = $1`, leadID).Scan(&companyID, &branchID)
	if database.IsNoRows(err) {
		return nil, nil, nil
	}
	return companyID, branchID, err
}

func (SalesFunnelSQL) ScoringLead(ctx context.Context, q database.Querier, leadID string) (*ScoringLead, error) {
	var l ScoringLead
	var source, orgType, temperature, status string
	var city, picEmail, picTitle, accountType, industry *string
	err := q.QueryRow(ctx, `SELECT l.id::text, l.company_id::text, l.source, l.org_type, l.temperature, l.status, l.city,
            l.pic_email, l.pic_title, l.pic_phone, l.score, a.account_type, a.industry
     FROM crm.crm_sales_leads l
     LEFT JOIN crm.crm_accounts a ON a.id = l.account_id
     WHERE l.id = $1 AND l.deleted_at IS NULL`, leadID).
		Scan(&l.ID, &l.CompanyID, &source, &orgType, &temperature, &status, &city, &picEmail, &picTitle, &l.PicPhone, &l.Score, &accountType, &industry)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	l.Fields = map[string]*string{
		"source": &source, "org_type": &orgType, "temperature": &temperature, "status": &status, "city": city,
		"pic_email": picEmail, "pic_title": picTitle, "account_type": accountType, "industry": industry,
	}
	return &l, nil
}

// windowed appends the "within N days" filter on column when windowDays is
// set ($2 is the day count).
func windowed(sql, column string, leadID string, windowDays *int) (string, []any) {
	if windowDays == nil {
		return sql, []any{leadID}
	}
	return sql + ` AND ` + column + ` >= now() - ($2::int * interval '1 day')`, []any{leadID, *windowDays}
}

func (SalesFunnelSQL) DoneTaskCounts(ctx context.Context, q database.Querier, leadID string, windowDays *int) (map[string]int, error) {
	sql, args := windowed(`SELECT a.activity_type, count(*)
       FROM crm.crm_sales_activities a
       WHERE a.deleted_at IS NULL AND a.status = 'done'
         AND (a.lead_id = $1
              OR (a.subject_type = 'lead' AND a.subject_id = $1)
              OR a.deal_id IN (SELECT id FROM crm.crm_sales_deals WHERE lead_id = $1 AND deleted_at IS NULL))`,
		"COALESCE(a.done_at, a.updated_at)", leadID, windowDays)
	rows, err := q.Query(ctx, sql+` GROUP BY a.activity_type`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var typ string
		var n int
		if err := rows.Scan(&typ, &n); err != nil {
			return nil, err
		}
		out[typ] = n
	}
	return out, rows.Err()
}

func (SalesFunnelSQL) DealCount(ctx context.Context, q database.Querier, leadID string, windowDays *int) (int, error) {
	sql, args := windowed(`SELECT count(*) FROM crm.crm_sales_deals d WHERE d.lead_id = $1 AND d.deleted_at IS NULL`,
		"d.created_at", leadID, windowDays)
	var n int
	err := q.QueryRow(ctx, sql, args...).Scan(&n)
	return n, err
}

func (SalesFunnelSQL) SentQuotationCount(ctx context.Context, q database.Querier, leadID string, windowDays *int) (int, error) {
	sql, args := windowed(`SELECT count(*) FROM crm.crm_sales_quotations q
       JOIN crm.crm_sales_deals d ON d.id = q.deal_id
       WHERE d.lead_id = $1 AND q.deleted_at IS NULL AND q.status IN ('terkirim', 'diterima')`,
		"q.updated_at", leadID, windowDays)
	var n int
	err := q.QueryRow(ctx, sql, args...).Scan(&n)
	return n, err
}

func (SalesFunnelSQL) SetLeadScore(ctx context.Context, q database.Querier, leadID string, score int, breakdown string) error {
	_, err := q.Exec(ctx, `UPDATE crm.crm_sales_leads
     SET score = $2, score_breakdown = $3::text::jsonb, score_updated_at = now()
     WHERE id = $1`, leadID, score, breakdown)
	return err
}

func (SalesFunnelSQL) LeadIDs(ctx context.Context, q database.Querier, companyID *string) ([]string, error) {
	sql, args := `SELECT id::text FROM crm.crm_sales_leads WHERE deleted_at IS NULL`, []any{}
	if companyID != nil {
		sql, args = sql+` AND company_id = $1`, []any{*companyID}
	}
	rows, err := q.Query(ctx, sql+` ORDER BY created_at DESC LIMIT 5000`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}
