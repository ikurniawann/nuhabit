package sales

import (
	"context"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/database"
)

// resolveItemSkus is resolveOrderItemSkus: replace opaque product_sku
// snapshots with the master kode or the POS sku. Lookup failures leave the
// items untouched.
func (h *Handler) resolveItemSkus(ctx context.Context, q database.Querier, items []*jsrow.Row) []*jsrow.Row {
	var ids []string
	seen := map[string]bool{}
	for _, it := range items {
		if id := it.Str("product_id"); id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return items
	}
	var skus map[string]ports.ProductSku
	err := savepointQuery(ctx, q, func(q database.Querier) error {
		var err error
		skus, err = h.p.Catalog.Skus(ctx, q, ids)
		return err
	})
	if err != nil {
		h.log.Warn("[order-item-sku] gagal resolve SKU", "error", err)
		return items
	}
	out := make([]*jsrow.Row, len(items))
	for i, it := range items {
		out[i] = it
		p := skus[it.Str("product_id")]
		sku := domain.PickDisplaySku(it.Str("product_sku"), deref(p.MasterKode), deref(p.PosSku))
		if sku != "" && sku != it.Str("product_sku") {
			c := it.Clone()
			c.Set("product_sku", sku)
			out[i] = c
		}
	}
	return out
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
