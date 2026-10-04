package gofood

import (
	"encoding/json"
	"errors"
	"net/http"

	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Routes lists the routes of frontend/src/app/api/pos/gofood.
func (h *Handler) Routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/pos/gofood/orders", Handler: httpx.Handle(h.list)},
		{Pattern: "POST /api/pos/gofood/orders/{id}", Handler: httpx.Handle(h.action)},
	}
}

type listMeta struct {
	Configured  bool   `json:"configured"`
	Enabled     bool   `json:"enabled"`
	AutoAccept  bool   `json:"auto_accept"`
	Environment string `json:"environment"`
}

// list is GET /api/pos/gofood/orders?status=active|<status>&limit=50.
func (h *Handler) list(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.PosOperations...); err != nil {
		return err
	}
	q := r.URL.Query()
	status := q.Get("status")
	if status == "" {
		status = "active"
	}
	orders, err := h.svc.List(r.Context(), status, q.Get("limit"))
	if err != nil {
		return h.listFailed(w, err)
	}
	cfg, err := h.svc.Config(r.Context())
	if err != nil {
		return h.listFailed(w, err)
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Success bool         `json:"success"`
		Data    []*jsrow.Row `json:"data"`
		Meta    listMeta     `json:"meta"`
	}{true, orders, listMeta{cfg.IsConfigured(), cfg.Enabled, cfg.AutoAccept, cfg.Environment}})
}

func (h *Handler) listFailed(w http.ResponseWriter, err error) error {
	h.log.Error("[pos/gofood] list failed", "error", err)
	return kit.Fail(w, http.StatusInternalServerError, errorMessage(err))
}

var rejectReasons = []string{"HIGH_DEMAND", "RESTAURANT_CLOSED", "ITEMS_OUT_OF_STOCK", "OTHERS"}

// action is POST /api/pos/gofood/orders/{id}
// {action: accept | reject (reason_code, reason_description) | ready | create_pos_order}.
func (h *Handler) action(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.PosOperations...); err != nil {
		return err
	}
	id := r.PathValue("id")
	f := validate.New(validate.ReadBody(r))
	action := f.Str("action", validate.Rule{}, validate.StrOpts{})
	var code, description *string
	if action != nil && *action == "reject" {
		code = f.Enum("reason_code", validate.Rule{}, rejectReasons)
		description = f.Str("reason_description", validate.Rule{}, validate.StrOpts{Trim: true, Min: 3, Max: 200})
	}
	if !f.Valid() || action == nil {
		return kit.Fail(w, http.StatusBadRequest, "Aksi tidak valid")
	}

	ctx := r.Context()
	var data any
	var err error
	switch *action {
	case "accept":
		data, err = h.svc.Accept(ctx, id)
	case "reject":
		data, err = h.svc.Reject(ctx, id, *code, *description)
	case "ready":
		data, err = h.svc.Ready(ctx, id)
	case "create_pos_order":
		var row *jsrow.Row
		if row, err = h.svc.CreatePosOrder(ctx, id); err == nil && row == nil {
			return kit.Fail(w, http.StatusNotFound, "Order tidak ditemukan")
		}
		data = row
	default:
		return kit.Fail(w, http.StatusBadRequest, "Aksi tidak valid")
	}
	if err != nil {
		return h.actionFailed(w, err)
	}
	return httpx.Data(w, http.StatusOK, data)
}

// actionFailed maps errors like the route's catch block.
func (h *Handler) actionFailed(w http.ResponseWriter, err error) error {
	if errors.Is(err, ErrNotConfigured) {
		return kit.Fail(w, http.StatusBadRequest, err.Error())
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return httpx.JSON(w, http.StatusBadGateway, struct {
			Success bool            `json:"success"`
			Error   string          `json:"error"`
			Detail  json.RawMessage `json:"detail"`
		}{false, "GoBiz: " + apiErr.Message, apiErr.Body})
	}
	h.log.Error("[pos/gofood] action failed", "error", err)
	msg := errorMessage(err)
	if errors.As(err, new(queryBuilderError)) {
		msg = "Aksi gagal"
	}
	return kit.Fail(w, http.StatusBadRequest, msg)
}
