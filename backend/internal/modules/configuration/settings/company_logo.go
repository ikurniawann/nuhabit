package settings

import (
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/storage"
)

// POST and DELETE /api/settings/company-profile/logo: the letterhead logo
// lives in the public "site" bucket, its URL in app_settings.

const (
	companyLogoKey      = "company_logo_url"
	companyLogoBucket   = "site"
	companyLogoFolder   = "letterhead"
	companyLogoMaxBytes = 2 * 1024 * 1024
)

func (h *handler) storedLogo(r *http.Request) (*string, error) {
	v, err := h.settings.Get(r.Context(), h.db, companyLogoKey)
	if err != nil || v == nil || *v == "" {
		return nil, err
	}
	return v, nil
}

// removeLogo deletes a replaced logo file; a leftover file is only logged.
func (h *handler) removeLogo(r *http.Request, url *string) {
	if url == nil {
		return
	}
	if err := storage.FromEnv().Delete(companyLogoBucket, *url); err != nil {
		h.d.Log.WarnContext(r.Context(), "[settings/company-logo] berkas lama tidak terhapus:", "url", *url, "error", err)
	}
}

func (h *handler) postCompanyLogo(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsBusiness...); err != nil {
		return err
	}
	var file *storage.File
	if form, err := storage.ReadForm(r, storage.MaxRequestBytes); err == nil {
		file = form.File("file")
	}
	switch {
	case file == nil || file.Size() == 0:
		return httpx.BadRequest("Pilih file logo dulu")
	case file.Size() > companyLogoMaxBytes:
		return httpx.BadRequest("Logo maksimal 2 MB")
	case storage.SniffImage(file.Data) == "":
		return httpx.BadRequest("File harus gambar JPG/PNG/WebP")
	}
	previous, err := h.storedLogo(r)
	if err != nil {
		return err
	}
	url, err := storage.FromEnv().Upload(companyLogoBucket, companyLogoFolder, file.Data, file.Type, file.Name)
	if err != nil {
		return httpx.Status(http.StatusInternalServerError, err.Error())
	}
	if err := h.settings.Set(r.Context(), h.db, companyLogoKey, url); err != nil {
		return err
	}
	h.removeLogo(r, previous)
	return httpx.OK(w, map[string]string{"logo_url": url})
}

func (h *handler) deleteCompanyLogo(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsBusiness...); err != nil {
		return err
	}
	current, err := h.storedLogo(r)
	if err != nil {
		return err
	}
	if err := h.settings.Put(r.Context(), h.db, companyLogoKey, nil); err != nil {
		return err
	}
	h.removeLogo(r, current)
	return httpx.OK(w, map[string]any{"logo_url": nil})
}
