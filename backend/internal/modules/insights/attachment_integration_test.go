package insights

import (
	"bytes"
	"context"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/ocr"
	"nuhabit/backend/internal/platform/pdfgen"
	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/xlsx"
)

// POST /api/ai/assistant/attachment: multipart in, extracted text out, with
// the route's own {error} bodies (app/api/ai/assistant/attachment/route.ts
// and lib/attachments/extract.test.ts).

type fakeOCR struct {
	text string
	err  error
	ext  string
}

func (f *fakeOCR) Recognize(_ context.Context, _ []byte, ext string) (string, error) {
	f.ext = ext
	return f.text, f.err
}

// upload posts one multipart part named field.
func upload(field, name string, data []byte) *http.Request {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	w, _ := mw.CreateFormFile(field, name)
	_, _ = w.Write(data)
	_ = mw.Close()
	r := httptest.NewRequest(http.MethodPost, "/api/ai/assistant/attachment", &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	return r
}

func TestAssistantAttachment(t *testing.T) {
	user := testutil.CreateStaff(t, testutil.StaffOptions{Role: "pos", Menus: map[string][]string{}})
	h := newPoolHarness(t, &fakePorts{})
	scan := &fakeOCR{text: "NOTA  \r\nTotal 15.000\n\n\n\n"}
	h.svc.ocr = scan
	as := func(r *http.Request) call { return h.do(testutil.AsStaff(r, user)) }
	wantError := func(c call, status int, msg string) {
		t.Helper()
		if c.status != status || c.raw != `{"error":"`+msg+`"}` {
			t.Fatal(c.status, c.raw)
		}
	}

	wantError(h.do(upload("file", "a.csv", []byte("x"))), 401, "Login required")
	wantError(as(testutil.Request(http.MethodPost, "/api/ai/assistant/attachment", map[string]any{"file": "x"})), 400, "File tidak ditemukan")
	wantError(as(upload("berkas", "a.csv", []byte("x"))), 400, "File tidak ditemukan")
	wantError(as(upload("file", "a.csv", nil)), 400, "File kosong")
	wantError(as(upload("file", "virus.exe", []byte("MZ"))), 400, "Format tidak didukung. Pakai PDF, DOCX, gambar, XLSX, atau CSV.")
	wantError(as(upload("file", "besar.txt", bytes.Repeat([]byte("x"), 10<<20+1))), 400, "Ukuran file melebihi 10 MB")
	wantError(as(upload("file", "kosong.txt", []byte("   \n\n  "))), 400, "Tidak ada teks yang bisa dibaca dari file ini")

	c := as(upload("file", "belanja.csv", []byte("nama,total\nAni,15000\nBudi,20000")))
	if c.status != 200 || c.raw != `{"data":{"name":"belanja.csv","size":31,"method":"text","truncated":false,"chars":31,"text":"nama,total\nAni,15000\nBudi,20000"}}` {
		t.Fatal(c.status, c.raw)
	}

	// chars counts UTF-16 units like String.length, and long text is cut.
	c = as(upload("file", "besar.md", []byte(strings.Repeat("😀", 10_250))))
	data := c.obj(t)["data"].(map[string]any)
	if data["method"] != "text" || data["truncated"] != true || data["chars"] != float64(20_000) || data["size"] != float64(41_000) {
		t.Fatal(data["method"], data["truncated"], data["chars"], data["size"])
	}

	sheet, err := xlsx.Build(xlsx.SheetSpec{Name: "Penjualan", Rows: [][]any{{"produk", "qty"}, {"Kopi", 3}}})
	if err != nil {
		t.Fatal(err)
	}
	data = as(upload("file", "laporan.xlsx", sheet)).obj(t)["data"].(map[string]any)
	if data["method"] != "spreadsheet" || data["text"] != "### Sheet: Penjualan\nproduk,qty\nKopi,3" {
		t.Fatal(data)
	}

	doc := pdfgen.New(pdfgen.Options{})
	doc.Para("Faktur pembelian bahan baku dari PT Sumber Makmur, total Rp1.250.000", pdfgen.TextOpts{})
	pdf, err := doc.Bytes()
	if err != nil {
		t.Fatal(err)
	}
	data = as(upload("file", "faktur.pdf", pdf)).obj(t)["data"].(map[string]any)
	if data["method"] != "pdf" || !strings.Contains(data["text"].(string), "PT Sumber Makmur") {
		t.Fatal(data)
	}

	// Images go through OCR; its text is cleaned like any other.
	data = as(upload("file", "nota.JPG", []byte{0xff, 0xd8, 0xff})).obj(t)["data"].(map[string]any)
	if data["method"] != "ocr" || data["text"] != "NOTA\nTotal 15.000" || scan.ext != ".jpg" {
		t.Fatal(data, scan.ext)
	}
	// OCR failures reach the user as they are.
	scan.err = ocr.ErrTimeout
	wantError(as(upload("file", "scan.png", []byte{1})), 400, ocr.ErrTimeout.Error())
	scan.err = errors.New("boom")
	wantError(as(upload("file", "scan.png", []byte{1})), 400, "boom")
}
