package domain

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
	"time"
)

// CampaignSegment is the inline campaign segment (normalizeSegment's output).
// Counts stay float64 so huge values serialize the way JSON.stringify does.
type CampaignSegment struct {
	LastVisitDays *float64 `json:"last_visit_days"`
	Tiers         []string `json:"tiers"`
	MinXP         *float64 `json:"min_xp"`
}

// NormalizeSegment mirrors normalizeSegment: garbage becomes null or [],
// never a silent 0.
func NormalizeSegment(raw any) CampaignSegment {
	obj, _ := raw.(map[string]any)
	intOrNull := func(v any) *float64 {
		var f float64
		switch x := v.(type) {
		case float64:
			f = x
		case json.Number:
			var err error
			if f, err = x.Float64(); err != nil {
				return nil
			}
		default:
			return nil
		}
		f = math.Floor(f)
		if math.IsInf(f, 0) || math.IsNaN(f) || f <= 0 {
			return nil
		}
		return &f
	}
	seg := CampaignSegment{LastVisitDays: intOrNull(obj["last_visit_days"]), Tiers: []string{}, MinXP: intOrNull(obj["min_xp"])}
	if tiers, ok := obj["tiers"].([]any); ok {
		for _, t := range tiers {
			if s, ok := t.(string); ok && s != "" {
				seg.Tiers = append(seg.Tiers, s)
			}
		}
	}
	return seg
}

// BuildSegmentFilter mirrors buildSegmentFilter: a parameterized WHERE
// fragment over pos_customers (alias c) whose first placeholder is
// $startIndex. Active members with a WA number are always required.
func BuildSegmentFilter(seg CampaignSegment, startIndex int) (string, []any) {
	clauses := []string{"c.is_active = true", "c.phone IS NOT NULL", "length(trim(c.phone)) >= 8"}
	params := []any{}
	i := startIndex
	if seg.LastVisitDays != nil {
		// Win-back means visited before but long ago; never-visited members
		// are not win-back targets.
		clauses = append(clauses, "c.last_visit IS NOT NULL", fmt.Sprintf("c.last_visit <= now() - ($%d || ' days')::interval", i))
		params = append(params, *seg.LastVisitDays)
		i++
	}
	if len(seg.Tiers) > 0 {
		clauses = append(clauses, fmt.Sprintf("c.membership_tier = ANY($%d)", i))
		params = append(params, seg.Tiers)
		i++
	}
	if seg.MinXP != nil {
		clauses = append(clauses, fmt.Sprintf("COALESCE(c.total_xp, 0) >= $%d", i))
		params = append(params, *seg.MinXP)
	}
	return strings.Join(clauses, " AND "), params
}

// OptoutFooter is appended to every marketing message.
const OptoutFooter = "\n\n_Balas STOP untuk berhenti menerima info promo._"

var blankRun = regexp.MustCompile(`[ \t]{2,}`)

// RenderCampaignMessage mirrors renderCampaignMessage: {nama} and {kode}
// replaced, a dangling {kode} cleaned when there is no voucher, footer added.
func RenderCampaignMessage(template, nama string, kode *string) string {
	msg := strings.ReplaceAll(template, "{nama}", nama)
	if kode != nil && *kode != "" {
		msg = strings.ReplaceAll(msg, "{kode}", *kode)
	} else {
		msg = strings.TrimFunc(blankRun.ReplaceAllString(strings.ReplaceAll(msg, "{kode}", ""), " "), IsJSSpace)
	}
	return msg + OptoutFooter
}

// RenderInAppBody is the in-app copy: same placeholders, no STOP footer.
func RenderInAppBody(template, nama string, kode *string) string {
	return strings.TrimSuffix(RenderCampaignMessage(template, nama, kode), OptoutFooter)
}

// ValidateTemplate mirrors validateTemplate; promoMode is "", "public" or
// "batch" and the result is "" (ok), "template-tanpa-kode" or
// "kode-tanpa-promo".
func ValidateTemplate(template, promoMode string) string {
	hasKode := strings.Contains(template, "{kode}")
	switch {
	case promoMode == "batch" && !hasKode:
		return "template-tanpa-kode"
	case promoMode == "" && hasKode:
		return "kode-tanpa-promo"
	}
	return ""
}

