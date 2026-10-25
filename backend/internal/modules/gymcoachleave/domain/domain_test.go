package domain

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestNormalizeNoticeRules(t *testing.T) {
	got := NormalizeNoticeRules(map[string]NoticeRule{
		"annual": {MinDays: 200, Blackout: false},
		"sick":   {MinDays: -3, AllowShortNotice: true},
		"other":  {MinDays: 5},
	})
	if len(got) != len(LeaveTypes) {
		t.Fatalf("%d types, want %d", len(got), len(LeaveTypes))
	}
	if got["annual"] != (NoticeRule{MinDays: MaxNoticeDays}) {
		t.Fatalf("annual clamped = %+v", got["annual"])
	}
	if got["sick"] != (NoticeRule{MinDays: 0, AllowShortNotice: true}) {
		t.Fatalf("sick clamped = %+v", got["sick"])
	}
	if got["marriage"] != DefaultNoticeRules["marriage"] {
		t.Fatalf("missing type keeps the default: %+v", got["marriage"])
	}
	if _, ok := got["other"]; ok {
		t.Fatal("unknown types are dropped")
	}
}

func TestEvaluateNotice(t *testing.T) {
	annual := DefaultNoticeRules["annual"]
	sick := DefaultNoticeRules["sick"]
	cases := []struct {
		name         string
		rule         NoticeRule
		start, today string
		hr           bool
		want         NoticeVerdict
	}{
		{"a week ahead is on time", annual, "2026-11-09", "2026-11-02", false, NoticeVerdict{OK: true, NoticeDays: 7}},
		{"six days ahead is refused", annual, "2026-11-08", "2026-11-02", false, NoticeVerdict{NoticeDays: 6, EarliestStart: "2026-11-09"}},
		{"HR records it as short notice", annual, "2026-11-08", "2026-11-02", true, NoticeVerdict{OK: true, ShortNotice: true, NoticeDays: 6}},
		{"sick tomorrow is on time", sick, "2026-11-03", "2026-11-02", false, NoticeVerdict{OK: true, NoticeDays: 1}},
		{"sick today is short notice", sick, "2026-11-02", "2026-11-02", false, NoticeVerdict{OK: true, ShortNotice: true}},
		{"sick yesterday is short notice", sick, "2026-11-01", "2026-11-02", false, NoticeVerdict{OK: true, ShortNotice: true, NoticeDays: -1}},
		{"no rule accepts anything", NoticeRule{}, "2026-11-02", "2026-11-02", false, NoticeVerdict{OK: true}},
		{"across a month end", annual, "2026-12-03", "2026-11-26", false, NoticeVerdict{OK: true, NoticeDays: 7}},
	}
	for _, c := range cases {
		if got := EvaluateNotice(c.rule, c.start, c.today, c.hr); got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
	msg := NoticeRefusal("annual", annual, "2026-11-09")
	if !strings.Contains(msg, "Cuti tahunan") || !strings.Contains(msg, "H-7") || !strings.Contains(msg, "2026-11-09") {
		t.Fatalf("refusal = %q", msg)
	}
}

func TestCoverTransitions(t *testing.T) {
	type step struct {
		from CoverStatus
		ev   CoverEvent
		to   CoverStatus
		ok   bool
	}
	steps := []step{
		{CoverOpen, EventRequest, CoverRequested, true},
		{CoverRequested, EventAccept, CoverAccepted, true},
		{CoverRequested, EventDecline, CoverDeclined, true},
		{CoverRequested, EventExpire, CoverOpen, true},
		{CoverDeclined, EventRequest, CoverRequested, true},
		{CoverOpen, EventAccept, CoverOpen, false},
		{CoverAccepted, EventRequest, CoverAccepted, false},
		{CoverAccepted, EventDecline, CoverAccepted, false},
		{CoverAssigned, EventExpire, CoverAssigned, false},
		{CoverAccepted, EventAssign, CoverAssigned, true},
		{CoverRequested, EventCancel, CoverCancelled, true},
		{CoverCancelled, EventAssign, CoverAssigned, true},
		{CoverOpen, EventVoid, CoverVoid, true},
		{CoverVoid, EventAssign, CoverVoid, false},
		{CoverVoid, EventRequest, CoverVoid, false},
	}
	for _, s := range steps {
		to, ok := Transition(s.from, s.ev)
		if to != s.to || ok != s.ok {
			t.Errorf("%s + %s = %s %v, want %s %v", s.from, s.ev, to, ok, s.to, s.ok)
		}
	}
	all := []CoverStatus{CoverOpen, CoverRequested, CoverAccepted, CoverDeclined, CoverAssigned, CoverCancelled, CoverVoid}
	if n := Blockers(all); n != 3 {
		t.Fatalf("blockers = %d, want open, requested and declined", n)
	}
	if Blockers([]CoverStatus{CoverAccepted, CoverAssigned, CoverCancelled, CoverVoid}) != 0 {
		t.Fatal("resolved covers block nothing")
	}
}

func TestRespondBy(t *testing.T) {
	now := time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)
	if got := RespondBy(now, 24, now.Add(72*time.Hour)); !got.Equal(now.Add(24 * time.Hour)) {
		t.Fatalf("far session: %s", got)
	}
	if got := RespondBy(now, 24, now.Add(5*time.Hour)); !got.Equal(now.Add(4 * time.Hour)) {
		t.Fatalf("close session: an hour before the start, got %s", got)
	}
	if got := RespondBy(now, 24, now.Add(30*time.Minute)); !got.Equal(now.Add(15 * time.Minute)) {
		t.Fatalf("imminent session: 15 minutes, got %s", got)
	}
}

