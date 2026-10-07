package domain

import (
	"encoding/json"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"
)

var today = time.Date(2026, 9, 13, 0, 0, 0, 0, time.UTC) // 13 September 2026

func ptr[T any](v T) *T { return &v }

func deal(edit func(*Definition)) Definition {
	d := DefaultDefinition("deal")
	if edit != nil {
		edit(&d)
	}
	return d
}

func agg(fn, field string) Aggregate {
	a := Aggregate{Fn: fn}
	if field != "" {
		a.Field = OptStr{Set: true, Val: &field}
	}
	return a
}

func TestRegistryDefaultsAndDateFieldsExist(t *testing.T) {
	owner := regexp.MustCompile(`^[a-z]+\.owner_user_id$`)
	for _, key := range Datasets {
		ds := DatasetDef(key)
		if ds.Field(ds.DateField) == nil {
			t.Fatalf("%s.dateField", key)
		}
		for _, c := range ds.DefaultColumns {
			if ds.Field(c) == nil {
				t.Fatalf("%s.%s", key, c)
			}
		}
		if ds.OwnerExpr != "" && !owner.MatchString(ds.OwnerExpr) {
			t.Fatalf("%s owner %s", key, ds.OwnerExpr)
		}
		for _, f := range ds.Fields {
			if f.Type == "enum" && len(f.Options) == 0 {
				t.Fatalf("%s.%s has no options", key, f.Key)
			}
		}
	}
	if got := FieldDef("lead", "temperature").Options; !slices.Equal(got, []string{"panas", "hangat", "dingin"}) {
		t.Fatal(got)
	}
	if got := FieldDef("lead", "status").Options; !slices.Equal(got, []string{"baru", "dihubungi", "qualified", "tidak-cocok"}) {
		t.Fatal(got)
	}
}

func keys(cols []Column) []string {
	out := make([]string, len(cols))
	for i, c := range cols {
		out[i] = c.Key
	}
	return out
}

func TestTableModeDefaultsScopeAndLimit(t *testing.T) {
	q := BuildReportQuery(deal(nil), BuildContext{CompanyID: ptr("c1"), Today: today})
	if q.Grouped || !slices.Equal(keys(q.Columns), DatasetDef("deal").DefaultColumns) {
		t.Fatalf("%+v", q.Columns)
	}
	for _, s := range []string{"t.company_id = $1", "t.deleted_at IS NULL", "LIMIT 500"} {
		if !strings.Contains(q.SQL, s) {
			t.Fatalf("missing %q in %s", s, q.SQL)
		}
	}
	if !reflect.DeepEqual(q.Params, []any{"c1"}) {
		t.Fatal(q.Params)
	}
}

func TestSalesRoleIsRestrictedToOwnRecords(t *testing.T) {
	q := BuildReportQuery(deal(nil), BuildContext{CompanyID: ptr("c1"), RestrictOwnerUserID: ptr("u9"), Today: today})
	if !strings.Contains(q.SQL, "t.owner_user_id = $2") || !reflect.DeepEqual(q.Params, []any{"c1", "u9"}) {
		t.Fatal(q.SQL, q.Params)
	}
}

func TestAggregateMode(t *testing.T) {
	q := BuildReportQuery(deal(func(d *Definition) {
		d.GroupBy = []string{"owner_name"}
		d.Aggregates = []Aggregate{agg("count", ""), agg("sum", "value")}
	}), BuildContext{Today: today})
	for _, s := range []string{"GROUP BY ou.full_name", `COUNT(*)::numeric AS "count"`, `SUM(COALESCE(t.value_final, t.value_estimate, 0))::numeric AS "sum_value"`} {
		if !strings.Contains(q.SQL, s) {
			t.Fatalf("missing %q in %s", s, q.SQL)
		}
	}
	if !q.Grouped || !slices.Equal(keys(q.Columns), []string{"owner_name", "count", "sum_value"}) {
		t.Fatal(q.Columns)
	}
	if q.Columns[2].Label != "Total Nilai Deal" || q.Columns[2].Type != "currency" {
		t.Fatal(q.Columns[2])
	}
}

