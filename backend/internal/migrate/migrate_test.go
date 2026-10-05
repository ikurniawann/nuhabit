package migrate

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/testutil"
)

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestListFilesOrder(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "deltas", "20260101000000_b.sql"), "")
	write(t, filepath.Join(dir, "bootstrap", "00000000000001_prelude.sql"), "")
	write(t, filepath.Join(dir, "schemas", "pos", "20250101000000_pos.sql"), "")
	write(t, filepath.Join(dir, "deltas", "20260101000000_a.sql"), "")
	write(t, filepath.Join(dir, "deltas", "notes.txt"), "")
	files, err := ListFiles(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range files {
		names = append(names, f.Name)
	}
	want := "00000000000001_prelude.sql,20250101000000_pos.sql,20260101000000_a.sql,20260101000000_b.sql"
	if strings.Join(names, ",") != want {
		t.Fatalf("order = %v", names)
	}

	write(t, filepath.Join(dir, "other", "20260101000000_a.sql"), "")
	if _, err := ListFiles(dir); err == nil || !strings.Contains(err.Error(), "Duplikat nama file migrasi") {
		t.Fatalf("duplicate basename must fail, got %v", err)
	}
}

func TestGuards(t *testing.T) {
	if !IsLocalURL("postgres://postgres@localhost:55432/nuhabit") || !IsLocalURL("postgresql://u@127.0.0.1/db") {
		t.Fatal("local URLs")
	}
	if IsLocalURL("postgres://u@db.example.com/x") || IsLocalURL("garbage") {
		t.Fatal("remote URLs")
	}
	if got := MaskURL("postgres://u:secret@db.example.com:5432/x"); got != "postgres://u:****@db.example.com:5432/x" {
		t.Fatalf("MaskURL = %s", got)
	}
}

// TestSearchPathMatchesSchemaMap compares with searchPathSchemas() when node
// is available.
func TestSearchPathMatchesSchemaMap(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	out, err := exec.Command(node, "-e", `console.log(require("../../database/schema-map").searchPathSchemas().join(","))`).Output()
	if err != nil {
		t.Skipf("schema-map.js not loadable: %v", err)
	}
	if got := strings.TrimSpace(string(out)); got != strings.Join(SearchPath, ",") {
		t.Fatalf("SearchPath drifted from schema-map.js: %s", got)
	}
}

func TestRunAppliesAndRecords(t *testing.T) {
	db := testutil.DB(t)
	ctx := context.Background()
	suffix := testutil.RandomHex(4)
	schema := "go_migrate_test_" + suffix
	dir := t.TempDir()
	ok1 := "99999999999990_go_test_" + suffix + "_a.sql"
	ok2 := "99999999999991_go_test_" + suffix + "_b.sql"
	bad := "99999999999992_go_test_" + suffix + "_c.sql"
	write(t, filepath.Join(dir, "deltas", ok1), "CREATE SCHEMA "+schema+"; CREATE TABLE "+schema+".t (id int);")
	write(t, filepath.Join(dir, "deltas", ok2), "INSERT INTO "+schema+".t VALUES (1); INSERT INTO "+schema+".t VALUES (2);")
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
		_, _ = db.Exec(context.Background(), "DELETE FROM schema_migrations WHERE filename LIKE $1", "%go_test_"+suffix+"%")
	})
	url := os.Getenv("TEST_DATABASE_URL")

	var out, errOut bytes.Buffer
	if err := Run(ctx, Options{URL: url, Dir: dir, Out: &out, Err: &errOut}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "Dry-run: 2 migrasi pending dari 2 file.") || !strings.Contains(out.String(), "[pending] deltas/"+ok1) {
		t.Fatalf("dry run output:\n%s", out.String())
	}

	out.Reset()
	if err := Run(ctx, Options{URL: url, Dir: dir, Apply: true, Out: &out, Err: &errOut}); err != nil {
		t.Fatalf("%v\n%s", err, errOut.String())
	}
	var n int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM "+schema+".t").Scan(&n); err != nil || n != 2 {
		t.Fatalf("rows = %d, %v", n, err)
	}
	var checksum string
	if err := db.QueryRow(ctx, "SELECT checksum FROM schema_migrations WHERE filename = $1", ok2).Scan(&checksum); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "deltas", ok2))
	if checksum != Checksum(raw) {
		t.Fatal("checksum mismatch")
	}

	// A failing file rolls back entirely and stops the run.
	write(t, filepath.Join(dir, "deltas", bad), "INSERT INTO "+schema+".t VALUES (3); SELECT 1/0;")
	out.Reset()
	errOut.Reset()
	if err := Run(ctx, Options{URL: url, Dir: dir, Apply: true, Out: &out, Err: &errOut}); err == nil {
		t.Fatal("expected failure")
	}
	if !strings.Contains(errOut.String(), "[FAIL]  "+bad+"\n          division by zero\n") {
		t.Fatalf("stderr: %s", errOut.String())
	}
	_ = db.QueryRow(ctx, "SELECT count(*) FROM "+schema+".t").Scan(&n)
	if n != 2 {
		t.Fatalf("failed file must roll back, rows = %d", n)
	}
	if err := db.QueryRow(ctx, "SELECT count(*) FROM schema_migrations WHERE filename = $1", bad).Scan(&n); err != nil || n != 0 {
		t.Fatal("failed file must not be recorded")
	}
}

