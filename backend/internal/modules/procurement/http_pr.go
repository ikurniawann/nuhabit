package procurement

import (
	"net/http"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
)

// Port of frontend/src/app/api/purchasing/pr/**.
func (h *Handler) prRoutes(add addRoute) {
	add("GET /api/purchasing/pr", h.listPrs)
	add("POST /api/purchasing/pr", h.createPr)
	add("GET /api/purchasing/pr/for-po", h.prsForPo)
	add("GET /api/purchasing/pr/form-data", h.prFormData)
	add("GET /api/purchasing/pr/{id}", h.prDetail)
	add("PUT /api/purchasing/pr/{id}", h.updatePr)
	add("POST /api/purchasing/pr/{id}/submit", h.submitPr)
	add("POST /api/purchasing/pr/{id}/approve", h.approvePr)
	add("POST /api/purchasing/pr/{id}/revise", h.revisePr)
	add("POST /api/purchasing/pr/{id}/convert-to-po", h.convertPr)
}

// errBadPage is what LIMIT/OFFSET NaN (parseInt garbage) produce in the TS:
// PostgreSQL rejects 'NaN' with 22P02.
var errBadPage = httpx.BadRequest("Format data tidak valid")

func pageParams(r *http.Request) (page, limit int, err error) {
	page, okPage := queryInt(r, "page", 1)
	limit, okLimit := queryInt(r, "limit", 20)
	if !okPage || !okLimit {
		return 0, 0, errBadPage
	}
	return page, limit, nil
}

func (h *Handler) listPrs(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	page, limit, err := pageParams(r)
	if err != nil {
		return err
	}
	moduleType := r.URL.Query().Get("module_type")
	if moduleType == "" {
		moduleType = "raw_material"
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	params := PrListParams{Status: queryPtr(r, "status"), Search: queryPtr(r, "search"), DepartmentID: queryPtr(r, "department_id"),
		ModuleType: moduleType, Page: page, Limit: limit}
	out, err := h.svc.ListPurchaseRequests(r.Context(), params, scope, user)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) createPr(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuAction(r, "create", iam.ItemsPr...)
	if err != nil {
		return err
	}
	body, err := readBody(r)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	pr, err := h.svc.CreatePurchaseRequest(r.Context(), body, user, scope)
	if err != nil {
		return err
	}
	return writeData(w, http.StatusCreated, pr)
}

func (h *Handler) prsForPo(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	moduleType := r.URL.Query().Get("module_type")
	if moduleType == "" {
		moduleType = "raw_material"
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	data, err := h.svc.ListPrsForPo(r.Context(), moduleType, scope)
	if err != nil {
		return err
	}
	return writeData(w, http.StatusOK, data)
}

func (h *Handler) prFormData(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuAction(r, "create", iam.ItemsPr...)
	if err != nil {
		return err
	}
	moduleType := domain.ModuleType(r.URL.Query().Get("module_type"))
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	data, err := h.svc.PrFormData(r.Context(), moduleType, scope)
	if err != nil {
		return err
	}
	return writeData(w, http.StatusOK, data)
}

func (h *Handler) prDetail(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	canApprove, err := h.auth.HasMenuAction(r.Context(), user, "update", iam.ItemsPrApproval...)
	if err != nil {
		return err
	}
	data, err := h.svc.PurchaseRequestDetail(r.Context(), r.PathValue("id"), user, canApprove)
	if err != nil {
		return err
	}
	return writeData(w, http.StatusOK, data)
}

func (h *Handler) updatePr(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	body, err := readBody(r)
	if err != nil {
		return err
	}
	data, err := h.svc.UpdatePurchaseRequest(r.Context(), r.PathValue("id"), body, user)
	if err != nil {
		return err
	}
	return writeData(w, http.StatusOK, data)
}

func (h *Handler) submitPr(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	data, err := h.svc.SubmitPurchaseRequest(r.Context(), r.PathValue("id"), user)
	if err != nil {
		return err
	}
	return writeData(w, http.StatusOK, data)
}

func (h *Handler) approvePr(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuAction(r, "update", iam.ItemsPrApproval...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	decision, err := parsePrDecision(f)
	if err != nil {
		return err
	}
	data, err := h.svc.DecidePurchaseRequest(r.Context(), r.PathValue("id"), decision, user)
	if err != nil {
		return err
	}
	return writeData(w, http.StatusOK, data)
}

func (h *Handler) revisePr(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	data, err := h.svc.RevisePurchaseRequest(r.Context(), r.PathValue("id"), user)
	if err != nil {
		return err
	}
	return writeData(w, http.StatusCreated, data)
}

func (h *Handler) convertPr(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in, err := parsePrConvert(f)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	po, err := h.svc.ConvertPrToPo(r.Context(), r.PathValue("id"), in, user.ID, scope)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusCreated, po, "PR berhasil dikonversi menjadi PO")
}
