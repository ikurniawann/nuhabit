package storage

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

var pngBytes = append(append([]byte{}, pngMagic...), make([]byte, 16)...)

func fixedStore(t *testing.T) *Store {
	s := New(t.TempDir())
	s.now = func() time.Time { return time.UnixMilli(1759650000123) }
	return s
}

func TestUploadLayoutAndDelete(t *testing.T) {
	s := fixedStore(t)
	url, err := s.Upload("member-photos", "cust 1", pngBytes, "image/png", "evil.svg")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^/api/files/member-photos/cust%201/1759650000123-[0-9a-f]{32}\.png$`).MatchString(url) {
		t.Fatalf("url %q", url)
	}
	abs, ok := s.UploadPath(url)
	if !ok {
		t.Fatal("UploadPath rejected its own URL")
	}
	if got, _ := os.ReadFile(abs); !bytes.Equal(got, pngBytes) {
		t.Fatal("content mismatch")
	}
	if err := s.Delete("member-photos", "https://app.example"+url); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(abs); !os.IsNotExist(err) {
		t.Fatal("file still there")
	}
	if err := s.Delete("member-photos", "/api/files/other/x.png"); err == nil || err.Error() != "Invalid file URL" {
		t.Fatalf("got %v", err)
	}
	if _, err := s.Upload("products", "../../private", pngBytes, "image/png", ""); err != ErrInvalidPath {
		t.Fatalf("traversal: %v", err)
	}
}

func TestSafeExtensionAndValidate(t *testing.T) {
	cases := []struct{ mime, name, want string }{
		{"image/png", "evil.svg", "png"},
		{"application/x-foo", "Report.XLSX", "xlsx"},
		{"application/x-foo", "a.toolong", "bin"},
		{"", "noext", "noext"},
		{"", "", "bin"},
	}
	for _, c := range cases {
		if got := SafeExtension(c.mime, c.name); got != c.want {
			t.Errorf("SafeExtension(%q,%q)=%q want %q", c.mime, c.name, got, c.want)
		}
	}
	if err := ValidateFile(MaxFileSize+1, "image/png"); err == nil || err.Error() != "Ukuran file maksimal 10 MB" {
		t.Fatal(err)
	}
	if err := ValidateFile(1, "image/svg+xml"); err == nil || err.Error() != "Tipe file tidak didukung" {
		t.Fatal(err)
	}
	if BucketAccess("crm-avatars") != AccessPublic || BucketAccess("member-photos") != AccessMemberOwned || BucketAccess("cv") != AccessStaff {
		t.Fatal("bucket access")
	}
}

func TestSafeSegments(t *testing.T) {
	for _, bad := range [][]string{{}, {"a", ""}, {".env"}, {"a%2F..%2Fb"}, {"%E0%A4%A"}, {"a\x00"}} {
		if SafeSegments(bad) != nil {
			t.Errorf("accepted %q", bad)
		}
	}
	if got := SafeSegmentsUnder([]string{"attendance", "e1", "x.jpg"}, "attendance", 3); len(got) != 3 {
		t.Fatal(got)
	}
	if SafeSegmentsUnder([]string{"other", "e1", "x.jpg"}, "attendance", 3) != nil {
		t.Fatal("wrong folder accepted")
	}
	if got := EncodeURIComponent("a b/ü!*'()~_.-"); got != "a%20b%2F%C3%BC!*'()~_.-" {
		t.Fatal(got)
	}
}

func TestPrivateFiles(t *testing.T) {
	s := fixedStore(t)
	rel, err := s.SavePrivateImage(pngBytes, "image/jpeg", "leave-attachments/e1!")
	if err != nil || !regexp.MustCompile(`^leave-attachments/e1/1759650000123-[0-9a-f]{16}\.png$`).MatchString(rel) {
		t.Fatalf("%q %v", rel, err)
	}
	data, mime, err := s.ReadPrivate(rel)
	if err != nil || mime != "image/png" || !bytes.Equal(data, pngBytes) {
		t.Fatalf("read %q %v", mime, err)
	}
	if _, err := s.SavePrivateImage(pngBytes, "image/gif", "x"); err == nil {
		t.Fatal("gif declared mime accepted")
	}
	pdf := []byte("%PDF-1.4 hello world")
	rel, err = s.SavePrivateDocument(pdf, "faktur-pajak")
	if err != nil || !strings.HasSuffix(rel, ".pdf") {
		t.Fatal(rel, err)
	}
	if _, err := s.SavePrivateDocument([]byte("<svg>............"), "x"); err == nil {
		t.Fatal("svg accepted")
	}
	if _, _, err := s.ReadPrivate("../uploads/x"); !os.IsNotExist(err) {
		t.Fatal("traversal read", err)
	}

	webm := append(append([]byte{}, ebmlMagic...), make([]byte, 12)...)
	if _, err := s.AppendPrivateChunk("interview/s1/recording/p1.webm", []byte("not webm at all"), 100); err == nil {
		t.Fatal("non-webm first chunk accepted")
	}
	if n, err := s.AppendPrivateChunk("interview/s1/recording/p1.webm", webm, 40); err != nil || n != 16 {
		t.Fatal(n, err)
	}
	if n, err := s.AppendPrivateChunk("interview/s1/recording/p1.webm", []byte("more"), 40); err != nil || n != 20 {
		t.Fatal(n, err)
	}
	if _, err := s.AppendPrivateChunk("interview/s1/recording/p1.webm", make([]byte, 21), 40); err == nil || err.Error() != "Kuota rekaman sesi tercapai" {
		t.Fatal(err)
	}
	list := s.ListPrivate("interview/s1/recording")
	if len(list) != 1 || list[0].Name != "p1.webm" || list[0].Size != 20 {
		t.Fatalf("%+v", list)
	}
	s.DeletePrivateFolder("interview/s1")
	if len(s.ListPrivate("interview/s1/recording")) != 0 {
		t.Fatal("folder not deleted")
	}
	if SniffAudio([]byte("ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00")) != "audio/mpeg" {
		t.Fatal("mp3 sniff")
	}
}

func TestServeUpload(t *testing.T) {
	s := fixedStore(t)
	url, _ := s.Upload("products", "", []byte("0123456789abcdef"), "image/png", "")
	segs := strings.Split(strings.TrimPrefix(url, "/api/files/products/"), "/")
	abs, ok := s.UploadFile("products", segs)
	if !ok {
		t.Fatal("not resolved")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", url, nil)
	req.Header.Set("Range", "bytes=4-7")
	if err := ServeUpload(rec, req, abs, true); err != nil {
		t.Fatal(err)
	}
	if rec.Code != 206 || rec.Body.String() != "4567" || rec.Header().Get("Content-Range") != "bytes 4-7/16" ||
		rec.Header().Get("Cache-Control") != "public, max-age=86400" || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("%d %q %v", rec.Code, rec.Body.String(), rec.Header())
	}

	rec = httptest.NewRecorder()
	req.Header.Set("Range", "bytes=99-")
	_ = ServeUpload(rec, req, abs, false)
	if rec.Code != 200 || rec.Body.Len() != 16 || rec.Header().Get("Vary") != "Cookie, Authorization" {
		t.Fatalf("unsatisfiable range: %d %v", rec.Code, rec.Header())
	}

	html := filepath.Join(s.UploadsDir(), "products", "x.html")
	_ = os.WriteFile(html, []byte("<script>"), 0o644)
	rec = httptest.NewRecorder()
	_ = ServeUpload(rec, httptest.NewRequest("GET", "/", nil), html, true)
	if rec.Header().Get("Content-Type") != "application/octet-stream" || rec.Header().Get("Content-Disposition") != "attachment" {
		t.Fatal(rec.Header())
	}
	if err := ServeUpload(httptest.NewRecorder(), req, filepath.Join(s.UploadsDir(), "products"), true); err == nil {
		t.Fatal("directory served")
	}
	if got := ContentDisposition(`Laporan "Q3" ü😀.pdf`, true); got != `inline; filename="Laporan _Q3_ ___.pdf"; filename*=UTF-8''Laporan%20%22Q3%22%20%C3%BC%F0%9F%98%80.pdf` {
		t.Fatal(got)
	}
}

func TestReadForm(t *testing.T) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("mode", "preview")
	fw, _ := mw.CreateFormFile("file", "coa.xlsx") // application/octet-stream
	_, _ = fw.Write([]byte("PK..."))
	h := map[string][]string{"Content-Disposition": {`form-data; name="photo"; filename="a.png"`}}
	pw, _ := mw.CreatePart(h) // no Content-Type: File.type is text/plain
	_, _ = pw.Write(pngBytes)
	_ = mw.Close()

	newReq := func() *http.Request {
		r := httptest.NewRequest("POST", "/", bytes.NewReader(body.Bytes()))
		r.Header.Set("Content-Type", mw.FormDataContentType())
		return r
	}
	form, err := ReadForm(newReq(), MaxRequestBytes)
	if err != nil {
		t.Fatal(err)
	}
	if form.Value("mode") != "preview" || form.File("mode") != nil {
		t.Fatal("text field")
	}
	if f := form.File("file"); f == nil || f.Name != "coa.xlsx" || f.Type != "application/octet-stream" || f.Size() != 5 {
		t.Fatalf("%+v", f)
	}
	if f := form.File("photo"); f == nil || f.Type != "text/plain" {
		t.Fatalf("%+v", f)
	}
	if _, err := ReadForm(newReq(), 10); err != ErrBodyTooLarge {
		t.Fatal(err)
	}
	bad := httptest.NewRequest("POST", "/", strings.NewReader("{}"))
	bad.Header.Set("Content-Type", "application/json")
	if _, err := ReadForm(bad, MaxRequestBytes); err != ErrInvalidForm {
		t.Fatal(err)
	}
}

func TestDir(t *testing.T) {
	if Dir(func(string) string { return "/app/storage" }) != "/app/storage" {
		t.Fatal("STORAGE_DIR ignored")
	}
	if d := Dir(func(string) string { return "" }); !strings.HasSuffix(filepath.ToSlash(d), "frontend/storage") {
		t.Fatal(d)
	}
}
