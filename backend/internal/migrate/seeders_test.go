package migrate

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

var (
	menuInsert    = regexp.MustCompile(`(?is)INSERT INTO iam\.menus\s*\([^)]*\)\s*VALUES(.*?)(?:ON CONFLICT|;)`)
	moduleMenuRow = regexp.MustCompile(`\(\s*'((?:gym|investor|tasks)(?:\.[a-z0-9-]+)*)'`)
	seederRow     = regexp.MustCompile(`(?m)^\s*\('([a-z0-9._-]+)',`)
	keepCode      = regexp.MustCompile(`'([a-z0-9._-]+)'`)
)

// Every gym, investor and tasks menu a migration creates must be in the IAM menu
// seeder, both as an upserted row and in the keep list, or re-running the
// seeder retires it.
func TestIAMMenuSeederHasModuleMenus(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	db := filepath.Join(filepath.Dir(file), "../../database")

	deltas, err := filepath.Glob(filepath.Join(db, "migrations", "deltas", "*.sql"))
	if err != nil {
		t.Fatal(err)
	}
	migrated := map[string]string{}
	for _, path := range deltas {
		sql, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, insert := range menuInsert.FindAllStringSubmatch(string(sql), -1) {
			for _, row := range moduleMenuRow.FindAllStringSubmatch(insert[1], -1) {
				migrated[row[1]] = filepath.Base(path)
			}
		}
	}
	if len(migrated) < 23 {
		t.Fatalf("found only %d gym, investor and tasks menus in the migrations: %v", len(migrated), migrated)
	}

	raw, err := os.ReadFile(filepath.Join(db, "seeders", "iam-menus.sql"))
	if err != nil {
		t.Fatal(err)
	}
	seeder := string(raw)
	upsertEnd := strings.Index(seeder, "ON CONFLICT (code)")
	keepStart := strings.Index(seeder, "code NOT IN (")
	if upsertEnd < 0 || keepStart < 0 {
		t.Fatal("seeder layout changed: no upsert or keep list")
	}
	upserted, kept := map[string]bool{}, map[string]bool{}
	for _, m := range seederRow.FindAllStringSubmatch(seeder[:upsertEnd], -1) {
		upserted[m[1]] = true
	}
	for _, m := range keepCode.FindAllStringSubmatch(seeder[keepStart:], -1) {
		kept[m[1]] = true
	}
	for code, migration := range migrated {
		if !upserted[code] {
			t.Errorf("%s (from %s) has no row in iam-menus.sql", code, migration)
		}
		if !kept[code] {
			t.Errorf("%s (from %s) is missing from the iam-menus.sql keep list and would be retired", code, migration)
		}
	}
}
