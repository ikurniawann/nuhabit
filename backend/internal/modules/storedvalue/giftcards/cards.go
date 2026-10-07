package giftcards

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	svdomain "nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/modules/storedvalue/giftcards/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// The till and back-office operations of lib/giftcard/giftcard-server.ts
// and lib/promo/gift-cards-server.ts. pos.pos_customers is read as the
// shared member table (name and phone), as platform/members does.

/* ── POS balance check ───────────────────────────────────────────────── */

// previewOK and previewRejected are the two GiftCardPreview shapes.
type previewOK struct {
	OK        bool          `json:"ok"`
	Code      string        `json:"code"`
	Balance   float64       `json:"balance"`
	Covers    bool          `json:"covers"`
	ExpiresAt *httpx.JSTime `json:"expires_at"`
}

type previewRejected struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason"`
}

// Preview is previewGiftCardForPos: an indicative check of the exact code
// typed (no partial search); the locked debit decides for real. It returns
// the JSON-ready preview and, when rejected, the reason.
func (s *Service) Preview(ctx context.Context, scope Scope, code string, total float64) (any, string, error) {
	var c cardRow
	err := s.db.QueryRow(ctx, `SELECT id, code, balance::float8, status, expires_at
		FROM giftcard.gift_cards
		WHERE branch_id = $1 AND company_id = $2 AND code = $3`,
		scope.BranchID, scope.CompanyID, domain.NormalizeCode(code)).Scan(&c.ID, &c.Code, &c.Balance, &c.Status, &c.ExpiresAt)
	if database.IsNoRows(err) {
		return previewRejected{Reason: "Gift card tidak ditemukan"}, "Gift card tidak ditemukan", nil
	}
	if err != nil {
		return nil, "", err
	}
	// An empty cart (total 0) still has to pass the status and expiry
	// guards, so it is evaluated with one rupiah.
	amount := 1.0
	if total > 0 {
		balance := c.Balance
		if balance == 0 {
			balance = 1
		}
		amount = min(total, balance)
	}
	if ev := domain.EvaluateRedeem(c.state(), amount, s.now()); !ev.OK {
		reason := domain.RedeemMessages[ev.Reason]
		return previewRejected{Reason: reason}, reason, nil
	}
	return previewOK{OK: true, Code: c.Code, Balance: c.Balance, Covers: c.Balance >= total, ExpiresAt: httpx.NewJSTime(c.ExpiresAt)}, "", nil
}

/* ── reload (top up with a recorded payment) ─────────────────────────── */

// ReloadInput is reloadGiftCard's input: the card by ID (back office) or
// by Code (till, typed or scanned).
type ReloadInput struct {
	Scope            Scope
	ID, Code         string
	Amount           float64
	PaymentMethod    string
	PaymentReference *string
	Note             *string
	CreatedBy        string
}

// ReloadResult is the ok branch of GiftCardReloadOutcome.
type ReloadResult struct {
	OK           bool    `json:"ok"`
	LedgerID     string  `json:"ledgerId"`
	BalanceAfter float64 `json:"balanceAfter"`
	StatusAfter  string  `json:"statusAfter"`
}

