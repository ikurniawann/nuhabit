package demo

import (
	"context"
	"fmt"
	"io"
	"sort"

	"github.com/jackc/pgx/v5"
)

// rowSet is the rows of one table that a removal purges.
type rowSet struct{ table, where string }

// Fixtures are test rows the seeders and Playwright create: sign-in
// accounts, members, employees and the local apparel tenant. Unlike the demo
// catalog, nothing real hangs off them, so what they own goes with them.
//
// Keep local sign-ins such as dev-super@example.test off this list: removing
// them locks the developer out of the dashboard.
var fixtures = []rowSet{
	{"auth.users", fixtureEmails},
	{"configuration.users", fixtureEmails},
	{"pos.pos_customers", `phone ~ '^0812000000[0-9]{2}$' OR phone = '081200000999' OR phone LIKE '08999000%'
		OR lower(email) LIKE '%@nuhabit.test' OR lower(email) LIKE '%@example.test'`},
	{"hris.employees", `nip IN ('DEMO-COACH', 'E2E-STAFF') OR nip LIKE 'BCD-%' OR lower(email) LIKE '%@nuhabit.test' OR lower(email) LIKE '%@bcdcoffee.id'`},
	{"gym.coaches", `lower(name) = 'demo coach'`},
	{"item.products", `kode LIKE 'E2E-%'`},
	{"pos.pos_products", `sku LIKE 'APL-%' OR sku LIKE 'E2E-%'`},
	{"configuration.companies", `code = 'SULU-APPAREL'`},
	// A demo branch does not exist, so nothing real was picked up there.
	{"shop.orders", `pickup_branch_id IN (SELECT id FROM configuration.branches WHERE code LIKE 'DEMO-%')`},
	{"hris.departments", `code LIKE 'SA-%'`},
	{"iam.roles", `code = 'sulu_bandung_demo'`},
	// Recipes have no foreign key to their product.
	{"manufacturing.bom_items", `product_id NOT IN (SELECT id FROM item.products)`},
	{"promo.promo_codes", `code LIKE 'E2E%'`},
	{"promo.promo_campaigns", `name LIKE 'E2E%'`},
}

const fixtureEmails = `(lower(email) LIKE 'demo-%@nuhabit.test' OR lower(email) LIKE 'e2e-%@nuhabit.test'
	OR lower(email) IN ('demo@sulu.id', 'demo@suluapparel.id', 'apparel@arkivworld.com')) AND ` + notSuperAdmin

// notSuperAdmin keeps every super admin, so no removal can lock the dashboard.
const notSuperAdmin = `id NOT IN (
	SELECT ur.user_id FROM iam.user_roles ur JOIN iam.roles r ON r.id = ur.role_id WHERE r.code = 'super_admin'
	UNION SELECT id FROM configuration.users WHERE role = 'super_admin')`

// otherUsers are sign-ins that are neither a super admin nor an employee.
const otherUsers = notSuperAdmin + ` AND id NOT IN (SELECT user_id FROM hris.employees WHERE user_id IS NOT NULL)`

// ownerColumns are nullable references that mean "this row belongs to the
// parent": the row goes with a fixture parent. Other nullable references,
// such as created_by, are cleared and the row stays.
var ownerColumns = map[string]bool{"customer_id": true, "company_id": true, "branch_id": true}

// purge deletes rows of table and what they own. counts collects rows per
// table.
func purge(ctx context.Context, tx pgx.Tx, table string, ids []string, counts map[string]int64) error {
	if len(ids) == 0 {
		return nil
	}
	refs, err := foreignKeysTo(ctx, tx, table)
	if err != nil {
		return err
	}
	for _, ref := range refs {
		if ref.Nullable && !ownerColumns[ref.Column] {
			sql := fmt.Sprintf(`UPDATE %s SET %s = NULL WHERE %s::text = ANY($1)`, ref.Table, ref.Column, ref.Column)
			if _, err := tx.Exec(ctx, sql, ids); err != nil {
				return fmt.Errorf("%s.%s: %w", ref.Table, ref.Column, err)
			}
			continue
		}
		if !ref.HasID {
			tag, err := tx.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE %s::text = ANY($1)`, ref.Table, ref.Column), ids)
			if err != nil {
				return fmt.Errorf("%s.%s: %w", ref.Table, ref.Column, err)
			}
			counts[ref.Table] += tag.RowsAffected()
			continue
		}
		rows, err := tx.Query(ctx, fmt.Sprintf(`SELECT id::text FROM %s WHERE %s::text = ANY($1)`, ref.Table, ref.Column), ids)
		if err != nil {
			return fmt.Errorf("%s.%s: %w", ref.Table, ref.Column, err)
		}
		children, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return fmt.Errorf("%s.%s: %w", ref.Table, ref.Column, err)
		}
		if err := purge(ctx, tx, ref.Table, children, counts); err != nil {
			return err
		}
	}
	tag, err := tx.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE id::text = ANY($1)`, table), ids)
	if err != nil {
		return fmt.Errorf("%s: %w", table, err)
	}
	counts[table] += tag.RowsAffected()
	return nil
}

// removeRows deletes every row set on tx and returns the rows per table.
// The credit ledger refuses deletes by trigger; these rows' ledger is test
// data, so the trigger is lifted until they are gone. A failure rolls the
// lift back with the transaction.
func removeRows(ctx context.Context, tx pgx.Tx, sets []rowSet) (map[string]int64, error) {
	if _, err := tx.Exec(ctx, `ALTER TABLE gym.credit_ledger DISABLE TRIGGER trg_gym_credit_ledger_append_only`); err != nil {
		return nil, err
	}
	counts := map[string]int64{}
	for _, f := range sets {
		rows, err := tx.Query(ctx, fmt.Sprintf(`SELECT id::text FROM %s WHERE %s`, f.table, f.where))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f.table, err)
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f.table, err)
		}
		if err := purge(ctx, tx, f.table, ids, counts); err != nil {
			return nil, err
		}
	}
	_, err := tx.Exec(ctx, `ALTER TABLE gym.credit_ledger ENABLE TRIGGER trg_gym_credit_ledger_append_only`)
	return counts, err
}

func printFixtures(w io.Writer, counts map[string]int64, dryRun bool) {
	verb := "Data uji dihapus"
	if dryRun {
		verb = "Data uji akan dihapus"
	}
	tables := make([]string, 0, len(counts))
	var total int64
	for table, n := range counts {
		if n > 0 {
			tables = append(tables, table)
			total += n
		}
	}
	sort.Strings(tables)
	fmt.Fprintf(w, "%s: %d baris\n", verb, total)
	for _, table := range tables {
		fmt.Fprintf(w, "  %-40s %d\n", table, counts[table])
	}
}
