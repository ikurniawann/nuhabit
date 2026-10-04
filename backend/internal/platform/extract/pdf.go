package extract

import (
	"bytes"
	"fmt"
	"math"
	"strings"
	"unicode"

	"github.com/ledongthuc/pdf"
)

// PDFText is unpdf's extractText(data, {mergePages: true}): the text of
// every page in content order, pages joined by "\n", then every run of
// whitespace collapsed to one space, so the result is a single line.
// Glyphs placed apart get a space when the gap exceeds a fifth of the font
// size, as pdf.js does. Encrypted PDFs with a user password and malformed
// files return an error.
func PDFText(data []byte) (text string, err error) {
	defer func() {
		if r := recover(); r != nil {
			text, err = "", fmt.Errorf("extract: unreadable PDF: %v", r)
		}
	}()
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("extract: %w", err)
	}
	pages := make([]string, 0, r.NumPage())
	for i := 1; i <= r.NumPage(); i++ {
		p := r.Page(i)
		if p.V.IsNull() {
			continue
		}
		pages = append(pages, pageText(onPage(p, p.Content().Text)))
	}
	return collapseSpace(strings.Join(pages, "\n")), nil
}

// collapseSpace is s.replace(/\s+/g, " ").
func collapseSpace(s string) string {
	var b strings.Builder
	inSpace := false
	for _, r := range s {
		if unicode.IsSpace(r) || r == '\ufeff' {
			if !inSpace {
				b.WriteByte(' ')
			}
			inSpace = true
			continue
		}
		inSpace = false
		b.WriteRune(r)
	}
	return b.String()
}

// onPage drops glyphs placed outside the media box, which pdf.js leaves
// out (a tiled watermark runs past the page edges).
func onPage(p pdf.Page, glyphs []pdf.Text) []pdf.Text {
	var box pdf.Value
	for v := p.V; !v.IsNull() && box.IsNull(); v = v.Key("Parent") {
		box = v.Key("MediaBox")
	}
	if box.Len() != 4 {
		return glyphs
	}
	x0, y0, x1, y1 := box.Index(0).Float64(), box.Index(1).Float64(), box.Index(2).Float64(), box.Index(3).Float64()
	out := glyphs[:0]
	for _, g := range glyphs {
		if g.X >= x0 && g.X <= x1 && g.Y >= y0 && g.Y <= y1 {
			out = append(out, g)
		}
	}
	return out
}

// pageText joins glyphs in content order into lines.
func pageText(glyphs []pdf.Text) string {
	var b strings.Builder
	var prev *pdf.Text
	for i := range glyphs {
		g := &glyphs[i]
		if g.S == "" {
			continue
		}
		if prev != nil {
			size := math.Max(math.Abs(g.FontSize), 1)
			switch {
			case math.Abs(g.Y-prev.Y) > size/2:
				b.WriteByte('\n')
			case g.X-(prev.X+prev.W) > size/5 && !isSpace(prev.S) && !isSpace(g.S):
				b.WriteByte(' ')
			}
		}
		b.WriteString(g.S)
		prev = g
	}
	return b.String()
}

func isSpace(s string) bool { return strings.TrimSpace(s) == "" }
