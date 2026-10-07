package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Member portal session constants from member-portal/session.ts.
const (
	MemberSessionCookie = "member_session"
	MemberSessionTTL    = 30 * 24 * time.Hour
)

// MemberSession mirrors MemberSession in session.ts.
type MemberSession struct {
	CustomerID string
	SessionID  string
}

// BearerTokenFromAuthHeader mirrors bearerTokenFromAuthHeader (any token,
// unlike ExtractBearerToken which only accepts Open API prefixes).
func BearerTokenFromAuthHeader(header string) string { return bearerToken(header) }

// memberSessionToken mirrors resolveSessionToken: Bearer first, then cookie.
func memberSessionToken(r *http.Request) string {
	if t := BearerTokenFromAuthHeader(r.Header.Get("Authorization")); t != "" {
		return t
	}
	if c, err := r.Cookie(MemberSessionCookie); err == nil {
		return c.Value
	}
	return ""
}

// MemberSessionFromRequest mirrors getMemberSession: it touches
// last_seen_at and returns nil when the token is missing or expired.
func (s *Service) MemberSessionFromRequest(r *http.Request) (*MemberSession, error) {
	token := memberSessionToken(r)
	if token == "" {
		return nil, nil
	}
	var m MemberSession
	err := s.db.QueryRow(r.Context(), `UPDATE crm.member_portal_sessions
     SET last_seen_at = now()
     WHERE token_hash = $1 AND expires_at > now()
     RETURNING id::text, customer_id::text`, HashToken(token)).Scan(&m.SessionID, &m.CustomerID)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// RequireMember returns the customer id of the member session or a 401
// {"success":false,"error":"Unauthorized"}, as withMemberSession does.
func (s *Service) RequireMember(r *http.Request) (string, error) {
	m, err := s.MemberSessionFromRequest(r)
	if err != nil {
		return "", err
	}
	if m == nil {
		return "", httpx.Unauthorized("Unauthorized")
	}
	return m.CustomerID, nil
}

// MemberHandler mirrors withMemberSession(failMessage, handler): 401
// "Unauthorized" without a session; a returned *httpx.Error renders as is
// (the TS handlers return memberError responses); any other error, including
// a failed session lookup, is logged and renders as 500 with failMessage.
func (s *Service) MemberHandler(failMessage string, h func(w http.ResponseWriter, r *http.Request, customerID string) error) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := func() error {
			customerID, err := s.RequireMember(r)
			if err != nil {
				return err
			}
			return h(w, r, customerID)
		}()
		if err == nil {
			return
		}
		var appErr *httpx.Error
		if errors.As(err, &appErr) {
			httpx.WriteError(w, r, appErr)
			return
		}
		s.log.ErrorContext(r.Context(), "[member-portal] "+failMessage, "error", err, "request_id", httpx.RequestID(r.Context()))
		httpx.WriteError(w, r, httpx.Status(http.StatusInternalServerError, failMessage))
	})
}

// CreateMemberSession mirrors createMemberSession: a random 32-byte hex
// token whose hash is stored for 30 days. q is the pool or an open tx.
func (s *Service) CreateMemberSession(ctx context.Context, q database.Querier, customerID string) (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b[:])
	_, err := q.Exec(ctx, `INSERT INTO crm.member_portal_sessions (token_hash, customer_id, expires_at)
     VALUES ($1, $2, $3)`, HashToken(token), customerID, s.now().Add(MemberSessionTTL))
	if err != nil {
		return "", err
	}
	return token, nil
}

// DestroyMemberSession mirrors destroyMemberSession.
func (s *Service) DestroyMemberSession(r *http.Request) error {
	token := memberSessionToken(r)
	if token == "" {
		return nil
	}
	_, err := s.db.Exec(r.Context(), `DELETE FROM crm.member_portal_sessions WHERE token_hash = $1`, HashToken(token))
	return err
}

// IsLocalDatabase mirrors isLocalDatabase: the URL host is localhost or
// 127.0.0.1.
func IsLocalDatabase(databaseURL string) bool {
	u, err := url.Parse(databaseURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "localhost" || host == "127.0.0.1"
}

// MemberOTPDevCode mirrors memberOtpDevCode: the bypass code, or "" unless
// all three guards pass (not production, MEMBER_OTP_DEV_CODE set, local DB).
func (s *Service) MemberOTPDevCode() string {
	if s.production || os.Getenv("NODE_ENV") == "production" {
		return ""
	}
	code := strings.TrimSpace(os.Getenv("MEMBER_OTP_DEV_CODE"))
	if code == "" || !IsLocalDatabase(s.databaseURL) {
		return ""
	}
	return code
}

// CanBypassOTP mirrors canBypassOtp: with the bypass active an empty code or
// the dev code passes.
func (s *Service) CanBypassOTP(code string) bool {
	dev := s.MemberOTPDevCode()
	if dev == "" {
		return false
	}
	return code == "" || code == dev
}
