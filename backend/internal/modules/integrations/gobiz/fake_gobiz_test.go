package gobiz

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// fakeGobiz is an httptest GoBiz: /oauth2/token issues tokens, every other
// path answers with the queued status/body (200 {"success":true} by default)
// and is recorded.
type fakeGobiz struct {
	*httptest.Server
	mu     sync.Mutex
	tokens int
	reply  func(path string) (int, string)
	calls  []call
}

type call struct {
	Method, Path, Auth, ContentType, Body string
}

func newFakeGobiz(t *testing.T) *fakeGobiz {
	f := &fakeGobiz{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		defer f.mu.Unlock()
		status, out := 200, `{"success":true,"data":{}}`
		if r.URL.Path == "/oauth2/token" {
			f.tokens++
			out = `{"access_token":"T` + string(rune('0'+f.tokens)) + `","expires_in":3599}`
		} else if f.reply != nil {
			status, out = f.reply(r.URL.Path)
		}
		f.calls = append(f.calls, call{r.Method, r.URL.EscapedPath(), r.Header.Get("Authorization"), r.Header.Get("Content-Type"), string(body)})
		w.WriteHeader(status)
		_, _ = io.WriteString(w, out)
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeGobiz) apiCalls() []call {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []call
	for _, c := range f.calls {
		if c.Path != "/oauth2/token" {
			out = append(out, c)
		}
	}
	return out
}
