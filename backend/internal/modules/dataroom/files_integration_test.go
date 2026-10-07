package dataroom

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/extract"
	"nuhabit/backend/internal/platform/pdfgen"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/testutil"
)

// File routes: upload, download, delete and shared files, against a
// temporary STORAGE_DIR.

// fileFixture is a fixture whose storage root is a fresh temp dir.
func fileFixture(t *testing.T) (*fixture, string) {
	dir := t.TempDir()
	t.Setenv("STORAGE_DIR", dir)
	return newFixture(t), dir
}

type part struct {
	field, name, mime string
	data              []byte
}

// multipartRequest builds a multipart/form-data POST with text fields and
// file parts.
func multipartRequest(t *testing.T, target string, fields map[string]string, files ...part) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	for _, p := range files {
		h := textproto.MIMEHeader{}
		h.Set("Content-Disposition", `form-data; name="`+p.field+`"; filename="`+p.name+`"`)
		if p.mime != "" {
			h.Set("Content-Type", p.mime)
		}
		w, err := mw.CreatePart(h)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write(p.data)
	}
	_ = mw.Close()
	req := httptest.NewRequest("POST", target, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

// upload posts one file as the fixture's staff (deny lists refused actions).
func (f *fixture) upload(parent string, p part, deny string) response {
	f.t.Helper()
	fields := map[string]string{}
	if parent != "" {
		fields["parent_id"] = parent
	}
	req := multipartRequest(f.t, "/api/dataroom/upload", fields, p)
	req.Header.Set("X-Test-Staff", f.staff)
	req.Header.Set("X-Test-Deny", deny)
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return response{Status: rec.Code, Raw: rec.Body.String(), Body: out, Header: rec.Header()}
}

func samplePDF(t *testing.T, text string) []byte {
	t.Helper()
	doc := pdfgen.New(pdfgen.Options{})
	doc.Para(text, pdfgen.TextOpts{})
	out, err := doc.Bytes()
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func samplePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, color.RGBA{30, 90, 60, 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// pdfStreamsMatch reports whether any stream of the PDF, inflated when it
// is compressed, matches pattern. The stamp sits in a form XObject, which
// extract.PDFText (page content only) does not read.
func pdfStreamsMatch(t *testing.T, data []byte, pattern string) bool {
	t.Helper()
	re := regexp.MustCompile(pattern)
	for _, m := range regexp.MustCompile(`(?s)stream\r?\n(.*?)endstream`).FindAllSubmatch(data, -1) {
		body := m[1]
		if zr, err := zlib.NewReader(bytes.NewReader(body)); err == nil {
			if inflated, err := io.ReadAll(zr); err == nil || len(inflated) > 0 {
				body = inflated
			}
		}
		if re.Match(body) {
			return true
		}
	}
	return false
}

func expectHeaders(t *testing.T, r response, want map[string]string) {
	t.Helper()
	for k, v := range want {
		if got := r.Header.Get(k); got != v {
			t.Fatalf("%s = %q, want %q", k, got, v)
		}
	}
}

func TestUploadDownloadDelete(t *testing.T) {
	f, dir := fileFixture(t)
	root := f.folder("Laporan", nil)
	pdf := samplePDF(t, "Neraca 2026")

	up := f.ok(f.upload(root, part{"file", "Neraca ü.pdf", "application/octet-stream", pdf}, ""), 201)
	node := up.data()
	path, _ := node["storage_path"].(string)
	if !regexp.MustCompile(`^dataroom/\d{4}/\d{2}/[0-9a-f]{24}\.pdf$`).MatchString(path) ||
		node["mime"] != "application/pdf" || node["size_bytes"] != float64(len(pdf)) || node["kind"] != "file" ||
		node["parent_id"] != root || node["name"] != "Neraca ü.pdf" || node["created_by"] != f.staff || node["created_by_name"] != "Dewi Arsip" {
		t.Fatalf("upload: %s", up.Raw)
	}
	if onDisk, err := os.ReadFile(filepath.Join(dir, "private", filepath.FromSlash(path))); err != nil || !bytes.Equal(onDisk, pdf) {
		t.Fatalf("stored file: %v", err)
	}
	id := node["id"].(string)

	// The name's extension and then the client's claim set the MIME type.
	note := f.ok(f.upload("", part{"file", "catatan", "Text/X-Log", []byte("halo")}, ""), 201).data()
	if note["mime"] != "text/x-log" || !strings.HasSuffix(note["storage_path"].(string), ".bin") || note["parent_id"] != nil {
		t.Fatalf("claimed mime: %v", note)
	}

	f.fail(f.upload(root, part{"lampiran", "x.pdf", "", pdf}, ""), 400, "File wajib diisi")
	f.fail(f.upload(id, part{"file", "x.pdf", "", pdf}, ""), 404, "Folder tujuan tidak ditemukan")
	f.fail(f.upload(root, part{"file", "x.pdf", "", pdf}, "create"), 403, "Insufficient permissions")
	f.fail(f.do(call{method: "POST", target: "/api/dataroom/upload", body: map[string]any{"file": "x"}}), 500, "Terjadi kesalahan server")

	dl := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + id + "/download?inline=1"}), 200)
	if dl.Raw != string(pdf) {
		t.Fatal("download bytes differ")
	}
	expectHeaders(t, dl, map[string]string{
		"Content-Type":           "application/pdf",
		"Content-Disposition":    `inline; filename="Neraca _.pdf"; filename*=UTF-8''Neraca%20%C3%BC.pdf`,
		"Cache-Control":          "private, no-store",
		"X-Content-Type-Options": "nosniff",
		"Content-Length":         strconv.Itoa(len(pdf)),
	})
	attach := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + id + "/download"}), 200)
	expectHeaders(t, attach, map[string]string{"Content-Disposition": `attachment; filename="Neraca _.pdf"; filename*=UTF-8''Neraca%20%C3%BC.pdf`})
	// Only images and PDF open inline.
	plain := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + note["id"].(string) + "/download?inline=1"}), 200)
	expectHeaders(t, plain, map[string]string{"Content-Type": "text/x-log", "Content-Disposition": `attachment; filename="catatan"; filename*=UTF-8''catatan`})
	f.fail(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + root + "/download"}), 404, "File tidak ditemukan")
	f.fail(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + newUUID(t, f.tx) + "/download"}), 404, "File tidak ditemukan")

	// Department access guards download and delete.
	locked := f.folder("Rahasia", nil)
	secret := f.ok(f.upload(locked, part{"file", "gaji.pdf", "", pdf}, ""), 201).data()["id"].(string)
	f.ok(f.do(call{method: "PUT", target: "/api/dataroom/nodes/" + locked + "/access", role: "super_admin",
		body: map[string]any{"department_ids": []string{f.department("Go Test FIN")}}}), 200)
	ops := newUUID(t, f.tx)
	f.dir.dept[ops] = f.department("Go Test OPS")
	f.fail(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + secret + "/download", staff: ops}), 403, "File ini tidak dibuka untuk departemen Anda")
	f.fail(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + locked, staff: ops}), 403, "Item ini tidak dibuka untuk departemen Anda")

	// Deleting a folder removes the subtree and its files.
	sub := f.folder("Lampiran", &root)
	inner := f.ok(f.upload(sub, part{"file", "a.png", "", samplePNG(t, 4, 4)}, ""), 201).data()
	f.fail(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + root, deny: "delete"}), 403, "Insufficient permissions")
	f.fail(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + newUUID(t, f.tx)}), 404, "Item tidak ditemukan")
	del := f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + root}), 200)
	if del.Raw != `{"success":true,"data":{"deleted":"`+root+`","files_removed":2}}` {
		t.Fatalf("delete: %s", del.Raw)
	}
	for _, p := range []string{path, inner["storage_path"].(string)} {
		if _, err := os.Stat(filepath.Join(dir, "private", filepath.FromSlash(p))); !os.IsNotExist(err) {
			t.Fatalf("%s still on disk: %v", p, err)
		}
	}
	if n := f.scalar(`SELECT count(*)::text FROM dataroom.nodes WHERE id IN ($1, $2, $3)`, root, sub, id); n != "0" {
		t.Fatalf("%s nodes left", n)
	}
}

