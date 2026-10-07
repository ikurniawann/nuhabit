package domain

import (
	"net/url"
	"regexp"
	"strings"
)

// PortalTabs are the portal destinations a notification may link to.
var PortalTabs = []string{
	"home", "coins", "topup", "history", "profile", "events", "challenges", "promos", "rewards",
	"badges", "collection", "reviews", "classes", "my-classes", "credits", "workout", "races", "coaches",
}

// PortalLink is a parsed portal destination: a tab, or a promo code.
type PortalLink struct {
	Tab   string
	Promo string
}

var promoCodeRe = regexp.MustCompile(`^[A-Za-z0-9-]{3,40}$`)

// ParsePortalLink parses "events" or "promo:KODE"; anything else is nil.
func ParsePortalLink(raw string) *PortalLink {
	value := strings.TrimSpace(raw)
	if strings.HasPrefix(strings.ToLower(value), "promo:") {
		code := strings.TrimSpace(value[len("promo:"):])
		if !promoCodeRe.MatchString(code) {
			return nil
		}
		return &PortalLink{Promo: strings.ToUpper(code)}
	}
	for _, tab := range PortalTabs {
		if tab == value {
			return &PortalLink{Tab: tab}
		}
	}
	return nil
}

// PortalURL is the /member?go=<link> URL a push notification opens.
func PortalURL(link string) string {
	if ParsePortalLink(link) == nil {
		return "/member"
	}
	return "/member?go=" + encodeURIComponent(strings.TrimSpace(link))
}

// LinkForNotificationType is the default destination of a system notification.
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

var appRoutes = map[string]string{
	"coins":      "/member/coins",
	"topup":      "/member/coins/topup",
	"history":    "/member/orders",
	"profile":    "/member/profile",
	"events":     "/member/events",
	"challenges": "/member/challenges",
	"promos":     "/member/promos",
	"rewards":    "/member/rewards",
	"badges":     "/member/badges",
	"collection": "/member/collection",
	"reviews":    "/member/reviews",
	"classes":    "/member/classes",
	"my-classes": "/member/my-classes",
	"credits":    "/member/wallet",
	"workout":    "/member/workout",
	"races":      "/member/races",
	"coaches":    "/member/trainers",
}

// GoLinkHref maps a stored portal link to the member app route; nil for
// empty, invalid or home links.
func GoLinkHref(link *string) *string {
	if link == nil {
		return nil
	}
	parsed := ParsePortalLink(*link)
	if parsed == nil {
		return nil
	}
	if parsed.Promo != "" {
		href := "/member/promos/" + encodeURIComponent(parsed.Promo)
		return &href
	}
	href, ok := appRoutes[parsed.Tab]
	if !ok {
		return nil
	}
	return &href
}

// encodeURIComponent matches the JavaScript function of the same name.
func encodeURIComponent(s string) string {
	escaped := url.QueryEscape(s)
	r := strings.NewReplacer("+", "%20", "%21", "!", "%27", "'", "%28", "(", "%29", ")", "%2A", "*", "%7E", "~")
	return r.Replace(escaped)
}