func TestRankSubstitutes(t *testing.T) {
	list := []Candidate{
		{CoachID: "a", Name: "Ayu", WeekLoad: 5, Qualified: true},
		{CoachID: "b", Name: "Bima", WeekLoad: 1},
		{CoachID: "c", Name: "Citra", WeekLoad: 2, Qualified: true},
		{CoachID: "d", Name: "Dodi", Clash: true, Qualified: true},
		{CoachID: "e", Name: "Eka", OnLeave: true, Qualified: true},
		{CoachID: "f", Name: "Fajar", WeekLoad: 1},
	}
	ids := func(cs []Candidate) []string {
		out := []string{}
		for _, c := range cs {
			out = append(out, c.CoachID)
		}
		return out
	}
	if got := ids(RankSubstitutes(list, false)); !reflect.DeepEqual(got, []string{"c", "a", "b", "f"}) {
		t.Fatalf("group class = %v", got)
	}
	if got := ids(RankSubstitutes(list, true)); !reflect.DeepEqual(got, []string{"c", "a"}) {
		t.Fatalf("personal training needs qualified coaches: %v", got)
	}
}

func TestBlackouts(t *testing.T) {
	list := []Blackout{
		{ID: "1", DateFrom: "2026-11-14", DateTo: "2026-11-15", Reason: "HYROX Jakarta"},
		{ID: "2", DateFrom: "2026-12-24", DateTo: "2026-12-24", Reason: "Malam Natal"},
	}
	annual, sick := DefaultNoticeRules["annual"], DefaultNoticeRules["sick"]
	cases := []struct {
		rule       NoticeRule
		start, end string
		want       []string
	}{
		{annual, "2026-11-10", "2026-11-14", []string{"1"}},
		{annual, "2026-11-15", "2026-11-20", []string{"1"}},
		{annual, "2026-11-16", "2026-12-23", nil},
		{annual, "2026-11-01", "2026-12-31", []string{"1", "2"}},
		{sick, "2026-11-14", "2026-11-14", nil},
	}
	for _, c := range cases {
		var got []string
		for _, b := range BlackoutConflicts(c.rule, list, c.start, c.end) {
			got = append(got, b.ID)
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s..%s = %v, want %v", c.start, c.end, got, c.want)
		}
	}
	if d := DescribeBlackouts(list); d != "2026-11-14 s.d. 2026-11-15 (HYROX Jakarta); 2026-12-24 (Malam Natal)" {
		t.Fatalf("describe = %q", d)
	}
	for _, c := range []struct{ from, to, reason, want string }{
		{"2026-11-14", "2026-11-15", "HYROX", ""},
		{"2026-11-15", "2026-11-14", "HYROX", "Tanggal selesai tidak boleh sebelum tanggal mulai"},
		{"2026-11-01", "2026-12-01", "HYROX", ""},
		{"2026-11-01", "2026-12-02", "HYROX", "Satu blackout paling lama 31 hari"},
		{"2026-11-01", "2026-11-31", "HYROX", "Tanggal tidak valid"},
		{"2026-11-01", "2026-11-02", " a ", "Alasan blackout wajib diisi"},
	} {
		if got := ValidateBlackout(c.from, c.to, c.reason); got != c.want {
			t.Errorf("ValidateBlackout(%s, %s, %q) = %q, want %q", c.from, c.to, c.reason, got, c.want)
		}
	}
}

