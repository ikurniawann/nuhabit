package gymcredits

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/httpx"
)

// Expected messages were captured from zod 4.4.3 with the TS schemas.

func decodeBody(t *testing.T, raw string) any {
	t.Helper()
	if raw == "" {
		return undefined
	}
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func message(t *testing.T, err error) string {
	t.Helper()
	var he *httpx.Error
	if !errors.As(err, &he) {
		t.Fatalf("want *httpx.Error, got %v", err)
	}
	if he.Status != 400 {
		t.Fatalf("status %d", he.Status)
	}
	return he.Message
}

const uuidOK = "6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11"

func TestAdjustSchemaMessages(t *testing.T) {
	cases := map[string]string{
		``:                              "Invalid input: expected object, received undefined",
		`[]`:                            "Invalid input: expected object, received array",
		`null`:                          "Invalid input: expected object, received null",
		`"x"`:                           "Invalid input: expected object, received string",
		`{}`:                            "Invalid input: expected number, received undefined",
		`{"amount":1.5,"reason":"abc"}`: "Jumlah harus bilangan bulat",
		`{"amount":"1","reason":"abc"}`: "Invalid input: expected number, received string",
		`{"amount":1,"reason":" ab "}`:  "Alasan penyesuaian wajib diisi",
		`{"amount":1,"reason":"` + strings.Repeat("a", 501) + `"}`: "Too big: expected string to have <=500 characters",
	}
	for body, want := range cases {
		_, err := parseAdjust(decodeBody(t, body))
		if got := message(t, err); got != want {
			t.Errorf("%s: got %q, want %q", body, got, want)
		}
	}
	in, err := parseAdjust(decodeBody(t, `{"amount":-2,"reason":"  koreksi  "}`))
	if err != nil || in.Amount != -2 || in.Reason != "koreksi" {
		t.Fatalf("got %+v %v", in, err)
	}
}

func TestSellSchemaMessages(t *testing.T) {
	cases := map[string]string{
		`{"package_id":"x"}`: "Pilih paket",
		`{"package_id":"` + uuidOK + `","payment_method":"cash","discount_idr":-1}`:                         "Too small: expected number to be >=0",
		`{"package_id":"` + uuidOK + `","payment_method":"cash","branch_id":"x"}`:                           "Invalid UUID",
		`{"package_id":"` + uuidOK + `","payment_method":"cash","note":"` + strings.Repeat("a", 301) + `"}`: "Too big: expected string to have <=300 characters",
		`{"package_id":"` + uuidOK + `","payment_method":"x"}`:                                              `Invalid option: expected one of "cash"|"card"|"transfer"|"qris"|"ark_coin"|"complimentary"`,
	}
	for body, want := range cases {
		_, err := parseSell(decodeBody(t, body))
		if got := message(t, err); got != want {
			t.Errorf("%s: got %q, want %q", body, got, want)
		}
	}
	in, err := parseSell(decodeBody(t, `{"package_id":"`+uuidOK+`","payment_method":"cash","branch_id":null,"note":"  hi "}`))
	if err != nil || in.BranchID != nil || in.Note == nil || *in.Note != "hi" || in.DiscountIdr != 0 {
		t.Fatalf("got %+v %v", in, err)
	}
}

func TestPackageSchemaMessages(t *testing.T) {
	base := `"name":" Pak ","credits":5,"price_idr":100,"validity_days":30`
	cases := map[string]string{
		`{` + base + `,"id":null}`:                                      "Invalid input: expected string, received null",
		`{` + base + `,"credits":1.5}`:                                  "Invalid input: expected int, received number",
		`{"name":"Pak","credits":0,"price_idr":1,"validity_days":1}`:    "Kredit minimal 1",
		`{"name":"Pak","credits":1001,"price_idr":1,"validity_days":1}`: "Too big: expected number to be <=1000",
		`{` + base + `,"applicable_class_type_ids":[]}`:                 "Too small: expected array to have >=1 items",
		`{` + base + `,"applicable_class_type_ids":["x"]}`:              "Invalid UUID",
		`{` + base + `,"description":null}`:                             "Invalid input: expected string, received null",
		`{"name":"P","credits":1,"price_idr":1,"validity_days":1}`:      "Nama paket minimal 2 huruf",
		`{"name":"Pak","credits":1,"price_idr":1e10,"validity_days":1}`: "Too big: expected number to be <=1000000000",
		`{"name":"Pak","credits":1,"price_idr":1,"validity_days":0}`:    "Masa berlaku minimal 1 hari",
		`{` + base + `,"sort_order":null}`:                              "Invalid input: expected number, received null",
		`{` + base + `,"purchase_limit_per_member":0.5}`:                "Invalid input: expected int, received number",
	}
	for body, want := range cases {
		_, err := parsePackage(decodeBody(t, body))
		if got := message(t, err); got != want {
			t.Errorf("%s: got %q, want %q", body, got, want)
		}
	}
	p, err := parsePackage(decodeBody(t, `{`+base+`,"extra":1}`))
	if err != nil || p.Name != "Pak" || p.Description != "" || p.ID != nil || p.ApplicableClassTypeIDs != nil || p.SortOrder != 0 {
		t.Fatalf("got %+v %v", p, err)
	}
}

func TestStatusAndRulesSchemas(t *testing.T) {
	_, err := parsePackageStatus(decodeBody(t, `{"status":"deleted"}`))
	if got := message(t, err); got != `Invalid option: expected one of "active"|"archived"` {
		t.Fatal(got)
	}
	for body, want := range map[string]string{
		`{}`:                           "Invalid input: expected record, received undefined",
		`{"rules":[]}`:                 "Invalid input: expected record, received array",
		`{"rules":null}`:               "Invalid input: expected record, received null",
		`{"branch_id":"x","rules":{}}`: "Invalid UUID",
	} {
		v := decodeBody(t, body)
		_, err := parseRulesPut(v, []byte(body))
		if got := message(t, err); got != want {
			t.Errorf("%s: got %q, want %q", body, got, want)
		}
	}
	raw := `{"branch_id":null,"rules":{"zeta":1,"qrTtlSec":30,"alpha":2}}`
	in, err := parseRulesPut(decodeBody(t, raw), []byte(raw))
	if err != nil || in.BranchID != nil || len(in.Rules) != 3 || in.Rules[0].Key != "zeta" || in.Rules[2].Key != "alpha" {
		t.Fatalf("got %+v %v", in, err)
	}
}

func TestMemberPurchaseSchema(t *testing.T) {
	for body, want := range map[string]string{
		`{}`:                              "Invalid input: expected string, received undefined",
		`{"package_id":"nope"}`:           "Pilih paket",
		`{"package_id":"` + uuidOK + `"}`: `Invalid option: expected one of "qris"|"ark_coin"`,
	} {
		_, err := parseMemberPurchase(decodeBody(t, body))
		var he *httpx.Error
		if !errors.As(err, &he) || he.Message != want || he.Details != nil {
			t.Errorf("%s: got %+v, want %q", body, err, want)
		}
	}
}

func TestZodUUID(t *testing.T) {
	for id, want := range map[string]bool{
		uuidOK:                                 true,
		strings.ToUpper(uuidOK):                true,
		"00000000-0000-0000-0000-000000000000": true,
		"ffffffff-ffff-ffff-ffff-ffffffffffff": true,
		"6f1c2a1e-0d7b-0c55-9a43-1b0b6a0f5e11": false,
		"6f1c2a1e-0d7b-4c55-0a43-1b0b6a0f5e11": false,
		"abc":                                  false,
	} {
		if isUUID(id) != want {
			t.Errorf("%s: want %v", id, want)
		}
	}
}

func TestPickPaidPayment(t *testing.T) {
	id, ok := pickPaidPayment([]map[string]any{{"status": "PENDING", "id": "a"}, {"status": "succeeded", "payment_id": "b"}})
	if !ok || id != "b" {
		t.Fatalf("got %q %v", id, ok)
	}
	if _, ok := pickPaidPayment(nil); ok {
		t.Fatal("empty list is not paid")
	}
}

func TestJSTime(t *testing.T) {
	raw, _ := json.Marshal(struct {
		At JSTime `json:"at"`
	}{JSTime(mustTime(t, "2026-10-04T10:00:00.123456+07:00"))})
	if string(raw) != `{"at":"2026-10-04T03:00:00.123Z"}` {
		t.Fatal(string(raw))
	}
}

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}
