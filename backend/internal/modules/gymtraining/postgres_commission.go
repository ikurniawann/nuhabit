package gymtraining

import (
	"context"
	"encoding/json"
	"time"

	"nuhabit/backend/internal/modules/gymtraining/domain"
)

// Revenue-share commission on gym.commission_schemes,
// gym.coach_commission_profiles, gym.commission_statements and
// gym.commission_lines. Branch names, companies and zones come from
// configuration.branches, which every gym module reads.

type commissionRepository interface {
	CommissionSchemes(ctx context.Context) ([]commissionSchemeRow, error)
	SaveCommissionScheme(ctx context.Context, in commissionSchemeInput, actorID string) (string, error)
	DeleteCommissionScheme(ctx context.Context, id string) (bool, error)
	CoachProfiles(ctx context.Context) (map[string]coachProfile, error)
	SaveCoachProfile(ctx context.Context, coachID, role string, share *float64, actorID string) error
	CommissionBranches(ctx context.Context, branchID *string) ([]commissionBranch, error)
	CommissionStatement(ctx context.Context, branchID, month string, lock bool) (*storedStatement, error)
	SaveCommissionStatement(ctx context.Context, st storedStatement, actorID string) (string, error)
	CommissionLines(ctx context.Context, statementID string) ([]storedLine, error)
	LockCommissionLine(ctx context.Context, lineID string) (*lineToPay, error)
	MarkCommissionLinePaid(ctx context.Context, lineID, method string, reference, payrollPeriod *string, actorID string, at time.Time) error
	CloseCommissionStatementIfPaid(ctx context.Context, statementID string) error
	CoachCommissionHistory(ctx context.Context, coachID string) ([]coachCommissionRow, error)
}

/* ── Schemes and coach profiles ──────────────────────────────────────── */

type commissionSchemeRow struct {
	ID                    string             `json:"id"`
	BranchID              *string            `json:"branchId"`
	Name                  string             `json:"name"`
	ClassPoolPercent      float64            `json:"classPoolPercent"`
	PtPoolPercent         float64            `json:"ptPoolPercent"`
	ShareHeadCoachPercent float64            `json:"shareHeadCoachPercent"`
	ShareCoachPercent     float64            `json:"shareCoachPercent"`
	ShareAssistantPercent float64            `json:"shareAssistantPercent"`
	DeductionPercents     map[string]float64 `json:"deductionPercents"`
	MaxDeductionPercent   float64            `json:"maxDeductionPercent"`
	PayoutChannel         string             `json:"payoutChannel"`
	IsActive              bool               `json:"isActive"`
	UpdatedAt             domain.Timestamp   `json:"updatedAt"`
	BranchName            *string            `json:"branchName" db:"-"`
}

func (s commissionSchemeRow) settings() domain.CommissionSettings {
	return domain.CommissionSettings{
		ClassPoolPercent: s.ClassPoolPercent, PtPoolPercent: s.PtPoolPercent,
		ShareHeadCoachPercent: s.ShareHeadCoachPercent, ShareCoachPercent: s.ShareCoachPercent,
		ShareAssistantPercent: s.ShareAssistantPercent, DeductionPercents: s.DeductionPercents,
		MaxDeductionPercent: s.MaxDeductionPercent, PayoutChannel: s.PayoutChannel,
	}
}

func (r *pgRepo) CommissionSchemes(ctx context.Context) ([]commissionSchemeRow, error) {
	return collect[commissionSchemeRow](ctx, r.db,
		`SELECT s.id, s.branch_id, s.name, s.class_pool_percent::float, s.pt_pool_percent::float,
		        s.share_head_coach_percent::float, s.share_coach_percent::float, s.share_assistant_percent::float,
		        s.deduction_percents, s.max_deduction_percent::float, s.payout_channel, s.is_active, s.updated_at
		   FROM gym.commission_schemes s
		   LEFT JOIN configuration.branches b ON b.id = s.branch_id
		  ORDER BY s.branch_id IS NOT NULL, b.name`)
}

