package procurement

import (
	"encoding/json"
	"errors"
	"net/http"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Port of frontend/src/app/api/purchasing/{grn,qc,delivery,deliveries,receiving-workspace}/**.
func (h *Handler) receivingRoutes(add addRoute) {
	add("GET /api/purchasing/grn", h.listGrns)
	add("POST /api/purchasing/grn", h.createGrn)
	add("PATCH /api/purchasing/grn", h.patchGrnCollection)
	add("GET /api/purchasing/grn/{id}", h.grnDetail)
	add("PATCH /api/purchasing/grn/{id}", h.updateGrn)
	add("DELETE /api/purchasing/grn/{id}", h.deleteGrn)
	add("GET /api/purchasing/grn/{id}/items", h.grnItems)
	add("POST /api/purchasing/grn/{id}/items", h.addGrnItem)
	add("GET /api/purchasing/grn/{id}/qc", h.brokenEmbed)
	add("POST /api/purchasing/grn/{id}/qc", h.submitGrnQc)
	add("GET /api/purchasing/grn/{id}/returnable-items", h.returnableItems)
	add("GET /api/purchasing/grn/{id}/vendor-credits", h.grnVendorCredits)

	add("GET /api/purchasing/qc", h.brokenEmbed)
	add("POST /api/purchasing/qc", h.submitLegacyQc)
	add("GET /api/purchasing/qc/{id}", h.brokenEmbed)

	add("GET /api/purchasing/receiving-workspace", h.receivingWorkspace)

	add("GET /api/purchasing/delivery", h.listDeliveries)
	add("POST /api/purchasing/delivery", h.createDelivery)
	add("GET /api/purchasing/delivery/for-grn", h.deliveriesForGrn)
	add("GET /api/purchasing/delivery/po-options", h.poOptionsForDelivery)
	add("GET /api/purchasing/delivery/{id}", h.deliveryDetail)
	add("PUT /api/purchasing/delivery/{id}", h.updateDelivery)
	add("DELETE /api/purchasing/delivery/{id}", h.deleteDelivery)
	add("POST /api/purchasing/delivery/{id}/arrive", h.arriveDelivery)

	add("GET /api/purchasing/deliveries", h.brokenEmbed)
	add("POST /api/purchasing/deliveries", h.createLegacyDelivery)
	add("GET /api/purchasing/deliveries/{id}", h.brokenEmbed)
	add("PUT /api/purchasing/deliveries/{id}", h.updateLegacyDelivery)
	add("DELETE /api/purchasing/deliveries/{id}", h.cancelLegacyDelivery)
}

// errBrokenEmbed: these TS reads select embeds the query builder cannot
// resolve (`grn:grn_id(...)`, `inspector:inspector_id(...)`,
// `supplier:supplier_id(...)`), so they always fail into apiHandler's 500.
var errBrokenEmbed = errors.New("query builder: no FK relation for embed")

func (h *Handler) brokenEmbed(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	return errBrokenEmbed
}

// paginated is paginatedResponse: { success, data, message?, pagination }.
type paginated struct {
	Success    bool   `json:"success"`
	Data       any    `json:"data"`
	Message    string `json:"message,omitempty"`
	Pagination any    `json:"pagination"`
}

type pageMeta struct {
	Page       float64 `json:"page"`
	Limit      float64 `json:"limit"`
	Total      int     `json:"total"`
	TotalPages any     `json:"totalPages"`
}

func meta(page, limit float64, total int) pageMeta {
	return pageMeta{Page: page, Limit: limit, Total: total, TotalPages: totalPagesF(float64(total), limit)}
}

func totalPagesF(total, limit float64) any {
	v := total / limit
	c := float64(int64(v))
	if v > c {
		c++
	}
	if limit == 0 {
		return nil
	}
	return c
}

/* ── GRN ─────────────────────────────────────────────────────────────── */

func (h *Handler) listGrns(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f := queryForm(r)
	p := GrnListParams{}
	p.Page = coerceNumber(f, "page", 1, 1, nil)
	p.Limit = coerceNumber(f, "limit", 20, 1, validate.Bound(100))
	p.Search = f.Str("search", optional, validate.StrOpts{})
	p.Status = f.Enum("status", optional, grnStatusOptions)
	p.DeliveryID = f.UUID("delivery_id", optional)
	p.PoID = f.UUID("po_id", optional)
	p.DateFrom = f.Str("date_from", optional, validate.StrOpts{})
	p.DateTo = f.Str("date_to", optional, validate.StrOpts{})
	if err := paramsError(f); err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	data, total, err := h.svc.ListGrns(r.Context(), p, scope)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, paginated{Success: true, Data: data, Message: "GRN list retrieved", Pagination: meta(p.Page, p.Limit, total)})
}

