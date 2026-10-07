package memberportal

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

func photoRequest(t *testing.T, contentType string, data []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if data != nil {
		h := textproto.MIMEHeader{}
		h.Set("Content-Disposition", `form-data; name="file"; filename="me.jpg"`)
		h.Set("Content-Type", contentType)
		part, _ := mw.CreatePart(h)
		_, _ = part.Write(data)
	}
	_ = mw.Close()
	r := httptest.NewRequest(http.MethodPost, "/api/member-portal/profile/photo", &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	return r
}

func TestIntegrationProfilePhoto(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("STORAGE_DIR", dir)
	h := newHarness(t)
	m := newMember(t)
	jpeg := append([]byte{0xff, 0xd8, 0xff, 0xe0}, make([]byte, 64)...)

	expect := func(r *http.Request, status int, msg string) {
		t.Helper()
		code, body, _ := h.do(r)
		if code != status || body["error"] != msg {
			t.Fatalf("got %d %v, want %d %q", code, body, status, msg)
		}
	}
	expect(photoRequest(t, "image/jpeg", jpeg), 401, "Unauthorized")
	plain := httptest.NewRequest(http.MethodPost, "/api/member-portal/profile/photo", strings.NewReader("{}"))
	plain.Header.Set("Content-Type", "application/json")
	expect(testutil.AsMember(plain, m), 400, "Format unggahan tidak valid")
	expect(testutil.AsMember(photoRequest(t, "image/jpeg", nil), m), 400, "Foto tidak ditemukan")
	expect(testutil.AsMember(photoRequest(t, "image/jpeg", make([]byte, 5*1024*1024+1)), m), 400, "Ukuran foto maksimal 5 MB")
	expect(testutil.AsMember(photoRequest(t, "application/pdf", jpeg), m), 400, "Format harus JPG, PNG, atau WEBP")

	code, body, _ := h.do(testutil.AsMember(photoRequest(t, "image/jpeg", jpeg), m))
	data, _ := body["data"].(map[string]any)
	url, _ := data["photo_url"].(string)
	prefix := "/api/files/member-photos/" + m.CustomerID + "/"
	if code != 200 || body["success"] != true || !strings.HasPrefix(url, prefix) || !strings.HasSuffix(url, ".jpg") {
		t.Fatalf("upload: %d %v", code, body)
	}
	var stored string
	if err := testutil.DB(t).QueryRow(context.Background(), `SELECT photo_url FROM pos.pos_customers WHERE id = $1`, m.CustomerID).Scan(&stored); err != nil || stored != url {
		t.Fatalf("photo_url %q (%v), want %q", stored, err, url)
	}
	got, err := os.ReadFile(filepath.Join(dir, "uploads", "member-photos", m.CustomerID, strings.TrimPrefix(url, prefix)))
	if err != nil || !bytes.Equal(got, jpeg) {
		t.Fatalf("stored file: %v", err)
	}
}
