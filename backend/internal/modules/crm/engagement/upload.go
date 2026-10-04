package engagement

import (
	"net/http"

	"nuhabit/backend/internal/modules/crm/internal/kit"
)

// uploadAnnouncementImage is POST /api/crm/engagement/announcements/image:
// the avatar upload gated by the Engagement menu, so announcement senders
// do not need CRM settings access.
func (h *handler) uploadAnnouncementImage(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateEngagement); err != nil {
		return err
	}
	img, err := kit.UploadPublicImage(r, h.store, "crm-announcements")
	if err != nil {
		return err
	}
	return kit.OK(w, img)
}
