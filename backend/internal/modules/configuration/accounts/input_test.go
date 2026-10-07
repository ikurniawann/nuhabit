package accounts

import (
	"encoding/json"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

func form(t *testing.T, body string) *validate.Form {
	t.Helper()
	dec := json.NewDecoder(strings.NewReader(body))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatal(err)
	}
	return validate.New(v, true)
}

func issueList(f *validate.Form) []string {
	var out []string
	for _, is := range f.Issues() {
		parts := make([]string, len(is.Path))
		for i, p := range is.Path {
			b, _ := json.Marshal(p)
			parts[i] = strings.Trim(string(b), `"`)
		}
		out = append(out, strings.Join(parts, ".")+" "+is.Code+" "+is.Message)
	}
	return out
}

const validCore = `"full_name":"Budi","email":"budi@example.com","join_date":"2026-01-01","employment_status":"permanent"`

func TestCreateEmployeeSchema(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       []string
	}{
		{"valid", `{` + validCore + `}`, nil},
		{"app access needs password, role and scope", `{` + validCore + `,"is_access_app":true,"role":"admin"}`, []string{
			"password custom Password is required for app access",
			"business_scope custom Data access scope is required for this role",
		}},
		{"short password still refines", `{` + validCore + `,"is_access_app":true,"password":"x"}`, []string{
			"password too_small Too small: expected string to have >=8 characters",
			"role custom Role is required for app access",
		}},
		{"invalid enum stops the refinement", `{` + validCore + `,"is_access_app":true,"role":"boss"}`, []string{
			`role invalid_value Invalid option: expected one of "super_admin"|"admin"|"hrd"|"hiring_manager"|"direksi"|"purchasing_admin"|"purchasing_manager"|"purchasing_staff"|"finance_staff"|"warehouse_staff"|"warehouse_admin"|"pos"|"pos_supervisor"|"qc_staff"|"employee"|"sales"|"marketing"`,
		}},
		{"branch scope needs a stall", `{` + validCore + `,"is_access_app":true,"password":"rahasia123","role":"pos","business_scope":"branch",
			"holding_id":"11111111-1111-4111-8111-111111111111","company_id":"11111111-1111-4111-8111-111111111111","branch_id":"11111111-1111-4111-8111-111111111111"}`, []string{
			"default_warehouse_id custom Stall default wajib untuk scope branch",
		}},
		{"approval items", `{` + validCore + `,"approval_permissions":[
			{"module":"pos","workflow":"vendor_payment","approval_level":"checker","approval_limit":"-1"},
			{"module":"pos","workflow":"pos_void","approval_level":"boss"},
			{"module":"pos","workflow":"pos_void","approval_level":"checker","approval_limit":"abc"}]}`, []string{
			"approval_permissions.0.approval_limit too_small Too small: expected number to be >=0",
			"approval_permissions.0.workflow custom Workflow tidak sesuai dengan module approval",
			`approval_permissions.1.approval_level invalid_value Invalid option: expected one of "checker"|"approver"|"final_approver"`,
			"approval_permissions.2.approval_limit invalid_type Invalid input: expected number, received NaN",
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := form(t, tc.body)
			parseEmployeeBody(f, true)
			if got := issueList(f); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %q\nwant %q", got, tc.want)
			}
		})
	}
}

func TestUpdateEmployeeSchema(t *testing.T) {
	f := form(t, `{"is_access_app":true,"password":"short"}`)
	parseEmployeeBody(f, false)
	want := []string{
		"password too_small Too small: expected string to have >=8 characters",
		"password custom Password must be at least 8 characters",
	}
	if got := issueList(f); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q", got)
	}

	f = form(t, `{"role":"admin","phone":null,"branch_id":null,"full_name":"Budi Baru","can_switch_stall":true}`)
	b := parseEmployeeBody(f, false)
	if !f.Valid() || b.str("phone") != nil || !b.has("phone") || !b.has("branch_id") || b.has("email") {
		t.Fatalf("presence: %v", issueList(f))
	}
	if got := b.keys(false); !reflect.DeepEqual(got, []string{"full_name", "phone", "role", "branch_id", "can_switch_stall"}) {
		t.Fatalf("keys %v", got)
	}
	created := parseEmployeeBody(form(t, `{`+validCore+`}`), true)
	if got := created.keys(true); len(got) != 6 || got[4] != "is_access_app" || got[5] != "approval_permissions" {
		t.Fatalf("create keys %v", got)
	}
}

