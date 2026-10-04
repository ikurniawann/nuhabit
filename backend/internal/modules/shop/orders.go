package shop

import (
	"context"
	"fmt"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Back-office orders (lib/shop/orders.ts): list, detail and status
// transitions. Shipments are in shipments.go.

const orderNotFound = "Order tidak ditemukan"

// assertOrderID is assertOrderId: a non-UUID id is an order that does not
// exist.
func assertOrderID(id string) error {
	if !validate.IsUUID(id) {
		return httpx.NotFound(orderNotFound)
	}
	return nil
}

// ListOrders is listShopOrders.
func (s *Service) ListOrders(ctx context.Context, f domain.OrderListFilter) ([]*Row, error) {
	s.releaseExpiredReservations(ctx)
	var conds []string
	var args []any
	if f.Status != "" {
		args = append(args, f.Status)
		conds = append(conds, fmt.Sprintf("o.status = $%d", len(args)))
	}
	if f.Search != "" {
		args = append(args, "%"+f.Search+"%")
		n := len(args)
		conds = append(conds, fmt.Sprintf("(o.order_number ILIKE $%d OR o.customer_name ILIKE $%d OR o.customer_phone ILIKE $%d)", n, n, n))
	}
	// The limit goes as text so PostgreSQL parses it like the pg driver's
	// parameter (a fractional limit fails the same way).
	args = append(args, validate.JSNumber(f.Limit))
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}
	return queryRows(ctx, s.db, fmt.Sprintf(`SELECT o.id, o.order_number, o.status, o.customer_name, o.customer_phone,
		  o.shipping_area_label, o.courier_code, o.courier_service,
		  o.subtotal, o.shipping_cost, o.total, o.waybill, o.paid_at,
		  o.created_at, o.customer_id,
		  (SELECT COUNT(*) FROM shop.order_items i WHERE i.order_id = o.id) AS item_count,
		  s.status AS shipment_status, s.provider AS shipment_provider
		FROM shop.orders o
		LEFT JOIN shop.shipments s
		  ON s.order_id = o.id AND s.status NOT IN ('failed','cancelled')
		%s
		ORDER BY o.created_at DESC
		LIMIT $%d`, where, len(args)), args...)
}

// OrderDetail is getShopOrderDetail: the order with its active shipment and
// its items.
func (s *Service) OrderDetail(ctx context.Context, id string) (*Row, error) {
	order, err := queryRow(ctx, s.db, `SELECT o.*, s.id AS shipment_id, s.provider AS shipment_provider,
		  s.status AS shipment_status, s.provider_order_id,
		  s.tracking_history
		FROM shop.orders o
		LEFT JOIN shop.shipments s
		  ON s.order_id = o.id AND s.status NOT IN ('failed','cancelled')
		WHERE o.id = $1::uuid`, id)
	if err != nil {
		return nil, err
	}
	if order == nil {
		return nil, httpx.NotFound(orderNotFound)
	}
	items, err := queryRows(ctx, s.db, `SELECT product_name, sku_name, sku_code, quantity, unit_price, total, weight_gram
		FROM shop.order_items WHERE order_id = $1::uuid ORDER BY product_name`, id)
	if err != nil {
		return nil, err
	}
	return order.Set("items", items), nil
}

