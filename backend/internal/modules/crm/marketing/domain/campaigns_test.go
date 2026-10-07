package domain

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

func num(f float64) *float64 { return &f }

func TestNormalizeSegment(t *testing.T) {
	cases := []struct {
		in   any
		want CampaignSegment
	}{
		{map[string]any{}, CampaignSegment{Tiers: []string{}}},
		{nil, CampaignSegment{Tiers: []string{}}},
		{map[string]any{"last_visit_days": "abc", "min_xp": json.Number("-5"), "tiers": "x"}, CampaignSegment{Tiers: []string{}}},
		{map[string]any{"last_visit_days": json.Number("60.9"), "min_xp": json.Number("100"), "tiers": []any{"gold", "", 3.0}},
			CampaignSegment{LastVisitDays: num(60), Tiers: []string{"gold"}, MinXP: num(100)}},
	}
	for _, c := range cases {
		if got := NormalizeSegment(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("NormalizeSegment(%v) = %+v want %+v", c.in, got, c.want)
		}
	}
	got, _ := json.Marshal(NormalizeSegment(nil))
	if string(got) != `{"last_visit_days":null,"tiers":[],"min_xp":null}` {
		t.Fatalf("json %s", got)
	}
}

func TestBuildSegmentFilter(t *testing.T) {
	where, params := BuildSegmentFilter(CampaignSegment{Tiers: []string{}}, 3)
	mustContain(t, where, "is_active = true", "phone IS NOT NULL")
	if len(params) != 0 {
		t.Fatalf("params %v", params)
	}
	where, params = BuildSegmentFilter(CampaignSegment{LastVisitDays: num(60), Tiers: []string{"gold", "silver"}, MinXP: num(500)}, 3)
	mustContain(t, where, "$3", "$4", "$5", "last_visit IS NOT NULL")
	if !reflect.DeepEqual(params, []any{60.0, []string{"gold", "silver"}, 500.0}) {
		t.Fatalf("params %#v", params)
	}
}

func TestRenderCampaignMessage(t *testing.T) {
	kode := "WIN-ABC123"
	out := RenderCampaignMessage("Halo {nama}, pakai kode {kode} ya!", "Budi", &kode)
	if !strings.Contains(out, "Halo Budi, pakai kode WIN-ABC123 ya!") || !strings.HasSuffix(out, OptoutFooter) {
		t.Fatalf("out %q", out)
	}
	out = RenderCampaignMessage("Halo {nama} {kode}", "Ani", nil)
	if strings.Contains(out, "{kode}") || !strings.HasPrefix(out, "Halo Ani"+OptoutFooter) {
		t.Fatalf("out %q", out)
	}
}

func TestRenderInAppBody(t *testing.T) {
	kode := "WIN-1"
	if got := RenderInAppBody("Halo {nama}, kode {kode}", "Sari", &kode); got != "Halo Sari, kode WIN-1" {
		t.Fatalf("got %q", got)
	}
	if got := RenderInAppBody("Halo {nama} {kode} ya", "Sari", nil); got != "Halo Sari ya" {
		t.Fatalf("got %q", got)
	}
}

func TestValidateTemplate(t *testing.T) {
	cases := []struct{ tpl, mode, want string }{
		{"Halo {nama}", "batch", "template-tanpa-kode"},
		{"Halo {nama}, kode: {kode}", "batch", ""},
		{"Kode {kode}", "", "kode-tanpa-promo"},
		{"Halo {nama}", "", ""},
		{"Kode {kode}", "public", ""},
	}
	for _, c := range cases {
		if got := ValidateTemplate(c.tpl, c.mode); got != c.want {
			t.Errorf("ValidateTemplate(%q, %q) = %q want %q", c.tpl, c.mode, got, c.want)
		}
	}
}

