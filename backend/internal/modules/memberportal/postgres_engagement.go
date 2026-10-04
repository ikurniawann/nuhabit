package memberportal

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/database"
)

// MemberPromoRows lists portal-flagged campaigns with their codes and usage.
func (s *store) MemberPromoRows(ctx context.Context, customerID string) ([]domain.PromoRow, error) {
	rows, err := s.q.Query(ctx,
		`SELECT c.id, c.name, c.description, c.discount_type,
		        c.value::float, c.max_discount::float, c.min_purchase::float,
		        c.valid_from::text, c.valid_until::text,
		        c.usage_limit, c.per_phone_limit, c.scope, c.is_active, c.show_in_member_portal,
		        k.code, k.is_active, k.usage_limit, k.usage_count,
		        (SELECT count(*)::int FROM promo.promo_redemptions r
		          WHERE r.campaign_id = c.id AND r.status IN ('held', 'captured')),
		        (SELECT count(*)::int FROM promo.promo_redemptions r
		          JOIN pos.pos_customers m ON m.id = $1
		          WHERE r.campaign_id = c.id AND r.status IN ('held', 'captured')
		            AND (r.customer_id = m.id
		                 OR regexp_replace(COALESCE(r.phone, ''), '\D', '', 'g')
		                    = regexp_replace(m.phone, '\D', '', 'g')))
		   FROM promo.promo_campaigns c
		   JOIN promo.promo_codes k ON k.campaign_id = c.id
		  WHERE c.show_in_member_portal AND c.is_active AND k.is_active
		  ORDER BY c.valid_until NULLS LAST, c.created_at DESC, k.created_at`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.PromoRow, error) {
		var p domain.PromoRow
		var value, minPurchase *float64
		var usageCount *int64
		err := row.Scan(&p.CampaignID, &p.Name, &p.Description, &p.DiscountType, &value, &p.MaxDiscount, &minPurchase,
			&p.ValidFrom, &p.ValidUntil, &p.UsageLimit, &p.PerPhoneLimit, &p.Scope, &p.IsActive, &p.ShowInMemberPortal,
			&p.Code, &p.CodeIsActive, &p.CodeUsageLimit, &usageCount, &p.CampaignUsedCount, &p.MyUsedCount)
		p.Value, p.MinPurchase = deref(value), deref(minPurchase)
		if usageCount != nil {
			p.CodeUsageCount = *usageCount
		}
		return p, err
	})
}

// EventView is a published event with the member's booking.
type EventView struct {
	ID                  string   `json:"id"`
	Title               string   `json:"title"`
	Description         string   `json:"description"`
	HostName            *string  `json:"host_name"`
	Location            *string  `json:"location"`
	StartsAt            jsTime   `json:"starts_at"`
	EndsAt              jsTime   `json:"ends_at"`
	Capacity            int      `json:"capacity"`
	PriceIdr            *float64 `json:"price_idr"`
	BookingClosesHours  int      `json:"booking_closes_hours"`
	CancelDeadlineHours int      `json:"cancel_deadline_hours"`
	ConfirmedCount      int      `json:"confirmed_count"`
	BookingID           *string  `json:"booking_id"`
	BookingStatus       *string  `json:"booking_status"`
	WaitlistPosition    *int     `json:"waitlist_position"`
}

func (s *store) OpenEvents(ctx context.Context, customerID string) ([]EventView, error) {
	rows, err := s.q.Query(ctx,
		`SELECT e.id, e.title, e.description, e.host_name, e.location, e.starts_at, e.ends_at,
		        e.capacity, e.price_idr::float, e.booking_closes_hours, e.cancel_deadline_hours,
		        (SELECT count(*)::int FROM crm.event_bookings b
		          WHERE b.event_id = e.id AND b.status IN ('confirmed', 'attended')),
		        mine.id, mine.status, mine.waitlist_position
		   FROM crm.events e
		   LEFT JOIN LATERAL (
		     SELECT b.id, b.status, b.waitlist_position FROM crm.event_bookings b
		      WHERE b.event_id = e.id AND b.customer_id = $1 AND b.status <> 'cancelled'
		      ORDER BY b.created_at DESC LIMIT 1
		   ) mine ON true
		  WHERE e.status = 'published' AND e.ends_at > now()
		  ORDER BY e.starts_at`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (EventView, error) {
		var e EventView
		err := row.Scan(&e.ID, &e.Title, &e.Description, &e.HostName, &e.Location, &e.StartsAt, &e.EndsAt,
			&e.Capacity, &e.PriceIdr, &e.BookingClosesHours, &e.CancelDeadlineHours, &e.ConfirmedCount,
			&e.BookingID, &e.BookingStatus, &e.WaitlistPosition)
		return e, err
	})
}

