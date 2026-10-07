package loyalty

import (
	"net/http"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

func (h *handler) adjustXP(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateMemberLoyaltyWrite)
	if err != nil {
		return err
	}
	customerID, err := kit.RequireMemberCustomerID(r.Context(), h.db, r.PathValue("id"))
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	delta := f.Int("delta", required, validate.NumOpts{Min: validate.Bound(-1_000_000), Max: validate.Bound(1_000_000)})
	if delta != nil && f.Valid() && *delta == 0 {
		f.Fail("delta", "custom", "Jumlah XP tidak boleh 0")
	}
	reason := f.Str("reason", required, validate.StrOpts{Trim: true, Max: 300, Check: func(s string) (string, string, bool) {
		return "too_small", "Alasan minimal 5 karakter", validate.UTF16Len(s) >= 5
	}})
	requestID := f.UUID("request_id", required)
	if err := kit.CrmInputErr(f); err != nil {
		return err
	}
	venue := kit.DefaultVenue(r.Context(), h.db)
	res, err := h.engine.Adjust(r.Context(), h.db, xp.Adjustment{
		CustomerID: customerID, Delta: float64(*delta), Reason: *reason, ActorID: user.ID,
		RequestID: *requestID, CompanyID: venue.CompanyID, BranchID: venue.BranchID,
	})
	if err != nil {
		return err
	}
	if res.Status == "skipped" {
		return httpx.Conflict("XP member sudah 0, tidak ada yang dikurangi")
	}
	msg := "XP member disesuaikan"
	if res.Status == "duplicate" {
		msg = "Penyesuaian ini sudah tercatat"
	}
	return kit.OK(w, res, msg)
}
