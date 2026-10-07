package collectibles

import (
	"net/http"

	"nuhabit/backend/internal/modules/crm/internal/kit"
)

// uploadAvatar is POST /api/crm/avatars/upload: collectible artwork goes to
// the public crm-avatars bucket because members see it in the portal.
func (h *handler) uploadAvatar(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	img, err := kit.UploadPublicImage(r, h.store, "crm-avatars")
	if err != nil {
		return err
	}
	return kit.OK(w, img)
}