// LockedEvent is an event row locked for a booking decision.
type LockedEvent struct {
	ID                 string
	Title              string
	Status             string
	StartsAt           time.Time
	Capacity           int
	BookingClosesHours int
}

func (s *store) LockEvent(ctx context.Context, eventID string) (*LockedEvent, error) {
	var e LockedEvent
	err := s.q.QueryRow(ctx,
		`SELECT id, title, status, starts_at, capacity, booking_closes_hours
		   FROM crm.events WHERE id = $1 FOR UPDATE`, eventID).
		Scan(&e.ID, &e.Title, &e.Status, &e.StartsAt, &e.Capacity, &e.BookingClosesHours)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// EventBookingStats are the counts a booking decision needs.
func (s *store) EventBookingStats(ctx context.Context, eventID, customerID string) (confirmed, lastWaitlist int, mine bool, err error) {
	var m *bool
	err = s.q.QueryRow(ctx,
		`SELECT count(*) FILTER (WHERE status IN ('confirmed', 'attended'))::int,
		        COALESCE(max(waitlist_position) FILTER (WHERE status = 'waitlist'), 0)::int,
		        bool_or(customer_id = $2 AND status IN ('confirmed', 'waitlist', 'attended'))
		   FROM crm.event_bookings WHERE event_id = $1`, eventID, customerID).Scan(&confirmed, &lastWaitlist, &m)
	return confirmed, lastWaitlist, m != nil && *m, err
}

func (s *store) InsertEventBooking(ctx context.Context, eventID, customerID, status string, position *int) error {
	_, err := s.q.Exec(ctx,
		`INSERT INTO crm.event_bookings (event_id, customer_id, status, waitlist_position) VALUES ($1, $2, $3, $4)`,
		eventID, customerID, status, position)
	return err
}

// LockedBooking is an event booking locked for a status change.
type LockedBooking struct {
	ID                  string
	EventID             string
	CustomerID          string
	Status              string
	Title               string
	StartsAt            time.Time
	CancelDeadlineHours int
}

func (s *store) LockEventBooking(ctx context.Context, bookingID string) (*LockedBooking, error) {
	var b LockedBooking
	err := s.q.QueryRow(ctx,
		`SELECT b.id, b.event_id, b.customer_id, b.status, e.title, e.starts_at, e.cancel_deadline_hours
		   FROM crm.event_bookings b JOIN crm.events e ON e.id = b.event_id
		  WHERE b.id = $1 FOR UPDATE OF b`, bookingID).
		Scan(&b.ID, &b.EventID, &b.CustomerID, &b.Status, &b.Title, &b.StartsAt, &b.CancelDeadlineHours)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

func (s *store) SetEventBookingStatus(ctx context.Context, bookingID, status string, lateCancel bool) error {
	_, err := s.q.Exec(ctx,
		`UPDATE crm.event_bookings
		    SET status = $2, late_cancel = $3, waitlist_position = NULL, updated_at = now(),
		        cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END
		  WHERE id = $1`, bookingID, status, lateCancel)
	return err
}

func (s *store) EventWaitlist(ctx context.Context, eventID string) ([]domain.WaitlistEntry, error) {
	rows, err := s.q.Query(ctx,
		`SELECT id, customer_id, waitlist_position, created_at
		   FROM crm.event_bookings WHERE event_id = $1 AND status = 'waitlist'`, eventID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.WaitlistEntry, error) {
		var w domain.WaitlistEntry
		err := row.Scan(&w.ID, &w.CustomerID, &w.Position, &w.CreatedAt)
		return w, err
	})
}

func (s *store) PromoteEventBooking(ctx context.Context, bookingID string) error {
	_, err := s.q.Exec(ctx,
		`UPDATE crm.event_bookings SET status = 'confirmed', waitlist_position = NULL, updated_at = now() WHERE id = $1`,
		bookingID)
	return err
}

// ChallengeRow is a challenge with the member's join.
type ChallengeRow struct {
	ID               string   `json:"id"`
	Title            string   `json:"title"`
	Description      string   `json:"description"`
	Metric           string   `json:"metric"`
	Target           float64  `json:"target"`
	StartsAt         jsTime   `json:"starts_at"`
	EndsAt           jsTime   `json:"ends_at"`
	RewardXP         int      `json:"reward_xp"`
	RewardArkIdr     *float64 `json:"reward_ark_idr"`
	JoinedAt         jsTime   `json:"joined_at"`
	RewardedAt       jsTime   `json:"rewarded_at"`
	ParticipantCount int      `json:"participant_count"`
}

func (s *store) MemberChallenges(ctx context.Context, customerID string) ([]ChallengeRow, error) {
	rows, err := s.q.Query(ctx,
		`SELECT c.id, c.title, c.description, c.metric, c.target::float, c.starts_at, c.ends_at,
		        c.reward_xp, c.reward_ark_idr::float, j.joined_at, j.rewarded_at,
		        (SELECT count(*)::int FROM crm.challenge_joins x WHERE x.challenge_id = c.id)
		   FROM crm.challenges c
		   LEFT JOIN crm.challenge_joins j ON j.challenge_id = c.id AND j.customer_id = $1
		  WHERE c.is_active AND (c.ends_at > now() OR (j.customer_id IS NOT NULL AND c.ends_at > now() - interval '7 days'))
		  ORDER BY c.ends_at`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ChallengeRow, error) {
		var c ChallengeRow
		err := row.Scan(&c.ID, &c.Title, &c.Description, &c.Metric, &c.Target, &c.StartsAt, &c.EndsAt,
			&c.RewardXP, &c.RewardArkIdr, &c.JoinedAt, &c.RewardedAt, &c.ParticipantCount)
		return c, err
	})
}

