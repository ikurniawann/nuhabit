package adapters

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/testutil"
)

func mustExec(t *testing.T, tx pgx.Tx, sql string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func mustID(t *testing.T, tx pgx.Tx, sql string, args ...any) string {
	t.Helper()
	var id string
	if err := tx.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return id
}

// newProduct inserts a pos_products row; extra is "col = value" SQL applied after.
func newProduct(t *testing.T, tx pgx.Tx, name string, cols map[string]any) string {
	t.Helper()
	id := mustID(t, tx, `INSERT INTO pos.pos_products (sku, name, base_price) VALUES ($1, $2, 10000) RETURNING id::text`,
		"T-"+testutil.RandomHex(4), name)
	for col, v := range cols {
		mustExec(t, tx, `UPDATE pos.pos_products SET `+col+` = $2 WHERE id = $1`, id, v)
	}
	return id
}

// randDigits returns n random decimal digits.
func randDigits(n int) string {
	h := testutil.RandomHex(n)
	b := []byte(h[:n])
	for i, c := range b {
		b[i] = '0' + c%10
	}
	return string(b)
}

func newCustomer(t *testing.T, tx pgx.Tx, phone string) string {
	t.Helper()
	if phone == "" {
		phone = "62899" + randDigits(7)
	}
	return mustID(t, tx, `INSERT INTO pos.pos_customers (name, phone) VALUES ('Tester', $1) RETURNING id::text`, phone)
}

func newOrder(t *testing.T, tx pgx.Tx, venue testutil.Org, customerID *string) string {
	t.Helper()
	return mustID(t, tx, `INSERT INTO pos.pos_orders (order_number, cashier_id, customer_id, company_id, branch_id, total_amount, subtotal)
		VALUES ($1, gen_random_uuid(), $2, $3, $4, 50000, 50000) RETURNING id::text`,
		"T-"+testutil.RandomHex(4), customerID, venue.CompanyID, venue.BranchID)
}