func (r *pgRepo) SaveCommissionScheme(ctx context.Context, in commissionSchemeInput, actorID string) (string, error) {
	deductions, err := json.Marshal(in.DeductionPercents)
	if err != nil {
		return "", err
	}
	args := []any{in.BranchID, in.Name, in.ClassPoolPercent, in.PtPoolPercent, in.ShareHeadCoachPercent,
		in.ShareCoachPercent, in.ShareAssistantPercent, string(deductions), in.MaxDeductionPercent, in.PayoutChannel,
		in.IsActive, actorID}
	if in.ID != nil {
		return returningID(ctx, r.db,
			`UPDATE gym.commission_schemes SET branch_id = $1, name = $2, class_pool_percent = $3, pt_pool_percent = $4,
			        share_head_coach_percent = $5, share_coach_percent = $6, share_assistant_percent = $7,
			        deduction_percents = $8::jsonb, max_deduction_percent = $9, payout_channel = $10, is_active = $11,
			        updated_by = $12, updated_at = now()
			  WHERE id = $13 AND (branch_id IS NULL) = ($1::uuid IS NULL)
			 RETURNING id`, append(args, *in.ID)...)
	}
	return returningID(ctx, r.db,
		`INSERT INTO gym.commission_schemes (branch_id, name, class_pool_percent, pt_pool_percent, share_head_coach_percent,
		        share_coach_percent, share_assistant_percent, deduction_percents, max_deduction_percent, payout_channel,
		        is_active, created_by, updated_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $12) RETURNING id`, args...)
}

func (r *pgRepo) DeleteCommissionScheme(ctx context.Context, id string) (bool, error) {
	return affected(ctx, r.db, `DELETE FROM gym.commission_schemes WHERE id = $1 AND branch_id IS NOT NULL`, id)
}

// coachProfile is a coach's commission role and share override.
type coachProfile struct {
	CoachID      string
	Role         string
	SharePercent *float64
}

func (r *pgRepo) CoachProfiles(ctx context.Context) (map[string]coachProfile, error) {
	rows, err := collect[coachProfile](ctx, r.db,
		`SELECT coach_id::text, role, share_percent::float FROM gym.coach_commission_profiles`)
	out := make(map[string]coachProfile, len(rows))
	for _, p := range rows {
		out[p.CoachID] = p
	}
	return out, err
}

