package memberportal

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/database"
)

// MeCustomer is the pos_customers part of GET /me.
type MeCustomer struct {
	ID              string
	Fields          domain.ProfileFields
	MemberType      string
	ArkCoinBalance  *float64
	TotalXP         *float64
	VisitCount      *int64
	FreeXPGrantedAt *jsTime
	HasPassword     bool
}

func (s *store) MeCustomer(ctx context.Context, customerID string) (*MeCustomer, error) {
	var c MeCustomer
	var waConsent bool
	err := s.q.QueryRow(ctx,
		`SELECT id, name, phone, email, birth_date::text, gender, city, photo_url,
		        wa_consent, member_type,
		        ark_coin_balance::float, total_xp::float, visit_count, free_xp_granted_at,
		        password_hash IS NOT NULL
		   FROM pos.pos_customers WHERE id = $1`, customerID).Scan(
		&c.ID, &c.Fields.Name, &c.Fields.Phone, &c.Fields.Email, &c.Fields.BirthDate, &c.Fields.Gender,
		&c.Fields.City, &c.Fields.PhotoURL, &waConsent, &c.MemberType,
		&c.ArkCoinBalance, &c.TotalXP, &c.VisitCount, &c.FreeXPGrantedAt, &c.HasPassword)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.Fields.WAConsent = &waConsent
	return &c, nil
}

func (s *store) ActiveTiers(ctx context.Context) ([]domain.Tier, error) {
	rows, err := s.q.Query(ctx,
		`SELECT code, name, min_lifetime_xp::float, discount_percent::float
		   FROM crm.crm_membership_tiers WHERE is_active ORDER BY rank`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Tier, error) {
		var t domain.Tier
		var minXP, discount *float64
		err := row.Scan(&t.Code, &t.Name, &minXP, &discount)
		t.MinLifetimeXP, t.DiscountPercent = deref(minXP), deref(discount)
		return t, err
	})
}

// CrmSetting returns the raw jsonb value of a crm_settings key (nil if absent).
func (s *store) CrmSetting(ctx context.Context, key string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := s.q.QueryRow(ctx, `SELECT value FROM crm.crm_settings WHERE key = $1`, key).Scan(&raw)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return raw, err
}

// LoyaltyRates are ark_rate and the low balance threshold of the active
// pos_loyalty_settings row; nil fields when there is none.
type LoyaltyRates struct {
	ArkRate                *float64
	LowBalanceThresholdIdr *float64
}

func (s *store) LoyaltyRates(ctx context.Context) (LoyaltyRates, error) {
	var lr LoyaltyRates
	err := s.q.QueryRow(ctx,
		`SELECT ark_rate::float, COALESCE(low_balance_threshold_idr, 0)::float
		   FROM pos.pos_loyalty_settings
		  WHERE is_active ORDER BY updated_at DESC LIMIT 1`).Scan(&lr.ArkRate, &lr.LowBalanceThresholdIdr)
	if database.IsNoRows(err) {
		return LoyaltyRates{}, nil
	}
	return lr, err
}

// ProfileUpdate is the validated PUT /profile body; nil fields stay as they are.
type ProfileUpdate struct {
	Name      *string
	Email     *string // "" clears
	BirthDate *string // "" clears
	Gender    *string // "" clears
	City      *string // "" clears
	PhotoURL  *string // "" clears
	WAConsent *bool
}

// UpdatedProfile is the row returned after the update.
type UpdatedProfile struct {
	Fields             domain.ProfileFields
	ProfileCompletedAt *jsTime
	FreeXPGrantedAt    *jsTime
}