// UnrewardedChallenges are joined challenges whose reward is not settled.
func (s *store) UnrewardedChallenges(ctx context.Context, customerID string) ([]ChallengeRow, error) {
	rows, err := s.q.Query(ctx,
		`SELECT c.id, c.title, c.description, c.metric, c.target::float, c.starts_at, c.ends_at,
		        c.reward_xp, c.reward_ark_idr::float, NULL::timestamptz, NULL::timestamptz, 0
		   FROM crm.challenge_joins j JOIN crm.challenges c ON c.id = j.challenge_id
		  WHERE j.customer_id = $1 AND j.rewarded_at IS NULL`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ChallengeRow, error) {
		var c ChallengeRow
		err := row.Scan(&c.ID, &c.Title, &c.Description, &c.Metric, &c.Target, &c.StartsAt, &c.EndsAt,
			&c.RewardXP, &c.RewardArkIdr, &c.JoinedAt, &c.RewardedAt, &c.ParticipantCount)
		return c, err
	})
}

// ChallengeValue is one participant's progress value.
type ChallengeValue struct {
	CustomerID string
	Value      float64
}

// ChallengeValues sums paid orders in the challenge window per participant
// (visits count distinct WIB days), in database order.
func (s *store) ChallengeValues(ctx context.Context, c ChallengeRow, customerIDs []string) ([]ChallengeValue, error) {
	valueSQL := `COALESCE(sum(o.total_amount), 0)`
	if c.Metric == "visits" {
		valueSQL = `count(DISTINCT (o.created_at AT TIME ZONE 'Asia/Jakarta')::date)`
	}
	rows, err := s.q.Query(ctx,
		`SELECT j.customer_id, (
		        SELECT `+valueSQL+` FROM pos.pos_orders o
		         WHERE o.customer_id = j.customer_id AND o.payment_status = 'paid'
		           AND o.created_at BETWEEN $2 AND $3
		      )::float
		   FROM crm.challenge_joins j
		  WHERE j.challenge_id = $1 AND ($4::uuid[] IS NULL OR j.customer_id = ANY($4))`,
		c.ID, c.StartsAt.Time, c.EndsAt.Time, customerIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ChallengeValue, error) {
		var v ChallengeValue
		var value *float64
		err := row.Scan(&v.CustomerID, &value)
		v.Value = deref(value)
		return v, err
	})
}

func (s *store) ClaimChallengeReward(ctx context.Context, challengeID, customerID string) (bool, error) {
	tag, err := s.q.Exec(ctx,
		`UPDATE crm.challenge_joins SET rewarded_at = now()
		  WHERE challenge_id = $1 AND customer_id = $2 AND rewarded_at IS NULL`, challengeID, customerID)
	return tag.RowsAffected() > 0, err
}

