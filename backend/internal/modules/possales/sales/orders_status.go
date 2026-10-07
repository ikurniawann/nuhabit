package sales

import (
	"fmt"
	"net/http"
	"slices"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	kdomain "nuhabit/backend/internal/modules/possales/kitchen/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
)

var kitchenBumpStatuses = []string{"pending", "confirmed", "preparing", "ready", "served", "completed", "cancelled"}

// updateKitchenStatus is PATCH /api/pos/orders/{id}/status: a station-scoped
// kitchen bump (optionally per item); the order status is derived from the
// remaining F&B lines.
func (h *Handler) updateKitchenStatus(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.PosKitchen...); err != nil {
		return err
	}
	ctx := r.Context()
	orderID := r.PathValue("id")
	body := readObjOrEmpty(r)
	status := ""
	if s, ok := body.Get("status").(string); ok {
		status = s
	}
	if status == "" || !slices.Contains(kitchenBumpStatuses, status) {
		return kit.Fail(w, 400, "Invalid status")
	}
	var itemFilter []string
	if raw, ok := body.List("item_ids"); ok {
		seen := map[string]bool{}
		itemFilter = []string{}
		for _, v := range raw {
			id := domain.Trim(domain.StrOr(v, ""))
			if id != "" && !seen[id] {
				seen[id] = true
				itemFilter = append(itemFilter, id)
			}
		}
	}
	var res *response
	readyForGofood := false
	err := database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		current, err := jsrow.QueryOne(ctx, tx, `SELECT status, payment_status FROM pos.pos_orders WHERE id = $1`, orderID)
		if err != nil || current == nil {
			res = fail(404, "Order not found")
			return nil
		}
		now := h.clock()
		station := ""
		if body.Truthy("station") {
			station = kdomain.NormalizeStation(body.Str("station"), "", "")
		}
		kitchenStatus := kdomain.MapOrderStatusToKitchenStatus(status)
		reason := func(def string) any {
			if body.Truthy("reason") {
				return body.Str("reason")
			}
			return def
		}

		if status == "cancelled" {
			if _, err := tx.Exec(ctx, `UPDATE pos.pos_orders SET status = 'cancelled', updated_at = $2 WHERE id = $1`, orderID, now); err != nil {
				res = fail(500, kit.ErrorMessage(err))
				return err
			}
			h.restoreMerchForOrder(ctx, tx, orderID)
			bestEffort(ctx, tx, `UPDATE pos.pos_order_items SET kitchen_status = $2, updated_at = $3 WHERE order_id = $1`, orderID, kitchenStatus, now)
			// pos_order_status_history has no reason column: the TS insert fails unchecked.
			bestEffort(ctx, tx, `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, reason, changed_at) VALUES ($1, $2, 'cancelled', $3, $4)`,
				orderID, current.Get("status"), reason("Status updated to cancelled"), now)
			res = &response{status: 200, body: jsrow.Object("success", true, "data",
				jsrow.Object("order_id", orderID, "status", "cancelled", "kitchen_status", kitchenStatus))}
			return nil
		}

		items, err := jsrow.Query(ctx, tx, `SELECT id, station, kitchen_status, product_name, kitchen_notes FROM pos.pos_order_items WHERE order_id = $1`, orderID)
		if err != nil {
			res = fail(500, kit.ErrorMessage(err))
			return err
		}
		normalized := make([]kdomain.KitchenItem, len(items))
		var eligible []string
		for i, it := range items {
			normalized[i] = kdomain.KitchenItem{
				ID:            it.Str("id"),
				Station:       kdomain.NormalizeStation(it.Str("station"), it.Str("product_name"), it.Str("kitchen_notes")),
				KitchenStatus: it.Str("kitchen_status"),
			}
			n := normalized[i]
			if !kdomain.IsFnbStation(n.Station) || kdomain.IsTerminalKitchenStatus(n.KitchenStatus) {
				continue
			}
			if station != "" && n.Station != station {
				continue
			}
			eligible = append(eligible, n.ID)
		}
		targets := eligible
		if len(itemFilter) > 0 {
			targets = nil
			for _, id := range eligible {
				if slices.Contains(itemFilter, id) {
					targets = append(targets, id)
				}
			}
			if len(targets) == 0 {
				res = fail(400, "Item tidak ditemukan / sudah selesai di station ini")
				return nil
			}
		}
		if kitchenStatus != "" && len(targets) > 0 {
			set := `kitchen_status = $2, updated_at = $3`
			switch status {
			case "preparing":
				set += `, kitchen_started_at = $3`
			case "ready":
				set += `, kitchen_ready_at = $3`
			case "served", "completed":
				set += `, served_at = $3`
			}
			if _, err := tx.Exec(ctx, `UPDATE pos.pos_order_items SET `+set+` WHERE id = ANY($1::uuid[])`, targets, kitchenStatus, now); err != nil {
				res = fail(500, kit.ErrorMessage(err))
				return err
			}
		}
		for i := range normalized {
			if slices.Contains(targets, normalized[i].ID) && kitchenStatus != "" {
				normalized[i].KitchenStatus = kitchenStatus
			}
		}
		orderStatus, derivedKitchen := kdomain.DeriveOrderKitchenStatus(normalized, current.Str("payment_status"))
		set := `status = $2, updated_at = $3`
		switch orderStatus {
		case "confirmed":
			set += `, confirmed_at = $3`
		case "served":
			set += `, served_at = $3`
		case "completed":
			set += `, served_at = $3, completed_at = $3`
		}
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_orders SET `+set+` WHERE id = $1`, orderID, orderStatus, now); err != nil {
			h.log.Error("Status update error", "error", err)
			res = fail(500, kit.ErrorMessage(err))
			return err
		}
		hint := ""
		if len(itemFilter) > 0 {
			hint = fmt.Sprintf(" (item %d/%d)", len(targets), len(itemFilter))
		}
		stationHint := ""
		if station != "" {
			stationHint = " (" + station + ")"
		}
		bestEffort(ctx, tx, `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, reason, changed_at) VALUES ($1, $2, $3, $4, $5)`,
			orderID, current.Get("status"), orderStatus, reason("Status updated to "+status+stationHint+hint), now)
		readyForGofood = orderStatus == "ready" || orderStatus == "served" || orderStatus == "completed"
		if targets == nil {
			targets = []string{}
		}
		res = &response{status: 200, body: jsrow.Object("success", true, "data", jsrow.Object(
			"order_id", orderID, "status", orderStatus, "kitchen_status", derivedKitchen, "station", nilIfEmpty(station), "item_ids", targets))}
		return nil
	})
	if res != nil && res.status >= 400 {
		return httpx.JSON(w, res.status, res.body)
	}
	if err != nil {
		return err
	}
	if readyForGofood {
		h.p.GofoodReady(ctx, orderID)
	}
	return httpx.JSON(w, res.status, res.body)
}