func TestDateGroupUsesBucket(t *testing.T) {
	q := BuildReportQuery(deal(func(d *Definition) { d.GroupBy = []string{"created_at"} }), BuildContext{Today: today})
	if !strings.Contains(q.SQL, "date_trunc('month', t.created_at)::date") || !strings.Contains(q.Columns[0].Label, "Bulanan") || q.Columns[0].Type != "date" {
		t.Fatal(q.SQL, q.Columns)
	}
}

func TestUnknownFieldsAreDropped(t *testing.T) {
	q := BuildReportQuery(deal(func(d *Definition) {
		d.Columns = []string{"title", "t.company_id; DROP TABLE x", "nope"}
		d.SortField = OptStr{Set: true, Val: ptr("1=1")}
	}), BuildContext{Today: today})
	if !slices.Equal(keys(q.Columns), []string{"title"}) || strings.Contains(q.SQL, "DROP TABLE") || strings.Contains(q.SQL, "1=1") {
		t.Fatal(q.SQL)
	}
	q = BuildReportQuery(deal(func(d *Definition) { d.GroupBy = []string{"tidak_ada"} }), BuildContext{Today: today})
	if q.Grouped {
		t.Fatal("unknown group_by falls back to table mode")
	}
}

func TestSumNeedsAggregatableField(t *testing.T) {
	q := BuildReportQuery(deal(func(d *Definition) {
		d.GroupBy = []string{"stage_name"}
		d.Aggregates = []Aggregate{agg("sum", "title"), agg("count_distinct", "org_name")}
	}), BuildContext{Today: today})
	if strings.Contains(q.SQL, "SUM(t.title)") || !strings.Contains(q.SQL, "COUNT(DISTINCT l.org_name)") {
		t.Fatal(q.SQL)
	}
}

func TestFiltersAreParameterized(t *testing.T) {
	q := BuildReportQuery(deal(func(d *Definition) {
		d.Filters = []Filter{
			{Field: "org_name", Op: "contains", Value: "PT Maju", HasValue: true},
			{Field: "forecast_category", Op: "in", Value: []any{"commit", "best_case"}, HasValue: true},
			{Field: "value", Op: "gte", Value: "5000000", HasValue: true},
			{Field: "lost_reason", Op: "is_empty"},
		}
	}), BuildContext{Today: today})
	for _, s := range []string{"l.org_name ILIKE $1", "= ANY($2)", ">= $3", "lr.name IS NULL"} {
		if !strings.Contains(q.SQL, s) {
			t.Fatalf("missing %q in %s", s, q.SQL)
		}
	}
	if !reflect.DeepEqual(q.Params, []any{"%PT Maju%", []any{"commit", "best_case"}, 5_000_000.0}) {
		t.Fatal(q.Params)
	}
	if got := NodeParam(q.Params[1]); got != `{"commit","best_case"}` {
		t.Fatal(got)
	}
	if got := NodeParam(q.Params[2]); got != "5000000" {
		t.Fatal(got)
	}

	q = BuildReportQuery(deal(func(d *Definition) {
		d.Filters = []Filter{
			{Field: "value", Op: "between", Value: 1.0, HasValue: true, Value2: 10.0, HasValue2: true},
			{Field: "stage_name", Op: "in", Value: []any{}, HasValue: true},
		}
	}), BuildContext{Today: today})
	if !strings.Contains(q.SQL, "BETWEEN $1 AND $2") || !reflect.DeepEqual(q.Params, []any{1.0, 10.0}) {
		t.Fatal(q.SQL, q.Params)
	}
}

