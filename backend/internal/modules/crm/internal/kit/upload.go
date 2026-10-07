package kit

import (
	"errors"
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/storage"
)

const maxPublicImageBytes = 5 * 1024 * 1024

// PublicImage is the {url} uploadPublicImage returns.
type PublicImage struct {
	URL string `json:"url"`
}

// UploadPublicImage mirrors uploadPublicImage in lib/crm/image-upload.ts:
// the multipart `file` (at most 5 MB) must sniff as JPEG, PNG or WebP and
// lands in the public bucket. Bad input is 400, a failed write 500.
func UploadPublicImage(r *http.Request, store *storage.Store, bucket string) (*PublicImage, error) {
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if errors.Is(err, storage.ErrBodyTooLarge) {
		// Next parses any size and then rejects the file as too large.
		return nil, httpx.BadRequest("Gambar maksimal 5 MB")
	}
	var file *storage.File
	if err == nil {
		file = form.File("file")
	}
	switch {
	case file == nil || file.Size() == 0:
		return nil, httpx.BadRequest("Pilih file gambar dulu")
	case file.Size() > maxPublicImageBytes:
		return nil, httpx.BadRequest("Gambar maksimal 5 MB")
	case storage.SniffImage(file.Data) == "":
		return nil, httpx.BadRequest("File harus gambar JPG/PNG/WebP")
	}
	url, err := store.Upload(bucket, "", file.Data, file.Type, file.Name)
	if err != nil {
		return nil, httpx.Status(http.StatusInternalServerError, "Upload gagal")
	}
	return &PublicImage{URL: url}, nil
}
