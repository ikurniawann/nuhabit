package accounts_test

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/configuration/accounts"
	"nuhabit/backend/internal/platform/testutil"
)

type env struct {
	t     *testing.T
	staff testutil.Staff
	tx    pgx.Tx
	mux   *http.ServeMux
}

// setup creates the staff before the transaction so the rollback runs
// first on cleanup and never waits on the staff delete.
func setup(t *testing.T, menus map[string][]string) *env {
	t.Helper()
	staff := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", Menus: menus})
	tx := testutil.Tx(t)
	deps := testutil.Deps(t, nil)
	mux := http.NewServeMux()
	for _, r := range accounts.Routes(deps, tx, app.ConfigurationPorts(deps).Accounts) {
		mux.Handle(r.Pattern, r.Handler)
	}
	return &env{t: t, staff: staff, tx: tx, mux: mux}
}

func settingsUsers(t *testing.T) *env { return setup(t, map[string][]string{"settings.users": nil}) }

func (e *env) do(method, target string, body any) (int, map[string]any, string) {
	e.t.Helper()
	rec, out := testutil.Do(e.t, e.mux, testutil.AsStaff(testutil.Request(method, target, body), e.staff))
	return rec.Code, out, rec.Body.String()
}

func (e *env) scalar(sql string, args ...any) any {
	e.t.Helper()
	var v any
	if err := e.tx.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		e.t.Fatalf("%s: %v", sql, err)
	}
	return v
}

func uniqueEmail() string { return "go-acc-" + testutil.RandomHex(5) + "@test.local" }

func employeeBody(email string) map[string]any {
	return map[string]any{
		"full_name": "Budi Santoso", "email": email, "join_date": "2026-01-01", "employment_status": "permanent",
	}
}

func wantError(t *testing.T, code int, body map[string]any, status int, msg string) {
	t.Helper()
	if code != status || body["success"] != false || body["error"] != msg {
		t.Fatalf("got %d %v, want %d %q", code, body, status, msg)
	}
}

const unknownID = "00000000-0000-4000-8000-000000000001"

func TestForbiddenWithoutSettingsUsers(t *testing.T) {
	e := setup(t, map[string][]string{"go.test.other": nil})
	email := uniqueEmail()
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/users"}, {"POST", "/api/users"}, {"GET", "/api/users/" + unknownID},
		{"PUT", "/api/users/" + unknownID}, {"POST", "/api/users/" + unknownID + "/reset-password"},
		{"GET", "/api/admin/users"}, {"POST", "/api/admin/users"}, {"PATCH", "/api/admin/users/" + unknownID},
		{"POST", "/api/admin/users/" + unknownID + "/reset-password"},
	} {
		code, body, raw := e.do(c.method, c.path, employeeBody(email))
		wantError(t, code, body, 403, "Insufficient permissions")
		if raw != `{"success":false,"error":"Insufficient permissions"}` {
			t.Fatalf("%s %s body %s", c.method, c.path, raw)
		}
	}
	if n := e.scalar(`SELECT count(*) FROM hris.employees WHERE email = $1`, email); n != int64(0) {
		t.Fatalf("employee written behind a 403")
	}
}

func TestListUsers(t *testing.T) {
	e := settingsUsers(t)
	code, body, _ := e.do("GET", "/api/users?sort_by=password_hash", nil)
	wantError(t, code, body, 400, "Parameter tidak valid")

	tag := testutil.RandomHex(4)
	for i := 0; i < 3; i++ {
		b := employeeBody(uniqueEmail())
		b["full_name"] = "Budi " + tag + " " + string(rune('A'+i))
		if code, body, _ := e.do("POST", "/api/users", b); code != 201 {
			t.Fatalf("create: %d %v", code, body)
		}
	}
	code, body, _ = e.do("GET", "/api/users?page=2&limit=2&is_access_app=false&search=budi+"+tag+"&sort_order=desc", nil)
	if code != 200 || body["total"] != float64(3) || body["page"] != float64(2) || body["perPage"] != float64(2) {
		t.Fatalf("list: %d %v", code, body)
	}
	data := body["data"].([]any)
	if len(data) != 1 || data[0].(map[string]any)["fullName"] != "Budi "+tag+" A" {
		t.Fatalf("page 2: %v", data)
	}
	code, body, _ = e.do("GET", "/api/users?search=budi+"+tag+"&role=admin", nil)
	if code != 200 || body["total"] != float64(3) || len(body["data"].([]any)) != 0 {
		t.Fatalf("role filter drops rows without account: %d %v", code, body)
	}
}

