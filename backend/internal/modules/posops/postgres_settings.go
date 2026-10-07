package posops

import (
	"context"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/database"
)

/* ── Payment methods (pos.payment_methods) ───────────────────────────── */

const paymentMethodColumns = `id::text, code, name, description, icon, handler, is_active, sort_order, requires_cash_input`

// paymentMethod is a pos.payment_methods row (PosPaymentMethod JSON).
type paymentMethod struct {
	ID                string `json:"id"`
	Code              string `json:"code"`
	Name              string `json:"name"`
	Description       string `json:"description"`
	Icon              string `json:"icon"`
	Handler           string `json:"handler"`
	IsActive          bool   `json:"is_active"`
	SortOrder         int    `json:"sort_order"`
	RequiresCashInput bool   `json:"requires_cash_input"`
}

// scanPaymentMethod applies mapRow: rows with a bad code or handler are
// dropped (nil), blanks take their defaults.
func scanPaymentMethod(row pgx.Row) (*paymentMethod, error) {
	var m paymentMethod
	if err := row.Scan(&m.ID, &m.Code, &m.Name, &m.Description, &m.Icon, &m.Handler, &m.IsActive, &m.SortOrder,
		&m.RequiresCashInput); err != nil {
		return nil, err
	}
	if !domain.ValidPaymentCode(m.Code) || !slices.Contains(domain.PaymentHandlers, m.Handler) {
		return nil, nil
	}
	if m.Icon == "" {
		m.Icon = "banknote"
	}
	if m.SortOrder == 0 {
		m.SortOrder = 100
	}
	return &m, nil
}

func listPaymentMethods(ctx context.Context, q database.Querier, activeOnly bool) ([]paymentMethod, error) {
	rows, err := q.Query(ctx, `SELECT `+paymentMethodColumns+` FROM pos.payment_methods
		WHERE ($1::boolean IS NOT TRUE OR is_active = true) ORDER BY sort_order ASC, name ASC`, activeOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []paymentMethod{}
	for rows.Next() {
		m, err := scanPaymentMethod(rows)
		if err != nil {
			return nil, err
		}
		if m != nil {
			out = append(out, *m)
		}
	}
	return out, rows.Err()
}

func paymentMethodByCode(ctx context.Context, q database.Querier, code string) (*paymentMethod, error) {
	m, err := scanPaymentMethod(q.QueryRow(ctx, `SELECT `+paymentMethodColumns+` FROM pos.payment_methods WHERE code = $1`, code))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return m, err
}

func paymentCodeTaken(ctx context.Context, q database.Querier, code string) (bool, error) {
	var taken bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pos.payment_methods WHERE code = $1)`, code).Scan(&taken)
	return taken, err
}

// updatePaymentMethod sets cols (updated_at always) on the code's row.
func updatePaymentMethod(ctx context.Context, q database.Querier, code string, cols domain.Columns) (*paymentMethod, error) {
	sets := []string{"updated_at = now()"}
	var args []any
	for _, c := range cols {
		args = append(args, c.Value)
		sets = append(sets, c.Name+" = $"+strconv.Itoa(len(args)))
	}
	args = append(args, code)
	m, err := scanPaymentMethod(q.QueryRow(ctx, `UPDATE pos.payment_methods SET `+strings.Join(sets, ", ")+
		` WHERE code = $`+strconv.Itoa(len(args))+` RETURNING `+paymentMethodColumns, args...))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return m, err
}

func paymentCodesLike(ctx context.Context, q database.Querier, base string) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT code FROM pos.payment_methods WHERE code = $1 OR code LIKE $2`, base, base+"_%")
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func insertPaymentMethod(ctx context.Context, q database.Querier, code, name, description, handler string) (*paymentMethod, error) {
	var maxOrder *string
	if err := q.QueryRow(ctx, `SELECT MAX(sort_order)::text FROM pos.payment_methods`).Scan(&maxOrder); err != nil {
		return nil, err
	}
	icon := "banknote"
	if handler == "credit" {
		icon = "credit-card"
	}
	return scanPaymentMethod(q.QueryRow(ctx, `INSERT INTO pos.payment_methods
		(code, name, description, icon, handler, is_active, sort_order, requires_cash_input)
		VALUES ($1, $2, $3, $4, $5, true, $6, $7) RETURNING `+paymentMethodColumns,
		code, name, description, icon, handler, int(numOrZero(maxOrder))+10, handler == "cash"))
}

