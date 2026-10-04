package memberportal

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"nuhabit/backend/internal/platform/safehttp"
	"nuhabit/backend/internal/platform/testutil"
)

// Push endpoints come from members' browsers: the sender must not reach
// the server's own network.
func TestIntegrationPushRefusesInternalEndpoints(t *testing.T) {
	hit := false
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hit = true }))
	defer srv.Close()
	m := New(testutil.Deps(t, nil), Options{})
	resp, err := m.handler.svc.pusher.(*webPusher).client.Post(srv.URL, "application/octet-stream", nil)
	if err == nil {
		resp.Body.Close()
	}
	if !errors.Is(err, safehttp.ErrBlocked) || hit {
		t.Fatalf("loopback endpoint: err=%v hit=%v", err, hit)
	}
}
