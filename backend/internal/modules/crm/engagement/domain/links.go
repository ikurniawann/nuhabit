package domain

import (
	"bytes"
	"encoding/json"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf16"
)

// portalTabs are the portal destinations an announcement may link to
// (PORTAL_TABS in lib/member-portal/links.ts).
var portalTabs = []string{
	"home", "coins", "topup", "history", "profile", "events", "challenges", "promos", "rewards",
	"badges", "collection", "reviews", "classes", "my-classes", "credits", "workout", "races", "coaches",
}

var promoCodeRe = regexp.MustCompile(`^[A-Za-z0-9-]{3,40}$`)

// IsPortalLink reports whether raw is a tab name or "promo:<code>".
func IsPortalLink(raw string) bool {
	value := strings.TrimSpace(raw)
	if strings.HasPrefix(strings.ToLower(value), "promo:") {
		return promoCodeRe.MatchString(strings.TrimSpace(value[len("promo:"):]))
	}
	return slices.Contains(portalTabs, value)
}

// PortalURL is the /member?go=<link> URL a push notification opens.
func PortalURL(link string) string {
	if !IsPortalLink(link) {
		return "/member"
	}
	return "/member?go=" + encodeURIComponent(strings.TrimSpace(link))
}

// LinkForNotificationType is the default destination of a system
// notification, "" when it has none.
func LinkForNotificationType(kind string) string {
	switch {
	case strings.HasPrefix(kind, "booking_"), strings.HasPrefix(kind, "waitlist_"), strings.HasPrefix(kind, "event_"):
		return "events"
	case strings.HasPrefix(kind, "challenge_"):
		return "challenges"
	case strings.HasPrefix(kind, "topup"):
		return "topup"
	case strings.HasPrefix(kind, "review"):
		return "reviews"
	case kind == "promo":
		return "promos"
	}
	return ""
}

// encodeURIComponent matches the JavaScript function of the same name.
func encodeURIComponent(s string) string {
	r := strings.NewReplacer("+", "%20", "%21", "!", "%27", "'", "%28", "(", "%29", ")", "%2A", "*", "%7E", "~")
	return r.Replace(url.QueryEscape(s))
}

// PushMessage is one web push notification. Link "" falls back to the
// notification type's default destination.
type PushMessage struct {
	Type  string
	Title string
	Body  string
	Link  string
}

const (
	pushTitleMax = 80
	pushBodyMax  = 180
)

// clip cuts text longer than max UTF-16 units to max-1 units plus "…".
func clip(text string, max int) string {
	units := utf16.Encode([]rune(text))
	if len(units) <= max {
		return text
	}
	return string(utf16.Decode(units[:max-1])) + "…"
}

// PushPayload mirrors buildPushPayload: the JSON the service worker reads.
func PushPayload(m PushMessage) []byte {
	link := m.Link
	if link == "" {
		link = LinkForNotificationType(m.Type)
	}
	title := strings.TrimSpace(m.Title)
	if title == "" {
		title = "NüHabit"
	}
	tag := m.Type
	if tag == "" {
		tag = "member"
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(struct {
		Title string `json:"title"`
		Body  string `json:"body"`
		URL   string `json:"url"`
		Tag   string `json:"tag"`
	}{clip(title, pushTitleMax), clip(strings.TrimSpace(m.Body), pushBodyMax), PortalURL(link), tag})
	return bytes.TrimRight(buf.Bytes(), "\n")
}
