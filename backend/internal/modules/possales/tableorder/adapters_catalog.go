package tableorder

import (
	"context"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/tableorder/domain"
	"nuhabit/backend/internal/platform/database"
)

// catalogSQL is the stopgap Catalog: the SQL of lib/table-order/server.ts,
// billing-settings-server.ts and loyalty-settings.ts on pos-ops tables.
// pos-ops should own it once it exposes a catalog service.
type catalogSQL struct{}

// productSelect is PRODUCT_SELECT; numbers come back as float8 for
// normalization only.
const productSelect = `
  SELECT p.id::text, p.sku, p.name, p.description, p.base_price::float8,
         p.image_url, p.xp_points::float8, p.station, p.prep_time_minutes::float8, p.min_xp::float8,
         p.is_active, p.is_available, p.sales_channels::text[],
         p.category_id::text, c.name,
         COALESCE(
           json_agg(
             json_build_object(
               'id', v.id, 'name', v.name,
               'price_adjustment', v.price_adjustment::float,
               'is_active', v.is_active
             ) ORDER BY v.display_order NULLS LAST, v.name
           ) FILTER (WHERE v.id IS NOT NULL),
           '[]'::json
         ),
         COALESCE((
           SELECT json_agg(
                    json_build_object(
                      'id', g.id, 'name', g.name,
                      'min_selection', g.min_selection, 'max_selection', g.max_selection,
                      'modifiers', COALESCE((
                        SELECT json_agg(
                                 json_build_object('id', m.id, 'name', m.name,
                                                   'price_adjustment', m.price_adjustment::float)
                                 ORDER BY m.display_order, m.name)
                        FROM pos.pos_modifiers m
                        WHERE m.group_id = g.id AND m.is_active IS NOT FALSE
                      ), '[]'::json)
                    ) ORDER BY g.display_order, g.name)
           FROM pos.pos_product_modifiers pm
           JOIN pos.pos_modifier_groups g ON g.id = pm.modifier_group_id
           WHERE pm.product_id = p.id AND g.is_active IS NOT FALSE
         ), '[]'::json)
  FROM pos.pos_products p
  LEFT JOIN pos.pos_categories c ON c.id = p.category_id
  LEFT JOIN pos.pos_product_variants v ON v.product_id = p.id`

const productGroup = ` GROUP BY p.id, c.name, c.display_order`

// soldOnSelfOrder is soldInSql("p", "self_order").
const soldOnSelfOrder = `(p.sales_channels IS NULL OR cardinality(p.sales_channels) = 0 OR 'self_order' = ANY(p.sales_channels))`

type productScan struct {
	row                 domain.ProductRow
	isActive, available *bool
	channels            []string
}

func queryProducts(ctx context.Context, q database.Querier, sql string, args ...any) ([]productScan, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (productScan, error) {
		var s productScan
		p := &s.row
		err := r.Scan(&p.ID, &p.SKU, &p.Name, &p.Description, &p.BasePrice, &p.ImageURL, &p.XPPoints, &p.Station,
			&p.PrepTimeMinutes, &p.MinXP, &s.isActive, &s.available, &s.channels, &p.CategoryID, &p.CategoryName,
			&p.Variants, &p.ModifierGroups)
		return s, err
	})
}

func (catalogSQL) SellableProducts(ctx context.Context, q database.Querier, search string) ([]domain.ProductRow, error) {
	where := ` WHERE p.is_active = true AND p.is_available = true AND ` + soldOnSelfOrder
	var args []any
	if term := domain.JSTrim(search); term != "" {
		args = append(args, "%"+term+"%")
		where += ` AND p.name ILIKE $1`
	}
	scans, err := queryProducts(ctx, q, productSelect+where+productGroup+`
     ORDER BY c.display_order NULLS LAST, c.name NULLS LAST, p.name`, args...)
	if err != nil {
		return nil, err
	}
	out := make([]domain.ProductRow, len(scans))
	for i, s := range scans {
		out[i] = s.row
	}
	return out, nil
}

func (catalogSQL) Meta(ctx context.Context, q database.Querier) (CatalogMeta, error) {
	var m CatalogMeta
	err := q.QueryRow(ctx, `SELECT count(*)::int,
            count(*) FILTER (WHERE is_active = true AND is_available = true)::int,
            count(*) FILTER (WHERE is_active = true AND is_available = false)::int
     FROM pos.pos_products`).Scan(&m.TotalProducts, &m.SellableProducts, &m.HiddenUnavailable)
	return m, err
}

// salesChannelCodes is SALES_CHANNEL_CODES.
var salesChannelCodes = []string{"pos", "self_order", "gofood", "grabfood", "shopeefood"}

// soldIn is isSoldIn(channels, code): no known channel listed = every channel.
func soldIn(channels []string, code string) bool {
	known := false
	for _, c := range channels {
		c = strings.TrimSpace(c)
		if slices.Contains(salesChannelCodes, c) {
			known = true
			if c == code {
				return true
			}
		}
	}
	return !known
}

