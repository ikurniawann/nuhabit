package kit

import (
	"context"
	"encoding/json"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

func TestRowsSerializeLikeNodePostgres(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	row, err := QueryOne(ctx, tx, `SELECT 10.50::numeric(14,2) AS n, 7::int8 AS big, 3::int4 AS i, 1.5::float8 AS f,
		true AS b, '{"a":[1,2.50,1e2]}'::jsonb AS j, '2026-10-04 10:00:00.123+07'::timestamptz AS ts,
		ARRAY['x','y,z',NULL]::text[] AS arr, ARRAY[1,2]::int4[] AS ints, NULL::text AS nul,
		'550e8400-e29b-41d4-a716-446655440000'::uuid AS u`)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := json.Marshal(row)
	want := `{"n":"10.50","big":"7","i":3,"f":1.5,"b":true,"j":{"a":[1,2.5,100]},"ts":"2026-10-04T03:00:00.123Z","arr":["x","y,z",null],"ints":[1,2],"nul":null,"u":"550e8400-e29b-41d4-a716-446655440000"}`
	if string(got) != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}

func TestShimUpsertAcceptsTextForTypedColumns(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	code := "kit_test_" + testutil.RandomHex(4)
	cols := []Col{
		{"code", code}, {"name", "Kit"}, {"source_channel", "pos"}, {"source_type", "order_amount"},
		{"outlet_scope", "all"}, {"xp_mode", "fixed"}, {"xp_value", 5.5}, {"amount_step", 1},
		{"starts_at", "2026-10-01T00:00:00.000Z"}, {"metadata", JSONText(map[string]any{"k": []int{1}})},
	}
	row, err := Upsert(ctx, tx, "crm.crm_xp_rules", "code", cols)
	if err != nil {
		t.Fatal(err)
	}
	if row.Str("xp_value") != "5.5000" || row.Str("code") != code {
		t.Fatalf("row %v", row.vals)
	}
	cols[1] = Col{"name", "Kit 2"}
	row, err = Upsert(ctx, tx, "crm.crm_xp_rules", "code", cols)
	if err != nil || row.Str("name") != "Kit 2" {
		t.Fatalf("upsert update: %v %v", err, row)
	}
	if string(row.Get("metadata").(json.RawMessage)) != `{"k":[1]}` {
		t.Fatalf("metadata %s", row.Get("metadata"))
	}
}

func TestJSJSON(t *testing.T) {
	got := string(JSJSON([]byte(`{"b":1.50,"10":true,"a":[1e2,{"2":0,"x":null,"1":"s"}],"01":0}`)))
	want := `{"10":true,"b":1.5,"a":[100,{"1":"s","2":0,"x":null}],"01":0}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}
