package ticketing

import (
	"net/http"
	"slices"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/storage"
)

// POST /api/ticketing/products/{id}/thumbnail (uploadProductThumbnail): the
// image goes to the public "ticketing" bucket under the venue's branch.

const maxThumbnailBytes = 3 * 1024 * 1024

var thumbnailTypes = []string{"image/jpeg", "image/png", "image/webp"}

func (h *handler) uploadThumbnail(w http.ResponseWriter, r *http.Request, v Venue) error {
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if err != nil {
		return httpx.BadRequest("Format unggahan tidak valid")
	}
	ctx, id := r.Context(), r.PathValue("id")
	var found string
	err = h.svc.db.QueryRow(ctx, `SELECT id::text FROM ticketing.ticket_products
		WHERE id = $1 AND branch_id = $2 AND company_id = $3`, id, v.BranchID, v.CompanyID).Scan(&found)
	if database.IsNoRows(err) {
		return httpx.NotFound(productNotFound)
	}
	if err != nil {
		return err
	}

	file := form.File("file")
	switch {
	case file == nil || file.Size() == 0:
		return httpx.BadRequest("Gambar tidak ditemukan")
	case file.Size() > maxThumbnailBytes:
		return httpx.BadRequest("Ukuran gambar maksimal 3 MB")
	case !slices.Contains(thumbnailTypes, file.Type):
		return httpx.BadRequest("Format harus JPG, PNG, atau WEBP")
	}
	url, err := storage.FromEnv().Upload("ticketing", v.BranchID, file.Data, file.Type, file.Name)
	if err != nil {
		return httpx.Status(http.StatusInternalServerError, "Gagal mengunggah gambar")
	}
	if _, err := h.svc.db.Exec(ctx, `UPDATE ticketing.ticket_products SET thumbnail_url = $2, updated_at = now() WHERE id = $1`, id, url); err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusOK, map[string]string{"thumbnail_url": url}, "Thumbnail tersimpan")
}
