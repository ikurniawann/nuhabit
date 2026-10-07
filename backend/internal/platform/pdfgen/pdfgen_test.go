package pdfgen

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"

	"nuhabit/backend/internal/platform/extract"
)

func TestMoney(t *testing.T) {
	for v, want := range map[float64]string{0: "0", 950: "950", 1250000: "1.250.000", 4500000.5: "4.500.000,5", -5000: "-5.000", 1234.5678: "1.234,568"} {
		if got := Thousands(v); got != want {
			t.Errorf("Thousands(%v) = %q want %q", v, got, want)
		}
	}
	if Rupiah(1250000.4) != "Rp1.250.000" || Rupiah(-4999.5) != "-Rp4.999" || Rupiah(2.5) != "Rp3" {
		t.Errorf("Rupiah: %q %q %q", Rupiah(1250000.4), Rupiah(-4999.5), Rupiah(2.5))
	}
	if RupiahSpaced(4500000) != "Rp 4.500.000" || RupiahSpaced(-5000) != "Rp -5.000" {
		t.Errorf("RupiahSpaced %q", RupiahSpaced(-5000))
	}
	for v, want := range map[float64]string{
		1: "satu rupiah", 11: "sebelas rupiah", 17: "tujuh belas rupiah", 45: "empat puluh lima rupiah",
		100: "seratus rupiah", 250: "dua ratus lima puluh rupiah", 1000: "seribu rupiah", 4500: "empat ribu lima ratus rupiah",
		4_500_000: "empat juta lima ratus ribu rupiah", 12_750_000: "dua belas juta tujuh ratus lima puluh ribu rupiah",
		1_000_000_000: "satu miliar rupiah", 0: "nol rupiah", -5: "nol rupiah",
	} {
		if got := Terbilang(v); got != want {
			t.Errorf("Terbilang(%v) = %q want %q", v, got, want)
		}
	}
}

func TestWatermarkText(t *testing.T) {
	at := time.Date(2026, 10, 5, 7, 30, 0, 0, time.UTC)
	if got := WatermarkText(" ", "NüHabit", at); got != "NüHabit - 05/10/2026 14.30" {
		t.Fatal(got)
	}
	if got := WatermarkText("budi@example.com", "x", at); got != "budi@example.com - 05/10/2026 14.30" {
		t.Fatal(got)
	}
}