// CampaignConfig is app_settings crm_campaign_config.
type CampaignConfig struct {
	Enabled  bool `json:"enabled"`
	DailyCap int  `json:"daily_cap"`
}

// DefaultCampaignConfig keeps the master switch off.
var DefaultCampaignConfig = CampaignConfig{Enabled: false, DailyCap: 150}

// ParseCampaignConfig mirrors parseCampaignConfig: broken values fall back
// to the safe defaults.
func ParseCampaignConfig(raw any) CampaignConfig {
	obj, _ := raw.(map[string]any)
	cfg := CampaignConfig{Enabled: obj["enabled"] == true, DailyCap: DefaultCampaignConfig.DailyCap}
	if n, ok := obj["daily_cap"].(json.Number); ok {
		if f, err := n.Float64(); err == nil && !math.IsInf(f, 0) {
			cfg.DailyCap = int(math.Min(2000, math.Max(1, math.Floor(f))))
		}
	}
	return cfg
}

// CampaignChannels are the delivery channels in canonical order.
var CampaignChannels = []string{"wa", "in_app"}

// NormalizeChannels mirrors normalizeChannels: valid channels without
// duplicates in canonical order; empty or garbage falls back to WA.
func NormalizeChannels(raw []string) []string {
	picked := []string{}
	for _, c := range CampaignChannels {
		if slices.Contains(raw, c) {
			picked = append(picked, c)
		}
	}
	if len(picked) == 0 {
		return []string{"wa"}
	}
	return picked
}

// Schedule bounds for "send later".
const (
	ScheduleMinLead = 5 * time.Minute
	ScheduleMaxLead = 90 * 24 * time.Hour
)

// ScheduleIssueMessages are SCHEDULE_ISSUE_MESSAGES.
var ScheduleIssueMessages = map[string]string{
	"jadwal-tidak-valid":   "Waktu kirim tidak valid",
	"jadwal-terlalu-dekat": "Waktu kirim minimal 5 menit dari sekarang",
	"jadwal-terlalu-jauh":  "Waktu kirim maksimal 90 hari dari sekarang",
}

// ValidateSchedule mirrors validateSchedule for an already parsed time
// (ok=false means the input was not a date). It returns "" when at is at
// least 5 minutes and at most 90 days from now.
func ValidateSchedule(at time.Time, ok bool, now time.Time) string {
	if !ok {
		return "jadwal-tidak-valid"
	}
	lead := at.Sub(now)
	switch {
	case lead < ScheduleMinLead:
		return "jadwal-terlalu-dekat"
	case lead > ScheduleMaxLead:
		return "jadwal-terlalu-jauh"
	}
	return ""
}

// IsSafeLink mirrors isSafeLink: a portal path ("/member/...") or an
// http(s) URL; protocol-relative and other schemes are rejected.
func IsSafeLink(url string) bool {
	v := strings.TrimFunc(url, IsJSSpace)
	if strings.HasPrefix(v, "/") {
		return !strings.HasPrefix(v, "//")
	}
	lower := strings.ToLower(v)
	var rest string
	switch {
	case strings.HasPrefix(lower, "http://"):
		rest = v[len("http://"):]
	case strings.HasPrefix(lower, "https://"):
		rest = v[len("https://"):]
	default:
		return false
	}
	// /^https?:\/\/[^\s/]+/: at least one character that is neither
	// whitespace nor a slash.
	for _, r := range rest {
		return r != '/' && !IsJSSpace(r)
	}
	return false
}

// NormalizePhoneDigits mirrors normalizePhoneDigits (lib/member-portal/phone.ts):
// digits only, a leading 0 becomes 62, 10 to 15 digits or "".
func NormalizePhoneDigits(phone string) string {
	var b strings.Builder
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	d := b.String()
	if d == "" {
		return ""
	}
	if strings.HasPrefix(d, "0") {
		d = "62" + d[1:]
	}
	if len(d) < 10 || len(d) > 15 {
		return ""
	}
	return d
}
