package memberportal

import (
	"net/http"
	"slices"

	"nuhabit/backend/internal/platform/storage"
)

// POST /api/member-portal/profile/photo: a profile photo from the portal.
// It skips the generic upload validation (which also takes PDF and Word):
// a profile photo must be an image, and 5 MB is plenty for a phone shot.

const maxPhotoBytes = 5 * 1024 * 1024

var photoTypes = []string{"image/jpeg", "image/png", "image/webp", "image/heic"}

func (h *Handler) uploadPhoto(w http.ResponseWriter, r *http.Request, customerID string) error {
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if err != nil {
		return fail(http.StatusBadRequest, "Format unggahan tidak valid")
	}
	file := form.File("file")
	switch {
	case file == nil || file.Size() == 0:
		return fail(http.StatusBadRequest, "Foto tidak ditemukan")
	case file.Size() > maxPhotoBytes:
		return fail(http.StatusBadRequest, "Ukuran foto maksimal 5 MB")
	case !slices.Contains(photoTypes, file.Type):
		return fail(http.StatusBadRequest, "Format harus JPG, PNG, atau WEBP")
	}
	url, err := storage.FromEnv().Upload("member-photos", customerID, file.Data, file.Type, file.Name)
	if err != nil {
		h.log.ErrorContext(r.Context(), "[member-portal] Upload foto gagal:", "error", err)
		return fail(http.StatusInternalServerError, "Gagal mengunggah foto")
	}
	// Saved at once so the photo survives a member leaving the profile form
	// before pressing Simpan.
	if err := h.svc.repo.SetPhotoURL(r.Context(), customerID, url); err != nil {
		return err
	}
	return ok(w, map[string]string{"photo_url": url})
}
