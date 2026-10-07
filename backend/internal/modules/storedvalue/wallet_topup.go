package storedvalue

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/scope"
)

// Cashier top-ups: QRIS creation, crediting a paid QR, reconciliation with
// Xendit (lib/wallet/topup.ts, lib/pos/topup-credit.ts,
// lib/pos/topup-qris-reconcile.ts) and the select-* rows the pg shim
// returned to the POS routes.

// starRow is `SELECT *` of pos_wallet_transactions through the pg shim:
// table column order, numeric columns as strings.
type starRow struct {
	ID                  string          `json:"id"`
	CustomerID          *string         `json:"customer_id"`
	Type                string          `json:"type"`
	Amount              string          `json:"amount"`
	ArkCoins            string          `json:"ark_coins"`
	BalanceBefore       string          `json:"balance_before"`
	BalanceAfter        string          `json:"balance_after"`
	PaymentMethod       *string         `json:"payment_method"`
	XenditTransactionID *string         `json:"xendit_transaction_id"`
	OrderID             *string         `json:"order_id"`
	ReferenceID         *string         `json:"reference_id"`
	Notes               *string         `json:"notes"`
	CreatedAt           *httpx.JSTime   `json:"created_at"`
	Status              string          `json:"status"`
	Metadata            json.RawMessage `json:"metadata"`
	CompanyID           *string         `json:"company_id"`
	BranchID            *string         `json:"branch_id"`
	ExpiresAt           *httpx.JSTime   `json:"expires_at"`
	ExpiryProcessedAt   *httpx.JSTime   `json:"expiry_processed_at"`
	PackageID           *string         `json:"package_id"`
}

const starColumns = `id, customer_id, type, amount::text, ark_coins::text, balance_before::text, balance_after::text,
  payment_method, xendit_transaction_id, order_id, reference_id, notes, created_at, status, metadata, company_id,
  branch_id, expires_at, expiry_processed_at, package_id`

func (s *starRow) dest() []any {
	return []any{&s.ID, &s.CustomerID, &s.Type, &s.Amount, &s.ArkCoins, &s.BalanceBefore, &s.BalanceAfter,
		&s.PaymentMethod, &s.XenditTransactionID, &s.OrderID, &s.ReferenceID, &s.Notes, &s.CreatedAt, &s.Status,
		&s.Metadata, &s.CompanyID, &s.BranchID, &s.ExpiresAt, &s.ExpiryProcessedAt, &s.PackageID}
}

func scanStar(row pgx.Row) (*starRow, error) {
	var s starRow
	var created, expires, processed *time.Time
	d := s.dest()
	d[12], d[17], d[18] = &created, &expires, &processed
	if err := row.Scan(d...); err != nil {
		return nil, err
	}
	s.CreatedAt, s.ExpiresAt, s.ExpiryProcessedAt = httpx.NewJSTime(created), httpx.NewJSTime(expires), httpx.NewJSTime(processed)
	return &s, nil
}

// pendingQRIS is createPendingQrisTopup's result.
type pendingQRIS struct {
	Transaction *WalletRow
	QRString    string
	ReferenceID string
	XenditQRID  *string
	ExpiresAt   string
}

// qrDisplayTTL is DISPLAY_TTL_MS: a QR without expires_at still gets a
// display deadline.
const qrDisplayTTL = 30 * time.Minute

