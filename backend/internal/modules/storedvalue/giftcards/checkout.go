package giftcards

import (
	"context"
	"errors"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	svdomain "nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/modules/storedvalue/giftcards/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// The checkout-facing gift card operations (lib/giftcard/giftcard-server.ts).
// POS sales calls them with its own transaction as q; each runs in a
// savepoint inside it, so a rejection rolls back only the gift card writes.

/* ── sale: which cards a cart issues ─────────────────────────────────── */

// MaxCardsPerOrder is MAX_CARDS_PER_ORDER.
const MaxCardsPerOrder = 20

// SaleLine is GiftCardSaleLineInput: a cart line as the till sent it. The
// price fields hold a number, a numeric string or nil (Number(v) || 0).
type SaleLine struct {
	ProductID               string
	Quantity                any
	UnitPrice               any
	VariantPriceAdjustment  any
	ModifierPriceAdjustment any
}

// SalePlan is GiftCardSalePlan: the nominal of every card to issue (one
// entry per card), or the reason the cart is refused.
type SalePlan struct {
	OK       bool
	Nominals []float64
	Reason   string
}

// PrepareGiftCardSale is prepareGiftCardSale: the cashier types gift card
// prices, so the server reloads product_kind from the catalog and checks
// each nominal against the config (presets or custom, whole rupiah,
// ceiling) and the per-order card cap.
func (s *Service) PrepareGiftCardSale(ctx context.Context, q database.Querier, items []SaleLine) (SalePlan, error) {
	var ids []string
	seen := map[string]bool{}
	for _, it := range items {
		if it.ProductID != "" && !seen[it.ProductID] {
			seen[it.ProductID] = true
			ids = append(ids, it.ProductID)
		}
	}
	empty := SalePlan{OK: true, Nominals: []float64{}}
	if len(ids) == 0 {
		return empty, nil
	}
	giftIDs, err := s.ports.Catalog.GiftCardProductIDs(ctx, q, ids)
	if err != nil || len(giftIDs) == 0 {
		return empty, err
	}
	isGift := map[string]bool{}
	for _, id := range giftIDs {
		isGift[id] = true
	}
	cfg, err := s.LoadConfig(ctx, q)
	if err != nil {
		return SalePlan{}, err
	}
	nominals := []float64{}
	for _, it := range items {
		if !isGift[it.ProductID] {
			continue
		}
		nominal := svdomain.ToNumber(it.UnitPrice) + svdomain.ToNumber(it.VariantPriceAdjustment) + svdomain.ToNumber(it.ModifierPriceAdjustment)
		if !domain.IsAllowedNominal(cfg, nominal) {
			return SalePlan{Reason: domain.NominalRejection(cfg)}, nil
		}
		qty := svdomain.ToNumber(it.Quantity)
		if qty == 0 {
			qty = 1
		}
		for range int(max(1, min(math.Floor(qty), MaxCardsPerOrder+1))) {
			nominals = append(nominals, nominal)
		}
		if len(nominals) > MaxCardsPerOrder {
			return SalePlan{Reason: "Maksimal 20 gift card per transaksi"}, nil
		}
	}
	return SalePlan{OK: true, Nominals: nominals}, nil
}

/* ── issue: cards sold at the till ───────────────────────────────────── */

// IssueInput is issueGiftCardsForPosOrder's input. CreatedBy "" is NULL.
type IssueInput struct {
	Scope      Scope
	OrderID    string
	Nominals   []float64 // one entry per card
	BuyerName  *string
	BuyerPhone *string
	CreatedBy  string
}

// IssuedGiftCard is IssuedGiftCard, serialized as the order response's
// gift_cards entries.
type IssuedGiftCard struct {
	ID           string        `json:"id"`
	Code         string        `json:"code"`
	InitialValue float64       `json:"initial_value"`
	ExpiresAt    *httpx.JSTime `json:"expires_at"`
}

const maxCodeRounds = 6

// IssueGiftCardsForPosOrder is issueGiftCardsForPosOrder: cards for a POS
// order that is already paid. Idempotent per order: when cards with
// source pos_order/orderID exist they come back and none are added.
// Codes are unique per branch through ON CONFLICT (branch_id, code).
func (s *Service) IssueGiftCardsForPosOrder(ctx context.Context, q database.Querier, in IssueInput) ([]IssuedGiftCard, error) {
	cfg, err := s.LoadConfig(ctx, q)
	if err != nil {
		return nil, err
	}
	expiresAt := domain.ResolveExpiry(cfg.ExpiryMonths, s.now().Truncate(time.Millisecond))

	var cards []IssuedGiftCard
	err = atomic(ctx, q, func(tx database.Querier) error {
		existing, err := scanIssued(tx.Query(ctx, `SELECT id, code, initial_value::float8, expires_at
			FROM giftcard.gift_cards
			WHERE source_type = 'pos_order' AND source_id = $1
			ORDER BY created_at`, in.OrderID))
		if err != nil || len(existing) > 0 {
			cards = existing
			return err
		}
		cards = []IssuedGiftCard{}
		for _, nominal := range in.Nominals {
			card, err := s.insertSoldCard(ctx, tx, in, nominal, expiresAt)
			if err != nil {
				return err
			}
			cards = append(cards, card)
		}
		return nil
	})
	return cards, err
}

func (s *Service) insertSoldCard(ctx context.Context, tx database.Querier, in IssueInput, nominal float64, expiresAt *time.Time) (IssuedGiftCard, error) {
	for range maxCodeRounds {
		rows, err := scanIssued(tx.Query(ctx, `INSERT INTO giftcard.gift_cards
			  (company_id, branch_id, code, initial_value, balance, status,
			   expires_at, source_type, source_id, buyer_name, buyer_phone,
			   note, created_by)
			VALUES ($1, $2, $3, $4, $4, 'active', $5, 'pos_order', $6, $7, $8, $9, $10)
			ON CONFLICT (branch_id, code) DO NOTHING
			RETURNING id, code, initial_value::float8, expires_at`,
			in.Scope.CompanyID, in.Scope.BranchID, domain.GenerateCode(), nominal, expiresAt,
			in.OrderID, in.BuyerName, in.BuyerPhone,
			"Dijual di kasir (order "+in.OrderID+")", kit.NullIfEmpty(in.CreatedBy)))
		if err != nil {
			return IssuedGiftCard{}, err
		}
		if len(rows) == 0 {
			continue // code collision: try a fresh code
		}
		_, err = tx.Exec(ctx, `INSERT INTO giftcard.gift_card_ledger
			  (company_id, branch_id, card_id, direction, amount, balance_after,
			   context_type, context_id, note, created_by)
			VALUES ($1, $2, $3, 'isi', $4, $4, 'pos_order', $5, $6, $7)`,
			in.Scope.CompanyID, in.Scope.BranchID, rows[0].ID, nominal, in.OrderID,
			"Penjualan gift card di kasir", kit.NullIfEmpty(in.CreatedBy))
		return rows[0], err
	}
	return IssuedGiftCard{}, errors.New("Gagal menerbitkan kode gift card unik — coba lagi")
}

func scanIssued(rows pgx.Rows, err error) ([]IssuedGiftCard, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IssuedGiftCard{}
	for rows.Next() {
		var c IssuedGiftCard
		var exp *time.Time
		if err := rows.Scan(&c.ID, &c.Code, &c.InitialValue, &exp); err != nil {
			return nil, err
		}
		c.ExpiresAt = httpx.NewJSTime(exp)
		out = append(out, c)
	}
	return out, rows.Err()
}

/* ── redeem: pay an order with a card ────────────────────────────────── */

// RedeemInput is redeemGiftCardForPosOrder's input. Amount must be the
// order total (one order, one payment method). CreatedBy "" is NULL.
type RedeemInput struct {
	Scope     Scope
	Code      string
	Amount    float64
	OrderID   string
	CreatedBy string
}

// RedeemOutcome is GiftCardRedeemOutcome. When OK is false, Reason is the
// cashier message and Status its HTTP status (400, 404 or 409).
type RedeemOutcome struct {
	OK           bool
	CardID       string
	Code         string
	BalanceAfter float64
	StatusAfter  string
	Reason       string
	Status       int
}

const alreadyPaidMessage = "Order ini sudah dibayar dengan gift card"

var errAlreadyPaid = errors.New(alreadyPaidMessage)

// RedeemGiftCardForPosOrder is redeemGiftCardForPosOrder: debits the full
// order total from the card. The card row is locked FOR UPDATE so two tills
// cannot overdraw it; the unique index gift_card_ledger_one_debit_per_pos_order
// makes a second debit of the same order (even with another card) a 409,
// and the savepoint rolls that second debit back.
func (s *Service) RedeemGiftCardForPosOrder(ctx context.Context, q database.Querier, in RedeemInput) (RedeemOutcome, error) {
	code := domain.NormalizeCode(in.Code)
	amount := svdomain.RoundIdr(in.Amount)
	var out RedeemOutcome
	err := atomic(ctx, q, func(tx database.Querier) error {
		card, err := lockCard(ctx, tx, "code", code, in.Scope)
		if err != nil || card == nil {
			out = RedeemOutcome{Reason: "Gift card tidak ditemukan", Status: http.StatusNotFound}
			return err
		}
		var paid bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM giftcard.gift_card_ledger
			WHERE context_type = 'pos_order' AND context_id = $1 AND direction = 'pakai')`, in.OrderID).Scan(&paid); err != nil {
			return err
		}
		if paid {
			out = RedeemOutcome{Reason: alreadyPaidMessage, Status: http.StatusConflict}
			return nil
		}
		ev := domain.EvaluateRedeem(card.state(), amount, s.now())
		if !ev.OK {
			out = RedeemOutcome{Reason: domain.RedeemMessages[ev.Reason], Status: http.StatusBadRequest}
			return nil
		}
		if err := updateCard(ctx, tx, card.ID, ev.BalanceAfter, ev.StatusAfter); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO giftcard.gift_card_ledger
			  (company_id, branch_id, card_id, direction, amount, balance_after,
			   context_type, context_id, note, created_by)
			VALUES ($1, $2, $3, 'pakai', $4, $5, 'pos_order', $6, $7, $8)`,
			in.Scope.CompanyID, in.Scope.BranchID, card.ID, amount, ev.BalanceAfter, in.OrderID,
			"Pembayaran order kasir", kit.NullIfEmpty(in.CreatedBy))
		if database.IsUniqueViolation(err) {
			return errAlreadyPaid
		}
		out = RedeemOutcome{OK: true, CardID: card.ID, Code: card.Code, BalanceAfter: ev.BalanceAfter, StatusAfter: ev.StatusAfter}
		return err
	})
	if errors.Is(err, errAlreadyPaid) {
		return RedeemOutcome{Reason: alreadyPaidMessage, Status: http.StatusConflict}, nil
	}
	return out, err
}

