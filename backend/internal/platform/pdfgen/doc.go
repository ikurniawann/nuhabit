// Package pdfgen builds PDFs the way the TS generators use pdfkit
// (payslips, contracts, quotations, invoices, candidate and attendance
// reports): points as the unit, the standard Helvetica fonts, pdfkit's text
// box model (y is the top of the first line, lines advance by the font's
// line height, text wraps at a width and flows onto new pages), filled
// rectangles, rules, images fitted into boxes and page footers written after
// the content. It also stamps watermarks on existing PDFs (Watermark).
//
// Text goes through the standard fonts' WinAnsi (cp1252) encoding like
// pdfkit's: "ü", "—", "–", "·" and "…" print, characters outside cp1252
// print as ".".
package pdfgen

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-pdf/fpdf"
)

// Font is a standard PDF font.
type Font string

const (
	Helvetica        Font = "Helvetica"
	HelveticaBold    Font = "Helvetica-Bold"
	HelveticaOblique Font = "Helvetica-Oblique"
)

// metrics are pdfkit's ascender and line height (ascender - descender +
// lineGap from the AFM bounding box) per 1pt of font size.
var metrics = map[Font]struct{ ascent, lineHeight float64 }{
	Helvetica:        {0.718, 1.156},
	HelveticaBold:    {0.718, 1.190},
	HelveticaOblique: {0.718, 1.156},
}

func (f Font) fpdf() (family, style string) {
	switch f {
	case HelveticaBold:
		return "Helvetica", "B"
	case HelveticaOblique:
		return "Helvetica", "I"
	}
	return "Helvetica", ""
}

// Options are new PDFDocument({size, layout, margin, info}).
type Options struct {
	// Size is a page size name ("A4", "Letter", "A5"); empty is A4.
	Size      string
	Landscape bool
	// Margin applies to all four sides; pdfkit's default is 72.
	Margin float64
	Title  string
	// Now stamps the creation date; zero is time.Now().
	Now time.Time
}

// Doc is a PDF being written. X and Y are pdfkit's doc.x and doc.y.
type Doc struct {
	pdf    *fpdf.Fpdf
	tr     func(string) string
	margin float64
	font   Font
	size   float64
	images int
	// footer is set while EachPage runs: text may enter the bottom margin.
	footer bool
	X, Y   float64
}

// New starts a document with one page, Helvetica 12pt and black text.
func New(o Options) *Doc {
	orientation := "P"
	if o.Landscape {
		orientation = "L"
	}
	size := o.Size
	if size == "" {
		size = "A4"
	}
	margin := o.Margin
	if margin == 0 {
		margin = 72
	}
	pdf := fpdf.New(orientation, "pt", size, "")
	pdf.SetMargins(margin, margin, margin)
	pdf.SetAutoPageBreak(false, margin)
	if o.Title != "" {
		pdf.SetTitle(o.Title, true)
	}
	now := o.Now
	if now.IsZero() {
		now = time.Now()
	}
	pdf.SetCreationDate(now)
	pdf.SetProducer("NüHabit", true)
	d := &Doc{pdf: pdf, tr: pdf.UnicodeTranslatorFromDescriptor(""), margin: margin}
	d.AddPage()
	d.Font(Helvetica, 12).Color("#000000")
	return d
}

// AddPage starts a new page and moves the cursor to the top-left margin.
func (d *Doc) AddPage() {
	d.pdf.AddPage()
	d.X, d.Y = d.margin, d.margin
}

// PageWidth and PageHeight are the current page's size in points.
func (d *Doc) PageWidth() float64  { w, _ := d.pdf.GetPageSize(); return w }
func (d *Doc) PageHeight() float64 { _, h := d.pdf.GetPageSize(); return h }

// Left, Right and Bottom are the margin edges (Right = width - margin).
func (d *Doc) Left() float64   { return d.margin }
func (d *Doc) Right() float64  { return d.PageWidth() - d.margin }
func (d *Doc) Bottom() float64 { return d.PageHeight() - d.margin }

// ContentWidth is the width between the margins.
func (d *Doc) ContentWidth() float64 { return d.Right() - d.Left() }

// Font sets the font and size, like doc.font(name).fontSize(size).
func (d *Doc) Font(f Font, size float64) *Doc {
	d.font, d.size = f, size
	family, style := f.fpdf()
	d.pdf.SetFont(family, style, size)
	return d
}