func (s *store) CustomerNames(ctx context.Context, ids []string) (map[string]*string, error) {
	out := map[string]*string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.q.Query(ctx, `SELECT id, name FROM pos.pos_customers WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var name *string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[id] = name
	}
	return out, rows.Err()
}

// JoinChallenge joins an active, unfinished challenge; false when it ended
// or the member already joined.
func (s *store) JoinChallenge(ctx context.Context, challengeID, customerID string) (bool, error) {
	tag, err := s.q.Exec(ctx,
		`INSERT INTO crm.challenge_joins (challenge_id, customer_id)
		 SELECT id, $2 FROM crm.challenges WHERE id = $1 AND is_active AND ends_at > now()
		 ON CONFLICT DO NOTHING`, challengeID, customerID)
	return tag.RowsAffected() > 0, err
}

const paidAtSQL = `COALESCE(o.completed_at, o.ordered_at, o.created_at)`

// ReviewableOrderRow is a paid order the member can still review.
type ReviewableOrderRow struct {
	ID          string   `json:"id"`
	OrderNumber *string  `json:"order_number"`
	TotalAmount *float64 `json:"total_amount"`
	PaidAt      jsTime   `json:"paid_at"`
	OutletName  *string  `json:"outlet_name"`
	ReviewUntil jsTime   `json:"review_until"`
}

// MemberReview is a review the member wrote, with the venue's reply.
type MemberReview struct {
	ID          string  `json:"id"`
	OrderID     string  `json:"order_id"`
	OrderNumber *string `json:"order_number"`
	OutletName  *string `json:"outlet_name"`
	Rating      int     `json:"rating"`
	Comment     *string `json:"comment"`
	Reply       *string `json:"reply"`
	RepliedAt   jsTime  `json:"replied_at"`
	CreatedAt   jsTime  `json:"created_at"`
}

func (s *store) ReviewableOrders(ctx context.Context, customerID string, windowDays int) ([]ReviewableOrderRow, error) {
	rows, err := s.q.Query(ctx,
		`SELECT o.id, o.order_number, o.total_amount::float, `+paidAtSQL+`,
		        b.name, `+paidAtSQL+` + make_interval(days => $2)
		   FROM pos.pos_orders o
		   LEFT JOIN configuration.branches b ON b.id = o.branch_id
		  WHERE o.customer_id = $1 AND o.payment_status = 'paid'
		    AND o.status NOT IN ('cancelled', 'voided', 'merged')
		    AND `+paidAtSQL+` >= now() - make_interval(days => $2)
		    AND NOT EXISTS (SELECT 1 FROM crm.member_reviews r WHERE r.order_id = o.id)
		  ORDER BY `+paidAtSQL+` DESC
		  LIMIT 20`, customerID, windowDays)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ReviewableOrderRow, error) {
		var o ReviewableOrderRow
		err := row.Scan(&o.ID, &o.OrderNumber, &o.TotalAmount, &o.PaidAt, &o.OutletName, &o.ReviewUntil)
		return o, err
	})
}

func (s *store) MemberReviews(ctx context.Context, customerID string) ([]MemberReview, error) {
	rows, err := s.q.Query(ctx,
		`SELECT r.id, r.order_id, o.order_number, b.name, r.rating, r.comment,
		        r.reply, r.replied_at, r.created_at
		   FROM crm.member_reviews r
		   JOIN pos.pos_orders o ON o.id = r.order_id
		   LEFT JOIN configuration.branches b ON b.id = r.branch_id
		  WHERE r.customer_id = $1
		  ORDER BY r.created_at DESC
		  LIMIT 30`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (MemberReview, error) {
		var m MemberReview
		err := row.Scan(&m.ID, &m.OrderID, &m.OrderNumber, &m.OutletName, &m.Rating, &m.Comment,
			&m.Reply, &m.RepliedAt, &m.CreatedAt)
		return m, err
	})
}

// ReviewTarget is the order a review is written for.
type ReviewTarget struct {
	CustomerID    *string
	PaymentStatus string
	Status        string
	BranchID      *string
	PaidAt        time.Time
	Reviewed      bool
}

func (s *store) ReviewTarget(ctx context.Context, orderID string) (*ReviewTarget, error) {
	var t ReviewTarget
	var paidAt *time.Time
	err := s.q.QueryRow(ctx,
		`SELECT o.customer_id, o.payment_status::text, o.status::text, o.branch_id, `+paidAtSQL+`,
		        EXISTS (SELECT 1 FROM crm.member_reviews r WHERE r.order_id = o.id)
		   FROM pos.pos_orders o WHERE o.id = $1`, orderID).
		Scan(&t.CustomerID, &t.PaymentStatus, &t.Status, &t.BranchID, &paidAt, &t.Reviewed)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if paidAt != nil {
		t.PaidAt = *paidAt
	}
	return &t, nil
}

// InsertedReview is the review row returned after the insert.
type InsertedReview struct {
	ID        string  `json:"id"`
	OrderID   string  `json:"order_id"`
	Rating    int     `json:"rating"`
	Comment   *string `json:"comment"`
	CreatedAt jsTime  `json:"created_at"`
}

// InsertReview writes one review per order; nil when a concurrent tap won.
func (s *store) InsertReview(ctx context.Context, orderID, customerID string, branchID *string, rating int, comment *string) (*InsertedReview, error) {
	var r InsertedReview
	err := s.q.QueryRow(ctx,
		`INSERT INTO crm.member_reviews (order_id, customer_id, branch_id, rating, comment)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (order_id) DO NOTHING
		 RETURNING id, order_id, rating, comment, created_at`,
		orderID, customerID, branchID, rating, comment).Scan(&r.ID, &r.OrderID, &r.Rating, &r.Comment, &r.CreatedAt)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// BillOrder is an unpaid member order on the tab.
type BillOrder struct {
	ID          string
	OrderNumber *string
	OrderedAt   time.Time
	TotalAmount float64
}

// BillItem is a line of an open order.
type BillItem struct {
	OrderID     string
	Name        *string
	Quantity    float64
	TotalAmount float64
	Variants    json.RawMessage
	Modifiers   json.RawMessage
}

// BillPayment is an instalment paid towards the tab.
type BillPayment struct {
	ID                string
	Amount            float64
	PaymentMethod     string
	PaymentMethodName *string
	CreatedAt         time.Time
}

func (s *store) MemberExists(ctx context.Context, customerID string) (bool, error) {
	var exists bool
	err := s.q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pos.pos_customers WHERE id = $1)`, customerID).Scan(&exists)
	return exists, err
}

