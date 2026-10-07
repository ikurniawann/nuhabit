package kitchen

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/modules/possales/kitchen/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
)

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// kdsSelect is the stationSelect of the TS route as the query shim expands it:
// pos_order_items is a one-to-many embed (json_agg, '[]' when empty).
const kdsSelect = `SELECT id, order_number, queue_number, checkout_id, warehouse_id, status,
	payment_status, order_type, table_id, notes, special_requests, ordered_at, confirmed_at,
	COALESCE((SELECT json_agg(e) FROM (SELECT id, product_id, product_name, product_sku, variants,
		modifiers, quantity, unit_price, kitchen_notes, station, kitchen_status, kitchen_started_at,
		kitchen_ready_at, served_at FROM pos.pos_order_items WHERE order_id = pos_orders.id) e), '[]'::json)
		AS pos_order_items
	FROM pos.pos_orders
	WHERE status NOT IN ('voided', 'cancelled', 'merged', 'completed')`

// listKDS is GET /api/pos/kds: open kitchen tickets (pos_orders, never
// checkouts) with their F&B items, filtered by station, stall and date.
func (h *Handler) listKDS(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.PosKitchen...); err != nil {
		return err
	}
	q := r.URL.Query()
	sql := kdsSelect
	var args []any
	where := func(cond, value string) {
		args = append(args, value)
		sql += fmt.Sprintf(" AND "+cond, len(args))
	}
	// Filters take text parameters and cast server side, so a malformed
	// value fails with PostgreSQL's own message, as in the TS shim.
	if v := q.Get("branch_id"); v != "" {
		where("branch_id = $%d::text::uuid", v)
	}
	if v := q.Get("warehouse_id"); v != "" && uuidPattern.MatchString(v) {
		where("warehouse_id = $%d::text::uuid", v)
	}
	if v := q.Get("date_from"); v != "" {
		where("ordered_at >= $%d::text::timestamptz", v)
	}
	if v := q.Get("date_to"); v != "" {
		where("ordered_at < $%d::text::timestamptz", v)
	}
	limitParam := q.Get("limit")
	if limitParam == "" {
		limitParam = "50"
	}
	limit, ok := jsParseInt(limitParam)
	if !ok {
		// parseInt gave NaN and the shim sent it as the LIMIT parameter.
		return kit.Fail(w, http.StatusInternalServerError, `invalid input syntax for type bigint: "NaN"`)
	}
	args = append(args, max(limit, 80))
	sql += fmt.Sprintf(" ORDER BY ordered_at DESC LIMIT $%d", len(args))

	orders, err := jsrow.Query(r.Context(), h.db, sql, args...)
	if err != nil {
		h.log.ErrorContext(r.Context(), "KDS query error", "error", err)
		return kit.Fail(w, http.StatusInternalServerError, pgMessage(err))
	}

	labels := h.tableLabels(r, orders)
	wanted := strings.ToLower(q.Get("station"))
	nowMs := h.now().UnixMilli()
	data := []*jsrow.Row{}
	for _, order := range orders {
		raw, err := jsNormalize(order.Get("pos_order_items"))
		if err != nil {
			return err
		}
		rawItems, _ := raw.([]any)
		items := []any{}
		var refs []domain.KitchenItem
		for _, ri := range rawItems {
			item, ok := ri.(*jsrow.Row)
			if !ok {
				continue
			}
			station := domain.NormalizeStation(item.Str("station"), item.Str("product_name"), item.Str("kitchen_notes"))
			status := item.Str("kitchen_status")
			if status == "" {
				status = domain.MapOrderStatusToKitchenStatus(order.Str("status"))
			}
			if !domain.IsFnbStation(station) || domain.IsTerminalKitchenStatus(status) || (wanted != "" && station != wanted) {
				continue
			}
			item.Set("station", station)
			item.Set("kitchen_status", status)
			item.Set("variant_info", variantInfo(item.Get("variants")))
			item.Set("modifier_info", variantInfo(item.Get("modifiers")))
			item.Set("notes", item.Str("kitchen_notes"))
			items = append(items, item)
			refs = append(refs, domain.KitchenItem{Station: station, KitchenStatus: status})
		}
		if len(items) == 0 {
			continue
		}
		stationStatus := domain.DeriveStationStatus(refs, wanted)
		order.Set("pos_order_items", items)
		order.Set("station_status", stationStatus)
		if wanted != "" {
			order.Set("status", stationStatus)
		}
		var label any
		if t, ok := labels[order.Str("table_id")]; ok {
			switch {
			case t.TableNumber != "":
				label = t.TableNumber
			case t.QRCode != "":
				label = t.QRCode
			}
		}
		order.Set("table_label", label)

		orderedMs := nowMs
		if order.Get("ordered_at") != nil {
			orderedMs = order.Time("ordered_at").UnixMilli()
		}
		waitSeconds := int64(math.Floor(float64(nowMs-orderedMs) / 1000))
		waitMinutes := int64(math.Floor(float64(waitSeconds) / 60))
		order.Set("wait_seconds", waitSeconds)
		order.Set("wait_minutes", waitMinutes)
		order.Set("is_overdue", waitMinutes > 15)
		order.Set("is_urgent", waitMinutes > 10)
		data = append(data, order)
	}
	return httpx.JSON(w, http.StatusOK, jsrow.Object("success", true, "data", data, "count", len(data)))
}

// tableLabels loads the tables of the tickets; a failed read leaves every
// label null, as the TS ignores tableError.
func (h *Handler) tableLabels(r *http.Request, orders []*jsrow.Row) map[string]TableRef {
	seen := map[string]bool{}
	var ids []string
	for _, o := range orders {
		if id := o.Str("table_id"); uuidPattern.MatchString(id) && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	tables, err := h.tables.Tables(r.Context(), ids)
	if err != nil {
		h.log.WarnContext(r.Context(), "KDS table lookup failed", "error", err)
		return nil
	}
	return tables
}

// variantInfo is formatVariantInfo: the truthy `name` of every object in a
// JSON array, joined with ", "; "" for anything else.
func variantInfo(v any) string {
	arr, ok := v.([]any)
	if !ok {
		return ""
	}
	var names []string
	for _, e := range arr {
		if obj, ok := e.(*jsrow.Row); ok && jsTruthy(obj.Get("name")) {
			names = append(names, jsString(obj.Get("name")))
		}
	}
	return strings.Join(names, ", ")
}

// pgMessage is the `error.message` the TS shim reports: the server message
// for a PostgreSQL error, the error text otherwise.
func pgMessage(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Message
	}
	return err.Error()
}