func deletePaymentMethod(ctx context.Context, q database.Querier, code string) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM pos.payment_methods WHERE code = $1`, code)
	return tag.RowsAffected() > 0, err
}

/* ── Sales channels and channel prices ───────────────────────────────── */

// channelRule is a pos.sales_channels row (ChannelRule JSON).
type channelRule struct {
	Code          string  `json:"code"`
	Name          string  `json:"name"`
	MarkupPercent float64 `json:"markupPercent"`
	RoundingStep  float64 `json:"roundingStep"`
	RoundingMode  string  `json:"roundingMode"`
	IsActive      bool    `json:"isActive"`
}

const channelSelect = `SELECT code, name, COALESCE(markup_percent, 0)::float8, rounding_step::float8, rounding_mode, is_active FROM pos.sales_channels`

func scanChannel(r pgx.CollectableRow) (channelRule, error) {
	var c channelRule
	err := r.Scan(&c.Code, &c.Name, &c.MarkupPercent, &c.RoundingStep, &c.RoundingMode, &c.IsActive)
	return c, err
}

func listSalesChannels(ctx context.Context, q database.Querier) ([]channelRule, error) {
	rows, err := q.Query(ctx, channelSelect+` ORDER BY sort_order, name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanChannel)
}

func salesChannel(ctx context.Context, q database.Querier, code string) (*channelRule, error) {
	rows, err := q.Query(ctx, channelSelect+` WHERE code = $1`, code)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanChannel)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

func updateSalesChannel(ctx context.Context, q database.Querier, code string, markup, step float64, mode string, active bool, userID string) error {
	_, err := q.Exec(ctx, `UPDATE pos.sales_channels
		SET markup_percent = $2, rounding_step = $3, rounding_mode = $4, is_active = $5, updated_by = $6, updated_at = now()
		WHERE code = $1`, code, markup, step, mode, active, userID)
	return err
}

func channelOverrides(ctx context.Context, q database.Querier, code string) (map[string]float64, error) {
	rows, err := q.Query(ctx, `SELECT product_id::text, price::float8 FROM pos.pos_product_channel_prices WHERE channel_code = $1`, code)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var id string
		var price float64
		if err := rows.Scan(&id, &price); err != nil {
			return nil, err
		}
		out[id] = price
	}
	return out, rows.Err()
}

func channelProducts(ctx context.Context, q database.Querier) ([]*Obj, error) {
	return QueryObjs(ctx, q, `SELECT p.id, p.name, p.sku, c.name AS category_name, p.base_price::float AS base_price,
		p.is_available, p.sales_channels,
		(SELECT count(*)::int FROM pos.pos_product_variants v WHERE v.product_id = p.id AND v.is_active IS NOT FALSE) AS variant_count,
		(SELECT count(*)::int FROM pos.pos_product_modifiers pm WHERE pm.product_id = p.id) AS modifier_count
		FROM pos.pos_products p
		LEFT JOIN pos.pos_categories c ON c.id = p.category_id
		WHERE p.is_active = true AND COALESCE(p.product_kind, 'regular') <> 'gift_card'
		ORDER BY c.display_order NULLS LAST, c.name NULLS LAST, p.name`)
}

func clearChannelPrices(ctx context.Context, q database.Querier, channel string, productIDs []string) (int64, error) {
	sql, args := `DELETE FROM pos.pos_product_channel_prices WHERE channel_code = $1`, []any{channel}
	if productIDs != nil {
		sql, args = sql+` AND product_id = ANY($2::uuid[])`, append(args, productIDs)
	}
	tag, err := q.Exec(ctx, sql, args...)
	return tag.RowsAffected(), err
}

