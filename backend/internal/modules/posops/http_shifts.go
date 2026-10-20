package posops

import (
	"net/http"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Shift routes (app/api/pos/shifts). They have no try/catch: QueryBuilder
// errors come back as values and the route answers 500 with error.message.
func (h *Handler) shiftRoutes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/pos/shifts", Handler: caught(pgMessage, h.listShifts)},
		{Pattern: "POST /api/pos/shifts", Handler: caught(pgMessage, h.openShift)},
		{Pattern: "GET /api/pos/shifts/current", Handler: caught(pgMessage, h.currentShift)},
		{Pattern: "PATCH /api/pos/shifts/{id}/close", Handler: caught(pgMessage, h.closeShift)},
		{Pattern: "POST /api/pos/shifts/{id}/send-report", Handler: caught(fixed("Gagal mengirim laporan"), h.sendShiftReport)},
		{Pattern: "GET /api/pos/shifts/mine", Handler: caught(pgMessage, h.myShift)},
		{Pattern: "POST /api/pos/shifts/mine", Handler: caught(pgMessage, h.openMyShift)},
		{Pattern: "PATCH /api/pos/shifts/mine/close", Handler: caught(pgMessage, h.closeMyShift)},
	}
}

// deskUser lets the caller's own shift be run by a POS user or by gym front
// desk staff who sell packages (create on gym.credits) without POS access.
func (h *Handler) deskUser(r *http.Request) (*auth.User, error) {
	u, err := h.posUser(r)
	if u != nil || err != nil {
		return u, err
	}
	u, _, err = h.auth.RequireAnyGrant(r, iam.Grant{Action: "create", Prefixes: iam.GymCredits})
	return u, err
}

// branchParam is the optional ?branch_id= of the caller's shift routes.
func branchParam(r *http.Request) (*string, error) {
	b := queryParam(r, "branch_id")
	if b != nil && !validate.IsUUID(*b) {
		return nil, fail(http.StatusBadRequest, "branch_id tidak valid")
	}
	return b, nil
}

func (h *Handler) myShift(w http.ResponseWriter, r *http.Request) error {
	user, err := h.deskUser(r)
	if err != nil {
		return err
	}
	branchID, err := branchParam(r)
	if err != nil {
		return err
	}
	shift, err := h.svc.MyShift(r.Context(), user.ID, branchID)
	if err != nil {
		return err
	}
	return okData(w, shift)
}

func (h *Handler) openMyShift(w http.ResponseWriter, r *http.Request) error {
	user, err := h.deskUser(r)
	if err != nil {
		return err
	}
	branchID, err := branchParam(r)
	if err != nil {
		return err
	}
	shift, err := h.svc.OpenMyShift(r.Context(), user.ID, branchID, jsonBodyOr(r, emptyObject()))
	if err != nil {
		return err
	}
	return okData(w, shift)
}

func (h *Handler) closeMyShift(w http.ResponseWriter, r *http.Request) error {
	user, err := h.deskUser(r)
	if err != nil {
		return err
	}
	branchID, err := branchParam(r)
	if err != nil {
		return err
	}
	closed, err := h.svc.CloseMyShift(r.Context(), user.ID, branchID, jsonBodyOr(r, emptyObject()))
	if err != nil {
		return err
	}
	return writeObj(w, http.StatusOK, NewObj("success", true, "data", closed.Shift, "summary", closed.Summary))
}

// queryParam is searchParams.get(key) treated as falsy when empty.
func queryParam(r *http.Request, key string) *string {
	v := r.URL.Query().Get(key)
	if v == "" {
		return nil
	}
	return &v
}

func (h *Handler) listShifts(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Unauthorized"); err != nil {
		return err
	}
	f := shiftFilter{Status: queryParam(r, "status"), CashierID: queryParam(r, "cashier_id"), Date: queryParam(r, "date")}
	limitRaw, offsetRaw := r.URL.Query().Get("limit"), r.URL.Query().Get("offset")
	if limitRaw == "" {
		limitRaw = "50"
	}
	if offsetRaw == "" {
		offsetRaw = "0"
	}
	limit := domain.ParseInt(limitRaw)
	if limit > 200 {
		limit = 200
	}
	rows, count, err := h.svc.ListShifts(r.Context(), f, limit, domain.ParseInt(offsetRaw))
	if err != nil {
		return err
	}
	return writeObj(w, http.StatusOK, NewObj("success", true, "data", rows, "count", count))
}

func (h *Handler) openShift(w http.ResponseWriter, r *http.Request) error {
	user, err := h.requirePos(r, "Unauthorized")
	if err != nil {
		return err
	}
	shift, err := h.svc.OpenShift(r.Context(), user.ID, jsonBodyOr(r, emptyObject()))
	if err != nil {
		return err
	}
	return okData(w, shift)
}

func (h *Handler) currentShift(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Unauthorized"); err != nil {
		return err
	}
	cashierID := queryParam(r, "cashier_id")
	if cashierID == nil {
		return fail(http.StatusBadRequest, "cashier_id required")
	}
	shift, err := h.svc.CurrentShift(r.Context(), *cashierID)
	if err != nil {
		return err
	}
	return okData(w, shift)
}

func (h *Handler) closeShift(w http.ResponseWriter, r *http.Request) error {
	user, err := h.requirePos(r, "Unauthorized")
	if err != nil {
		return err
	}
	closed, err := h.svc.CloseShift(r.Context(), user.ID, r.PathValue("id"), jsonBodyOr(r, emptyObject()))
	if err != nil {
		return err
	}
	return writeObj(w, http.StatusOK, NewObj("success", true, "data", closed.Shift, "summary", closed.Summary))
}

func (h *Handler) sendShiftReport(w http.ResponseWriter, r *http.Request) error {
	user, err := h.requirePos(r, "Authentication required")
	if err != nil {
		return err
	}
	sent, err := h.svc.SendShiftReport(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	body := NewObj("success", sent.Sent > 0,
		"data", NewObj("terkirim", sent.Sent, "total", sent.Total, "rincian", sent.Results))
	if sent.Sent == 0 {
		body.Set("error", "Semua pengiriman gagal — cek gateway WA")
	}
	return writeObj(w, http.StatusOK, body)
}
