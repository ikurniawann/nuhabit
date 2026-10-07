package insights

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/insights/domain"
)

// buildSystemSummary (lib/assistant/summary.ts): row counts per module plus
// the latest rows for the intent. Every count and row read is fail-safe
// (0 or []), so the SQL below is what the shim generates; a stale column
// would only show up as an empty context (TestSummaryReadsMatchSchema).

// openPOStatuses are the purchase orders not yet sent or fully received.
var openPOStatuses = []any{"draft", "approved", "sent", "partially_received"}

type summaryCount struct {
	group, key, table, where string
	args                     []any
}

func summaryCounts(todayStart time.Time) []summaryCount {
	c := func(group, key, table string) summaryCount { return summaryCount{group: group, key: key, table: table} }
	w := func(sc summaryCount, where string, args ...any) summaryCount {
		sc.where, sc.args = where, args
		return sc
	}
	return []summaryCount{
		c("hris", "candidatesTotal", "candidates"),
		w(c("hris", "candidatesToday", "candidates"), `"created_at" >= $1`, todayStart),
		w(c("hris", "candidatesNew", "candidates"), `"status" = $1`, "applied"),
		c("hris", "employeesTotal", "employees"),
		w(c("hris", "attendanceToday", "attendance"), `"created_at" >= $1`, todayStart),
		c("hris", "leavesTotal", "leaves"),
		c("hris", "jobOpeningsTotal", "job_openings"),
		c("performance", "performanceReviewsTotal", "performance_reviews"),
		c("performance", "employeeKpisTotal", "employee_kpis"),
		c("performance", "kpiTemplatesTotal", "kpi_templates"),
		c("performance", "developmentPlansTotal", "development_plans"),
		c("payroll", "payrollRunsTotal", "payroll_runs"),
		c("payroll", "payrollDetailsTotal", "payroll_details"),
		c("payroll", "employeeSalaryTotal", "employee_salary"),
		c("payroll", "benefitsTotal", "benefits"),
		c("payroll", "loansTotal", "loans"),
		c("procurement", "purchaseRequestsTotal", "purchase_requests"),
		c("procurement", "purchaseOrdersTotal", "purchase_orders"),
		w(c("procurement", "purchaseOrdersPending", "purchase_orders"), `"status" IN ($1, $2, $3, $4)`, openPOStatuses...),
		c("procurement", "suppliersTotal", "suppliers"),
		c("procurement", "rawMaterialsTotal", "raw_materials"),
		c("inventory", "inventoryItems", "inventory"),
		w(c("inventory", "lowStockItems", "inventory"), `"qty_available" < $1`, 1),
		c("inventory", "inventoryMovementsTotal", "inventory_movements"),
		c("inventory", "productsTotal", "products"),
		c("pos", "posOrdersTotal", "pos_orders"),
		c("pos", "posReservationsTotal", "pos_reservations"),
		c("pos", "posCustomersTotal", "pos_customers"),
		c("pos", "posShiftsTotal", "pos_shifts"),
		c("master", "departmentsTotal", "departments"),
		c("master", "positionsTotal", "positions"),
		c("master", "employmentStatusesTotal", "employment_statuses"),
		c("master", "usersTotal", "users"),
		c("integration", "notificationsTotal", "notifications"),
		c("integration", "aiAssistantLogsTotal", "ai_assistant_logs"),
	}
}

// summaryDetails are the latest-rows reads, in the order the TS adds them.
var summaryDetails = []struct {
	intent domain.Intent
	sql    string
	args   []any
}{
	{domain.IntentHris, `SELECT "id", "full_name", "status", "source", "created_at" FROM "candidates" ORDER BY "created_at" DESC LIMIT $1`, []any{5}},
	{domain.IntentPerformance, `SELECT "id", "period_label", "status", "grand_total_score", "created_at" FROM "performance_reviews" ORDER BY "created_at" DESC LIMIT $1`, []any{5}},
	{domain.IntentPayroll, `SELECT "id", "run_name", "period_month", "period_year", "status", "created_at" FROM "payroll_runs" ORDER BY "created_at" DESC LIMIT $1`, []any{5}},
	{domain.IntentProcurement, `SELECT "id", "nomor_po", "status", "total", "created_at" FROM "purchase_orders" WHERE "status" IN ($1, $2, $3, $4) ORDER BY "created_at" DESC LIMIT $5`, append(append([]any{}, openPOStatuses...), 5)},
	{domain.IntentInventory, `SELECT "id", "qty_available", "qty_minimum", "raw_material_id", "updated_at" FROM "inventory" WHERE "qty_available" < $1 ORDER BY "updated_at" DESC LIMIT $2`, []any{1, 5}},
	{domain.IntentPos, `SELECT "id", "order_number", "status", "total_amount", "created_at" FROM "pos_orders" ORDER BY "created_at" DESC LIMIT $1`, []any{5}},
	{domain.IntentIntegration, `SELECT "id", "user_email", "intent", "model", "latency_ms", "created_at" FROM "ai_assistant_logs" ORDER BY "created_at" DESC LIMIT $1`, []any{5}},
	{domain.IntentMaster, `SELECT "id", "name", "created_at" FROM "departments" ORDER BY "created_at" DESC LIMIT $1`, []any{5}},
}

func (s *Service) buildSystemSummary(ctx context.Context, intent domain.Intent) domain.Summary {
	local := s.now().In(domain.WIB)
	todayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, domain.WIB)

	counts := summaryCounts(todayStart)
	values := make([]int, len(counts))
	fns := make([]func(), 0, len(counts))
	for i, c := range counts {
		fns = append(fns, func() {
			sql := `SELECT count(*)::int AS count FROM "` + c.table + `"`
			if c.where != "" {
				sql += " WHERE " + c.where
			}
			if s.db.QueryRow(ctx, sql, c.args...).Scan(&values[i]) != nil {
				values[i] = 0
			}
		})
	}
	s.parallel(fns...)

	details := make([][]domain.Object, len(summaryDetails))
	fns = fns[:0]
	for i, d := range summaryDetails {
		if intent != domain.IntentAll && intent != d.intent {
			continue
		}
		fns = append(fns, func() {
			rows, err := queryObjects(ctx, s.db, d.sql, d.args...)
			if err != nil {
				rows = []domain.Object{}
			}
			details[i] = rows
		})
	}
	s.parallel(fns...)

	sum := domain.EmptySummary(domain.ISO(s.now()))
	groups := map[string]*domain.Metrics{
		"hris": &sum.Hris, "performance": &sum.Performance, "payroll": &sum.Payroll, "procurement": &sum.Procurement,
		"pos": &sum.Pos, "inventory": &sum.Inventory, "master": &sum.Master, "integration": &sum.Integration,
	}
	for i, c := range counts {
		g := groups[c.group]
		*g = append(*g, domain.Field{Key: c.key, Value: values[i]})
	}
	for i, d := range summaryDetails {
		if details[i] != nil {
			sum.Details = append(sum.Details, domain.Field{Key: string(d.intent), Value: details[i]})
		}
	}
	return sum.WithModules()
}
