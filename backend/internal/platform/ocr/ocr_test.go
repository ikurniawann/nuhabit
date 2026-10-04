package ocr

import (
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// fakeTesseract writes a shell script standing in for the CLI.
func fakeTesseract(t *testing.T, body string) *Tesseract {
	if runtime.GOOS == "windows" {
		t.Skip("shell script")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "tesseract")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"+body), 0o755); err != nil {
		t.Fatal(err)
	}
	tess := New()
	tess.Bin = bin
	tess.TempDir = t.TempDir()
	return tess
}

func TestRecognizeArgsAndCleanup(t *testing.T) {
	tess := fakeTesseract(t, `[ -f "$1" ] || exit 9; echo "file=$(basename "$1") out=$2 $3 $4 $5 $6 omp=$OMP_THREAD_LIMIT"; printf '\f'`)
	text, err := tess.Recognize(context.Background(), []byte("img"), ".png")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "out=stdout -l ind+eng --oem 1 omp=1") || !strings.Contains(text, ".png") || strings.Contains(text, "\f") {
		t.Fatalf("%q", text)
	}
	if left, _ := os.ReadDir(tess.TempDir); len(left) != 0 {
		t.Fatalf("temp file left behind: %v", left)
	}
}

func TestRecognizeErrors(t *testing.T) {
	tess := fakeTesseract(t, `echo "Error in pixReadStream: Unknown format" >&2; exit 1`)
	if _, err := tess.Recognize(context.Background(), []byte("%PDF"), ".pdf"); err == nil || !strings.Contains(err.Error(), "Unknown format") {
		t.Fatalf("%v", err)
	}
	slow := fakeTesseract(t, `exec sleep 5`)
	slow.Timeout = 100 * time.Millisecond
	if _, err := slow.Recognize(context.Background(), []byte("x"), ".png"); !errors.Is(err, ErrTimeout) {
		t.Fatalf("%v", err)
	}
	missing := New()
	missing.Bin = "tesseract-does-not-exist"
	if _, err := missing.Recognize(context.Background(), nil, ".png"); !errors.Is(err, ErrNotInstalled) || missing.Available() {
		t.Fatalf("%v", err)
	}
}

// TestRealTesseract reads rendered text with the installed engine. It
// skips when tesseract or the ind language pack is missing.
func TestRealTesseract(t *testing.T) {
	tess := New()
	if !tess.Available() {
		t.Skip("tesseract not installed")
	}
	img := image.NewGray(image.Rect(0, 0, 900, 120))
	for i := range img.Pix {
		img.Pix[i] = 255
	}
	f, _ := opentype.Parse(goregular.TTF)
	face, _ := opentype.NewFace(f, &opentype.FaceOptions{Size: 40, DPI: 72})
	d := font.Drawer{Dst: img, Src: image.NewUniform(color.Black), Face: face, Dot: fixed.P(20, 75)}
	d.DrawString("Faktur Pajak Rp 1.250.000")
	path := filepath.Join(t.TempDir(), "in.png")
	out, _ := os.Create(path)
	_ = png.Encode(out, img)
	_ = out.Close()
	data, _ := os.ReadFile(path)

	text, err := tess.Recognize(context.Background(), data, ".png")
	if err != nil {
		if strings.Contains(err.Error(), "ind") {
			t.Skip("ind language data missing: " + err.Error())
		}
		t.Fatal(err)
	}
	if !strings.Contains(text, "Faktur Pajak") || !strings.Contains(text, "1.250.000") {
		t.Fatalf("recognized %q", text)
	}
}
