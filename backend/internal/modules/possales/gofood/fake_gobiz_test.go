package gofood

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"nuhabit/backend/internal/platform/gobiz"
)

// fakeGobiz is an httptest GoBiz: /oauth issues tokens, everything else goes
// to api. It records each request.
type fakeGobiz struct {
	*httptest.Server
	mu       sync.Mutex
	api      func(r *http.Request, body string) (int, string)
	requests []seenRequest
}

type seenRequest struct{ Path, Body string }

func newFakeGobiz(t *testing.T) *fakeGobiz {
	f := &fakeGobiz{api: func(*http.Request, string) (int, string) { return 200, `{"success":true,"data":{}}` }}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		defer f.mu.Unlock()
		f.requests = append(f.requests, seenRequest{r.URL.EscapedPath(), string(raw)})
		status, body := 200, `{"access_token":"T","expires_in":3599}`
		if r.URL.Path != "/oauth" {
			status, body = f.api(r, string(raw))
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeGobiz) config() gobiz.Config {
	return gobiz.Config{
		Enabled: true, Environment: gobiz.Sandbox, ClientID: "cid", ClientSecret: "sec", OutletID: "G123",
		APIBase: f.URL, OAuthURL: f.URL + "/oauth",
	}
}

func (f *fakeGobiz) last() seenRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.requests[len(f.requests)-1]
}
