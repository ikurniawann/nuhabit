package domain

import (
	"reflect"
	"strings"
	"testing"
)

func def(mut func(*Definition)) Definition {
	d := DefaultDefinition("member")
	if mut != nil {
		mut(&d)
	}
	return d
}

var champions = Rfm{Enabled: true, Recency: Range{4, 5}, Frequency: Range{4, 5}, Monetary: Range{4, 5}}
var atRisk = Rfm{Enabled: true, Recency: Range{1, 2}, Frequency: Range{3, 5}, Monetary: Range{3, 5}}

func mustContain(t *testing.T, s string, subs ...string) {
	t.Helper()
	for _, sub := range subs {
		if !strings.Contains(s, sub) {
			t.Errorf("missing %q in:\n%s", sub, s)
		}
	}
}

func mustNotContain(t *testing.T, s string, subs ...string) {
	t.Helper()
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			t.Errorf("unexpected %q in:\n%s", sub, s)
		}
	}
}

func TestRegistryHasRfmFields(t *testing.T) {
	for key, src := range Sources {
		if !src.SupportsRfm {
			continue
		}
		for _, f := range []string{"last_visit", "visit_count", "total_spent"} {
			if _, ok := src.Fields[f]; !ok {
				t.Errorf("%s.%s missing", key, f)
			}
		}
	}
	if !Sources["member"].SupportsRfm || Sources["lead"].SupportsRfm {
		t.Fatal("RFM support flags")
	}
}

func TestPlainQueryDropsRecipientsWithoutPhone(t *testing.T) {
	q := BuildSegmentQuery(def(nil), nil, false)
	if q.WithRfm {
		t.Fatal("withRfm")
	}
	mustNotContain(t, q.SQL, "NTILE")
	mustContain(t, q.SQL, "t.phone IS NOT NULL", "LIMIT 5000")
}

func TestRfmQueryScoresAndFilters(t *testing.T) {
	q := BuildSegmentQuery(def(func(d *Definition) { d.Rfm = champions }), nil, false)
	if !q.WithRfm {
		t.Fatal("withRfm")
	}
	mustContain(t, q.SQL, "NTILE(5) OVER (ORDER BY b.last_visit ASC NULLS FIRST)",
		"r_score BETWEEN 4 AND 5", "f_score BETWEEN 4 AND 5", "m_score BETWEEN 4 AND 5")
}

func TestRfmIgnoredForSourcesWithoutSupport(t *testing.T) {
	c1 := "c1"
	q := BuildSegmentQuery(def(func(d *Definition) { d.Source = "lead"; d.Rfm = champions }), &c1, false)
	if q.WithRfm {
		t.Fatal("withRfm")
	}
	mustNotContain(t, q.SQL, "NTILE")
}

func TestOutOfRangeScoresAreClamped(t *testing.T) {
	q := BuildSegmentQuery(def(func(d *Definition) {
		d.Rfm = Rfm{Enabled: true, Recency: Range{-99, 99}, Frequency: FullRange, Monetary: FullRange}
	}), nil, false)
	mustContain(t, q.SQL, "r_score BETWEEN 1 AND 5")
	mustNotContain(t, q.SQL, "-99", "99")
}

func TestCompanyScopeOnlyForSourcesWithCompany(t *testing.T) {
	c1 := "c1"
	member := BuildSegmentQuery(def(nil), &c1, false)
	if len(member.Params) != 0 {
		t.Fatalf("member params %v", member.Params)
	}
	lead := BuildSegmentQuery(def(func(d *Definition) { d.Source = "lead" }), &c1, false)
	mustContain(t, lead.SQL, "t.company_id = $1")
	if !reflect.DeepEqual(lead.Params, []any{"c1"}) {
		t.Fatalf("lead params %v", lead.Params)
	}
}

func TestFiltersUseParamsAndDropUnknownFields(t *testing.T) {
	q := BuildSegmentQuery(def(func(d *Definition) {
		d.Filters = []Filter{
			{Field: "city", Op: "contains", Value: "Bandung", HasValue: true},
			{Field: "total_spent", Op: "gte", Value: "500000", HasValue: true},
			{Field: "t.id; DROP TABLE pos.pos_customers", Op: "eq", Value: "x", HasValue: true},
		}
	}), nil, false)
	mustContain(t, q.SQL, "t.city ILIKE $1", ">= $2")
	mustNotContain(t, q.SQL, "DROP TABLE")
	if !reflect.DeepEqual(q.Params, []any{"%Bandung%", 500000.0}) {
		t.Fatalf("params %#v", q.Params)
	}
}

