package shop

import (
	"context"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	possales "nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/validate"
)

// Settlement of shop orders: the Xendit invoice callback
// (/api/public/shop/webhook/xendit) and the Biteship tracking webhook.

// InvoiceCallback is callbackSchema: the Xendit invoice callback.
type InvoiceCallback struct {
	ID         string
	ExternalID string
	Status     string
	PaidAt     *string
	Amount     *float64
}

// WebhookResult is the status and JSON body a webhook answers with.
type WebhookResult struct {
	Status int
	Body   any
}

type ack struct {
	Success          bool `json:"success"`
	Ignored          bool `json:"ignored,omitempty"`
	AlreadyProcessed bool `json:"already_processed,omitempty"`
}

type failure struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

var (
	ackOK      = WebhookResult{http.StatusOK, ack{Success: true}}
	ackIgnored = WebhookResult{http.StatusOK, ack{Success: true, Ignored: true}}
)

// IsShopInvoice reports whether an external_id belongs to a shop order.
func IsShopInvoice(externalID string) bool { return strings.HasPrefix(externalID, InvoicePrefix) }

// SettleInvoice applies a verified Xendit invoice callback to its shop
// order on db (a pool or the caller's transaction). PAID/SETTLED moves a
// pending order to paid (idempotent), commits its reserved stock, links the
// CRM member by WhatsApp number (stats through the outbox, no XP) and
// queues the buyer's confirmation; EXPIRED cancels a pending order and
// gives its stock back. The result carries the TS route's status and body.
func (s *Service) SettleInvoice(ctx context.Context, db database.DB, cb InvoiceCallback) (WebhookResult, error) {
	if !IsShopInvoice(cb.ExternalID) {
		return ackIgnored, nil
	}
	orderID := strings.TrimPrefix(cb.ExternalID, InvoicePrefix)
	if !validate.IsUUID(orderID) {
		return ackIgnored, nil
	}
	tx := s.withDB(db)
	switch cb.Status {
	case "PAID", "SETTLED":
		return tx.settlePaid(ctx, orderID, cb.Amount)
	case "EXPIRED":
		var cancelled bool
		err := tx.db.QueryRow(ctx, `WITH c AS (UPDATE shop.orders SET status = 'cancelled', updated_at = now()
			WHERE id = $1::uuid AND status = 'pending' RETURNING id) SELECT EXISTS (SELECT 1 FROM c)`, orderID).Scan(&cancelled)
		if err != nil {
			return WebhookResult{}, err
		}
		if cancelled {
			if err := tx.releaseOrderReservations(ctx, orderID); err != nil {
				return WebhookResult{}, err
			}
		}
		return ackOK, nil
	}
	return ackIgnored, nil
}

// withDB is the service on another database handle (the caller's tx).
func (s *Service) withDB(db database.DB) *Service {
	if db == nil {
		return s
	}
	c := *s
	c.db = db
	return &c
}

func (s *Service) settlePaid(ctx context.Context, orderID string, amount *float64) (WebhookResult, error) {
	// Cross-check the amount: a leaked token alone cannot mark an order paid.
	var expected string
	err := s.db.QueryRow(ctx, `SELECT total::text FROM shop.orders WHERE id = $1::uuid`, orderID).Scan(&expected)
	if database.IsNoRows(err) {
		return ackIgnored, nil
	}
	if err != nil {
		return WebhookResult{}, err
	}
	if amount != nil && jsmath.Round(domain.JSNumber(expected)) != jsmath.Round(*amount) {
		s.log.Error("[shop] webhook amount mismatch", "order", orderID, "expected", expected, "got", *amount)
		return WebhookResult{http.StatusBadRequest, failure{false, "Amount mismatch"}}, nil
	}

	// Idempotent: only pending → paid runs the side effects.
	var o struct{ number, token, name, phone, total string }
	err = s.db.QueryRow(ctx, `UPDATE shop.orders
		SET status = 'paid', paid_at = COALESCE(paid_at, now()), updated_at = now()
		WHERE id = $1::uuid AND status = 'pending'
		RETURNING order_number, access_token::text, customer_name, customer_phone, total::text`, orderID).
		Scan(&o.number, &o.token, &o.name, &o.phone, &o.total)
	if database.IsNoRows(err) {
		return WebhookResult{http.StatusOK, ack{Success: true, AlreadyProcessed: true}}, nil
	}
	if err != nil {
		return WebhookResult{}, err
	}
	if err := commitOrderReservations(ctx, s.db, orderID); err != nil {
		return WebhookResult{}, err
	}
	total := domain.OrFinite(domain.JSNumber(o.total))
	// Link the CRM member by WhatsApp number (members from day one). Xendit
	// orders raise visit and spend stats only; XP is for ARK Coin payments.
	if err := s.linkMember(ctx, orderID, o.phone, total); err != nil {
		s.log.Error("[shop] member link failed", "order", orderID, "error", err)
	}
	s.background(ctx, func(ctx context.Context) {
		msg := domain.OrderPaidMessage(s.ports.AppOrigin, o.number, o.name, o.token, total)
		if err := s.ports.Messenger.SendText(ctx, o.phone, msg); err != nil {
			s.log.Error("[shop] WA paid failed", "order", orderID, "error", err)
		}
	})
	return ackOK, nil
}