/* ── refund: give a debit back ───────────────────────────────────────── */

// RefundInput is refundGiftCardForPosOrder's input. Note "" takes the
// default ledger note; CreatedBy "" is NULL.
type RefundInput struct {
	Scope     Scope
	OrderID   string
	CreatedBy string
	Note      string
}

// RefundGiftCardForPosOrder is refundGiftCardForPosOrder: returns the
// order's 'pakai' debit to its card with a 'koreksi' ledger row. It is
// false when the order has no debit. Idempotent: an order already refunded
// is true without a second refund. The card is locked FOR UPDATE before
// the refund check, so two refunds of one order serialize on the card.
// The TS callers treat it as best effort and only log a failure.
func (s *Service) RefundGiftCardForPosOrder(ctx context.Context, q database.Querier, in RefundInput) (bool, error) {
	note := in.Note
	if note == "" {
		note = "Pengembalian saldo — pembayaran order gagal diselesaikan"
	}
	var refunded bool
	err := atomic(ctx, q, func(tx database.Querier) error {
		var cardID string
		var amount float64
		err := tx.QueryRow(ctx, `SELECT card_id, amount::float8 FROM giftcard.gift_card_ledger
			WHERE context_type = 'pos_order' AND context_id = $1 AND direction = 'pakai'
			ORDER BY created_at
			LIMIT 1`, in.OrderID).Scan(&cardID, &amount)
		if database.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		card, err := lockCard(ctx, tx, "id", cardID, Scope{})
		if err != nil || card == nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM giftcard.gift_card_ledger
			WHERE context_type = 'pos_order' AND context_id = $1 AND direction = 'koreksi')`, in.OrderID).Scan(&refunded); err != nil || refunded {
			return err
		}
		balanceAfter, err := domain.BalanceAfterCorrection(card.Balance, amount)
		if err != nil {
			return err
		}
		if err := updateCard(ctx, tx, card.ID, balanceAfter, domain.StatusAfterRefund(card.Status, balanceAfter)); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO giftcard.gift_card_ledger
			  (company_id, branch_id, card_id, direction, amount, balance_after,
			   context_type, context_id, note, created_by)
			VALUES ($1, $2, $3, 'koreksi', $4, $5, 'pos_order', $6, $7, $8)`,
			in.Scope.CompanyID, in.Scope.BranchID, card.ID, amount, balanceAfter, in.OrderID,
			note, kit.NullIfEmpty(in.CreatedBy))
		refunded = err == nil
		return err
	})
	return refunded, err
}

