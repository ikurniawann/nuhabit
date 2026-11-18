package sales

import "testing"

// An order with several lines stores every line with its own values: the
// discount and variant columns stay NULL or empty on the lines without them.
func TestOrderItemsStoredPerLine(t *testing.T) {
	e := setup(t)
	out := e.call(true, "POST", "/api/pos/orders/open-bill", map[string]any{
		"items": []any{
			map[string]any{"product_id": e.fx.prodA, "product_name": "Kopi", "quantity": 2, "unit_price": 20000, "station": "bar",
				"discount_type": "percent", "discount_value": 10, "variants": []any{map[string]any{"name": "Oat"}}},
			map[string]any{"product_id": e.fx.prodA2, "product_name": "Teh", "quantity": 3, "unit_price": "8000",
				"modifiers": []any{map[string]any{"name": "Es", "price": 0}}},
			map[string]any{"product_id": e.fx.prodA, "product_name": "Kopi Susu", "quantity": 1, "unit_price": 22000.5,
				"discount_type": "fixed", "discount_value": 2000.5},
		},
		"table_id": "T7",
	}, 201)
	id := out["data"].(map[string]any)["id"]
	var lines string
	e.scalar(&lines, `SELECT string_agg(concat_ws('/', product_name, product_id = $2::uuid, COALESCE(sku_id::text, 'nosku'), quantity::float8, unit_price::float8,
		subtotal::float8, COALESCE(discount_type, '-'), COALESCE(discount_value::float8::text, '-'), discount_amount::float8, total_amount::float8,
		xp_earned, kitchen_status, inventory_deducted, cost_price::float8, cost_total::float8, gross_profit::float8, variants::text, modifiers::text), ' | ' ORDER BY product_name)
		FROM pos.pos_order_items WHERE order_id = $1`, id, e.fx.prodA)
	want := `Kopi/t/nosku/2/20000/40000/percent/10/4000/36000/0/pending/f/1000/2000/34000/[{"name": "Oat"}]/[]` +
		` | Kopi Susu/t/nosku/1/22000.5/22000.5/fixed/2000.5/2000/20000.5/0/pending/f/1000/1000/19000.5/[]/[]` +
		` | Teh/f/nosku/3/8000/24000/-/-/0/24000/0/pending/f/1000/3000/21000/[]/[{"name": "Es", "price": 0}]`
	if lines != want {
		t.Fatalf("lines\n got %s\nwant %s", lines, want)
	}
}