func TestDatePresets(t *testing.T) {
	cases := []struct {
		preset, from, to string
		today            time.Time
	}{
		{"today", "2026-09-13", "2026-09-14", today},
		{"last_7_days", "2026-09-07", "2026-09-14", today},
		{"this_month", "2026-09-01", "2026-10-01", today},
		{"last_month", "2026-08-01", "2026-09-01", today},
		{"this_quarter", "2026-07-01", "2026-10-01", today},
		{"this_year", "2026-01-01", "2027-01-01", today},
		{"last_year", "2025-01-01", "2026-01-01", today},
		{"this_month", "2026-12-01", "2027-01-01", time.Date(2026, 12, 5, 0, 0, 0, 0, time.UTC)},
	}
	for _, c := range cases {
		r := ResolveDateRange(c.preset, nil, nil, c.today)
		if r == nil || r.From != c.from || r.To != c.to {
			t.Fatalf("%s: %+v", c.preset, r)
		}
	}
	if ResolveDateRange("all_time", nil, nil, today) != nil || ResolveDateRange("custom", ptr("2026-03-01"), nil, today) != nil {
		t.Fatal("expected nil")
	}
	if r := ResolveDateRange("custom", ptr("2026-03-01"), ptr("2026-04-01"), today); *r != (Range{"2026-03-01", "2026-04-01"}) {
		t.Fatal(r)
	}

	q := BuildReportQuery(deal(func(d *Definition) {
		d.DateField = OptStr{Set: true, Val: ptr("event_date")}
		d.DatePreset = "this_month"
	}), BuildContext{Today: today})
	if !strings.Contains(q.SQL, "t.event_date >= $1::date") || !strings.Contains(q.SQL, "t.event_date < $2::date") ||
		!reflect.DeepEqual(q.Params, []any{"2026-09-01", "2026-10-01"}) {
		t.Fatal(q.SQL, q.Params)
	}
}

func TestSummaryAndCellFormat(t *testing.T) {
	cols := []Column{
		{Key: "owner_name", Label: "PJ", Type: "text"},
		{Key: "sum_value", Label: "Total Nilai", Type: "currency", IsAggregate: true},
	}
	jkt, _ := time.LoadLocation("Asia/Jakarta")
	if got := SummarizeRows(nil, cols, jkt); got != "Tidak ada data." {
		t.Fatal(got)
	}
	if got := SummarizeRows([]Row{{"owner_name": "Ani", "sum_value": 5_000_000.0}}, cols, jkt); got != "• Ani — Total Nilai: Rp5.000.000" {
		t.Fatal(got)
	}
	cases := []struct {
		typ  string
		v    any
		want string
	}{
		{"number", 1234.0, "1.234"},
		{"number", 1.5, "1,5"},
		{"number", "12.3456", "12,346"},
		{"date", "2026-10-04", "4 Okt 2026"},
		{"datetime", "2026-10-04T07:30:00Z", "4 Okt 2026, 14.30"},
		{"boolean", true, "Ya"},
		{"text", nil, "—"},
	}
	for _, c := range cases {
		if got := FormatCellValue(c.typ, c.v, jkt); got != c.want {
			t.Fatalf("%s %v: %q", c.typ, c.v, got)
		}
	}
	if got := AggregateLabel("deal", agg("avg", "value")); got != "Rata-rata Nilai Deal" {
		t.Fatal(got)
	}
	if FieldDef("deal", "tidak_ada") != nil {
		t.Fatal("unknown field")
	}
	if got := displayString(time.Date(2026, 10, 4, 0, 0, 0, 0, jkt), jkt); got != "Sun Oct 04 2026 00:00:00 GMT+0700 (Western Indonesia Time)" {
		t.Fatal(got)
	}
}

func TestDefinitionJSONFollowsSchemaOrder(t *testing.T) {
	d := DefaultDefinition("lead")
	d.Filters = []Filter{{Field: "status", Op: "eq", Value: "baru", HasValue: true}}
	d.DateField = OptStr{Set: true}
	d.Aggregates = []Aggregate{agg("sum", "score")}
	raw, _ := json.Marshal(d)
	want := `{"dataset":"lead","columns":[],"filters":[{"field":"status","op":"eq","value":"baru"}],"date_field":null,"date_preset":"all_time","group_by":[],"date_bucket":"month","aggregates":[{"fn":"sum","field":"score"}],"sort_dir":"desc","limit":500,"chart_type":"table"}`
	if string(raw) != want {
		t.Fatalf("got  %s\nwant %s", raw, want)
	}
}