// A storage_path from the database is served only inside private/dataroom/.
func TestStoredPathTraversal(t *testing.T) {
	f, dir := fileFixture(t)
	root := f.folder("Arsip", nil)
	for rel, data := range map[string]string{"secret.txt": "root", "private/hris/kontrak.pdf": "hris"} {
		abs := filepath.Join(dir, filepath.FromSlash(rel))
		_ = os.MkdirAll(filepath.Dir(abs), 0o755)
		if err := os.WriteFile(abs, []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, rel := range []string{"dataroom/../../secret.txt", "dataroom/../hris/kontrak.pdf", "../secret.txt", "/etc/passwd", "hris/kontrak.pdf", "dataroom", ""} {
		id := f.scalar(`INSERT INTO dataroom.nodes (parent_id, kind, name, mime, size_bytes, storage_path)
			VALUES ($1, 'file', 'x.pdf', 'application/pdf', 4, $2) RETURNING id::text`, root, rel)
		f.fail(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + id + "/download"}), 404, "File tidak ditemukan")
	}
	// Deleting such a node leaves the file it points at alone.
	f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + root}), 200)
	if _, err := os.Stat(filepath.Join(dir, "private", "hris", "kontrak.pdf")); err != nil {
		t.Fatalf("outside file removed: %v", err)
	}
}

