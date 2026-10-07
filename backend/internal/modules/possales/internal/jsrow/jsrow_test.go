package jsrow

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// The expected strings are what node-postgres + JSON.stringify print for the
// same SELECT on a UTC server (checked with node).
func TestQueryMatchesNodePostgres(t *testing.T) {
	db := testutil.DB(t)
	rows, err := Query(context.Background(), db, `SELECT 15000.00::numeric(12,2) AS n, 7::int8 AS b, 3::int4 AS i, 1.5::float8 AS f, true AS t,
		'2026-10-04 10:00:00.123+07'::timestamptz AS ts, '2026-10-04'::date AS d, NULL::text AS z,
		'{"a": 1.50, "b": [2.0, 1e3]}'::jsonb AS j, '00000000-0000-4000-8000-000000000001'::uuid AS u, ARRAY['x','y'] AS arr`)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := Marshal(rows)
	want := `[{"n":"15000.00","b":"7","i":3,"f":1.5,"t":true,"ts":"2026-10-04T03:00:00.123Z","d":"2026-10-04T00:00:00.000Z","z":null,"j":{"a":1.5,"b":[2,1000]},"u":"00000000-0000-4000-8000-000000000001","arr":["x","y"]}]`
	if string(got) != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}

func TestRowKeepsInsertionOrder(t *testing.T) {
	r := Object("b", 1, "a", "<x>")
	r.Set("b", 2)
	r.Set("c", nil)
	r.Delete("a")
	got, _ := Marshal(r)
	if string(got) != `{"b":2,"c":null}` {
		t.Fatalf("got %s", got)
	}
	if string(NormalizeJSON([]byte(`{"x":1.0e2,"y":"<a>"}`))) != `{"x":100,"y":"<a>"}` {
		t.Fatal("normalize")
	}
}
