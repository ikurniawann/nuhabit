package storedvalue

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Wallet is the ARK Coin wallet service (lib/wallet, lib/pos/topup-*).
type Wallet struct {
	db    database.DB
	ports Ports
	now   func() time.Time
	log   *slog.Logger
}

// NewWallet builds the wallet service. POS checkout moves ARK Coin through
// MoveArkCoins on its own transaction.
func NewWallet(deps module.Deps, ports Ports) *Wallet {
	return &Wallet{db: deps.DB, ports: ports, now: deps.Now, log: deps.Log}
}

/* ── checkout-facing ─────────────────────────────────────────────────── */

// ArkMovement is one update_ark_coin_balance call.
type ArkMovement struct {
	CustomerID string
	// Amount is signed: negative pays, positive refunds.
	Amount float64
	// Type is the wallet row type: "payment" or "refund".
	Type      string
	OrderID   *string
	Notes     *string
	CompanyID *string
	BranchID  *string
}

// ErrArkInsufficient is the RPC's "Insufficient Ark Coin balance" failure.
var ErrArkInsufficient = errors.New("Saldo ARK Coin tidak cukup")

// MoveArkCoins runs public.update_ark_coin_balance on q (the caller's
// transaction) and returns the balance after the move. The function locks
// the customer row FOR UPDATE, refuses a negative balance for "payment",
// skips a second full payment for the same order (idempotent), stamps the
// venue and writes the wallet row, exactly as the TS checkout's RPC call.
// An insufficient balance is ErrArkInsufficient.
func (w *Wallet) MoveArkCoins(ctx context.Context, q database.Querier, m ArkMovement) (float64, error) {
	kind := m.Type
	if kind == "" {
		kind = "payment"
	}
	var after float64
	err := q.QueryRow(ctx,
		`SELECT public.update_ark_coin_balance($1::uuid, $2::numeric, $3::text, $4::uuid, $5::text, $6::uuid, $7::uuid)::float`,
		m.CustomerID, m.Amount, kind, m.OrderID, m.Notes, m.CompanyID, m.BranchID).Scan(&after)
	if err != nil && strings.Contains(err.Error(), "Insufficient") {
		return 0, ErrArkInsufficient
	}
	return after, err
}