func TestUploadLimits(t *testing.T) {
	f, dir := fileFixture(t)
	f.svc.ports.MaxFileBytes = 1024
	f.fail(f.upload("", part{"file", "besar.bin", "", make([]byte, 1025)}, ""), 400, "Ukuran file melebihi batas 1.0 KB")
	// A body past the limit plus the form overhead is refused while reading.
	f.fail(f.upload("", part{"file", "besar.bin", "", make([]byte, formOverhead+2048)}, ""), 400, "Ukuran file melebihi batas 1.0 KB")

	f.svc.ports.MaxFileBytes = 100 * 1024 * 1024
	used, _ := strconv.ParseFloat(f.scalar(`SELECT COALESCE(SUM(size_bytes), 0)::text FROM dataroom.nodes WHERE kind = 'file'`), 64)
	f.svc.ports.QuotaBytes = used + 100
	f.fail(f.upload("", part{"file", "a.txt", "", make([]byte, 101)}, ""), 400,
		"Kuota Dataroom penuh ("+domain.FormatBytes(used)+" dari "+domain.FormatBytes(used+100)+"). Hapus file lain dulu.")
	f.ok(f.upload("", part{"file", "a.txt", "", make([]byte, 100)}, ""), 201)

	// A failed insert removes the file it just wrote.
	missing := newUUID(t, f.tx)
	if _, err := f.svc.Upload(context.Background(), &missing, &storage.File{Name: "x.txt", Data: []byte("x")}, f.staff, "Dewi Arsip"); err == nil {
		t.Fatal("insert under a missing parent succeeded")
	}
	var files []string
	_ = filepath.WalkDir(filepath.Join(dir, "private"), func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			files = append(files, p)
		}
		return nil
	})
	if len(files) != 1 {
		t.Fatalf("files on disk: %v", files)
	}
}

