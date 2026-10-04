package engagement

import (
	"bytes"
	"os"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/platform/storage"
)

func TestAnnouncementImageUpload(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("STORAGE_DIR", dir)
	e := setup(t)
	const path = "/api/crm/engagement/announcements/image"
	img := crmtest.PNG(t)

	if code, _ := crmtest.Upload(t, e.mux, path, "a.png", "image/png", img, nil); code != 401 {
		t.Fatalf("anon: %d", code)
	}
	// CRM settings access is not enough: the gate is the Engagement menu.
	settings := crmtest.Staff(t, "crm.settings")
	if code, _ := crmtest.Upload(t, e.mux, path, "a.png", "image/png", img, &settings); code != 403 {
		t.Fatalf("settings only: %d", code)
	}
	code, body := crmtest.Upload(t, e.mux, path, "a.jpg", "image/jpeg", []byte("not an image"), &e.staff)
	if code != 400 || body["error"] != "File harus gambar JPG/PNG/WebP" {
		t.Fatalf("text: %d %v", code, body)
	}

	code, body = crmtest.Upload(t, e.mux, path, "banner.png", "image/png", img, &e.staff)
	data, _ := body["data"].(map[string]any)
	url, _ := data["url"].(string)
	if code != 200 || body["success"] != true || !strings.HasPrefix(url, "/api/files/crm-announcements/") {
		t.Fatalf("upload: %d %v", code, body)
	}
	abs, ok := storage.New(dir).UploadPath(url)
	got, err := os.ReadFile(abs)
	if !ok || err != nil || !bytes.Equal(got, img) {
		t.Fatalf("read back %q: %v", abs, err)
	}
}