// OpenBillOrders are unpaid, live orders without a split bill.
func (s *store) OpenBillOrders(ctx context.Context, customerID string) ([]BillOrder, error) {
	rows, err := s.q.Query(ctx,
		`SELECT o.id, o.order_number, o.ordered_at, o.total_amount::float
		   FROM pos.pos_orders o
		  WHERE o.customer_id = $1
		    AND o.payment_status = 'unpaid'
		    AND o.status NOT IN ('cancelled', 'voided', 'merged')
		    AND NOT EXISTS (
		      SELECT 1 FROM pos.pos_order_splits s
		       WHERE s.order_id = o.id AND s.status <> 'cancelled'
		    )
		  ORDER BY o.ordered_at ASC`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (BillOrder, error) {
		var b BillOrder
		var total *float64
		var orderedAt *time.Time
		err := row.Scan(&b.ID, &b.OrderNumber, &orderedAt, &total)
		b.TotalAmount = deref(total)
		if orderedAt != nil {
			b.OrderedAt = *orderedAt
		}
		return b, err
	})
}

func (s *store) BillItems(ctx context.Context, orderIDs []string) ([]BillItem, error) {
	if len(orderIDs) == 0 {
		return nil, nil
	}
	rows, err := s.q.Query(ctx,
		`SELECT order_id, product_name, quantity::float, total_amount::float, variants, modifiers
		   FROM pos.pos_order_items WHERE order_id = ANY($1::uuid[])
		  ORDER BY created_at ASC`, orderIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (BillItem, error) {
		var it BillItem
		var qty, total *float64
		err := row.Scan(&it.OrderID, &it.Name, &qty, &total, &it.Variants, &it.Modifiers)
		it.Quantity, it.TotalAmount = deref(qty), deref(total)
		return it, err
	})
}

func (s *store) BillPayments(ctx context.Context, customerID string) ([]BillPayment, error) {
	rows, err := s.q.Query(ctx,
		`SELECT id, amount::float, payment_method, payment_method_name, created_at
		   FROM pos.pos_member_bill_payments WHERE customer_id = $1
		  ORDER BY created_at DESC LIMIT 200`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (BillPayment, error) {
		var p BillPayment
		err := row.Scan(&p.ID, &p.Amount, &p.PaymentMethod, &p.PaymentMethodName, &p.CreatedAt)
		return p, err
	})
}

// BillTotals are all instalments paid and all orders already settled.
func (s *store) BillTotals(ctx context.Context, customerID string) (paid, settled float64, err error) {
	err = s.q.QueryRow(ctx,
		`SELECT
		   (SELECT COALESCE(sum(amount), 0)::float FROM pos.pos_member_bill_payments WHERE customer_id = $1),
		   (SELECT COALESCE(sum(orders_total), 0)::float FROM pos.pos_member_bill_settlements WHERE customer_id = $1)`,
		customerID).Scan(&paid, &settled)
	return paid, settled, err
}