// Reload is reloadGiftCard: lock the card FOR UPDATE, evaluate, raise
// balance and reloaded_total, and write an 'isi' ledger row with context
// 'reload' and the payment. A rejection is an *httpx.Error (400 or 404).
func (s *Service) Reload(ctx context.Context, in ReloadInput) (*ReloadResult, error) {
	column, key := "id", in.ID
	if in.ID == "" {
		column, key = "code", domain.NormalizeCode(in.Code)
	}
	var out *ReloadResult
	err := atomic(ctx, s.db, func(tx database.Querier) error {
		card, err := lockCard(ctx, tx, column, key, in.Scope)
		if err != nil {
			return err
		}
		if card == nil {
			return httpx.NotFound("Gift card tidak ditemukan")
		}
		ev := domain.EvaluateReload(card.state(), card.ReloadedTotal, in.Amount, s.now())
		if !ev.OK {
			return httpx.BadRequest(domain.ReloadMessages[ev.Reason])
		}
		if _, err := tx.Exec(ctx, `UPDATE giftcard.gift_cards
			SET balance = $2, reloaded_total = $3, status = $4, updated_at = now()
			WHERE id = $1`, card.ID, ev.BalanceAfter, ev.ReloadedTotalAfter, ev.StatusAfter); err != nil {
			return err
		}
		note := "Reload saldo (" + domain.ReloadPaymentLabels[in.PaymentMethod] + ")"
		if in.Note != nil {
			note = *in.Note
		}
		out = &ReloadResult{OK: true, BalanceAfter: ev.BalanceAfter, StatusAfter: ev.StatusAfter}
		return tx.QueryRow(ctx, `INSERT INTO giftcard.gift_card_ledger
			  (company_id, branch_id, card_id, direction, amount, balance_after,
			   context_type, payment_method, payment_reference, note, created_by)
			VALUES ($1, $2, $3, 'isi', $4, $5, 'reload', $6, $7, $8, $9)
			RETURNING id`,
			in.Scope.CompanyID, in.Scope.BranchID, card.ID, in.Amount, ev.BalanceAfter,
			in.PaymentMethod, in.PaymentReference, note, kit.NullIfEmpty(in.CreatedBy)).Scan(&out.LedgerID)
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

/* ── manual correction (audited) ─────────────────────────────────────── */

// AdjustResult is the ok branch of GiftCardAdjustOutcome.
type AdjustResult struct {
	OK           bool    `json:"ok"`
	BalanceAfter float64 `json:"balanceAfter"`
	StatusAfter  string  `json:"statusAfter"`
}

// Adjust is adjustGiftCardBalance: a signed correction by an admin, the
// card locked FOR UPDATE so it cannot race a till debit. The balance may
// not go below zero nor above what was ever loaded (initial + reloads).
// A rejection is an *httpx.Error (400 or 404).
func (s *Service) Adjust(ctx context.Context, scope Scope, cardID string, delta float64, reason, createdBy string) (*AdjustResult, error) {
	delta = svdomain.RoundIdr(delta)
	if delta == 0 {
		return nil, httpx.BadRequest("Nominal koreksi tidak boleh 0")
	}
	var out *AdjustResult
	err := atomic(ctx, s.db, func(tx database.Querier) error {
		card, err := lockCard(ctx, tx, "id", cardID, scope)
		if err != nil {
			return err
		}
		if card == nil {
			return httpx.NotFound("Gift card tidak ditemukan")
		}
		balanceAfter, err := domain.BalanceAfterCorrection(card.Balance, delta)
		if err != nil {
			return httpx.BadRequest("Koreksi membuat saldo negatif")
		}
		if balanceAfter > card.InitialValue+card.ReloadedTotal {
			return httpx.BadRequest("Koreksi tidak boleh melebihi total nilai yang pernah diisi — pakai Reload")
		}
		statusAfter := domain.StatusAfterRefund(card.Status, balanceAfter)
		if err := updateCard(ctx, tx, card.ID, balanceAfter, statusAfter); err != nil {
			return err
		}
		out = &AdjustResult{OK: true, BalanceAfter: balanceAfter, StatusAfter: statusAfter}
		_, err = tx.Exec(ctx, `INSERT INTO giftcard.gift_card_ledger
			  (company_id, branch_id, card_id, direction, amount, balance_after,
			   context_type, note, created_by)
			VALUES ($1, $2, $3, 'koreksi', $4, $5, 'manual', $6, $7)`,
			scope.CompanyID, scope.BranchID, card.ID, delta, balanceAfter, reason, kit.NullIfEmpty(createdBy))
		return err
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

/* ── back-office list, issue, ledger, toggle, member link ────────────── */

// CardRow is GiftCardRow (numeric columns as node-postgres strings).
type CardRow struct {
	ID            string        `json:"id"`
	Code          string        `json:"code"`
	InitialValue  string        `json:"initial_value"`
	Balance       string        `json:"balance"`
	Status        string        `json:"status"`
	ExpiresAt     *httpx.JSTime `json:"expires_at"`
	SourceType    string        `json:"source_type"`
	BuyerName     *string       `json:"buyer_name"`
	BuyerPhone    *string       `json:"buyer_phone"`
	Note          *string       `json:"note"`
	CreatedAt     httpx.JSTime  `json:"created_at"`
	ReloadedTotal string        `json:"reloaded_total"`
	CustomerID    *string       `json:"customer_id"`
	CustomerName  *string       `json:"customer_name"`
	CustomerPhone *string       `json:"customer_phone"`
}

// ListFilters is GiftCardFilters ("" = not set).
type ListFilters struct {
	Status, Q, CustomerID, Phone string
}

// List is listGiftCards: the venue's cards, newest first, at most 500.
func (s *Service) List(ctx context.Context, scope Scope, f ListFilters) ([]CardRow, error) {
	conds := []string{"g.branch_id = $1", "g.company_id = $2"}
	args := []any{scope.BranchID, scope.CompanyID}
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, strings.ReplaceAll(cond, "$n", "$"+strconv.Itoa(len(args))))
	}
	if f.Status != "" {
		add("g.status = $n", f.Status)
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		add("g.code LIKE $n", "%"+strings.ToUpper(q)+"%")
	}
	if f.CustomerID != "" {
		add("g.customer_id = $n", f.CustomerID)
	}
	if digits := domain.PhoneMatchKey(f.Phone); len(digits) >= 6 {
		add("("+domain.PhoneMatchKeySQL("c.phone")+" LIKE $n OR "+domain.PhoneMatchKeySQL("g.buyer_phone")+" LIKE $n)", digits+"%")
	}
	rows, err := s.db.Query(ctx, `SELECT g.id, g.code, g.initial_value::text, g.balance::text, g.status, g.expires_at,
			g.source_type, g.buyer_name, g.buyer_phone, g.note, g.created_at,
			g.reloaded_total::text, g.customer_id,
			c.name AS customer_name, c.phone AS customer_phone
		FROM giftcard.gift_cards g
		LEFT JOIN pos.pos_customers c ON c.id = g.customer_id
		WHERE `+strings.Join(conds, " AND ")+`
		ORDER BY g.created_at DESC
		LIMIT 500`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (CardRow, error) {
		var c CardRow
		var exp *time.Time
		var created time.Time
		err := row.Scan(&c.ID, &c.Code, &c.InitialValue, &c.Balance, &c.Status, &exp, &c.SourceType,
			&c.BuyerName, &c.BuyerPhone, &c.Note, &created, &c.ReloadedTotal, &c.CustomerID, &c.CustomerName, &c.CustomerPhone)
		c.ExpiresAt, c.CreatedAt = httpx.NewJSTime(exp), httpx.JSTime(created)
		return c, err
	})
}

// IssueRequest is giftCardIssueSchema after validation: Count is 1 for
// mode "single", whose optional fields the batch mode leaves nil.
type IssueRequest struct {
	InitialValue float64
	Count        int
	ExpiresAt    *string
	BuyerName    *string
	BuyerPhone   *string
	Note         *string
	CustomerID   *string
}

// IssuedCode is one created card (id, code).
type IssuedCode struct {
	ID   string `json:"id"`
	Code string `json:"code"`
}

// Issue is issueGiftCards: Count active cards with CSPRNG codes and an
// 'isi' ledger row each. Colliding codes are skipped by ON CONFLICT and
// refilled for up to six rounds (fillUniqueCodes).
func (s *Service) Issue(ctx context.Context, scope Scope, userID string, in IssueRequest) ([]IssuedCode, error) {
	var cards []IssuedCode
	err := atomic(ctx, s.db, func(tx database.Querier) error {
		for round := 0; round < maxCodeRounds && len(cards) < in.Count; round++ {
			candidates := map[string]bool{}
			var batch []string
			for len(batch) < in.Count-len(cards) {
				if code := domain.GenerateCode(); !candidates[code] {
					candidates[code] = true
					batch = append(batch, code)
				}
			}
			rows, err := tx.Query(ctx, `INSERT INTO giftcard.gift_cards
				  (company_id, branch_id, code, initial_value, balance, status,
				   expires_at, source_type, buyer_name, buyer_phone, note, created_by,
				   customer_id)
				SELECT $1, $2, unnest($3::text[]), $4, $4, 'active',
				       $5, 'manual', $6, $7, $8, $9, $10
				ON CONFLICT (branch_id, code) DO NOTHING
				RETURNING id, code`,
				scope.CompanyID, scope.BranchID, batch, in.InitialValue, in.ExpiresAt,
				in.BuyerName, in.BuyerPhone, in.Note, userID, in.CustomerID)
			if err != nil {
				return err
			}
			made, err := pgx.CollectRows(rows, pgx.RowToStructByPos[IssuedCode])
			if err != nil {
				return err
			}
			cards = append(cards, made...)
		}
		if len(cards) < in.Count {
			return httpx.Status(http.StatusInternalServerError,
				"Hanya "+strconv.Itoa(len(cards))+"/"+strconv.Itoa(in.Count)+" gift card berhasil dibuat — coba lagi")
		}
		ids := make([]string, len(cards))
		for i, c := range cards {
			ids[i] = c.ID
		}
		_, err := tx.Exec(ctx, `INSERT INTO giftcard.gift_card_ledger
			  (company_id, branch_id, card_id, direction, amount, balance_after,
			   context_type, created_by)
			SELECT $1, $2, unnest($3::uuid[]), 'isi', $4, $4, 'manual', $5`,
			scope.CompanyID, scope.BranchID, ids, in.InitialValue, userID)
		return err
	})
	return cards, err
}

// LedgerRow is GiftCardLedgerRow (numeric columns as strings).
type LedgerRow struct {
	ID               string       `json:"id"`
	Direction        string       `json:"direction"`
	Amount           string       `json:"amount"`
	BalanceAfter     string       `json:"balance_after"`
	ContextType      *string      `json:"context_type"`
	ContextID        *string      `json:"context_id"`
	Note             *string      `json:"note"`
	PaymentMethod    *string      `json:"payment_method"`
	PaymentReference *string      `json:"payment_reference"`
	CreatedAt        httpx.JSTime `json:"created_at"`
}

// Ledger is loadGiftCardLedger: the card's 500 newest balance movements.
func (s *Service) Ledger(ctx context.Context, scope Scope, id string) ([]LedgerRow, error) {
	if _, err := s.cardStatus(ctx, scope, id); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT id, direction, amount::text, balance_after::text, context_type,
			context_id::text, note, payment_method, payment_reference, created_at
		FROM giftcard.gift_card_ledger
		WHERE card_id = $1
		ORDER BY created_at DESC
		LIMIT 500`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (LedgerRow, error) {
		var l LedgerRow
		var created time.Time
		err := row.Scan(&l.ID, &l.Direction, &l.Amount, &l.BalanceAfter, &l.ContextType, &l.ContextID,
			&l.Note, &l.PaymentMethod, &l.PaymentReference, &created)
		l.CreatedAt = httpx.JSTime(created)
		return l, err
	})
}

// cardStatus is the venue card's status, or a 404.
func (s *Service) cardStatus(ctx context.Context, scope Scope, id string) (string, error) {
	var status string
	err := s.db.QueryRow(ctx, `SELECT status FROM giftcard.gift_cards
		WHERE id = $1 AND branch_id = $2 AND company_id = $3`, id, scope.BranchID, scope.CompanyID).Scan(&status)
	if database.IsNoRows(err) {
		return "", httpx.NotFound("Gift card tidak ditemukan")
	}
	return status, err
}

// CardStatus is the {id, status} the toggle returns.
type CardStatus struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// SetActive is setGiftCardActive: only active <-> disabled; pending,
// exhausted and expired cards follow their own lifecycle (409). The result
// is nil when the card vanished between the read and the update.
func (s *Service) SetActive(ctx context.Context, scope Scope, id string, active bool) (*CardStatus, error) {
	status, err := s.cardStatus(ctx, scope, id)
	if err != nil {
		return nil, err
	}
	if status != domain.StatusActive && status != domain.StatusDisabled {
		return nil, httpx.Conflict("Gift card berstatus '" + status + "' tidak bisa diubah lewat aksi ini")
	}
	next := domain.StatusDisabled
	if active {
		next = domain.StatusActive
	}
	var out CardStatus
	err = s.db.QueryRow(ctx, `UPDATE giftcard.gift_cards
		SET status = $1, updated_at = now()
		WHERE id = $2 AND branch_id = $3 AND company_id = $4
		RETURNING id, status`, next, id, scope.BranchID, scope.CompanyID).Scan(&out.ID, &out.Status)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// Link is linkGiftCardToMember: customerID nil unlinks. False when the card
// is not in the venue or the member does not exist.
func (s *Service) Link(ctx context.Context, scope Scope, cardID string, customerID *string) (bool, error) {
	tag, err := s.db.Exec(ctx, `UPDATE giftcard.gift_cards
		SET customer_id = $1, updated_at = now()
		WHERE id = $2 AND branch_id = $3 AND company_id = $4
		  AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM pos.pos_customers WHERE id = $1::uuid))`,
		customerID, cardID, scope.BranchID, scope.CompanyID)
	return tag.RowsAffected() > 0, err
}

// MemberMatch is GiftCardMemberMatch.
type MemberMatch struct {
	ID    string  `json:"id"`
	Name  *string `json:"name"`
	Phone *string `json:"phone"`
}

// FindMembersByPhone is findMembersByPhone: members whose normalized phone
// starts with the typed digits (0 and 62 prefixes treated alike), at least
// six digits, ten results.
func (s *Service) FindMembersByPhone(ctx context.Context, phone string) ([]MemberMatch, error) {
	digits := domain.PhoneMatchKey(phone)
	if len(digits) < 6 {
		return []MemberMatch{}, nil
	}
	rows, err := s.db.Query(ctx, `SELECT id::text, name, phone FROM pos.pos_customers
		WHERE `+domain.PhoneMatchKeySQL("phone")+` LIKE $1
		ORDER BY name
		LIMIT 10`, digits+"%")
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[MemberMatch])
}
