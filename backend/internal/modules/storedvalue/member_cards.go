package storedvalue

import (
	"context"
	"encoding/json"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Member NFC cards and balance refund requests (api/pos/member-cards/**,
// api/pos/member-refunds/**). Unlinking only clears the card link; the
// refund flow records a request first and zeroes the ARK balance only when
// Finance completes it with a supervisor PIN.

type memberCards struct {
	db          database.DB
	supervisors Supervisors
	now         func() time.Time
	log         *slog.Logger
}

type cardMember struct {
	ID             string        `json:"id"`
	Name           *string       `json:"name"`
	Phone          string        `json:"phone"`
	Email          *string       `json:"email"`
	MembershipTier *string       `json:"membership_tier"`
	MemberType     string        `json:"member_type"`
	ArkCoinBalance *string       `json:"ark_coin_balance"`
	TotalXP        *int          `json:"total_xp"`
	NfcUID         *string       `json:"nfc_uid"`
	CardIssuedAt   *httpx.JSTime `json:"card_issued_at"`
}

type unlinkLog struct {
	ID              string       `json:"id"`
	CustomerID      string       `json:"customer_id"`
	Name            *string      `json:"name"`
	Phone           string       `json:"phone"`
	NfcUID          string       `json:"nfc_uid"`
	Reason          string       `json:"reason"`
	Notes           *string      `json:"notes"`
	BalanceAtUnlink string       `json:"balance_at_unlink"`
	UnlinkedByName  *string      `json:"unlinked_by_name"`
	CreatedAt       httpx.JSTime `json:"created_at"`
}

type refundRequest struct {
	ID              string        `json:"id"`
	CustomerID      string        `json:"customer_id"`
	Name            *string       `json:"name"`
	Phone           string        `json:"phone"`
	CurrentBalance  *string       `json:"current_balance"`
	Status          string        `json:"status"`
	RequestedAmount string        `json:"requested_amount"`
	RefundedAmount  *string       `json:"refunded_amount"`
	Notes           *string       `json:"notes"`
	RequestedByName *string       `json:"requested_by_name"`
	RequestedAt     httpx.JSTime  `json:"requested_at"`
	CompletedByName *string       `json:"completed_by_name"`
	ApprovedByName  *string       `json:"approved_by_name"`
	CompletedAt     *httpx.JSTime `json:"completed_at"`
	CompletionNotes *string       `json:"completion_notes"`
	CancelledByName *string       `json:"cancelled_by_name"`
	CancelledAt     *httpx.JSTime `json:"cancelled_at"`
	CancelReason    *string       `json:"cancel_reason"`
}

// CardOverview is GET /api/pos/member-cards.
type CardOverview struct {
	Members        []cardMember    `json:"members"`
	RecentUnlinks  []unlinkLog     `json:"recent_unlinks"`
	RefundRequests []refundRequest `json:"refund_requests"`
}

// Overview lists linked members (one exact match when a card is tapped),
// the last 20 unlinks and the refund requests (open ones first).
func (c *memberCards) Overview(ctx context.Context, search, nfcUID string) (*CardOverview, error) {
	where := []string{"c.is_active = true", "c.nfc_uid IS NOT NULL"}
	var args []any
	limit := 300
	switch {
	case nfcUID != "":
		args = append(args, nfcUID)
		where = append(where, "upper(c.nfc_uid) = upper($1)")
		limit = 1
	case search != "":
		args = append(args, "%"+search+"%")
		where = append(where, "(c.name ILIKE $1 OR c.phone ILIKE $1 OR c.nfc_uid ILIKE $1)")
	}
	rows, err := c.db.Query(ctx,
		`SELECT c.id, c.name, c.phone, c.email, c.membership_tier, c.member_type,
		        c.ark_coin_balance::text, c.total_xp, c.nfc_uid, c.card_issued_at
		   FROM pos.pos_customers c
		  WHERE `+strings.Join(where, " AND ")+`
		  ORDER BY c.name NULLS LAST, c.phone
		  LIMIT `+strconv.Itoa(limit), args...)
	if err != nil {
		return nil, err
	}
	out := &CardOverview{}
	out.Members, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (cardMember, error) {
		var m cardMember
		var issued *time.Time
		err := r.Scan(&m.ID, &m.Name, &m.Phone, &m.Email, &m.MembershipTier, &m.MemberType, &m.ArkCoinBalance, &m.TotalXP, &m.NfcUID, &issued)
		m.CardIssuedAt = httpx.NewJSTime(issued)
		return m, err
	})
	if err != nil {
		return nil, err
	}
	rows, err = c.db.Query(ctx,
		`SELECT l.id, l.customer_id, c.name, c.phone, l.nfc_uid, l.reason, l.notes,
		        l.balance_at_unlink::text, l.unlinked_by_name, l.created_at
		   FROM pos.pos_card_unlink_logs l
		   JOIN pos.pos_customers c ON c.id = l.customer_id
		  ORDER BY l.created_at DESC
		  LIMIT 20`)
	if err != nil {
		return nil, err
	}
	out.RecentUnlinks, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (unlinkLog, error) {
		var l unlinkLog
		var at time.Time
		err := r.Scan(&l.ID, &l.CustomerID, &l.Name, &l.Phone, &l.NfcUID, &l.Reason, &l.Notes, &l.BalanceAtUnlink, &l.UnlinkedByName, &at)
		l.CreatedAt = httpx.JSTime(at)
		return l, err
	})
	if err != nil {
		return nil, err
	}
	// Open requests waiting for Finance first, then the latest.
	rows, err = c.db.Query(ctx,
		`SELECT r.id, r.customer_id, c.name, c.phone, c.ark_coin_balance::text AS current_balance,
		        r.status, r.requested_amount::text, r.refunded_amount::text, r.notes,
		        r.requested_by_name, r.requested_at, r.completed_by_name, r.approved_by_name,
		        r.completed_at, r.completion_notes, r.cancelled_by_name, r.cancelled_at, r.cancel_reason
		   FROM pos.pos_member_refund_requests r
		   JOIN pos.pos_customers c ON c.id = r.customer_id
		  ORDER BY (r.status = 'requested') DESC, r.requested_at DESC
		  LIMIT 50`)
	if err != nil {
		return nil, err
	}
	out.RefundRequests, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (refundRequest, error) {
		var q refundRequest
		var requested time.Time
		var completed, cancelled *time.Time
		err := r.Scan(&q.ID, &q.CustomerID, &q.Name, &q.Phone, &q.CurrentBalance, &q.Status, &q.RequestedAmount,
			&q.RefundedAmount, &q.Notes, &q.RequestedByName, &requested, &q.CompletedByName, &q.ApprovedByName,
			&completed, &q.CompletionNotes, &q.CancelledByName, &cancelled, &q.CancelReason)
		q.RequestedAt = httpx.JSTime(requested)
		q.CompletedAt, q.CancelledAt = httpx.NewJSTime(completed), httpx.NewJSTime(cancelled)
		return q, err
	})
	if err != nil {
		return nil, err
	}
	if out.Members == nil {
		out.Members = []cardMember{}
	}
	if out.RecentUnlinks == nil {
		out.RecentUnlinks = []unlinkLog{}
	}
	if out.RefundRequests == nil {
		out.RefundRequests = []refundRequest{}
	}
	return out, nil
}

// actorProfile is the cashier's configuration.users name and venue.
type actorProfile struct {
	Name      string
	CompanyID *string
	BranchID  *string
}

// cardActor reads the profile auth already loaded from configuration.users.
func cardActor(u *auth.User) actorProfile {
	a := actorProfile{Name: "Kasir", CompanyID: u.CompanyID, BranchID: u.BranchID}
	if n := strings.TrimSpace(u.FullName); n != "" {
		a.Name = n
	}
	return a
}

// linkedCustomer is the member row an unlink locks.
type linkedCustomer struct {
	ID      string
	Name    *string
	Phone   string
	NfcUID  *string
	Balance float64
}

func lockLinkedCustomer(ctx context.Context, q database.Querier, id string) (*linkedCustomer, error) {
	var c linkedCustomer
	var balance *string
	err := q.QueryRow(ctx,
		`SELECT id, name, phone, nfc_uid, ark_coin_balance::text
		   FROM pos.pos_customers WHERE id = $1 AND is_active FOR UPDATE`, id).Scan(&c.ID, &c.Name, &c.Phone, &c.NfcUID, &balance)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Member tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	if c.NfcUID == nil {
		return nil, httpx.BadRequest("Member ini tidak punya kartu yang tertaut")
	}
	c.Balance = domain.ToNumber(kit.Deref(balance))
	return &c, nil
}

type cardCustomerView struct {
	ID             string  `json:"id"`
	Name           *string `json:"name"`
	Phone          string  `json:"phone"`
	ArkCoinBalance float64 `json:"ark_coin_balance"`
}

// UnlinkResult is the unlink route's data.
type UnlinkResult struct {
	Customer       cardCustomerView `json:"customer"`
	PreviousNfcUID string           `json:"previous_nfc_uid"`
	Reason         string           `json:"reason"`
	Notes          *string          `json:"notes"`
	UnlinkedByName string           `json:"unlinked_by_name"`
	LogID          string           `json:"log_id"`
}

// Unlink releases the card (lost or returned); balance, XP, tier and
// member type stay. Every unlink is logged with its reason and actor.
func (c *memberCards) Unlink(ctx context.Context, customerID, reason string, notes *string, userID string, actor actorProfile) (*UnlinkResult, error) {
	var out *UnlinkResult
	err := database.WithTx(ctx, c.db, func(tx pgx.Tx) error {
		cust, err := lockLinkedCustomer(ctx, tx, customerID)
		if err != nil {
			return err
		}
		var logID string
		if err := tx.QueryRow(ctx,
			`INSERT INTO pos.pos_card_unlink_logs
			   (customer_id, nfc_uid, reason, notes, balance_at_unlink, unlinked_by, unlinked_by_name)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 RETURNING id`, cust.ID, *cust.NfcUID, reason, notes, cust.Balance, userID, actor.Name).Scan(&logID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE pos.pos_customers SET nfc_uid = NULL, card_issued_at = NULL, updated_at = now() WHERE id = $1`, cust.ID); err != nil {
			return err
		}
		out = &UnlinkResult{
			Customer:       cardCustomerView{ID: cust.ID, Name: cust.Name, Phone: cust.Phone, ArkCoinBalance: cust.Balance},
			PreviousNfcUID: *cust.NfcUID, Reason: reason, Notes: notes, UnlinkedByName: actor.Name, LogID: logID,
		}
		return nil
	})
	return out, err
}

// RefundRequestResult is the refund route's data.
type RefundRequestResult struct {
	RequestID       string           `json:"request_id"`
	RequestedAt     httpx.JSTime     `json:"requested_at"`
	Customer        cardCustomerView `json:"customer"`
	PreviousNfcUID  string           `json:"previous_nfc_uid"`
	RequestedByName string           `json:"requested_by_name"`
}

// RequestRefund unlinks the card (reason "refund") and records a refund
// request for the current balance; the balance itself does not move yet.
func (c *memberCards) RequestRefund(ctx context.Context, customerID string, notes *string, userID string, actor actorProfile) (*RefundRequestResult, error) {
	var out *RefundRequestResult
	err := database.WithTx(ctx, c.db, func(tx pgx.Tx) error {
		cust, err := lockLinkedCustomer(ctx, tx, customerID)
		if err != nil {
			return err
		}
		var open string
		err = tx.QueryRow(ctx, `SELECT id FROM pos.pos_member_refund_requests WHERE customer_id = $1 AND status = 'requested'`, cust.ID).Scan(&open)
		switch {
		case err == nil:
			return httpx.Conflict("Member ini sudah punya permintaan refund yang belum selesai")
		case !database.IsNoRows(err):
			return err
		}
		var logID string
		if err := tx.QueryRow(ctx,
			`INSERT INTO pos.pos_card_unlink_logs
			   (customer_id, nfc_uid, reason, notes, balance_at_unlink, unlinked_by, unlinked_by_name)
			 VALUES ($1, $2, 'refund', $3, $4, $5, $6) RETURNING id`,
			cust.ID, *cust.NfcUID, notes, cust.Balance, userID, actor.Name).Scan(&logID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE pos.pos_customers SET nfc_uid = NULL, card_issued_at = NULL, updated_at = now() WHERE id = $1`, cust.ID); err != nil {
			return err
		}
		out = &RefundRequestResult{
			Customer:       cardCustomerView{ID: cust.ID, Name: cust.Name, Phone: cust.Phone, ArkCoinBalance: cust.Balance},
			PreviousNfcUID: *cust.NfcUID, RequestedByName: actor.Name,
		}
		var at time.Time
		if err := tx.QueryRow(ctx,
			`INSERT INTO pos.pos_member_refund_requests
			   (customer_id, unlink_log_id, status, requested_amount, notes, requested_by, requested_by_name, company_id, branch_id)
			 VALUES ($1, $2, 'requested', $3, $4, $5, $6, $7, $8) RETURNING id, requested_at`,
			cust.ID, logID, cust.Balance, notes, userID, actor.Name, actor.CompanyID, actor.BranchID).Scan(&out.RequestID, &at); err != nil {
			return err
		}
		out.RequestedAt = httpx.JSTime(at)
		return nil
	})
	return out, err
}

// CancelRefund cancels an open request; the balance does not change.
func (c *memberCards) CancelRefund(ctx context.Context, id string, reason *string, userID string, actor actorProfile) (bool, error) {
	tag, err := c.db.Exec(ctx,
		`UPDATE pos.pos_member_refund_requests
		    SET status = 'cancelled', cancelled_by = $2, cancelled_by_name = $3, cancelled_at = now(),
		        cancel_reason = $4, updated_at = now()
		  WHERE id = $1 AND status = 'requested' RETURNING id`, id, userID, actor.Name, reason)
	return tag.RowsAffected() > 0, err
}

type refundCustomer struct {
	ID    string  `json:"id"`
	Name  *string `json:"name"`
	Phone string  `json:"phone"`
}

// RefundCompletion is the complete route's data.
type RefundCompletion struct {
	RequestID           string         `json:"request_id"`
	Customer            refundCustomer `json:"customer"`
	RefundedAmount      float64        `json:"refunded_amount"`
	BalanceAfter        float64        `json:"balance_after"`
	WalletTransactionID string         `json:"wallet_transaction_id"`
	ApprovedByName      string         `json:"approved_by_name"`
}

// CompleteRefund: Finance returned the money, so the request completes and
// the member's ARK balance goes to 0 through a 'withdrawal' wallet row,
// with the request and the member locked. XP is not touched.
func (c *memberCards) CompleteRefund(ctx context.Context, id string, notes *string, userID string, actor actorProfile, approver ApprovedSupervisor) (*RefundCompletion, error) {
	var out *RefundCompletion
	err := database.WithTx(ctx, c.db, func(tx pgx.Tx) error {
		var customerID, status, requested string
		var company, branch *string
		err := tx.QueryRow(ctx,
			`SELECT id, customer_id, status, requested_amount::text, company_id, branch_id
			   FROM pos.pos_member_refund_requests WHERE id = $1 FOR UPDATE`, id).
			Scan(&id, &customerID, &status, &requested, &company, &branch)
		if database.IsNoRows(err) {
			return httpx.NotFound("Permintaan refund tidak ditemukan")
		}
		if err != nil {
			return err
		}
		if status != "requested" {
			word := "dibatalkan"
			if status == "completed" {
				word = "selesai"
			}
			return httpx.Conflict("Permintaan ini sudah " + word)
		}
		var cust refundCustomer
		var balance *string
		err = tx.QueryRow(ctx, `SELECT id, name, phone, ark_coin_balance::text FROM pos.pos_customers WHERE id = $1 FOR UPDATE`, customerID).
			Scan(&cust.ID, &cust.Name, &cust.Phone, &balance)
		if database.IsNoRows(err) {
			return httpx.NotFound("Member tidak ditemukan")
		}
		if err != nil {
			return err
		}
		before := domain.ToNumber(kit.Deref(balance))
		meta, _ := json.Marshal(map[string]any{
			"refund_request_id": id, "requested_amount": domain.ToNumber(requested),
			"approved_by_id": approver.ID, "approved_by_name": approver.Name,
			"completed_by_id": userID, "completed_by_name": actor.Name, "xp_awarded": false,
		})
		var txID string
		if err := tx.QueryRow(ctx,
			`INSERT INTO pos.pos_wallet_transactions
			   (customer_id, type, amount, ark_coins, balance_before, balance_after, payment_method, status, notes, metadata, company_id, branch_id)
			 VALUES ($1, $2, $3, $3, $4, 0, $5, 'completed', $6, $7::jsonb, $8, $9) RETURNING id`,
			cust.ID, domain.RefundWalletType, before, before, domain.RefundWalletMethod,
			domain.BuildRefundWalletNotes(approver.Name, id), string(meta), company, branch).Scan(&txID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_customers SET ark_coin_balance = 0, updated_at = now() WHERE id = $1`, cust.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE pos.pos_member_refund_requests
			    SET status = 'completed', refunded_amount = $2, completed_by = $3, completed_by_name = $4,
			        approved_by_id = $5, approved_by_name = $6, completed_at = now(), completion_notes = $7,
			        wallet_transaction_id = $8, updated_at = now()
			  WHERE id = $1`, id, before, userID, actor.Name, approver.ID, approver.Name, notes, txID); err != nil {
			return err
		}
		out = &RefundCompletion{RequestID: id, Customer: cust, RefundedAmount: before, WalletTransactionID: txID, ApprovedByName: approver.Name}
		return nil
	})
	return out, err
}