func (h *Handler) createGrn(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in, err := parseCreateGrn(f)
	if err != nil {
		return err
	}
	created, err := h.svc.CreateGrn(r.Context(), in, user)
	if err != nil {
		return err
	}
	h.svc.recordAuditAfterCommit(r.Context(), created.Audit.WithRequest(r))
	return writeOKMessage(w, http.StatusCreated, created.Grn, created.Message)
}

func (h *Handler) patchGrnCollection(w http.ResponseWriter, r *http.Request) error {
	return httpx.BadRequest("Use /api/purchasing/grn/[id] for updates")
}

func (h *Handler) grnDetail(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	grn, err := h.svc.GrnDetail(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, grn, "GRN detail retrieved")
}

func (h *Handler) updateGrn(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in, err := parseUpdateGrn(f)
	if err != nil {
		return err
	}
	grn, err := h.svc.UpdateGrn(r.Context(), r.PathValue("id"), in, user.ID)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, grn, "GRN "+grn.Str("nomor_grn")+" berhasil diupdate")
}

func (h *Handler) deleteGrn(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	deleted, number, err := h.svc.DeleteGrn(r.Context(), r.PathValue("id"), user.ID)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, deleted, "GRN "+number+" berhasil dihapus")
}

func (h *Handler) grnItems(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	data, err := h.svc.GrnItems(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return writeData(w, http.StatusOK, data)
}

// recordBody is validateBody with z.record(z.string(), z.unknown()).
func recordBody(r *http.Request) (map[string]any, error) {
	body, err := readBody(r)
	if err != nil {
		return nil, err
	}
	m, ok := body.(map[string]any)
	if !ok {
		received := "array"
		switch body.(type) {
		case nil:
			received = "null"
		case string:
			received = "string"
		case json.Number:
			received = "number"
		case bool:
			received = "boolean"
		}
		return nil, httpx.BadRequest("Validation failed", []validate.Issue{{Code: "invalid_type", Path: []any{}, Message: "Invalid input: expected record, received " + received}})
	}
	return m, nil
}

func (h *Handler) addGrnItem(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	body, err := recordBody(r)
	if err != nil {
		return err
	}
	data, err := h.svc.AddGrnItem(r.Context(), r.PathValue("id"), body)
	if err != nil {
		return err
	}
	return writeData(w, http.StatusOK, data)
}

// qcDoneMessage is QC_DONE_MESSAGE. The TS appends the GRN journal note;
// journals now post through the outbox (procurement.grn.posted), so there
// is no note to append.
const qcDoneMessage = "Quality control completed and stock updated"

func (h *Handler) submitGrnQc(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in, err := parseGrnQc(f)
	if err != nil {
		return err
	}
	in.GrnID, in.UserID = id, user.ID
	if in.Status == "" {
		in.Status = "approved"
	}
	res, err := h.svc.SubmitQc(r.Context(), *in)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusCreated, obj("grn_id", id, "inspection_id", res.InspectionID, "grn_status", res.GrnStatus,
		"totals", obj("accepted", res.TotalAccepted, "rejected", res.TotalReject)), qcDoneMessage)
}

func (h *Handler) submitLegacyQc(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in, err := parseLegacyQc(f)
	if err != nil {
		return err
	}
	in.UserID = user.ID
	res, err := h.svc.SubmitQc(r.Context(), *in)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusCreated, obj("grn_id", in.GrnID, "inspection_id", res.InspectionID, "grn_status", res.GrnStatus,
		"total_accepted", res.TotalAccepted, "total_rejected", res.TotalReject), "QC submitted successfully")
}

