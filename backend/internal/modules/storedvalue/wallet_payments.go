package storedvalue

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Online payment console: QRIS top-ups from the cashier and the member
// portal (lib/wallet/payments.ts).

// PaymentFilters is paymentFiltersSchema's output.
type PaymentFilters struct {
	Status, Source, Q, From, To string
	Limit                       int
}

const sourceSQL = `COALESCE(w.metadata->>'source', 'cashier')`

func (f PaymentFilters) where(withStatus bool) (string, []any) {
	clauses := []string{`w.type = 'topup'`, `lower(COALESCE(w.payment_method, '')) = 'qris'`}
	var params []any
	p := func(v any) string {
		params = append(params, v)
		return "$" + strconv.Itoa(len(params))
	}
	if withStatus && f.Status != "" {
		clauses = append(clauses, `w.status = `+p(f.Status))
	}
	if f.Source != "" {
		clauses = append(clauses, sourceSQL+` = `+p(f.Source))
	}
	if f.From != "" {
		clauses = append(clauses, `w.created_at >= (`+p(f.From)+`::date)::timestamptz`)
	}
	if f.To != "" {
		clauses = append(clauses, `w.created_at < (`+p(f.To)+`::date + 1)::timestamptz`)
	}
	if f.Q != "" {
		t := p("%" + f.Q + "%")
		clauses = append(clauses, `(c.name ILIKE `+t+` OR c.phone ILIKE `+t+` OR w.xendit_transaction_id ILIKE `+t+` OR w.reference_id ILIKE `+t+`)`)
	}
	return strings.Join(clauses, " AND "), params
}

type onlinePayment struct {
	ID                  string        `json:"id"`
	Status              string        `json:"status"`
	Amount              float64       `json:"amount"`
	XenditTransactionID *string       `json:"xendit_transaction_id"`
	ReferenceID         *string       `json:"reference_id"`
	CreatedAt           *httpx.JSTime `json:"created_at"`
	PaidAt              *string       `json:"paid_at"`
	Source              string        `json:"source"`
	PackageName         *string       `json:"package_name"`
	Environment         *string       `json:"environment"`
	Simulated           bool          `json:"simulated"`
	RefundedAt          *string       `json:"refunded_at"`
	CustomerID          *string       `json:"customer_id"`
	MemberName          *string       `json:"member_name"`
	MemberPhone         *string       `json:"member_phone"`
}

type paymentTotal struct {
	Status string  `json:"status"`
	Count  int     `json:"count"`
	Amount float64 `json:"amount"`
}

// OnlinePayments is listOnlinePayments.
type OnlinePayments struct {
	Payments []onlinePayment `json:"payments"`
	Summary  []paymentTotal  `json:"summary"`
}

// ListOnlinePayments lists QRIS top-ups and the per-status totals (the
// totals ignore the status filter).
func (w *Wallet) ListOnlinePayments(ctx context.Context, f PaymentFilters) (*OnlinePayments, error) {
	listSQL, listParams := f.where(true)
	rows, err := w.db.Query(ctx,
		`SELECT w.id, w.status, w.amount::float AS amount, w.xendit_transaction_id, w.reference_id, w.created_at,
		        w.metadata->>'credited_at' AS paid_at, `+sourceSQL+` AS source,
		        w.metadata->>'package_name' AS package_name, w.metadata->>'environment' AS environment,
		        COALESCE((w.metadata->>'simulated')::boolean, false) AS simulated,
		        w.metadata->>'refunded_at' AS refunded_at, w.customer_id, c.name AS member_name, c.phone AS member_phone
		   FROM pos.pos_wallet_transactions w LEFT JOIN pos.pos_customers c ON c.id = w.customer_id
		  WHERE `+listSQL+`
		  ORDER BY w.created_at DESC LIMIT `+strconv.Itoa(f.Limit), listParams...)
	if err != nil {
		return nil, err
	}
	out := &OnlinePayments{Payments: []onlinePayment{}, Summary: []paymentTotal{}}
	out.Payments, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (onlinePayment, error) {
		var p onlinePayment
		var created *time.Time
		err := r.Scan(&p.ID, &p.Status, &p.Amount, &p.XenditTransactionID, &p.ReferenceID, &created, &p.PaidAt,
			&p.Source, &p.PackageName, &p.Environment, &p.Simulated, &p.RefundedAt, &p.CustomerID, &p.MemberName, &p.MemberPhone)
		p.CreatedAt = httpx.NewJSTime(created)
		return p, err
	})
	if err != nil {
		return nil, err
	}
	sumSQL, sumParams := f.where(false)
	rows, err = w.db.Query(ctx,
		`SELECT w.status, count(*)::int AS count, COALESCE(sum(w.amount), 0)::float AS amount
		   FROM pos.pos_wallet_transactions w LEFT JOIN pos.pos_customers c ON c.id = w.customer_id
		  WHERE `+sumSQL+` GROUP BY w.status`, sumParams...)
	if err != nil {
		return nil, err
	}
	out.Summary, err = pgx.CollectRows(rows, pgx.RowToStructByPos[paymentTotal])
	if out.Payments == nil {
		out.Payments = []onlinePayment{}
	}
	if out.Summary == nil {
		out.Summary = []paymentTotal{}
	}
	return out, err
}

// OnlinePayment is loadOnlinePayment.
type OnlinePayment struct {
	Payment *WalletRow     `json:"payment"`
	Member  *MemberBalance `json:"member"`
	Related []*WalletRow   `json:"related"`
}

// OnlinePayment returns one top-up with its member and the bonus, refund
// and reversal rows that point at it.
func (w *Wallet) OnlinePayment(ctx context.Context, id string) (*OnlinePayment, error) {
	payment, err := scanWalletRow(w.db.QueryRow(ctx,
		`SELECT `+walletColumns+` FROM pos.pos_wallet_transactions WHERE id = $1 AND type = 'topup'`, id))
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Pembayaran tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	out := &OnlinePayment{Payment: payment}
	m, err := scanMemberBalance(w.db.QueryRow(ctx,
		`SELECT id, name, phone, COALESCE(ark_coin_balance, 0)::float AS balance FROM pos.pos_customers WHERE id = $1`,
		payment.CustomerID))
	switch {
	case err == nil:
		out.Member = &m
	case !database.IsNoRows(err):
		return nil, err
	}
	out.Related, err = collectWalletRows(w.db.Query(ctx,
		`SELECT `+walletColumns+` FROM pos.pos_wallet_transactions
		  WHERE metadata->>'source_topup_id' = $1 OR metadata->>'refunds_topup_id' = $1 OR metadata->>'reverses_id' = $1
		  ORDER BY created_at`, id))
	return out, err
}