var employeeKeys = []string{"id", "userId", "fullName", "nip", "email", "phone", "joinDate", "endDate",
	"employmentStatus", "isActive", "isAccessApp", "departmentId", "sectionId", "jobTitleId", "reportingTo",
	"ktp", "npwp", "birthDate", "gender", "maritalStatus", "address", "city", "province", "postalCode",
	"bankName", "bankAccount", "bpjsTk", "bpjsKesehatan", "emergencyContactName", "emergencyContactPhone",
	"emergencyContactRelationship", "photoUrl", "notes", "createdAt", "updatedAt", "department", "section",
	"jobTitle", "manager", "appAccount"}

func keyOrder(t *testing.T, raw json.RawMessage) []string {
	t.Helper()
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	if _, err := dec.Token(); err != nil {
		t.Fatal(err)
	}
	var keys []string
	for dec.More() {
		k, _ := dec.Token()
		keys = append(keys, k.(string))
		var skip json.RawMessage
		_ = dec.Decode(&skip)
	}
	return keys
}

func TestCreateAndGetUser(t *testing.T) {
	e := settingsUsers(t)
	email := uniqueEmail()
	code, body, raw := e.do("POST", "/api/users", employeeBody(email))
	if code != 201 || body["message"] != "Employee created successfully" {
		t.Fatalf("create: %d %s", code, raw)
	}
	var env struct{ Data json.RawMessage }
	_ = json.Unmarshal([]byte(raw), &env)
	if got := strings.Join(keyOrder(t, env.Data), ","); got != strings.Join(employeeKeys, ",") {
		t.Fatalf("keys %s", got)
	}
	data := body["data"].(map[string]any)
	if !regexp.MustCompile(`^EMP-\d{4}-\d{5}$`).MatchString(data["nip"].(string)) || data["phone"] != "" ||
		data["joinDate"] != "2026-01-01T00:00:00.000Z" || data["appAccount"] != nil || data["isAccessApp"] != false {
		t.Fatalf("data %v", data)
	}
	code, got, _ := e.do("GET", "/api/users/"+data["id"].(string), nil)
	if code != 200 || got["data"].(map[string]any)["email"] != email {
		t.Fatalf("detail: %d %v", code, got)
	}

	// The manager embed follows reporting_to to the other employee.
	report := employeeBody(uniqueEmail())
	report["reporting_to"] = data["id"]
	code, body, raw = e.do("POST", "/api/users", report)
	if code != 201 {
		t.Fatalf("create report: %d %s", code, raw)
	}
	code, got, _ = e.do("GET", "/api/users/"+body["data"].(map[string]any)["id"].(string), nil)
	if m, _ := got["data"].(map[string]any)["manager"].(map[string]any); code != 200 || m == nil || m["id"] != data["id"] {
		t.Fatalf("manager: %d %v", code, got["data"])
	}

	code, body, _ = e.do("POST", "/api/users", employeeBody(email))
	wantError(t, code, body, 409, "Email sudah dipakai akun lain")
}

