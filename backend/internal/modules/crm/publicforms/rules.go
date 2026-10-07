// Package publicforms is the public web-to-lead form endpoint
// (/api/public/crm/forms/{slug}): the form definition for the public page,
// and submissions that become sales leads with scoring, workflow and sales
// notifications. Port of lib/crm/public-forms{,-server}.ts.
package publicforms

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"

	contractsales "nuhabit/backend/internal/contracts/salesfunnel"
	"nuhabit/backend/internal/modules/crm/marketing/domain"
)

// The pure rules of lib/crm/public-forms.ts.

// leadMappedKeys are LEAD_MAPPED_KEYS: fields stored on lead columns; the
// rest go to the `custom` jsonb.
var leadMappedKeys = map[string]bool{
	"org_name": true, "pic_name": true, "pic_phone": true, "pic_email": true, "city": true, "notes": true, "org_type": true,
}

// Attribution is the UTM and page attribution of a submission.
type Attribution struct {
	UtmSource   *string `json:"utm_source"`
	UtmMedium   *string `json:"utm_medium"`
	UtmCampaign *string `json:"utm_campaign"`
	UtmContent  *string `json:"utm_content"`
	UtmTerm     *string `json:"utm_term"`
	LandingPage *string `json:"landing_page"`
	Referrer    *string `json:"referrer"`
}

func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == 0xFEFF })
}

// sliceUTF16 is String#slice(0, n).
func sliceUTF16(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}

// clean is the attribution cleaner: strings only, trimmed, cut, "" is nil.
func clean(v any, max int) *string {
	s, ok := v.(string)
	if !ok {
		return nil
	}
	if s = sliceUTF16(jsTrim(s), max); s == "" {
		return nil
	}
	return &s
}

// ParseAttribution is parseAttribution.
func ParseAttribution(p map[string]any) Attribution {
	return Attribution{
		UtmSource: clean(p["utm_source"], 100), UtmMedium: clean(p["utm_medium"], 100),
		UtmCampaign: clean(p["utm_campaign"], 150), UtmContent: clean(p["utm_content"], 150),
		UtmTerm: clean(p["utm_term"], 150), LandingPage: clean(p["landing_page"], 500), Referrer: clean(p["referrer"], 500),
	}
}

var knownSources = map[string]string{
	"instagram": "instagram", "ig": "instagram", "facebook": "instagram", "meta": "instagram",
	"google": "google", "googleads": "google", "google_ads": "google", "adwords": "google", "sem": "google",
	"wa": "wa", "whatsapp": "wa",
	"referral": "referral", "refferal": "referral",
	"pameran": "pameran", "event": "pameran", "expo": "pameran",
	"website": "website", "web": "website", "organic": "website",
}

var notSourceChar = regexp.MustCompile(`[^a-z_]`)

// SourceFromAttribution is sourceFromAttribution: utm_source mapped to a
// known lead source, else the form default.
func SourceFromAttribution(a Attribution, fallback string) string {
	src := ""
	if a.UtmSource != nil {
		src = *a.UtmSource
	}
	if s, ok := knownSources[notSourceChar.ReplaceAllString(strings.ToLower(src), "")]; ok {
		return s
	}
	return ToLeadSource(fallback)
}

// ToLeadSource is toLeadSource: a valid lead source, or "lainnya" for
// anything crm_sales_leads_source_check rejects.
func ToLeadSource(v string) string {
	if slices.Contains(contractsales.LeadSources, v) {
		return v
	}
	return "lainnya"
}

// FieldError is one field's validation message.
type FieldError struct {
	Key     string `json:"key"`
	Message string `json:"message"`
}

// Submission is SubmissionResult: Lead keeps the definition order.
type Submission struct {
	Errors   []FieldError
	LeadKeys []string
	Lead     map[string]string
	Custom   map[string]any
}

// OK reports whether every field passed.
func (s Submission) OK() bool { return len(s.Errors) == 0 }