func (catalogSQL) ProductsByIDs(ctx context.Context, q database.Querier, ids []string) ([]CatalogProduct, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	scans, err := queryProducts(ctx, q, productSelect+` WHERE p.id = ANY($1::uuid[])`+productGroup, ids)
	if err != nil {
		return nil, err
	}
	out := make([]CatalogProduct, len(scans))
	for i, s := range scans {
		out[i] = CatalogProduct{
			Row: s.row,
			Sellable: (s.isActive == nil || *s.isActive) && (s.available == nil || *s.available) &&
				soldIn(s.channels, "self_order"),
		}
	}
	return out, nil
}

const tableSelect = `SELECT id::text, table_number, qr_code, name, area, status::text, is_active FROM pos.pos_tables`

func (catalogSQL) TableByCode(ctx context.Context, q database.Querier, code string) (*Table, error) {
	value := domain.JSTrim(code)
	if value == "" {
		return nil, nil
	}
	sql := tableSelect + ` WHERE upper(qr_code) = upper($1) OR upper(table_number) = upper($1)
     ORDER BY (upper(qr_code) = upper($1)) DESC LIMIT 1`
	if isUUID(value) {
		sql = tableSelect + ` WHERE id = $1 LIMIT 1`
	}
	var t Table
	err := q.QueryRow(ctx, sql, value).Scan(&t.ID, &t.TableNumber, &t.QRCode, &t.Name, &t.Area, &t.Status, &t.IsActive)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// systemBillingProfileID is SYSTEM_BILLING_PROFILE_ID.
const systemBillingProfileID = "b0000000-0000-4000-8000-000000000001"

// BillingProfile is resolveBillingProfile({branchId}): the branch profile
// (warehouse NULL), then the system profile, then the oldest global one, then
// DEFAULT_BILLING_PROFILE (also when the tables do not exist).
func (catalogSQL) BillingProfile(ctx context.Context, q database.Querier, branchID string) (string, []domain.Charge, error) {
	const cols = `SELECT id::text, name FROM pos.pos_billing_profiles WHERE is_active = true`
	candidates := []struct {
		sql  string
		args []any
	}{
		{cols + ` AND id = $1`, []any{systemBillingProfileID}},
		{cols + ` AND branch_id IS NULL AND warehouse_id IS NULL ORDER BY created_at ASC LIMIT 1`, nil},
	}
	if branchID = strings.TrimSpace(branchID); branchID != "" {
		candidates = append([]struct {
			sql  string
			args []any
		}{{cols + ` AND branch_id = $1 AND warehouse_id IS NULL LIMIT 1`, []any{branchID}}}, candidates...)
	}
	for _, c := range candidates {
		var id string
		var name *string
		err := q.QueryRow(ctx, c.sql, c.args...).Scan(&id, &name)
		if database.IsNoRows(err) {
			continue
		}
		if database.IsUndefinedTable(err) {
			break
		}
		if err != nil {
			return "", nil, err
		}
		charges, err := loadCharges(ctx, q, id)
		if database.IsUndefinedTable(err) {
			break
		}
		if err != nil {
			return "", nil, err
		}
		profileName := "Billing Profile"
		if name != nil && *name != "" {
			profileName = *name
		}
		return profileName, charges, nil
	}
	return domain.DefaultProfileName, domain.DefaultCharges(), nil
}

func loadCharges(ctx context.Context, q database.Querier, profileID string) ([]domain.Charge, error) {
	rows, err := q.Query(ctx, `SELECT id::text, code, name, charge_kind::text, calc_method::text, rate::float8, amount::float8,
            apply_order::float8, is_enabled, is_optional, base::text
     FROM pos.pos_billing_charges WHERE profile_id = $1 ORDER BY apply_order ASC, code ASC`, profileID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Charge, error) {
		var c domain.ChargeRow
		err := r.Scan(&c.ID, &c.Code, &c.Name, &c.ChargeKind, &c.CalcMethod, &c.Rate, &c.Amount, &c.ApplyOrder,
			&c.IsEnabled, &c.IsOptional, &c.Base)
		return domain.NormalizeCharge(c), err
	})
}

// ArkRate is max(1, ark_rate) of the newest active pos_loyalty_settings row;
// 1000 without one or without the table.
func (catalogSQL) ArkRate(ctx context.Context, q database.Querier) (float64, error) {
	var rate *float64
	err := q.QueryRow(ctx, `SELECT ark_rate::float8 FROM pos.pos_loyalty_settings
     WHERE is_active = true ORDER BY updated_at DESC LIMIT 1`).Scan(&rate)
	switch {
	case database.IsNoRows(err), database.IsUndefinedTable(err):
		return 1000, nil
	case err != nil:
		return 0, err
	case rate == nil:
		return 1, nil // Math.max(1, Number(null))
	}
	return max(1, *rate), nil
}