// linkMember stamps the order's customer_id and records the member's paid
// order through the outbox (CRM's syncPosCustomerOrderStats subscriber).
func (s *Service) linkMember(ctx context.Context, orderID, phone string, total float64) error {
	digits := domain.PhoneDigits(phone)
	if len(digits) < 8 {
		return nil
	}
	if len(digits) > 10 {
		digits = digits[len(digits)-10:]
	}
	// A savepoint, so a failed link never poisons the caller's transaction.
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		memberID, err := s.ports.Members.ByPhoneSuffix(ctx, tx, digits)
		if err != nil || memberID == "" {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE shop.orders SET customer_id = $2::uuid WHERE id = $1::uuid`, orderID, memberID); err != nil {
			return err
		}
		return outbox.Publish(ctx, tx, possales.TopicCustomerOrderRecorded, orderID, possales.CustomerOrderRecorded{
			CustomerID: memberID, OrderID: orderID, Amount: total,
		})
	})
}

// BiteshipEvent is payloadSchema of the Biteship webhook.
type BiteshipEvent struct {
	Event, OrderID, Status              string
	CourierTrackingID, CourierWaybillID *string
}

// ApplyBiteshipEvent is the Biteship tracking webhook: the shipment status
// and waybill; a newly known waybill ships the order (WhatsApp to the
// buyer), a delivery completes it. ignored is true for an unknown shipment.
func (s *Service) ApplyBiteshipEvent(ctx context.Context, ev BiteshipEvent) (ignored bool, err error) {
	var waybill *string
	for _, w := range []*string{ev.CourierWaybillID, ev.CourierTrackingID} {
		if w != nil && *w != "" {
			waybill = w
			break
		}
	}
	var mapped *string
	if m, ok := domain.BiteshipShipmentStatus[strings.ToLower(ev.Status)]; ok {
		mapped = &m
	}
	var shipmentOrder string
	var shipmentWaybill *string
	err = s.db.QueryRow(ctx, `UPDATE shop.shipments
		SET status = COALESCE($2, status),
		    waybill = COALESCE(waybill, $3),
		    tracking_history = tracking_history || jsonb_build_object(
		      'at', now(), 'status', $4::text, 'event', $5::text
		    ),
		    updated_at = now()
		WHERE provider_order_id = $1
		RETURNING order_id::text, waybill`, ev.OrderID, mapped, waybill, ev.Status, ev.Event).Scan(&shipmentOrder, &shipmentWaybill)
	if database.IsNoRows(err) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	if shipmentWaybill != nil && *shipmentWaybill != "" {
		var o struct {
			number, token, phone string
			courier, service     *string
		}
		err := s.db.QueryRow(ctx, `UPDATE shop.orders
			SET status = 'shipped', waybill = $2, updated_at = now()
			WHERE id = $1::uuid AND status IN ('paid','packing') AND waybill IS NULL
			RETURNING order_number, access_token::text, customer_phone, courier_code, courier_service`,
			shipmentOrder, *shipmentWaybill).Scan(&o.number, &o.token, &o.phone, &o.courier, &o.service)
		switch {
		case err == nil:
			s.sendShippedWa(ctx, shippedWa{orderNumber: o.number, customerPhone: o.phone, accessToken: o.token,
				waybill: *shipmentWaybill, courierLabel: domain.JoinNonEmpty(" ", o.courier, o.service)})
		case !database.IsNoRows(err):
			return false, err
		}
	}
	if mapped != nil && *mapped == "delivered" {
		if _, err := s.db.Exec(ctx, `UPDATE shop.orders SET status='completed', updated_at=now()
			WHERE id = $1::uuid AND status = 'shipped'`, shipmentOrder); err != nil {
			return false, err
		}
	}
	return false, nil
}

type shippedWa struct {
	orderNumber, customerPhone, accessToken, waybill, courierLabel string
}

// sendShippedWa is sendShopOrderShippedWa, after the response.
func (s *Service) sendShippedWa(ctx context.Context, w shippedWa) {
	s.background(ctx, func(ctx context.Context) {
		msg := domain.OrderShippedMessage(s.ports.AppOrigin, w.orderNumber, w.accessToken, w.waybill, w.courierLabel)
		if err := s.ports.Messenger.SendText(ctx, w.customerPhone, msg); err != nil {
			s.log.Error("[shop] WA resi gagal", "order", w.orderNumber, "error", err)
		}
	})
}
