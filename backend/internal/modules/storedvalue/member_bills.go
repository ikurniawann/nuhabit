package storedvalue

import (
	"context"
	"encoding/json"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/possales"
	svcontracts "nuhabit/backend/internal/contracts/storedvalue"
	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/validate"
)

// Member bills (lib/pos/member-bill-server.ts). Instalments and the
// settlement that closes the open orders run in ONE transaction under the
// same per-member advisory lock the TS takes, so two cashiers billing one
// member can neither overpay nor close an order twice, whichever runtime
// serves them. The "order paid" effects the TS ran after the commit
// (journals, member stats, XP, queue number) are outbox events.

// OpenOrder is an unpaid member order (OPEN_ORDER_SQL).
type OpenOrder struct {
	ID          string
	OrderNumber *string
	QueueNumber *string
	OrderedAt   time.Time
	OrderType   *string
	Status      string
	TotalAmount float64
	CheckoutID  *string
	CompanyID   *string
	BranchID    *string
}

// OpenOrderSummary aggregates one member's open orders.
type OpenOrderSummary struct {
	CustomerID string
	Count      int
	Total      float64
	Oldest     *time.Time
}

// BillOrderItem is one line of an open order.
type BillOrderItem struct {
	OrderID     string
	ProductID   *string
	ProductName string
	Quantity    float64
	UnitPrice   *float64
	TotalAmount float64
	Variants    json.RawMessage
	Modifiers   json.RawMessage
}

// SettledOrder is an order closed by a member bill settlement.
type SettledOrder struct {
	ID          string       `json:"id"`
	OrderNumber *string      `json:"order_number"`
	OrderedAt   httpx.JSTime `json:"ordered_at"`
	TotalAmount float64      `json:"total_amount"`
	SettledAt   httpx.JSTime `json:"settled_at"`
}

// PaymentMethod is an active POS payment method.
type PaymentMethod struct {
	Code    string
	Name    string
	Handler string
}

// MemberBillOrders reaches the POS sales tables a member bill reads and
// closes (pos_orders, pos_order_items, pos_order_splits, pos_checkouts),
// the payment method catalog and shifts. Every call runs on the caller's
// querier; SettleOrders must be atomic with the settlement row.
type MemberBillOrders interface {
	OpenOrderSummaries(ctx context.Context, q database.Querier) ([]OpenOrderSummary, error)
	// OpenOrders lists a member's open orders oldest first; forUpdate locks them.
	OpenOrders(ctx context.Context, q database.Querier, customerID string, forUpdate bool) ([]OpenOrder, error)
	OrderItems(ctx context.Context, q database.Querier, orderIDs []string) ([]BillOrderItem, error)
	// SettledOrders lists orders closed by the member's settlements (100).
	SettledOrders(ctx context.Context, q database.Querier, customerID string) ([]SettledOrder, error)
	// SettleOrders marks the orders paid by member bill and closes the
	// multi-stall checkouts whose child orders are all paid.
	SettleOrders(ctx context.Context, q database.Querier, orderIDs, checkoutIDs []string, settlementID string) error
	// ActivePaymentMethod is nil when the code is not an active method.
	ActivePaymentMethod(ctx context.Context, q database.Querier, code string) (*PaymentMethod, error)
	// ActiveShift is the shift id when it exists and is active.
	ActiveShift(ctx context.Context, q database.Querier, shiftID string) (*string, error)
}

type memberBills struct {
	db     database.DB
	orders MemberBillOrders
	dir    Directory
	now    func() time.Time
	log    *slog.Logger
}

// billSums are the member's deposits and the order totals settled so far.
func billSums(ctx context.Context, q database.Querier, customerID string) (paid, settled float64, err error) {
	err = q.QueryRow(ctx,
		`SELECT
		   (SELECT COALESCE(sum(amount), 0)::float FROM pos.pos_member_bill_payments WHERE customer_id = $1) AS paid,
		   (SELECT COALESCE(sum(orders_total), 0)::float FROM pos.pos_member_bill_settlements WHERE customer_id = $1) AS settled`,
		customerID).Scan(&paid, &settled)
	return
}

