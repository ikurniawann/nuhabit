package files

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/testutil"
)

// fixture mounts the module on a temporary storage root holding the
// files of the TS route test plus extra.
func fixture(t *testing.T, a *auth.Service, extra ...string) http.Handler {
	t.Helper()
	root := t.TempDir()
	files := append([]string{"products/p.png", "cv/candidates/cv.pdf", "member-photos/cust-1/m.png", "products/page.html"}, extra...)
	for _, f := range files {
		abs := filepath.Join(root, "uploads", f)
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte("0123456789"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return testutil.Mux(mod{auth: a, store: storage.New(root)})
}

func get(t *testing.T, h http.Handler, target string, edit func(*http.Request)) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, target, nil)
	if edit != nil {
		edit(r)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func TestServeWithoutSession(t *testing.T) {
	h := fixture(t, auth.NewService(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), nil))

	rec := get(t, h, "/api/files/products/p.png", nil)
	if rec.Code != 200 || rec.Body.String() != "0123456789" || rec.Header().Get("Cache-Control") != "public, max-age=86400" ||
		rec.Header().Get("Content-Type") != "image/png" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("public file: %d %q %v", rec.Code, rec.Body.String(), rec.Header())
	}

	rec = get(t, h, "/api/files/products/p.png", func(r *http.Request) { r.Header.Set("Range", "bytes=2-4") })
	if rec.Code != 206 || rec.Body.String() != "234" || rec.Header().Get("Content-Range") != "bytes 2-4/10" {
		t.Fatalf("range: %d %q %v", rec.Code, rec.Body.String(), rec.Header())
	}

	rec = get(t, h, "/api/files/products/page.html", nil)
	if rec.Header().Get("Content-Type") != "application/octet-stream" || rec.Header().Get("Content-Disposition") != "attachment" {
		t.Fatalf("html must download: %v", rec.Header())
	}

	cases := []struct {
		target string
		status int
		body   string
	}{
		{"/api/files/cv/candidates/cv.pdf", 401, `{"error":"Unauthorized"}`},
		{"/api/files/member-photos/cust-1/m.png", 401, `{"error":"Unauthorized"}`},
		{"/api/files/rahasia/a.pdf", 401, `{"error":"Unauthorized"}`},
		{"/api/files/products/missing.png", 404, `{"error":"File not found"}`},
		{"/api/files/products/..%2F..%2Fetc", 404, `{"error":"File not found"}`},
		{"/api/files/products/%252e%252e/x", 404, `{"error":"File not found"}`},
		{"/api/files/products/.env", 404, `{"error":"File not found"}`},
		{"/api/files/products/", 404, `{"error":"File not found"}`},
		{"/api/files/products/%C3%28.png", 404, `{"error":"File not found"}`},
	}
	for _, c := range cases {
		rec := get(t, h, c.target, nil)
		if rec.Code != c.status || rec.Body.String() != c.body {
			t.Errorf("%s: %d %q, want %d %q", c.target, rec.Code, rec.Body.String(), c.status, c.body)
		}
	}
}

func TestRouteParams(t *testing.T) {
	bucket, segs, ok := routeParams("/api/files/member-photos/cust-1/a%20b.png")
	if !ok || bucket != "member-photos" || len(segs) != 2 || segs[0] != "cust-1" || segs[1] != "a b.png" {
		t.Fatalf("%v %q %q", ok, bucket, segs)
	}
	// One decode only: %252F stays %2F for SafeSegments to decode and reject.
	if _, segs, _ := routeParams("/api/files/x/a%252Fb"); segs[0] != "a%2Fb" {
		t.Fatalf("decoded twice: %q", segs)
	}
}
