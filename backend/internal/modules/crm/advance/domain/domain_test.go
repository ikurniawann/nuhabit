package domain

import (
	"math"
	"reflect"
	"testing"
	"time"
)

func ptr[T any](v T) *T { return &v }

func TestEvaluateConditions(t *testing.T) {
	record := map[string]any{"source": "wa", "temperature": "hangat", "score": 55.0, "pic_email": "", "owner_user_id": nil}
	if !EvaluateConditions(nil, record, nil) {
		t.Fatal("no conditions always match")
	}
	all := []Condition{
		{Field: "source", Op: "eq", Value: "WA"},
		{Field: "score", Op: "gte", Value: 50.0},
		{Field: "pic_email", Op: "is_empty", Value: Undefined},
		{Field: "owner_user_id", Op: "is_empty", Value: Undefined},
	}
	if !EvaluateConditions(all, record, nil) {
		t.Fatal("AND of matching conditions")
	}
	if EvaluateConditions([]Condition{{Field: "temperature", Op: "in", Value: []any{"panas"}}}, record, nil) {
		t.Fatal("in without match")
	}
	changes := map[string]Change{"temperature": {From: "hangat", To: "panas"}}
	cases := []struct {
		c    Condition
		want bool
	}{
		{Condition{Field: "temperature", Op: "changed", Value: Undefined}, true},
		{Condition{Field: "temperature", Op: "changed_to", Value: "panas"}, true},
		{Condition{Field: "source", Op: "changed", Value: Undefined}, false},
		{Condition{Field: "missing", Op: "gt", Value: Undefined}, false},       // NaN > NaN
		{Condition{Field: "owner_user_id", Op: "gte", Value: nil}, true},       // Number(null) >= Number(null)
		{Condition{Field: "source", Op: "not_in", Value: "wa"}, true},          // not an array
		{Condition{Field: "source", Op: "contains", Value: ""}, false},         // empty needle
		{Condition{Field: "score", Op: "lt", Value: "1e2"}, true},              // numeric string
		{Condition{Field: "temperature", Op: "neq", Value: " HANGAT "}, false}, // trimmed, lowercased
	}
	for _, tc := range cases {
		if got := EvaluateCondition(tc.c, record, changes); got != tc.want {
			t.Errorf("%+v = %v, want %v", tc.c, got, tc.want)
		}
	}
}

func TestRenderTemplate(t *testing.T) {
	out := RenderTemplate("Halo {{owner.name}}, lead {{lead.org_name}} skor {{score}} ({{unknown.key}})", map[string]any{
		"owner": map[string]any{"name": "Ani"},
		"lead":  map[string]any{"org_name": "PT Kopi"},
		"score": 1234.0,
	})
	if out != "Halo Ani, lead PT Kopi skor 1.234 ()" {
		t.Fatalf("got %q", out)
	}
	if got := RenderTemplate("  a {{ x }}\t\tb {{y}} ", map[string]any{"x": 1.23456, "y": true}); got != "a 1,235 b true" {
		t.Fatalf("got %q", got)
	}
}

func TestTriggerForEvent(t *testing.T) {
	cases := map[string][2]string{
		"lead.created":       {"lead", "created"},
		"deal.stage_changed": {"deal", "stage_changed"},
		"task.done":          {"task", "status_changed"},
		"lead.score_changed": {"lead", "score_reached"},
	}
	for in, want := range cases {
		obj, trig, ok := TriggerForEvent(in)
		if !ok || obj != want[0] || trig != want[1] {
			t.Errorf("%s = %s %s %v", in, obj, trig, ok)
		}
	}
	if _, _, ok := TriggerForEvent("member.created"); ok {
		t.Fatal("member.created has no trigger")
	}
}