var (
	emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	dateRe  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	nonPhn  = regexp.MustCompile(`[^0-9+]`)
	nonNum  = regexp.MustCompile(`[^0-9.-]`)
	nonDig  = regexp.MustCompile(`\D`)
)

// jsString is String(v) for a decoded JSON value.
func jsString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return string(x)
		}
		return strconv.FormatFloat(f, 'f', -1, 64)
	case nil:
		return "null"
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if e != nil {
				parts[i] = jsString(e)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// jsNumber is Number(s) for a cleaned digit string.
func jsNumber(s string) float64 {
	if s == "" {
		return 0
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// ValidateSubmission is validateSubmission: each defined field checked by
// type, unknown keys dropped, and a phone or email always required.
func ValidateSubmission(fields []domain.PublicField, payload map[string]any) Submission {
	out := Submission{Lead: map[string]string{}, Custom: map[string]any{}}
	for _, f := range fields {
		raw := payload[f.Key]
		if raw == nil || raw == "" || raw == false {
			if f.Required {
				out.Errors = append(out.Errors, FieldError{f.Key, f.Label + " wajib diisi"})
			}
			continue
		}
		var value any
		switch f.Type {
		case "email":
			s := sliceUTF16(jsTrim(jsString(raw)), 150)
			if !emailRe.MatchString(s) {
				out.Errors = append(out.Errors, FieldError{f.Key, f.Label + " bukan email yang valid"})
				continue
			}
			value = s
		case "phone":
			digits := nonPhn.ReplaceAllString(jsString(raw), "")
			if len(nonDig.ReplaceAllString(digits, "")) < 8 {
				out.Errors = append(out.Errors, FieldError{f.Key, f.Label + " terlalu pendek"})
				continue
			}
			value = sliceUTF16(digits, 20)
		case "number":
			// Without the empty check "abc" filters to "" and Number("") = 0.
			digits := nonNum.ReplaceAllString(jsString(raw), "")
			n := jsNumber(digits)
			if digits == "" || math.IsNaN(n) || math.IsInf(n, 0) {
				out.Errors = append(out.Errors, FieldError{f.Key, f.Label + " harus angka"})
				continue
			}
			value = n
		case "date":
			s := jsTrim(jsString(raw))
			if !dateRe.MatchString(s) || !v8ParsesDate(s) {
				out.Errors = append(out.Errors, FieldError{f.Key, f.Label + " harus tanggal"})
				continue
			}
			value = s
		case "select":
			s := jsTrim(jsString(raw))
			if len(f.Options) > 0 && !contains(f.Options, s) {
				out.Errors = append(out.Errors, FieldError{f.Key, f.Label + " bukan pilihan yang tersedia"})
				continue
			}
			value = s
		case "checkbox":
			_, isNum := raw.(json.Number)
			value = raw == true || raw == "true" || raw == "on" || raw == "1" || isNum && numberOf(raw) == 1
		case "textarea":
			value = sliceUTF16(jsTrim(jsString(raw)), 2000)
		default:
			value = sliceUTF16(jsTrim(jsString(raw)), 200)
		}
		if leadMappedKeys[f.Key] {
			out.LeadKeys = append(out.LeadKeys, f.Key)
			out.Lead[f.Key] = jsString(value)
		} else {
			out.Custom[f.Key] = value
		}
	}
	flagged := false
	for _, e := range out.Errors {
		if e.Key == "pic_phone" || e.Key == "pic_email" {
			flagged = true
		}
	}
	if out.Lead["pic_phone"] == "" && out.Lead["pic_email"] == "" && !flagged {
		out.Errors = append(out.Errors, FieldError{"pic_phone", "Isi nomor WhatsApp atau email agar kami bisa menghubungi Anda"})
	}
	return out
}

// v8ParsesDate is !isNaN(Date.parse(s)) for "YYYY-MM-DD": V8 accepts any
// month 01-12 with a day 01-31 ("2026-02-30" rolls into March).
func v8ParsesDate(s string) bool {
	month, _ := strconv.Atoi(s[5:7])
	day, _ := strconv.Atoi(s[8:10])
	return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// honeypotField is HONEYPOT_FIELD; minFillSeconds is MIN_FILL_SECONDS.
const (
	honeypotField  = "website_url"
	minFillSeconds = 3
)

// IsLikelyBot is isLikelyBot: a filled honeypot, or a form timestamp that
// is in the future, over a day old, or under 3 seconds old.
func IsLikelyBot(p map[string]any, now time.Time) (bool, string) {
	if trap, ok := p[honeypotField].(string); ok && jsTrim(trap) != "" {
		return true, "honeypot terisi"
	}
	started := numberOf(p["form_started_at"])
	if !math.IsNaN(started) && !math.IsInf(started, 0) && started > 0 {
		elapsed := (float64(now.UnixMilli()) - started) / 1000
		if elapsed < 0 || elapsed > 24*3600 {
			return true, "stempel waktu tidak wajar"
		}
		if elapsed < minFillSeconds {
			return true, "kiriman terlalu cepat"
		}
	}
	return false, ""
}

// numberOf is Number(v) for a decoded JSON value.
func numberOf(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return math.NaN()
		}
		return f
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		t := jsTrim(x)
		if t == "" {
			return 0
		}
		f, err := strconv.ParseFloat(t, 64)
		if err != nil {
			return math.NaN()
		}
		return f
	}
	return math.NaN()
}

// LeadOrgName is leadOrgName.
func LeadOrgName(lead map[string]string) string {
	if s := jsTrim(lead["org_name"]); s != "" {
		return s
	}
	if s := jsTrim(lead["pic_name"]); s != "" {
		return s
	}
	return "Kiriman Form Publik"
}

// BuildLeadAlert is buildLeadAlert: the WhatsApp text to sales.
func BuildLeadAlert(formName string, lead map[string]string, a Attribution) string {
	pic := lead["pic_name"]
	if pic == "" {
		pic = "—"
	}
	if lead["pic_phone"] != "" {
		pic += " · " + lead["pic_phone"]
	}
	lines := []string{"🌐 *Lead baru dari form publik*", "Form: " + formName, "Instansi: " + LeadOrgName(lead), "PIC: " + pic}
	if lead["pic_email"] != "" {
		lines = append(lines, "Email: "+lead["pic_email"])
	}
	if lead["city"] != "" {
		lines = append(lines, "Kota: "+lead["city"])
	}
	if lead["notes"] != "" {
		lines = append(lines, "", "Kebutuhan: "+sliceUTF16(lead["notes"], 300))
	}
	var utm []string
	for _, v := range []*string{a.UtmSource, a.UtmMedium, a.UtmCampaign} {
		if v != nil {
			utm = append(utm, *v)
		}
	}
	if len(utm) > 0 {
		lines = append(lines, "", "Asal: "+strings.Join(utm, " / "))
	}
	return strings.Join(lines, "\n")
}

// NormalizePhone is the sales funnel normalizePhone: digits, 0… and 8…
// turned into 62….
func NormalizePhone(raw string) string {
	digits := nonDig.ReplaceAllString(raw, "")
	switch {
	case strings.HasPrefix(digits, "0"):
		return "62" + digits[1:]
	case strings.HasPrefix(digits, "8"):
		return "62" + digits
	}
	return digits
}

// IsValidNormalizedPhone is isValidNormalizedPhone.
func IsValidNormalizedPhone(p string) bool { return len(p) >= 10 && strings.HasPrefix(p, "62") }

// HashIP stores the submitter's IP as a hash only.
func HashIP(ip string) string {
	sum := sha256.Sum256([]byte("bcdcoffee-form:" + ip))
	return hex.EncodeToString(sum[:])
}

var (
	jakarta     = mustJakarta()
	monthsShort = [...]string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}
)

func mustJakarta() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}

// FormatDate is formatDate(new Date()): "4 Okt 2026" in WIB.
func FormatDate(t time.Time) string {
	t = t.In(jakarta)
	return strconv.Itoa(t.Day()) + " " + monthsShort[t.Month()-1] + " " + strconv.Itoa(t.Year())
}
