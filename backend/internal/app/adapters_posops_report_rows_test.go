package app

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// BrandName walks resolveBrandName's fallbacks on a rolled-back transaction.
func TestPosOpsBrandName(t *testing.T) {
	ctx := context.Background()
	tx := testutil.Tx(t)
	dir := posOpsDirectory{}
	sfx := testutil.RandomHex(4)
	var holding, company, venue string
	if err := tx.QueryRow(ctx, `INSERT INTO configuration.holdings (name, code) VALUES ('H '||$1, 'H'||$1) RETURNING id::text`, sfx).Scan(&holding); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO configuration.companies (holding_id, name, code)
		VALUES ($1, '  Kopi GT '||$2||'  ', 'C'||$2) RETURNING id::text`, holding, sfx).Scan(&company); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO configuration.companies (holding_id, name, code)
		VALUES ($1, 'Venue GT', 'V'||$2) RETURNING id::text`, holding, sfx).Scan(&venue); err != nil {
		t.Fatal(err)
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}

	if got := dir.BrandName(ctx, tx, &company); got != "Kopi GT "+sfx {
		t.Fatalf("company brand = %q", got)
	}
	// A malformed id reads as no company and leaves the transaction usable.
	bad := "not-a-uuid"
	exec(`INSERT INTO crm.crm_settings (key, value) VALUES ('default_company_id', to_jsonb($1::text))
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, venue)
	if got := dir.BrandName(ctx, tx, &bad); got != "Venue GT" {
		t.Fatalf("venue brand = %q", got)
	}
	// A non-string default company is ignored; the app_brand_name setting follows.
	exec(`UPDATE crm.crm_settings SET value = '42'::jsonb WHERE key = 'default_company_id'`)
	exec(`INSERT INTO configuration.app_settings (key, value) VALUES ('app_brand_name', '  Merek GT ')
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`)
	if got := dir.BrandName(ctx, tx, nil); got != "Merek GT" {
		t.Fatalf("setting brand = %q", got)
	}
	exec(`UPDATE configuration.app_settings SET value = '  ' WHERE key = 'app_brand_name'`)
	t.Setenv("NEXT_PUBLIC_APP_NAME", "")
	if got := dir.BrandName(ctx, tx, nil); got != "NüHabit" {
		t.Fatalf("default brand = %q", got)
	}
}
