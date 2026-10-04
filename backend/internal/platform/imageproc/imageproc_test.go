package imageproc

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// withOrientation inserts an EXIF APP1 segment carrying orientation o
// after the SOI marker of a JPEG.
func withOrientation(jpg []byte, o uint16) []byte {
	tiff := []byte{'M', 'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0}
	binary.BigEndian.PutUint16(tiff[18:], o)
	payload := append([]byte("Exif\x00\x00"), tiff...)
	seg := []byte{0xff, 0xe1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2))
	out := append([]byte{}, jpg[:2]...)
	out = append(out, seg...)
	out = append(out, payload...)
	return append(out, jpg[2:]...)
}

// leftRed is a w x h image whose left half is red and right half blue.
func leftRed(w, h int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := color.NRGBA{0, 0, 255, 255}
			if x < w/2 {
				c = color.NRGBA{255, 0, 0, 255}
			}
			img.Set(x, y, c)
		}
	}
	return img
}

func TestDecodeAppliesOrientation(t *testing.T) {
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, leftRed(40, 20), &jpeg.Options{Quality: 95})
	data := withOrientation(buf.Bytes(), 6)
	if Orientation(data) != 6 {
		t.Fatalf("orientation %d", Orientation(data))
	}
	img, format, err := Decode(data)
	if err != nil || format != "jpeg" {
		t.Fatal(format, err)
	}
	if b := img.Bounds(); b.Dx() != 20 || b.Dy() != 40 {
		t.Fatalf("bounds %v", b)
	}
	// Rotated clockwise: the left (red) half ends up on top.
	if r, _, bl, _ := img.At(10, 5).RGBA(); r>>8 < 200 || bl>>8 > 60 {
		t.Fatalf("top is not red: %v", img.At(10, 5))
	}
	for o, want := range map[int]image.Point{2: {39, 0}, 3: {39, 19}, 4: {0, 19}, 5: {0, 0}, 7: {19, 39}, 8: {0, 39}} {
		src := image.NewNRGBA(image.Rect(0, 0, 40, 20))
		src.Set(0, 0, color.NRGBA{255, 255, 255, 255})
		if _, _, _, a := orient(src, o).At(want.X, want.Y).RGBA(); a == 0 {
			t.Errorf("orientation %d: origin pixel not at %v", o, want)
		}
	}
}

func TestFitInsideAndThumbnail(t *testing.T) {
	if b := FitInside(leftRed(2400, 1600), 1200, 1200).Bounds(); b.Dx() != 1200 || b.Dy() != 800 {
		t.Fatal(b)
	}
	if b := FitInside(leftRed(300, 900), 480, 0).Bounds(); b.Dx() != 300 || b.Dy() != 900 {
		t.Fatal("enlarged or resized", b)
	}
	transparent := image.NewNRGBA(image.Rect(0, 0, 10, 10))
	var buf bytes.Buffer
	_ = png.Encode(&buf, transparent)
	out, err := JPEGThumbnail(buf.Bytes(), ThumbnailOptions{MaxWidth: 1200, MaxHeight: 1200, Background: color.White, Quality: 85})
	if err != nil {
		t.Fatal(err)
	}
	img, _ := jpeg.Decode(bytes.NewReader(out))
	if r, g, b, _ := img.At(5, 5).RGBA(); r>>8 < 250 || g>>8 < 250 || b>>8 < 250 {
		t.Fatal("transparency not flattened to white")
	}
	webp, _ := os.ReadFile("testdata/red-64x32.webp")
	img2, format, err := Decode(webp)
	if err != nil || format != "webp" || img2.Bounds().Dx() != 64 {
		t.Fatal(format, err)
	}
	if _, _, err := Decode([]byte("not an image")); err == nil {
		t.Fatal("garbage decoded")
	}
}

