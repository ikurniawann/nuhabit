package adapters

import (
	"context"
	"encoding/json"
	"log/slog"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/database"
)

// Merchandise ports lib/pos/merchandise-stock.ts: stock claims through
// pos_sell_merchandise_stock / pos_sell_merchandise_sku_stock.
type Merchandise struct {
	Log *slog.Logger
}

var _ ports.Merchandise = Merchandise{}

// sellStockResult is the jsonb the stock functions return.
type sellStockResult struct {
	Success *bool  `json:"success"`
	Skipped bool   `json:"skipped"`
	Reason  string `json:"reason"`
}

// aggregateMerch is aggregateByProduct: one claim per product+sku with the
// quantities summed; lines without a product or with qty <= 0 are skipped.
func aggregateMerch(lines []ports.MerchLine) []ports.MerchClaim {
	var out []ports.MerchClaim
	index := map[string]int{}
	for _, l := range lines {
		qty := domain.Or0(domain.Number(l.Quantity))
		if l.ProductID == "" || qty <= 0 {
			continue
		}
		key := l.ProductID + "::" + l.SkuID
		if i, ok := index[key]; ok {
			out[i].Qty += qty
			continue
		}
		index[key] = len(out)
		out = append(out, ports.MerchClaim{ProductID: l.ProductID, SkuID: l.SkuID, Qty: qty})
	}
	return out
}

// sellStock calls the per-SKU function when the claim has a sku, else the
// per-product one, in a savepoint.
func sellStock(ctx context.Context, q database.Querier, c ports.MerchClaim, qty float64) (sellStockResult, error) {
	sql, id := `SELECT pos_sell_merchandise_stock(p_product_id := $1, p_qty := $2)`, c.ProductID
	if c.SkuID != "" {
		sql, id = `SELECT pos_sell_merchandise_sku_stock(p_sku_id := $1, p_qty := $2)`, c.SkuID
	}
	var raw []byte
	err := savepoint(ctx, q, func(q database.Querier) error {
		return q.QueryRow(ctx, sql, id, qty).Scan(&raw)
	})
	var res sellStockResult
	if err == nil && raw != nil {
		_ = json.Unmarshal(raw, &res)
	}
	return res, err
}

// Claim is claimMerchandiseStock.
func (m Merchandise) Claim(ctx context.Context, q database.Querier, lines []ports.MerchLine) ([]ports.MerchClaim, int, string, error) {
	claims := []ports.MerchClaim{}
	for _, target := range aggregateMerch(lines) {
		res, err := sellStock(ctx, q, target, target.Qty)
		if err != nil {
			m.logger().Error("[pos] merch stock claim error", "product", target.ProductID, "sku", skuLabel(target.SkuID), "error", err.Error())
			m.Restore(ctx, q, claims)
			return nil, 500, "Gagal memproses stok merchandise", nil
		}
		if res.Success != nil && !*res.Success {
			m.Restore(ctx, q, claims)
			name := productName(ctx, q, target.ProductID)
			switch res.Reason {
			case "variant_required":
				return nil, 400, name + " punya varian — pilih varian dulu sebelum dijual", nil
			case "sku_not_found":
				return nil, 400, "Varian " + name + " tidak ditemukan/nonaktif — muat ulang katalog", nil
			}
			return nil, 400, "Stok " + name + " tidak cukup untuk jumlah yang diminta", nil
		}
		if !res.Skipped {
			claims = append(claims, target)
		}
	}
	return claims, 0, "", nil
}

// Restore is restoreMerchandiseStock: failures are logged.
func (m Merchandise) Restore(ctx context.Context, q database.Querier, claims []ports.MerchClaim) {
	for _, c := range claims {
		m.RestoreOne(ctx, q, c)
	}
}

// RestoreOne gives one claim back; false when the function call failed.
func (m Merchandise) RestoreOne(ctx context.Context, q database.Querier, c ports.MerchClaim) bool {
	if _, err := sellStock(ctx, q, c, -c.Qty); err != nil {
		m.logger().Error("[pos] merch stock restore failed", "product", c.ProductID, "sku", skuLabel(c.SkuID), "qty", c.Qty, "error", err.Error())
		return false
	}
	return true
}

// HasTracked is hasTrackedMerchandise (lookup errors → false).
func (m Merchandise) HasTracked(ctx context.Context, q database.Querier, productIDs []string) bool {
	ids := uniqueIDs(productIDs)
	if len(ids) == 0 {
		return false
	}
	var found bool
	err := savepoint(ctx, q, func(q database.Querier) error {
		return q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pos.pos_products
			WHERE id = ANY($1::uuid[]) AND product_kind = 'merchandise' AND inventory_tracking = true)`, ids).Scan(&found)
	})
	if err != nil {
		m.logger().Error("[pos] merch lookup failed", "error", err.Error())
		return false
	}
	return found
}

// productName is resolveProductName: the name, or "produk".
func productName(ctx context.Context, q database.Querier, productID string) string {
	var name *string
	_ = savepoint(ctx, q, func(q database.Querier) error {
		return q.QueryRow(ctx, `SELECT name FROM pos.pos_products WHERE id = $1`, productID).Scan(&name)
	})
	if name == nil || *name == "" {
		return "produk"
	}
	return *name
}

func skuLabel(sku string) string {
	if sku == "" {
		return "-"
	}
	return sku
}

func (m Merchandise) logger() *slog.Logger {
	if m.Log == nil {
		return slog.Default()
	}
	return m.Log
}
