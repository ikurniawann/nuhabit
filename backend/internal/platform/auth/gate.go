package auth

import (
	"net/http"
	"strings"

	"nuhabit/backend/internal/platform/httpx"
)

// PublicAuthPrefixes mirrors PUBLIC_AUTH_PREFIXES in
// frontend/src/lib/auth/middleware.ts (a test fails when they drift).
var PublicAuthPrefixes = []string{
	"/brand/",
	"/manifest-pos.webmanifest",
	"/sw.js",
	"/products/",
	"/qris/",
	"/arkiv-os",
	"/qa",
	"/login",
	"/portal",
	"/career",
	"/table-order",
	"/photobooth",
	"/api/job-openings/public",
	"/api/portal",
	"/psikotes",
	"/api/psikotes/session",
	"/interview",
	"/api/interview/session",
	"/offer",
	"/api/offer/session",
	"/api/table-order",
	"/api/integrations/gobiz/webhook/",
	"/api/public/gofood-image/",
	"/api/integrations/telegram/webhook/",
	"/api/integrations/loyalty-events/",
	"/api/auth/login",
	"/api/auth/logout",
	"/api/settings/appearance",
	"/api/desktop/wallpapers",
	"/api/files",
	"/member",
	"/api/member-portal",
	"/share",
	"/api/share",
	"/api/wa/inbound",
	"/api/crm/instagram/webhook",
	"/api/payments/xendit/webhook",
	"/booking",
	"/api/public/booking",
	"/pass",
	"/shop",
	"/api/public/shop",
	"/wholesale",
	"/api/wholesale",
	"/public",
	"/api/public/crm/forms",
	"/api/health",
	"/api/ready",
}

// IsPublicAuthPath mirrors isPublicAuthPath for the paths the Go service
// serves (plain prefix match, as in TS).
func IsPublicAuthPath(pathname string) bool {
	if pathname == "/" {
		return true
	}
	for _, p := range PublicAuthPrefixes {
		if strings.HasPrefix(pathname, p) {
			return true
		}
	}
	return false
}

// Gate reproduces the API half of updateSession (the Next proxy gate),
// because requests proxied to Go skip it:
//
//   - a session cookie is validated against auth.sessions; a DB failure on
//     an /api path is fail-closed (503 "Layanan sedang tidak tersedia, coba lagi");
//   - without a valid session, an nh_/arkiv_ Bearer token is verified with
//     its scope and audited; a rejected token is 401 "Token tidak valid atau
//     scope tidak mengizinkan" even on public paths;
//   - otherwise non-public /api paths get 401 "Authentication required".
//
// Non-/api paths pass through untouched.
func (s *Service) Gate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pathname := r.URL.Path
		if !strings.HasPrefix(pathname, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		validation := "invalid"
		if token := ReadSessionToken(r); token != "" {
			ok, err := s.SessionTokenIsValid(r.Context(), token)
			switch {
			case err != nil:
				s.log.ErrorContext(r.Context(), "[middleware] validasi sesi gagal", "error", err)
				validation = "db-error"
			case ok:
				validation = "valid"
			}
		}
		// API paths never fail open on a DB error.
		hasSession := validation == "valid"

		hasAPIBearer := false
		if bearer := ExtractBearerToken(r.Header.Get("Authorization")); bearer != "" && !hasSession {
			ok, err := s.VerifyAPITokenRequest(r.Context(), bearer, pathname, r.Method)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			if !ok {
				httpx.WriteError(w, r, httpx.Unauthorized("Token tidak valid atau scope tidak mengizinkan"))
				return
			}
			hasAPIBearer = true
		}

		if !hasSession && !hasAPIBearer && !IsPublicAuthPath(pathname) {
			if validation == "db-error" {
				httpx.WriteError(w, r, httpx.Status(http.StatusServiceUnavailable, "Layanan sedang tidak tersedia, coba lagi"))
				return
			}
			httpx.WriteError(w, r, httpx.Unauthorized("Authentication required"))
			return
		}
		next.ServeHTTP(w, r)
	})
}
