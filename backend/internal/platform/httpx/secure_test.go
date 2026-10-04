package httpx

import (
	"net/http/httptest"
	"testing"
)

func TestSecureRequest(t *testing.T) {
	cases := []struct {
		host, fwdHost, fwdProto string
		want                    bool
	}{
		{"app.nuhabit.id", "", "", true},
		{"localhost:3000", "", "", false},
		{"192.168.1.20:3000", "", "", false},
		{"[::1]:3000", "", "", false},
		{"192.168.1.20:3000", "", "https", true},
		// Behind the Next proxy: Go sees its own host; the browser's is forwarded.
		{"arkiv-api:8080", "192.168.1.20:3000", "http", false},
		{"arkiv-api:8080", "app.nuhabit.id", "http", true},
	}
	for _, c := range cases {
		r := httptest.NewRequest("GET", "/", nil)
		r.Host = c.host
		if c.fwdHost != "" {
			r.Header.Set("X-Forwarded-Host", c.fwdHost)
		}
		if c.fwdProto != "" {
			r.Header.Set("X-Forwarded-Proto", c.fwdProto)
		}
		if got := SecureRequest(r); got != c.want {
			t.Errorf("host=%s fwd=%s proto=%s: %v, want %v", c.host, c.fwdHost, c.fwdProto, got, c.want)
		}
	}
}
