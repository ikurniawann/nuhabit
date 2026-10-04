package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/hris"
	"nuhabit/backend/internal/platform/database"
)

// Adapters for the hris module's ports. Payroll, salary, recruitment and
// identity tables belong to other contexts; until those modules expose read
// services these run the SQL the TS libs ran (lib/hris/me-profile,
// nav-badges, create-contract, contracts-lifecycle, employees-profile,
// master-data, leave-wa, lib/whatsapp/gateway).

/* ── Payroll reads (payroll module tables) ───────────────────────────── */

type hrisPayrollSQL struct{}

var _ hris.PayrollReads = hrisPayrollSQL{}

func (hrisPayrollSQL) LatestPaidPayslip(ctx context.Context, q database.Querier, employeeID string) (*hris.Payslip, error) {
	var p hris.Payslip
	err := q.QueryRow(ctx, `SELECT pd.net_salary::text, pr.run_name, pr.period_month, pr.period_year, pr.paid_at::text
		FROM hris.payroll_details pd
		JOIN hris.payroll_runs pr ON pr.id = pd.payroll_run_id
		WHERE pd.employee_id = $1 AND pr.status = 'paid'
		ORDER BY pr.period_year DESC, pr.period_month DESC, pr.paid_at DESC NULLS LAST
		LIMIT 1`, employeeID).Scan(&p.NetSalary, &p.RunName, &p.PeriodMonth, &p.PeriodYear, &p.PaidAt)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (hrisPayrollSQL) ActiveLoans(ctx context.Context, q database.Querier, employeeID string) (hris.LoanSummary, error) {
	var s hris.LoanSummary
	err := q.QueryRow(ctx, `SELECT count(*),
		COALESCE(sum(remaining_balance), 0)::text,
		COALESCE(sum(monthly_installment)
		         FILTER (WHERE status = 'approved' AND COALESCE(remaining_balance, 0) > 0), 0)::text
		FROM hris.loans
		WHERE employee_id = $1 AND is_active
		  AND status IN ('pending', 'approved')
		  AND (status = 'pending' OR COALESCE(remaining_balance, 0) > 0)`, employeeID).
		Scan(&s.Count, &s.TotalRemaining, &s.MonthlyInstallment)
	return s, err
}

func (hrisPayrollSQL) RecentLoans(ctx context.Context, q database.Querier, employeeID string) ([]hris.RecentLoan, error) {
	rows, err := q.Query(ctx, `SELECT id::text, loan_type, principal_amount::text, status, created_at::text
		FROM hris.loans WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 5`, employeeID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[hris.RecentLoan])
}

func (hrisPayrollSQL) LatestKPISummary(ctx context.Context, q database.Querier, employeeID string) (hris.KPISummary, error) {
	var k hris.KPISummary
	err := q.QueryRow(ctx, `SELECT count(*),
		round(avg(achievement_percentage), 0)::text,
		round(avg(score)::numeric, 1)::text
		FROM hris.employee_kpis
		WHERE employee_id = $1
		  AND review_id = (
		    SELECT review_id FROM hris.employee_kpis
		    WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 1
		  )`, employeeID).Scan(&k.Count, &k.AvgAchievement, &k.AvgScore)
	return k, err
}

func (hrisPayrollSQL) PendingLoanCount(ctx context.Context, q database.Querier) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM hris.loans WHERE status = 'pending'`).Scan(&n)
	return n, err
}

func (hrisPayrollSQL) LoanUpdatesSince(ctx context.Context, q database.Querier, employeeID string, since *time.Time) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM hris.loans
		WHERE employee_id = $1 AND status <> 'pending'
		  AND updated_at > COALESCE($2::timestamptz, to_timestamp(0))`, employeeID, since).Scan(&n)
	return n, err
}

/* ── Salary structure (payroll module table) ─────────────────────────── */

type hrisSalarySQL struct{}

var _ hris.SalaryPort = hrisSalarySQL{}

func (hrisSalarySQL) ActiveBaseSalary(ctx context.Context, q database.Querier, employeeID string) (*string, error) {
	var base *string
	err := q.QueryRow(ctx, `SELECT base_salary::text FROM hris.employee_salary
		WHERE employee_id = $1 AND is_active ORDER BY effective_date DESC LIMIT 1`, employeeID).Scan(&base)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return base, err
}

