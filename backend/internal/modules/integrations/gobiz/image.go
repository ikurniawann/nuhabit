package gobiz

import (
	"context"
	"image/color"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/integrations/gobiz/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/imageproc"
	"nuhabit/backend/internal/platform/safehttp"
	"nuhabit/backend/internal/platform/storage"
)

// GET /api/public/gofood-image/<base64url source>.jpg: a product photo as
// JPEG for the GoFood catalog (GoBiz rejects WebP). It is public because the
// GoBiz servers fetch it, and it only reads our own files (the static
// /products photos and storage uploads) after a containment check. The API
// container ships without Next's public/, so a /products photo missing
// locally is fetched from PUBLIC_ORIGIN (the Next container) when that is
// set; no other remote URL is ever fetched.

const (
	maxImageSourceBytes = 15 * 1024 * 1024
	maxImageSide        = 1200
	publicFetchTimeout  = 10 * time.Second
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
// /api/files/ path, decoded once more and kept inside its root. publicRel
// is the decoded path under public/ for a /products/ source.
func resolveImageSource(src string) (abs, publicRel string) {
	publicRoot, uploadRoot := imageRoots()
	root, rel := uploadRoot, strings.TrimPrefix(src, "/api/files/")
	if strings.HasPrefix(src, "/products/") {
		root, rel = publicRoot, src[1:]
	}
	decoded, err := storage.DecodeURIComponent(rel)
	// "%2e%2e" passes the token's ".." check, so it is checked again here.
	if err != nil || strings.Contains(decoded, "..") || strings.Contains(decoded, `\`) {
		return "", ""
	}
	abs = filepath.Join(root, filepath.FromSlash(decoded))
	if filepath.IsAbs(filepath.FromSlash(decoded)) {
		abs = filepath.Clean(decoded) // path.resolve keeps an absolute path
	}
	if !strings.HasPrefix(abs, root+string(filepath.Separator)) {
		return "", ""
	}
	if root == publicRoot {
		publicRel = decoded
	}
	return abs, publicRel
}

// readLocalImage reads a regular file up to the size cap.
func readLocalImage(abs string) ([]byte, bool) {
	st, err := os.Stat(abs)
	if err != nil || !st.Mode().IsRegular() || st.Size() > maxImageSourceBytes {
		return nil, false
	}
	data, err := os.ReadFile(abs)
	return data, err == nil
}

// fetchPublicImage GETs rel from PUBLIC_ORIGIN through safehttp with only
// that host allowed, refusing anything but a 200 within the size cap.
func fetchPublicImage(ctx context.Context, rel string) ([]byte, bool) {
	raw := strings.TrimSpace(os.Getenv("PUBLIC_ORIGIN"))
	if raw == "" {
		return nil, false
	}
	origin, err := url.Parse(raw)
	if err != nil || origin.Host == "" {
		return nil, false
	}
	client := safehttp.Policy{AllowHosts: []string{strings.ToLower(origin.Host)}}.Client(publicFetchTimeout)
	defer client.CloseIdleConnections()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, origin.JoinPath(strings.Split(rel, "/")...).String(), nil)
	if err != nil {
		return nil, false
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, false
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxImageSourceBytes+1))
	if res.StatusCode != http.StatusOK || err != nil || len(data) > maxImageSourceBytes {
		return nil, false
	}
	return data, true
}

func (h *Handler) gofoodImage(w http.ResponseWriter, r *http.Request) {
	notFound := func() { _ = httpx.JSON(w, http.StatusNotFound, map[string]string{"error": "Gambar tidak ditemukan"}) }
	var abs, publicRel string
	if m := imageFile.FindStringSubmatch(r.PathValue("file")); m != nil {
		if src := domain.DecodeImageSource(m[1]); src != "" {
			abs, publicRel = resolveImageSource(src)
		}
	}
	if abs == "" {
		notFound()
		return
	}
	data, ok := readLocalImage(abs)
	if !ok && publicRel != "" {
		data, ok = fetchPublicImage(r.Context(), publicRel)
	}
	if !ok {
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