// samplePDF is a two-page payslip-like document exercising every helper.
func samplePDF(t *testing.T) []byte {
	d := New(Options{Margin: 48, Title: "Slip Gaji — Oktober 2026", Now: time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)})
	d.Font(HelveticaBold, 13).Color("#111827").Para("PT NüHabit Indonesia", TextOpts{})
	d.Font(Helvetica, 8.5).Color("#6b7280").Para("Jl. Contoh No. 1 · Bandung", TextOpts{})
	d.HLine(d.Y+4, "#d1d5db", 0.7)
	d.Y += 12
	d.Font(Helvetica, 10).Color("#111827")
	d.Text("Gaji pokok", d.Left(), d.Y, TextOpts{NoWrap: true})
	d.Text(RupiahSpaced(4500000), d.Right()-120, d.Y-d.LineHeight(), TextOpts{Width: 120, Align: AlignRight})
	d.Text("Terbilang: "+Terbilang(4500000), d.Left(), d.Y+6, TextOpts{Width: 200})
	d.Rect(d.Left(), d.Y+6, d.ContentWidth(), 30, "#f3f5fa")
	d.RoundedRect(d.Left(), d.Y+40, d.ContentWidth(), 34, 5, "#f3f4f6", "#d1d5db")

	img := image.NewNRGBA(image.Rect(0, 0, 40, 30))
	for i := range img.Pix {
		img.Pix[i] = 200
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	if err := d.Image(buf.Bytes(), d.Left(), d.Y+80, 92, 62); err != nil {
		t.Fatal(err)
	}
	if err := d.Image([]byte("broken"), d.Left(), d.Y+40, 92, 62); err == nil {
		t.Fatal("broken image accepted")
	}
	d.Y += 160
	var rows [][]string
	for i := 0; i < 60; i++ {
		rows = append(rows, []string{strconv.Itoa(i + 1), "Kopi susu gula aren dengan catatan panjang yang harus dibungkus ke baris berikutnya", Rupiah(float64(18000 * (i + 1)))})
	}
	d.DrawTable(Table{Columns: []Column{{"No", 30, AlignLeft}, {"Item", 300, AlignLeft}, {"Total", 100, AlignRight}}, Zebra: "#f3f5fa"}, rows)
	d.EachPage(func(page, total int) {
		d.Font(Helvetica, 7.5).Color("#6b7280")
		d.Text("NüHabit HRIS · Halaman "+strconv.Itoa(page)+" dari "+strconv.Itoa(total), d.Left(), d.PageHeight()-36, TextOpts{Width: d.ContentWidth(), Align: AlignCenter})
	})
	out, err := d.Bytes()
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestDocument(t *testing.T) {
	data := samplePDF(t)
	conf := model.NewStatelessConfiguration()
	n, err := api.PageCount(context.Background(), bytes.NewReader(data), conf)
	if err != nil || n < 2 {
		t.Fatalf("pages %d %v", n, err)
	}
	text := pdftotext(t, data)
	for _, want := range []string{"PT NüHabit Indonesia", "Rp 4.500.000", "empat juta lima ratus ribu rupiah", "Halaman 1 dari " + strconv.Itoa(n), "Rp1.080.000"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestWatermarkPDF(t *testing.T) {
	src := samplePDF(t)
	landscape := New(Options{Landscape: true, Margin: 36})
	landscape.Para("Halaman lanskap", TextOpts{})
	ls, _ := landscape.Bytes()
	conf := model.NewStatelessConfiguration()
	var merged bytes.Buffer
	if err := api.MergeRaw(context.Background(), []io.ReadSeeker{bytes.NewReader(src), bytes.NewReader(ls)}, &merged, false, conf); err != nil {
		t.Fatal(err)
	}
	out, err := Watermark(context.Background(), merged.Bytes(), "budi@example.com - 05/10/2026 14.30 ü")
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("PDFGEN_DUMP") != "" {
		_ = os.WriteFile(filepath.Join(os.Getenv("PDFGEN_DUMP"), "watermarked.pdf"), out, 0o644)
		_ = os.WriteFile(filepath.Join(os.Getenv("PDFGEN_DUMP"), "sample.pdf"), src, 0o644)
	}
	before, _ := api.PageCount(context.Background(), bytes.NewReader(merged.Bytes()), conf)
	after, err := api.PageCount(context.Background(), bytes.NewReader(out), conf)
	if err != nil || after != before {
		t.Fatalf("pages %d -> %d (%v)", before, after, err)
	}
	if ok, err := api.HasWatermarks(context.Background(), bytes.NewReader(out), conf); !ok || err != nil {
		t.Fatalf("no watermark: %v", err)
	}
	if text := pdftotext(t, out); !strings.Contains(text, "PT NüHabit Indonesia") {
		t.Fatal("content text lost")
	}
	if _, err := Watermark(context.Background(), []byte("%PDF-1.4 garbage"), "x"); err == nil {
		t.Fatal("garbage PDF accepted")
	}
}

// TestPdfkitTextParity draws the same text with pdfkit under Node and with
// Doc, then compares word boxes from pdftotext -bbox: positions must agree
// within a point (pdfkit kerns the standard fonts, fpdf does not) and
// lines within half a point. Skips without node, pdfkit or poppler.
func TestPdfkitTextParity(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	_, here, _, _ := runtime.Caller(0)
	frontend, _ := filepath.Abs(filepath.Join(filepath.Dir(here), "..", "..", "..", "..", "frontend"))
	if _, err := os.Stat(filepath.Join(frontend, "node_modules", "pdfkit")); err != nil {
		t.Skip("pdfkit not installed")
	}
	long := "Pihak Kedua bersedia ditempatkan di seluruh outlet perusahaan sesuai kebutuhan operasional."
	script := `
const PDFDocument = (await import("pdfkit")).default;
const doc = new PDFDocument({ size: "A4", margin: 48 });
const chunks = []; doc.on("data", (c) => chunks.push(c));
const done = new Promise((r) => doc.on("end", () => r(Buffer.concat(chunks))));
doc.font("Helvetica-Bold").fontSize(13).text("Slip Gaji Karyawan", 48, 48);
doc.font("Helvetica").fontSize(10).text(process.argv[1], 48, 100, { width: 200 });
doc.font("Helvetica").fontSize(10).text("Rp 4.500.000", 300, 200, { width: 120, align: "right" });
doc.font("Helvetica").fontSize(9).text("Tengah", 48, 260, { width: 300, align: "center" });
doc.end();
process.stdout.write((await done).toString("base64"));
`
	cmd := exec.Command(node, "--no-warnings", "--input-type=module", "-e", script, long)
	cmd.Dir = frontend
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	b64, err := cmd.Output()
	if err != nil {
		t.Fatalf("node: %v %s", err, stderr.String())
	}
	tsPDF, err := base64.StdEncoding.DecodeString(string(b64))
	if err != nil {
		t.Fatal(err)
	}

	d := New(Options{Margin: 48})
	d.Font(HelveticaBold, 13).Text("Slip Gaji Karyawan", 48, 48, TextOpts{})
	d.Font(Helvetica, 10).Text(long, 48, 100, TextOpts{Width: 200})
	d.Font(Helvetica, 10).Text("Rp 4.500.000", 300, 200, TextOpts{Width: 120, Align: AlignRight})
	d.Font(Helvetica, 9).Text("Tengah", 48, 260, TextOpts{Width: 300, Align: AlignCenter})
	goPDF, _ := d.Bytes()

	tsWords, goWords := wordBoxes(t, tsPDF), wordBoxes(t, goPDF)
	if len(tsWords) != len(goWords) {
		t.Fatalf("words: pdfkit %d, go %d\n%v\n%v", len(tsWords), len(goWords), tsWords, goWords)
	}
	for i := range tsWords {
		ts, g := tsWords[i], goWords[i]
		if ts.text != g.text || abs(ts.x-g.x) > 1 || abs(ts.y-g.y) > 0.5 {
			t.Errorf("word %d: pdfkit %+v go %+v", i, ts, g)
		}
	}
}

type word struct {
	text string
	x, y float64
}

var wordRe = regexp.MustCompile(`<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)</word>`)

func wordBoxes(t *testing.T, pdf []byte) []word {
	t.Helper()
	html := poppler(t, "-bbox", pdf)
	var out []word
	for _, m := range wordRe.FindAllStringSubmatch(html, -1) {
		x, _ := strconv.ParseFloat(m[1], 64)
		y, _ := strconv.ParseFloat(m[2], 64)
		out = append(out, word{m[3], x, y})
	}
	return out
}

func pdftotext(t *testing.T, pdf []byte) string {
	return poppler(t, "-layout", pdf)
}

func poppler(t *testing.T, mode string, pdf []byte) string {
	t.Helper()
	bin, err := exec.LookPath("pdftotext")
	if err != nil {
		t.Skip("pdftotext (poppler) not installed")
	}
	cmd := exec.Command(bin, "-enc", "UTF-8", mode, "-", "-")
	cmd.Stdin = bytes.NewReader(pdf)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("pdftotext: %v", err)
	}
	return string(out)
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func TestJustify(t *testing.T) {
	const para = "Pihak Kedua bersedia ditempatkan di lokasi kerja yang ditentukan oleh Pihak Pertama dan menjalankan " +
		"tugas sesuai uraian jabatan, peraturan perusahaan serta arahan atasan langsung.\nBaris baru tetap rata kiri."
	build := func(align Align) (*Doc, []byte) {
		d := New(Options{Margin: 56, Now: time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)})
		d.pdf.SetCompression(false)
		d.Font(Helvetica, 10)
		d.Para(para, TextOpts{Width: 300, Align: align})
		data, err := d.Bytes()
		if err != nil {
			t.Fatal(err)
		}
		return d, data
	}
	d, justified := build(AlignJustify)
	_, left := build(AlignLeft)

	// Every wrapped line but the last of each paragraph gets word spacing
	// that stretches it to the width; paragraph ends stay flush left.
	lines := d.Wrap(para, 300)
	spaced := regexp.MustCompile(`([0-9.]+) Tw`).FindAllStringSubmatch(string(justified), -1)
	var set int
	for _, m := range spaced {
		if v, _ := strconv.ParseFloat(m[1], 64); v > 0 {
			set++
		}
	}
	if paragraphEnds := 2; set != len(lines)-paragraphEnds || set == 0 {
		t.Fatalf("%d lines, %d justified", len(lines), set)
	}
	if strings.Contains(string(left), " Tw") {
		t.Fatal("left-aligned text sets word spacing")
	}

	gotJustified, err := extract.PDFText(justified)
	if err != nil {
		t.Fatal(err)
	}
	gotLeft, _ := extract.PDFText(left)
	if gotJustified != gotLeft || !strings.Contains(gotJustified, "uraian jabatan, peraturan perusahaan") {
		t.Fatalf("text order changed:\n%s\n%s", gotJustified, gotLeft)
	}
}