func TestVerifyReportsDrift(t *testing.T) {
	testutil.DB(t) // skips without TEST_DATABASE_URL
	ctx := context.Background()
	target, drop, err := createScratch(ctx, os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(drop)
	dir := t.TempDir()
	write(t, filepath.Join(dir, "deltas", "20990101000000_verify.sql"), `
CREATE SCHEMA s;
CREATE TABLE s.t (id int NOT NULL, name text);
CREATE FUNCTION s.f() RETURNS int LANGUAGE sql AS 'SELECT 1';`)
	var out bytes.Buffer
	if err := Run(ctx, Options{URL: target, Dir: dir, Apply: true, Out: &out, Err: &out}); err != nil {
		t.Fatalf("%v\n%s", err, out.String())
	}

	out.Reset()
	if err := Verify(ctx, VerifyOptions{URL: target, Dir: dir, Out: &out}); err != nil {
		t.Fatalf("clean target: %v\n%s", err, out.String())
	}

	conn, err := pgx.Connect(ctx, target)
	if err != nil {
		t.Fatal(err)
	}
	_, err = conn.Exec(ctx, `
ALTER TABLE s.t DROP COLUMN name;
CREATE OR REPLACE FUNCTION s.f() RETURNS int LANGUAGE sql AS 'SELECT 2';
CREATE TABLE s.extra (id int);`)
	conn.Close(ctx)
	if err != nil {
		t.Fatal(err)
	}
	out.Reset()
	if err := Verify(ctx, VerifyOptions{URL: target, Dir: dir, Out: &out}); !errors.Is(err, ErrDrift) {
		t.Fatalf("err = %v, want ErrDrift\n%s", err, out.String())
	}
	for _, want := range []string{"[missing] column s.t.name\n", "[differs] function s.f()\n", "[extra]   relation s.extra\n"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("output lacks %q:\n%s", want, out.String())
		}
	}
}

func TestCanonicalIgnoresDeparseShape(t *testing.T) {
	a := `CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'void'::character varying])::text[])))`
	b := `CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('void'::character varying)::text])))`
	if canonical(a) != canonical(b) {
		t.Fatalf("%s\n%s", canonical(a), canonical(b))
	}
	changed := `CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('closed'::character varying)::text])))`
	if canonical(a) == canonical(changed) {
		t.Fatal("a changed value must still differ")
	}
}
