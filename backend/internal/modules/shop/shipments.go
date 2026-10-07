package shop

import (
	"context"

	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Shipments for paid or packing orders (lib/shop/order-shipment.ts): the
// Biteship provider mode (the waybill may arrive later through the
// webhook) or a waybill typed in by the back office. A known waybill marks
// the order shipped and sends the buyer a best-effort WhatsApp.

// ShipmentBody is shipmentBodySchema after parsing.
type ShipmentBody struct {
	Mode        string // provider | manual
	Waybill     string
	CourierCode *string
}

// ShipmentResult is ShipmentResult.
type ShipmentResult struct {
	ProviderOrderID *string `json:"provider_order_id,omitempty"`
	Waybill         *string `json:"waybill"`
}

type shippableOrder struct {
	id, orderNumber, status, accessToken string
	customerName, customerPhone, address string
	areaID, postalCode, courier, service *string
	total                                string
}

func (s *Service) loadShippableOrder(ctx context.Context, id string) (*shippableOrder, error) {
	var o shippableOrder
	err := s.db.QueryRow(ctx, `SELECT id::text, order_number, status, access_token::text, customer_name,
		  customer_phone, shipping_address, shipping_area_id,
		  shipping_postal_code, courier_code, courier_service, total::text
		FROM shop.orders WHERE id = $1::uuid`, id).Scan(&o.id, &o.orderNumber, &o.status, &o.accessToken,
		&o.customerName, &o.customerPhone, &o.address, &o.areaID, &o.postalCode, &o.courier, &o.service, &o.total)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound(orderNotFound)
	}
	if err != nil {
		return nil, err
	}
	if !domain.CanShipOrder(o.status) {
		return nil, httpx.BadRequest("Pengiriman hanya untuk order yang sudah dibayar")
	}
	var active bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM shop.shipments
		WHERE order_id = $1::uuid AND status NOT IN ('failed','cancelled'))`, id).Scan(&active); err != nil {
		return nil, err
	}
	if active {
		return nil, httpx.Conflict("Order sudah punya pengiriman aktif")
	}
	return &o, nil
}

// markShipped sets the waybill on a paid/packing order and sends the buyer
// the waybill over WhatsApp after the response.
func (s *Service) markShipped(ctx context.Context, o *shippableOrder, waybill string) error {
	if _, err := s.db.Exec(ctx, `UPDATE shop.orders SET status='shipped', waybill=$2, updated_at=now()
		WHERE id = $1::uuid AND status IN ('paid','packing')`, o.id, waybill); err != nil {
		return err
	}
	s.sendShippedWa(ctx, shippedWa{
		orderNumber: o.orderNumber, customerPhone: o.customerPhone, accessToken: o.accessToken,
		waybill: waybill, courierLabel: domain.JoinNonEmpty(" ", o.courier, o.service),
	})
	return nil
}

// CreateShipment is createOrderShipment.
func (s *Service) CreateShipment(ctx context.Context, id string, body ShipmentBody, userID string) (ShipmentResult, error) {
	o, err := s.loadShippableOrder(ctx, id)
	if err != nil {
		return ShipmentResult{}, err
	}
	if body.Mode == "manual" {
		courier := o.courier
		if body.CourierCode != nil && *body.CourierCode != "" {
			courier = body.CourierCode
		}
		if _, err := s.db.Exec(ctx, `INSERT INTO shop.shipments (order_id, provider, courier_code, courier_service, waybill, status, created_by)
			VALUES ($1::uuid, 'manual', $2, $3, $4, 'in_transit', $5::uuid)`, id, courier, o.service, body.Waybill, userID); err != nil {
			return ShipmentResult{}, err
		}
		if err := s.markShipped(ctx, o, body.Waybill); err != nil {
			return ShipmentResult{}, err
		}
		return ShipmentResult{Waybill: &body.Waybill}, nil
	}

	sc, err := s.loadShippingContext(ctx)
	if err != nil {
		return ShipmentResult{}, err
	}
	if !sc.provider.canCreateShipment() {
		return ShipmentResult{}, httpx.BadRequest("Provider aktif tidak mendukung pembuatan pengiriman — buat di aplikasi kurir lalu input resi manual")
	}
	if sc.originID == "" || o.areaID == nil || *o.areaID == "" {
		return ShipmentResult{}, httpx.BadRequest("Origin/tujuan tidak lengkap untuk pengiriman otomatis")
	}
	items, err := s.shipmentItems(ctx, id)
	if err != nil {
		return ShipmentResult{}, err
	}
	or := func(key, fallback string) string {
		if v := sc.settings.Str(key); v != "" {
			return v
		}
		return fallback
	}
	courier, service := "jne", "reg"
	if o.courier != nil && *o.courier != "" {
		courier = *o.courier
	}
	if o.service != nil && *o.service != "" {
		service = *o.service
	}
	created, err := sc.provider.createShipment(ctx, createShipmentRequest{
		originID: sc.originID, originContactName: or("origin_contact_name", "Toko"),
		originContactPhone: or("origin_contact_phone", "-"), originAddress: or("origin_address", "-"),
		destAreaID: *o.areaID, destContactName: o.customerName, destContactPhone: o.customerPhone, destAddress: o.address,
		courierCode: courier, serviceCode: service, items: items, referenceID: o.orderNumber,
	})
	if err != nil {
		return ShipmentResult{}, err
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO shop.shipments (
		  order_id, provider, courier_code, courier_service,
		  provider_order_id, waybill, price, status, created_by
		) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'pickup', $8::uuid)`,
		id, sc.provider.name(), o.courier, o.service, created.providerOrderID, created.waybill, created.price, userID); err != nil {
		return ShipmentResult{}, err
	}
	if created.waybill != nil && *created.waybill != "" {
		if err := s.markShipped(ctx, o, *created.waybill); err != nil {
			return ShipmentResult{}, err
		}
	} else if _, err := s.db.Exec(ctx, `UPDATE shop.orders SET status='packing', updated_at=now()
		WHERE id = $1::uuid AND status = 'paid'`, id); err != nil {
		// The waybill arrives through the Biteship webhook; the order waits
		// in packing.
		return ShipmentResult{}, err
	}
	return ShipmentResult{ProviderOrderID: &created.providerOrderID, Waybill: created.waybill}, nil
}

func (s *Service) shipmentItems(ctx context.Context, orderID string) ([]shipmentItem, error) {
	rows, err := s.db.Query(ctx, `SELECT product_name, sku_name, quantity::text, unit_price::text, weight_gram::text
		FROM shop.order_items WHERE order_id = $1::uuid`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []shipmentItem
	for rows.Next() {
		var name, qty, price string
		var sku, weight *string
		if err := rows.Scan(&name, &sku, &qty, &price, &weight); err != nil {
			return nil, err
		}
		if sku != nil && *sku != "" {
			name += " " + *sku
		}
		w := numOr0(weight)
		if w == 0 {
			w = defaultItemWeightGram
		}
		q := numOr0(&qty)
		if q == 0 {
			q = 1
		}
		out = append(out, shipmentItem{name: name, value: numOr0(&price), weightGram: w, quantity: q})
	}
	return out, rows.Err()
}