func TestResolveApprovers(t *testing.T) {
	pd1 := Approver{UserID: "pd1", Name: "Rina"}
	pd2 := Approver{UserID: "pd2", Name: "Tono", OnLeave: true}
	backup := &Approver{UserID: "bk", Name: "Manajer"}

	got := ResolveApprovers([]Approver{pd1, pd2}, backup, "coach")
	if got.Source != SourceDirector || len(got.List) != 1 || got.List[0].UserID != "pd1" {
		t.Fatalf("directors = %+v", got)
	}
	if !CanDecide("pd1", false, got, "coach") || CanDecide("bk", false, got, "coach") {
		t.Fatal("only the available Program Director decides")
	}
	// The director requests their own leave: the backup decides.
	got = ResolveApprovers([]Approver{pd1, pd2}, backup, "pd1")
	if got.Source != SourceBackup || got.List[0].UserID != "bk" || CanDecide("pd1", false, got, "pd1") {
		t.Fatalf("own leave = %+v", got)
	}
	got = ResolveApprovers(nil, &Approver{UserID: "bk", OnLeave: true}, "coach")
	if got.Source != SourceSuperAdmin || len(got.List) != 0 {
		t.Fatalf("nobody available = %+v", got)
	}
	if !CanDecide("root", true, got, "coach") || CanDecide("root", true, got, "root") {
		t.Fatal("a super admin decides anyone's leave but their own")
	}
}

func TestProposeWarning(t *testing.T) {
	inc := []IncidentRef{{"a", "2026-09-01"}, {"b", "2026-10-03"}, {"c", "2026-10-20"}, {"d", "2026-08-15"}}
	got := ProposeWarning(inc, nil, 0, false, 3)
	if got == nil || got.Level != 1 || len(got.IncidentIDs) != 4 || got.From != "2026-08-15" || got.To != "2026-10-20" {
		t.Fatalf("first SP = %+v", got)
	}
	counted := map[string]bool{"a": true, "d": true}
	if got := ProposeWarning(inc, counted, 1, false, 3); got != nil {
		t.Fatalf("two fresh incidents propose nothing: %+v", got)
	}
	if got := ProposeWarning(inc, counted, 1, false, 2); got == nil || got.Level != 2 || !reflect.DeepEqual(got.IncidentIDs, []string{"b", "c"}) {
		t.Fatalf("SP2 = %+v", got)
	}
	if got := ProposeWarning(inc, nil, 3, false, 1); got == nil || got.Level != 3 {
		t.Fatalf("SP3 is the ceiling: %+v", got)
	}
	if got := ProposeWarning(inc, nil, 0, true, 1); got != nil {
		t.Fatal("an open proposal blocks another")
	}
	if d := NormalizeDeductions(map[string]float64{"late": 150}); d["late"] != 100 || d["no_show"] != 15 {
		t.Fatalf("deductions = %v", d)
	}
}
