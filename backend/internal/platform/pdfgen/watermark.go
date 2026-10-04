package pdfgen

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

var wib = time.FixedZone("WIB", 7*3600)

// WatermarkText is buildWatermarkText in lib/dataroom/watermark.ts:
// "<label> - 05/10/2026 14.30" in Jakarta time. label falls back to brand;
// callers pass the brand name (brandName()) for the last fallback.
func WatermarkText(label, brand string, at time.Time) string {
	l := strings.TrimSpace(label)
	if l == "" {
		l = strings.TrimSpace(brand)
	}
	return l + " - " + at.In(wib).Format("02/01/2006 15.04")
}

// Watermark is applyPdfWatermark: every page gets text repeated in a grid,
// rotated 30°, Helvetica-Bold at max(10, min(w, h)/22) pt, gray 25% at 20%
// opacity, over the content. Characters outside printable ASCII become "-"
// as the TS does for the standard font. The source file is not changed.
//
// pdf-lib drew into each page's content stream; here pdfcpu stamps a page
// rendered by fpdf (one per distinct page size), with the same geometry.
// Pages with /Rotate get the grid in their displayed orientation.
func Watermark(ctx context.Context, data []byte, text string) ([]byte, error) {
	conf := model.NewStatelessConfiguration()
	pctx, err := api.ReadValidateAndOptimize(ctx, bytes.NewReader(data), conf, nil)
	if err != nil {
		return nil, fmt.Errorf("pdfgen: watermark: %w", err)
	}
	dims, err := pctx.PageDims(ctx)
	if err != nil {
		return nil, fmt.Errorf("pdfgen: watermark: %w", err)
	}

	// One overlay page per distinct page size.
	sizeIndex := map[types.Dim]int{}
	var sizes []types.Dim
	for _, d := range dims {
		if _, ok := sizeIndex[d]; !ok {
			sizes = append(sizes, d)
			sizeIndex[d] = len(sizes)
		}
	}
	overlay, err := watermarkOverlay(sizes, asciiOnly(text))
	if err != nil {
		return nil, err
	}

	stamps := make(map[int]*model.Watermark, len(dims))
	for i, d := range dims {
		wm, err := pdfcpu.ParsePDFWatermarkDetails(ctx, "", "scalefactor:1 abs, rotation:0, opacity:1", true, types.POINTS, conf)
		if err != nil {
			return nil, err
		}
		wm.PDF = bytes.NewReader(overlay)
		wm.PdfPageNrSrc = sizeIndex[d]
		stamps[i+1] = wm
	}
	if err := pdfcpu.AddWatermarksMap(ctx, pctx, stamps); err != nil {
		return nil, fmt.Errorf("pdfgen: watermark: %w", err)
	}
	var out bytes.Buffer
	if err := api.Write(ctx, pctx, &out, conf); err != nil {
		return nil, fmt.Errorf("pdfgen: watermark: %w", err)
	}
	return out.Bytes(), nil
}

// watermarkOverlay renders one transparent page per size holding the grid
// of applyPdfWatermark, in pdf-lib's bottom-left coordinates.
func watermarkOverlay(sizes []types.Dim, text string) ([]byte, error) {
	pdf := fpdf.NewCustom(&fpdf.InitType{UnitStr: "pt", Size: fpdf.SizeType{Wd: sizes[0].Width, Ht: sizes[0].Height}})
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetTextColor(64, 64, 64) // rgb(0.25, 0.25, 0.25)
	for _, d := range sizes {
		w, h := d.Width, d.Height
		pdf.AddPageFormat("P", fpdf.SizeType{Wd: w, Ht: h})
		size := math.Max(10, math.Min(w, h)/22)
		pdf.SetFont("Helvetica", "B", size)
		pdf.SetAlpha(0.2, "Normal")
		stepX := pdf.GetStringWidth(text) + size*3
		stepY := size * 6
		for y := -h; y < h*2; y += stepY {
			for x := -w; x < w*2; x += stepX {
				top := h - y // fpdf measures y from the top
				pdf.TransformBegin()
				pdf.TransformRotate(30, x, top)
				pdf.Text(x, top, text)
				pdf.TransformEnd()
			}
		}
	}
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, fmt.Errorf("pdfgen: watermark overlay: %w", err)
	}
	return buf.Bytes(), nil
}

// asciiOnly is text.replace(/[^\x20-\x7e]/g, "-"), one "-" per UTF-16 unit.
func asciiOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 0x20 && r <= 0x7e:
			b.WriteRune(r)
		case r > 0xffff:
			b.WriteString("--")
		default:
			b.WriteByte('-')
		}
	}
	return b.String()
}