func TestWatermark(t *testing.T) {
	var buf bytes.Buffer
	_ = png.Encode(&buf, leftRed(300, 200))
	out, mime, err := Watermark(buf.Bytes(), "image/png", "budi@example.com - 05/10/2026 14.30")
	if err != nil || mime != "image/png" {
		t.Fatal(mime, err)
	}
	img, _ := png.Decode(bytes.NewReader(out))
	if img.Bounds().Dx() != 300 || img.Bounds().Dy() != 200 {
		t.Fatal(img.Bounds())
	}
	changed := 0
	src := leftRed(300, 200)
	for y := 0; y < 200; y++ {
		for x := 0; x < 300; x++ {
			if img.At(x, y) != color.Color(src.At(x, y)) {
				r1, g1, b1, _ := img.At(x, y).RGBA()
				r2, g2, b2, _ := src.At(x, y).RGBA()
				if r1 != r2 || g1 != g2 || b1 != b2 {
					changed++
				}
			}
		}
	}
	if frac := float64(changed) / 60000; frac < 0.03 || frac > 0.6 {
		t.Fatalf("watermark covers %.2f of the image", frac)
	}
	webp, _ := os.ReadFile("testdata/red-64x32.webp")
	if _, mime, err := Watermark(webp, "image/webp", "x"); err != nil || mime != "image/jpeg" {
		t.Fatal(mime, err)
	}
}

// TestSharpParity runs the TS sharp pipelines (gofood-image and the
// attendance photo compression) on the same inputs under Node and compares
// size and pixels with JPEGThumbnail. Skips without node and sharp.
func TestSharpParity(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	_, here, _, _ := runtime.Caller(0)
	frontend, _ := filepath.Abs(filepath.Join(filepath.Dir(here), "..", "..", "..", "..", "frontend"))
	if _, err := os.Stat(filepath.Join(frontend, "node_modules", "sharp")); err != nil {
		t.Skip("sharp not installed")
	}
	dir := t.TempDir()
	var src bytes.Buffer
	_ = jpeg.Encode(&src, leftRed(2400, 1000), &jpeg.Options{Quality: 92})
	input := filepath.Join(dir, "in.jpg")
	_ = os.WriteFile(input, withOrientation(src.Bytes(), 6), 0o644)

	script := `
const [input, dir] = process.argv.slice(1);
const sharp = (await import("sharp")).default;
const fs = await import("node:fs");
const buf = fs.readFileSync(input);
const gofood = await sharp(buf).rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
const photo = await sharp(buf).rotate().resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 62, mozjpeg: true }).toBuffer();
fs.writeFileSync(dir + "/gofood.jpg", gofood);
fs.writeFileSync(dir + "/photo.jpg", photo);
console.log(JSON.stringify({ gofood: gofood.length, photo: photo.length }));
`
	cmd := exec.Command(node, "--no-warnings", "--input-type=module", "-e", script, input, dir)
	cmd.Dir = frontend
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("node: %v %s", err, stderr.String())
	}
	var sizes map[string]int
	_ = json.Unmarshal(out, &sizes)

	data, _ := os.ReadFile(input)
	for name, o := range map[string]ThumbnailOptions{
		"gofood": {MaxWidth: 1200, MaxHeight: 1200, Background: color.White, Quality: 85},
		"photo":  {MaxWidth: 480, Quality: 62},
	} {
		goOut, err := JPEGThumbnail(data, o)
		if err != nil {
			t.Fatal(err)
		}
		tsOut, _ := os.ReadFile(filepath.Join(dir, name+".jpg"))
		g, _ := jpeg.Decode(bytes.NewReader(goOut))
		s, _ := jpeg.Decode(bytes.NewReader(tsOut))
		if g.Bounds() != s.Bounds() {
			t.Fatalf("%s: go %v sharp %v", name, g.Bounds(), s.Bounds())
		}
		if d := meanDiff(g, s); d > 4 {
			t.Errorf("%s: mean pixel difference %.2f", name, d)
		}
		t.Logf("%s %v: go %d bytes, sharp %d bytes", name, g.Bounds().Size(), len(goOut), sizes[name])
	}
}

func meanDiff(a, b image.Image) float64 {
	var sum float64
	r := a.Bounds()
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			r1, g1, b1, _ := a.At(x, y).RGBA()
			r2, g2, b2, _ := b.At(x, y).RGBA()
			sum += absDiff(r1, r2) + absDiff(g1, g2) + absDiff(b1, b2)
		}
	}
	return sum / float64(3*r.Dx()*r.Dy()) / 257
}

func absDiff(a, b uint32) float64 {
	if a > b {
		return float64(a - b)
	}
	return float64(b - a)
}