// Color sets the text color from "#rrggbb", like doc.fillColor for text.
func (d *Doc) Color(hex string) *Doc {
	r, g, b := rgb(hex)
	d.pdf.SetTextColor(r, g, b)
	return d
}

// LineHeight is pdfkit's currentLineHeight(true) for the current font.
func (d *Doc) LineHeight() float64 { return metrics[d.font].lineHeight * d.size }

// MoveDown is doc.moveDown(lines).
func (d *Doc) MoveDown(lines float64) { d.Y += lines * d.LineHeight() }

// Align is a text alignment within its width.
type Align string

const (
	AlignLeft   Align = "left"
	AlignCenter Align = "center"
	AlignRight  Align = "right"
	// AlignJustify stretches every line but the last of a paragraph to the
	// width by widening its spaces, like pdfkit's align: "justify".
	AlignJustify Align = "justify"
)

// TextOpts are doc.text options.
type TextOpts struct {
	// Width wraps the text; 0 wraps at the right margin.
	Width float64
	Align Align
	// NoWrap is lineBreak: false, one line however long.
	NoWrap bool
	// Height caps the lines drawn; with Ellipsis the last kept line ends
	// in "…" when text was cut.
	Height   float64
	Ellipsis bool
	// LineGap is pdfkit's lineGap: extra points below every line.
	LineGap float64
}

// Text is doc.text(s, x, y, opts): y is the top of the first line. Lines
// that would pass the bottom margin continue at the top of a new page
// unless Height is set. It leaves Y below the last line, X at x, and
// returns Y.
func (d *Doc) Text(s string, x, y float64, o TextOpts) float64 {
	width := o.Width
	if width <= 0 {
		width = d.PageWidth() - d.margin - x
	}
	lines, paraEnds := []string{s}, []bool{true}
	if !o.NoWrap {
		lines, paraEnds = d.wrap(s, width)
	}
	lh := d.LineHeight()
	if o.Height > 0 {
		maxLines := max(1, int((o.Height+0.0001)/lh))
		if len(lines) > maxLines {
			lines = lines[:maxLines]
			if o.Ellipsis {
				lines[maxLines-1] = d.ellipsize(lines[maxLines-1], width)
			}
		}
	}
	for i, line := range lines {
		if o.Height == 0 && !d.footer && y+lh > d.Bottom() && y > d.margin {
			d.AddPage()
			y = d.margin
		}
		lx, spacing := x, 0.0
		switch o.Align {
		case AlignRight:
			lx = x + width - d.StringWidth(line)
		case AlignCenter:
			lx = x + (width-d.StringWidth(line))/2
		case AlignJustify:
			if spaces := strings.Count(line, " "); spaces > 0 && !paraEnds[i] {
				spacing = (width - d.StringWidth(line)) / float64(spaces)
			}
		}
		if spacing > 0 {
			d.pdf.SetWordSpacing(spacing)
		}
		d.pdf.Text(lx, y+metrics[d.font].ascent*d.size, d.tr(line))
		if spacing > 0 {
			d.pdf.SetWordSpacing(0)
		}
		y += lh + o.LineGap
	}
	d.X, d.Y = x, y
	return y
}

// Para writes text at the left margin and the current Y, like
// doc.text(s) with no position.
func (d *Doc) Para(s string, o TextOpts) float64 { return d.Text(s, d.margin, d.Y, o) }

// HeightOf is doc.heightOfString(s, {width}).
func (d *Doc) HeightOf(s string, width float64) float64 {
	return float64(len(d.Wrap(s, width))) * d.LineHeight()
}

// StringWidth is doc.widthOfString(s) in the current font.
func (d *Doc) StringWidth(s string) float64 { return d.pdf.GetStringWidth(d.tr(s)) }

// Wrap splits s into lines no wider than width, breaking at "\n", after
// spaces and hyphens, and inside words longer than the width.
func (d *Doc) Wrap(s string, width float64) []string {
	lines, _ := d.wrap(s, width)
	return lines
}

// wrap is Wrap that also marks the last line of each paragraph.
func (d *Doc) wrap(s string, width float64) (lines []string, paraEnds []bool) {
	add := func(line string, end bool) {
		lines, paraEnds = append(lines, line), append(paraEnds, end)
	}
	for _, para := range strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n") {
		line := ""
		for _, tok := range breakTokens(para) {
			if d.StringWidth(strings.TrimRight(line+tok, " ")) <= width {
				line += tok
				continue
			}
			if line != "" {
				add(strings.TrimRight(line, " "), false)
			}
			for d.StringWidth(strings.TrimRight(tok, " ")) > width {
				n := d.fitRunes(tok, width)
				add(tok[:n], false)
				tok = tok[n:]
			}
			line = tok
		}
		add(strings.TrimRight(line, " "), true)
	}
	return lines, paraEnds
}