// TransitionOrder is transitionShopOrder. Cancelling gives stock back:
// held reservations of a pending order, committed ones of a paid order
// (the money is refunded by hand in the Xendit dashboard).
func (s *Service) TransitionOrder(ctx context.Context, id, next string, note *string) (*Row, error) {
	allowed, ok := domain.AllowedFromStatuses(next)
	if !ok {
		return nil, httpx.BadRequest("Transisi status tidak dikenal")
	}
	updated, err := queryRow(ctx, s.db, `UPDATE shop.orders o
		SET status = $2, updated_at = now(),
		    notes = CASE WHEN $3::text IS NOT NULL
		                 THEN COALESCE(o.notes || E'\n', '') || $3::text
		                 ELSE o.notes END
		FROM (SELECT status AS prev_status FROM shop.orders WHERE id = $1::uuid) prev
		WHERE o.id = $1::uuid AND o.status = ANY($4::text[])
		RETURNING o.id, o.status, prev.prev_status`, id, next, note, allowed)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, httpx.Conflict("Status order sudah berubah — muat ulang")
	}
	if next != "cancelled" {
		return updated, nil
	}
	if updated.Str("prev_status") == "pending" {
		return updated, s.releaseOrderReservations(ctx, id)
	}
	if err := s.restoreCommittedReservations(ctx, id); err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(ctx, `UPDATE shop.shipments SET status='cancelled', updated_at=now()
		WHERE order_id = $1::uuid AND status NOT IN ('failed','cancelled')`, id); err != nil {
		s.log.Error("[shop] cancel shipment failed", "order", id, "error", err)
	}
	return updated, nil
}

// PublicOrderStatus is PublicOrderStatus: what the buyer's status page shows.
type PublicOrderStatus struct {
	OrderNumber       string                   `json:"order_number"`
	Status            string                   `json:"status"`
	CustomerName      string                   `json:"customer_name"`
	ShippingAreaLabel *string                  `json:"shipping_area_label"`
	ShippingAddress   string                   `json:"shipping_address"`
	Courier           string                   `json:"courier"`
	Subtotal          float64                  `json:"subtotal"`
	ShippingCost      float64                  `json:"shipping_cost"`
	Total             float64                  `json:"total"`
	InvoiceURL        *string                  `json:"invoice_url"`
	Waybill           *string                  `json:"waybill"`
	PaidAt            *httpx.JSTime            `json:"paid_at"`
	CreatedAt         httpx.JSTime             `json:"created_at"`
	Items             []domain.PublicOrderItem `json:"items"`
}

// PublicOrderStatus is loadPublicOrderStatus by access token (nil when
// unknown). The invoice link shows only while the order is pending.
func (s *Service) PublicOrderStatus(ctx context.Context, token string) (*PublicOrderStatus, error) {
	var v PublicOrderStatus
	var id, subtotal, shipping, total string
	var courier, service, invoiceURL *string
	var paidAt *time.Time
	var createdAt time.Time
	err := s.db.QueryRow(ctx, `SELECT id::text, order_number, status, customer_name, shipping_area_label,
		  shipping_address, courier_code, courier_service, subtotal::text,
		  shipping_cost::text, total::text, xendit_invoice_url, waybill, paid_at, created_at
		FROM shop.orders WHERE access_token = $1::uuid`, token).Scan(&id, &v.OrderNumber, &v.Status, &v.CustomerName,
		&v.ShippingAreaLabel, &v.ShippingAddress, &courier, &service, &subtotal, &shipping, &total, &invoiceURL,
		&v.Waybill, &paidAt, &createdAt)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v.Courier = domain.JoinNonEmpty(" — ", courier, service)
	v.Subtotal, v.ShippingCost, v.Total = domain.JSNumber(subtotal), domain.JSNumber(shipping), domain.JSNumber(total)
	v.InvoiceURL = domain.InvoiceURLWhilePending(v.Status, invoiceURL)
	v.PaidAt, v.CreatedAt = httpx.NewJSTime(paidAt), httpx.JSTime(createdAt)
	rows, err := s.db.Query(ctx, `SELECT product_name, sku_name, quantity::text, unit_price::text, total::text
		FROM shop.order_items WHERE order_id = $1::uuid ORDER BY product_name`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	v.Items = []domain.PublicOrderItem{}
	for rows.Next() {
		var it domain.OrderItemRow
		if err := rows.Scan(&it.ProductName, &it.SkuName, &it.Quantity, &it.UnitPrice, &it.Total); err != nil {
			return nil, err
		}
		v.Items = append(v.Items, domain.PublicItem(it))
	}
	return &v, rows.Err()
}