// SyncFromContract is syncSalaryFromContract: a new salary version at the
// contract's base salary, carrying allowances, PTKP and BPJS flags from the
// current version (table defaults for a first version). The numeric
// parameters are cast explicitly: the TS sends them untyped, so PostgreSQL
// reads COALESCE($n, 0) as integer and fails on "1500000.00".
func (hrisSalarySQL) SyncFromContract(ctx context.Context, q database.Querier, in hris.SalarySync) error {
	var (
		id                                                     string
		base                                                   float64
		fixed, variable, transport, meal, housing, loan, other *string
		ptkp                                                   *string
		taxable, bpjsTK, bpjsKes, tapera                       *bool
	)
	err := q.QueryRow(ctx, `SELECT id::text, base_salary::float8, fixed_allowance::text, variable_allowance::text,
		transport_allowance::text, meal_allowance::text, housing_allowance::text, loan_deduction::text,
		other_deduction::text, ptkp_status, is_taxable, bpjs_tk_enrolled, bpjs_kes_enrolled, tapera_enrolled
		FROM hris.employee_salary
		WHERE employee_id = $1 AND is_active = true
		ORDER BY effective_date DESC LIMIT 1`, in.EmployeeID).Scan(&id, &base, &fixed, &variable, &transport, &meal,
		&housing, &loan, &other, &ptkp, &taxable, &bpjsTK, &bpjsKes, &tapera)
	hasCurrent := err == nil
	if err != nil && !database.IsNoRows(err) {
		return err
	}
	if hasCurrent && base == in.BaseSalary {
		return nil
	}
	if hasCurrent {
		if _, err := q.Exec(ctx, `UPDATE hris.employee_salary
			SET is_active = false, end_date = ($2::date - INTERVAL '1 day')::date, updated_at = now()
			WHERE id = $1`, id, in.StartDate); err != nil {
			return err
		}
	}
	_, err = q.Exec(ctx, `INSERT INTO hris.employee_salary
		(employee_id, base_salary, fixed_allowance, variable_allowance,
		 transport_allowance, meal_allowance, housing_allowance,
		 loan_deduction, other_deduction, ptkp_status, is_taxable,
		 bpjs_tk_enrolled, bpjs_kes_enrolled, tapera_enrolled,
		 effective_date, is_active, notes)
		VALUES ($1, $2,
		        COALESCE($3::numeric, 0), COALESCE($4::numeric, 0), COALESCE($5::numeric, 0),
		        COALESCE($6::numeric, 0), COALESCE($7::numeric, 0),
		        COALESCE($8::numeric, 0), COALESCE($9::numeric, 0),
		        COALESCE($10::text, 'TK/0'), COALESCE($11::boolean, true),
		        COALESCE($12::boolean, true), COALESCE($13::boolean, true), COALESCE($14::boolean, true),
		        $15::date, true, $16)
		ON CONFLICT (employee_id, effective_date) DO UPDATE SET
		  base_salary = EXCLUDED.base_salary,
		  is_active = true,
		  end_date = NULL,
		  notes = EXCLUDED.notes,
		  updated_at = now()`,
		in.EmployeeID, in.BaseSalary, fixed, variable, transport, meal, housing, loan, other,
		ptkp, taxable, bpjsTK, bpjsKes, tapera, in.StartDate, "Sinkron dari kontrak "+in.ContractNumber)
	return err
}

/* ── Recruitment reads (recruitment module tables) ───────────────────── */

type hrisRecruitmentSQL struct{}

var _ hris.Recruitment = hrisRecruitmentSQL{}

func (hrisRecruitmentSQL) PromotedCandidate(ctx context.Context, q database.Querier, employeeID string) (*hris.PromotedCandidate, error) {
	var c hris.PromotedCandidate
	err := q.QueryRow(ctx, `SELECT c.id::text, c.cv_url, c.status, c.created_at, c.promotion_date, c.source,
		p.title,
		(SELECT o.responded_at FROM recruitment.candidate_offers o
		 WHERE o.candidate_id = c.id AND o.status = 'accepted'
		 ORDER BY o.responded_at DESC LIMIT 1)
		FROM recruitment.candidates c
		LEFT JOIN hris.positions p ON p.id = c.position_id
		WHERE c.promoted_to_employee_id = $1
		ORDER BY c.created_at DESC LIMIT 1`, employeeID).Scan(&c.ID, &c.CVURL, &c.Status, &c.CreatedAt,
		&c.PromotionDate, &c.Source, &c.PositionTitle, &c.OfferAcceptedAt)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

/* ── Identity and catalog reads ──────────────────────────────────────── */

type hrisDirectorySQL struct{}

var _ hris.Directory = hrisDirectorySQL{}

func (hrisDirectorySQL) Account(ctx context.Context, q database.Querier, userID string) (*hris.Account, error) {
	var a hris.Account
	err := q.QueryRow(ctx, `SELECT email, created_at, last_sign_in_at FROM auth.users WHERE id = $1`, userID).
		Scan(&a.Email, &a.CreatedAt, &a.LastSignInAt)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (hrisDirectorySQL) SuperAdminUserIDs(ctx context.Context, q database.Querier) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT id::text FROM configuration.users WHERE role = 'super_admin'`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (hrisDirectorySQL) BrandNames(ctx context.Context, q database.Querier, ids []string) (map[string]string, error) {
	rows, err := q.Query(ctx, `SELECT id::text, name FROM item.brands WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[id] = name
	}
	return out, rows.Err()
}

