package domain

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

var now = time.Date(2026, 10, 3, 10, 0, 0, 0, time.UTC)

func hoursFromNow(h float64) time.Time { return now.Add(time.Duration(h * float64(time.Hour))) }

func TestWaitlistAndCancellation(t *testing.T) {
	one, two := 1, 2
	pick := PickWaitlistPromotion([]WaitlistEntry{
		{ID: "a", Position: &two, CreatedAt: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)},
		{ID: "b", Position: &one, CreatedAt: time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)},
	})
	if pick == nil || pick.ID != "b" {
		t.Fatalf("lowest position first, got %v", pick)
	}
	tie := PickWaitlistPromotion([]WaitlistEntry{
		{ID: "late", Position: &one, CreatedAt: time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)},
		{ID: "early", Position: &one, CreatedAt: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)},
		{ID: "none", CreatedAt: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)},
	})
	if tie.ID != "early" {
		t.Fatalf("ties go to the earliest signup, got %s", tie.ID)
	}
	if PickWaitlistPromotion(nil) != nil {
		t.Fatal("empty waitlist")
	}
	if !IsLateCancel(hoursFromNow(1), 2, now) || IsLateCancel(hoursFromNow(5), 2, now) {
		t.Fatal("late cancel window")
	}
}

func TestBookingTransitions(t *testing.T) {
	for _, c := range []struct {
		from, to string
		ok       bool
	}{
		{"confirmed", "attended", true}, {"confirmed", "no_show", true}, {"confirmed", "cancelled", true},
		{"waitlist", "cancelled", true}, {"waitlist", "attended", false},
		{"attended", "cancelled", false}, {"cancelled", "attended", false}, {"no_show", "attended", false},
	} {
		if CanChangeBooking(c.from, c.to) != c.ok {
			t.Errorf("%s -> %s: want %v", c.from, c.to, c.ok)
		}
	}
}

func TestProgress(t *testing.T) {
	if p := Progress(3, 5); p.Pct != 60 || p.Completed {
		t.Fatalf("3/5: %+v", p)
	}
	if p := Progress(7, 5); p.Pct != 100 || !p.Completed {
		t.Fatalf("7/5: %+v", p)
	}
	if p := Progress(1, 0); p.Pct != 0 || !p.Completed {
		t.Fatalf("zero target: %+v", p)
	}
}

func TestAudienceWhere(t *testing.T) {
	sql, params := AudienceWhere(Audience{})
	if sql != "c.is_active IS NOT FALSE" || len(params) != 0 {
		t.Fatalf("no filters: %q %v", sql, params)
	}
	five, thirty, zero := 5, 30, 0
	sql, params = AudienceWhere(Audience{TierCodes: []string{"gold"}, MinVisits: &five, InactiveDays: &thirty})
	if !reflect.DeepEqual(params, []any{[]string{"gold"}, 5, 30}) {
		t.Fatalf("params %v", params)
	}
	for _, want := range []string{"= ANY($1)", ">= $2", "days => $3"} {
		if !strings.Contains(sql, want) {
			t.Fatalf("%q missing %q", sql, want)
		}
	}
	if _, params = AudienceWhere(Audience{TierCodes: []string{}, MinVisits: &zero}); len(params) != 0 {
		t.Fatalf("empty and zero filters are ignored: %v", params)
	}
}

func TestFormatWIB(t *testing.T) {
	if got := FormatWIB(time.Date(2026, 10, 5, 8, 0, 0, 0, time.UTC)); got != "Sen, 5 Okt, 15.00" {
		t.Fatalf("got %q", got)
	}
}

func TestPortalLinks(t *testing.T) {
	for raw, ok := range map[string]bool{"events": true, " promo:kopi10 ": true, "promo:x": false, "https://evil.example": false, "": false} {
		if IsPortalLink(raw) != ok {
			t.Errorf("IsPortalLink(%q) want %v", raw, ok)
		}
	}
}

func TestPushPayload(t *testing.T) {
	decode := func(m PushMessage) map[string]string {
		var out map[string]string
		if err := json.Unmarshal(PushPayload(m), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	got := decode(PushMessage{Title: "Promo baru", Body: "Diskon 10%", Link: "promo:kopi10"})
	want := map[string]string{"title": "Promo baru", "body": "Diskon 10%", "url": "/member?go=promo%3Akopi10", "tag": "member"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("explicit link: %v", got)
	}
	if got := decode(PushMessage{Title: "Terdaftar", Type: "booking_confirmed"}); got["url"] != "/member?go=events" || got["tag"] != "booking_confirmed" {
		t.Fatalf("type link: %v", got)
	}
	if decode(PushMessage{Title: "x", Link: "https://evil.example"})["url"] != "/member" || decode(PushMessage{Title: "x", Type: "lainnya"})["url"] != "/member" {
		t.Fatal("unknown links fall back to /member")
	}
	long := decode(PushMessage{Title: "  ", Body: strings.Repeat("a", 400)})
	if long["title"] != "NüHabit" || len([]rune(long["body"])) != 180 || !strings.HasSuffix(long["body"], "…") {
		t.Fatalf("clip: %v", long)
	}
}

func TestSummarizeReviews(t *testing.T) {
	a, b, dago, braga := "a", "b", "Dago", "Braga"
	s := SummarizeReviews([]RatingCount{
		{&a, &dago, 5, 3}, {&a, &dago, 4, 1}, {&b, &braga, 2, 1}, {nil, nil, 9, 4},
	})
	if s.Count != 5 || s.Average == nil || *s.Average != 4.2 || s.Distribution != [5]int{0, 1, 0, 1, 3} {
		t.Fatalf("summary %+v", s)
	}
	want := []OutletSummary{{&a, "Dago", 4, 4.8}, {&b, "Braga", 1, 2}}
	if !reflect.DeepEqual(s.Outlets, want) {
		t.Fatalf("outlets %+v", s.Outlets)
	}
	empty := SummarizeReviews(nil)
	if empty.Count != 0 || empty.Average != nil || empty.Distribution != [5]int{} || empty.Outlets == nil {
		t.Fatalf("empty %+v", empty)
	}
	raw, _ := json.Marshal(empty)
	if string(raw) != `{"count":0,"average":null,"distribution":[0,0,0,0,0],"outlets":[]}` {
		t.Fatalf("json %s", raw)
	}
}

func TestCleanReviewText(t *testing.T) {
	if got := CleanReviewText("  enak  ", 1000); got == nil || *got != "enak" {
		t.Fatalf("trim: %v", got)
	}
	if CleanReviewText("   ", 1000) != nil {
		t.Fatal("blank is nil")
	}
	if got := CleanReviewText(strings.Repeat("x", 20), 5); *got != "xxxxx" {
		t.Fatalf("cut: %q", *got)
	}
}
