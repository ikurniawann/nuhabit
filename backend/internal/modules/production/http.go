package production

import (
	"math"
	"net/http"
	"net/url"
	"strconv"

	"nuhabit/backend/internal/modules/production/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/module"
	ps "nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/validate"
)

// Handler serves /api/production.
type Handler struct {
	svc  *Service
	auth *auth.Service
	db   database.Querier
}

// Routes lists every route of the module.
func (h *Handler) Routes() []module.Route {
	route := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	return []module.Route{
		route("GET /api/production/bom/explode", h.explode),
		route("GET /api/production/orders/{id}/flow", h.flow),
		route("POST /api/production/orders/{id}/issues", h.issue),
		route("POST /api/production/orders/{id}/returns", h.returnMaterials),
		route("POST /api/production/orders/{id}/sub-orders", h.createSubOrders),
		route("POST /api/production/orders/{id}/receipts", h.receive),
		route("GET /api/production/wip", h.wip),
		route("GET /api/production/batches", h.batches),
		route("GET /api/production/batches/{id}", h.batch),
		route("GET /api/production/recipe-settings", h.recipeSettings),
		route("PUT /api/production/recipe-settings", h.saveRecipeSettings),
	}
}

// reader passes staff with a production menu; writer needs its update action.
func (h *Handler) reader(r *http.Request) (*auth.User, *ps.Scope, error) {
	u, err := h.auth.RequireMenuPrefix(r, iam.ItemsProduction...)
	if err != nil {
		return nil, nil, err
	}
	scope, err := ps.Load(r.Context(), h.db, u.ID)
	return u, scope, err
}

func (h *Handler) writer(r *http.Request) (*auth.User, *ps.Scope, error) {
	u, err := h.auth.RequireMenuAction(r, "update", iam.ItemsProduction...)
	if err != nil {
		return nil, nil, err
	}
	scope, err := ps.Load(r.Context(), h.db, u.ID)
	return u, scope, err
}

func pathID(r *http.Request, notFound string) (string, error) {
	id := r.PathValue("id")
	if !validate.IsUUID(id) {
		return "", httpx.NotFound(notFound)
	}
	return id, nil
}

/* GET /api/production/bom/explode?product_id=|raw_material_id=&qty= */
func (h *Handler) explode(w http.ResponseWriter, r *http.Request) error {
	if _, _, err := h.reader(r); err != nil {
		return err
	}
	in, err := parseExplode(r.URL.Query())
	if err != nil {
		return err
	}
	view, err := h.svc.Explode(r.Context(), in)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, view)
}

func parseExplode(sp url.Values) (ExplodeInput, error) {
	in := ExplodeInput{ProductID: sp.Get("product_id"), RawMaterialID: sp.Get("raw_material_id"), Qty: 1}
	if (in.ProductID == "") == (in.RawMaterialID == "") {
		return in, httpx.BadRequest("Isi salah satu: product_id atau raw_material_id")
	}
	if !validate.IsUUID(in.ProductID + in.RawMaterialID) {
		return in, httpx.BadRequest("ID item tidak valid")
	}
	if raw := sp.Get("qty"); raw != "" {
		q, err := strconv.ParseFloat(raw, 64)
		if err != nil || !(q > 0) || math.IsInf(q, 0) {
			return in, httpx.BadRequest("Jumlah harus lebih dari 0")
		}
		in.Qty = q
	}
	return in, nil
}

/* GET /api/production/orders/{id}/flow */
func (h *Handler) flow(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.reader(r)
	if err != nil {
		return err
	}
	id, err := pathID(r, errOrderNotFound.Message)
	if err != nil {
		return err
	}
	view, err := h.svc.Flow(r.Context(), scope, id)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, view)
}

/*
POST /api/production/orders/{id}/issues

	{ lines: [{ material_id, qty, warehouse_id? }], catatan? }
*/
func (h *Handler) issue(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.writer(r)
	if err != nil {
		return err
	}
	id, err := pathID(r, errOrderNotFound.Message)
	if err != nil {
		return err
	}
	in, err := parseIssue(r)
	if err != nil {
		return err
	}
	res, err := h.svc.Issue(r.Context(), scope, id, u.ID, in)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusCreated, res, res.Message)
}

// materialLines reads [{ material_id, qty, warehouse_id? }] under key.
func materialLines(f *validate.Form, key string, rule validate.Rule) []IssueLineInput {
	var lines []IssueLineInput
	f.List(key, rule, 200, func(sub *validate.Form, i int, v any) {
		item := sub.Item(i, v)
		var l IssueLineInput
		if id := item.UUID("material_id", validate.Rule{}); id != nil {
			l.MaterialLineID = *id
		}
		if q := item.Num("qty", validate.Rule{}, validate.NumOpts{Positive: true}); q != nil {
			l.Qty = domain.RoundQty(*q)
		}
		l.WarehouseID = item.UUID("warehouse_id", validate.Rule{Optional: true, Nullable: true})
		lines = append(lines, l)
	})
	return lines
}

func parseIssue(r *http.Request) (IssueInput, error) {
	f := validate.New(validate.ReadBody(r))
	in := IssueInput{Lines: materialLines(f, "lines", validate.Rule{})}
	in.Catatan = optionalText(f, "catatan")
	if err := f.Err("Validation failed"); err != nil {
		return in, err
	}
	if len(in.Lines) == 0 {
		return in, httpx.BadRequest("Pilih minimal satu bahan untuk dikeluarkan")
	}
	return in, nil
}