// createPendingQRIS mirrors createPendingQrisTopup for the cashier (no
// simulated QR): a dynamic Xendit QR and a pending top-up row.
func (w *Wallet) createPendingQRIS(ctx context.Context, customerID string, amount, balanceBefore, arkRate float64,
	venue Venue, callbackURL func(configured string) string, packageMeta map[string]any) (*pendingQRIS, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return nil, err
	}
	referenceID := "topup_" + hex.EncodeToString(b[:])
	cfg, err := w.ports.Gateway.LoadConfig(ctx, w.db)
	if err != nil {
		return nil, httpx.Status(503, "Pembayaran QRIS belum tersedia: "+err.Error())
	}
	qr, err := w.ports.Gateway.CreateDynamicQR(ctx, cfg.SecretKey, referenceID, amount, callbackURL(cfg.CallbackURL),
		"ARK topup "+domain.JSNumber(amount))
	if err != nil {
		return nil, err
	}
	expiresAt := qr.ExpiresAt
	if expiresAt == "" {
		expiresAt = isoString(w.now().Add(qrDisplayTTL))
	}
	var xenditStatus any
	if qr.Status != "" {
		xenditStatus = qr.Status
	}
	meta := map[string]any{
		"provider": "xendit", "environment": cfg.Environment, "qr_string": qr.QRString, "expires_at": expiresAt,
		"xendit_status": xenditStatus, "source": "cashier", "simulated": false,
	}
	var packageID *string
	for k, v := range packageMeta {
		meta[k] = v
	}
	if packageMeta != nil {
		id := domain.JSString(packageMeta["package_id"])
		packageID = &id
	}
	qris := "qris"
	row, err := insertWalletRow(ctx, w.db, newWalletRow{
		CustomerID: customerID, Type: "topup", Status: "pending", Amount: amount,
		BalanceBefore: balanceBefore, BalanceAfter: balanceBefore, ArkRate: arkRate,
		PaymentMethod: &qris, ReferenceID: &referenceID, Notes: "Waiting for QRIS payment", Metadata: meta,
		XenditTransactionID: &qr.ID, PackageID: packageID, CompanyID: venue.CompanyID, BranchID: venue.BranchID,
	})
	if err != nil {
		return nil, err
	}
	return &pendingQRIS{Transaction: row, QRString: qr.QRString, ReferenceID: referenceID, XenditQRID: &qr.ID, ExpiresAt: expiresAt}, nil
}

// creditOutcome is creditPendingTopup's result.
type creditOutcome struct {
	Status        string // completed | already_completed | ignored | not_found
	Transaction   *WalletRow
	BalanceBefore float64
	BalanceAfter  float64
	ArkCoins      float64
	ArkRate       float64
	XPAwarded     float64
}

