package gymcredits

import (
	"net/http"

	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
)

// voucherRoutes: the front desk checks a code before selling (create on
// the credits menu, like the sale itself).
func (h *Handler) voucherRoutes() []module.Route {
	return []module.Route{
		{Pattern: "POST /api/gym/credits/{customerId}/vouchers/preview", Handler: h.api(h.staffPreviewVoucher)},
	}
}

func (h *Handler) staffPreviewVoucher(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.require(r, actCreate, iam.GymCredits); err != nil {
		return err
	}
	customerID, err := requireUUID(r.PathValue("customerId"))
	if err != nil {
		return err
	}
	body, _ := readJSON(r, map[string]any{})
	in, err := parseVoucherPreview(body)
	if err != nil {
		return err
	}
	view, err := h.svc.PreviewVoucher(r.Context(), customerID, in.PackageID, in.Code, in.BranchID)
	if err != nil {
		return err
	}
	return ok(w, view)
}