func TestSplitAtWaitAndRoundRobin(t *testing.T) {
	type act struct {
		typ         string
		days, hours float64
	}
	wait := func(a act) (bool, float64, float64) { return a.typ == "wait", a.days, a.hours }
	actions := []act{{typ: "notify_in_app"}, {typ: "wait", days: 1, hours: 2}, {typ: "send_wa"}}
	now, later, delay := SplitAtWait(actions, wait)
	if len(now) != 1 || len(later) != 1 || delay != 26*3_600_000 {
		t.Fatalf("split = %v %v %v", now, later, delay)
	}
	if _, _, d := SplitAtWait(actions[:1], wait); d != 0 {
		t.Fatal("no wait, no delay")
	}
	if id, _ := PickRoundRobin([]string{"a", "b", "c"}, 4); id != "b" {
		t.Fatalf("round robin = %s", id)
	}
	if _, ok := PickRoundRobin(nil, 0); ok {
		t.Fatal("empty candidates")
	}
	if RunStatus(2, 0, true) != "scheduled" || RunStatus(2, 0, false) != "success" || RunStatus(2, 2, false) != "failed" || RunStatus(2, 1, false) != "partial" {
		t.Fatal("run status")
	}
}

func rule(id, kind string, points int, mod func(*ScoringRule)) ScoringRule {
	r := ScoringRule{ID: id, Name: "x", Kind: kind, Points: points, MaxCount: 1}
	if mod != nil {
		mod(&r)
	}
	return r
}

func TestMatchFieldRule(t *testing.T) {
	snap := map[string]*string{"source": ptr("WA"), "org_type": ptr("corporate"), "pic_email": ptr("a@b.id"), "city": ptr("Kota Bandung")}
	field := func(f, op string, v any) ScoringRule {
		return rule("r", "field", 1, func(r *ScoringRule) { r.Field, r.Operator, r.Value = &f, &op, v })
	}
	cases := []struct {
		r    ScoringRule
		want bool
	}{
		{field("source", "eq", "wa"), true},
		{field("org_type", "in", []any{"sekolah", "Corporate"}), true},
		{field("pic_email", "not_empty", nil), true},
		{field("city", "contains", "bandung"), true},
		{field("temperature", "eq", "panas"), false},
		{field("temperature", "lt", 1.0), true}, // Number(null) = 0
	}
	for i, tc := range cases {
		if got := MatchFieldRule(tc.r, snap); got != tc.want {
			t.Errorf("case %d = %v", i, got)
		}
	}
}

func TestComputeLeadScore(t *testing.T) {
	ev := func(id string, points int, typ string, value any, maxCount int) ScoringRule {
		return rule(id, "event", points, func(r *ScoringRule) { r.EventType, r.Value, r.MaxCount = &typ, value, maxCount })
	}
	src, eq := "source", "eq"
	rules := []ScoringRule{
		rule("a", "field", 10, func(r *ScoringRule) { r.Field, r.Operator, r.Value = &src, &eq, "wa" }),
		ev("b", 20, "task_done", "meeting", 2),
		ev("c", 10, "wa_inbound", nil, 3),
		ev("d", 20, "deal_created", nil, 1),
	}
	score, breakdown := ComputeLeadScore(rules, map[string]*string{"source": ptr("wa")},
		map[string]int{"task_done:meeting": 5, "wa_inbound": 2, "task_done:telepon": 9})
	if score != 70 {
		t.Fatalf("score = %d", score)
	}
	ids := []string{}
	for _, b := range breakdown {
		ids = append(ids, b.RuleID)
	}
	if !reflect.DeepEqual(ids, []string{"a", "b", "c"}) || *breakdown[1].Count != 2 || breakdown[0].Count != nil {
		t.Fatalf("breakdown = %+v", breakdown)
	}
	if EventCountKey("task_done", "Meeting ") != "task_done:meeting" || EventCountKey("wa_inbound", nil) != "wa_inbound" {
		t.Fatal("event count key")
	}
}

