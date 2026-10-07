// Package crmtest holds integration-test helpers shared by the CRM areas.
// Everything skips without TEST_DATABASE_URL (via testutil).
package crmtest

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// Mux mounts routes on a fresh ServeMux.
func Mux(routes []module.Route) *http.ServeMux {
	mux := http.NewServeMux()
	for _, r := range routes {
		mux.Handle(r.Pattern, r.Handler)
	}
	return mux
}

// Staff creates a staff user granted the given menu codes (all actions).
func Staff(t testing.TB, menus ...string) testutil.Staff {
	t.Helper()
	grants := map[string][]string{}
	for _, m := range menus {
		grants[m] = []string{"read", "create", "update", "delete", "approve"}
	}
	return testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", Menus: grants})
}

// Call serves one request (as staff when s is non-nil) and returns the
// status and the decoded JSON object (nil for non-object bodies).
func Call(t testing.TB, h http.Handler, method, path string, body any, s *testutil.Staff) (int, map[string]any) {
	t.Helper()
	r := testutil.Request(method, path, body)
	if s != nil {
		r = testutil.AsStaff(r, *s)
	}
	rec, out := testutil.Do(t, h, r)
	return rec.Code, out
}

// Scalar reads one value from tx and fails the test on error.
func Scalar[T any](t testing.TB, tx pgx.Tx, sql string, args ...any) T {
	t.Helper()
	var v T
	if err := tx.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("crmtest: %s: %v", sql, err)
	}
	return v
}

// MustExec runs a fixture statement on tx and fails the test on error.
func MustExec(t testing.TB, tx pgx.Tx, sql string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("crmtest: %s: %v", sql, err)
	}
}

// Upload posts data as the multipart file part "file" (the part is left out
// when fileName is "") and returns the status and decoded JSON object.
func Upload(t testing.TB, h http.Handler, path, fileName, contentType string, data []byte, s *testutil.Staff) (int, map[string]any) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if fileName != "" {
		hdr := textproto.MIMEHeader{}
		hdr.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, fileName))
		hdr.Set("Content-Type", contentType)
		part, err := mw.CreatePart(hdr)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = part.Write(data)
	}
	_ = mw.Close()
	r := httptest.NewRequest(http.MethodPost, path, &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	if s != nil {
		r = testutil.AsStaff(r, *s)
	}
	rec, out := testutil.Do(t, h, r)
	return rec.Code, out
}

// PNG is a real 2x2 PNG image.
func PNG(t testing.TB) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