// breakTokens splits after every run of spaces and after each hyphen.
func breakTokens(s string) []string {
	var toks []string
	start := 0
	for i := 0; i < len(s); i++ {
		end := s[i] == '-' || s[i] == ' ' && (i+1 == len(s) || s[i+1] != ' ')
		if end {
			toks = append(toks, s[start:i+1])
			start = i + 1
		}
	}
	if start < len(s) {
		toks = append(toks, s[start:])
	}
	return toks
}

// fitRunes is the byte length of the longest rune prefix of s within
// width, at least one rune.
func (d *Doc) fitRunes(s string, width float64) int {
	n := 0
	for i, r := range s {
		next := i + len(string(r))
		if n > 0 && d.StringWidth(s[:next]) > width {
			break
		}
		n = next
	}
	return n
}

func (d *Doc) ellipsize(line string, width float64) string {
	for line != "" && d.StringWidth(line+"…") > width {
		_, size := utf8.DecodeLastRuneInString(line)
		line = line[:len(line)-size]
	}
	return strings.TrimRight(line, " ") + "…"
}

// Rect fills a rectangle, like doc.rect(x, y, w, h).fill(hex).
func (d *Doc) Rect(x, y, w, h float64, fill string) {
	r, g, b := rgb(fill)
	d.pdf.SetFillColor(r, g, b)
	d.pdf.Rect(x, y, w, h, "F")
}

// RoundedRect is doc.roundedRect(x, y, w, h, r).fillAndStroke(fill,
// stroke) with a 1pt line.
func (d *Doc) RoundedRect(x, y, w, h, r float64, fill, stroke string) {
	fr, fg, fb := rgb(fill)
	d.pdf.SetFillColor(fr, fg, fb)
	d.stroke(stroke, 1)
	d.pdf.RoundedRect(x, y, w, h, r, "1234", "FD")
}

// Line strokes a segment, like moveTo().lineTo().strokeColor().lineWidth().stroke().
func (d *Doc) Line(x1, y1, x2, y2 float64, stroke string, lineWidth float64) {
	d.stroke(stroke, lineWidth)
	d.pdf.Line(x1, y1, x2, y2)
}

// HLine rules from margin to margin at y.
func (d *Doc) HLine(y float64, stroke string, lineWidth float64) {
	d.Line(d.Left(), y, d.Right(), y, stroke, lineWidth)
}

func (d *Doc) stroke(hex string, width float64) {
	r, g, b := rgb(hex)
	d.pdf.SetDrawColor(r, g, b)
	d.pdf.SetLineWidth(width)
}

// EnsureSpace adds a page when h more points do not fit above the bottom
// margin, and reports whether it did.
func (d *Doc) EnsureSpace(h float64) bool {
	if d.Y+h <= d.Bottom() {
		return false
	}
	d.AddPage()
	return true
}

// PageCount is the number of pages so far.
func (d *Doc) PageCount() int { return d.pdf.PageCount() }

// EachPage revisits every page in order, like bufferedPageRange() +
// switchToPage(i), for footers such as "Halaman 1 dari 3". Text may go
// into the bottom margin while fn runs. The last page stays current.
func (d *Doc) EachPage(fn func(page, total int)) {
	total := d.PageCount()
	d.footer = true
	defer func() { d.footer = false }()
	for i := 1; i <= total; i++ {
		d.pdf.SetPage(i)
		fn(i, total)
	}
}

// Bytes finishes the document.
func (d *Doc) Bytes() ([]byte, error) {
	var buf bytes.Buffer
	if err := d.pdf.Output(&buf); err != nil {
		return nil, fmt.Errorf("pdfgen: %w", err)
	}
	return buf.Bytes(), nil
}

// rgb parses "#rrggbb" or "#rgb"; anything else is black.
func rgb(hex string) (int, int, int) {
	h := strings.TrimPrefix(hex, "#")
	if len(h) == 3 {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	v, err := strconv.ParseUint(h, 16, 32)
	if len(h) != 6 || err != nil {
		return 0, 0, 0
	}
	return int(v >> 16), int(v >> 8 & 0xff), int(v & 0xff)
}