func (h *Handler) returnableItems(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	data, err := h.svc.ReturnableGrnItems(r.Context(), r.PathValue("id"), queryPtr(r, "exclude_return_id"))
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

func (h *Handler) grnVendorCredits(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	data, err := h.svc.GrnVendorCredits(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

func (h *Handler) receivingWorkspace(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	data, err := h.svc.ReceivingWorkspace(r.Context(), domain.ModuleType(r.URL.Query().Get("module_type")))
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

/* ── Delivery ────────────────────────────────────────────────────────── */

func (h *Handler) listDeliveries(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f := queryForm(r)
	p := DeliveryListParams{}
	p.Search = f.Str("search", optional, validate.StrOpts{})
	p.Status = f.Str("status", optional, validate.StrOpts{})
	p.SupplierID = f.Str("supplier_id", optional, validate.StrOpts{})
	p.VendorID = f.Str("vendor_id", optional, validate.StrOpts{})
	p.PoID = f.Str("po_id", optional, validate.StrOpts{})
	p.ModuleType = f.Enum("module_type", optional, []string{"raw_material", "product"})
	p.Page = coerceNumber(f, "page", 1, 1, nil)
	p.Limit = coerceNumber(f, "limit", 20, 1, validate.Bound(100))
	p.SortBy, p.SortDir = "created_at", "DESC"
	if v := f.Enum("sort_by", validate.Rule{HasDefault: true}, []string{"tanggal_kirim", "created_at", "status"}); v != nil {
		p.SortBy = *v
	}
	if v := f.Enum("sort_dir", validate.Rule{HasDefault: true}, []string{"ASC", "DESC"}); v != nil {
		p.SortDir = *v
	}
	if err := paramsError(f); err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	data, total, err := h.svc.ListDeliveries(r.Context(), p, scope)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, paginated{Success: true, Data: data, Pagination: meta(p.Page, p.Limit, total)})
}

func (h *Handler) createDelivery(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in, err := parseCreateDelivery(f)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	d, err := h.svc.CreateDelivery(r.Context(), in, user.ID, scope)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusCreated, d, "Delivery created successfully")
}

func (h *Handler) deliveriesForGrn(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	data, err := h.svc.DeliveriesForGrn(r.Context(), domain.ModuleType(r.URL.Query().Get("module_type")), scope)
	if err != nil {
		return err
	}
	return writeData(w, http.StatusOK, data)
}

func (h *Handler) poOptionsForDelivery(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	data, err := h.svc.PoOptionsForDelivery(r.Context(), domain.ModuleType(q.Get("module_type")), q.Get("include_cancelled") == "true", scope)
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

func (h *Handler) deliveryDetail(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	d, err := h.svc.DeliveryDetail(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, d, "Delivery retrieved")
}

func (h *Handler) updateDelivery(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in := &updateDeliveryInput{}
	in.NoSuratJalan = f.Str("no_surat_jalan", optional, validate.StrOpts{Min: 1})
	in.Ekspedisi = f.Str("ekspedisi", optional, validate.StrOpts{})
	in.NoResi = f.Str("no_resi", optional, validate.StrOpts{})
	in.TanggalKirim = f.Str("tanggal_kirim", optional, validate.StrOpts{})
	in.TanggalEstimasi = f.Str("tanggal_estimasi_tiba", optional, validate.StrOpts{})
	in.TanggalAktual = f.Str("tanggal_aktual_tiba", optional, validate.StrOpts{})
	in.Status = f.Enum("status", optional, []string{"pending", "shipped", "in_transit", "delivered", "cancelled"})
	in.Catatan = f.Str("catatan", optional, validate.StrOpts{})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	d, err := h.svc.UpdateDelivery(r.Context(), r.PathValue("id"), in, user.ID)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, d, "Delivery updated")
}

func (h *Handler) deleteDelivery(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	if err := h.svc.DeleteDelivery(r.Context(), r.PathValue("id"), user.ID); err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, nil, "Delivery berhasil dihapus")
}

func (h *Handler) arriveDelivery(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	// arriveDeliverySchema.catch({}): anything but { notes?: string } reads as {}.
	var notes *string
	if body, present := validate.ReadBody(r); present {
		if m, ok := body.(map[string]any); ok {
			switch v := m["notes"].(type) {
			case string:
				notes = &v
			case nil:
			default:
				notes = nil
			}
		}
	}
	res, err := h.svc.ArriveDelivery(r.Context(), r.PathValue("id"), user.ID, notes)
	if err != nil {
		return err
	}
	grn, _ := res.Get("grn").(*Row)
	return writeOKMessage(w, http.StatusOK, res, "Barang arrived — GRN "+grn.Str("nomor_grn")+" berhasil dibuat")
}

/* ── Legacy /deliveries ──────────────────────────────────────────────── */

func (h *Handler) createLegacyDelivery(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	f.Str("po_id", validate.Rule{}, validate.StrOpts{})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	data, err := h.svc.CreateLegacyDelivery(r.Context(), f.Fields())
	if err != nil {
		return err
	}
	return writeData(w, http.StatusOK, data)
}

func (h *Handler) updateLegacyDelivery(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	body, err := recordBody(r)
	if err != nil {
		return err
	}
	data, err := h.svc.UpdateLegacyDelivery(r.Context(), r.PathValue("id"), body)
	if err != nil {
		return err
	}
	return writeData(w, http.StatusOK, data)
}

func (h *Handler) cancelLegacyDelivery(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	if err := h.svc.CancelLegacyDelivery(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Success bool `json:"success"`
	}{true})
}