func (s *store) UpdateProfile(ctx context.Context, customerID string, in ProfileUpdate) (*UpdatedProfile, error) {
	sets := []string{"updated_at = now()"}
	args := []any{customerID}
	add := func(column string, value any) {
		args = append(args, value)
		sets = append(sets, column+" = $"+strconv.Itoa(len(args)))
	}
	if in.Name != nil {
		add("name", *in.Name)
	}
	if in.Email != nil {
		add("email", emptyToNil(*in.Email))
	}
	if in.BirthDate != nil {
		args = append(args, emptyToNil(*in.BirthDate))
		sets = append(sets, "birth_date = $"+strconv.Itoa(len(args))+"::date")
	}
	if in.Gender != nil {
		add("gender", emptyToNil(*in.Gender))
	}
	if in.City != nil {
		add("city", emptyToNil(*in.City))
	}
	if in.PhotoURL != nil {
		add("photo_url", emptyToNil(*in.PhotoURL))
	}
	if in.WAConsent != nil {
		add("wa_consent", *in.WAConsent)
	}
	var p UpdatedProfile
	var waConsent bool
	err := s.q.QueryRow(ctx,
		`UPDATE pos.pos_customers SET `+strings.Join(sets, ", ")+`
		  WHERE id = $1
		  RETURNING name, phone, email, birth_date::text, gender, city, photo_url,
		            wa_consent, profile_completed_at, free_xp_granted_at`, args...).Scan(
		&p.Fields.Name, &p.Fields.Phone, &p.Fields.Email, &p.Fields.BirthDate, &p.Fields.Gender, &p.Fields.City,
		&p.Fields.PhotoURL, &waConsent, &p.ProfileCompletedAt, &p.FreeXPGrantedAt)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.Fields.WAConsent = &waConsent
	return &p, nil
}

func (s *store) MarkProfileCompleted(ctx context.Context, customerID string) error {
	_, err := s.q.Exec(ctx, `UPDATE pos.pos_customers SET profile_completed_at = now() WHERE id = $1`, customerID)
	return err
}

func (s *store) MarkFreeXPGranted(ctx context.Context, customerID string) error {
	_, err := s.q.Exec(ctx,
		`UPDATE pos.pos_customers SET free_xp_granted_at = COALESCE(free_xp_granted_at, now()) WHERE id = $1`, customerID)
	return err
}

func (s *store) SetPhotoURL(ctx context.Context, customerID, url string) error {
	_, err := s.q.Exec(ctx, `UPDATE pos.pos_customers SET photo_url = $2 WHERE id = $1`, customerID, url)
	return err
}

// VenueVisit is one row of GET /visits.
type VenueVisit struct {
	VenueName   string `json:"venue_name"`
	OrderCount  int64  `json:"order_count"`
	DayCount    int64  `json:"day_count"`
	LastVisitAt jsTime `json:"last_visit_at"`
}

// VenueVisits counts paid orders per venue ("visits" are paid orders, not
// completed ones: the till leaves paid orders pending).
func (s *store) VenueVisits(ctx context.Context, customerID string) ([]VenueVisit, error) {
	rows, err := s.q.Query(ctx,
		`SELECT COALESCE(w.name, 'Venue lain') AS venue_name,
		        COUNT(*)::int AS order_count,
		        COUNT(DISTINCT (o.ordered_at AT TIME ZONE 'Asia/Jakarta')::date)::int AS day_count,
		        MAX(o.ordered_at) AS last_visit_at
		   FROM pos.pos_orders o
		   LEFT JOIN configuration.warehouses w ON w.id = o.warehouse_id
		  WHERE o.customer_id = $1
		    AND o.payment_status = 'paid'
		    AND o.status::text NOT IN ('cancelled', 'voided', 'merged')
		  GROUP BY COALESCE(w.name, 'Venue lain')
		  ORDER BY MAX(o.ordered_at) DESC`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (VenueVisit, error) {
		var v VenueVisit
		err := row.Scan(&v.VenueName, &v.OrderCount, &v.DayCount, &v.LastVisitAt)
		return v, err
	})
}

