package storedvalue

import (
	"context"
	"encoding/json"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// SQL of lib/wallet/server.ts on pos.pos_wallet_transactions and the
// pos_customers.ark_coin_balance mirror.

// WalletRow is a pos_wallet_transactions row as WALLET_COLUMNS selects it
// (numbers as float, metadata as stored).
type WalletRow struct {
	ID                  string          `json:"id"`
	CustomerID          *string         `json:"customer_id"`
	Type                string          `json:"type"`
	Status              string          `json:"status"`
	Amount              float64         `json:"amount"`
	ArkCoins            float64         `json:"ark_coins"`
	BalanceBefore       float64         `json:"balance_before"`
	BalanceAfter        float64         `json:"balance_after"`
	PaymentMethod       *string         `json:"payment_method"`
	XenditTransactionID *string         `json:"xendit_transaction_id"`
	ReferenceID         *string         `json:"reference_id"`
	OrderID             *string         `json:"order_id"`
	Notes               *string         `json:"notes"`
	Metadata            json.RawMessage `json:"metadata"`
	CreatedAt           *httpx.JSTime   `json:"created_at"`
	ExpiresAt           *httpx.JSTime   `json:"expires_at"`
	PackageID           *string         `json:"package_id"`
	CompanyID           *string         `json:"company_id"`
	BranchID            *string         `json:"branch_id"`

	meta      map[string]any
	createdAt time.Time
	expiresAt *time.Time
}

const walletColumns = `id, customer_id, type, status, amount::float AS amount, ark_coins::float AS ark_coins,
  balance_before::float AS balance_before, balance_after::float AS balance_after, payment_method,
  xendit_transaction_id, reference_id, order_id, notes, metadata, created_at, expires_at, package_id,
  company_id, branch_id`

func scanWalletRow(row pgx.Row) (*WalletRow, error) {
	var w WalletRow
	var created *time.Time
	err := row.Scan(&w.ID, &w.CustomerID, &w.Type, &w.Status, &w.Amount, &w.ArkCoins, &w.BalanceBefore,
		&w.BalanceAfter, &w.PaymentMethod, &w.XenditTransactionID, &w.ReferenceID, &w.OrderID, &w.Notes,
		&w.Metadata, &created, &w.expiresAt, &w.PackageID, &w.CompanyID, &w.BranchID)
	if err != nil {
		return nil, err
	}
	w.CreatedAt = httpx.NewJSTime(created)
	w.ExpiresAt = httpx.NewJSTime(w.expiresAt)
	if created != nil {
		w.createdAt = *created
	}
	w.meta = decodeMeta(w.Metadata)
	return &w, nil
}

func collectWalletRows(rows pgx.Rows, err error) ([]*WalletRow, error) {
	if err != nil {
		return nil, err
	}
	out := []*WalletRow{}
	defer rows.Close()
	for rows.Next() {
		w, err := scanWalletRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func decodeMeta(raw json.RawMessage) map[string]any {
	m := map[string]any{}
	_ = json.Unmarshal(raw, &m)
	if m == nil {
		m = map[string]any{}
	}
	return m
}

// ledgerRow is the ledger view of a wallet row.
func (w *WalletRow) ledgerRow() domain.LedgerRow {
	return domain.LedgerRow{
		ID: w.ID, Type: w.Type, Status: w.Status, Amount: w.Amount,
		BalanceBefore: w.BalanceBefore, BalanceAfter: w.BalanceAfter,
		CreatedAt: w.createdAt, ExpiresAt: w.expiresAt, Metadata: w.meta,
	}
}

func ledgerRows(rows []*WalletRow) []domain.LedgerRow {
	out := make([]domain.LedgerRow, len(rows))
	for i, r := range rows {
		out[i] = r.ledgerRow()
	}
	return out
}

func loadLedgerRows(ctx context.Context, q database.Querier, customerID string) ([]*WalletRow, error) {
	return collectWalletRows(q.Query(ctx,
		`SELECT `+walletColumns+` FROM pos.pos_wallet_transactions WHERE customer_id = $1 ORDER BY created_at, id`,
		customerID))
}

// WalletSettings is loadWalletSettings: the defaults overlaid by the active
// pos_loyalty_settings row (a NULL column stays null, like the TS spread).
type WalletSettings struct {
	ArkRate                   float64  `json:"ark_rate"`
	TopupMinAmount            float64  `json:"topup_min_amount"`
	TopupMaxAmount            float64  `json:"topup_max_amount"`
	LowBalanceThresholdIdr    *float64 `json:"low_balance_threshold_idr"`
	WalletDefaultValidityDays *float64 `json:"wallet_default_validity_days"`
	WalletExpiryReminderDays  float64  `json:"wallet_expiry_reminder_days"`
}

func defaultWalletSettings() WalletSettings {
	zero := 0.0
	return WalletSettings{ArkRate: 1000, TopupMinAmount: 10_000, TopupMaxAmount: 10_000_000,
		LowBalanceThresholdIdr: &zero, WalletExpiryReminderDays: 7}
}

// lowBalanceThreshold is the threshold as the sweep reads it (null = 0).
func (s WalletSettings) lowBalanceThreshold() float64 {
	if s.LowBalanceThresholdIdr == nil {
		return 0
	}
	return *s.LowBalanceThresholdIdr
}

func loadWalletSettings(ctx context.Context, q database.Querier) (WalletSettings, error) {
	s := defaultWalletSettings()
	var days *int32
	err := q.QueryRow(ctx,
		`SELECT ark_rate::float AS ark_rate, topup_min_amount::float AS topup_min_amount,
		        topup_max_amount::float AS topup_max_amount,
		        low_balance_threshold_idr::float AS low_balance_threshold_idr,
		        wallet_default_validity_days, wallet_expiry_reminder_days::float
		   FROM pos.pos_loyalty_settings WHERE is_active ORDER BY updated_at DESC LIMIT 1`).
		Scan(&s.ArkRate, &s.TopupMinAmount, &s.TopupMaxAmount, &s.LowBalanceThresholdIdr, &days, &s.WalletExpiryReminderDays)
	if database.IsNoRows(err) {
		return defaultWalletSettings(), nil
	}
	if days != nil {
		d := float64(*days)
		s.WalletDefaultValidityDays = &d
	}
	return s, err
}

// loadLoyaltySettings is loadPosLoyaltySettings (missing table = defaults).
func loadLoyaltySettings(ctx context.Context, q database.Querier) (domain.LoyaltySettings, error) {
	var row domain.LoyaltyRow
	err := q.QueryRow(ctx,
		`SELECT ark_rate::float, topup_min_amount::float, topup_xp_enabled, topup_xp_mode,
		        topup_xp_value::float, topup_xp_amount_step::float
		   FROM pos.pos_loyalty_settings WHERE is_active ORDER BY updated_at DESC LIMIT 1`).
		Scan(&row.ArkRate, &row.TopupMinAmount, &row.TopupXPEnabled, &row.TopupXPMode, &row.TopupXPValue, &row.TopupXPAmountStep)
	switch {
	case database.IsNoRows(err), database.IsUndefinedTable(err):
		return domain.DefaultLoyaltySettings(), nil
	case err != nil:
		return domain.LoyaltySettings{}, err
	}
	return domain.NormalizeLoyaltySettings(&row), nil
}

// lockedCustomer is lockCustomer's row.
type lockedCustomer struct {
	ID      string
	Name    *string
	Phone   *string
	Balance float64
}

// lockCustomer locks the member row; 404 "Member tidak ditemukan".
func lockCustomer(ctx context.Context, q database.Querier, customerID string) (*lockedCustomer, error) {
	var c lockedCustomer
	err := q.QueryRow(ctx,
		`SELECT id, name, phone, COALESCE(ark_coin_balance, 0)::float AS balance
		   FROM pos.pos_customers WHERE id = $1 FOR UPDATE`, customerID).Scan(&c.ID, &c.Name, &c.Phone, &c.Balance)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Member tidak ditemukan")
	}
	return &c, err
}

func setCustomerBalance(ctx context.Context, q database.Querier, customerID string, balance float64) error {
	_, err := q.Exec(ctx, `UPDATE pos.pos_customers SET ark_coin_balance = $2, updated_at = now() WHERE id = $1`,
		customerID, domain.RoundIdr(balance))
	return err
}

// newWalletRow is insertWalletRow's input.
type newWalletRow struct {
	CustomerID          string
	Type                string
	Amount              float64
	BalanceBefore       float64
	BalanceAfter        float64
	ArkRate             float64
	Notes               string
	Metadata            any
	Status              string
	PaymentMethod       *string
	ReferenceID         *string
	XenditTransactionID *string
	ExpiresAt           *time.Time
	PackageID           *string
	CompanyID           *string
	BranchID            *string
}

// insertWalletRow mirrors insertWalletRow in lib/wallet/server.ts.
func insertWalletRow(ctx context.Context, q database.Querier, r newWalletRow) (*WalletRow, error) {
	meta, err := json.Marshal(r.Metadata)
	if err != nil {
		return nil, err
	}
	status := r.Status
	if status == "" {
		status = "completed"
	}
	return scanWalletRow(q.QueryRow(ctx,
		`INSERT INTO pos.pos_wallet_transactions
		   (customer_id, type, amount, ark_coins, balance_before, balance_after, status, notes, metadata,
		    payment_method, reference_id, expires_at, package_id, company_id, branch_id, xendit_transaction_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)
		 RETURNING `+walletColumns,
		r.CustomerID, r.Type, domain.RoundIdr(r.Amount), domain.RoundIdr(r.Amount/math.Max(1, r.ArkRate)),
		domain.RoundIdr(r.BalanceBefore), domain.RoundIdr(r.BalanceAfter), status, r.Notes, string(meta),
		r.PaymentMethod, r.ReferenceID, r.ExpiresAt, r.PackageID, r.CompanyID, r.BranchID, r.XenditTransactionID))
}

// lockEntry locks one wallet row for a correction.
func lockEntry(ctx context.Context, q database.Querier, id string) (*WalletRow, error) {
	w, err := scanWalletRow(q.QueryRow(ctx, `SELECT `+walletColumns+` FROM pos.pos_wallet_transactions WHERE id = $1 FOR UPDATE`, id))
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Entri dompet tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	if w.CustomerID == nil {
		return nil, httpx.BadRequest("Entri tidak terhubung ke member")
	}
	return w, nil
}

// existsWhere reports a row of kind whose metadata key points at id.
func existsWhere(ctx context.Context, q database.Querier, kind, key, id string) (bool, error) {
	var one int
	err := q.QueryRow(ctx,
		`SELECT 1 FROM pos.pos_wallet_transactions WHERE type = $1 AND metadata->>`+quoteLiteral(key)+` = $2 LIMIT 1`,
		kind, id).Scan(&one)
	if database.IsNoRows(err) {
		return false, nil
	}
	return err == nil, err
}

// quoteLiteral quotes a fixed SQL string literal (keys are constants).
func quoteLiteral(s string) string { return "'" + s + "'" }

func markEntry(ctx context.Context, q database.Querier, id string, patch map[string]any) error {
	raw, err := json.Marshal(patch)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx,
		`UPDATE pos.pos_wallet_transactions SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
		id, string(raw))
	return err
}
