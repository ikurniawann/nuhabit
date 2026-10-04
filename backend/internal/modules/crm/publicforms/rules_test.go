package publicforms

import (
	"encoding/json"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/crm/marketing/domain"
)

// Ported from lib/crm/public-forms.test.ts.

func field(key, label, typ string, required bool, options ...string) domain.PublicField {
	return domain.PublicField{Key: key, Label: label, Type: typ, Required: required, Options: options, Width: 1}
}

var fields = []domain.PublicField{
	field("pic_name", "Nama", "text", true),
	field("pic_phone", "WhatsApp", "phone", true),
	field("pic_email", "Email", "email", false),
	field("org_name", "Instansi", "text", false),
	field("org_type", "Jenis", "select", false, "corporate", "sekolah"),
	field("notes", "Kebutuhan", "textarea", false),
	field("jumlah_pax", "Jumlah Pax", "number", false),
	field("tanggal_acara", "Tanggal", "date", false),
	field("setuju", "Setuju dihubungi", "checkbox", false),
}

func payload(t *testing.T, raw string) map[string]any {
	t.Helper()
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestValidateSubmission(t *testing.T) {
	r := ValidateSubmission(fields, payload(t, `{"pic_name":"  Budi  ","pic_phone":"0812-3456-7890","pic_email":"budi@maju.co.id",
		"org_name":"PT Maju","org_type":"corporate","notes":"Butuh katering 100 pax","jumlah_pax":"100","tanggal_acara":"2026-10-01","setuju":"on"}`))
	if !r.OK() || r.Lead["pic_name"] != "Budi" || r.Lead["pic_phone"] != "081234567890" || r.Lead["org_name"] != "PT Maju" {
		t.Fatalf("valid = %+v", r)
	}
	if !reflect.DeepEqual(r.Custom, map[string]any{"jumlah_pax": 100.0, "tanggal_acara": "2026-10-01", "setuju": true}) {
		t.Errorf("custom = %v", r.Custom)
	}

	r = ValidateSubmission(fields, payload(t, `{"pic_name":"Budi","pic_phone":"08123456789","owner_user_id":"penyusup","company_id":"penyusup","score":999}`))
	if !r.OK() || len(r.Custom) != 0 || !reflect.DeepEqual(r.LeadKeys, []string{"pic_name", "pic_phone"}) {
		t.Errorf("unknown keys = %+v", r)
	}

	r = ValidateSubmission(fields, payload(t, `{"pic_email":"bukan-email","org_type":"kampus","jumlah_pax":"abc"}`))
	var keys []string
	for _, e := range r.Errors {
		keys = append(keys, e.Key)
	}
	sort.Strings(keys)
	if r.OK() || !reflect.DeepEqual(keys, []string{"jumlah_pax", "org_type", "pic_email", "pic_name", "pic_phone"}) {
		t.Errorf("errors = %v", keys)
	}
	short := ValidateSubmission(fields, payload(t, `{"pic_name":"A","pic_phone":"0812"}`))
	if short.OK() || short.Errors[0].Key != "pic_phone" {
		t.Errorf("short phone = %+v", short.Errors)
	}

	orgRequired := fields[3]
	orgRequired.Required = true
	r = ValidateSubmission([]domain.PublicField{fields[0], orgRequired}, payload(t, `{"pic_name":"Budi","org_name":"PT Maju"}`))
	if r.OK() || r.Errors[0].Key != "pic_phone" {
		t.Errorf("no contact = %+v", r.Errors)
	}
	if !v8ParsesDate("2026-02-30") || v8ParsesDate("2026-13-01") {
		t.Error("date parsing follows V8")
	}
}

func TestIsLikelyBot(t *testing.T) {
	if bot, _ := IsLikelyBot(map[string]any{"website_url": "http://spam"}, time.Now()); !bot {
		t.Error("honeypot")
	}
	now := time.Date(2026, 9, 13, 10, 0, 0, 0, time.UTC)
	at := func(ms int64) map[string]any {
		return map[string]any{"form_started_at": json.Number(strconv.FormatInt(now.UnixMilli()+ms, 10))}
	}
	cases := []struct {
		offset int64
		bot    bool
		reason string
	}{
		{-1000, true, "kiriman terlalu cepat"},
		{-10_000, false, ""},
		{60_000, true, "stempel waktu tidak wajar"},
		{-30 * 60 * 60 * 1000, true, "stempel waktu tidak wajar"},
	}
	for _, c := range cases {
		if bot, reason := IsLikelyBot(at(c.offset), now); bot != c.bot || reason != c.reason {
			t.Errorf("offset %d: %v %q", c.offset, bot, reason)
		}
	}
	if bot, _ := IsLikelyBot(map[string]any{}, now); bot {
		t.Error("empty payload")
	}
	if bot, _ := IsLikelyBot(map[string]any{"website_url": "   "}, now); bot {
		t.Error("blank honeypot")
	}
}

func TestAttributionAndAlert(t *testing.T) {
	a := ParseAttribution(map[string]any{"utm_source": " Instagram ", "utm_campaign": strings.Repeat("x", 400), "utm_medium": "", "other": "abaikan"})
	if *a.UtmSource != "Instagram" || len(*a.UtmCampaign) != 150 || a.UtmMedium != nil || a.Referrer != nil {
		t.Errorf("attribution = %+v", a)
	}
	of := func(src any, fallback string) string {
		return SourceFromAttribution(ParseAttribution(map[string]any{"utm_source": src}), fallback)
	}
	for src, want := range map[string]string{"instagram": "instagram", "IG": "instagram", "google_ads": "google", "whatsapp": "wa", "tiktok": "lainnya", "organic": "lainnya", "'; DROP TABLE --": "lainnya"} {
		if got := of(src, "lainnya"); got != want {
			t.Errorf("source(%q) = %q", src, got)
		}
	}
	// A valid form default is kept; 'website' (the old default) is rejected
	// by crm_sales_leads_source_check, so it becomes 'lainnya'.
	if of(nil, "pameran") != "pameran" || of(nil, "website") != "lainnya" {
		t.Error("form default")
	}
	if LeadOrgName(map[string]string{"org_name": "PT Maju"}) != "PT Maju" || LeadOrgName(map[string]string{"pic_name": "Budi"}) != "Budi" ||
		LeadOrgName(map[string]string{}) != "Kiriman Form Publik" {
		t.Error("lead name")
	}
	msg := BuildLeadAlert("Permintaan Penawaran", map[string]string{"org_name": "PT Maju", "pic_name": "Budi", "pic_phone": "08123456789", "notes": "100 pax"},
		ParseAttribution(map[string]any{"utm_source": "instagram", "utm_campaign": "promo-oktober"}))
	for _, part := range []string{"Lead baru dari form publik", "PT Maju", "instagram / promo-oktober", "PIC: Budi · 08123456789"} {
		if !strings.Contains(msg, part) {
			t.Errorf("alert misses %q:\n%s", part, msg)
		}
	}
	if NormalizePhone("0812-3456") != "628123456" || NormalizePhone("8123") != "628123" || IsValidNormalizedPhone("628123456") {
		t.Error("phone normalization")
	}
}