// MemberBillSummary is one row of the member bill list.
type MemberBillSummary struct {
	CustomerID     string                   `json:"customer_id"`
	Name           string                   `json:"name"`
	Phone          *string                  `json:"phone"`
	MembershipTier *string                  `json:"membership_tier"`
	OpenOrderCount int                      `json:"open_order_count"`
	OldestOrderAt  *httpx.JSTime            `json:"oldest_order_at"`
	Balance        domain.MemberBillBalance `json:"balance"`
}

// List mirrors listMemberBills: members with open orders or unused
// deposits, the largest outstanding bill first.
func (b *memberBills) List(ctx context.Context, search string) ([]MemberBillSummary, error) {
	term := validate.JSTrim(search)
	summaries, err := b.orders.OpenOrderSummaries(ctx, b.db)
	if err != nil {
		return nil, err
	}
	open := map[string]OpenOrderSummary{}
	for _, s := range summaries {
		open[s.CustomerID] = s
	}
	type sums struct{ paid, settled float64 }
	deposits := map[string]*sums{}
	rows, err := b.db.Query(ctx,
		`SELECT customer_id::text, sum(amount)::float, 0::float FROM pos.pos_member_bill_payments GROUP BY customer_id
		 UNION ALL
		 SELECT customer_id::text, 0::float, sum(orders_total)::float FROM pos.pos_member_bill_settlements GROUP BY customer_id`)
	if err != nil {
		return nil, err
	}
	var id string
	var paid, settled float64
	if _, err := pgx.ForEachRow(rows, []any{&id, &paid, &settled}, func() error {
		s := deposits[id]
		if s == nil {
			s = &sums{}
			deposits[id] = s
		}
		s.paid += paid
		s.settled += settled
		return nil
	}); err != nil {
		return nil, err
	}
	var candidates []string
	for cid, s := range open {
		if s.Count > 0 {
			candidates = append(candidates, cid)
		}
	}
	for cid, s := range deposits {
		if _, listed := open[cid]; s.paid != s.settled && !listed {
			candidates = append(candidates, cid)
		}
	}
	out := []MemberBillSummary{}
	if len(candidates) == 0 {
		return out, nil
	}
	rows, err = b.db.Query(ctx,
		`SELECT c.id::text, c.name, c.phone, c.membership_tier FROM pos.pos_customers c
		  WHERE c.id = ANY($1::uuid[])
		    AND ($2 = '' OR c.name ILIKE '%' || $2 || '%' OR c.phone ILIKE '%' || $2 || '%')
		  LIMIT 500`, candidates, term)
	if err != nil {
		return nil, err
	}
	var name, phone, tier *string
	if _, err := pgx.ForEachRow(rows, []any{&id, &name, &phone, &tier}, func() error {
		o := open[id]
		var d sums
		if s := deposits[id]; s != nil {
			d = *s
		}
		label := "Member"
		if name != nil && *name != "" {
			label = *name
		}
		out = append(out, MemberBillSummary{
			CustomerID: id, Name: label, Phone: phone, MembershipTier: tier,
			OpenOrderCount: o.Count, OldestOrderAt: httpx.NewJSTime(o.Oldest),
			Balance: domain.ComputeMemberBillBalance(o.Total, d.paid, d.settled),
		})
		name, phone, tier = nil, nil, nil
		return nil
	}); err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Balance.Outstanding != out[j].Balance.Outstanding {
			return out[i].Balance.Outstanding > out[j].Balance.Outstanding
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

type billCustomer struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Phone          *string `json:"phone"`
	MembershipTier *string `json:"membership_tier"`
}

type billItem struct {
	Name        string   `json:"name"`
	Quantity    float64  `json:"quantity"`
	TotalAmount float64  `json:"total_amount"`
	Options     []string `json:"options"`
}

type openOrderView struct {
	ID          string       `json:"id"`
	OrderNumber *string      `json:"order_number"`
	QueueNumber *string      `json:"queue_number"`
	OrderedAt   httpx.JSTime `json:"ordered_at"`
	OrderType   *string      `json:"order_type"`
	Status      string       `json:"status"`
	TotalAmount float64      `json:"total_amount"`
	Items       []billItem   `json:"items"`
}

type billPayment struct {
	ID                string       `json:"id"`
	Amount            float64      `json:"amount"`
	PaymentMethod     string       `json:"payment_method"`
	PaymentMethodName *string      `json:"payment_method_name"`
	ReferenceNumber   *string      `json:"reference_number"`
	Notes             *string      `json:"notes"`
	ReceivedByName    *string      `json:"received_by_name"`
	SettlementID      *string      `json:"settlement_id"`
	CreatedAt         httpx.JSTime `json:"created_at"`
}

// MemberBillDetail is getMemberBillDetail.
type MemberBillDetail struct {
	Customer      billCustomer             `json:"customer"`
	Balance       domain.MemberBillBalance `json:"balance"`
	OpenOrders    []openOrderView          `json:"open_orders"`
	SettledOrders []SettledOrder           `json:"settled_orders"`
	Payments      []billPayment            `json:"payments"`
}

// namesOf reads the "name" of each object in a variants/modifiers array.
func namesOf(raw json.RawMessage) []string {
	var list []any
	if json.Unmarshal(raw, &list) != nil {
		return nil
	}
	var out []string
	for _, entry := range list {
		if m, isMap := entry.(map[string]any); isMap {
			if s := domain.JSString(m["name"]); s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

// Detail mirrors getMemberBillDetail: open orders with their lines, the
// balance, settled orders and the instalment history.
func (b *memberBills) Detail(ctx context.Context, customerID string) (*MemberBillDetail, error) {
	var c billCustomer
	var name *string
	err := b.db.QueryRow(ctx, `SELECT id, name, phone, membership_tier FROM pos.pos_customers WHERE id = $1`, customerID).
		Scan(&c.ID, &name, &c.Phone, &c.MembershipTier)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Member tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	c.Name = "Member"
	if name != nil && *name != "" {
		c.Name = *name
	}
	open, err := b.orders.OpenOrders(ctx, b.db, customerID, false)
	if err != nil {
		return nil, err
	}
	settledOrders, err := b.orders.SettledOrders(ctx, b.db, customerID)
	if err != nil {
		return nil, err
	}
	rows, err := b.db.Query(ctx,
		`SELECT id, amount::float AS amount, payment_method, payment_method_name, reference_number, notes,
		        received_by_name, settlement_id, created_at
		   FROM pos.pos_member_bill_payments WHERE customer_id = $1
		  ORDER BY created_at DESC LIMIT 200`, customerID)
	if err != nil {
		return nil, err
	}
	payments, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (billPayment, error) {
		var p billPayment
		var at time.Time
		err := r.Scan(&p.ID, &p.Amount, &p.PaymentMethod, &p.PaymentMethodName, &p.ReferenceNumber, &p.Notes,
			&p.ReceivedByName, &p.SettlementID, &at)
		p.CreatedAt = httpx.JSTime(at)
		return p, err
	})
	if err != nil {
		return nil, err
	}
	paid, settled, err := billSums(ctx, b.db, customerID)
	if err != nil {
		return nil, err
	}
	var items []BillOrderItem
	if len(open) > 0 {
		ids := make([]string, len(open))
		for i, o := range open {
			ids[i] = o.ID
		}
		if items, err = b.orders.OrderItems(ctx, b.db, ids); err != nil {
			return nil, err
		}
	}
	out := &MemberBillDetail{Customer: c, OpenOrders: []openOrderView{}, SettledOrders: settledOrders, Payments: payments}
	if out.SettledOrders == nil {
		out.SettledOrders = []SettledOrder{}
	}
	if out.Payments == nil {
		out.Payments = []billPayment{}
	}
	openTotal := 0.0
	for _, o := range open {
		openTotal += o.TotalAmount
		v := openOrderView{ID: o.ID, OrderNumber: o.OrderNumber, QueueNumber: o.QueueNumber, OrderedAt: httpx.JSTime(o.OrderedAt),
			OrderType: o.OrderType, Status: o.Status, TotalAmount: o.TotalAmount, Items: []billItem{}}
		for _, it := range items {
			if it.OrderID == o.ID {
				options := append(namesOf(it.Variants), namesOf(it.Modifiers)...)
				if options == nil {
					options = []string{}
				}
				v.Items = append(v.Items, billItem{Name: it.ProductName, Quantity: it.Quantity, TotalAmount: it.TotalAmount, Options: options})
			}
		}
		out.OpenOrders = append(out.OpenOrders, v)
	}
	out.Balance = domain.ComputeMemberBillBalance(openTotal, paid, settled)
	return out, nil
}

// billState is lockMemberBill's result.
type billState struct {
	name      string
	orders    []OpenOrder
	paid      float64
	settled   float64
	openTotal float64
}

// lockMemberBill takes the per-member advisory lock (the TS key, so Next
// and Go serialize), then locks the open orders.
func (b *memberBills) lockMemberBill(ctx context.Context, tx pgx.Tx, customerID string) (*billState, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('pos-member-bill:' || $1))`, customerID); err != nil {
		return nil, err
	}
	var name *string
	err := tx.QueryRow(ctx, `SELECT name FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&name)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Member tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	orders, err := b.orders.OpenOrders(ctx, tx, customerID, true)
	if err != nil {
		return nil, err
	}
	s := &billState{name: "Member", orders: orders}
	if name != nil && *name != "" {
		s.name = *name
	}
	if s.paid, s.settled, err = billSums(ctx, tx, customerID); err != nil {
		return nil, err
	}
	for _, o := range orders {
		s.openTotal += o.TotalAmount
	}
	return s, nil
}

// BillUser is the cashier behind a payment or settlement.
type BillUser struct {
	ID   string
	Name string
}

// settleOpenOrders closes every open order from the deposits, in the
// caller's transaction, and publishes one pos.sale.completed per order for
// the effects the TS ran after the commit.
func (b *memberBills) settleOpenOrders(ctx context.Context, tx pgx.Tx, customerID string, s *billState, user BillUser) (int, error) {
	if len(s.orders) == 0 {
		return 0, nil
	}
	first := s.orders[0]
	var settlementID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO pos.pos_member_bill_settlements
		   (customer_id, orders_total, order_count, settled_by, settled_by_name, company_id, branch_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		customerID, s.openTotal, len(s.orders), user.ID, user.Name, first.CompanyID, first.BranchID).Scan(&settlementID); err != nil {
		return 0, err
	}
	ids := make([]string, len(s.orders))
	var checkoutIDs []string
	for i, o := range s.orders {
		ids[i] = o.ID
		if o.CheckoutID != nil {
			checkoutIDs = append(checkoutIDs, *o.CheckoutID)
		}
	}
	if err := b.orders.SettleOrders(ctx, tx, ids, domain.SortedUnique(checkoutIDs), settlementID); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE pos.pos_member_bill_payments SET settlement_id = $2 WHERE customer_id = $1 AND settlement_id IS NULL`,
		customerID, settlementID); err != nil {
		return 0, err
	}
	items, err := b.orders.OrderItems(ctx, tx, ids)
	if err != nil {
		return 0, err
	}
	for _, o := range s.orders {
		total := o.TotalAmount
		event := possales.SaleCompleted{
			OrderID: o.ID, CustomerID: &customerID, TotalAmount: total,
			PaymentMethod: domain.MemberBillPaymentMethod, BranchID: o.BranchID, Items: []possales.SaleItem{}, StatsAmount: &total,
			UserID: &user.ID,
		}
		for _, it := range items {
			if it.OrderID == o.ID {
				t := it.TotalAmount
				event.Items = append(event.Items, possales.SaleItem{ProductID: kit.Deref(it.ProductID), Quantity: it.Quantity, UnitPrice: it.UnitPrice, TotalAmount: &t})
			}
		}
		if err := outbox.Publish(ctx, tx, possales.TopicSaleCompleted, o.ID, event); err != nil {
			return 0, err
		}
	}
	return len(s.orders), nil
}

// PaymentInput is a validated instalment.
type PaymentInput struct {
	Amount            float64
	PaymentMethodCode string
	ReferenceNumber   *string
	Notes             *string
	ShiftID           *string
}

// PaymentResult is recordMemberBillPayment's result.
type PaymentResult struct {
	PaymentID         string                   `json:"payment_id"`
	Balance           domain.MemberBillBalance `json:"balance"`
	SettledOrderCount int                      `json:"settled_order_count"`
	Notes             []string                 `json:"notes"`
}

// trimSlice is `value?.trim().slice(0, n) || null`.
func trimSlice(v *string, n int) *string {
	if v == nil {
		return nil
	}
	return kit.NullIfEmpty(jsSlice(validate.JSTrim(*v), n))
}

// RecordPayment mirrors recordMemberBillPayment: the instalment, and when
// the deposits now cover every open order, their settlement, atomically.
// The deposit journal is an outbox event.
func (b *memberBills) RecordPayment(ctx context.Context, customerID string, in PaymentInput, user BillUser) (*PaymentResult, error) {
	method, err := b.orders.ActivePaymentMethod(ctx, b.db, in.PaymentMethodCode)
	if err != nil {
		return nil, err
	}
	if method == nil {
		return nil, httpx.BadRequest("Metode bayar tidak ditemukan atau tidak aktif")
	}
	if !domain.IsMemberBillMethod(method.Handler, method.Code, method.Name) {
		return nil, httpx.BadRequest(method.Name + " tidak bisa dipakai untuk tagihan member")
	}
	baseMethod := domain.MemberBillBaseMethod(method.Handler)
	out := &PaymentResult{Notes: []string{}}
	err = database.WithTx(ctx, b.db, func(tx pgx.Tx) error {
		s, err := b.lockMemberBill(ctx, tx, customerID)
		if err != nil {
			return err
		}
		before := domain.ComputeMemberBillBalance(s.openTotal, s.paid, s.settled)
		if problem := domain.ValidateMemberBillAmount(in.Amount, before.Outstanding); problem != "" {
			return httpx.BadRequest(problem)
		}
		var shiftID *string
		if in.ShiftID != nil && *in.ShiftID != "" {
			if shiftID, err = b.orders.ActiveShift(ctx, tx, *in.ShiftID); err != nil {
				return err
			}
		}
		var company, branch *string
		if len(s.orders) > 0 {
			company, branch = s.orders[0].CompanyID, s.orders[0].BranchID
		}
		if err := tx.QueryRow(ctx,
			`INSERT INTO pos.pos_member_bill_payments
			   (customer_id, amount, payment_method, payment_method_code, payment_method_name,
			    reference_number, notes, shift_id, received_by, received_by_name, company_id, branch_id)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			 RETURNING id`,
			customerID, in.Amount, baseMethod, method.Code, method.Name, trimSlice(in.ReferenceNumber, 80),
			trimSlice(in.Notes, 300), shiftID, user.ID, user.Name, company, branch).Scan(&out.PaymentID); err != nil {
			return err
		}
		out.Balance = domain.ComputeMemberBillBalance(s.openTotal, s.paid+in.Amount, s.settled)
		if out.Balance.CanSettle {
			n, err := b.settleOpenOrders(ctx, tx, customerID, s, user)
			if err != nil {
				return err
			}
			out.SettledOrderCount = n
			if n > 0 {
				out.Balance = domain.ComputeMemberBillBalance(0, s.paid+in.Amount, s.settled+s.openTotal)
			}
		}
		if event := domain.MemberDepositEvent(baseMethod); event != "" {
			return outbox.Publish(ctx, tx, svcontracts.TopicMemberBillPaid, out.PaymentID, svcontracts.MemberBillPaid{
				PaymentID: out.PaymentID, CompanyID: company, UserID: user.ID, EventCode: event,
				DocumentType: "pos_member_bill_payment", EntryDate: b.now().In(domain.Jakarta()).Format("2006-01-02"),
				AmountTotal: in.Amount, Description: "Cicilan tagihan member " + s.name + " (" + method.Name + ")",
				SourceModule: "POS",
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// SettleResult is settleMemberBillFromCredit's result.
type SettleResult struct {
	SettledOrderCount int      `json:"settled_order_count"`
	Notes             []string `json:"notes"`
}

// SettleFromCredit closes the open orders from existing deposits (an order
// voided after instalments can leave them covering everything).
func (b *memberBills) SettleFromCredit(ctx context.Context, customerID string, user BillUser) (*SettleResult, error) {
	out := &SettleResult{Notes: []string{}}
	err := database.WithTx(ctx, b.db, func(tx pgx.Tx) error {
		s, err := b.lockMemberBill(ctx, tx, customerID)
		if err != nil {
			return err
		}
		if !domain.ComputeMemberBillBalance(s.openTotal, s.paid, s.settled).CanSettle {
			return httpx.BadRequest("Saldo cicilan belum menutup semua order")
		}
		out.SettledOrderCount, err = b.settleOpenOrders(ctx, tx, customerID, s, user)
		return err
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