// ArkBalance is pos_customers.ark_coin_balance (0 when unknown).
func (w *Wallet) ArkBalance(ctx context.Context, q database.Querier, customerID string) (float64, error) {
	var b float64
	err := q.QueryRow(ctx, `SELECT COALESCE(ark_coin_balance, 0)::float FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&b)
	if database.IsNoRows(err) {
		return 0, nil
	}
	return b, err
}

/* ── settings ────────────────────────────────────────────────────────── */

// loyaltySettingsSingletonID is POS_LOYALTY_SETTINGS_SINGLETON_ID.
const loyaltySettingsSingletonID = "a0000000-0000-4000-8000-000000000001"

// SettingsInput is the PUT /api/wallet/settings body.
type SettingsInput struct {
	TopupMaxAmount            float64
	LowBalanceThresholdIdr    float64
	WalletDefaultValidityDays *int
	WalletExpiryReminderDays  int
}

// SaveSettings mirrors saveWalletSettings: update the active row, insert
// the singleton when none exists.
func (w *Wallet) SaveSettings(ctx context.Context, in SettingsInput, actorID string) (WalletSettings, error) {
	tag, err := w.db.Exec(ctx,
		`UPDATE pos.pos_loyalty_settings
		    SET topup_max_amount = $1, low_balance_threshold_idr = $2, wallet_default_validity_days = $3,
		        wallet_expiry_reminder_days = $4, updated_by = $5, updated_at = now()
		  WHERE is_active`,
		in.TopupMaxAmount, in.LowBalanceThresholdIdr, in.WalletDefaultValidityDays, in.WalletExpiryReminderDays, actorID)
	if err != nil {
		return WalletSettings{}, err
	}
	if tag.RowsAffected() == 0 {
		if _, err := w.db.Exec(ctx,
			`INSERT INTO pos.pos_loyalty_settings
			   (id, topup_max_amount, low_balance_threshold_idr, wallet_default_validity_days,
			    wallet_expiry_reminder_days, updated_by, is_active)
			 VALUES ($6, $1, $2, $3, $4, $5, true)`,
			in.TopupMaxAmount, in.LowBalanceThresholdIdr, in.WalletDefaultValidityDays, in.WalletExpiryReminderDays,
			actorID, loyaltySettingsSingletonID); err != nil {
			return WalletSettings{}, err
		}
	}
	return loadWalletSettings(ctx, w.db)
}

/* ── members ─────────────────────────────────────────────────────────── */

// MemberBalance is a member with the ARK balance.
type MemberBalance struct {
	ID      string  `json:"id"`
	Name    *string `json:"name"`
	Phone   *string `json:"phone"`
	Balance float64 `json:"balance"`
}

func scanMemberBalance(row pgx.Row) (MemberBalance, error) {
	var m MemberBalance
	err := row.Scan(&m.ID, &m.Name, &m.Phone, &m.Balance)
	return m, err
}

// SearchMembers mirrors searchMembers: name or phone, 20 rows, min 2 chars.
func (w *Wallet) SearchMembers(ctx context.Context, q string) ([]MemberBalance, error) {
	term := validate.JSTrim(q)
	out := []MemberBalance{}
	if validate.UTF16Len(term) < 2 {
		return out, nil
	}
	rows, err := w.db.Query(ctx,
		`SELECT id, name, phone, COALESCE(ark_coin_balance, 0)::float AS balance
		   FROM pos.pos_customers
		  WHERE name ILIKE $1 OR phone ILIKE $1
		  ORDER BY name NULLS LAST LIMIT 20`, "%"+term+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		m, err := scanMemberBalance(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

type lotView struct {
	ID        string        `json:"id"`
	Type      string        `json:"type"`
	Amount    float64       `json:"amount"`
	Remaining float64       `json:"remaining"`
	CreatedAt httpx.JSTime  `json:"created_at"`
	ExpiresAt *httpx.JSTime `json:"expires_at"`
}

// MemberWallet is loadMemberWallet.
type MemberWallet struct {
	Member  MemberBalance `json:"member"`
	Lots    []lotView     `json:"lots"`
	Entries []*WalletRow  `json:"entries"`
}

// MemberWallet returns the balance, the live lots (FIFO) and the last 200
// entries newest first.
func (w *Wallet) MemberWallet(ctx context.Context, customerID string) (*MemberWallet, error) {
	m, err := scanMemberBalance(w.db.QueryRow(ctx,
		`SELECT id, name, phone, COALESCE(ark_coin_balance, 0)::float AS balance FROM pos.pos_customers WHERE id = $1`, customerID))
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Member tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	rows, err := loadLedgerRows(ctx, w.db, customerID)
	if err != nil {
		return nil, err
	}
	out := &MemberWallet{Member: m, Lots: []lotView{}, Entries: []*WalletRow{}}
	for _, lr := range domain.ComputeLotRemainders(ledgerRows(rows)) {
		if lr.Remaining <= 0 {
			continue
		}
		out.Lots = append(out.Lots, lotView{
			ID: lr.Lot.ID, Type: lr.Lot.Type, Amount: lr.Lot.Amount, Remaining: lr.Remaining,
			CreatedAt: httpx.JSTime(lr.Lot.CreatedAt), ExpiresAt: httpx.NewJSTime(lr.Lot.ExpiresAt),
		})
	}
	start := max(0, len(rows)-200)
	for i := len(rows) - 1; i >= start; i-- {
		out.Entries = append(out.Entries, rows[i])
	}
	return out, nil
}

/* ── admin corrections ───────────────────────────────────────────────── */

// Actor is the staff member behind a correction.
type Actor struct {
	ID   string
	Name string
}

func audit(actor Actor, reason string) map[string]any {
	return map[string]any{"actor_id": actor.ID, "actor_name": actor.Name, "reason": validate.JSTrim(reason)}
}

// ApplyAdjustment mirrors applyAdjustment: a signed manual change with a
// reason; a positive one becomes a lot with the default validity.
func (w *Wallet) ApplyAdjustment(ctx context.Context, customerID string, amount float64, reason string, actor Actor) (*WalletRow, error) {
	var out *WalletRow
	err := database.WithTx(ctx, w.db, func(tx pgx.Tx) error {
		customer, err := lockCustomer(ctx, tx, customerID)
		if err != nil {
			return err
		}
		delta, problem := domain.ValidateAdjustment(amount, reason, customer.Balance)
		if problem != "" {
			return httpx.BadRequest(problem)
		}
		settings, err := loadWalletSettings(ctx, tx)
		if err != nil {
			return err
		}
		var validity *float64
		if delta > 0 {
			validity = settings.WalletDefaultValidityDays
		}
		after := customer.Balance + delta
		meta := audit(actor, reason)
		meta["validity_days"] = validity
		out, err = insertWalletRow(ctx, tx, newWalletRow{
			CustomerID: customer.ID, Type: "adjustment", Amount: delta,
			BalanceBefore: customer.Balance, BalanceAfter: after, ArkRate: settings.ArkRate,
			Notes:     "Penyesuaian manual: " + validate.JSTrim(reason),
			Metadata:  meta,
			ExpiresAt: domain.ExpiresAtFor(validity, w.now()),
		})
		if err != nil {
			return err
		}
		return setCustomerBalance(ctx, tx, customer.ID, after)
	})
	return out, err
}

// ReverseEntry mirrors reverseEntry: undo one entry once, never into a
// negative balance.
func (w *Wallet) ReverseEntry(ctx context.Context, entryID, reason string, actor Actor) (*WalletRow, error) {
	var out *WalletRow
	err := database.WithTx(ctx, w.db, func(tx pgx.Tx) error {
		entry, err := lockEntry(ctx, tx, entryID)
		if err != nil {
			return err
		}
		customer, err := lockCustomer(ctx, tx, *entry.CustomerID)
		if err != nil {
			return err
		}
		reversed := truthy(entry.meta["reversed_by"])
		if !reversed {
			if reversed, err = existsWhere(ctx, tx, "reversal", "reverses_id", entry.ID); err != nil {
				return err
			}
		}
		delta, allocations, problem := domain.ValidateReversal(entry.ledgerRow(), reason, customer.Balance, reversed)
		if problem != "" {
			return httpx.BadRequest(problem)
		}
		settings, err := loadWalletSettings(ctx, tx)
		if err != nil {
			return err
		}
		after := customer.Balance + delta
		meta := audit(actor, reason)
		meta["reverses_id"] = entry.ID
		meta["reverses_type"] = entry.Type
		meta["lot_allocations"] = allocations
		out, err = insertWalletRow(ctx, tx, newWalletRow{
			CustomerID: customer.ID, Type: "reversal", Amount: delta,
			BalanceBefore: customer.Balance, BalanceAfter: after, ArkRate: settings.ArkRate,
			Notes:    "Pembatalan " + entry.Type + ": " + validate.JSTrim(reason),
			Metadata: meta, CompanyID: entry.CompanyID, BranchID: entry.BranchID,
		})
		if err != nil {
			return err
		}
		if err := markEntry(ctx, tx, entry.ID, map[string]any{"reversed_by": out.ID, "reversed_at": isoString(w.now())}); err != nil {
			return err
		}
		return setCustomerBalance(ctx, tx, customer.ID, after)
	})
	return out, err
}

// RefundInput is the POST /api/wallet/entries/{id}/refund body.
type RefundInput struct {
	Method    string
	Reference string
	Reason    string
}

// RefundTopup mirrors refundTopup: the top-up credit and its live bonus
// leave the balance; the money goes back by hand.
func (w *Wallet) RefundTopup(ctx context.Context, topupID string, in RefundInput, actor Actor) (*WalletRow, error) {
	var out *WalletRow
	err := database.WithTx(ctx, w.db, func(tx pgx.Tx) error {
		topup, err := lockEntry(ctx, tx, topupID)
		if err != nil {
			return err
		}
		customer, err := lockCustomer(ctx, tx, *topup.CustomerID)
		if err != nil {
			return err
		}
		bonuses, err := collectWalletRows(tx.Query(ctx,
			`SELECT `+walletColumns+` FROM pos.pos_wallet_transactions
			  WHERE type = 'topup_bonus' AND metadata->>'source_topup_id' = $1 FOR UPDATE`, topup.ID))
		if err != nil {
			return err
		}
		// A bonus reversed on its own is not taken twice.
		var liveBonus *domain.LedgerRow
		if len(bonuses) > 0 && !truthy(bonuses[0].meta["reversed_by"]) {
			b := bonuses[0].ledgerRow()
			liveBonus = &b
		}
		refunded, err := existsWhere(ctx, tx, "topup_refund", "refunds_topup_id", topup.ID)
		if err != nil {
			return err
		}
		check, problem := domain.ValidateTopupRefund(topup.ledgerRow(), topup.PaymentMethod, liveBonus, customer.Balance,
			refunded, truthy(topup.meta["reversed_by"]), in.Method, in.Reason)
		if problem != "" {
			return httpx.BadRequest(problem)
		}
		settings, err := loadWalletSettings(ctx, tx)
		if err != nil {
			return err
		}
		after := customer.Balance - check.RemoveIdr
		reference := validate.JSTrim(in.Reference)
		if validate.UTF16Len(reference) > 100 {
			reference = jsSlice(reference, 100)
		}
		notes := "Refund top-up " + domain.FormatRupiah(check.RefundIdr) + " via " + in.Method
		if check.Manual {
			notes += " (manual, QRIS tanpa refund API)"
		}
		meta := audit(actor, in.Reason)
		meta["refunds_topup_id"] = topup.ID
		meta["refund_idr"] = check.RefundIdr
		meta["refund_method"] = in.Method
		meta["refund_reference"] = kit.NullIfEmpty(reference)
		meta["original_payment_method"] = topup.PaymentMethod
		meta["xendit_transaction_id"] = topup.XenditTransactionID
		meta["manual_refund"] = check.Manual
		meta["lot_allocations"] = check.Allocations
		method := in.Method
		out, err = insertWalletRow(ctx, tx, newWalletRow{
			CustomerID: customer.ID, Type: "topup_refund", Amount: -check.RemoveIdr,
			BalanceBefore: customer.Balance, BalanceAfter: after, ArkRate: settings.ArkRate,
			PaymentMethod: &method, ReferenceID: kit.NullIfEmpty(reference), Notes: notes, Metadata: meta,
			CompanyID: topup.CompanyID, BranchID: topup.BranchID,
		})
		if err != nil {
			return err
		}
		if err := markEntry(ctx, tx, topup.ID, map[string]any{"refunded_at": isoString(w.now()), "refund_id": out.ID}); err != nil {
			return err
		}
		return setCustomerBalance(ctx, tx, customer.ID, after)
	})
	return out, err
}

/* ── helpers ─────────────────────────────────────────────────────────── */

// isoString is Date.prototype.toISOString.
func isoString(t time.Time) string { return t.UTC().Format(httpx.JSTimeLayout) }

// jsSlice is String.prototype.slice(0, n) on UTF-16 units.
func jsSlice(s string, n int) string {
	units := 0
	for i, r := range s {
		w := 1
		if r > 0xFFFF {
			w = 2
		}
		if units+w > n {
			return s[:i]
		}
		units += w
	}
	return s
}

// truthy is JS truthiness for a decoded JSON value.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0
	}
	return true
}

// OrderWalletRow is a wallet row referencing a POS order.
type OrderWalletRow struct {
	OrderID string
	Type    string
	Amount  float64
}

// OrderWalletRows lists the wallet rows of the orders (ARK payments and
// refunds), for POS checkout's void and receipt flows.
func (w *Wallet) OrderWalletRows(ctx context.Context, q database.Querier, orderIDs []string) ([]OrderWalletRow, error) {
	rows, err := q.Query(ctx,
		`SELECT order_id::text, type, amount::float FROM pos.pos_wallet_transactions
		  WHERE order_id = ANY($1::uuid[]) ORDER BY created_at`, orderIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[OrderWalletRow])
}
