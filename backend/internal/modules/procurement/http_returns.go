package procurement

import (
	"net/http"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Port of frontend/src/app/api/purchasing/{returns,return}/**.
func (h *Handler) returnRoutes(add addRoute) {
	add("GET /api/purchasing/returns", h.listReturns)
	add("POST /api/purchasing/returns", h.createReturn)
	add("GET /api/purchasing/returns/grn-options", h.returnGrnOptions)
	add("GET /api/purchasing/returns/{id}", h.returnDetail)
	add("PATCH /api/purchasing/returns/{id}", h.updateReturn)
	add("PATCH /api/purchasing/returns/{id}/approve", h.approveReturn)
	add("PATCH /api/purchasing/returns/{id}/reject", h.rejectReturn)
	add("POST /api/purchasing/returns/{id}/revise", h.reviseReturn)

	gone := func(msg string) httpx.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) error { return httpx.Status(http.StatusGone, msg) }
	}
	legacy := gone("API legacy /api/purchasing/return sudah tidak dipakai. Gunakan /api/purchasing/returns untuk purchase return workflow.")
	legacyID := gone("API legacy /api/purchasing/return/:id sudah tidak dipakai. Gunakan /api/purchasing/returns/:id.")
	add("GET /api/purchasing/return", legacy)
	add("POST /api/purchasing/return", legacy)
	add("GET /api/purchasing/return/{id}", legacyID)
	add("PUT /api/purchasing/return/{id}", legacyID)
	add("DELETE /api/purchasing/return/{id}", legacyID)
}

var reasonTypes = []string{"damaged", "wrong_item", "expired", "overstock", "specification_mismatch", "other"}

var nullish = validate.Rule{Optional: true, Nullable: true}

// returnLines validates z.array(returnLineSchema).
func returnLines(items *validate.Form, i int, v any) ReturnLine {
	item := items.Item(i, v)
	l := ReturnLine{}
	if g := item.UUID("grn_item_id", validate.Rule{}); g != nil {
		l.GrnItemID = *g
	}
	l.RawMaterialID = item.UUID("raw_material_id", nullish)
	l.ProductID = item.UUID("product_id", nullish)
	if q := item.Num("qty_returned", validate.Rule{}, validate.NumOpts{Positive: true}); q != nil {
		l.QtyReturned = *q
	}
	if c := item.Num("unit_cost", validate.Rule{}, nonNegative); c != nil {
		l.UnitCost = *c
	}
	l.BatchNumber = item.Str("batch_number", nullish, validate.StrOpts{})
	l.ExpiryDate = item.Str("expiry_date", nullish, validate.StrOpts{})
	l.ConditionNotes = item.Str("condition_notes", nullish, validate.StrOpts{})
	return l
}

func (h *Handler) listReturns(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	page, limit, err := pageParams(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	orDefault := func(key, def string) string {
		if v := q.Get(key); v != "" {
			return v
		}
		return def
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	out, err := h.svc.ListPurchaseReturns(r.Context(), ReturnListParams{
		Page: page, Limit: limit, Status: orDefault("status", "all"),
		SupplierID: queryPtr(r, "supplier_id"), VendorID: queryPtr(r, "vendor_id"), ReasonType: queryPtr(r, "reason_type"),
		DateFrom: queryPtr(r, "date_from"), DateTo: queryPtr(r, "date_to"), Search: queryPtr(r, "search"),
		SortBy: orDefault("sort_by", "return_date"), SortOrder: orDefault("sort_order", "DESC"),
		ModuleType: domain.ModuleType(q.Get("module_type")),
	}, scope)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) createReturn(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in := &ReturnCreate{}
	str := func(key string) *string { return f.Str(key, nullish, validate.StrOpts{}) }
	in.GrnID, in.SupplierID, in.VendorID, in.ModuleType, in.ReturnDate = str("grn_id"), str("supplier_id"), str("vendor_id"), str("module_type"), str("return_date")
	in.ReasonType = f.Enum("reason_type", nullish, reasonTypes)
	in.ReasonNotes, in.Notes = str("reason_notes"), str("notes")
	f.List("items", nullish, 1<<30, func(items *validate.Form, i int, v any) { in.Items = append(in.Items, returnLines(items, i, v)) })
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	data, err := h.svc.CreatePurchaseReturn(r.Context(), in, scope)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, data, "Purchase return created and pending approval")
}

func (h *Handler) returnGrnOptions(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	data, err := h.svc.ReturnableGrns(r.Context(), scope, domain.ModuleType(r.URL.Query().Get("module_type")))
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

func (h *Handler) returnDetail(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	data, err := h.svc.PurchaseReturn(r.Context(), r.PathValue("id"), scope)
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

func (h *Handler) updateReturn(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in := &ReturnUpdate{}
	if d := f.Str("return_date", validate.Rule{}, validate.StrOpts{Min: 1}); d != nil {
		in.ReturnDate = *d
	}
	if t := f.Enum("reason_type", validate.Rule{}, reasonTypes); t != nil {
		in.ReasonType = *t
	}
	in.ReasonNotes = f.Str("reason_notes", nullish, validate.StrOpts{})
	in.Notes = f.Str("notes", nullish, validate.StrOpts{})
	items := f.List("items", validate.Rule{}, 1<<30, func(items *validate.Form, i int, v any) { in.Items = append(in.Items, returnLines(items, i, v)) })
	if items != nil && len(items) == 0 {
		f.Fail("items", "too_small", "Too small: expected array to have >=1 items")
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	data, err := h.svc.UpdatePurchaseReturn(r.Context(), r.PathValue("id"), in, scope)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, data, "Purchase return updated successfully")
}

func (h *Handler) approveReturn(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	data, err := h.svc.ApprovePurchaseReturn(r.Context(), r.PathValue("id"), user.ID)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, data, "Purchase return approved. Stock has been reduced from the receipt warehouse.")
}

func (h *Handler) rejectReturn(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	reason := f.Str("rejection_reason", nullish, validate.StrOpts{})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	data, err := h.svc.RejectPurchaseReturn(r.Context(), r.PathValue("id"), reason, user.ID)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, data, "Return ditolak")
}

func (h *Handler) reviseReturn(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	rev, err := h.svc.RevisePurchaseReturn(r.Context(), r.PathValue("id"), actorAudit(user).WithRequest(r))
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusCreated, rev, "Revisi "+rev.Str("return_number")+" dibuat sebagai draft")
}
