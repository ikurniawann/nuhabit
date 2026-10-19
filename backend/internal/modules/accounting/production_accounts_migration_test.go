package accounting_test

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// The production account delta maps WIP, applied overhead and production
// loss for every company with a chart of accounts: by name when an account
// matches, else in new accounts next to inventory and COGS. A second run
// changes nothing. Runs inside a rolled-back transaction.
func TestProductionAccountsMigration(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	sql, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../../database/migrations/deltas/20261020130000_production_journal_accounts.sql"))
	if err != nil {
		t.Fatal(err)
	}
	tx := testutil.Tx(t)
	ctx := context.Background()
	id := func(q string, args ...any) string {
		t.Helper()
		var v string
		if err := tx.QueryRow(ctx, q, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		return v
	}
	company := func() string {
		return id(`INSERT INTO configuration.companies (holding_id, name, code)
			SELECT holding_id, 'Go COA '||$1, 'GC'||$1 FROM configuration.companies LIMIT 1 RETURNING id::text`, testutil.RandomHex(3))
	}
	account := func(co, code, name, typ, parent string, level int, postable bool) string {
		var p any
		if parent != "" {
			p = parent
		}
		return id(`INSERT INTO accounting.chart_of_accounts (company_id, code, name, parent_id, account_type_id, level, is_postable)
			SELECT $1, $2, $3, $4, t.id, $6, $7 FROM accounting.account_types t WHERE t.code = $5 RETURNING id::text`,
			co, code, name, p, typ, level, postable)
	}
	mapping := func(co, event, role, accountID string) {
		m := id(`INSERT INTO accounting.journal_mappings (company_id, event_code, name, module) VALUES ($1, $2, $2, 'PURCHASING')
			RETURNING id::text`, co, event)
		id(`INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id) VALUES ($1, 'DEBIT', $2, $3)
			RETURNING id::text`, m, role, accountID)
	}
	lineAccount := func(co, event, role string) string {
		t.Helper()
		var v *string
		if err := tx.QueryRow(ctx, `SELECT a.code FROM accounting.journal_mappings m
			JOIN accounting.journal_mapping_lines l ON l.mapping_id = m.id
			LEFT JOIN accounting.chart_of_accounts a ON a.id = l.account_id
			WHERE m.company_id = $1 AND m.event_code = $2 AND l.line_role = $3 AND m.deleted_at IS NULL`, co, event, role).Scan(&v); err != nil {
			t.Fatalf("%s %s: %v", event, role, err)
		}
		if v == nil {
			return ""
		}
		return *v
	}
	run := func() {
		t.Helper()
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("migration: %v", err)
		}
	}

	// A: SULU-style numbering, no WIP or applied overhead account yet.
	a := company()
	invGroup := account(a, "1300000", "INVENTORIES", "ASSET", "", 2, false)
	storage := account(a, "1301000", "INV. STORAGE", "ASSET", invGroup, 3, false)
	dry := account(a, "1301001", "Inv - ST Dry Goods", "ASSET", storage, 4, true)
	account(a, "1301005", "Inv - ST RTD", "ASSET", storage, 4, true)
	cogsGroup := account(a, "5000000", "COST OF GOODS SOLD", "COGS", "", 1, false)
	food := account(a, "5101000", "COGS FOOD", "COGS", cogsGroup, 3, false)
	cogs := account(a, "5101001", "Cost of Food Raw Material", "COGS", food, 4, true)
	// "wip" matches as a word only: wipes stay out.
	account(a, "1301009", "Wipes Stock", "ASSET", storage, 4, true)
	mapping(a, "PURCHASE_GRN", "INVENTORY", dry)
	mapping(a, "POS_COGS_RELIEF", "COGS", cogs)

	// B: accounts that match by name.
	b := company()
	account(b, "1302001", "Work in Process", "ASSET", "", 4, true)
	account(b, "5102009", "Overhead Pabrik Dibebankan", "COGS", "", 4, true)
	account(b, "8301009", "Kerugian Produksi", "OTHER_EXPENSE", "", 4, true)

	run()
	run()

	// A gets new accounts at the next free code under each parent; loss
	// falls back to COGS.
	for _, c := range []struct{ event, role, want string }{
		{"PRODUCTION_MATERIAL_ISSUE", "WIP", "1301010"},
		{"PRODUCTION_MATERIAL_ISSUE", "INVENTORY", "1301001"},
		{"PRODUCTION_CONVERSION_COST", "OVERHEAD_APPLIED", "5101002"},
		{"PRODUCTION_OUTPUT_RECEIPT", "WIP", "1301010"},
		{"PRODUCTION_SCRAP", "COGS", "5101001"},
		{"PRODUCTION_ABNORMAL_SCRAP", "PRODUCTION_LOSS", "5101001"},
		{"PRODUCTION_MATERIAL_RETURN", "INVENTORY", "1301001"},
		{"PRODUCTION_MATERIAL_RETURN", "WIP", "1301010"},
	} {
		if got := lineAccount(a, c.event, c.role); got != c.want {
			t.Errorf("company A %s %s = %q, want %q", c.event, c.role, got, c.want)
		}
	}
	var created, contra int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int, count(*) FILTER (WHERE is_contra)::int FROM accounting.chart_of_accounts
		WHERE company_id = $1 AND description LIKE '%migrasi 20261020130000%'`, a).Scan(&created, &contra); err != nil {
		t.Fatal(err)
	}
	if created != 2 || contra != 1 {
		t.Fatalf("company A created %d accounts (%d contra), want 2 (1)", created, contra)
	}
	var wipName, wipParent string
	var wipLevel int
	if err := tx.QueryRow(ctx, `SELECT a.name, p.code, a.level FROM accounting.chart_of_accounts a
		JOIN accounting.chart_of_accounts p ON p.id = a.parent_id WHERE a.company_id = $1 AND a.code = '1301010'`, a).
		Scan(&wipName, &wipParent, &wipLevel); err != nil {
		t.Fatal(err)
	}
	if wipName != "Barang Dalam Proses" || wipParent != "1301000" || wipLevel != 4 {
		t.Fatalf("WIP account %s under %s level %d", wipName, wipParent, wipLevel)
	}

	// B maps the named accounts and creates nothing; no inventory or COGS
	// mapping, so those lines stay empty.
	for _, c := range []struct{ event, role, want string }{
		{"PRODUCTION_MATERIAL_ISSUE", "WIP", "1302001"},
		{"PRODUCTION_CONVERSION_COST", "OVERHEAD_APPLIED", "5102009"},
		{"PRODUCTION_ABNORMAL_SCRAP", "PRODUCTION_LOSS", "8301009"},
		{"PRODUCTION_MATERIAL_ISSUE", "INVENTORY", ""},
	} {
		if got := lineAccount(b, c.event, c.role); got != c.want {
			t.Errorf("company B %s %s = %q, want %q", c.event, c.role, got, c.want)
		}
	}
	var mappings int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM accounting.journal_mappings WHERE company_id = $1
		AND event_code LIKE 'PRODUCTION_%' AND deleted_at IS NULL`, b).Scan(&mappings); err != nil {
		t.Fatal(err)
	}
	if mappings != 6 {
		t.Fatalf("company B has %d production mappings", mappings)
	}
}
