package settings_test

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func logoUpload(method string, data []byte) *http.Request {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if data != nil {
		part, _ := mw.CreateFormFile("file", "logo.png")
		_, _ = part.Write(data)
	}
	_ = mw.Close()
	r := httptest.NewRequest(method, "/api/settings/company-profile/logo", &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	return r
}

func TestLetterhead(t *testing.T) {
	t.Setenv("NEXT_PUBLIC_APP_NAME", "")
	// Any signed-in staff user reads the letterhead, whatever their menus.
	outsider := staff(t, "settings.roles")
	e := newEnv(t)
	const path = "/api/settings/letterhead"

	expect(t, e.do(nil, "GET", path, nil), 401, unauthorized)
	expect(t, e.do(&outsider, "GET", path+"?company_id=x", nil), 400, `{"success":false,"error":"company_id tidak valid"}`)
	expect(t, e.do(&outsider, "GET", path, nil), 200,
		`{"success":true,"data":{"legal_name":"NüHabit","address":null,"city":null,"email":null,"phone":null,"npwp":null,"website":null,"logo_url":"/brand/wordmark-black.png","custom_logo":false}}`)

	companyID := e.text(`WITH h AS (INSERT INTO configuration.holdings (name, code) VALUES ('Holding Kop', 'KOP-H') RETURNING id)
		INSERT INTO configuration.companies (holding_id, name, code) SELECT id, ' PT Sulu Kop ', 'KOP' FROM h RETURNING id::text`)
	expect(t, e.do(&outsider, "GET", path+"?company_id="+companyID, nil), 200,
		`{"success":true,"data":{"legal_name":"PT Sulu Kop","address":null,"city":null,"email":null,"phone":null,"npwp":null,"website":null,"logo_url":"/brand/wordmark-black.png","custom_logo":false}}`)
	// An unknown company falls through to the brand.
	expect(t, e.do(&outsider, "GET", path+"?company_id=00000000-0000-0000-0000-000000000000", nil), 200,
		`{"success":true,"data":{"legal_name":"NüHabit","address":null,"city":null,"email":null,"phone":null,"npwp":null,"website":null,"logo_url":"/brand/wordmark-black.png","custom_logo":false}}`)

	for key, value := range map[string]string{
		"company_legal_name": "PT NüHabit Indonesia", "company_address": "Jl. Merdeka 1", "company_city": "Bandung",
		"company_email": "halo@nuhabit.id", "company_phone": "022-123", "company_npwp": "01.234.567.8-901.000",
		"company_website": "  ", "company_logo_url": "/api/files/site/letterhead/a.png",
	} {
		e.setting(key, value)
	}
	expect(t, e.do(&outsider, "GET", path+"?company_id="+companyID, nil), 200,
		`{"success":true,"data":{"legal_name":"PT NüHabit Indonesia","address":"Jl. Merdeka 1","city":"Bandung","email":"halo@nuhabit.id","phone":"022-123","npwp":"01.234.567.8-901.000","website":null,"logo_url":"/api/files/site/letterhead/a.png","custom_logo":true}}`)
}

func TestCompanyLogoUploadAndDelete(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("STORAGE_DIR", dir)
	admin := staff(t, "settings.business")
	e := newEnv(t)
	png := append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, make([]byte, 16)...)

	expect(t, e.send(&admin, logoUpload("POST", nil)), 400, `{"success":false,"error":"Pilih file logo dulu"}`)
	expect(t, e.send(&admin, logoUpload("POST", make([]byte, 2*1024*1024+1))), 400, `{"success":false,"error":"Logo maksimal 2 MB"}`)
	expect(t, e.send(&admin, logoUpload("POST", []byte("GIF89a not allowed"))), 400, `{"success":false,"error":"File harus gambar JPG/PNG/WebP"}`)

	expect(t, e.send(&admin, logoUpload("POST", png)), 200, "")
	first := e.text(`SELECT value FROM configuration.app_settings WHERE key = 'company_logo_url'`)
	if !strings.HasPrefix(first, "/api/files/site/letterhead/") || !strings.HasSuffix(first, ".png") {
		t.Fatalf("url %s", first)
	}
	firstFile := filepath.Join(dir, "uploads", "site", strings.TrimPrefix(first, "/api/files/site/"))
	if got, err := os.ReadFile(firstFile); err != nil || !bytes.Equal(got, png) {
		t.Fatalf("stored file: %v", err)
	}
	expect(t, e.do(&admin, "GET", "/api/settings/company-profile", nil), 200,
		`{"data":{"legal_name":null,"address":null,"city":null,"signer_name":null,"signer_title":null,"email":null,"phone":null,"npwp":null,"website":null,"logo_url":"`+first+`"}}`)

	// A replacement removes the previous file.
	expect(t, e.send(&admin, logoUpload("POST", png)), 200, "")
	if _, err := os.Stat(firstFile); !os.IsNotExist(err) {
		t.Fatalf("replaced logo kept: %v", err)
	}
	second := e.text(`SELECT value FROM configuration.app_settings WHERE key = 'company_logo_url'`)
	secondFile := filepath.Join(dir, "uploads", "site", strings.TrimPrefix(second, "/api/files/site/"))

	expect(t, e.send(&admin, logoUpload("DELETE", nil)), 200, `{"success":true,"data":{"logo_url":null}}`)
	if _, err := os.Stat(secondFile); !os.IsNotExist(err) {
		t.Fatalf("deleted logo kept: %v", err)
	}
	if got := e.text(`SELECT count(*)::text FROM configuration.app_settings WHERE key = 'company_logo_url' AND value IS NOT NULL`); got != "0" {
		t.Fatalf("logo url kept: %s", got)
	}
}