func TestMaxWindow(t *testing.T) {
	typ := "task_done"
	w := func(days *int) ScoringRule {
		return rule("r", "event", 1, func(r *ScoringRule) { r.EventType, r.WindowDays = &typ, days })
	}
	if got := MaxWindow([]ScoringRule{w(ptr(7)), w(ptr(30))}, typ); got == nil || *got != 30 {
		t.Fatalf("widest = %v", got)
	}
	if MaxWindow([]ScoringRule{w(ptr(7)), w(nil)}, typ) != nil {
		t.Fatal("any rule without a window counts everything")
	}
}

func TestCanDecideStep(t *testing.T) {
	admin, x := ptr("admin"), ptr("x")
	cases := []struct {
		role, user *string
		id, r      string
		want       bool
	}{
		{admin, nil, "u", "admin", true},
		{admin, nil, "u", "sales", false},
		{admin, nil, "u", "super_admin", true},
		{nil, x, "x", "sales", true},
		{nil, x, "y", "super_admin", false},
		{nil, nil, "u", "super_admin", false},
	}
	for i, tc := range cases {
		if got := CanDecideStep(tc.role, tc.user, tc.id, tc.r); got != tc.want {
			t.Errorf("case %d = %v", i, got)
		}
	}
}

func TestJSValues(t *testing.T) {
	if FormatJSNumber(1e21) != "1e+21" || FormatJSNumber(0.5) != "0.5" || FormatJSNumber(100) != "100" {
		t.Fatal("FormatJSNumber")
	}
	if !math.IsNaN(JSNumber("abc")) || JSNumber(" 0x1F ") != 31 || JSNumber("") != 0 || JSNumber([]any{5.0}) != 5 || !math.IsNaN(JSNumber(Undefined)) {
		t.Fatal("JSNumber")
	}
	d := time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC)
	if JSString(d) != "Sun Oct 04 2026 10:00:00 GMT+0700 (Western Indonesia Time)" || JSString([]any{"a", nil, 1.0}) != "a,,1" {
		t.Fatal("JSString")
	}
	if SliceUTF16("a😀b", 3) != "a😀" || SliceUTF16("ab", 5) != "ab" {
		t.Fatal("SliceUTF16")
	}
	if EncodeURIComponent("+62 812/a*") != "%2B62%20812%2Fa*" {
		t.Fatalf("EncodeURIComponent = %s", EncodeURIComponent("+62 812/a*"))
	}
	if NormalizePhone("0812-345") != "62812345" || NormalizePhone("+62 812") != "62812" || NormalizePhone("812") != "62812" {
		t.Fatal("NormalizePhone")
	}
	if IsValidNormalizedPhone("62812345") || !IsValidNormalizedPhone("6281234567") {
		t.Fatal("IsValidNormalizedPhone")
	}
}

func TestRequiredApprovalLevels(t *testing.T) {
	admin, owner, boss := ptr("admin"), ptr("super_admin"), ptr("user-1")
	rules := []ApprovalRule{
		{ID: "a", Level: 1, MinDiscount: 10, ApproverRole: admin},
		{ID: "b", Level: 2, MinDiscount: 20, ApproverRole: owner},
		{ID: "c", Level: 1, MinDiscount: 15, ApproverUserID: boss},
	}
	ids := func(levels []ApprovalRule) []string {
		out := []string{}
		for _, l := range levels {
			out = append(out, l.ID)
		}
		return out
	}
	for _, c := range []struct {
		discount float64
		want     []string
	}{
		{0, []string{}},
		{10, []string{}}, // the bar must be passed, not met
		{12, []string{"a"}},
		{16, []string{"c"}}, // one rule per level: the highest bar passed
		{25, []string{"c", "b"}},
	} {
		if got := ids(RequiredApprovalLevels(c.discount, rules)); !reflect.DeepEqual(got, c.want) {
			t.Fatalf("discount %v: %v, want %v", c.discount, got, c.want)
		}
	}
}
