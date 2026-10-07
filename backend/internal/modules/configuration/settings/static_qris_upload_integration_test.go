package settings_test

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/configuration/settings"
	"nuhabit/backend/internal/platform/testutil"
)

// send serves a prepared request in a savepoint, like env.do.
func (e *env) send(s *testutil.Staff, r *http.Request) resp {
	e.t.Helper()
	ctx := context.Background()
	sp, err := e.tx.Begin(ctx)
	if err != nil {
		e.t.Fatal(err)
	}
	if s != nil {
		r = testutil.AsStaff(r, *s)
	}
	rec, _ := testutil.Do(e.t, testutil.Mux(mod(settings.Routes(e.deps, sp, e.ports))), r)
	if rec.Code >= 400 {
		err = sp.Rollback(ctx)
	} else {
		err = sp.Commit(ctx)
	}
	if err != nil {
		e.t.Fatal(err)
	}
	return resp{rec.Code, rec.Body.String()}
}

func qrisUpload(name string, data []byte) *http.Request {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if data != nil {
		part, _ := mw.CreateFormFile("file", name)
		_, _ = part.Write(data)
	}
	_ = mw.Close()
	r := httptest.NewRequest(http.MethodPost, "/api/settings/static-qris", &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	return r
}

func TestStaticQrisUploadAndDelete(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("STORAGE_DIR", dir)
	admin := staff(t, "settings.payment-gateways")
	other := staff(t, "settings.business")
	e := newEnv(t)
	png := append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, make([]byte, 16)...)
	bucket := filepath.Join(dir, "uploads", "payment-qris")

	expect(t, e.send(nil, qrisUpload("qris.png", png)), 401, unauthorized)
	expect(t, e.send(&other, qrisUpload("qris.png", png)), 403, forbidden)
	expect(t, e.send(&admin, qrisUpload("qris.png", nil)), 400, `{"success":false,"error":"Pilih file gambar QRIS dulu"}`)
	expect(t, e.send(&admin, httptest.NewRequest(http.MethodPost, "/api/settings/static-qris", strings.NewReader("x"))), 400,
		`{"success":false,"error":"Pilih file gambar QRIS dulu"}`)
	expect(t, e.send(&admin, qrisUpload("qris.png", make([]byte, 5*1024*1024+1))), 400, `{"success":false,"error":"Gambar QRIS maksimal 5 MB"}`)
	expect(t, e.send(&admin, qrisUpload("qris.svg", []byte("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))), 400,
		`{"success":false,"error":"File harus gambar JPG/PNG/WebP"}`)

	// The first upload stores the URL and switches the QRIS on.
	r := e.send(&admin, qrisUpload("qris.png", png))
	first := e.text(`SELECT value FROM configuration.app_settings WHERE key = 'static_qris_image_url'`)
	expect(t, r, 200, `{"success":true,"data":{"enabled":true,"imageUrl":"`+first+`","available":true}}`)
	if !strings.HasPrefix(first, "/api/files/payment-qris/") || !strings.HasSuffix(first, ".png") {
		t.Fatalf("url %s", first)
	}
	if got, err := os.ReadFile(filepath.Join(bucket, strings.TrimPrefix(first, "/api/files/payment-qris/"))); err != nil || !bytes.Equal(got, png) {
		t.Fatalf("stored file: %v", err)
	}

	// A switched-off QRIS stays off on replace; the old file is removed.
	expect(t, e.do(&admin, "PUT", "/api/settings/static-qris", map[string]any{"enabled": false}), 200, "")
	r = e.send(&admin, qrisUpload("qris.png", png))
	second := e.text(`SELECT value FROM configuration.app_settings WHERE key = 'static_qris_image_url'`)
	expect(t, r, 200, `{"success":true,"data":{"enabled":false,"imageUrl":"`+second+`","available":false}}`)
	if entries, _ := os.ReadDir(bucket); len(entries) != 1 || "/api/files/payment-qris/"+entries[0].Name() != second {
		t.Fatalf("bucket after replace: %v", entries)
	}

	expect(t, e.send(&other, httptest.NewRequest(http.MethodDelete, "/api/settings/static-qris", nil)), 403, forbidden)
	expect(t, e.do(&admin, "DELETE", "/api/settings/static-qris", nil), 200,
		`{"success":true,"data":{"enabled":false,"imageUrl":null,"available":false}}`)
	if entries, _ := os.ReadDir(bucket); len(entries) != 0 {
		t.Fatalf("bucket after delete: %v", entries)
	}
	if got := e.text(`SELECT COALESCE(value, 'NULL') FROM configuration.app_settings WHERE key = 'static_qris_image_url'`); got != "NULL" {
		t.Fatalf("image setting %s", got)
	}
}