func TestAdminSchemas(t *testing.T) {
	f := form(t, `{"email":"a@b.co","password":"rahasia123","full_name":"Ad","role":"admin","approval_permissions":[{"module":"pos","workflow":"pos_void","approval_level":"checker","approval_limit":12.5,"is_active":false}]}`)
	b := parseAdminCreate(f)
	if !f.Valid() || *b.status != "active" || len(b.approvals) != 1 || b.approvals[0].IsActive || *b.approvals[0].Limit != 12.5 {
		t.Fatalf("create: %v %+v", issueList(f), b)
	}
	f = form(t, `{"status":"inactive","brand_id":null,"email":"bad"}`)
	b = parseAdminUpdate(f)
	if got := issueList(f); len(got) != 1 || got[0] != "email invalid_format Invalid email address" {
		t.Fatalf("update issues %v", got)
	}
	if got := b.keys(); !reflect.DeepEqual(got, []string{"email", "brand_id", "status"}) {
		t.Fatalf("keys %v", got)
	}
}

func TestParseListQuery(t *testing.T) {
	q, err := parseListQuery(url.Values{"page": {"2"}, "limit": {"15"}, "is_access_app": {"true"}, "search": {" bu(di), "}, "role": {""}})
	if err != nil || q.page != 2 || q.limit != 15 || q.isAccessApp == nil || !*q.isAccessApp || *q.search != "bu di" ||
		q.role != nil || q.sortBy != "full_name" || !q.asc {
		t.Fatalf("got %+v %v", q, err)
	}
	q, err = parseListQuery(url.Values{"page": {"3", ""}, "search": {"(,)"}, "sort_order": {"desc"}})
	if err != nil || q.page != 3 || q.search != nil || q.asc {
		t.Fatalf("got %+v %v", q, err)
	}
	for _, bad := range []url.Values{
		{"sort_by": {"password_hash"}}, {"limit": {"201"}}, {"page": {"0"}}, {"page": {"1.5"}},
		{"is_active": {"yes"}}, {"search": {strings.Repeat("x", 101)}}, {"page": {"abc"}},
	} {
		_, err := parseListQuery(bad)
		var he *httpx.Error
		if e, ok := err.(*httpx.Error); ok {
			he = e
		}
		if he == nil || he.Status != 400 || he.Message != "Parameter tidak valid" {
			t.Errorf("%v: got %v", bad, err)
		}
	}
}

func TestJSNumber(t *testing.T) {
	for in, want := range map[string]float64{`"12.50"`: 12.5, `true`: 1, `[]`: 0, `["7"]`: 7, `" 0x10 "`: 16, `""`: 0} {
		var v any
		dec := json.NewDecoder(strings.NewReader(in))
		dec.UseNumber()
		_ = dec.Decode(&v)
		if got := jsNumber(v); got != want {
			t.Errorf("%s: got %v want %v", in, got, want)
		}
	}
	if got := jsNumber(map[string]any{}); got == got {
		t.Error("object is NaN")
	}
}

func TestMapEmployee(t *testing.T) {
	join := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	created := time.Date(2026, 10, 4, 3, 4, 5, 678_900_000, time.UTC)
	uid := "u-1"
	e := Employee{ID: "e-1", UserID: &uid, FullName: "Budi", NIP: "EMP-1", Email: "b@x.co", Phone: "",
		JoinDate: join, EmploymentStatus: "permanent", IsActive: true, CreatedAt: created,
		Department: json.RawMessage(`{"id" : "d", "name":"Ops","code":null}`)}
	app := &appUser{ID: "u-1", Role: "admin", Status: "active", CanSwitchStall: true,
		Warehouses: []warehouseRow{{WarehouseID: "w", Name: "Stall", Code: "S1", BranchID: "b"}}}
	v, err := mapEmployee(e, app)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(v)
	s := string(raw)
	for _, part := range []string{
		`"joinDate":"2026-01-01T00:00:00.000Z","endDate":null`,
		`"createdAt":"2026-10-04T03:04:05.678Z","updatedAt":null`,
		`"department":{"id":"d","name":"Ops","code":null},"section":null`,
		`"brandId":null,"brandName":null`,
		`"approvalPermissions":[],"warehouses":[{"id":"w","name":"Stall","code":"S1","branchId":"b"}]`,
	} {
		if !strings.Contains(s, part) {
			t.Errorf("missing %s in %s", part, s)
		}
	}
	v, _ = mapEmployee(Employee{ID: "e-2"}, nil)
	if raw, _ := json.Marshal(v); !strings.HasSuffix(string(raw), `"manager":null,"appAccount":null}`) {
		t.Errorf("no account: %s", raw)
	}
}