func TestShareFiles(t *testing.T) {
	f, _ := fileFixture(t)
	root := f.folder("Investor", nil)
	sub := f.folder("Keuangan", &root)
	pdf := samplePDF(t, "Laporan keuangan")
	pngData := samplePNG(t, 320, 200)
	pdfID := f.ok(f.upload(sub, part{"file", "laporan.pdf", "", pdf}, ""), 201).data()["id"].(string)
	pngID := f.ok(f.upload(root, part{"file", "foto.png", "", pngData}, ""), 201).data()["id"].(string)
	txtID := f.ok(f.upload(root, part{"file", "catatan.txt", "", []byte("apa adanya")}, ""), 201).data()["id"].(string)
	brokenID := f.scalar(`INSERT INTO dataroom.nodes (parent_id, kind, name, mime, size_bytes, storage_path)
		VALUES ($1, 'file', 'rusak.pdf', 'application/pdf', 4, (SELECT storage_path FROM dataroom.nodes WHERE id = $2)) RETURNING id::text`, root, txtID)
	outside := f.ok(f.upload("", part{"file", "lain.pdf", "", pdf}, ""), 201).data()["id"].(string)

	shareID, token, _ := f.share(map[string]any{"node_id": root, "access_type": "public", "watermark": true})
	get := func(nodeID, query string, cookie *http.Cookie) response {
		return f.do(call{method: "GET", target: "/api/share/" + token + "/files/" + nodeID + query, staff: "-", cookie: cookie,
			headers: map[string]string{"cf-connecting-ip": "203.0.113.7", "User-Agent": "Go-Test"}})
	}

	// PDF: stamped with the sharer's name and the date, downloaded.
	dl := f.ok(get(pdfID, "?download=1", nil), 200)
	expectHeaders(t, dl, map[string]string{
		"Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="laporan.pdf"; filename*=UTF-8''laporan.pdf`,
		"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Length": strconv.Itoa(len(dl.Raw)),
	})
	if text, err := extract.PDFText([]byte(dl.Raw)); err != nil || text != "Laporan keuangan" {
		t.Fatalf("watermarked pdf text %q (%v)", text, err)
	}
	if stamp := `Dibagikan oleh Dewi Arsip - \d{2}/\d{2}/\d{4} \d{2}\.\d{2}`; !pdfStreamsMatch(t, []byte(dl.Raw), stamp) {
		t.Fatal("pdf carries no watermark")
	}

	// PNG: stamped, still a PNG of the same size, shown inline.
	view := f.ok(get(pngID, "", nil), 200)
	expectHeaders(t, view, map[string]string{"Content-Type": "image/png", "Content-Disposition": `inline; filename="foto.png"; filename*=UTF-8''foto.png`})
	img, err := png.Decode(strings.NewReader(view.Raw))
	if err != nil || img.Bounds().Dx() != 320 || img.Bounds().Dy() != 200 {
		t.Fatalf("watermarked png: %v", err)
	}
	stamped := 0
	for y := range 200 {
		for x := range 320 {
			if r, g, b, _ := img.At(x, y).RGBA(); r>>8 != 30 || g>>8 != 90 || b>>8 != 60 {
				stamped++
			}
		}
	}
	if stamped == 0 {
		t.Fatal("png carries no watermark")
	}

	// Other types, and a PDF the stamp cannot read, go out unchanged.
	if r := f.ok(get(txtID, "", nil), 200); r.Raw != "apa adanya" || r.Header.Get("Content-Disposition") != `attachment; filename="catatan.txt"; filename*=UTF-8''catatan.txt` {
		t.Fatalf("plain file: %s %v", r.Raw, r.Header)
	}
	if r := f.ok(get(brokenID, "?download=1", nil), 200); r.Raw != "apa adanya" {
		t.Fatalf("broken pdf: %s", r.Raw)
	}

	f.fail(get(outside, "", nil), 404, "File tidak ditemukan")
	f.fail(get(sub, "", nil), 404, "File tidak ditemukan")
	f.fail(get(newUUID(t, f.tx), "", nil), 404, "File tidak ditemukan")

	logs := f.scalar(`SELECT string_agg(action || '|' || node_id || '|' || file_name || '|' || ip || '|' || user_agent || '|' || COALESCE(email, '-'), ',' ORDER BY created_at, action)
		FROM dataroom.share_access_logs WHERE share_id = $1 AND node_id IN ($2, $3)`, shareID, pdfID, pngID)
	if logs != "download|"+pdfID+"|laporan.pdf|203.0.113.7|Go-Test|-,view|"+pngID+"|foto.png|203.0.113.7|Go-Test|-" {
		t.Fatalf("access logs: %s", logs)
	}

	// An email link: 401 until verified, then stamped with the recipient.
	_, emailToken, _ := f.share(map[string]any{"node_id": root, "access_type": "email", "emails": []string{"budi@wit.id"}, "watermark": true})
	emailShare := f.scalar(`SELECT id::text FROM dataroom.shares WHERE token = $1`, emailToken)
	shared := func(cookie *http.Cookie) response {
		return f.do(call{method: "GET", target: "/api/share/" + emailToken + "/files/" + pdfID, staff: "-", cookie: cookie})
	}
	f.fail(shared(nil), 401, "Verifikasi dulu")
	session := domain.GenerateShareToken()
	f.tx.Exec(context.Background(), `INSERT INTO dataroom.share_sessions (share_id, session_token, email, email_ok, pin_ok, expires_at)
		VALUES ($1, $2, 'budi@wit.id', false, false, now() + interval '1 hour')`, emailShare, session)
	cookie := &http.Cookie{Name: "drs_" + emailToken, Value: session}
	f.fail(shared(cookie), 401, "Verifikasi dulu")
	f.tx.Exec(context.Background(), `UPDATE dataroom.share_sessions SET email_ok = true WHERE session_token = $1`, session)
	if !pdfStreamsMatch(t, []byte(f.ok(shared(cookie), 200).Raw), `budi@wit\.id - \d{2}/`) {
		t.Fatal("pdf carries no recipient watermark")
	}
	if got := f.scalar(`SELECT email FROM dataroom.share_access_logs WHERE share_id = $1 AND action = 'view'`, emailShare); got != "budi@wit.id" {
		t.Fatalf("log email %s", got)
	}

	// A PIN link without a session, a revoked link.
	_, pinToken, _ := f.share(map[string]any{"node_id": root, "access_type": "public", "pin": "1234"})
	f.fail(f.do(call{method: "GET", target: "/api/share/" + pinToken + "/files/" + pdfID, staff: "-"}), 401, "Verifikasi dulu")
	f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/shares/" + shareID}), 200)
	f.fail(get(pdfID, "", nil), 410, "Link sudah dicabut oleh pemilik")
}

