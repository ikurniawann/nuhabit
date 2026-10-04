package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
)

// Cookie names and TTL from frontend/src/lib/auth/constants.ts.
const (
	SessionCookie       = "nuhabit_session"
	LegacySessionCookie = "arkiv_session"
	SessionTTLDays      = 14
)

// HashToken is the SHA-256 hex digest the session, API token and member
// session tables store instead of the raw token.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// ReadSessionToken mirrors readSessionToken: the new cookie first, then the
// legacy one. Empty values count as absent.
func ReadSessionToken(r *http.Request) string {
	for _, name := range []string{SessionCookie, LegacySessionCookie} {
		if c, err := r.Cookie(name); err == nil && c.Value != "" {
			return c.Value
		}
	}
	return ""
}

// SessionUser is SessionUser from session.ts, reduced to what Go reads: the
// auth.users identity behind a session cookie or Open API token, before any
// configuration.users profile lookup.
type SessionUser struct {
	ID          string
	Email       string
	ViaAPIToken bool
	APITokenID  string
	APIScopes   []string
}

// liveSession is the FROM/WHERE shared by the session lookups: the token
// exists, has not expired, and its user is not banned.
const liveSession = `
     FROM auth.sessions s
     JOIN auth.users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()
       AND (u.banned_until IS NULL OR u.banned_until < NOW())`

func (s *Service) loadUserBySessionToken(ctx context.Context, token string) (*SessionUser, error) {
	var u SessionUser
	err := s.db.QueryRow(ctx, `SELECT u.id::text, u.email`+liveSession, HashToken(token)).Scan(&u.ID, &u.Email)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// SessionTokenIsValid mirrors sessionTokenIsValid (the proxy gate check).
func (s *Service) SessionTokenIsValid(ctx context.Context, token string) (bool, error) {
	var one int
	err := s.db.QueryRow(ctx, `SELECT 1 AS one`+liveSession, HashToken(token)).Scan(&one)
	if isNoRows(err) {
		return false, nil
	}
	return err == nil, err
}

// Session mirrors getSessionUserFromCookies for routes that read the
// session without the ApiUser profile (e.g. GET /api/auth/me). nil, nil
// means no session.
func (s *Service) Session(r *http.Request) (*SessionUser, error) { return s.sessionUserFromRequest(r) }

// sessionUserFromRequest mirrors getSessionUserFromRequest /
// getSessionUserFromCookies: a session cookie wins (even when it is stale,
// there is no fallback); without one an Open API Bearer token is tried with
// the request path and method for the scope check.
func (s *Service) sessionUserFromRequest(r *http.Request) (*SessionUser, error) {
	if token := ReadSessionToken(r); token != "" {
		return s.loadUserBySessionToken(r.Context(), token)
	}
	bearer := ExtractBearerToken(r.Header.Get("Authorization"))
	if bearer == "" {
		return nil, nil
	}
	return s.loadUserByAPIToken(r.Context(), bearer, r.URL.Path, r.Method, false)
}