func TestCreateUserWithAppAccount(t *testing.T) {
	e := settingsUsers(t)
	if _, err := e.tx.Exec(context.Background(), `INSERT INTO iam.roles (code, name, is_system) VALUES ('super_admin', 'Super Admin', true)
		ON CONFLICT (code) DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	email := uniqueEmail()
	b := employeeBody(email)
	b["is_access_app"] = true
	b["password"] = "rahasia123"
	b["role"] = "super_admin"
	b["approval_permissions"] = []any{
		map[string]any{"module": "pos", "workflow": "pos_void", "approval_level": "approver", "approval_limit": "150000.50"},
		map[string]any{"module": "hris", "workflow": "leave_request", "approval_level": "checker", "is_active": false},
	}
	code, body, raw := e.do("POST", "/api/users", b)
	if code != 201 {
		t.Fatalf("create: %d %s", code, raw)
	}
	data := body["data"].(map[string]any)
	acc, _ := data["appAccount"].(map[string]any)
	if acc == nil || acc["role"] != "super_admin" || acc["status"] != "active" || acc["canSwitchStall"] != false ||
		data["userId"] != acc["id"] || data["isAccessApp"] != true {
		t.Fatalf("app account %v", data)
	}
	userID := acc["id"].(string)
	if ok := e.scalar(`SELECT password_hash = public.crypt('rahasia123', password_hash) FROM auth.users WHERE id = $1`, userID); ok != true {
		t.Fatal("password hash does not verify")
	}
	if n := e.scalar(`SELECT count(*) FROM configuration.user_approval_permissions WHERE user_id = $1 AND approval_limit = 150000.50`, userID); n != int64(1) {
		t.Fatalf("permissions %v", n)
	}
	// The users list embeds the permissions granted to each user (user_id),
	// not the ones the user created.
	_, _, listRaw := e.do("GET", "/api/admin/users", nil)
	var users struct {
		Data []struct {
			ID    string `json:"id"`
			Perms []struct {
				UserID   string `json:"user_id"`
				Workflow string `json:"workflow"`
			} `json:"user_approval_permissions"`
		}
	}
	_ = json.Unmarshal([]byte(listRaw), &users)
	for _, u := range users.Data {
		if u.ID == userID && (len(u.Perms) != 1 || u.Perms[0].UserID != userID || u.Perms[0].Workflow != "pos_void") {
			t.Fatalf("listed permissions of %s: %+v", userID, u.Perms)
		}
	}
	if n := e.scalar(`SELECT count(*) FROM iam.user_roles ur JOIN iam.roles r ON r.id = ur.role_id
  WHERE ur.user_id = $1 AND r.code = 'super_admin' AND ur.is_primary`, userID); n != int64(1) {
		t.Fatalf("iam role %v", n)
	}
	if n := e.scalar(`SELECT count(*) FROM configuration.admin_user_audit_logs WHERE target_user_id = $1 AND action = 'create_user'`, userID); n != int64(1) {
		t.Fatalf("audit %v", n)
	}

	// Reset the password, then revoke access.
	id := data["id"].(string)
	code, body, _ = e.do("POST", "/api/users/"+id+"/reset-password", nil)
	temp, _ := body["tempPassword"].(string)
	if code != 200 || body["message"] != "Password reset successfully" || !regexp.MustCompile(`^Arkiv[A-Za-z0-9_-]{12}!$`).MatchString(temp) {
		t.Fatalf("reset: %d %v", code, body)
	}
	if ok := e.scalar(`SELECT password_hash = public.crypt($2, password_hash) FROM auth.users WHERE id = $1`, userID, temp); ok != true {
		t.Fatal("temp password does not verify")
	}
	code, body, _ = e.do("PUT", "/api/users/"+id, map[string]any{"is_access_app": false})
	if code != 200 || body["message"] != "Employee updated successfully" {
		t.Fatalf("revoke: %d %v", code, body)
	}
	if acc := body["data"].(map[string]any)["appAccount"].(map[string]any); acc["status"] != "inactive" {
		t.Fatalf("revoked account %v", acc)
	}
	if banned := e.scalar(`SELECT banned_until > now() + interval '50 years' FROM auth.users WHERE id = $1`, userID); banned != true {
		t.Fatal("not banned")
	}
	code, body, _ = e.do("POST", "/api/users/"+id+"/reset-password", nil)
	wantError(t, code, body, 400, "This employee does not have app access")
}

func TestUpdateUserProvisionsAccount(t *testing.T) {
	e := settingsUsers(t)
	email := uniqueEmail()
	_, body, _ := e.do("POST", "/api/users", employeeBody(email))
	id := body["data"].(map[string]any)["id"].(string)

	code, body, _ := e.do("PUT", "/api/users/"+id, map[string]any{"is_access_app": true, "role": "super_admin"})
	wantError(t, code, body, 400, "Password and role are required to enable app access")

	code, body, raw := e.do("PUT", "/api/users/"+id, map[string]any{
		"phone": nil, "notes": "catatan", "is_access_app": true, "password": "rahasia123", "role": "super_admin",
	})
	if code != 200 {
		t.Fatalf("provision: %d %s", code, raw)
	}
	data := body["data"].(map[string]any)
	if data["notes"] != "catatan" || data["phone"] != "" || data["appAccount"] == nil {
		t.Fatalf("data %v", data)
	}
	// Sync: rename and deactivate through the linked account.
	code, body, _ = e.do("PUT", "/api/users/"+id, map[string]any{"full_name": "Budi Baru", "account_status": "inactive"})
	acc := body["data"].(map[string]any)["appAccount"].(map[string]any)
	if code != 200 || acc["status"] != "inactive" {
		t.Fatalf("sync: %d %v", code, body)
	}
	if meta := e.scalar(`SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = $1`, acc["id"]); meta != "Budi Baru" {
		t.Fatalf("auth metadata %v", meta)
	}
}

func TestProvisionFailureKeepsEmployeeOnly(t *testing.T) {
	e := settingsUsers(t)
	appUser := func(email string) map[string]any {
		b := employeeBody(email)
		b["is_access_app"] = true
		b["password"] = "rahasia123"
		b["role"] = "super_admin"
		return b
	}
	assertRolledBack := func(email string) {
		t.Helper()
		if n := e.scalar(`SELECT count(*) FROM hris.employees WHERE email = $1 AND user_id IS NULL`, email); n != int64(1) {
			t.Fatalf("employee rows %v", n)
		}
		if n := e.scalar(`SELECT count(*) FROM auth.users WHERE email = $1`, email); n != int64(0) {
			t.Fatalf("auth user kept %v", n)
		}
	}

	// An unknown default stall breaks the profile insert's foreign key.
	email := uniqueEmail()
	b := appUser(email)
	b["default_warehouse_id"] = unknownID
	code, body, _ := e.do("POST", "/api/users", b)
	wantError(t, code, body, 400, "Referensi data tidak valid")
	assertRolledBack(email)

	warehouse, _ := e.scalar(`SELECT id::text FROM configuration.warehouses WHERE is_active LIMIT 1`).(string)
	branch, _ := e.scalar(`SELECT branch_id::text FROM configuration.warehouses WHERE id = $1`, warehouse).(string)

	// A stall without a branch fails in syncUserWarehouses: 500, nothing leaked.
	email = uniqueEmail()
	b = appUser(email)
	b["default_warehouse_id"] = warehouse
	code, body, raw := e.do("POST", "/api/users", b)
	wantError(t, code, body, 500, "Terjadi kesalahan server")
	if strings.Contains(raw, "Branch") {
		t.Fatalf("leaked %s", raw)
	}
	assertRolledBack(email)

	// With the branch the stall is assigned and listed.
	b = appUser(uniqueEmail())
	b["default_warehouse_id"] = warehouse
	b["branch_id"] = branch
	code, body, raw = e.do("POST", "/api/users", b)
	if code != 201 {
		t.Fatalf("create: %d %s", code, raw)
	}
	acc := body["data"].(map[string]any)["appAccount"].(map[string]any)
	stalls := acc["warehouses"].([]any)
	if acc["defaultWarehouseId"] != warehouse || len(stalls) != 1 || stalls[0].(map[string]any)["id"] != warehouse ||
		stalls[0].(map[string]any)["branchId"] != branch || acc["branchId"] != nil {
		t.Fatalf("stalls %v", acc)
	}
}

func TestUserValidationAndMissing(t *testing.T) {
	e := settingsUsers(t)
	code, body, _ := e.do("POST", "/api/users", map[string]any{"full_name": "B"})
	wantError(t, code, body, 400, "Validation failed")
	details := body["details"].([]any)
	if first := details[0].(map[string]any); first["code"] != "too_small" || first["path"].([]any)[0] != "full_name" {
		t.Fatalf("details %v", details)
	}
	code, body, _ = e.do("GET", "/api/users/"+unknownID, nil)
	wantError(t, code, body, 404, "Employee not found")
	code, body, _ = e.do("PUT", "/api/users/"+unknownID, map[string]any{"phone": "0812"})
	wantError(t, code, body, 400, "Employee not found")
	code, body, _ = e.do("POST", "/api/users/"+unknownID+"/reset-password", nil)
	wantError(t, code, body, 404, "Employee not found")
	code, body, _ = e.do("POST", "/api/users", "{bad json")
	wantError(t, code, body, 500, "Terjadi kesalahan server")
}

func TestMalformedEmployeeID(t *testing.T) {
	e := settingsUsers(t)
	// The id cast runs per row, so an empty employees table would answer 404.
	e.scalar(`INSERT INTO hris.employees (full_name, nip, email, phone, join_date) VALUES ('Go Test', $1, $2, '0811', current_date) RETURNING id`,
		"NIP"+testutil.RandomHex(3), uniqueEmail())
	code, body, _ := e.do("GET", "/api/users/abc", nil)
	wantError(t, code, body, 400, "Format data tidak valid")
}

func TestAdminUsers(t *testing.T) {
	e := settingsUsers(t)
	email := uniqueEmail()
	code, body, raw := e.do("POST", "/api/admin/users", map[string]any{
		"email": email, "password": "rahasia123", "full_name": "Admin Baru", "role": "admin", "status": "inactive",
	})
	if code != 201 || body["message"] != "User berhasil dibuat" {
		t.Fatalf("create: %d %s", code, raw)
	}
	var created struct{ Data json.RawMessage }
	_ = json.Unmarshal([]byte(raw), &created)
	if got := strings.Join(keyOrder(t, created.Data), ","); got != "id,full_name,email,role,brand_id,status,created_at" {
		t.Fatalf("profile keys %s", got)
	}
	id := body["data"].(map[string]any)["id"].(string)

	code, body, raw = e.do("GET", "/api/admin/users", nil)
	if code != 200 {
		t.Fatalf("list: %d", code)
	}
	var list struct{ Data []json.RawMessage }
	_ = json.Unmarshal([]byte(raw), &list)
	found := false
	for _, row := range list.Data {
		var r map[string]any
		_ = json.Unmarshal(row, &r)
		if r["id"] != id {
			continue
		}
		found = true
		if got := strings.Join(keyOrder(t, row), ","); got != "id,full_name,email,role,brand_id,status,created_at,updated_at,brands,user_approval_permissions,auth_status,last_sign_in_at,email_confirmed_at" {
			t.Fatalf("list keys %s", got)
		}
		if r["auth_status"] != "banned" || r["email"] != email || r["email_confirmed_at"] == nil {
			t.Fatalf("row %v", r)
		}
	}
	if !found {
		t.Fatal("created user missing from list")
	}

	code, body, _ = e.do("PATCH", "/api/admin/users/"+e.staff.UserID, map[string]any{"role": "admin"})
	wantError(t, code, body, 400, "Super admin tidak bisa menonaktifkan atau menurunkan role dirinya sendiri")

	code, body, _ = e.do("PATCH", "/api/admin/users/"+id, map[string]any{
		"full_name": "Admin Lama", "status": "active",
		"approval_permissions": []any{map[string]any{"module": "pos", "workflow": "pos_refund", "approval_level": "checker"}},
	})
	data, _ := body["data"].(map[string]any)
	if code != 200 || body["message"] != "User berhasil diperbarui" || data["full_name"] != "Admin Lama" || data["updated_at"] == nil {
		t.Fatalf("update: %d %v", code, body)
	}
	if banned := e.scalar(`SELECT banned_until IS NULL FROM auth.users WHERE id = $1`, id); banned != true {
		t.Fatal("still banned")
	}

	code, body, _ = e.do("POST", "/api/admin/users/"+id+"/reset-password", nil)
	if code != 200 || body["message"] != "Password sementara berhasil dibuat" || body["tempPassword"] == nil {
		t.Fatalf("reset: %d %v", code, body)
	}
	code, body, _ = e.do("POST", "/api/admin/users/"+unknownID+"/reset-password", nil)
	wantError(t, code, body, 404, "Email user tidak ditemukan")
	code, body, _ = e.do("PATCH", "/api/admin/users/"+unknownID, map[string]any{"full_name": "Siapa"})
	wantError(t, code, body, 400, "User not found")

	// The duplicate email fails inside the auth insert: 400 with PostgreSQL's message.
	code, body, _ = e.do("POST", "/api/admin/users", map[string]any{
		"email": email, "password": "rahasia123", "full_name": "Admin Dua", "role": "admin",
	})
	wantError(t, code, body, 400, `duplicate key value violates unique constraint "users_email_key"`)
}
