package settings

import (
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/storage"
)

// POST and DELETE /api/settings/static-qris: the venue's static QRIS image
// lives in the public "payment-qris" bucket, its URL in app_settings.

const (
	staticQrisBucket   = "payment-qris"
	staticQrisMaxBytes = 5 * 1024 * 1024
)

// removeOldQris deletes a replaced image; a leftover file is only logged.
func (h *handler) removeOldQris(r *http.Request, url *string) {
	if url == nil {
		return
	}
	if err := storage.FromEnv().Delete(staticQrisBucket, *url); err != nil {
		h.d.Log.WarnContext(r.Context(), "[settings/static-qris] berkas lama tidak terhapus:", "url", *url, "error", err)
	}
}

func (h *handler) postStaticQris(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsPaymentGateways...); err != nil {
		return err
	}
	var file *storage.File
	if form, err := storage.ReadForm(r, storage.MaxRequestBytes); err == nil {
		file = form.File("file")
	}
	switch {
	case file == nil || file.Size() == 0:
		return httpx.BadRequest("Pilih file gambar QRIS dulu")
	case file.Size() > staticQrisMaxBytes:
		return httpx.BadRequest("Gambar QRIS maksimal 5 MB")
	case storage.SniffImage(file.Data) == "":
		return httpx.BadRequest("File harus gambar JPG/PNG/WebP")
	}

	previous, err := h.loadStaticQris(r)
	if err != nil {
		return err
	}
	url, err := storage.FromEnv().Upload(staticQrisBucket, "", file.Data, file.Type, file.Name)
	if err != nil {
		return httpx.Status(http.StatusInternalServerError, err.Error())
	}
	ctx := r.Context()
	if err := h.settings.Set(ctx, h.db, "static_qris_image_url", url); err != nil {
		return err
	}
	// The first upload switches it on: that is what the user wants most often.
	if previous.ImageURL == nil {
		if err := h.settings.Set(ctx, h.db, "static_qris_enabled", "true"); err != nil {
			return err
		}
	}
	h.removeOldQris(r, previous.ImageURL)
	return h.respondStaticQris(w, r)
}

func (h *handler) deleteStaticQris(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsPaymentGateways...); err != nil {
		return err
	}
	current, err := h.loadStaticQris(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	if err := h.settings.Set(ctx, h.db, "static_qris_enabled", "false"); err != nil {
		return err
	}
	if err := h.settings.Put(ctx, h.db, "static_qris_image_url", nil); err != nil {
		return err
	}
	h.removeOldQris(r, current.ImageURL)
	return h.respondStaticQris(w, r)
}
