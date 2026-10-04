package collectibles

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/platform/storage"
)

func TestAvatarUpload(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("STORAGE_DIR", dir)
	f := setup(t)
	const path = "/api/crm/avatars/upload"
	img := crmtest.PNG(t)

	code, body := crmtest.Upload(t, f.mux, path, "a.png", "image/png", img, nil)
	expect(t, code, body, 401, "")
	code, body = crmtest.Upload(t, f.mux, path, "a.png", "image/png", img, &f.reports)
	expect(t, code, body, 403, "")

	// request.formData() failing, a missing part and an empty file all ask for a file.
	code, body = f.call("POST", path, map[string]any{"file": "x"}, &f.settings)
	expect(t, code, body, 400, "Pilih file gambar dulu")
	code, body = crmtest.Upload(t, f.mux, path, "", "", nil, &f.settings)
	expect(t, code, body, 400, "Pilih file gambar dulu")
	code, body = crmtest.Upload(t, f.mux, path, "a.png", "image/png", nil, &f.settings)
	expect(t, code, body, 400, "Pilih file gambar dulu")
	// The bytes decide the type, not the claimed MIME.
	code, body = crmtest.Upload(t, f.mux, path, "a.png", "image/png", []byte("<svg onload=alert(1)>"), &f.settings)
	expect(t, code, body, 400, "File harus gambar JPG/PNG/WebP")
	big := append(append([]byte{}, img...), make([]byte, 5*1024*1024)...)
	code, body = crmtest.Upload(t, f.mux, path, "a.png", "image/png", big, &f.settings)
	expect(t, code, body, 400, "Gambar maksimal 5 MB")

	// A traversal file name only feeds the extension; the file lands in the bucket.
	code, body = crmtest.Upload(t, f.mux, path, "../../../evil.png", "image/png", img, &f.settings)
	expect(t, code, body, 200, "")
	url, _ := data(t, body)["url"].(string)
	if !strings.HasPrefix(url, "/api/files/crm-avatars/") || !strings.HasSuffix(url, ".png") || strings.Contains(url, "..") {
		t.Fatalf("url %q", url)
	}
	abs, ok := storage.New(dir).UploadPath(url)
	if !ok || filepath.Dir(abs) != filepath.Join(dir, "uploads", "crm-avatars") {
		t.Fatalf("stored at %q (%v)", abs, ok)
	}
	got, err := os.ReadFile(abs)
	if err != nil || !bytes.Equal(got, img) {
		t.Fatalf("read back: %v", err)
	}
}