/* POST /api/production/orders/{id}/sub-orders: DRAFT orders for short intermediates. */
func (h *Handler) createSubOrders(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.writer(r)
	if err != nil {
		return err
	}
	id, err := pathID(r, errOrderNotFound.Message)
	if err != nil {
		return err
	}
	res, err := h.svc.CreateSubOrders(r.Context(), scope, id, u.ID)
	if err != nil {
		return err
	}
	status := http.StatusCreated
	if len(res.Created) == 0 {
		status = http.StatusOK
	}
	return httpx.DataMessage(w, status, res, res.Message)
}

/*
POST /api/production/orders/{id}/returns

	{ lines: [{ material_id, qty, warehouse_id? }], catatan? }
*/
func (h *Handler) returnMaterials(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.writer(r)
	if err != nil {
		return err
	}
	id, err := pathID(r, errOrderNotFound.Message)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	in := ReturnInput{Lines: materialLines(f, "lines", validate.Rule{})}
	in.Catatan = optionalText(f, "catatan")
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	res, err := h.svc.Return(r.Context(), scope, id, u.ID, in)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusCreated, res, res.Message)
}

/*
POST /api/production/orders/{id}/receipts

	{ qty_good, qty_scrap?, final?, catatan?, variant_output?: [{ pos_sku_id, qty }],
	  overhead_cost?, labor_cost?, packaging_cost?, waste_cost?,
	  returns?: [{ material_id, qty, warehouse_id? }] (final receipt only) }
*/
func (h *Handler) receive(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.writer(r)
	if err != nil {
		return err
	}
	id, err := pathID(r, errOrderNotFound.Message)
	if err != nil {
		return err
	}
	in, err := parseReceipt(r)
	if err != nil {
		return err
	}
	res, err := h.svc.Receive(r.Context(), scope, id, u.ID, in)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusCreated, res, res.Message)
}

func parseReceipt(r *http.Request) (ReceiptInput, error) {
	f := validate.New(validate.ReadBody(r))
	var in ReceiptInput
	nonNegative := validate.NumOpts{Min: validate.Bound(0)}
	if q := f.Num("qty_good", validate.Rule{}, nonNegative); q != nil {
		in.QtyGood = jsmath.RoundTo(*q, 3)
	}
	if q := f.Num("qty_scrap", validate.Rule{HasDefault: true}, nonNegative); q != nil {
		in.QtyScrap = jsmath.RoundTo(*q, 3)
	}
	in.Final = f.BoolDefault("final", false)
	in.Catatan = optionalText(f, "catatan")
	f.List("variant_output", validate.Rule{Optional: true}, 100, func(sub *validate.Form, i int, v any) {
		item := sub.Item(i, v)
		var row domain.Variant
		if id := item.UUID("pos_sku_id", validate.Rule{}); id != nil {
			row.SkuID = *id
		}
		if q := item.Num("qty", validate.Rule{}, validate.NumOpts{Positive: true}); q != nil {
			row.Qty = *q
		}
		in.Variants = append(in.Variants, row)
	})
	in.Overhead = f.Num("overhead_cost", validate.Rule{Optional: true}, nonNegative)
	in.Labor = f.Num("labor_cost", validate.Rule{Optional: true}, nonNegative)
	in.Packaging = f.Num("packaging_cost", validate.Rule{Optional: true}, nonNegative)
	in.Waste = f.Num("waste_cost", validate.Rule{Optional: true}, nonNegative)
	in.Returns = materialLines(f, "returns", validate.Rule{Optional: true})
	return in, f.Err("Validation failed")
}

func optionalText(f *validate.Form, key string) *string {
	s := f.Str(key, validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Trim: true})
	if s == nil || *s == "" {
		return nil
	}
	return s
}

func listFilter(sp url.Values) ListFilter {
	f := ListFilter{Search: sp.Get("search"), Limit: 50}
	if c := sp.Get("production_context"); c == "product" || c == "raw_material" {
		f.Context = c
	}
	if id := sp.Get("order_id"); validate.IsUUID(id) {
		f.OrderID = id
	}
	if n, err := strconv.Atoi(sp.Get("limit")); err == nil {
		f.Limit = n
	}
	return f
}

/* GET /api/production/wip?production_context=&search= */
func (h *Handler) wip(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.reader(r)
	if err != nil {
		return err
	}
	view, err := h.svc.Wip(r.Context(), scope, listFilter(r.URL.Query()))
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, view)
}

/* GET /api/production/batches?production_context=&order_id=&search=&limit= */
func (h *Handler) batches(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.reader(r)
	if err != nil {
		return err
	}
	rows, err := h.svc.Batches(r.Context(), scope, listFilter(r.URL.Query()))
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, rows)
}

/* GET /api/production/batches/{id} */
func (h *Handler) batch(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.reader(r)
	if err != nil {
		return err
	}
	id, err := pathID(r, "Batch produksi tidak ditemukan")
	if err != nil {
		return err
	}
	view, err := h.svc.Batch(r.Context(), scope, id)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, view)
}