/* ── WhatsApp gateway (settings context, not in a module yet) ────────── */

// hrisWhatsApp is lib/whatsapp/gateway (loadGatewayConfig + sendGatewayText)
// plus the configuration.wa_notif_log claim of lib/hris/leave-wa.
type hrisWhatsApp struct {
	db     database.Querier
	client *http.Client

	mu       sync.Mutex
	cached   *hrisGatewayConfig
	cachedAt time.Time
}

type hrisGatewayConfig struct {
	baseURL, token string
	timeout        time.Duration
}

var _ hris.WhatsAppSender = (*hrisWhatsApp)(nil)

func (w *hrisWhatsApp) Claim(ctx context.Context, q database.Querier, notifType, dedupKey, message string, recipients []string) (string, bool, error) {
	raw, _ := json.Marshal(recipients)
	var id string
	err := q.QueryRow(ctx, `INSERT INTO configuration.wa_notif_log (notif_type, dedup_key, message, recipients)
		VALUES ($1, $2, $3, $4::jsonb)
		ON CONFLICT (notif_type, dedup_key) DO NOTHING
		RETURNING id::text`, notifType, dedupKey, message, string(raw)).Scan(&id)
	if database.IsNoRows(err) {
		return "", false, nil
	}
	return id, err == nil, err
}

func (w *hrisWhatsApp) Release(ctx context.Context, q database.Querier, id string) error {
	_, err := q.Exec(ctx, `DELETE FROM configuration.wa_notif_log WHERE id = $1`, id)
	return err
}

func (w *hrisWhatsApp) Configured(ctx context.Context) bool { return w.config(ctx) != nil }

// config reads configuration.app_settings, then the env, cached 30 s; a
// settings failure falls back to the env.
func (w *hrisWhatsApp) config(ctx context.Context) *hrisGatewayConfig {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.cachedAt.IsZero() && time.Since(w.cachedAt) < 30*time.Second {
		return w.cached
	}
	var dbURL, dbToken string
	if rows, err := w.db.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`,
		[]string{"wa_gateway_url", "wa_gateway_token"}); err == nil {
		for rows.Next() {
			var key string
			var value *string
			if rows.Scan(&key, &value) == nil && value != nil {
				if key == "wa_gateway_url" {
					dbURL = strings.TrimSpace(*value)
				} else {
					dbToken = strings.TrimSpace(*value)
				}
			}
		}
		rows.Close()
	}
	token := hrisFirstSet(dbToken, os.Getenv("WA_GATEWAY_TOKEN"))
	var cfg *hrisGatewayConfig
	if token != "" {
		ms, err := strconv.Atoi(os.Getenv("WA_GATEWAY_TIMEOUT_MS"))
		if err != nil || ms == 0 {
			ms = 20000
		}
		cfg = &hrisGatewayConfig{baseURL: hrisFirstSet(dbURL, os.Getenv("WA_GATEWAY_URL"), "http://127.0.0.1:3471"),
			token: token, timeout: time.Duration(ms) * time.Millisecond}
	}
	w.cached, w.cachedAt = cfg, time.Now()
	return cfg
}

func hrisFirstSet(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// SendText posts {target, message} to {baseUrl}/send with x-gateway-token.
func (w *hrisWhatsApp) SendText(ctx context.Context, target, message string) (bool, bool, string) {
	cfg := w.config(ctx)
	if cfg == nil {
		return false, false, "gateway belum dikonfigurasi"
	}
	ctx, cancel := context.WithTimeout(ctx, cfg.timeout)
	defer cancel()
	body, _ := json.Marshal(map[string]string{"target": target, "message": message})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.baseURL+"/send", bytes.NewReader(body))
	if err != nil {
		return false, false, err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-gateway-token", cfg.token)
	res, err := w.client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return false, true, "Gateway tidak merespons (timeout)"
		}
		return false, false, err.Error()
	}
	defer res.Body.Close()
	var data map[string]any
	_ = json.NewDecoder(res.Body).Decode(&data)
	if res.StatusCode < 200 || res.StatusCode > 299 {
		reason, _ := data["error"].(string)
		if reason == "" {
			reason = "Gateway menolak permintaan kirim"
		}
		return false, false, reason
	}
	return true, false, ""
}
