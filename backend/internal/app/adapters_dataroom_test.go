package app

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

func TestDataroomPortsReadTheTSEnv(t *testing.T) {
	env := map[string]string{"DATAROOM_QUOTA_GB": "0.5", "DATAROOM_MAX_FILE_MB": "abc", "FROM_EMAIL": "", "NEXT_PUBLIC_APP_URL": "https://dr.example/"}
	getenv := func(k string) string { return env[k] }
	lookup := func(k string) (string, bool) { v, ok := env[k]; return v, ok }
	p := dataroomPorts(module.Deps{}, getenv, lookup)
	// Math.max(1, 0.5) GB; "abc" falls back to 100 MB; FROM_EMAIL "" is set.
	if p.QuotaBytes != 1<<30 || p.MaxFileBytes != 100<<20 || p.MailFrom != "" || p.Brand != "NüHabit" || p.AppOrigin != "https://dr.example" {
		t.Fatalf("ports %+v", p)
	}
}

func TestDataroomDirectory(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	var dept string
	if err := tx.QueryRow(ctx, `INSERT INTO hris.departments (name, code) VALUES ('Go Test Arsip', $1) RETURNING id::text`, "GT-"+testutil.RandomHex(4)).Scan(&dept); err != nil {
		t.Fatal(err)
	}
	dir := dataroomDirectory{db: tx}
	found, err := dir.DepartmentsByID(ctx, []string{dept, "00000000-0000-0000-0000-000000000000"})
	if err != nil || len(found) != 1 || found[0].Name != "Go Test Arsip" {
		t.Fatalf("by id %v %v", found, err)
	}
	id, name, err := dir.ActorDepartment(ctx, testutil.CreateStaff(t, testutil.StaffOptions{}).UserID)
	if err != nil || id != nil || name != nil {
		t.Fatalf("no employee: %v %v %v", id, name, err)
	}
}