func (r *pgRepo) SaveCoachProfile(ctx context.Context, coachID, role string, share *float64, actorID string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO gym.coach_commission_profiles (coach_id, role, share_percent, updated_by, updated_at)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (coach_id) DO UPDATE SET role = EXCLUDED.role, share_percent = EXCLUDED.share_percent,
		        updated_by = EXCLUDED.updated_by, updated_at = now()`, coachID, role, share, actorID)
	return err
}

// commissionBranch is a branch that may pool commission.
type commissionBranch struct {
	ID        string
	Name      string
	CompanyID *string
	Timezone  string
}

func (r *pgRepo) CommissionBranches(ctx context.Context, branchID *string) ([]commissionBranch, error) {
	return collect[commissionBranch](ctx, r.db,
		`SELECT id::text, name, company_id::text, COALESCE(timezone, 'Asia/Jakarta')
		   FROM configuration.branches
		  WHERE ($1::uuid IS NULL AND is_active) OR id = $1
		  ORDER BY name`, branchID)
}

/* ── Statements ──────────────────────────────────────────────────────── */

// storedStatement is a gym.commission_statements row; Lines are written
// with it and read separately.
type storedStatement struct {
	ID               string
	BranchID         string
	PeriodMonth      string
	SchemeID         *string
	SchemeName       string
	Status           string
	PayoutChannel    string
	ClassRevenueIDR  float64
	PtRevenueIDR     float64
	ClassPoolPercent float64
	PtPoolPercent    float64
	ClassPoolIDR     float64
	PtPoolIDR        float64
	TotalPoolIDR     float64
	AllocatedPercent float64
	AllocatedIDR     float64
	RetainedIDR      float64
	Settings         domain.CommissionSettings
	ComputedAt       domain.Timestamp
	ApprovedAt       *domain.Timestamp
	Lines            []domain.CommissionLine `db:"-"`
}

const statementColumns = `id::text, branch_id::text, period_month, scheme_id::text, scheme_name, status, payout_channel,
	class_revenue_idr::float, pt_revenue_idr::float, class_pool_percent::float, pt_pool_percent::float,
	class_pool_idr::float, pt_pool_idr::float, total_pool_idr::float, allocated_percent::float, allocated_idr::float,
	retained_idr::float, settings, computed_at, approved_at`

func (r *pgRepo) CommissionStatement(ctx context.Context, branchID, month string, lock bool) (*storedStatement, error) {
	sql := `SELECT ` + statementColumns + ` FROM gym.commission_statements WHERE branch_id = $1 AND period_month = $2`
	if lock {
		sql += ` FOR UPDATE`
	}
	return one[storedStatement](ctx, r.db, sql, branchID, month)
}

// SaveCommissionStatement writes the statement of its branch and month
// with its lines, replacing a draft. "" means the month is already
// approved.
func (r *pgRepo) SaveCommissionStatement(ctx context.Context, st storedStatement, actorID string) (string, error) {
	settings, err := json.Marshal(st.Settings)
	if err != nil {
		return "", err
	}
	approved := st.Status != domain.CommissionDraft
	id, err := returningID(ctx, r.db,
		`INSERT INTO gym.commission_statements (branch_id, period_month, scheme_id, scheme_name, status, payout_channel,
		        class_revenue_idr, pt_revenue_idr, class_pool_percent, pt_pool_percent, class_pool_idr, pt_pool_idr,
		        total_pool_idr, allocated_percent, allocated_idr, retained_idr, settings, computed_at,
		        approved_at, approved_by, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, now(),
		         CASE WHEN $18 THEN now() END, CASE WHEN $18 THEN $19::uuid END, $19)
		 ON CONFLICT (branch_id, period_month) DO UPDATE SET
		        scheme_id = EXCLUDED.scheme_id, scheme_name = EXCLUDED.scheme_name, status = EXCLUDED.status,
		        payout_channel = EXCLUDED.payout_channel, class_revenue_idr = EXCLUDED.class_revenue_idr,
		        pt_revenue_idr = EXCLUDED.pt_revenue_idr, class_pool_percent = EXCLUDED.class_pool_percent,
		        pt_pool_percent = EXCLUDED.pt_pool_percent, class_pool_idr = EXCLUDED.class_pool_idr,
		        pt_pool_idr = EXCLUDED.pt_pool_idr, total_pool_idr = EXCLUDED.total_pool_idr,
		        allocated_percent = EXCLUDED.allocated_percent, allocated_idr = EXCLUDED.allocated_idr,
		        retained_idr = EXCLUDED.retained_idr, settings = EXCLUDED.settings, computed_at = now(),
		        approved_at = EXCLUDED.approved_at, approved_by = EXCLUDED.approved_by, updated_at = now()
		  WHERE gym.commission_statements.status = 'draft'
		 RETURNING id`,
		st.BranchID, st.PeriodMonth, st.SchemeID, st.SchemeName, st.Status, st.PayoutChannel,
		st.ClassRevenueIDR, st.PtRevenueIDR, st.ClassPoolPercent, st.PtPoolPercent, st.ClassPoolIDR, st.PtPoolIDR,
		st.TotalPoolIDR, st.AllocatedPercent, st.AllocatedIDR, st.RetainedIDR, string(settings), approved, actorID)
	if err != nil || id == "" {
		return id, err
	}
	if _, err := r.db.Exec(ctx, `DELETE FROM gym.commission_lines WHERE statement_id = $1`, id); err != nil {
		return "", err
	}
	lines, err := json.Marshal(st.Lines)
	if err != nil {
		return "", err
	}
	// A zero line is settled at approval so the statement can close.
	_, err = r.db.Exec(ctx,
		`INSERT INTO gym.commission_lines (statement_id, coach_id, coach_name, role, share_percent, class_sessions,
		        pt_sessions, attendees, all_sessions, attribution_percent, gross_idr, deduction_percent, deduction_idr,
		        amount_idr, incidents, status, paid_at)
		 SELECT $1, l."coachId", l."coachName", l.role, l."sharePercent", l."classSessions", l."ptSessions", l.attendees,
		        l."allSessions", l."attributionPercent", l."grossIdr", l."deductionPercent", l."deductionIdr", l."amountIdr",
		        COALESCE(l.incidents, '[]'::jsonb),
		        CASE WHEN $3 AND l."amountIdr" = 0 THEN 'paid' ELSE 'pending' END,
		        CASE WHEN $3 AND l."amountIdr" = 0 THEN now() END
		   FROM jsonb_to_recordset($2::jsonb) AS l("coachId" uuid, "coachName" text, role text, "sharePercent" numeric,
		        "classSessions" int, "ptSessions" int, attendees int, "allSessions" int, "attributionPercent" numeric,
		        "grossIdr" numeric, "deductionPercent" numeric, "deductionIdr" numeric, "amountIdr" numeric, incidents jsonb)`,
		id, string(lines), approved)
	return id, err
}

// storedLine is a gym.commission_lines row.
type storedLine struct {
	ID string `json:"id"`
	domain.CommissionLine
	Status           string            `json:"status"`
	PaymentMethod    *string           `json:"paymentMethod"`
	PaymentReference *string           `json:"paymentReference"`
	PayrollPeriod    *string           `json:"payrollPeriod"`
	PaidAt           *domain.Timestamp `json:"paidAt"`
}

const lineColumns = `l.id::text, l.coach_id::text, l.coach_name, l.role, l.share_percent::float, l.class_sessions, l.pt_sessions,
	l.attendees, l.all_sessions, l.attribution_percent::float, l.gross_idr::float, l.deduction_percent::float,
	l.deduction_idr::float, l.amount_idr::float, l.incidents, l.status, l.payment_method, l.payment_reference,
	l.payroll_period, l.paid_at`

func (r *pgRepo) CommissionLines(ctx context.Context, statementID string) ([]storedLine, error) {
	return collect[storedLine](ctx, r.db, `SELECT `+lineColumns+` FROM gym.commission_lines l
		WHERE l.statement_id = $1
		ORDER BY array_position(ARRAY['head_coach', 'coach', 'assistant'], l.role), l.coach_name`, statementID)
}

// lineToPay is a commission line under FOR UPDATE with its statement.
type lineToPay struct {
	ID              string
	StatementID     string
	CoachID         string
	CoachName       string
	AmountIDR       float64
	Status          string
	StatementStatus string
	PayoutChannel   string
	PeriodMonth     string
	BranchName      string
	CompanyID       *string
	Timezone        string
}

func (r *pgRepo) LockCommissionLine(ctx context.Context, lineID string) (*lineToPay, error) {
	return one[lineToPay](ctx, r.db,
		`SELECT l.id::text, l.statement_id::text, l.coach_id::text, l.coach_name, l.amount_idr::float, l.status,
		        s.status, s.payout_channel, s.period_month, b.name, b.company_id::text, COALESCE(b.timezone, 'Asia/Jakarta')
		   FROM gym.commission_lines l
		   JOIN gym.commission_statements s ON s.id = l.statement_id
		   JOIN configuration.branches b ON b.id = s.branch_id
		  WHERE l.id = $1
		    FOR UPDATE OF l, s`, lineID)
}

func (r *pgRepo) MarkCommissionLinePaid(ctx context.Context, lineID, method string, reference, payrollPeriod *string, actorID string, at time.Time) error {
	_, err := r.db.Exec(ctx,
		`UPDATE gym.commission_lines SET status = 'paid', payment_method = $2, payment_reference = $3, payroll_period = $4,
		        paid_by = $5, paid_at = $6, updated_at = now()
		  WHERE id = $1 AND status = 'pending'`, lineID, method, reference, payrollPeriod, actorID, at)
	return err
}

func (r *pgRepo) CloseCommissionStatementIfPaid(ctx context.Context, statementID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE gym.commission_statements SET status = 'paid', updated_at = now()
		  WHERE id = $1 AND status = 'approved'
		    AND NOT EXISTS (SELECT 1 FROM gym.commission_lines WHERE statement_id = $1 AND status = 'pending')`, statementID)
	return err
}

// coachCommissionRow is one stored line of a coach, newest month first.
type coachCommissionRow struct {
	storedLine
	PeriodMonth     string `json:"periodMonth"`
	BranchID        string `json:"branchId"`
	BranchName      string `json:"branchName"`
	StatementStatus string `json:"statementStatus"`
}

func (r *pgRepo) CoachCommissionHistory(ctx context.Context, coachID string) ([]coachCommissionRow, error) {
	return collect[coachCommissionRow](ctx, r.db, `SELECT `+lineColumns+`, s.period_month, s.branch_id::text, b.name, s.status
		   FROM gym.commission_lines l
		   JOIN gym.commission_statements s ON s.id = l.statement_id
		   JOIN configuration.branches b ON b.id = s.branch_id
		  WHERE l.coach_id = $1
		  ORDER BY s.period_month DESC, b.name
		  LIMIT 48`, coachID)
}
