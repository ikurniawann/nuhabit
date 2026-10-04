package httpx

import (
	"net/http"
	"regexp"
	"strings"
)

var ipv4Literal = regexp.MustCompile(`^\d{1,3}(\.\d{1,3}){3}$`)

// SecureRequest is lib/auth/secure-cookie.ts: whether cookies get the Secure
// flag. X-Forwarded-Proto https wins; otherwise only localhost and IP
// literals count as plain HTTP, because a domain reaches the app only
// through the TLS tunnel. The TS reads the Host Next received; behind the
// Next proxy that host arrives in X-Forwarded-Host, so it is read first.
func SecureRequest(r *http.Request) bool {
	proto := strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]
	if strings.ToLower(strings.TrimSpace(proto)) == "https" {
		return true
	}
	host := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0])
	if host == "" {
		host = r.Host
	}
	hostname := strings.ToLower(strings.Split(host, ":")[0])
	direct := hostname == "localhost" || hostname == "::1" || ipv4Literal.MatchString(hostname) || strings.HasPrefix(hostname, "[")
	return !direct
}