/* ── void: disable the cards an order sold ───────────────────────────── */

// IssuedGiftCardAlreadyUsedError is IssuedGiftCardAlreadyUsedError: a card
// the voided order sold has been spent, so the void is refused (409).
type IssuedGiftCardAlreadyUsedError struct{ Code string }

func (e *IssuedGiftCardAlreadyUsedError) Error() string {
	return "Gift card " + e.Code + " sudah terpakai — void ditolak"
}

// VoidInput is voidIssuedGiftCardsForPosOrder's input. Note "" takes the
// default suffix appended to each card's note.
type VoidInput struct {
	OrderID string
	Note    string
}

// VoidIssuedGiftCardsForPosOrder is voidIssuedGiftCardsForPosOrder: disables
// every card the order sold (rows locked FOR UPDATE) and returns how many
// are disabled. A card with a 'pakai' row fails the whole void with
// *IssuedGiftCardAlreadyUsedError and nothing changes. Idempotent: cards
// already disabled are counted, not touched.
func (s *Service) VoidIssuedGiftCardsForPosOrder(ctx context.Context, q database.Querier, in VoidInput) (int, error) {
	note := in.Note
	if note == "" {
		note = " — void penjualan kasir"
	}
	disabled := 0
	err := atomic(ctx, q, func(tx database.Querier) error {
		rows, err := tx.Query(ctx, `SELECT id, code, status FROM giftcard.gift_cards
			WHERE source_type = 'pos_order' AND source_id = $1
			FOR UPDATE`, in.OrderID)
		if err != nil {
			return err
		}
		type sold struct{ id, code, status string }
		var cards []sold
		for rows.Next() {
			var c sold
			if err := rows.Scan(&c.id, &c.code, &c.status); err != nil {
				rows.Close()
				return err
			}
			cards = append(cards, c)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, c := range cards {
			var used bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM giftcard.gift_card_ledger
				WHERE card_id = $1 AND direction = 'pakai')`, c.id).Scan(&used); err != nil {
				return err
			}
			if used {
				return &IssuedGiftCardAlreadyUsedError{Code: c.code}
			}
			if c.status != domain.StatusDisabled {
				if _, err := tx.Exec(ctx, `UPDATE giftcard.gift_cards
					SET status = 'disabled', note = COALESCE(note, '') || $2, updated_at = now()
					WHERE id = $1`, c.id, note); err != nil {
					return err
				}
			}
			disabled++
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return disabled, nil
}

/* ── shared card row access ──────────────────────────────────────────── */

// cardRow is CardRow plus the columns reload and adjust read.
type cardRow struct {
	ID            string
	Code          string
	Balance       float64
	Status        string
	ExpiresAt     *time.Time
	InitialValue  float64
	ReloadedTotal float64
}

func (c *cardRow) state() domain.State {
	return domain.State{Status: c.Status, Balance: c.Balance, ExpiresAt: c.ExpiresAt}
}

// lockCard selects one card FOR UPDATE by "id" or "code"; a non-empty
// scope restricts it to the venue. It is nil when no row matches.
func lockCard(ctx context.Context, q database.Querier, column, key string, scope Scope) (*cardRow, error) {
	sql := `SELECT id, code, balance::float8, status, expires_at, initial_value::float8, reloaded_total::float8
		FROM giftcard.gift_cards WHERE ` + column + ` = $1`
	args := []any{key}
	if scope != (Scope{}) {
		sql += ` AND branch_id = $2 AND company_id = $3`
		args = append(args, scope.BranchID, scope.CompanyID)
	}
	var c cardRow
	err := q.QueryRow(ctx, sql+` FOR UPDATE`, args...).Scan(&c.ID, &c.Code, &c.Balance, &c.Status, &c.ExpiresAt, &c.InitialValue, &c.ReloadedTotal)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func updateCard(ctx context.Context, q database.Querier, id string, balance float64, status string) error {
	_, err := q.Exec(ctx, `UPDATE giftcard.gift_cards SET balance = $2, status = $3, updated_at = now() WHERE id = $1`,
		id, balance, status)
	return err
}
