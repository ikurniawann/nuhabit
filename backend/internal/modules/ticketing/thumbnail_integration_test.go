package ticketing

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func (f *fixture) upload(target, contentType string, data []byte, staff bool) response {
	f.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if data != nil {
		h := textproto.MIMEHeader{}
		h.Set("Content-Disposition", `form-data; name="file"; filename="thumb.png"`)
		h.Set("Content-Type", contentType)
		part, _ := mw.CreatePart(h)
		_, _ = part.Write(data)
	}
	_ = mw.Close()
	req := httptest.NewRequest("POST", target, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if staff {
		req.Header.Set("X-Test-Staff", f.staff)
	}
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	out := response{Status: rec.Code, Raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.Body)
	return out
}

func TestProductThumbnailUpload(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("STORAGE_DIR", dir)
	f := newFixture(t)
	id, _ := f.ticket("Kolam Renang", 50000, 60000)
	path := "/api/ticketing/products/" + id + "/thumbnail"
	png := append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, make([]byte, 24)...)

	f.fail(f.upload(path, "image/png", png, false), 401, "Authentication required")
	f.fail(f.call("POST", path, map[string]any{"file": "x"}), 400, "Format unggahan tidak valid")
	f.fail(f.upload("/api/ticketing/products/00000000-0000-4000-8000-000000000000/thumbnail", "image/png", png, true), 404, productNotFound)
	f.fail(f.upload(path, "image/png", nil, true), 400, "Gambar tidak ditemukan")
	f.fail(f.upload(path, "image/png", make([]byte, 3*1024*1024+1), true), 400, "Ukuran gambar maksimal 3 MB")
	f.fail(f.upload(path, "image/svg+xml", png, true), 400, "Format harus JPG, PNG, atau WEBP")

	r := f.ok(f.upload(path, "image/png", png, true))
	url, _ := r.data()["thumbnail_url"].(string)
	prefix := "/api/files/ticketing/" + f.venue.BranchID + "/"
	if r.Body["message"] != "Thumbnail tersimpan" || !strings.HasPrefix(url, prefix) || !strings.HasSuffix(url, ".png") {
		t.Fatalf("response: %s", r.Raw)
	}
	if stored := f.scalar(`SELECT thumbnail_url FROM ticketing.ticket_products WHERE id = $1`, id); stored != url {
		t.Fatalf("thumbnail_url %q, want %q", stored, url)
	}
	got, err := os.ReadFile(filepath.Join(dir, "uploads", "ticketing", f.venue.BranchID, strings.TrimPrefix(url, prefix)))
	if err != nil || !bytes.Equal(got, png) {
		t.Fatalf("stored file: %v", err)
	}
}