func TestJSValueSemantics(t *testing.T) {
	for in, want := range map[string]float64{"": 0, " 12 ": 12, "0x10": 16, "1e3": 1000, ".5": 0.5} {
		if got := JSNumber(in); got != want {
			t.Fatalf("Number(%q) = %v", in, got)
		}
	}
	if n := JSNumber("12abc"); n == n {
		t.Fatal("expected NaN")
	}
	if got := JSNumberString(1e21); got != "1e+21" {
		t.Fatal(got)
	}
	if got := NodeParam([]any{`a"b`, nil, true}); got != `{"a\"b",NULL,"true"}` {
		t.Fatal(got)
	}
}

func wibAt(y int, m time.Month, d, hour, min int) time.Time {
	return time.Date(y, m, d, hour-7, min, 0, 0, time.UTC)
}

func TestComputeNextRun(t *testing.T) {
	daily := SchedulePattern{Frequency: "daily", Hour: 8}
	senin := SchedulePattern{Frequency: "weekly", Hour: 8, DayOfWeek: ptr(1)}
	minggu := SchedulePattern{Frequency: "weekly", Hour: 8, DayOfWeek: ptr(0)}
	monthly := SchedulePattern{Frequency: "monthly", Hour: 7, DayOfMonth: ptr(5)}
	cases := []struct {
		s          SchedulePattern
		from, want time.Time
	}{
		{daily, wibAt(2026, 9, 13, 6, 0), wibAt(2026, 9, 13, 8, 0)},
		{daily, wibAt(2026, 9, 13, 9, 0), wibAt(2026, 9, 14, 8, 0)},
		{daily, wibAt(2026, 9, 13, 8, 0), wibAt(2026, 9, 14, 8, 0)},
		{senin, wibAt(2026, 9, 13, 10, 0), wibAt(2026, 9, 14, 8, 0)},
		{minggu, wibAt(2026, 9, 13, 6, 0), wibAt(2026, 9, 13, 8, 0)},
		{minggu, wibAt(2026, 9, 13, 10, 0), wibAt(2026, 9, 20, 8, 0)},
		{monthly, wibAt(2026, 9, 1, 0, 0), wibAt(2026, 9, 5, 7, 0)},
		{monthly, wibAt(2026, 9, 20, 0, 0), wibAt(2026, 10, 5, 7, 0)},
		{monthly, wibAt(2026, 12, 20, 0, 0), wibAt(2027, 1, 5, 7, 0)},
	}
	for i, c := range cases {
		if got := ComputeNextRun(c.s, c.from); !got.Equal(c.want) {
			t.Fatalf("case %d: %s want %s", i, got, c.want)
		}
	}
	now := wibAt(2026, 9, 13, 8, 30)
	for _, s := range []SchedulePattern{daily, minggu, {Frequency: "monthly", Hour: 8, DayOfMonth: ptr(13)}} {
		if !ComputeNextRun(s, now).After(now) {
			t.Fatalf("%+v not after now", s)
		}
	}
}

func TestScheduleMessageAndPhones(t *testing.T) {
	msg := BuildScheduleMessage("Pipeline per PJ", "• Ani — Total: Rp 10.000.000", 3, "Bulan ini", "/x")
	for _, s := range []string{"*Pipeline per PJ*", "Periode: Bulan ini · 3 baris", "Buka: /x"} {
		if !strings.Contains(msg, s) {
			t.Fatalf("missing %q in %q", s, msg)
		}
	}
	if got := NormalizePhone("0812-3456-789"); got != "628123456789" || !IsValidNormalizedPhone(got) {
		t.Fatal(got)
	}
	if IsValidNormalizedPhone(NormalizePhone("12345")) {
		t.Fatal("short number")
	}
}
