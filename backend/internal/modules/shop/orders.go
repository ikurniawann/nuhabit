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
	rows, err := queryRows(ctx, s.db, fmt.Sprintf(`SELECT o.id, o.order_number, o.status, o.customer_name, o.customer_phone,
		  o.shipping_area_label, o.courier_code, o.courier_service,
		  o.subtotal, o.shipping_cost, o.total, o.waybill, o.paid_at,
		  o.created_at, o.customer_id,
		  o.delivery_method, o.pickup_branch_id, o.payment_method, o.discount_amount, o.promo_code,
		  (SELECT COUNT(*) FROM shop.order_items i WHERE i.order_id = o.id) AS item_count,
		  s.status AS shipment_status, s.provider AS shipment_provider
		FROM shop.orders o
		LEFT JOIN shop.shipments s
		  ON s.order_id = o.id AND s.status NOT IN ('failed','cancelled')
		%s
		ORDER BY o.created_at DESC
		LIMIT $%d`, where, len(args)), args...)
	if err != nil {
		return nil, err
	}
	return rows, s.setPickupBranchNames(ctx, rows)
}

// setPickupBranchNames adds pickup_branch_name (nil for shipped orders)
// to rows that carry pickup_branch_id.
func (s *Service) setPickupBranchNames(ctx context.Context, rows []*Row) error {
	names := map[string]*string{}
	for _, row := range rows {
		var name *string
		if id, ok := row.Get("pickup_branch_id").(string); ok {
			if _, seen := names[id]; !seen {
				branch, err := s.ports.Branches.Get(ctx, s.db, id)
				if err != nil {
					return err
				}
				if branch != nil {
					names[id] = &branch.Name
				} else {
					names[id] = nil
				}
			}
			name = names[id]
		}
		row.Set("pickup_branch_name", name)
	}
	return nil
}

// OrderDetail is getShopOrderDetail: the order with its active shipment,
// its pickup branch name and its items.
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
	if err := s.setPickupBranchNames(ctx, []*Row{order}); err != nil {
		return nil, err
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
// (the money is refunded by hand in the Xendit dashboard) and the promo
// code. A pay_later wholesale order ships before payment, so staff may
// also pack it or mark it paid while it is still pending. Pickup orders
// go paid -> ready_for_pickup (the buyer gets a WhatsApp) -> picked_up and
// never through packing.
func (s *Service) TransitionOrder(ctx context.Context, id, next string, note *string) (*Row, error) {
	allowed, ok := domain.AllowedFromStatuses(next)
	payLaterOK := domain.PayLaterFromPending(next)
	if !ok && !payLaterOK {
		return nil, httpx.BadRequest("Transisi status tidak dikenal")
	}
	var deliveryMethod string
	err := s.db.QueryRow(ctx, `SELECT delivery_method FROM shop.orders WHERE id = $1::uuid`, id).Scan(&deliveryMethod)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound(orderNotFound)
	}
	if err != nil {
		return nil, err
	}
	if !domain.TransitionFitsDelivery(next, deliveryMethod) {
		return nil, httpx.BadRequest("That step does not apply to this order's delivery method")
	}
	updated, err := queryRow(ctx, s.db, `UPDATE shop.orders o
		SET status = $2, updated_at = now(),
		    paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(o.paid_at, now()) ELSE o.paid_at END,
		    ready_at = CASE WHEN $2 = 'ready_for_pickup' THEN COALESCE(o.ready_at, now()) ELSE o.ready_at END,
		    picked_up_at = CASE WHEN $2 = 'picked_up' THEN COALESCE(o.picked_up_at, now()) ELSE o.picked_up_at END,
		    notes = CASE WHEN $3::text IS NOT NULL
		                 THEN COALESCE(o.notes || E'\n', '') || $3::text
		                 ELSE o.notes END
		FROM (SELECT status AS prev_status FROM shop.orders WHERE id = $1::uuid) prev
		WHERE o.id = $1::uuid
		  AND (o.status = ANY($4::text[])
		       OR ($5 AND o.status = 'pending' AND o.payment_terms = 'pay_later'))
		RETURNING o.id, o.status, prev.prev_status`, id, next, note, allowed, payLaterOK)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, httpx.Conflict("Status order sudah berubah — muat ulang")
	}
	switch next {
	case "ready_for_pickup":
		s.sendReadyForPickupWa(ctx, id)
	case "cancelled":
		// A pending order holds its stock, a paid one has committed it, and
		// a pay_later order commits at placement: release whatever is there.
		if err := s.restoreCommittedReservations(ctx, id); err != nil {
			return nil, err
		}
		if _, err := s.db.Exec(ctx, `UPDATE shop.shipments SET status='cancelled', updated_at=now()
			WHERE order_id = $1::uuid AND status NOT IN ('failed','cancelled')`, id); err != nil {
			s.log.Error("[shop] cancel shipment failed", "order", id, "error", err)
		}
		s.releasePromo(ctx, id)
	}
	return updated, nil
}

