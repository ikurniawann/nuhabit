package extract

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/pdfgen"
	"nuhabit/backend/internal/platform/xlsx"
)

const documentXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Curriculum Vitae</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Nama:</w:t></w:r><w:r><w:tab/><w:t>Budi Santoso</w:t></w:r><w:del w:id="1"><w:r><w:delText>dihapus</w:delText></w:r></w:del><w:ins w:id="2"><w:r><w:t xml:space="preserve"> (baru)</w:t></w:r></w:ins></w:p>
<w:p><w:r><w:t>E</w:t></w:r><w:r><w:noBreakHyphen/><w:t>mail</w:t><w:br/><w:t>budi@example.com</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>HYPERLINK "x"</w:instrText></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Pengalaman</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>PT Maju &amp; Jaya</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><mc:AlternateContent><mc:Choice Requires="wps"><w:r><w:t>pilihan</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>cadangan</w:t></w:r></mc:Fallback></mc:AlternateContent><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>
<w:sectPr/>
</w:body>
</w:document>`

func buildDOCX(t *testing.T) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	parts := map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
		"_rels/.rels":         `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		"word/document.xml":   documentXML,
	}
	for _, name := range []string{"[Content_Types].xml", "_rels/.rels", "word/document.xml"} {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(parts[name]))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

const wantDOCX = "Curriculum Vitae\n\nNama:\tBudi Santoso (baru)\n\nE‑mailbudi@example.com\n\nPengalaman\n\nPT Maju & Jaya\n\ncadangan\n\n"

func TestDOCXText(t *testing.T) {
	got, err := DOCXText(buildDOCX(t))
	if err != nil {
		t.Fatal(err)
	}
	if got != wantDOCX {
		t.Fatalf("got %q", got)
	}
	if _, err := DOCXText([]byte("\xd0\xcf\x11\xe0 legacy doc")); !errors.Is(err, ErrNotDOCX) {
		t.Fatal(err)
	}
}