func (s *store) VisitCount(ctx context.Context, customerID string) (int64, error) {
	var n *int64
	err := s.q.QueryRow(ctx, `SELECT visit_count FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&n)
	if database.IsNoRows(err) || n == nil {
		return 0, nil
	}
	return *n, err
}

// WalletEntry is a row of the wallet history.
type WalletEntry struct {
	ID           string   `json:"id"`
	Type         string   `json:"type"`
	Amount       *float64 `json:"amount"`
	BalanceAfter *float64 `json:"balance_after"`
	Notes        *string  `json:"notes"`
	CreatedAt    jsTime   `json:"created_at"`
}

// PaidOrder is a row of the order history.
type PaidOrder struct {
	ID            string   `json:"id"`
	OrderNumber   *string  `json:"order_number"`
	TotalAmount   *float64 `json:"total_amount"`
	PaymentMethod *string  `json:"payment_method"`
	Status        *string  `json:"status"`
	CreatedAt     jsTime   `json:"created_at"`
}

func (s *store) WalletHistory(ctx context.Context, customerID string) ([]WalletEntry, error) {
	rows, err := s.q.Query(ctx,
		`SELECT id, type, amount::float, balance_after::float, notes, created_at
		   FROM pos.pos_wallet_transactions
		  WHERE customer_id = $1
		  ORDER BY created_at DESC LIMIT 25`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (WalletEntry, error) {
		var e WalletEntry
		err := row.Scan(&e.ID, &e.Type, &e.Amount, &e.BalanceAfter, &e.Notes, &e.CreatedAt)
		return e, err
	})
}

// PaidOrders lists the member's paid POS orders and paid online shop
// orders together, newest first.
func (s *store) PaidOrders(ctx context.Context, customerID string) ([]PaidOrder, error) {
	rows, err := s.q.Query(ctx,
		`SELECT id, order_number, total_amount::float, payment_method, status::text, created_at
		   FROM pos.pos_orders
		  WHERE customer_id = $1 AND payment_status = 'paid'
		UNION ALL
		SELECT id, order_number, total::float, payment_method, status, created_at
		   FROM shop.orders
		  WHERE customer_id = $1 AND paid_at IS NOT NULL AND status <> 'cancelled'
		  ORDER BY created_at DESC LIMIT 25`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (PaidOrder, error) {
		var o PaidOrder
		err := row.Scan(&o.ID, &o.OrderNumber, &o.TotalAmount, &o.PaymentMethod, &o.Status, &o.CreatedAt)
		return o, err
	})
}

// OrderHeader is the order part of GET /orders/{id}.
type OrderHeader struct {
	ID             string
	OrderNumber    *string
	OrderedAt      jsTime
	TotalAmount    *float64
	DiscountAmount *float64
	DiscountReason *string
	PaymentMethod  *string
	ArkCoinsUsed   *float64
	VenueName      *string
}

// OrderItem is a line of an order.
type OrderItem struct {
	ProductName    *string  `json:"product_name"`
	Quantity       *float64 `json:"quantity"`
	UnitPrice      *float64 `json:"unit_price"`
	DiscountAmount *float64 `json:"discount_amount"`
	TotalAmount    *float64 `json:"total_amount"`
}

// MemberOrder returns the order only when it belongs to the member.
func (s *store) MemberOrder(ctx context.Context, customerID, orderID string) (*OrderHeader, error) {
	var o OrderHeader
	err := s.q.QueryRow(ctx,
		`SELECT o.id, o.order_number, o.ordered_at, o.total_amount::float,
		        o.discount_amount::float, o.discount_reason,
		        o.payment_method, o.ark_coins_used::float, w.name
		   FROM pos.pos_orders o
		   LEFT JOIN configuration.warehouses w ON w.id = o.warehouse_id
		  WHERE o.id = $1 AND o.customer_id = $2`, orderID, customerID).Scan(
		&o.ID, &o.OrderNumber, &o.OrderedAt, &o.TotalAmount, &o.DiscountAmount, &o.DiscountReason,
		&o.PaymentMethod, &o.ArkCoinsUsed, &o.VenueName)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func (s *store) OrderItems(ctx context.Context, orderID string) ([]OrderItem, error) {
	rows, err := s.q.Query(ctx,
		`SELECT product_name, quantity::float, unit_price::float, discount_amount::float, total_amount::float
		   FROM pos.pos_order_items WHERE order_id = $1 ORDER BY created_at`, orderID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (OrderItem, error) {
		var it OrderItem
		err := row.Scan(&it.ProductName, &it.Quantity, &it.UnitPrice, &it.DiscountAmount, &it.TotalAmount)
		return it, err
	})
}

// OrderXP returns the XP from crm_xp_ledger (current) and pos_xp_transactions
// (legacy) for an order.
func (s *store) OrderXP(ctx context.Context, customerID, orderID string) (ledger, legacy float64, err error) {
	err = s.q.QueryRow(ctx,
		`SELECT COALESCE(SUM(xp_delta), 0)::float FROM crm.crm_xp_ledger
		  WHERE reference_table = 'pos_orders' AND reference_id = $1
		    AND customer_id = $2 AND direction = 'earn'`, orderID, customerID).Scan(&ledger)
	if err != nil {
		return 0, 0, err
	}
	err = s.q.QueryRow(ctx,
		`SELECT COALESCE(SUM(xp_earned), 0)::float FROM pos.pos_xp_transactions
		  WHERE order_id = $1 AND customer_id = $2`, orderID, customerID).Scan(&legacy)
	return ledger, legacy, err
}

func deref(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

func emptyToNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
