package posops

import (
	"net/http"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/stall"
)

// Catalog routes (app/api/pos/products). The catch renders
// `error instanceof Error ? error.message : 'Unknown error'`, and the
// QueryBuilder's errors are not Error instances.
func (h *Handler) productRoutes() []module.Route {
	unknown := fixed("Unknown error")
	return []module.Route{
		{Pattern: "GET /api/pos/products", Handler: caught(unknown, h.listProducts)},
		{Pattern: "POST /api/pos/products", Handler: caught(unknown, h.createProduct)},
		{Pattern: "POST /api/pos/products/sync-purchasing", Handler: caught(unknown, h.syncPurchasing)},
		{Pattern: "PATCH /api/pos/products/{id}", Handler: caught(unknown, h.updateProduct)},
		{Pattern: "GET /api/pos/products/{id}/skus", Handler: caught(unknown, h.listSkus)},
		{Pattern: "POST /api/pos/products/{id}/skus", Handler: caught(unknown, h.createSku)},
		{Pattern: "PATCH /api/pos/products/{id}/skus/{skuId}", Handler: caught(unknown, h.updateSku)},
		{Pattern: "DELETE /api/pos/products/{id}/skus/{skuId}", Handler: caught(unknown, h.deleteSku)},
		{Pattern: "POST /api/pos/products/{id}/skus/matrix", Handler: caught(pgMessage, h.skuMatrix)},
	}
}

// caller builds the stall rules' view of the request.
func (h *Handler) caller(r *http.Request, u *auth.User) Caller {
	c := Caller{UserID: u.ID, Role: u.Role, ActiveStall: stall.Cookie(r)}
	// loadCentralCashierGate treats a failing grant lookup as no grant.
	if granted, err := h.auth.GrantedMenuCodes(r.Context(), u.ID, u.Role); err == nil {
		c.CentralMenu = iam.HasMenuCode(granted, domain.CentralCashierMenu)
	}
	return c
}

func (h *Handler) listProducts(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.PosCatalog...)
	if err != nil {
		return err
	}
	f := productFilter{
		IncludeInactive: r.URL.Query().Get("include_inactive") == "true",
		Category:        queryParam(r, "category"),
		Search:          queryParam(r, "search"),
	}
	list, err := h.svc.ListProducts(r.Context(), h.caller(r, user), f)
	if err != nil {
		return err
	}
	return writeObj(w, http.StatusOK, NewObj("success", true, "data", list.Products, "meta", list.Meta))
}

func (h *Handler) createProduct(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.PosCatalog...); err != nil {
		return err
	}
	body, err := destructured(r, "sku")
	if err != nil {
		return err
	}
	product, err := h.svc.CreateProduct(r.Context(), body)
	if err != nil {
		return err
	}
	return okData(w, product)
}

func (h *Handler) syncPurchasing(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.PosCatalog...); err != nil {
		return err
	}
	body, err := objectBody(r, "purchasing_product_ids")
	if err != nil {
		return err
	}
	result, err := h.svc.SyncPurchasing(r.Context(), body)
	if err != nil {
		return err
	}
	return okData(w, result)
}

func (h *Handler) updateProduct(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuAction(r, "update", iam.PosCatalogProducts...); err != nil {
		return err
	}
	body, err := objectBody(r, "xp_points")
	if err != nil {
		return err
	}
	product, err := h.svc.UpdateProduct(r.Context(), r.PathValue("id"), body)
	if err != nil {
		return err
	}
	return okData(w, product)
}

func (h *Handler) listSkus(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	skus, err := h.svc.ListSkus(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return okData(w, skus)
}

func (h *Handler) createSku(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuAction(r, "create", iam.PosCatalogProducts...); err != nil {
		return err
	}
	body, err := objectBody(r, "sku")
	if err != nil {
		return err
	}
	sku, err := h.svc.CreateSku(r.Context(), r.PathValue("id"), body)
	if err != nil {
		return err
	}
	return writeObj(w, http.StatusCreated, NewObj("success", true, "data", sku))
}

func (h *Handler) updateSku(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuAction(r, "update", iam.PosCatalogProducts...); err != nil {
		return err
	}
	body, err := objectBody(r, "sku")
	if err != nil {
		return err
	}
	sku, err := h.svc.UpdateSku(r.Context(), r.PathValue("id"), r.PathValue("skuId"), body)
	if err != nil {
		return err
	}
	return okData(w, sku)
}

func (h *Handler) deleteSku(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuAction(r, "delete", iam.PosCatalogProducts...); err != nil {
		return err
	}
	if err := h.svc.DeleteSku(r.Context(), r.PathValue("id"), r.PathValue("skuId")); err != nil {
		return err
	}
	return writeObj(w, http.StatusOK, NewObj("success", true))
}

func (h *Handler) skuMatrix(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuAction(r, "create", iam.PosCatalogProducts...); err != nil {
		return err
	}
	res, err := h.svc.GenerateSkuMatrix(r.Context(), r.PathValue("id"), jsonBodyOr(r, emptyObject()))
	if err != nil {
		return err
	}
	if res.Blocked != nil {
		return writeObj(w, http.StatusConflict, NewObj("success", false,
			"error", "SKU dengan stok masih ada tidak bisa dinonaktifkan otomatis — kosongkan stoknya dulu",
			"blocked", res.Blocked))
	}
	return okData(w, res.Data)
}