// saveChannelPrices upserts manual prices of existing products only.
func saveChannelPrices(ctx context.Context, q database.Querier, channel string, productIDs []string, prices []float64, userID string) (int64, error) {
	tag, err := q.Exec(ctx, `INSERT INTO pos.pos_product_channel_prices (product_id, channel_code, price, updated_by)
		SELECT p.id, $1, v.price, $4
		FROM unnest($2::uuid[], $3::numeric[]) AS v(product_id, price)
		JOIN pos.pos_products p ON p.id = v.product_id
		ON CONFLICT (product_id, channel_code)
		DO UPDATE SET price = EXCLUDED.price, updated_by = EXCLUDED.updated_by, updated_at = now()`,
		channel, productIDs, prices, userID)
	return tag.RowsAffected(), err
}

/* ── Billing profiles ────────────────────────────────────────────────── */

const billingProfileColumns = `id::text, branch_id::text, warehouse_id::text, name, is_active`

type billingProfileRow struct {
	ID                    string
	BranchID, WarehouseID *string
	Name                  *string
	IsActive              *bool
}

func scanProfiles(rows pgx.Rows, err error) ([]billingProfileRow, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (billingProfileRow, error) {
		var p billingProfileRow
		err := r.Scan(&p.ID, &p.BranchID, &p.WarehouseID, &p.Name, &p.IsActive)
		return p, err
	})
}

func billingCharges(ctx context.Context, q database.Querier, profileID string) ([]domain.BillingCharge, error) {
	rows, err := q.Query(ctx, `SELECT id::text, code, name, charge_kind, calc_method, rate::text, amount::text,
		apply_order, is_enabled, is_optional, base
		FROM pos.pos_billing_charges WHERE profile_id = $1 ORDER BY apply_order ASC, code ASC`, profileID)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.ChargeRow, error) {
		var c domain.ChargeRow
		err := r.Scan(&c.ID, &c.Code, &c.Name, &c.ChargeKind, &c.CalcMethod, &c.Rate, &c.Amount, &c.ApplyOrder,
			&c.IsEnabled, &c.IsOptional, &c.Base)
		return c, err
	})
	out := make([]domain.BillingCharge, len(list))
	for i, c := range list {
		out[i] = domain.NormalizeCharge(c)
	}
	return out, err
}

// billingProfile normalizes a profile row with its charges.
func billingProfile(ctx context.Context, q database.Querier, row billingProfileRow) (domain.BillingProfile, error) {
	charges, err := billingCharges(ctx, q, row.ID)
	if err != nil {
		return domain.BillingProfile{}, err
	}
	name := "Billing Profile"
	if row.Name != nil && *row.Name != "" {
		name = *row.Name
	}
	return domain.BillingProfile{
		ID: row.ID, BranchID: row.BranchID, WarehouseID: row.WarehouseID, Name: name,
		IsActive: row.IsActive == nil || *row.IsActive, Scope: domain.ProfileScope(row.BranchID, row.WarehouseID),
		Charges: charges,
	}, nil
}

func firstProfile(ctx context.Context, q database.Querier, sql string, args ...any) (*domain.BillingProfile, error) {
	rows, err := scanProfiles(q.Query(ctx, sql, args...))
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	p, err := billingProfile(ctx, q, rows[0])
	return &p, err
}

func activeProfileByID(ctx context.Context, q database.Querier, id string) (*domain.BillingProfile, error) {
	return firstProfile(ctx, q, `SELECT `+billingProfileColumns+` FROM pos.pos_billing_profiles WHERE id = $1::text::uuid AND is_active = true`, id)
}

func listBillingProfiles(ctx context.Context, q database.Querier) ([]domain.BillingProfile, error) {
	rows, err := scanProfiles(q.Query(ctx, `SELECT `+billingProfileColumns+` FROM pos.pos_billing_profiles
		WHERE is_active = true
		ORDER BY CASE WHEN branch_id IS NULL THEN 0 WHEN warehouse_id IS NULL THEN 1 ELSE 2 END, name ASC`))
	if err != nil {
		return nil, err
	}
	out := []domain.BillingProfile{}
	for _, r := range rows {
		p, err := billingProfile(ctx, q, r)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}
