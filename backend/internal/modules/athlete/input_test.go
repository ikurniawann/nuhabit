package athlete

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func decodeString[B any](t *testing.T, raw string) (B, bool) {
	t.Helper()
	var b B
	ok := decodeBody(httptest.NewRequest("POST", "/", strings.NewReader(raw)), &b)
	return b, ok
}

func TestJSStringHelpers(t *testing.T) {
	if jsLen("é😀") != 3 {
		t.Fatal("jsLen counts UTF-16 units")
	}
	if got := jsTrim("\uFEFF\u00A0 hi \u2003\n"); got != "hi" {
		t.Fatalf("jsTrim %q", got)
	}
	if got := jsTrim("\u0085x"); got != "\u0085x" {
		t.Fatal("NEL is not JS whitespace")
	}
	if got := jsSlice("ab😀", 3); got != "ab" {
		t.Fatalf("jsSlice %q", got)
	}
}

func TestParseISODateTime(t *testing.T) {
	cases := map[string]string{
		"2026-10-01T06:00:00Z":           "2026-10-01T06:00:00Z",
		"2026-10-01T06:00Z":              "2026-10-01T06:00:00Z",
		"2026-10-01T13:00:00.1239+07:00": "2026-10-01T06:00:00.123Z",
		"2026-10-01T01:30:00-04:30":      "2026-10-01T06:00:00Z",
	}
	for in, want := range cases {
		got, ok := parseISODateTime(in)
		if !ok || got.Format(time.RFC3339Nano) != want {
			t.Errorf("%s -> %v %v", in, got, ok)
		}
	}
	for _, bad := range []string{"2026-02-30T00:00:00Z", "2026-10-01 06:00:00Z", "2026-10-01T06:00:00", "2026-10-01T24:00:00Z"} {
		if _, ok := parseISODateTime(bad); ok {
			t.Errorf("accepted %s", bad)
		}
	}
}

func TestDecodeBodyRejectsNonObjects(t *testing.T) {
	for _, raw := range []string{"", "null", "[]", "5", "{bad"} {
		if _, ok := decodeString[settingsBody](t, raw); ok {
			t.Errorf("accepted %q", raw)
		}
	}
}

func TestSaveActivityValidation(t *testing.T) {
	b, ok := decodeString[saveActivityBody](t, `{"type":"RUN","unknown":1}`)
	in, valid := b.validate()
	if !ok || !valid {
		t.Fatal("minimal body rejected")
	}
	if in.Visibility != "EVERYONE" || in.StartedAt != nil || len(in.Points) != 0 || len(in.Photos) != 0 || in.GearID != nil {
		t.Fatalf("defaults %+v", in)
	}
	bad := []string{
		`{"type":"SWIM"}`,
		`{"type":"RUN","title":null}`,
		`{"type":"RUN","title":"` + strings.Repeat("x", 121) + `"}`,
		`{"type":"RUN","points":[{"t":-1,"lat":0,"lng":0}]}`,
		`{"type":"RUN","points":[{"t":0,"lat":91,"lng":0}]}`,
		`{"type":"RUN","points":[{"t":0,"lat":0,"lng":0,"ele":null}]}`,
		`{"type":"RUN","points":[null]}`,
		`{"type":"RUN","manualElapsedSec":1.5}`,
		`{"type":"RUN","manualElapsedSec":86401}`,
		`{"type":"RUN","gearId":"nope"}`,
		`{"type":"RUN","photos":["a","b","c"]}`,
		`{"type":"RUN","startedAt":"yesterday"}`,
		`{"type":"RUN","title":5}`,
	}
	for _, raw := range bad {
		b, ok := decodeString[saveActivityBody](t, raw)
		if _, valid := b.validate(); ok && valid {
			t.Errorf("accepted %s", raw)
		}
	}
	b, _ = decodeString[saveActivityBody](t, `{"type":"WORKOUT","startedAt":null,"gearId":null,"manualElapsedSec":2400,
		"points":[{"t":0,"lat":-6.2,"lng":106.8,"ele":12}]}`)
	in, valid = b.validate()
	if !valid || *in.ManualElapsedSec != 2400 || *in.Points[0].Ele != 12 {
		t.Fatalf("%+v", in)
	}
	if raw, _ := json.Marshal(in.Points); string(raw) != `[{"t":0,"lat":-6.2,"lng":106.8,"ele":12}]` {
		t.Fatal(string(raw))
	}
}

func TestPatchAndSettingsValidation(t *testing.T) {
	b, _ := decodeString[updateActivityBody](t, `{"gearId":null,"description":""}`)
	p, ok := b.validate()
	if !ok || !p.GearSet || p.GearID != nil || p.Title != nil || *p.Description != "" {
		t.Fatalf("%+v", p)
	}
	b, _ = decodeString[updateActivityBody](t, `{"title":""}`)
	if _, ok := b.validate(); ok {
		t.Fatal("empty title accepted")
	}

	s, _ := decodeString[settingsBody](t, `{"weeklyGoalKm":null,"units":"IMPERIAL"}`)
	sp, ok := s.validate()
	if !ok || !sp.GoalSet || sp.WeeklyGoalKm != nil || *sp.Units != "IMPERIAL" {
		t.Fatalf("%+v", sp)
	}
	for _, raw := range []string{`{"weeklyGoalKm":0}`, `{"weeklyGoalKm":1001}`, `{"language":"FR"}`, `{"bookingReminders":null}`} {
		s, _ := decodeString[settingsBody](t, raw)
		if _, ok := s.validate(); ok {
			t.Errorf("accepted %s", raw)
		}
	}
	// The home schema has no weeklyGoalKm: zod strips it whatever its type.
	h, ok := decodeString[homeSettingsBody](t, `{"weeklyGoalKm":"x","language":"EN"}`)
	hp, valid := h.validate()
	if !ok || !valid || hp.GoalSet || *hp.Language != "EN" {
		t.Fatalf("%+v", hp)
	}
}

func TestSmallSchemas(t *testing.T) {
	c, _ := decodeString[commentBody](t, `{"text":"  hai  "}`)
	if text, ok := c.validate(); !ok || text != "hai" {
		t.Fatal(text)
	}
	c, _ = decodeString[commentBody](t, `{"text":"   "}`)
	if _, ok := c.validate(); ok {
		t.Fatal("blank comment accepted")
	}
	g, _ := decodeString[gearBody](t, `{"name":" Pegasus ","kind":"SHOES"}`)
	if in, ok := g.validate(); !ok || in.Name != "Pegasus" || in.Retired {
		t.Fatalf("%+v", in)
	}
	g, _ = decodeString[gearBody](t, `{"name":"P","kind":"SHOES"}`)
	if _, ok := g.validate(); ok {
		t.Fatal("short gear name accepted")
	}
	rb, _ := decodeString[saveRouteBody](t, `{"activityId":"0b8f0a2e-0000-4000-8000-000000000001","name":"  GBK "}`)
	if in, ok := rb.validate(); !ok || in.Name != "GBK" {
		t.Fatal(in)
	}
}
