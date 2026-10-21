package gymcredits

import (
	"net/http"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// reclaimTransfer is POST /api/gym/credits/transfers/{id}/reclaim with
// { reason }: staff take the unused part of a transfer back to the sender.
func (h *Handler) reclaimTransfer(w http.ResponseWriter, r *http.Request) error {
	user, err := h.require(r, actUpdate, iam.GymCredits)
	if err != nil {
		return err
	}
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	body, _ := readJSON(r, undefined)
	f := newForm(body)
	reason, _ := f.str("reason", strRule{trim: true, min: domain.MinReasonLength, minMsg: "Alasan penarikan wajib diisi", max: 300})
	if err := f.staffErr(); err != nil {
		return err
	}
	res, err := h.svc.ReclaimTransferTx(r.Context(), id, reason, user.ID)
	if err != nil {
		return err
	}
	return httpx.OK(w, res)
}
