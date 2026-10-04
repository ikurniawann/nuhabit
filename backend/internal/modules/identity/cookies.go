package identity

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/stall"
)

// activeStallMaxAge is the 30-day life of the active stall cookie.
const activeStallMaxAge = 60 * 60 * 24 * 30

// cookie is one Set-Cookie value, serialized the way Next's ResponseCookies
// does (attribute order and lower-case SameSite included) so Go responses
// are byte-identical to the TS ones.
type cookie struct {
	name, value string
	expires     *time.Time
	maxAge      *int
	secure      bool
	httpOnly    bool
	sameSiteLax bool
}

// String is stringifyCookie. Values are tokens, UUIDs or "all", which
// encodeURIComponent leaves unchanged.
func (c cookie) String() string {
	parts := []string{c.name + "=" + c.value, "Path=/"}
	if c.expires != nil {
		parts = append(parts, "Expires="+c.expires.UTC().Format(http.TimeFormat))
	}
	if c.maxAge != nil {
		parts = append(parts, "Max-Age="+strconv.Itoa(*c.maxAge))
	}
	if c.secure {
		parts = append(parts, "Secure")
	}
	if c.httpOnly {
		parts = append(parts, "HttpOnly")
	}
	if c.sameSiteLax {
		parts = append(parts, "SameSite=lax")
	}
	return strings.Join(parts, "; ")
}

func addCookie(w http.ResponseWriter, c cookie) { w.Header().Add("Set-Cookie", c.String()) }

var zeroMaxAge = 0

// setSessionCookie is setSessionCookie: the new cookie, and the legacy name
// expired so it does not linger.
func setSessionCookie(w http.ResponseWriter, r *http.Request, s *Session) {
	addCookie(w, cookie{name: auth.SessionCookie, value: s.Token, expires: &s.ExpiresAt,
		secure: httpx.SecureRequest(r), httpOnly: true, sameSiteLax: true})
	expireSessionCookie(w, r, auth.LegacySessionCookie)
}

// clearSessionCookies is clearSessionCookie.
func clearSessionCookies(w http.ResponseWriter, r *http.Request) {
	expireSessionCookie(w, r, auth.SessionCookie)
	expireSessionCookie(w, r, auth.LegacySessionCookie)
}

var epoch = time.Unix(0, 0)

func expireSessionCookie(w http.ResponseWriter, r *http.Request, name string) {
	addCookie(w, cookie{name: name, expires: &epoch, maxAge: &zeroMaxAge,
		secure: httpx.SecureRequest(r), httpOnly: true, sameSiteLax: true})
}

// setActiveStallCookie is writeActiveStallCookie: the choice for 30 days,
// and the legacy name expired.
func setActiveStallCookie(w http.ResponseWriter, r *http.Request, value string, now time.Time) {
	secure := httpx.SecureRequest(r)
	maxAge := activeStallMaxAge
	expires := now.Add(activeStallMaxAge * time.Second)
	addCookie(w, cookie{name: stall.CookieName, value: value, expires: &expires, maxAge: &maxAge,
		secure: secure, httpOnly: true, sameSiteLax: true})
	addCookie(w, cookie{name: stall.LegacyCookieName, maxAge: &zeroMaxAge, secure: secure, httpOnly: true, sameSiteLax: true})
}