// sendReadyForPickupWa tells the buyer where the order waits.
func (s *Service) sendReadyForPickupWa(ctx context.Context, id string) {
	var number, token, phone string
	var branchID *string
	if err := s.db.QueryRow(ctx, `SELECT order_number, access_token::text, customer_phone, pickup_branch_id::text
		FROM shop.orders WHERE id = $1::uuid`, id).Scan(&number, &token, &phone, &branchID); err != nil {
		s.log.Error("[shop] ready for pickup lookup failed", "order", id, "error", err)
		return
	}
	branch := s.pickupBranch(ctx, branchID)
	if branch == nil {
		branch = &PickupBranch{Name: "the store"}
	}
	s.sendWa(ctx, phone, domain.OrderReadyForPickupMessage(s.ports.AppOrigin, number, token, branch.Name, branch.Address), "ready for pickup")
}

// pickupBranch is the order's pickup branch, nil without one (a lookup
// failure is logged).
func (s *Service) pickupBranch(ctx context.Context, branchID *string) *PickupBranch {
	if branchID == nil {
		return nil
	}
	branch, err := s.ports.Branches.Get(ctx, s.db, *branchID)
	if err != nil {
		s.log.Error("[shop] pickup branch lookup failed", "branch", *branchID, "error", err)
	}
	return branch
}

// PublicDeliveryBranch is the pickup branch on the status page.
type PublicDeliveryBranch struct {
	Name    string  `json:"name"`
	Address *string `json:"address"`
	Phone   *string `json:"phone"`
}

// PublicDelivery is the delivery block of the status page.
type PublicDelivery struct {
	Method  string                `json:"method"`
	Branch  *PublicDeliveryBranch `json:"branch"`
	ReadyAt *httpx.JSTime         `json:"readyAt"`
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
	Delivery          PublicDelivery           `json:"delivery"`
	DiscountAmount    float64                  `json:"discountAmount"`
	PromoCode         *string                  `json:"promoCode"`
	PaymentMethod     string                   `json:"paymentMethod"`
	EtaText           *string                  `json:"etaText"`
	WhatsappURL       *string                  `json:"whatsappUrl"`
}

// PublicOrderStatus is loadPublicOrderStatus by access token (nil when
// unknown). The invoice link shows only while the order is pending.
func (s *Service) PublicOrderStatus(ctx context.Context, token string) (*PublicOrderStatus, error) {
	var v PublicOrderStatus
	var id, subtotal, shipping, total, discount string
	var courier, service, invoiceURL, branchID, storefrontID *string
	var paidAt, readyAt *time.Time
	var createdAt time.Time
	err := s.db.QueryRow(ctx, `SELECT id::text, order_number, status, customer_name, shipping_area_label,
		  shipping_address, courier_code, courier_service, subtotal::text,
		  shipping_cost::text, total::text, xendit_invoice_url, waybill, paid_at, created_at,
		  delivery_method, pickup_branch_id::text, ready_at, discount_amount::text, promo_code,
		  payment_method, eta_text, storefront_id::text
		FROM shop.orders WHERE access_token = $1::uuid`, token).Scan(&id, &v.OrderNumber, &v.Status, &v.CustomerName,
		&v.ShippingAreaLabel, &v.ShippingAddress, &courier, &service, &subtotal, &shipping, &total, &invoiceURL,
		&v.Waybill, &paidAt, &createdAt, &v.Delivery.Method, &branchID, &readyAt, &discount, &v.PromoCode,
		&v.PaymentMethod, &v.EtaText, &storefrontID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v.Courier = domain.JoinNonEmpty(" — ", courier, service)
	v.Subtotal, v.ShippingCost, v.Total = domain.JSNumber(subtotal), domain.JSNumber(shipping), domain.JSNumber(total)
	v.DiscountAmount = domain.JSNumber(discount)
	v.InvoiceURL = domain.InvoiceURLWhilePending(v.Status, invoiceURL)
	v.PaidAt, v.CreatedAt = httpx.NewJSTime(paidAt), httpx.JSTime(createdAt)
	v.Delivery.ReadyAt = httpx.NewJSTime(readyAt)
	if b := s.pickupBranch(ctx, branchID); b != nil {
		v.Delivery.Branch = &PublicDeliveryBranch{Name: b.Name, Address: b.Address, Phone: b.Phone}
	}
	if storefrontID != nil {
		settings, err := s.StorefrontSettings(ctx, *storefrontID)
		if err != nil {
			return nil, err
		}
		v.WhatsappURL = domain.WhatsAppLink(settings.WhatsappNumber, v.OrderNumber)
	}
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
