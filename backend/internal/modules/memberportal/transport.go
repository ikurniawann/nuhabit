package memberportal

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/httpx"
)

// failure is a member portal error with the TS body shape:
// {"success":false,"error":msg[,"field":..][,"code":..]}.
type failure struct {
	Status  int
	Message string
	Field   string
	Code    string
}

func (f *failure) Error() string { return f.Message }

func fail(status int, msg string) *failure { return &failure{Status: status, Message: msg} }

type failureBody struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
	Field   string `json:"field,omitempty"`
	Code    string `json:"code,omitempty"`
}

type dataBody struct {
	Success bool `json:"success"`
	Data    any  `json:"data"`
}

// ok writes {"success":true,"data":data} (memberJson in TS).
func ok(w http.ResponseWriter, data any) error {
	return httpx.JSON(w, http.StatusOK, dataBody{Success: true, Data: data})
}

// writeFailure renders err: failures and httpx errors with their status,
// anything else as 500 with the route's message (withMemberSession).
func writeFailure(w http.ResponseWriter, r *http.Request, log *slog.Logger, err error, failMessage string) {
	var f *failure
	if errors.As(err, &f) {
		_ = httpx.JSON(w, f.Status, failureBody{Success: false, Error: f.Message, Field: f.Field, Code: f.Code})
		return
	}
	var he *httpx.Error
	if errors.As(err, &he) {
		httpx.WriteError(w, r, he)
		return
	}
	log.ErrorContext(r.Context(), "[member-portal] "+failMessage, "path", r.URL.Path, "error", err.Error())
	_ = httpx.JSON(w, http.StatusInternalServerError, failureBody{Success: false, Error: failMessage})
}

// readBody mirrors `await request.json().catch(() => ({}))`: unreadable JSON
// is an empty object. isObject is false when the body parsed to something
// other than an object (null, an array, a number), which zod rejects.
func readBody(r *http.Request) (body map[string]any, isObject bool) {
	empty := map[string]any{}
	if r.Body == nil {
		return empty, true
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return empty, true
	}
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return empty, true
	}
	if m, isObj := v.(map[string]any); isObj {
		return m, true
	}
	return empty, false
}

// jsString is String(v ?? "").trim() for a JSON value.
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(x)
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		b, _ := json.Marshal(x)
		return string(b)
	}
	b, _ := json.Marshal(v)
	return string(b)
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

// isUUID mirrors zod's z.string().uuid() (RFC 9562 versions 1-8, nil and max).
func isUUID(s string) bool {
	return uuidRe.MatchString(s) || s == "00000000-0000-0000-0000-000000000000" || s == "ffffffff-ffff-ffff-ffff-ffffffffffff"
}

var zodEmailRe = regexp.MustCompile(`^([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)

// isZodEmail mirrors zod v4's email regex (its two lookaheads checked by hand).
func isZodEmail(s string) bool {
	return !strings.HasPrefix(s, ".") && !strings.Contains(s, "..") && zodEmailRe.MatchString(s)
}

// isZodURL mirrors z.string().url(): new URL() must parse it.
func isZodURL(s string) bool {
	u, err := url.Parse(strings.TrimSpace(s))
	return err == nil && u.Scheme != "" && (u.Host != "" || u.Opaque != "")
}

var looseUUIDRe = regexp.MustCompile(`(?i)^[0-9a-f-]{36}$`)

// isLooseUUID is the `/^[0-9a-f-]{36}$/i` check several routes use.
func isLooseUUID(s string) bool { return looseUUIDRe.MatchString(s) }

// ── Request metadata ──────────────────────────────────────────────────────

// clientIP mirrors lib/security/client-ip: cf-connecting-ip (set by the
// Cloudflare edge), then the left-most x-forwarded-for, then x-real-ip.
func clientIP(h http.Header) string {
	if ip := strings.TrimSpace(h.Get("cf-connecting-ip")); ip != "" {
		return ip
	}
	if fwd := h.Get("x-forwarded-for"); fwd != "" {
		if first := strings.TrimSpace(strings.Split(fwd, ",")[0]); first != "" {
			return first
		}
	}
	if ip := strings.TrimSpace(h.Get("x-real-ip")); ip != "" {
		return ip
	}
	return "unknown"
}

// sessionCookie is the member_session cookie set by verify and register.
func sessionCookie(r *http.Request, token string, now time.Time, ttl time.Duration) *http.Cookie {
	return &http.Cookie{
		Name:     "member_session",
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl / time.Second),
		Expires:  now.Add(ttl),
		HttpOnly: true,
		Secure:   httpx.SecureRequest(r),
		SameSite: http.SameSiteLaxMode,
	}
}

// ── JSON time ─────────────────────────────────────────────────────────────

// jsTime is a nullable timestamp that serializes like JSON.stringify(Date):
// UTC with milliseconds, or null. It scans timestamptz columns.
type jsTime struct {
	Time  time.Time
	Valid bool
}

// Scan implements sql.Scanner for pgx.
func (t *jsTime) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*t = jsTime{}
	case time.Time:
		*t = jsTime{Time: v, Valid: true}
	default:
		return errors.New("jsTime: unsupported type")
	}
	return nil
}

// MarshalJSON renders 2006-01-02T15:04:05.000Z or null.
func (t jsTime) MarshalJSON() ([]byte, error) {
	if !t.Valid {
		return []byte("null"), nil
	}
	return []byte(`"` + isoString(t.Time) + `"`), nil
}

// isoString is Date.prototype.toISOString.
func isoString(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

// readRaw parses any JSON body, for routes whose fallback is
// `.catch(() => null)`. parsed is false when the body is not JSON.
func readRaw(r *http.Request) (value any, parsed bool) {
	if r.Body == nil {
		return nil, false
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return nil, false
	}
	if json.Unmarshal(raw, &value) != nil {
		return nil, false
	}
	return value, true
}
