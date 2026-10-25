package gymloyalty

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"

	gymcredits "nuhabit/backend/internal/contracts/gymcredits"
	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/outbox"
)

// Name is the MODULES key.
const Name = "gym-loyalty"

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module and subscribes it to paid purchases. ports come
// from internal/app.
func New(deps module.Deps, p Ports) module.Module {
	svc := NewService(deps.DB, p, deps.Now, deps.Log)
	Subscribe(deps.Events, svc)
	return mod{h: &handler{svc: svc, guard: deps.Auth}}
}

// Subscriber names are contracts: renaming one drops its pending deliveries.
const (
	subscriberGymPurchase = "gym-loyalty.on-gym-purchase"
	subscriberPosSale     = "gym-loyalty.on-pos-sale"
	subscriberPosSplit    = "gym-loyalty.on-pos-split"
	subscriberPosVoid     = "gym-loyalty.on-pos-void"
	subscriberOrder       = "gym-loyalty.on-customer-order"
)

// Subscribe re-evaluates a member's tier when their spending changes: a gym
// package sold or refunded (its journal), a POS sale, split or void, and a
// shop or self-order recorded for them. A gym sale also earns purchase XP.
func Subscribe(bus *outbox.Bus, s *Service) {
	if bus == nil {
		return
	}
	bus.Subscribe(gymcredits.TopicJournal, subscriberGymPurchase, s.onGymJournal)
	bus.Subscribe(possales.TopicSaleCompleted, subscriberPosSale, func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
		var ev possales.SaleCompleted
		if err := e.Decode(&ev); err != nil {
			return err
		}
		return s.recomputeIf(ctx, tx, ev.CustomerID)
	})
	bus.Subscribe(possales.TopicSplitPaid, subscriberPosSplit, func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
		var ev possales.SplitPaid
		if err := e.Decode(&ev); err != nil {
			return err
		}
		return s.recomputeIf(ctx, tx, ev.CustomerID)
	})
	bus.Subscribe(possales.TopicOrdersVoided, subscriberPosVoid, func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
		var ev possales.OrdersVoided
		if err := e.Decode(&ev); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT DISTINCT customer_id::text FROM pos.pos_orders
			WHERE id::text = ANY($1::text[]) AND customer_id IS NOT NULL`, ev.OrderIDs)
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
		for _, id := range ids {
			if err := s.recomputeIf(ctx, tx, &id); err != nil {
				return err
			}
		}
		return err
	})
	bus.Subscribe(possales.TopicCustomerOrderRecorded, subscriberOrder, func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
		var ev possales.CustomerOrderRecorded
		if err := e.Decode(&ev); err != nil {
			return err
		}
		return s.recomputeIf(ctx, tx, &ev.CustomerID)
	})
}

func (s *Service) recomputeIf(ctx context.Context, tx pgx.Tx, customerID *string) error {
	if customerID == nil || *customerID == "" {
		return nil
	}
	_, err := s.Recompute(ctx, tx, *customerID)
	return err
}

// onGymJournal handles the sale and refund journals of gym purchases.
func (s *Service) onGymJournal(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
	var j gymcredits.Journal
	if err := e.Decode(&j); err != nil {
		return err
	}
	sale := strings.HasPrefix(j.EventCode, "GYM_SALE_")
	if j.DocumentType != "gym_purchase" || (!sale && !strings.HasPrefix(j.EventCode, "GYM_REFUND_")) {
		return nil
	}
	var customerID *string
	err := tx.QueryRow(ctx, `SELECT customer_id::text FROM gym.credit_purchases WHERE id::text = $1`, j.DocumentID).Scan(&customerID)
	if database.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := s.recomputeIf(ctx, tx, customerID); err != nil {
		return err
	}
	if !sale {
		return nil
	}
	return s.AwardPurchase(ctx, tx, j.DocumentID)
}
