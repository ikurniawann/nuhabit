package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

type wallpaperMod struct{ handlers }

func (wallpaperMod) Name() string { return Name }

func wallpaperUpload(name, fileName string, data []byte) *http.Request {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if name != "" {
		_ = mw.WriteField("name", name)
	}
	if data != nil {
		part, _ := mw.CreateFormFile("file", fileName)
		_, _ = part.Write(data)
	}
	_ = mw.Close()
	r := httptest.NewRequest(http.MethodPost, "/api/desktop/wallpapers", &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	return r
}

func TestWallpaperUploadAndDelete(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("STORAGE_DIR", dir)
	admin := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", Menus: map[string][]string{"settings.appearance": nil}})
	cashier := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos": nil}})
	deps := testutil.Deps(t, func() time.Time { return time.Date(2026, 10, 5, 3, 0, 0, 0, time.UTC) })
	tx := testutil.Tx(t)
	ctx := context.Background()
	if _, err := tx.Exec(ctx, `DELETE FROM configuration.app_settings WHERE key = 'desktop_wallpapers'`); err != nil {
		t.Fatal(err)
	}
	repo := NewPostgres(tx)
	mux := testutil.Mux(wallpaperMod{handlers{svc: NewService(repo, deps.Auth, deps.Log, deps.Now), settings: repo}})
	png := append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, make([]byte, 16)...)

	call := func(r *http.Request, s *testutil.Staff, status int, raw string) map[string]any {
		t.Helper()
		if s != nil {
			r = testutil.AsStaff(r, *s)
		}
		rec, body := testutil.Do(t, mux, r)
		if rec.Code != status || (raw != "" && rec.Body.String() != raw) {
			t.Fatalf("%s %s: %d %s, want %d %s", r.Method, r.URL, rec.Code, rec.Body.String(), status, raw)
		}
		return body
	}

	call(wallpaperUpload("", "a.png", png), nil, 401, `{"success":false,"error":"Authentication required"}`)
	call(wallpaperUpload("", "a.png", png), &cashier, 403, `{"success":false,"error":"Insufficient permissions"}`)
	call(wallpaperUpload("", "a.png", nil), &admin, 400, `{"success":false,"error":"Pilih file gambar dulu"}`)
	call(wallpaperUpload("", "a.png", make([]byte, 8*1024*1024+1)), &admin, 400, `{"success":false,"error":"Gambar maksimal 8 MB"}`)
	call(wallpaperUpload("", "a.html", []byte("<html><body>hi</body></html>")), &admin, 400, `{"success":false,"error":"File harus gambar JPG/PNG/WebP"}`)

	body := call(wallpaperUpload("", "pantai_senja-01.png", png), &admin, 200, "")
	saved, _ := body["data"].(map[string]any)
	id, _ := saved["id"].(string)
	src, _ := saved["src"].(string)
	if !strings.HasPrefix(id, "wp-") || saved["name"] != "pantai senja 01" || saved["created_by"] != admin.UserID ||
		saved["created_at"] != "2026-10-05T03:00:00.000Z" || !strings.HasPrefix(src, "/api/files/desktop-wallpapers/") {
		t.Fatalf("saved: %v", saved)
	}
	file := filepath.Join(dir, "uploads", "desktop-wallpapers", strings.TrimPrefix(src, "/api/files/desktop-wallpapers/"))
	if got, err := os.ReadFile(file); err != nil || !bytes.Equal(got, png) {
		t.Fatalf("stored file: %v", err)
	}
	second := call(wallpaperUpload("  Kantor  ", "x.png", png), &admin, 200, "")["data"].(map[string]any)

	// The setting holds the newest first, in the TS key order; GET lists it.
	var stored string
	if err := tx.QueryRow(ctx, `SELECT value FROM configuration.app_settings WHERE key = 'desktop_wallpapers'`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	var list []map[string]any
	_ = json.Unmarshal([]byte(stored), &list)
	if len(list) != 2 || list[0]["name"] != "Kantor" || list[1]["id"] != id || !strings.HasPrefix(stored, `[{"id":"`+second["id"].(string)+`","name":"Kantor","src":`) {
		t.Fatalf("stored list: %s", stored)
	}
	if got := call(httptest.NewRequest(http.MethodGet, "/api/desktop/wallpapers", nil), nil, 200, "")["data"].([]any); len(got) != 2 {
		t.Fatalf("GET: %v", got)
	}

	// The list is capped at 24.
	full := make([]map[string]any, 24)
	for i := range full {
		full[i] = map[string]any{"id": "x" + string(rune('a'+i)), "name": "n", "src": "/api/files/desktop-wallpapers/none.png"}
	}
	raw, _ := json.Marshal(full)
	if _, err := tx.Exec(ctx, `UPDATE configuration.app_settings SET value = $1 WHERE key = 'desktop_wallpapers'`, string(raw)); err != nil {
		t.Fatal(err)
	}
	call(wallpaperUpload("", "a.png", png), &admin, 400, `{"success":false,"error":"Maksimal 24 wallpaper — hapus yang lama dulu"}`)
	if _, err := tx.Exec(ctx, `UPDATE configuration.app_settings SET value = $1 WHERE key = 'desktop_wallpapers'`, stored); err != nil {
		t.Fatal(err)
	}

	del := func(q string) *http.Request {
		return httptest.NewRequest(http.MethodDelete, "/api/desktop/wallpapers"+q, nil)
	}
	call(del("?id="+id), &cashier, 403, "")
	call(del("?id=%20"), &admin, 400, `{"success":false,"error":"id wajib"}`)
	call(del("?id=wp-none"), &admin, 404, `{"success":false,"error":"Wallpaper tidak ditemukan"}`)
	call(del("?id="+id), &admin, 200, `{"success":true,"data":{"id":"`+id+`"}}`)
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatalf("file kept: %v", err)
	}
	if err := tx.QueryRow(ctx, `SELECT value FROM configuration.app_settings WHERE key = 'desktop_wallpapers'`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if list = nil; json.Unmarshal([]byte(stored), &list) != nil || len(list) != 1 || list[0]["id"] != second["id"] {
		t.Fatalf("after delete: %s", stored)
	}
}
