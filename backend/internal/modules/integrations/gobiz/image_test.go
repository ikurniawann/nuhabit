package gobiz

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"nuhabit/backend/internal/modules/integrations/gobiz/domain"
)

// Port of app/api/public/gofood-image/[file]/route.test.ts on a temporary
// STORAGE_DIR with public/ next to it.
func TestGofoodImage(t *testing.T) {
	base := t.TempDir()
	t.Setenv("STORAGE_DIR", filepath.Join(base, "storage"))
	t.Setenv("PUBLIC_DIR", "")
	write := func(rel string, data []byte) {
		abs := filepath.Join(base, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// A half-transparent 1600x900 photo, as the TS test draws with sharp.
	img := image.NewNRGBA(image.Rect(0, 0, 1600, 900))
	for i := 0; i < len(img.Pix); i += 4 {
		copy(img.Pix[i:], []byte{29, 29, 204, 128})
	}
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		t.Fatal(err)
	}
	write("public/products/test/sample.png", pngBuf.Bytes())
	webp, err := os.ReadFile("../../../platform/imageproc/testdata/red-64x32.webp")
	if err != nil {
		t.Fatal(err)
	}
	write("storage/uploads/products/a b.webp", webp)
	write("public/secret.txt", []byte("secret"))

	mux := http.NewServeMux()
	for _, rt := range (&Handler{}).Routes() {
		mux.Handle(rt.Pattern, rt.Handler)
	}
	get := func(file string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/public/gofood-image/"+file, nil))
		return rec
	}

	rec := get(domain.EncodeImageSource("/products/test/sample.png") + ".jpg")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/jpeg" ||
		rec.Header().Get("Cache-Control") != "public, max-age=86400" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("photo: %d %v", rec.Code, rec.Header())
	}
	out, err := jpeg.Decode(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if b := out.Bounds(); b.Dx() != 1200 || b.Dy() != 675 {
		t.Fatalf("size %v, want 1200x675", b)
	}
	// Transparency is flattened onto white: half blue over white.
	if r, g, bl, _ := out.At(600, 300).RGBA(); r>>8 < 130 || g>>8 < 130 || bl>>8 < 220 {
		t.Fatalf("flatten: %v", color.RGBAModel.Convert(out.At(600, 300)))
	}

	// A storage upload, its path segments URL-encoded as /api/files URLs are.
	rec = get(domain.EncodeImageSource("/api/files/products/a%20b.webp") + ".jpg")
	if rec.Code != 200 {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	if out, err := jpeg.Decode(bytes.NewReader(rec.Body.Bytes())); err != nil || out.Bounds().Dx() != 64 {
		t.Fatalf("upload decode: %v", err)
	}

	for _, file := range []string{
		domain.EncodeImageSource("/products/../secret.txt") + ".jpg",
		domain.EncodeImageSource("/products/%2e%2e/secret.txt") + ".jpg",
		domain.EncodeImageSource("/api/files/%2Fetc%2Fpasswd") + ".jpg",
		domain.EncodeImageSource("/products/test/sample.png") + ".png",
		domain.EncodeImageSource("/products/test/missing.webp") + ".jpg",
		domain.EncodeImageSource("/products/test") + ".jpg",
		domain.EncodeImageSource("https://evil.example/x.webp") + ".jpg",
		"xx.jpg",
	} {
		if rec := get(file); rec.Code != 404 || rec.Body.String() != `{"error":"Gambar tidak ditemukan"}` {
			t.Fatalf("%s: %d %s", file, rec.Code, rec.Body.String())
		}
	}
}
