package auth

import (
	"context"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"nuhabit/backend/internal/platform/database"
)

// Open API token prefixes from api-token-format.ts.
const (
	APITokenPrefix       = "nh_"
	LegacyAPITokenPrefix = "arkiv_"
)

var bearerRe = regexp.MustCompile(`(?i)^Bearer\s+(\S+)$`)

// bearerToken extracts the token of "Bearer <token>" or "".
func bearerToken(header string) string {
	m := bearerRe.FindStringSubmatch(strings.TrimSpace(header))
	if m == nil {
		return ""
	}
	return m[1]
}

// ExtractBearerToken mirrors extractBearerToken: only nh_/arkiv_ tokens count.
func ExtractBearerToken(authorization string) string {
	token := bearerToken(authorization)
	if strings.HasPrefix(token, APITokenPrefix) || strings.HasPrefix(token, LegacyAPITokenPrefix) {
		return token
	}
	return ""
}

var pathModuleMap = map[string]string{
	"pos":           "pos",
	"member-portal": "member",
	"hris":          "hris",
	"hr":            "hris",
	"payroll":       "hris",
	"inventory":     "inventory",
	"products":      "inventory",
	"warehouses":    "inventory",
	"crm":           "crm",
	"wa":            "crm",
	"settings":      "config",
	"admin":         "config",
	"iam":           "config",
	"analytics":     "reports",
	"dashboard":     "reports",
	"reports":       "reports",
}

var apiPrefixRe = regexp.MustCompile(`^/api/+`)

// ModuleForAPIPath maps the first /api/<segment> to a scope module.
func ModuleForAPIPath(pathname string) string {
	rest := apiPrefixRe.ReplaceAllString(pathname, "")
	seg := strings.ToLower(strings.SplitN(rest, "/", 2)[0])
	if m, ok := pathModuleMap[seg]; ok {
		return m
	}
	return "other"
}

// AccessForMethod is "read" for GET/HEAD/OPTIONS and "write" otherwise.
func AccessForMethod(method string) string {
	switch strings.ToUpper(method) {
	case "GET", "HEAD", "OPTIONS":
		return "read"
	}
	return "write"
}

// ScopeAllows mirrors scopeAllows: "*" passes everything, "<module>:write"
// covers read and write, "<module>:read" covers reads only, and any valid
// token may read /api/openapi.json.
func ScopeAllows(scopes []string, pathname, method string) bool {
	if contains(scopes, "*") {
		return true
	}
	access := AccessForMethod(method)
	if pathname == "/api/openapi.json" && access == "read" {
		return true
	}
	mod := ModuleForAPIPath(pathname)
	if contains(scopes, mod+":write") {
		return true
	}
	return access == "read" && contains(scopes, mod+":read")
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// loadUserByAPIToken mirrors loadUserByApiToken. It returns nil when the
// token is unknown, revoked, expired or out of scope, and also when the
// api_tokens table does not exist yet (42P01).
func (s *Service) loadUserByAPIToken(ctx context.Context, token, pathname, method string, audit bool) (*SessionUser, error) {
	var (
		id, userID, email  string
		scopes             []string
		expiresAt, revoked pgtype.Timestamptz
	)
	err := s.db.QueryRow(ctx, `SELECT t.id::text, t.user_id::text, t.scopes, t.expires_at, t.revoked_at, au.email
       FROM configuration.api_tokens t
       JOIN auth.users au ON au.id = t.user_id
       WHERE t.token_hash = $1
         AND (au.banned_until IS NULL OR au.banned_until < NOW())`, HashToken(token)).
		Scan(&id, &userID, &scopes, &expiresAt, &revoked, &email)
	if isNoRows(err) || database.IsUndefinedTable(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if revoked.Valid {
		return nil, nil
	}
	if expiresAt.Valid && !expiresAt.Time.After(s.now()) {
		return nil, nil
	}
	if scopes == nil {
		scopes = []string{}
	}
	allowed := ScopeAllows(scopes, pathname, method)
	if audit {
		s.logTokenRequest(id, pathname, method, allowed)
	}
	if !allowed {
		return nil, nil
	}
	return &SessionUser{ID: userID, Email: email, ViaAPIToken: true, APITokenID: id, APIScopes: scopes}, nil
}

// logTokenRequest is the fire-and-forget audit + last_used_at update.
func (s *Service) logTokenRequest(tokenID, pathname, method string, allowed bool) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = s.db.Exec(ctx, `INSERT INTO configuration.api_token_request_logs (token_id, method, path, allowed)
     VALUES ($1, $2, $3, $4)`, tokenID, truncate(method, 10), truncate(pathname, 500), allowed)
		_, _ = s.db.Exec(ctx, `UPDATE configuration.api_tokens SET last_used_at = now() WHERE id = $1`, tokenID)
	}()
}

// truncate cuts to n UTF-16 code units like String.prototype.slice; for the
// ASCII methods and paths this is a byte cut.
func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// VerifyAPITokenRequest mirrors verifyApiTokenRequest: the gate check that
// also writes the canonical audit row.
func (s *Service) VerifyAPITokenRequest(ctx context.Context, token, pathname, method string) (bool, error) {
	u, err := s.loadUserByAPIToken(ctx, token, pathname, method, true)
	return u != nil, err
}