func samplePDF(t *testing.T) []byte {
	d := pdfgen.New(pdfgen.Options{Margin: 48})
	d.Font(pdfgen.HelveticaBold, 14).Para("Daftar Riwayat Hidup", pdfgen.TextOpts{})
	d.Font(pdfgen.Helvetica, 10).Para("Nama: Budi Santoso, domisili Bandung. Pengalaman kerja sebagai kasir di PT Maju Jaya selama dua tahun.", pdfgen.TextOpts{Width: 250})
	d.AddPage()
	d.Para("Halaman kedua", pdfgen.TextOpts{})
	out, err := d.Bytes()
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestPDFText(t *testing.T) {
	got, err := PDFText(samplePDF(t))
	if err != nil {
		t.Fatal(err)
	}
	want := "Daftar Riwayat Hidup Nama: Budi Santoso, domisili Bandung. Pengalaman kerja sebagai kasir di PT Maju Jaya selama dua tahun. Halaman kedua"
	if got != want {
		t.Fatalf("got %q", got)
	}
	if _, err := PDFText([]byte("%PDF-1.4 broken")); err == nil {
		t.Fatal("broken PDF accepted")
	}
}

type fakeOCR struct {
	text string
	err  error
	exts []string
}

func (f *fakeOCR) Recognize(_ context.Context, _ []byte, ext string) (string, error) {
	f.exts = append(f.exts, ext)
	return f.text, f.err
}

func TestAttachment(t *testing.T) {
	ctx := context.Background()
	ocr := &fakeOCR{text: "  struk\r\n\n\n\nTotal Rp 50.000  \n"}
	res, err := Attachment(ctx, []byte("img"), "Nota.JPG", ocr)
	if err != nil || res.Method != MethodOCR || res.Text != "struk\n\nTotal Rp 50.000" {
		t.Fatalf("%+v %v", res, err)
	}

	// A text layer under 40 characters counts as a scan: OCR first, the PDF
	// text when OCR fails.
	short := pdfgen.New(pdfgen.Options{})
	short.Para("Scan", pdfgen.TextOpts{})
	shortPDF, _ := short.Bytes()
	if res, _ := Attachment(ctx, shortPDF, "a.pdf", ocr); res.Method != MethodOCR {
		t.Fatalf("%+v", res)
	}
	if res, _ := Attachment(ctx, shortPDF, "a.pdf", &fakeOCR{err: errors.New("no pdf")}); res.Method != MethodPDF || res.Text != "Scan" {
		t.Fatalf("%+v", res)
	}
	if res, _ := Attachment(ctx, samplePDF(t), "cv.pdf", nil); res.Method != MethodPDF {
		t.Fatalf("%+v", res)
	}

	sheet, _ := xlsx.Build(xlsx.SheetSpec{Name: "Stok", Rows: [][]any{{"Item", "Qty"}, {"Gula, pasir", 3}}})
	if res, err := Attachment(ctx, sheet, "stok.xlsx", nil); err != nil || res.Text != "### Sheet: Stok\nItem,Qty\n\"Gula, pasir\",3" {
		t.Fatalf("%+v %v", res, err)
	}
	if res, _ := Attachment(ctx, buildDOCX(t), "cv.docx", nil); res.Method != MethodDOCX || !strings.HasPrefix(res.Text, "Curriculum Vitae\n\nNama:") {
		t.Fatalf("%+v", res)
	}

	long := strings.Repeat("😀", MaxChars/2) + "x"
	if res, _ := Attachment(ctx, []byte(long), "a.txt", nil); !res.Truncated || len([]rune(res.Text)) != MaxChars/2 {
		t.Fatalf("truncated=%v len=%d", res.Truncated, len([]rune(res.Text)))
	}
	if _, err := Attachment(ctx, []byte("  \n"), "a.txt", nil); !errors.Is(err, ErrNoText) {
		t.Fatal(err)
	}
	if _, err := Attachment(ctx, nil, "a.exe", nil); err == nil || err.Error() != "Format tidak didukung: .exe" {
		t.Fatal(err)
	}
	if _, err := Attachment(ctx, nil, "README", nil); err == nil || err.Error() != "Format tidak didukung: tanpa ekstensi" {
		t.Fatal(err)
	}
	if !IsSupportedAttachment("x.TSV") || IsSupportedAttachment("x.svg") {
		t.Fatal("IsSupportedAttachment")
	}
	if _, _, err := CV(ctx, nil, "cv.webp", nil); err == nil || err.Error() != "Format CV tidak didukung untuk ekstraksi: .webp" {
		t.Fatal(err)
	}
}

// TestNodeParity extracts the same DOCX and PDF with mammoth and unpdf
// under Node: both texts must match exactly. Skips
// without node or the frontend's node_modules.
func TestNodeParity(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	_, here, _, _ := runtime.Caller(0)
	frontend, _ := filepath.Abs(filepath.Join(filepath.Dir(here), "..", "..", "..", "..", "frontend"))
	for _, m := range []string{"mammoth", "unpdf"} {
		if _, err := os.Stat(filepath.Join(frontend, "node_modules", m)); err != nil {
			t.Skip(m + " not installed")
		}
	}
	dir := t.TempDir()
	docx, pdf := buildDOCX(t), samplePDF(t)
	_ = os.WriteFile(filepath.Join(dir, "a.docx"), docx, 0o644)
	_ = os.WriteFile(filepath.Join(dir, "a.pdf"), pdf, 0o644)
	script := `
const dir = process.argv[1];
const fs = await import("node:fs");
const mammoth = (await import("mammoth")).default;
const { extractText } = await import("unpdf");
const docx = (await mammoth.extractRawText({ buffer: fs.readFileSync(dir + "/a.docx") })).value;
const { text } = await extractText(new Uint8Array(fs.readFileSync(dir + "/a.pdf")), { mergePages: true });
console.log(JSON.stringify({ docx, pdf: text }));
`
	cmd := exec.Command(node, "--no-warnings", "--input-type=module", "-e", script, dir)
	cmd.Dir = frontend
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("node: %v %s", err, stderr.String())
	}
	var ts struct{ DOCX, PDF string }
	if err := json.Unmarshal(out, &ts); err != nil {
		t.Fatal(err)
	}
	if got, _ := DOCXText(docx); got != ts.DOCX {
		t.Errorf("docx\n go %q\n ts %q", got, ts.DOCX)
	}
	if got, _ := PDFText(pdf); got != ts.PDF {
		t.Errorf("pdf\n go %q\n ts %q", got, ts.PDF)
	}
}
