package procurement

import (
	"net/http"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Port of frontend/src/app/api/purchasing/po/** and po-items.
func (h *Handler) poRoutes(add addRoute) {
	add("GET /api/purchasing/po", h.listPos)
	add("POST /api/purchasing/po", h.createPo)
	add("GET /api/purchasing/po/form-data", h.poFormData)
	add("GET /api/purchasing/po/{id}", h.poDetail)
	add("PUT /api/purchasing/po/{id}", h.updatePo)
	add("DELETE /api/purchasing/po/{id}", h.voidPo)
	add("POST /api/purchasing/po/{id}/approve", h.approvePo)
	add("POST /api/purchasing/po/{id}/cancel", h.cancelPo)
	add("POST /api/purchasing/po/{id}/close", h.closePo)
	add("POST /api/purchasing/po/{id}/send", h.sendPo)
	add("POST /api/purchasing/po/{id}/payments", h.poPaymentsGone)
	add("POST /api/purchasing/po/{id}/receive", h.poReceiveGone)
	add("GET /api/purchasing/po/{id}/items", h.poItems)
	add("POST /api/purchasing/po/{id}/items", h.addPoItem)
	add("PUT /api/purchasing/po/items/{item_id}", h.updatePoItem)
	add("DELETE /api/purchasing/po/items/{item_id}", h.removePoItem)
	add("GET /api/purchasing/po/{id}/payment-terms", h.poPaymentTerms)
	add("POST /api/purchasing/po/{id}/payment-terms", h.createPoPaymentTerm)
	add("DELETE /api/purchasing/po/{id}/payment-terms/{termId}", h.cancelPoPaymentTerm)
	add("GET /api/purchasing/po-items", h.poItemsByQuery)
}

func (h *Handler) listPos(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	page, limit, err := pageParams(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	moduleType := q.Get("module_type")
	if moduleType == "" {
		moduleType = "raw_material"
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	out, err := h.svc.ListPurchaseOrders(r.Context(), PoListParams{
		Search: queryPtr(r, "search"), Status: queryPtr(r, "status"),
		SupplierID: queryPtr(r, "supplier_id"), VendorID: queryPtr(r, "vendor_id"),
		ModuleType: moduleType, TanggalMulai: queryPtr(r, "tanggal_mulai"), TanggalSampai: queryPtr(r, "tanggal_sampai"),
		IncludeCancelled: q.Get("include_cancelled") != "", Page: page, Limit: limit,
	}, scope)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) createPo(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	body, err := readBody(r)
	if err != nil {
		return err
	}
	moduleType := domain.ModuleType(bodyString(body, "module_type"))
	in, err := parsePoCreate(body, moduleType)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	po, err := h.svc.CreatePurchaseOrder(r.Context(), moduleType, in, scope)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusCreated, po, "PO berhasil dibuat")
}

func (h *Handler) poFormData(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	data, err := h.svc.PoFormData(r.Context(), domain.ModuleType(r.URL.Query().Get("module_type")), scope)
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

func (h *Handler) poDetail(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	data, err := h.svc.PurchaseOrderDetail(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

func (h *Handler) updatePo(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in, err := parsePoUpdate(f)
	if err != nil {
		return err
	}
	data, err := h.svc.UpdateDraftPurchaseOrder(r.Context(), r.PathValue("id"), in)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, data, "PO berhasil diupdate")
}

func (h *Handler) voidPo(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	if err := h.svc.VoidPurchaseOrder(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, okMessage{Success: true, Message: "PO berhasil dibatalkan"})
}

func (h *Handler) approvePo(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuAction(r, "update", iam.ItemsApproval...)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	before, data, err := h.svc.ApprovePurchaseOrder(r.Context(), id)
	if err != nil {
		return err
	}
	h.svc.recordAuditAfterCommit(r.Context(), audit.Entry{
		ActorID: user.ID, ActorName: nonEmpty(&user.FullName), Action: "po.approve", Entity: "purchase_order", EntityID: &id,
		EntityLabel: before.StrPtr("nomor_po"),
		Before:      obj("status", before.Get("status")),
		After:       obj("status", "approved", "grand_total", before.Get("grand_total")),
	}.WithRequest(r))
	return writeOKMessage(w, http.StatusOK, data, "PO berhasil diapprove")
}

func (h *Handler) cancelPo(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	reason, err := reasonField(f, "Alasan pembatalan wajib diisi")
	if err != nil {
		return err
	}
	before, data, err := h.svc.CancelPurchaseOrder(r.Context(), id, reason)
	if err != nil {
		return err
	}
	h.svc.recordAuditAfterCommit(r.Context(), audit.Entry{
		ActorID: user.ID, ActorName: nonEmpty(&user.FullName), Action: "po.cancel", Entity: "purchase_order", EntityID: &id,
		EntityLabel: before.StrPtr("nomor_po"),
		Before:      obj("status", before.Get("status")),
		After:       obj("status", "cancelled"),
		Reason:      &reason,
	}.WithRequest(r))
	return writeOKMessage(w, http.StatusOK, data, "PO berhasil dibatalkan")
}

func (h *Handler) closePo(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	reason, err := reasonField(f, "Alasan penutupan wajib diisi")
	if err != nil {
		return err
	}
	data, err := h.svc.ClosePurchaseOrder(r.Context(), r.PathValue("id"), reason, user.ID)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, data,
		"Purchase order ditutup. Kekurangan qty tidak ditagihkan; pengiriman baru tidak lagi diizinkan.")
}

func (h *Handler) sendPo(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	via := f.Enum("sent_via", validate.Rule{}, []string{"EMAIL", "WHATSAPP", "PRINT", "OTHER"})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	data, err := h.svc.SendPurchaseOrder(r.Context(), r.PathValue("id"), *via)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, data, "PO berhasil dikirim ke supplier via "+*via)
}

const apPaymentsPath = "/dashboard/accounting/accounts-payable/payments"

func (h *Handler) poPaymentsGone(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusGone, struct {
		Success  bool   `json:"success"`
		Error    string `json:"error"`
		Redirect string `json:"redirect"`
	}{false, "Pembayaran vendor dipindah ke Accounting → Accounts Payable → Payment. Gunakan " + apPaymentsPath, apPaymentsPath})
}

// poReceiveGone has no auth guard in the TS either.
func (h *Handler) poReceiveGone(w http.ResponseWriter, r *http.Request) error {
	return httpx.JSON(w, http.StatusGone, struct {
		Success  bool   `json:"success"`
		Error    string `json:"error"`
		NextStep string `json:"next_step"`
	}{false, "Penerimaan PO langsung sudah dinonaktifkan. Gunakan flow Delivery/GRN untuk menerima barang.",
		"/dashboard/purchasing/grn/insert?po_id=" + r.PathValue("id")})
}

func (h *Handler) poItems(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	data, err := h.svc.ListPurchaseOrderItems(r.Context(), r.PathValue("id"), true)
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

func (h *Handler) poItemsByQuery(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	poID := r.URL.Query().Get("po_id")
	if poID == "" {
		return httpx.BadRequest("po_id parameter required")
	}
	data, err := h.svc.ListPurchaseOrderItems(r.Context(), poID, false)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, data, "PO items retrieved")
}

func (h *Handler) addPoItem(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in, err := parsePoItemCreate(f)
	if err != nil {
		return err
	}
	data, err := h.svc.AddPurchaseOrderItem(r.Context(), r.PathValue("id"), in)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusCreated, data, "Item berhasil ditambahkan ke PO")
}

func (h *Handler) updatePoItem(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in, err := parsePoItemUpdate(f)
	if err != nil {
		return err
	}
	data, err := h.svc.UpdatePurchaseOrderItem(r.Context(), r.PathValue("item_id"), in)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, data, "Item berhasil diupdate")
}

func (h *Handler) removePoItem(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	if err := h.svc.RemovePurchaseOrderItem(r.Context(), r.PathValue("item_id")); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, okMessage{Success: true, Message: "Item berhasil dihapus dari PO"})
}

func (h *Handler) poPaymentTerms(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	data, err := h.svc.PoPaymentTerms(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

func (h *Handler) createPoPaymentTerm(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in, err := parsePoPaymentTerm(f)
	if err != nil {
		return err
	}
	data, err := h.svc.CreatePoPaymentTerm(r.Context(), r.PathValue("id"), in)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusCreated, data, "Payment term added successfully")
}

func (h *Handler) cancelPoPaymentTerm(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	if err := h.svc.CancelPoPaymentTerm(r.Context(), r.PathValue("id"), r.PathValue("termId")); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, okMessage{Success: true, Message: "Termin pembayaran berhasil dihapus"})
}