// creditPendingTopup credits a pending QRIS top-up in one transaction with
// the top-up and member rows locked, so a webhook and a poll arriving
// together credit once; a package top-up also writes its bonus lot. XP is
// awarded after the commit, as the TS does.
func (w *Wallet) creditPendingTopup(ctx context.Context, id, xenditPaymentID, notes string) (creditOutcome, error) {
	settings, err := loadLoyaltySettings(ctx, w.db)
	if err != nil {
		return creditOutcome{}, err
	}
	var out creditOutcome
	var customerID string
	var amount float64
	err = database.WithTx(ctx, w.db, func(tx pgx.Tx) error {
		row, err := scanWalletRow(tx.QueryRow(ctx, `SELECT `+walletColumns+` FROM pos.pos_wallet_transactions WHERE id = $1 FOR UPDATE`, id))
		if database.IsNoRows(err) {
			out.Status = "not_found"
			return nil
		}
		if err != nil {
			return err
		}
		switch status := row.Status; {
		case status == "" || status == "completed":
			out = creditOutcome{Status: "already_completed", Transaction: row, BalanceAfter: row.BalanceAfter}
			return nil
		case status != "pending":
			out = creditOutcome{Status: "ignored", Transaction: row}
			return nil
		}
		customer, err := lockCustomer(ctx, tx, kit.Deref(row.CustomerID))
		if err != nil {
			return err
		}
		amount = row.Amount
		customerID = customer.ID
		arkCoins := domain.IdrToArk(amount, settings.ArkRate)
		before := customer.Balance
		afterTopup := domain.RoundIdr(before + amount)
		now := w.now()
		// A package names its own validity (null = no expiry); a free top-up
		// keeps null so the trigger applies the default validity.
		var expiresAt *time.Time
		if v, has := row.meta["validity_days"]; has {
			if days, isNum := v.(float64); isNum {
				expiresAt = domain.ExpiresAtFor(&days, now)
			}
		}
		if err := setCustomerBalance(ctx, tx, customer.ID, afterTopup); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_customers SET total_spent = COALESCE(total_spent, 0) + $2 WHERE id = $1`,
			customer.ID, amount); err != nil {
			return err
		}
		if notes == "" {
			notes = kit.Deref(row.Notes)
		}
		if notes == "" {
			notes = "Top-up QRIS"
		}
		patch, _ := json.Marshal(map[string]any{"credited_at": isoString(now), "xendit_payment_id": kit.NullIfEmpty(xenditPaymentID)})
		updated, err := scanWalletRow(tx.QueryRow(ctx,
			`UPDATE pos.pos_wallet_transactions
			    SET status = 'completed', ark_coins = $2, balance_before = $3, balance_after = $4, notes = $5,
			        metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb,
			        xendit_transaction_id = COALESCE(NULLIF(xendit_transaction_id, ''), $7),
			        expires_at = COALESCE($8, expires_at)
			  WHERE id = $1
			  RETURNING `+walletColumns,
			row.ID, arkCoins, before, afterTopup, notes, string(patch), kit.NullIfEmpty(xenditPaymentID), expiresAt))
		if err != nil {
			return err
		}
		balanceAfter := afterTopup
		if bonus := max(0, domain.ToNumber(row.meta["bonus_idr"])); bonus > 0 {
			balanceAfter, err = creditTopupBonus(ctx, tx, customer.ID, row.ID, bonus, expiresAt, map[string]any{
				"package_id":    orNull(row.meta, "package_id"),
				"package_name":  orNull(row.meta, "package_name"),
				"validity_days": orNull(row.meta, "validity_days"),
			}, settings.ArkRate, row.CompanyID, row.BranchID)
			if err != nil {
				return err
			}
		}
		out = creditOutcome{Status: "completed", Transaction: updated, BalanceBefore: before, BalanceAfter: balanceAfter,
			ArkCoins: arkCoins, ArkRate: settings.ArkRate}
		return nil
	})
	if err != nil || out.Status != "completed" {
		return out, err
	}
	xp := w.ports.Loyalty.AwardTopupXP(ctx, w.db, customerID, amount, id)
	out.XPAwarded = xp.XPAwarded
	if out.XPAwarded == 0 {
		out.XPAwarded = domain.CalculateTopupXP(amount, settings)
	}
	return out, nil
}

// orNull is `meta[key] ?? null`.
func orNull(meta map[string]any, key string) any {
	if v, has := meta[key]; has {
		return v
	}
	return nil
}

// reconcileRow is the select of reconcilePendingTopup through the pg shim
// (amount as a numeric string).
type reconcileRow struct {
	ID                  string  `json:"id"`
	Status              string  `json:"status"`
	Type                string  `json:"type"`
	PaymentMethod       *string `json:"payment_method"`
	XenditTransactionID *string `json:"xendit_transaction_id"`
	ReferenceID         *string `json:"reference_id"`
	Amount              string  `json:"amount"`
}

// ReconcileOutcome is reconcilePendingTopup's union; the JSON of each
// status has the fields (and order) of the TS object.
type ReconcileOutcome struct {
	Status        string
	Transaction   any
	BalanceBefore float64
	BalanceAfter  float64
	ArkCoins      float64
	ArkRate       float64
	XPAwarded     float64
	PaymentID     string
	Detail        string
}

// MarshalJSON writes the TS object of the outcome's status.
func (o ReconcileOutcome) MarshalJSON() ([]byte, error) {
	switch o.Status {
	case "credited":
		return json.Marshal(struct {
			Status        string  `json:"status"`
			BalanceBefore float64 `json:"balance_before"`
			BalanceAfter  float64 `json:"balance_after"`
			ArkCoins      float64 `json:"ark_coins"`
			ArkRate       float64 `json:"ark_rate"`
			XPAwarded     float64 `json:"xp_awarded"`
			Transaction   any     `json:"transaction"`
			PaymentID     string  `json:"payment_id"`
		}{o.Status, o.BalanceBefore, o.BalanceAfter, o.ArkCoins, o.ArkRate, o.XPAwarded, o.Transaction, o.PaymentID})
	case "already_completed":
		return json.Marshal(struct {
			Status       string  `json:"status"`
			Transaction  any     `json:"transaction"`
			BalanceAfter float64 `json:"balance_after"`
		}{o.Status, o.Transaction, o.BalanceAfter})
	case "pending", "error":
		return json.Marshal(struct {
			Status string `json:"status"`
			Detail string `json:"detail"`
		}{o.Status, o.Detail})
	}
	return json.Marshal(struct {
		Status string `json:"status"`
	}{o.Status})
}

// ReconcilePendingTopup mirrors reconcilePendingTopup: the QR's payment
// list at Xendit is the source of truth, the QR object a fallback; a paid
// QR is credited through creditPendingTopup (idempotent).
func (w *Wallet) ReconcilePendingTopup(ctx context.Context, id string) (ReconcileOutcome, error) {
	var tx reconcileRow
	err := w.db.QueryRow(ctx,
		`SELECT id, status, type, payment_method, xendit_transaction_id, reference_id, amount::text
		   FROM pos.pos_wallet_transactions WHERE id = $1`, id).
		Scan(&tx.ID, &tx.Status, &tx.Type, &tx.PaymentMethod, &tx.XenditTransactionID, &tx.ReferenceID, &tx.Amount)
	if database.IsNoRows(err) {
		return ReconcileOutcome{Status: "not_found"}, nil
	}
	if err != nil {
		return ReconcileOutcome{Status: "error", Detail: kit.ErrorMessage(err)}, nil
	}
	if tx.Status == "completed" {
		return ReconcileOutcome{Status: "already_completed", Transaction: tx}, nil
	}
	if tx.Status != "pending" || strings.ToLower(kit.Deref(tx.PaymentMethod)) != "qris" {
		return ReconcileOutcome{Status: "not_qris"}, nil
	}
	qrID := kit.Deref(tx.XenditTransactionID)
	if qrID == "" {
		return ReconcileOutcome{Status: "pending", Detail: "QR id Xendit tidak tercatat"}, nil
	}
	cfg, err := w.ports.Gateway.LoadConfig(ctx, w.db)
	if err != nil {
		return ReconcileOutcome{Status: "error", Detail: err.Error()}, nil
	}
	paymentID, paid := "", false
	if rows, err := w.ports.Gateway.QRPayments(ctx, cfg.SecretKey, qrID); err == nil {
		paymentID, _, paid = domain.PickPaidXenditPayment(rows)
	} else {
		w.log.Warn("[topup-reconcile] gagal baca payments QR", "qr", qrID, "error", err.Error())
	}
	if !paid {
		if remote, err := w.ports.Gateway.QRCode(ctx, cfg.SecretKey, qrID); err == nil {
			if domain.IsXenditQrPaid(remote) {
				paymentID = domain.JSOr(remote["payment_id"])
				if paymentID == "" {
					paymentID = domain.JSOr(remote["id"])
				}
				paid = true
			}
		} else {
			w.log.Warn("[topup-reconcile] gagal baca QR", "qr", qrID, "error", err.Error())
		}
	}
	if !paid {
		return ReconcileOutcome{Status: "pending", Detail: "Belum ada pembayaran berhasil tercatat di Xendit"}, nil
	}
	credited, err := w.creditPendingTopup(ctx, id, paymentID, "Top-up QRIS (rekonsiliasi Xendit)")
	if err != nil {
		return ReconcileOutcome{}, err
	}
	switch credited.Status {
	case "completed":
		w.log.Info("[topup-reconcile] topup dikredit", "topup", id, "payment", paymentID)
		return ReconcileOutcome{Status: "credited", BalanceBefore: credited.BalanceBefore, BalanceAfter: credited.BalanceAfter,
			ArkCoins: credited.ArkCoins, ArkRate: credited.ArkRate, XPAwarded: credited.XPAwarded,
			Transaction: credited.Transaction, PaymentID: paymentID}, nil
	case "already_completed":
		return ReconcileOutcome{Status: "already_completed", Transaction: credited.Transaction, BalanceAfter: credited.BalanceAfter}, nil
	}
	return ReconcileOutcome{Status: "pending", Detail: "Status transaksi " + credited.Status}, nil
}

// resolveTopupVenue mirrors lib/pos/topup-venue.ts: the cashier's branch
// (company derived from the branch when missing), else the CRM default
// venue; never fails.
func (w *Wallet) resolveTopupVenue(ctx context.Context, userID string) Venue {
	sc, err := scope.Load(ctx, w.db, userID)
	if err != nil {
		w.log.Error("[pos] resolveTopupVenue gagal — topup tetap diproses tanpa venue", "error", err.Error())
		return Venue{}
	}
	fallback := w.ports.Directory.DefaultVenue(ctx, w.db)
	picked := Venue{CompanyID: fallback.CompanyID, BranchID: fallback.BranchID}
	if sc.BranchID != nil || sc.CompanyID != nil {
		picked = Venue{CompanyID: sc.CompanyID, BranchID: sc.BranchID}
	}
	if picked.BranchID != nil && picked.CompanyID == nil {
		company, err := w.ports.Directory.BranchCompany(ctx, w.db, *picked.BranchID)
		if err != nil {
			w.log.Error("[pos] resolveTopupVenue gagal — topup tetap diproses tanpa venue", "error", err.Error())
			return Venue{}
		}
		return Venue{CompanyID: company, BranchID: picked.BranchID}
	}
	return picked
}
