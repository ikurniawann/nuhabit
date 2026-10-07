package sales

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Embeds the TS query shim builds for pos_orders (row_to_json for
// many-to-one, json_agg for one-to-many), written out so the JSON matches.
const (
	embedCustomer      = `(SELECT row_to_json(e) FROM (SELECT "name", "phone" FROM "pos"."pos_customers" WHERE "id" = "pos_orders"."customer_id") e) AS "customer"`
	embedCustomerFull  = `(SELECT row_to_json(e) FROM (SELECT "name", "phone", "membership_tier", "ark_coin_balance" FROM "pos"."pos_customers" WHERE "id" = "pos_orders"."customer_id") e) AS "customer"`
	embedItems         = `COALESCE((SELECT json_agg(e) FROM (SELECT * FROM "pos"."pos_order_items" WHERE "order_id" = "pos_orders"."id") e), '[]'::json) AS "items"`
	embedSplitsSummary = `COALESCE((SELECT json_agg(e) FROM (SELECT "id", "split_index", "label", "total_amount", "amount_paid", "status" FROM "pos"."pos_order_splits" WHERE "order_id" = "pos_orders"."id") e), '[]'::json) AS "splits"`
	embedSplitsAll     = `COALESCE((SELECT json_agg(e) FROM (SELECT * FROM "pos"."pos_order_splits" WHERE "order_id" = "pos_orders"."id") e), '[]'::json) AS "splits"`
)

// orderListFilters is OrderListFilters.
type orderListFilters struct {
	Status, CustomerID, PaymentStatus, OrderType, PaymentMethod string
	HasCustomer                                                 bool
	Range                                                       *domain.ReportRange
	Search                                                      string
	ActiveOnly                                                  bool
	Limit                                                       int
}

func pick(raw string, allowed ...string) string {
	for _, a := range allowed {
		if raw == a {
			return raw
		}
	}
	return ""
}

// parseOrderListFilters is parseOrderListFilters.
func (h *Handler) parseOrderListFilters(r *http.Request) (orderListFilters, error) {
	q := r.URL.Query()
	f := orderListFilters{
		Status:        pick(q.Get("status"), "pending", "preparing", "ready", "completed", "cancelled", "voided", "merged"),
		PaymentStatus: pick(q.Get("payment_status"), "paid", "unpaid", "partial", "refunded"),
		OrderType:     pick(q.Get("order_type"), "dine_in", "takeaway", "delivery", "self_order"),
		PaymentMethod: domain.PaymentMethodFilter(q.Get("payment_method")),
		Search:        domain.SanitizeOrderSearch(q.Get("q")),
		ActiveOnly:    q.Get("active_only") == "true",
	}
	if q.Has("customer_id") {
		f.CustomerID, f.HasCustomer = q.Get("customer_id"), q.Get("customer_id") != ""
	}
	_, limitSet := q["limit"]
	f.Limit = domain.ClampOrderListLimit(q.Get("limit"), limitSet)
	from, to := q.Get("date_from"), q.Get("date_to")
	if from != "" || to != "" {
		rng, err := domain.ParseReportDateRange(from, to, h.now())
		if err != nil {
			return f, err
		}
		f.Range = &rng
	}
	return f, nil
}

func (h *Handler) listOrders(w http.ResponseWriter, r *http.Request) error {
	if _, err := kit.PosUser(h.auth, r); err != nil {
		return err
	}
	f, err := h.parseOrderListFilters(r)
	if errors.Is(err, domain.ErrDateOutOfRange) {
		return kit.Fail(w, 500, "Unknown error") // the TS query fails in PostgreSQL
	}
	if err != nil {
		return kit.Fail(w, 400, err.Error())
	}
	data, err := listPosOrders(r.Context(), h.db, f)
	if err != nil {
		h.log.Error("Error fetching orders", "error", err)
		return kit.Fail(w, 500, "Unknown error") // shim errors are not Error instances
	}
	return httpx.JSON(w, 200, struct {
		Success bool         `json:"success"`
		Data    []*jsrow.Row `json:"data"`
	}{true, data})
}

type sqlArgs struct{ list []any }

func (a *sqlArgs) add(v any) string {
	a.list = append(a.list, v)
	return "$" + itoa(len(a.list))
}

func itoa(n int) string {
	const digits = "0123456789"
	if n < 10 {
		return digits[n : n+1]
	}
	return itoa(n/10) + digits[n%10:n%10+1]
}

// listPosOrders is listPosOrders: orders + checkout numbers, orphan
// checkouts (no children) in the date range, tables and stall names.
func listPosOrders(ctx context.Context, db database.Querier, f orderListFilters) ([]*jsrow.Row, error) {
	var a sqlArgs
	var where []string
	if f.Status != "" {
		where = append(where, `"status" = `+a.add(f.Status))
	}
	if f.HasCustomer {
		where = append(where, `"customer_id" = `+a.add(f.CustomerID))
	}
	if f.PaymentStatus != "" {
		where = append(where, `"payment_status" = `+a.add(f.PaymentStatus))
	}
	if f.OrderType != "" {
		where = append(where, `"order_type" = `+a.add(f.OrderType))
	}
	if f.PaymentMethod != "" {
		where = append(where, `"payment_method" = `+a.add(f.PaymentMethod))
	}
	if f.Range != nil {
		where = append(where, `"ordered_at" >= `+a.add(f.Range.Start), `"ordered_at" <= `+a.add(f.Range.End))
	}
	if f.Search != "" {
		where = append(where, `("order_number" ILIKE `+a.add("%"+f.Search+"%")+` OR "queue_number" ILIKE `+a.add("%"+f.Search+"%")+`)`)
	}
	if f.ActiveOnly {
		where = append(where, `"status" NOT IN ('completed', 'cancelled', 'voided', 'merged')`)
	}
	sql := `SELECT *, ` + embedCustomer + `, ` + embedItems + `, ` + embedSplitsSummary + ` FROM "pos"."pos_orders"`
	if len(where) > 0 {
		sql += " WHERE " + strings.Join(where, " AND ")
	}
	sql += ` ORDER BY "ordered_at" DESC LIMIT ` + a.add(f.Limit)
	orders, err := jsrow.Query(ctx, db, sql, a.list...)
	if err != nil {
		return nil, err
	}

	const checkoutCols = `id, checkout_number, queue_number, payment_status, payment_method, payment_method_code, payment_method_name, total_amount, created_at`
	checkoutByID := map[string]*jsrow.Row{}
	if ids := uniqueUUIDs(orders, "checkout_id"); len(ids) > 0 {
		rows, err := jsrow.Query(ctx, db, `SELECT `+checkoutCols+` FROM "pos"."pos_checkouts" WHERE id = ANY($1::uuid[])`, ids)
		if err != nil {
			return nil, err
		}
		for _, c := range rows {
			checkoutByID[c.Str("id")] = c
		}
	}

	if f.Range != nil && !f.ActiveOnly && !f.HasCustomer {
		var ca sqlArgs
		sql := `SELECT ` + checkoutCols + ` FROM "pos"."pos_checkouts" WHERE created_at >= ` + ca.add(f.Range.Start) + ` AND created_at <= ` + ca.add(f.Range.End)
		if f.PaymentStatus != "" {
			sql += ` AND payment_status = ` + ca.add(f.PaymentStatus)
		}
		if f.PaymentMethod != "" {
			sql += ` AND payment_method = ` + ca.add(f.PaymentMethod)
		}
		sql += ` ORDER BY created_at DESC LIMIT ` + ca.add(f.Limit)
		rows, err := jsrow.Query(ctx, db, sql, ca.list...)
		if err != nil && !database.IsUndefinedTable(err) {
			return nil, err
		}
		for _, c := range rows {
			id := c.Str("id")
			if _, seen := checkoutByID[id]; seen {
				continue
			}
			checkoutByID[id] = c
			status := "pending"
			if c.Str("payment_status") == "paid" {
				status = "completed"
			}
			orders = append(orders, jsrow.Object(
				"id", c.Get("id"),
				"order_number", c.Get("checkout_number"),
				"queue_number", c.Get("queue_number"),
				"checkout_id", c.Get("id"),
				"status", status,
				"payment_status", c.Get("payment_status"),
				"payment_method", c.Get("payment_method"),
				"payment_method_code", c.Get("payment_method_code"),
				"payment_method_name", c.Get("payment_method_name"),
				"total_amount", c.Get("total_amount"),
				"ordered_at", c.Get("created_at"),
				"sold_from", "central",
				"items", []any{},
			))
		}
	}

	tableByID := map[string]*jsrow.Row{}
	if ids := uniqueUUIDs(orders, "table_id"); len(ids) > 0 {
		rows, err := jsrow.Query(ctx, db, `SELECT id, table_number, qr_code FROM "pos"."pos_tables" WHERE id = ANY($1::uuid[])`, ids)
		if err != nil {
			return nil, err
		}
		for _, t := range rows {
			tableByID[t.Str("id")] = jsrow.Object("table_number", t.Get("table_number"), "qr_code", t.Get("qr_code"))
		}
	}
	stallByID := map[string]*jsrow.Row{}
	if ids := uniqueUUIDs(orders, "warehouse_id"); len(ids) > 0 {
		rows, err := jsrow.Query(ctx, db, `SELECT id, name, code FROM "configuration"."warehouses" WHERE id = ANY($1::uuid[])`, ids)
		if err != nil {
			return nil, err
		}
		for _, s := range rows {
			stallByID[s.Str("id")] = s
		}
	}

	out := make([]*jsrow.Row, len(orders))
	for i, o := range orders {
		row := o.Clone()
		var checkoutNumber any
		if c := checkoutByID[o.Str("checkout_id")]; c != nil && c.Str("checkout_number") != "" {
			checkoutNumber = c.Get("checkout_number")
		} else if o.Str("checkout_number") != "" {
			checkoutNumber = o.Get("checkout_number")
		}
		row.Set("checkout_number", checkoutNumber)
		var table any
		if o.Str("table_id") != "" {
			if t := tableByID[o.Str("table_id")]; t != nil {
				table = t
			}
		}
		row.Set("table", table)
		var stallName, stallCode any
		if s := stallByID[o.Str("warehouse_id")]; s != nil {
			stallName, stallCode = s.Get("name"), s.Get("code")
		}
		row.Set("stall_name", stallName)
		row.Set("stall_code", stallCode)
		out[i] = row
	}
	return out, nil
}

func uniqueUUIDs(rows []*jsrow.Row, key string) []string {
	seen := map[string]bool{}
	var out []string
	for _, r := range rows {
		s := r.Str(key)
		if s == "" || seen[s] || !isV1to5UUID(s) {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

// isV1to5UUID is list-orders' UUID_RE (version 1-5, RFC variant).
func isV1to5UUID(s string) bool {
	if !validate.IsUUID(s) || len(s) != 36 {
		return false
	}
	return s[14] >= '1' && s[14] <= '5'
}

// getOrder is GET /api/pos/orders/{id}. The TS route has no POS guard; the
// gateway still requires a session.
func (h *Handler) getOrder(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id := r.PathValue("id")
	detail, err := jsrow.QueryOne(ctx, h.db, `SELECT *, `+embedCustomerFull+`, `+embedItems+` FROM "pos"."pos_orders" WHERE "id" = $1`, id)
	if err != nil || detail == nil {
		// `.single()` errors (missing row, bad uuid) are shim objects, not
		// Error instances: the route prints "Unknown error".
		h.log.Error("Error fetching order", "error", err)
		return kit.Fail(w, 500, "Unknown error")
	}
	if wid := detail.Str("warehouse_id"); wid != "" {
		stall, _ := jsrow.QueryOne(ctx, h.db, `SELECT name, code FROM "configuration"."warehouses" WHERE id = $1`, wid)
		var name, code any
		if stall != nil {
			name, code = stall.Get("name"), stall.Get("code")
		}
		detail.Set("stall_name", name)
		detail.Set("stall_code", code)
	}
	if cid := detail.Str("cashier_id"); cid != "" {
		name, _ := h.p.Directory.EmployeeName(ctx, h.db, cid)
		detail.Set("created_by_name", strOrNil(name))
	}
	if vid := detail.Str("voided_by"); vid != "" {
		name, _ := h.p.Directory.UserName(ctx, h.db, vid)
		detail.Set("voided_by_name", strOrNil(name))
	}
	if raw, ok := detail.Get("items").(json.RawMessage); ok {
		if items, err := jsrow.ParseArray(raw); err == nil {
			detail.Set("items", h.resolveItemSkus(ctx, h.db, items))
		}
	}
	return httpx.JSON(w, 200, struct {
		Success bool       `json:"success"`
		Data    *jsrow.Row `json:"data"`
	}{true, detail})
}

func strOrNil(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}