func TestNormalizeChannels(t *testing.T) {
	cases := []struct{ in, want []string }{
		{nil, []string{"wa"}},
		{[]string{"sms"}, []string{"wa"}},
		{[]string{"in_app", "wa", "in_app"}, []string{"wa", "in_app"}},
		{[]string{"in_app"}, []string{"in_app"}},
	}
	for _, c := range cases {
		if got := NormalizeChannels(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("NormalizeChannels(%v) = %v want %v", c.in, got, c.want)
		}
	}
}

func TestValidateSchedule(t *testing.T) {
	now := time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC)
	at := func(s string) (time.Time, bool) {
		v, err := time.Parse(time.RFC3339, s)
		return v, err == nil
	}
	cases := []struct{ in, want string }{
		{"2026-10-04T03:04:00Z", "jadwal-terlalu-dekat"},
		{"2026-10-04T03:05:00Z", ""},
		{"2026-10-03T03:00:00Z", "jadwal-terlalu-dekat"},
		{"besok pagi", "jadwal-tidak-valid"},
		{"2027-01-03T03:00:00Z", "jadwal-terlalu-jauh"},
		{"2027-01-01T03:00:00Z", ""},
	}
	for _, c := range cases {
		v, ok := at(c.in)
		if got := ValidateSchedule(v, ok, now); got != c.want {
			t.Errorf("ValidateSchedule(%s) = %q want %q", c.in, got, c.want)
		}
	}
}

func TestParseCampaignConfig(t *testing.T) {
	cases := []struct {
		in   any
		want CampaignConfig
	}{
		{nil, CampaignConfig{false, 150}},
		{"x", CampaignConfig{false, 150}},
		{map[string]any{"enabled": true, "daily_cap": json.Number("99.7")}, CampaignConfig{true, 99}},
		{map[string]any{"enabled": "true", "daily_cap": json.Number("5000")}, CampaignConfig{false, 2000}},
		{map[string]any{"daily_cap": json.Number("-3")}, CampaignConfig{false, 1}},
		{map[string]any{"daily_cap": "10"}, CampaignConfig{false, 150}},
	}
	for _, c := range cases {
		if got := ParseCampaignConfig(c.in); got != c.want {
			t.Errorf("ParseCampaignConfig(%v) = %+v want %+v", c.in, got, c.want)
		}
	}
}

func TestIsSafeLink(t *testing.T) {
	for in, want := range map[string]bool{
		"/member/events": true, "https://bcd.id/promo": true, " HTTP://x ": true,
		"//evil.test": false, "javascript:alert(1)": false, "https://": false, "https:// x": false, "": false,
	} {
		if got := IsSafeLink(in); got != want {
			t.Errorf("IsSafeLink(%q) = %v want %v", in, got, want)
		}
	}
}

func TestNormalizePhoneDigits(t *testing.T) {
	for in, want := range map[string]string{
		"0812-3456-789": "628123456789", "+62 812 3456 789": "628123456789", "12345": "", "": "", "0812345678901234": "",
	} {
		if got := NormalizePhoneDigits(in); got != want {
			t.Errorf("NormalizePhoneDigits(%q) = %q want %q", in, got, want)
		}
	}
}

func TestPublicFieldJSONOrder(t *testing.T) {
	got, _ := json.Marshal(DefaultFormFields[3])
	want := `{"key":"org_type","label":"Jenis instansi","type":"select","required":false,"placeholder":null,"help_text":null,"width":1,"options":["corporate","sekolah","komunitas","travel-agent","pemerintah","perorangan","lainnya"]}`
	if string(got) != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
	got, _ = json.Marshal(PublicField{Key: "pic_phone", Label: "HP", Type: "phone", Width: 2})
	if string(got) != `{"key":"pic_phone","label":"HP","type":"phone","required":false,"options":[],"width":2}` {
		t.Fatalf("got %s", got)
	}
	if !HasContactField([]string{"city", "pic_email"}) || HasContactField([]string{"city"}) {
		t.Fatal("HasContactField")
	}
}
