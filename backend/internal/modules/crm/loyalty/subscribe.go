package loyalty

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/posops"
	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp"
	xpdomain "nuhabit/backend/internal/modules/crm/xp/domain"
	"nuhabit/backend/internal/platform/outbox"
)

// Subscriber names are contracts: renaming one drops its pending deliveries.
const (
	subscriberSaleXP  = "crm.xp-on-pos-sale"
	subscriberSplitXP = "crm.xp-on-pos-split"
	subscriberVoidXP  = "crm.xp-reverse-on-pos-void"
	subscriberStats   = "crm.stats-on-customer-order"
	subscriberEnroll  = "crm.member-on-pos-enroll"
)

// Subscribe registers the CRM loyalty outbox subscribers: visit stats (and
// XP, idempotent with the award pos-sales already made through its Loyalty
// port) for paid POS orders and splits; XP and stats reversal for voids.
func Subscribe(bus *outbox.Bus, engine *xp.Engine) {
	if bus == nil {
		return
	}
	s := subscriber{engine: engine}
	bus.Subscribe(possales.TopicSaleCompleted, subscriberSaleXP, s.saleCompleted)
	bus.Subscribe(possales.TopicSplitPaid, subscriberSplitXP, s.splitPaid)
	bus.Subscribe(possales.TopicOrdersVoided, subscriberVoidXP, s.ordersVoided)
	bus.Subscribe(possales.TopicCustomerOrderRecorded, subscriberStats, s.customerOrderRecorded)
	bus.Subscribe(posops.TopicCustomerEnrolled, subscriberEnroll, enrollMember)
}

type subscriber struct{ engine *xp.Engine }

// errAward makes the outbox retry a failed award. The TS logged and dropped
// it; here the handler's writes roll back together (stats included) and the
// idempotency keys keep the retry from double-posting.
var errAward = errors.New("crm: XP award failed")

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (s subscriber) saleCompleted(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
	var ev possales.SaleCompleted
	if err := e.Decode(&ev); err != nil {
		return err
	}
	customer := str(ev.CustomerID)
	if customer != "" && ev.StatsAmount != nil {
		s.engine.SyncOrderStats(ctx, tx, customer, *ev.StatsAmount)
	}
	items := make([]xpdomain.Item, len(ev.Items))
	for i, it := range ev.Items {
		q := it.Quantity
		items[i] = xpdomain.Item{ProductID: it.ProductID, Quantity: &q, TotalAmount: it.TotalAmount, UnitPrice: it.UnitPrice}
	}
	res := s.engine.AwardPosOrder(ctx, tx, xp.PosOrder{
		OrderID: ev.OrderID, CustomerID: customer, TotalAmount: ev.TotalAmount,
		Items: items, OutletID: ev.BranchID, PaymentMethod: ev.PaymentMethod,
	})
	if res.Status == "error" {
		return errAward
	}
	return nil
}

func (s subscriber) splitPaid(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
	var ev possales.SplitPaid
	if err := e.Decode(&ev); err != nil {
		return err
	}
	customer := str(ev.CustomerID)
	if customer != "" && ev.StatsAmount != nil {
		s.engine.SyncOrderStats(ctx, tx, customer, *ev.StatsAmount)
	}
	res := s.engine.AwardSplitPayment(ctx, tx, xp.SplitPayment{
		OrderID: ev.OrderID, SplitID: ev.SplitID, CustomerID: customer, TotalAmount: ev.TotalAmount,
		OutletID: ev.BranchID, PaymentMethod: ev.PaymentMethod,
	})
	if res.Status == "error" {
		return errAward
	}
	return nil
}

func (s subscriber) ordersVoided(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
	var ev possales.OrdersVoided
	if err := e.Decode(&ev); err != nil {
		return err
	}
	if ev.ReverseXP {
		if _, err := s.engine.ReverseVoidedOrders(ctx, tx, ev.OrderIDs, ev.VoidReason); err != nil {
			return err
		}
	}
	if ev.StatsCustomerID != nil && ev.StatsAmount > 0 {
		return s.engine.ReverseOrderStats(ctx, tx, *ev.StatsCustomerID, ev.StatsAmount, ev.StatsVisitDelta)
	}
	return nil
}

func (s subscriber) customerOrderRecorded(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
	var ev possales.CustomerOrderRecorded
	if err := e.Decode(&ev); err != nil {
		return err
	}
	if ev.CustomerID != "" {
		s.engine.SyncOrderStats(ctx, tx, ev.CustomerID, ev.Amount)
	}
	return nil
}

// enrollMember upserts the CRM profile the cashier's customer dialog asked
// for (POST /api/pos/customers with enroll_member did it inline): tier by
// code, else 'regular', else nothing. The upsert makes redelivery harmless.
func enrollMember(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
	var ev posops.CustomerEnrolled
	if err := e.Decode(&ev); err != nil {
		return err
	}
	meta, err := kit.MarshalNoEscape(map[string]any{"source": "pos_customer_modal", "enrolled_by": ev.EnrolledBy})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
WITH tier AS (
    SELECT id FROM crm.crm_membership_tiers WHERE code IN ($2, 'regular')
     ORDER BY (code = $2) DESC LIMIT 1
)
INSERT INTO crm.crm_member_profiles (customer_id, tier_id, lifetime_xp, loyalty_score, status, metadata, last_activity_at)
SELECT $1, tier.id, $3::int, $3::int, 'active', $4::jsonb, $5::timestamptz FROM tier
ON CONFLICT (customer_id) DO UPDATE SET tier_id = EXCLUDED.tier_id, lifetime_xp = EXCLUDED.lifetime_xp,
    loyalty_score = EXCLUDED.loyalty_score, status = EXCLUDED.status, metadata = EXCLUDED.metadata,
    last_activity_at = EXCLUDED.last_activity_at`,
		ev.CustomerID, ev.TierCode, int64(ev.LifetimeXp), string(meta), ev.EnrolledAt)
	return err
}
