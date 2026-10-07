// Package ocr runs Tesseract, the engine tesseract.js compiles to wasm, as
// the `tesseract` CLI. Like the TS (lib/attachments/extract.ts,
// lib/recruitment/cv-extract.ts) it reads Indonesian and English (ind+eng),
// with the LSTM engine, a 120 s timeout and the image in a temporary file
// that is always removed.
//
// The runtime image installs tesseract-ocr with the eng and ind language
// packs (backend/Dockerfile). Locally: `brew install tesseract
// tesseract-lang` or `apt install tesseract-ocr tesseract-ocr-ind`.
package ocr

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// ErrNotInstalled means the tesseract binary is not on PATH (or at
// TESSERACT_BIN).
var ErrNotInstalled = errors.New("OCR tidak tersedia: program tesseract belum terpasang di server")

// ErrTimeout is the TS timeout message.
var ErrTimeout = errors.New("OCR timeout — file terlalu besar atau rumit")

// Tesseract runs the CLI. The zero value is not usable; call New.
type Tesseract struct {
	// Bin is the executable, TESSERACT_BIN or "tesseract".
	Bin string
	// Langs are joined with "+" for -l.
	Langs []string
	// Timeout bounds one recognition.
	Timeout time.Duration
	// TempDir holds the input file; "" is os.TempDir().
	TempDir string
}

// New returns the TS configuration: ind+eng, 120 s.
func New() *Tesseract {
	bin := os.Getenv("TESSERACT_BIN")
	if bin == "" {
		bin = "tesseract"
	}
	return &Tesseract{Bin: bin, Langs: []string{"ind", "eng"}, Timeout: 120 * time.Second}
}

// Available reports whether the binary can be found.
func (t *Tesseract) Available() bool {
	_, err := exec.LookPath(t.Bin)
	return err == nil
}

// Recognize writes data to a temporary file named with ext (".png") and
// returns the recognized text. Tesseract reads JPEG, PNG, WebP, BMP, TIFF
// and GIF; a PDF fails as it does in tesseract.js, and callers fall back to
// the PDF's own text.
func (t *Tesseract) Recognize(ctx context.Context, data []byte, ext string) (string, error) {
	bin, err := exec.LookPath(t.Bin)
	if err != nil {
		return "", ErrNotInstalled
	}
	tmp, err := os.CreateTemp(t.TempDir, "arkiv-ocr-*"+ext)
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	_, werr := tmp.Write(data)
	if cerr := tmp.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		return "", werr
	}

	ctx, cancel := context.WithTimeout(ctx, t.Timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, tmp.Name(), "stdout", "-l", strings.Join(t.Langs, "+"), "--oem", "1")
	// One thread per process: concurrent requests would otherwise
	// oversubscribe the CPU through OpenMP.
	cmd.Env = append(os.Environ(), "OMP_THREAD_LIMIT=1")
	cmd.WaitDelay = time.Second
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "", ErrTimeout
		}
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", fmt.Errorf("tesseract: %w: %s", err, lastLine(stderr.String()))
	}
	// The CLI ends each page with a form feed; tesseract.js does not.
	return strings.ReplaceAll(stdout.String(), "\f", ""), nil
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return lines[len(lines)-1]
}
