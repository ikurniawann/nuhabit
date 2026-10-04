package memberportal

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/jsmath"
)

// sqlWallet ports the member top-up side of lib/wallet (server.ts,
// topup.ts, member-topup.ts) and lib/pos/topup-credit.ts on
// pos.pos_wallet_transactions and pos_customers.ark_coin_balance.
type sqlWallet struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

const walletColumns = `id, customer_id, type, status, amount::float, balance_before::float, balance_after::float,
  xendit_transaction_id, notes, metadata, created_at, company_id, branch_id`

func scanWalletRow(row pgx.Row) (*WalletRow, error) {
	var w WalletRow
	var customerID *string
	var raw []byte
	err := row.Scan(&w.ID, &customerID, &w.Type, &w.Status, &w.Amount, &w.BalanceBefore, &w.BalanceAfter,
		&w.XenditTransactionID, &w.Notes, &raw, &w.CreatedAt, &w.CompanyID, &w.BranchID)
	if err != nil {
		return nil, err
	}
	if customerID != nil {
		w.CustomerID = *customerID
	}
	w.Metadata = map[string]any{}
	_ = json.Unmarshal(raw, &w.Metadata)
	if w.Metadata == nil {
		w.Metadata = map[string]any{}
	}
	return &w, nil
}

// Settings mirrors loadWalletSettings: defaults overlaid by the active row.
func (w *sqlWallet) Settings(ctx context.Context) (WalletSettings, error) {
	s := WalletSettings{ArkRate: 1000, TopupMinAmount: 10_000, TopupMaxAmount: 10_000_000}
	err := w.pool.QueryRow(ctx,
		`SELECT ark_rate::float, topup_min_amount::float, topup_max_amount::float
		   FROM pos.pos_loyalty_settings WHERE is_active ORDER BY updated_at DESC LIMIT 1`).
		Scan(&s.ArkRate, &s.TopupMinAmount, &s.TopupMaxAmount)
	if database.IsNoRows(err) {
		return WalletSettings{ArkRate: 1000, TopupMinAmount: 10_000, TopupMaxAmount: 10_000_000}, nil
	}
	return s, err
}

func (w *sqlWallet) LoyaltySettings(ctx context.Context) (domain.LoyaltySettings, error) {
	return loadLoyaltySettings(ctx, w.pool)
}

// ArkCoinEnabled reads crm_settings.ark_coin_enabled; unreadable means on.
func (w *sqlWallet) ArkCoinEnabled(ctx context.Context) bool {
	var raw json.RawMessage
	err := w.pool.QueryRow(ctx, `SELECT value FROM crm.crm_settings WHERE key = 'ark_coin_enabled'`).Scan(&raw)
	if err != nil {
		return true
	}
	return domain.ParseFeatureFlag(raw, true)
}

const packageColumns = `id, name, description, price_idr::float, credit_idr::float, validity_days::float`

func scanPackage(row pgx.CollectableRow) (TopupPackage, error) {
	var p TopupPackage
	err := row.Scan(&p.ID, &p.Name, &p.Description, &p.PriceIdr, &p.CreditIdr, &p.ValidityDays)
	return p, err
}

// MemberPackages are the active packages sold online.
func (w *sqlWallet) MemberPackages(ctx context.Context) ([]TopupPackage, error) {
	rows, err := w.pool.Query(ctx,
		`SELECT `+packageColumns+` FROM pos.pos_topup_packages
		  WHERE is_active AND available_online ORDER BY sort, price_idr, name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanPackage)
}

func (w *sqlWallet) PackageForMember(ctx context.Context, id string) (*TopupPackage, error) {
	rows, err := w.pool.Query(ctx,
		`SELECT `+packageColumns+` FROM pos.pos_topup_packages
		  WHERE id = $1 AND is_active AND available_online`, id)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanPackage)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

func (w *sqlWallet) Balance(ctx context.Context, customerID string) (float64, bool, error) {
	var balance float64
	err := w.pool.QueryRow(ctx,
		`SELECT COALESCE(ark_coin_balance, 0)::float FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&balance)
	if database.IsNoRows(err) {
		return 0, false, nil
	}
	return balance, err == nil, err
}

