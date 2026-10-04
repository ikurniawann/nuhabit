package adapters

import (
	"context"

	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/database"
)

// Catalog reads pos.pos_products and item.products (owned by pos-ops and
// inventory).
type Catalog struct{}

var _ ports.Catalog = Catalog{}

// uniqueIDs is `[...new Set(ids.filter(Boolean))]`.
func uniqueIDs(ids []string) []string {
	seen := make(map[string]bool, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != "" && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// Warehouses is loadPosProductWarehouseIds: the stall of the linked master
// product (by source_product_id, else by the "PUR-<kode>" sku). Every
// requested id is in the map, "" when it has no stall.
func (Catalog) Warehouses(ctx context.Context, q database.Querier, productIDs []string) (map[string]string, error) {
	ids := uniqueIDs(productIDs)
	out := make(map[string]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT pp.id::text,
	        COALESCE(p.warehouse_id, p_sku.warehouse_id)::text AS warehouse_id
	   FROM pos.pos_products pp
	   LEFT JOIN item.products p ON p.id = pp.source_product_id AND p.deleted_at IS NULL
	   LEFT JOIN item.products p_sku
	     ON pp.source_product_id IS NULL
	    AND pp.sku = ('PUR-' || p_sku.kode)
	    AND p_sku.deleted_at IS NULL
	    AND p_sku.kode IS NOT NULL
	    AND btrim(p_sku.kode) <> ''
	  WHERE pp.id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var warehouse *string
		if err := rows.Scan(&id, &warehouse); err != nil {
			return nil, err
		}
		out[id] = deref(warehouse)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, id := range ids {
		if _, ok := out[id]; !ok {
			out[id] = ""
		}
	}
	return out, nil
}

// CostPrices is loadPosProductCostMap reduced to Number(cost_price) per
// known product (NULL is 0).
func (Catalog) CostPrices(ctx context.Context, q database.Querier, productIDs []string) (map[string]float64, error) {
	ids := uniqueIDs(productIDs)
	out := make(map[string]float64, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT id::text, cost_price::text FROM pos.pos_products WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var cost *string
		if err := rows.Scan(&id, &cost); err != nil {
			return nil, err
		}
		if cost == nil {
			out[id] = 0
		} else {
			out[id] = jsrow.ToNumber(*cost)
		}
	}
	return out, rows.Err()
}

// Skus is the lookup of resolveOrderItemSkus: the POS sku and the master
// kode (item.products.kode via source_product_id, non-empty only). Like the
// TS, a failed lookup is not an error: a failed product query yields no
// entries and a failed master query leaves MasterKode nil.
func (Catalog) Skus(ctx context.Context, q database.Querier, productIDs []string) (map[string]ports.ProductSku, error) {
	ids := uniqueIDs(productIDs)
	out := make(map[string]ports.ProductSku, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	source := map[string]string{} // pos product id → source_product_id
	err := savepoint(ctx, q, func(q database.Querier) error {
		rows, err := q.Query(ctx, `SELECT id::text, sku, source_product_id::text FROM pos.pos_products WHERE id = ANY($1::uuid[])`, ids)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			var sku, src *string
			if err := rows.Scan(&id, &sku, &src); err != nil {
				return err
			}
			out[id] = ports.ProductSku{PosSku: sku}
			if src != nil && *src != "" {
				source[id] = *src
			}
		}
		return rows.Err()
	})
	if err != nil {
		return map[string]ports.ProductSku{}, nil
	}
	if len(source) == 0 {
		return out, nil
	}
	srcIDs := make([]string, 0, len(source))
	for _, s := range source {
		srcIDs = append(srcIDs, s)
	}
	kode := map[string]string{}
	err = savepoint(ctx, q, func(q database.Querier) error {
		rows, err := q.Query(ctx, `SELECT id::text, kode FROM item.products WHERE id = ANY($1::uuid[])`, uniqueIDs(srcIDs))
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			var k *string
			if err := rows.Scan(&id, &k); err != nil {
				return err
			}
			if k != nil && *k != "" {
				kode[id] = *k
			}
		}
		return rows.Err()
	})
	if err != nil {
		return out, nil
	}
	for id, src := range source {
		if k, ok := kode[src]; ok {
			p := out[id]
			p.MasterKode = &k
			out[id] = p
		}
	}
	return out, nil
}
