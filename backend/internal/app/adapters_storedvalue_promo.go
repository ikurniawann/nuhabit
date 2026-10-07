package app

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/storedvalue/promo"
	promodomain "nuhabit/backend/internal/modules/storedvalue/promo/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// storedValuePromoPorts wires the promo adapters: reads of the POS catalog
// and of member order history (pos-ops and pos-sales tables), with the SQL
// of lib/promo/campaigns-server.ts, offer-rules-server.ts and
// promo-server.ts.
func storedValuePromoPorts(d module.Deps) promo.Ports {
	return promo.Ports{Catalog: promoCatalog{}, Members: promoMembers{}}
}

type promoCatalog struct{}

func (promoCatalog) Active(ctx context.Context, q database.Querier) (promo.Catalog, error) {
	out := promo.Catalog{Products: []promo.CatalogProduct{}, Categories: []promo.CatalogCategory{}}
	rows, err := q.Query(ctx, `
		SELECT id, name, base_price::text AS price, category_id
		  FROM pos.pos_products
		 WHERE is_active IS NOT FALSE
		 ORDER BY name`)
	if err != nil {
		return out, err
	}
	if out.Products, err = pgx.CollectRows(rows, pgx.RowToStructByPos[promo.CatalogProduct]); err != nil {
		return out, err
	}
	rows, err = q.Query(ctx, `
		SELECT id, name FROM pos.pos_categories
		 WHERE is_active IS NOT FALSE
		 ORDER BY display_order NULLS LAST, name`)
	if err != nil {
		return out, err
	}
	out.Categories, err = pgx.CollectRows(rows, pgx.RowToStructByPos[promo.CatalogCategory])
	return out, err
}

func (promoCatalog) ProductCategories(ctx context.Context, q database.Querier, productIDs []string) (map[string]*string, error) {
	rows, err := q.Query(ctx, `SELECT id, category_id FROM pos.pos_products WHERE id = ANY($1::uuid[])`, productIDs)
	if err != nil {
		return nil, err
	}
	out := map[string]*string{}
	var id string
	var category *string
	_, err = pgx.ForEachRow(rows, []any{&id, &category}, func() error {
		out[id] = category
		return nil
	})
	return out, err
}

func (promoCatalog) CategoryProducts(ctx context.Context, q database.Querier, categoryIDs []string) (map[string][]string, error) {
	rows, err := q.Query(ctx, `SELECT id, category_id FROM pos.pos_products WHERE category_id = ANY($1::uuid[])`, categoryIDs)
	if err != nil {
		return nil, err
	}
	out := map[string][]string{}
	var id, category string
	_, err = pgx.ForEachRow(rows, []any{&id, &category}, func() error {
		out[category] = append(out[category], id)
		return nil
	})
	return out, err
}

func (promoCatalog) Names(ctx context.Context, q database.Querier, productIDs, categoryIDs []string) (map[string]string, map[string]string, error) {
	products, err := promoNames(ctx, q, `SELECT id, name FROM pos.pos_products WHERE id = ANY($1::uuid[])`, productIDs)
	if err != nil {
		return nil, nil, err
	}
	categories, err := promoNames(ctx, q, `SELECT id, name FROM pos.pos_categories WHERE id = ANY($1::uuid[])`, categoryIDs)
	return products, categories, err
}

func promoNames(ctx context.Context, q database.Querier, sql string, ids []string) (map[string]string, error) {
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, sql, ids)
	if err != nil {
		return nil, err
	}
	var id, name string
	_, err = pgx.ForEachRow(rows, []any{&id, &name}, func() error {
		out[id] = name
		return nil
	})
	return out, err
}

type promoMembers struct{}

// PromoContext counts paid orders (void, cancelled and merged excluded)
// and the membership age in whole days.
func (promoMembers) PromoContext(ctx context.Context, q database.Querier, customerID string) (*promodomain.MemberContext, error) {
	var m promodomain.MemberContext
	err := q.QueryRow(ctx, `
		SELECT
		  (SELECT COUNT(*)::int FROM pos.pos_orders o
		    WHERE o.customer_id = c.id AND o.payment_status = 'paid'
		      AND o.status NOT IN ('voided', 'cancelled', 'merged')),
		  COALESCE(FLOOR(EXTRACT(EPOCH FROM (now() - c.created_at)) / 86400), 0)::int
		FROM pos.pos_customers c WHERE c.id = $1`, customerID).Scan(&m.PriorPaidOrders, &m.JoinedDaysAgo)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}
