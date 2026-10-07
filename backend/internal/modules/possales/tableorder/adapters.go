package tableorder

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/modules/possales/tableorder/domain"
	"nuhabit/backend/internal/platform/database"
)

// settingsSQL is the stopgap Settings on configuration.* (no wave owns it).
type settingsSQL struct{}

// appSetting is getSetting: the text value, "" when missing or NULL.
func appSetting(ctx context.Context, q database.Querier, key string) (string, error) {
	var v *string
	err := q.QueryRow(ctx, `SELECT value FROM configuration.app_settings WHERE key = $1`, key).Scan(&v)
	if database.IsNoRows(err) || v == nil {
		return "", nil
	}
	return *v, err
}

// companyName is companyName in branding-server.ts (errors read as none).
func companyName(ctx context.Context, q database.Querier, companyID string) string {
	if companyID == "" {
		return ""
	}
	var name *string
	if err := q.QueryRow(ctx, `SELECT name FROM configuration.companies WHERE id::text = $1`, companyID).Scan(&name); err != nil || name == nil {
		return ""
	}
	return *name
}

// BrandName is resolveBrandName: the company's name, else the default
// venue company's, the app_brand_name setting, NEXT_PUBLIC_APP_NAME, "NüHabit".
func (settingsSQL) BrandName(ctx context.Context, q database.Querier, companyID string) (string, error) {
	if name := strings.TrimSpace(companyName(ctx, q, companyID)); name != "" {
		return name, nil
	}
	var raw []byte
	_ = q.QueryRow(ctx, `SELECT value FROM crm.crm_settings WHERE key = 'default_company_id'`).Scan(&raw)
	var defaultCompany string
	var v any
	if json.Unmarshal(raw, &v) == nil && v != nil {
		if s, ok := v.(string); ok {
			defaultCompany = s
		} else {
			defaultCompany = strings.ReplaceAll(domain.JSString(v), `"`, "")
		}
	}
	setting, _ := appSetting(ctx, q, "app_brand_name")
	for _, candidate := range []string{companyName(ctx, q, defaultCompany), setting, os.Getenv("NEXT_PUBLIC_APP_NAME")} {
		if name := strings.TrimSpace(candidate); name != "" {
			return name, nil
		}
	}
	return "NüHabit", nil
}

// StaticQris is loadStaticQris: enabled and an image uploaded.
func (settingsSQL) StaticQris(ctx context.Context, q database.Querier) (StaticQris, error) {
	enabled, err := appSetting(ctx, q, "static_qris_enabled")
	if err != nil {
		return StaticQris{}, err
	}
	image, err := appSetting(ctx, q, "static_qris_image_url")
	if err != nil {
		return StaticQris{}, err
	}
	image = strings.TrimSpace(image)
	return StaticQris{ImageURL: image, Available: enabled == "true" && image != ""}, nil
}

// XenditConfig is loadActiveXenditConfig, with its error messages.
func (settingsSQL) XenditConfig(ctx context.Context, q database.Querier) (*XenditConfig, error) {
	var active bool
	var secret, callback *string
	err := q.QueryRow(ctx, `SELECT is_active, secret_key, callback_url
	   FROM configuration.payment_gateways WHERE provider = 'xendit' LIMIT 1`).Scan(&active, &secret, &callback)
	switch {
	case database.IsNoRows(err):
		return nil, errors.New("QRIS payment gateway is not configured. Set it in Settings → Payment Gateways.")
	case err != nil:
		return nil, err
	case !active:
		return nil, errors.New("QRIS payment gateway is inactive. Enable it in Settings → Payment Gateways.")
	case secret == nil || strings.TrimSpace(*secret) == "":
		return nil, errors.New("Payment gateway secret key is missing.")
	}
	cfg := &XenditConfig{SecretKey: strings.TrimSpace(*secret)}
	if callback != nil {
		cfg.CallbackURL = strings.TrimSpace(*callback)
	}
	return cfg, nil
}

// crmSQL is the stopgap for the CRM reads self-order makes outside
// ports.Loyalty: the default venue, the member tier discount and the XP flag.
type crmSQL struct{}

// Venue is getCrmDefaultVenue: jsonb string values only, "" otherwise.
func (crmSQL) Venue(ctx context.Context, q database.Querier) (string, string) {
	rows, err := q.Query(ctx, `SELECT key, value FROM crm.crm_settings WHERE key IN ('default_company_id', 'default_branch_id')`)
	if err != nil {
		return "", ""
	}
	defer rows.Close()
	var company, branch string
	for rows.Next() {
		var key string
		var raw []byte
		if rows.Scan(&key, &raw) != nil {
			return "", ""
		}
		var s string
		if json.Unmarshal(raw, &s) != nil {
			continue
		}
		if key == "default_company_id" {
			company = s
		} else {
			branch = s
		}
	}
	if rows.Err() != nil {
		return "", ""
	}
	return company, branch
}

// MemberDiscountPercent is loadMemberDiscountPercent: 0 on any failure.
func (crmSQL) MemberDiscountPercent(ctx context.Context, q database.Querier, customerID string) float64 {
	var xp *float64
	if err := q.QueryRow(ctx, `SELECT total_xp::float8 FROM pos.pos_customers WHERE id::text = $1`, customerID).Scan(&xp); err != nil {
		return 0
	}
	rows, err := q.Query(ctx, `SELECT min_lifetime_xp::float8, discount_percent::float8
     FROM crm.crm_membership_tiers WHERE is_active ORDER BY rank`)
	if err != nil {
		return 0
	}
	defer rows.Close()
	var tiers []domain.Tier
	for rows.Next() {
		var t domain.Tier
		if rows.Scan(&t.MinLifetimeXP, &t.DiscountPercent) != nil {
			return 0
		}
		tiers = append(tiers, t)
	}
	total := 0.0
	if xp != nil {
		total = *xp
	}
	return domain.TierDiscountPercent(tiers, total)
}

// XPEnabled is getLoyaltyFeatures().xp: crm_settings xp_enabled, default on.
func (crmSQL) XPEnabled(ctx context.Context, q database.Querier) bool {
	var raw []byte
	if err := q.QueryRow(ctx, `SELECT value FROM crm.crm_settings WHERE key = 'xp_enabled'`).Scan(&raw); err != nil {
		return true
	}
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return true
	}
	return domain.LoyaltyFlag(v)
}

// walletSQL is the stopgap ArkWallet: update_ark_coin_balance in a
// savepoint so a rejection leaves the caller's transaction usable.
type walletSQL struct{}

func (walletSQL) Move(ctx context.Context, q database.Querier, m ports.ArkMove) (*float64, error) {
	var orderID *string
	if m.OrderID != "" {
		orderID = &m.OrderID
	}
	call := func(q database.Querier) (*float64, error) {
		var after *float64
		err := q.QueryRow(ctx, `SELECT public.update_ark_coin_balance(p_customer_id := $1, p_amount := $2,
		   p_type := $3, p_order_id := $4, p_notes := $5)::float8`, m.CustomerID, m.Amount, m.Type, orderID, m.Notes).Scan(&after)
		return after, err
	}
	var after *float64
	var err error
	if tb, ok := q.(database.TxBeginner); ok {
		err = database.WithTx(ctx, tb, func(tx pgx.Tx) error {
			after, err = call(tx)
			return err
		})
	} else {
		after, err = call(q)
	}
	switch {
	case err == nil:
		return after, nil
	case strings.Contains(strings.ToLower(errMessage(err)), "insufficient"):
		return nil, ports.ErrArkInsufficient
	}
	return nil, errors.Join(ports.ErrArkFailed, err)
}
