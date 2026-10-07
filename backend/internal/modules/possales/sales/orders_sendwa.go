package sales

import (
	"encoding/json"
	"net/http"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// sendReceiptWa is POST /api/pos/orders/{id}/send-wa: the digital receipt,
// rebuilt from the database, sent by WhatsApp.
func (h *Handler) sendReceiptWa(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	orderID := r.PathValue("id")
	body := readObjOrEmpty(r)
	fail500 := func(err error) error {
		h.log.Error("[pos:send-wa] gagal", "error", err)
		return kit.Fail(w, 500, "Gagal mengirim struk")
	}
	var order *jsrow.Row
	_ = savepointQuery(ctx, h.db, func(q database.Querier) error {
		var err error
		order, err = jsrow.QueryOne(ctx, q, `SELECT "id", "order_number", "ordered_at", "total_amount", "discount_amount",
			"payment_method", "payment_method_code", "payment_method_name", "amount_paid", "payment_status",
			"branch_id", "warehouse_id", "checkout_id",
			(SELECT row_to_json(e) FROM (SELECT "name", "phone" FROM "pos"."pos_customers" WHERE "id" = "pos_orders"."customer_id") e) AS "customer",
			COALESCE((SELECT json_agg(e) FROM (SELECT "product_name", "quantity", "total_amount" FROM "pos"."pos_order_items" WHERE "order_id" = "pos_orders"."id") e), '[]'::json) AS "items"
			FROM "pos"."pos_orders" WHERE "id" = $1`, orderID)
		return err
	})
	if order == nil {
		return kit.Fail(w, 404, "Order tidak ditemukan")
	}
	if order.Str("payment_status") != "paid" {
		return kit.Fail(w, 400, "Struk hanya bisa dikirim untuk order yang sudah lunas")
	}
	var customer struct {
		Name  *string `json:"name"`
		Phone *string `json:"phone"`
	}
	if raw, ok := order.Get("customer").(json.RawMessage); ok {
		_ = json.Unmarshal(raw, &customer)
	}
	phoneRaw := deref(customer.Phone)
	if v := body.Get("phone"); !domain.IsNullish(v) {
		phoneRaw = domain.String(v)
	}
	phone := domain.NormalizeWaPhone(phoneRaw)
	if phone == "" {
		return kit.Fail(w, 400, "Nomor WA tidak valid — periksa kembali")
	}
	var outlet *string
	_ = h.db.QueryRow(ctx, `SELECT name FROM configuration.companies ORDER BY created_at LIMIT 1`).Scan(&outlet)
	footer, err := h.receiptFooter(r, order.Str("warehouse_id"), order.Str("branch_id"))
	if err != nil {
		return fail500(err)
	}
	var items []domain.ReceiptItem
	if raw, ok := order.Get("items").(json.RawMessage); ok {
		rows, _ := jsrow.ParseArray(raw)
		for _, it := range rows {
			items = append(items, domain.ReceiptItem{Name: it.Str("product_name"), Quantity: domain.Or(it.Num("quantity"), 1), Total: it.Num("total_amount")})
		}
	}
	total, paid, discount := order.Num("total_amount"), order.Num("amount_paid"), order.Num("discount_amount")
	number := firstStr(order.Str("order_number"), orderID)
	if cid := order.Str("checkout_id"); cid != "" {
		fam, err := jsrow.Query(ctx, h.db, `SELECT o.id, o.order_number, o.total_amount, o.discount_amount, o.amount_paid, w.name AS stall_name
           FROM pos.pos_orders o
           LEFT JOIN configuration.warehouses w ON w.id = o.warehouse_id
          WHERE o.checkout_id = $1
            AND o.status NOT IN ('cancelled', 'voided', 'merged')
          ORDER BY o.order_number`, cid)
		if err != nil {
			return fail500(err)
		}
		if len(fam) > 1 {
			ids := make([]string, len(fam))
			stall := map[string]string{}
			total, paid, discount = 0, 0, 0
			for i, f := range fam {
				ids[i] = f.Str("id")
				stall[f.Str("id")] = f.Str("stall_name")
				total += f.Num("total_amount")
				paid += f.Num("amount_paid")
				discount += f.Num("discount_amount")
			}
			famItems, err := jsrow.Query(ctx, h.db, `SELECT order_id, product_name, quantity, total_amount
             FROM pos.pos_order_items
            WHERE order_id = ANY($1::uuid[])
            ORDER BY order_id, id`, ids)
			if err != nil {
				return fail500(err)
			}
			items = items[:0]
			for _, it := range famItems {
				items = append(items, domain.ReceiptItem{Name: firstStr(it.Str("product_name"), "Item"), Quantity: domain.Or(it.Num("quantity"), 1),
					Total: it.Num("total_amount"), StallName: stall[it.Str("order_id")]})
			}
			var chk *string
			_ = h.db.QueryRow(ctx, `SELECT checkout_number FROM pos.pos_checkouts WHERE id = $1`, cid).Scan(&chk)
			if deref(chk) != "" {
				number = *chk
			}
		}
	}
	orderedAt := order.Time("ordered_at")
	if orderedAt.IsZero() {
		orderedAt = h.now()
	}
	message := domain.BuildOrderReceiptMessage(domain.OrderReceipt{
		OutletName: firstStr(deref(outlet), "Kasir"), OrderNumber: number, OrderedAt: orderedAt, Items: items,
		Total: total, PaymentMethod: domain.FormatPaymentMethodLabel(order.Str("payment_method"), order.Str("payment_method_code"), order.Str("payment_method_name")),
		Change: maxf(0, paid-total), Discount: discount, CustomerName: deref(customer.Name), FooterLines: footer,
	})
	res := h.p.Notifier.SendText(ctx, phone, message, "notification", user.ID)
	if !res.OK {
		return kit.Fail(w, 502, firstStr(res.Reason, "Gagal mengirim WA"))
	}
	return httpx.Data(w, 200, jsrow.Object("phone", phone))
}

// receiptFooter is resolveReceiptSettings(...).footer_lines for the order's
// stall: warehouse row, else branch row, else global row (pos-ops' table).
func (h *Handler) receiptFooter(r *http.Request, warehouseID, branchID string) ([]string, error) {
	rows, err := jsrow.Query(r.Context(), h.db, `SELECT * FROM pos.pos_receipt_settings WHERE is_active = true`)
	if err != nil {
		return nil, err
	}
	matchers := []func(*jsrow.Row) bool{
		func(row *jsrow.Row) bool { return warehouseID != "" && row.Str("warehouse_id") == warehouseID },
		func(row *jsrow.Row) bool {
			return branchID != "" && row.Str("branch_id") == branchID && row.Str("warehouse_id") == ""
		},
		func(row *jsrow.Row) bool { return row.Str("branch_id") == "" && row.Str("warehouse_id") == "" },
	}
	for _, match := range matchers {
		for _, row := range rows {
			if match(row) {
				return domain.NormalizeReceiptLines(jsonValue(row.Get("footer_lines"))), nil
			}
		}
	}
	return nil, nil
}

// jsonValue decodes a json column value (nil when absent).
func jsonValue(v any) any {
	raw, ok := v.(json.RawMessage)
	if !ok {
		return v
	}
	var out any
	_ = json.Unmarshal(raw, &out)
	return out
}