func TestFilterOps(t *testing.T) {
	cases := []struct {
		f      Filter
		sql    string
		params []any
	}{
		{Filter{Field: "city", Op: "is_empty"}, "(t.city IS NULL OR t.city = '')", []any{}},
		{Filter{Field: "visit_count", Op: "not_empty"}, "(COALESCE(t.visit_count, 0) IS NOT NULL)", []any{}},
		{Filter{Field: "gender", Op: "in", Value: []any{"male", "", nil, "female"}}, "t.gender = ANY($1)", []any{[]string{"male", "female"}}},
		{Filter{Field: "total_xp", Op: "not_in", Value: "5"}, "COALESCE(t.total_xp, 0) <> ALL($1)", []any{[]float64{5}}},
		{Filter{Field: "wa_consent", Op: "eq", Value: "1"}, "COALESCE(t.wa_consent, false) = $1", []any{true}},
		{Filter{Field: "total_xp", Op: "between", Value: "abc", Value2: 10.0}, "COALESCE(t.total_xp, 0) BETWEEN $1 AND $2", []any{0.0, 10.0}},
		{Filter{Field: "city", Op: "eq", Value: ""}, "t.city IS NULL", []any{}},
		{Filter{Field: "city", Op: "neq"}, "t.city IS NOT NULL", []any{}},
		{Filter{Field: "name", Op: "eq", Value: 1.5}, "t.name = $1", []any{"1.5"}},
	}
	for _, c := range cases {
		q := BuildSegmentQuery(def(func(d *Definition) { d.Filters = []Filter{c.f} }), nil, false)
		mustContain(t, q.SQL, c.sql)
		if !reflect.DeepEqual(q.Params, c.params) {
			t.Errorf("%+v params %#v want %#v", c.f, q.Params, c.params)
		}
	}
	for _, f := range []Filter{{Field: "city", Op: "gt"}, {Field: "city", Op: "in", Value: []any{""}}, {Field: "city", Op: "between", Value: "a"}} {
		q := BuildSegmentQuery(def(func(d *Definition) { d.Filters = []Filter{f} }), nil, false)
		if len(q.Params) != 0 || strings.Count(q.SQL, " AND ") != 2 {
			t.Errorf("%+v should be skipped: %s", f, q.SQL)
		}
	}
}

func TestWaConsentRequirement(t *testing.T) {
	q := BuildSegmentQuery(def(func(d *Definition) { d.RequireWaConsent = true }), nil, false)
	mustContain(t, q.SQL, "COALESCE(t.wa_consent, false)")
}

func TestCountOnly(t *testing.T) {
	q := BuildSegmentQuery(def(nil), nil, true)
	mustContain(t, q.SQL, "COUNT(*)::int AS total")
	withRfm := BuildSegmentQuery(def(func(d *Definition) { d.Rfm = atRisk }), nil, true)
	mustContain(t, withRfm.SQL, "COUNT(*)::int AS total", "NTILE")
}

func TestWhereFragmentRetargetsAliasAndShiftsParams(t *testing.T) {
	where, params := BuildSegmentWhere(def(func(d *Definition) {
		d.Filters = []Filter{{Field: "city", Op: "eq", Value: "Bandung", HasValue: true}}
	}), "c", 4, nil)
	mustContain(t, where, "c.city = $4")
	mustNotContain(t, where, "t.city", "ORDER BY", "LIMIT")
	if !reflect.DeepEqual(params, []any{"Bandung"}) {
		t.Fatalf("params %v", params)
	}
	if where != "(c.is_active AND c.city = $4 AND c.phone IS NOT NULL AND c.phone <> '')" {
		t.Fatalf("where %s", where)
	}
}

func TestWhereFragmentWithRfmUsesSubquery(t *testing.T) {
	where, _ := BuildSegmentWhere(def(func(d *Definition) { d.Rfm = atRisk }), "c", 4, nil)
	if !strings.HasPrefix(where, "c.id IN (SELECT id FROM (") {
		t.Fatalf("where %s", where)
	}
	mustContain(t, where, "NTILE(5)", "r_score BETWEEN 1 AND 2")
	mustNotContain(t, where, "ORDER BY m_score")
}

func TestDefinitionJSONKeepsZodShape(t *testing.T) {
	d := def(func(d *Definition) {
		d.Filters = []Filter{{Field: "city", Op: "eq", Value: "<b>", HasValue: true}, {Field: "city", Op: "is_empty", HasValue2: true}}
	})
	got, _ := marshal(d)
	want := `{"source":"member","filters":[{"field":"city","op":"eq","value":"<b>"},{"field":"city","op":"is_empty","value2":null}],` +
		`"rfm":{"enabled":false,"recency":{"min":1,"max":5},"frequency":{"min":1,"max":5},"monetary":{"min":1,"max":5}},"require_wa_consent":false,"limit":5000}`
	if string(got) != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}

func TestJSNumberAndString(t *testing.T) {
	for in, want := range map[string]float64{"": 0, " 12 ": 12, "0x10": 16, "1e3": 1000, "abc": 0, "Infinity": 0, "1_0": 0, ".5": 0.5} {
		if got := JSNumber(in); got != want {
			t.Errorf("Number(%q) = %v want %v", in, got, want)
		}
	}
	if JSNumber(true) != 1 || JSNumber([]any{"7"}) != 7 || JSNumber(map[string]any{}) != 0 {
		t.Fatal("Number of non-strings")
	}
	for in, want := range map[float64]string{1.5: "1.5", 500000: "500000", 1e21: "1e+21", 1e-7: "1e-7", -0.25: "-0.25"} {
		if got := JSString(in); got != want {
			t.Errorf("String(%v) = %q want %q", in, got, want)
		}
	}
	if JSString([]any{"a", nil, 2.0}) != "a,,2" || JSString(map[string]any{}) != "[object Object]" {
		t.Fatal("String of composites")
	}
}