// LatestOpenMemberTopup is the newest pending member QR that has not expired.
func (w *sqlWallet) LatestOpenMemberTopup(ctx context.Context, customerID string) (*string, error) {
	var id string
	err := w.pool.QueryRow(ctx,
		`SELECT id FROM pos.pos_wallet_transactions
		  WHERE customer_id = $1 AND type = 'topup' AND status = 'pending'
		    AND metadata->>'source' = 'member' AND (metadata->>'expires_at')::timestamptz > now()
		  ORDER BY created_at DESC LIMIT 1`, customerID).Scan(&id)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// CountRecentMemberTopups counts pending member QRs of the last 30 minutes.
func (w *sqlWallet) CountRecentMemberTopups(ctx context.Context, customerID string) (int, error) {
	var n int
	err := w.pool.QueryRow(ctx,
		`SELECT count(*)::int FROM pos.pos_wallet_transactions
		  WHERE customer_id = $1 AND type = 'topup' AND status = 'pending'
		    AND metadata->>'source' = 'member' AND created_at > now() - interval '30 minutes'`, customerID).Scan(&n)
	return n, err
}

type walletInsert struct {
	customerID          string
	kind                string
	status              string
	amount              float64
	balanceBefore       float64
	balanceAfter        float64
	arkRate             float64
	notes               string
	metadata            map[string]any
	paymentMethod       *string
	referenceID         *string
	expiresAt           *time.Time
	packageID           *string
	companyID           *string
	branchID            *string
	xenditTransactionID *string
}

// insertWalletRow mirrors insertWalletRow in lib/wallet/server.ts.
func insertWalletRow(ctx context.Context, q database.Querier, r walletInsert) (*WalletRow, error) {
	meta, _ := json.Marshal(r.metadata)
	status := r.status
	if status == "" {
		status = "completed"
	}
	return scanWalletRow(q.QueryRow(ctx,
		`INSERT INTO pos.pos_wallet_transactions
		   (customer_id, type, amount, ark_coins, balance_before, balance_after, status, notes, metadata,
		    payment_method, reference_id, expires_at, package_id, company_id, branch_id, xendit_transaction_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)
		 RETURNING `+walletColumns,
		r.customerID, r.kind, domain.RoundIdr(r.amount), domain.RoundIdr(r.amount/math.Max(1, r.arkRate)),
		domain.RoundIdr(r.balanceBefore), domain.RoundIdr(r.balanceAfter), status, r.notes, string(meta),
		r.paymentMethod, r.referenceID, r.expiresAt, r.packageID, r.companyID, r.branchID, r.xenditTransactionID))
}

func (w *sqlWallet) InsertPendingTopup(ctx context.Context, row NewPendingTopup) (*WalletRow, error) {
	qris := "qris"
	ref := row.ReferenceID
	return insertWalletRow(ctx, w.pool, walletInsert{
		customerID: row.CustomerID, kind: "topup", status: "pending", amount: row.Amount,
		balanceBefore: row.BalanceBefore, balanceAfter: row.BalanceBefore, arkRate: row.ArkRate,
		paymentMethod: &qris, referenceID: &ref, notes: row.Notes, metadata: row.Metadata,
		xenditTransactionID: row.XenditTransactionID, packageID: row.PackageID,
		companyID: row.CompanyID, branchID: row.BranchID,
	})
}

// MemberTopup is a top-up row owned by the member.
func (w *sqlWallet) MemberTopup(ctx context.Context, customerID, id string) (*WalletRow, error) {
	row, err := scanWalletRow(w.pool.QueryRow(ctx,
		`SELECT `+walletColumns+` FROM pos.pos_wallet_transactions WHERE id = $1 AND customer_id = $2 AND type = 'topup'`,
		id, customerID))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return row, err
}

func (w *sqlWallet) TopupForReconcile(ctx context.Context, id string) (*ReconcileRow, error) {
	var r ReconcileRow
	var status, method, xendit *string
	err := w.pool.QueryRow(ctx,
		`SELECT status, payment_method, xendit_transaction_id FROM pos.pos_wallet_transactions WHERE id = $1`, id).
		Scan(&status, &method, &xendit)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if status != nil {
		r.Status = *status
	}
	if method != nil {
		r.PaymentMethod = *method
	}
	if xendit != nil {
		r.XenditTransactionID = *xendit
	}
	return &r, nil
}

type lockedCustomer struct {
	balance float64
}

func lockCustomer(ctx context.Context, q database.Querier, customerID string) (*lockedCustomer, error) {
	var c lockedCustomer
	err := q.QueryRow(ctx,
		`SELECT COALESCE(ark_coin_balance, 0)::float FROM pos.pos_customers WHERE id = $1 FOR UPDATE`, customerID).
		Scan(&c.balance)
	if database.IsNoRows(err) {
		return nil, fail(404, "Member tidak ditemukan")
	}
	return &c, err
}

func setCustomerBalance(ctx context.Context, q database.Querier, customerID string, balance float64) error {
	_, err := q.Exec(ctx, `UPDATE pos.pos_customers SET ark_coin_balance = $2, updated_at = now() WHERE id = $1`,
		customerID, domain.RoundIdr(balance))
	return err
}

// CreditPendingTopup credits a pending QRIS top-up (webhook, reconciliation
// or the local simulation) in one transaction with the top-up and member
// rows locked, so a webhook and a poll arriving together credit once. A
// package top-up also writes its bonus lot and validity.
func (w *sqlWallet) CreditPendingTopup(ctx context.Context, id, xenditPaymentID, notes string) (CreditOutcome, error) {
	settings, err := loadLoyaltySettings(ctx, w.pool)
	if err != nil {
		return CreditOutcome{}, err
	}
	var out CreditOutcome
	err = database.WithTx(ctx, w.pool, func(tx pgx.Tx) error {
		row, err := scanWalletRow(tx.QueryRow(ctx,
			`SELECT `+walletColumns+` FROM pos.pos_wallet_transactions WHERE id = $1 FOR UPDATE`, id))
		if database.IsNoRows(err) {
			out.Status = "not_found"
			return nil
		}
		if err != nil {
			return err
		}
		status := row.Status
		if status == "" {
			status = "completed"
		}
		if status == "completed" {
			out.Status = "already_completed"
			return nil
		}
		if status != "pending" {
			out.Status = "ignored"
			return nil
		}
		customer, err := lockCustomer(ctx, tx, row.CustomerID)
		if err != nil {
			return err
		}
		amount := row.Amount
		arkCoins := domain.IdrToArk(amount, settings.ArkRate)
		before := customer.balance
		afterTopup := domain.RoundIdr(before + amount)
		now := w.now()
		var expiresAt *time.Time
		if v, has := row.Metadata["validity_days"]; has {
			if days, isNum := v.(float64); isNum {
				expiresAt = domain.ExpiresAtFor(&days, now)
			}
		}
		if err := setCustomerBalance(ctx, tx, row.CustomerID, afterTopup); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_customers SET total_spent = COALESCE(total_spent, 0) + $2 WHERE id = $1`,
			row.CustomerID, amount); err != nil {
			return err
		}
		if notes == "" {
			if row.Notes != nil && *row.Notes != "" {
				notes = *row.Notes
			} else {
				notes = "Top-up QRIS"
			}
		}
		patch, _ := json.Marshal(map[string]any{"credited_at": isoString(now), "xendit_payment_id": nullable(xenditPaymentID)})
		if _, err := tx.Exec(ctx,
			`UPDATE pos.pos_wallet_transactions
			    SET status = 'completed', ark_coins = $2, balance_before = $3, balance_after = $4, notes = $5,
			        metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb,
			        xendit_transaction_id = COALESCE(NULLIF(xendit_transaction_id, ''), $7),
			        expires_at = COALESCE($8, expires_at)
			  WHERE id = $1`,
			row.ID, arkCoins, before, afterTopup, notes, string(patch), nullable(xenditPaymentID), expiresAt); err != nil {
			return err
		}
		bonus := math.Max(0, domain.ToNumber(row.Metadata["bonus_idr"]))
		if bonus > 0 {
			locked, err := lockCustomer(ctx, tx, row.CustomerID)
			if err != nil {
				return err
			}
			after := domain.RoundIdr(locked.balance + bonus)
			packageID := strings.TrimSpace(domain.JSString(row.Metadata["package_id"]))
			var pkgID *string
			if packageID != "" {
				pkgID = &packageID
			}
			name := ""
			if v, isString := row.Metadata["package_name"].(string); isString {
				name = v
			}
			if _, err := insertWalletRow(ctx, tx, walletInsert{
				customerID: row.CustomerID, kind: "topup_bonus", amount: bonus,
				balanceBefore: locked.balance, balanceAfter: after, arkRate: settings.ArkRate,
				notes: strings.TrimSpace("Bonus paket " + name),
				metadata: map[string]any{
					"package_id":      row.Metadata["package_id"],
					"package_name":    row.Metadata["package_name"],
					"validity_days":   row.Metadata["validity_days"],
					"source_topup_id": row.ID,
				},
				expiresAt: expiresAt, packageID: pkgID, companyID: row.CompanyID, branchID: row.BranchID,
			}); err != nil {
				return err
			}
			if err := setCustomerBalance(ctx, tx, row.CustomerID, after); err != nil {
				return err
			}
		}
		out = CreditOutcome{Status: "completed", CustomerID: row.CustomerID, Amount: amount}
		return nil
	})
	return out, err
}

// CreditBonus adds rupiah to the ARK balance as a completed "bonus" entry
// and returns the ARK Coin amount (challenge rewards).
func (w *sqlWallet) CreditBonus(ctx context.Context, customerID string, amountIdr float64, notes string) (float64, error) {
	var coins float64
	err := database.WithTx(ctx, w.pool, func(tx pgx.Tx) error {
		var rate *float64
		err := tx.QueryRow(ctx,
			`SELECT ark_rate::float FROM pos.pos_loyalty_settings WHERE is_active ORDER BY updated_at DESC LIMIT 1`).Scan(&rate)
		if err != nil && !database.IsNoRows(err) {
			return err
		}
		r := orDefault(deref(rate), domain.DefaultArkRate)
		var after *float64
		err = tx.QueryRow(ctx,
			`UPDATE pos.pos_customers SET ark_coin_balance = COALESCE(ark_coin_balance, 0) + $2, updated_at = now()
			  WHERE id = $1 RETURNING ark_coin_balance::float`, customerID, amountIdr).Scan(&after)
		if err != nil && !database.IsNoRows(err) {
			return err
		}
		a := deref(after)
		coins = jsmath.RoundTo(amountIdr/r, 2)
		_, err = tx.Exec(ctx,
			`INSERT INTO pos.pos_wallet_transactions
			   (customer_id, type, amount, ark_coins, balance_before, balance_after, status, notes)
			 VALUES ($1, 'bonus', $2, $3, $4, $5, 'completed', $6)`,
			customerID, amountIdr, coins, a-amountIdr, a, notes)
		return err
	})
	return coins, err
}
