package gobiz

import (
	"image/color"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"nuhabit/backend/internal/modules/integrations/gobiz/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/imageproc"
	"nuhabit/backend/internal/platform/storage"
)

// GET /api/public/gofood-image/<base64url source>.jpg: a product photo as
// JPEG for the GoFood catalog (GoBiz rejects WebP). It is public because the
// GoBiz servers fetch it, and it only reads our own files (the static
// /products photos and storage uploads) after a containment check. It never
// fetches a remote URL.

const (
	maxImageSourceBytes = 15 * 1024 * 1024
	maxImageSide        = 1200
)

var imageFile = regexp.MustCompile(`^([A-Za-z0-9_-]+)\.jpg$`)

// imageRoots are Next's public/ and storage/uploads/. STORAGE_DIR is
// /app/storage in the containers, so public/ sits next to it at /app/public
// (PUBLIC_DIR overrides it); from a backend checkout both are under
// ../frontend.
func imageRoots() (public, uploads string) {
	root := storage.Dir(os.Getenv)
	public = strings.TrimSpace(os.Getenv("PUBLIC_DIR"))
	if public == "" {
		public = filepath.Join(root, "..", "public")
	}
	public, _ = filepath.Abs(public)
	uploads, _ = filepath.Abs(filepath.Join(root, "uploads"))
	return public, uploads
}

// resolveImageSource is resolveSource: the file behind a /products/ or
// /api/files/ path, decoded once more and kept inside its root.
func resolveImageSource(src string) string {
	publicRoot, uploadRoot := imageRoots()
	root, rel := uploadRoot, strings.TrimPrefix(src, "/api/files/")
	if strings.HasPrefix(src, "/products/") {
		root, rel = publicRoot, src[1:]
	}
	decoded, err := storage.DecodeURIComponent(rel)
	// "%2e%2e" passes the token's ".." check, so it is checked again here.
	if err != nil || strings.Contains(decoded, "..") || strings.Contains(decoded, `\`) {
		return ""
	}
	abs := filepath.Join(root, filepath.FromSlash(decoded))
	if filepath.IsAbs(filepath.FromSlash(decoded)) {
		abs = filepath.Clean(decoded) // path.resolve keeps an absolute path
	}
	if !strings.HasPrefix(abs, root+string(filepath.Separator)) {
		return ""
	}
	return abs
}

func (h *Handler) gofoodImage(w http.ResponseWriter, r *http.Request) {
	notFound := func() { _ = httpx.JSON(w, http.StatusNotFound, map[string]string{"error": "Gambar tidak ditemukan"}) }
	var abs string
	if m := imageFile.FindStringSubmatch(r.PathValue("file")); m != nil {
		if src := domain.DecodeImageSource(m[1]); src != "" {
			abs = resolveImageSource(src)
		}
	}
	if abs == "" {
		notFound()
		return
	}
	st, err := os.Stat(abs)
	if err != nil || !st.Mode().IsRegular() || st.Size() > maxImageSourceBytes {
		notFound()
		return
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		notFound()
		return
	}
	jpeg, err := imageproc.JPEGThumbnail(data, imageproc.ThumbnailOptions{
		MaxWidth: maxImageSide, MaxHeight: maxImageSide, Background: color.White, Quality: 85,
	})
	if err != nil {
		notFound()
		return
	}
	hd := w.Header()
	hd.Set("Content-Type", "image/jpeg")
	hd.Set("Cache-Control", "public, max-age=86400")
	hd.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(jpeg)
}