// The real guard on the file routes.
func TestFileRoutesAuth(t *testing.T) {
	t.Setenv("STORAGE_DIR", t.TempDir())
	deps := testutil.Deps(t, nil)
	mux := testutil.Mux(New(deps, Ports{Directory: testDirectory{q: deps.DB}, Mailer: &fakeMailer{}, MaxFileBytes: 1 << 20, QuotaBytes: 1 << 30}))
	reader := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"dataroom": {"read"}}})
	stranger := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"crm": {"read"}}})
	missing := "/api/dataroom/nodes/00000000-0000-4000-8000-000000000000"
	upload := func() *http.Request {
		return multipartRequest(t, "/api/dataroom/upload", nil, part{"file", "a.txt", "", []byte("a")})
	}
	for _, c := range []struct {
		r      *http.Request
		status int
		msg    string
	}{
		{upload(), 401, "Authentication required"},
		{testutil.AsStaff(upload(), reader), 403, "Insufficient permissions"},
		{testutil.Request("GET", missing+"/download", nil), 401, "Authentication required"},
		{testutil.AsStaff(testutil.Request("GET", missing+"/download", nil), stranger), 403, "Insufficient permissions"},
		{testutil.AsStaff(testutil.Request("GET", missing+"/download", nil), reader), 404, "File tidak ditemukan"},
		{testutil.Request("DELETE", missing, nil), 401, "Authentication required"},
		{testutil.AsStaff(testutil.Request("DELETE", missing, nil), reader), 403, "Insufficient permissions"},
		{testutil.Request("GET", "/api/share/"+strings.Repeat("z", 30)+"/files/x", nil), 404, "Link tidak ditemukan"},
	} {
		rec, body := testutil.Do(t, mux, c.r)
		if rec.Code != c.status || body["error"] != c.msg {
			t.Fatalf("%s %s: %d %s", c.r.Method, c.r.URL, rec.Code, rec.Body.String())
		}
	}
}
