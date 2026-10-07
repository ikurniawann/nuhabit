package app

import (
	"context"
	"encoding/json"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/posops"
	"nuhabit/backend/internal/platform/database"
)

// Product sales and transaction report reads of pos-ops over pos-sales
// tables, ported from app/api/pos/reports/product-sales and transactions.
// Numeric and bigint columns are read as text like node-postgres.

type posOpsReportRows struct{}

var _ posops.ReportRows = posOpsReportRows{}

func (posOpsReportRows) ProductSales(ctx context.Context, q database.Querier, startIso, endIso string, warehouseIDs []string) ([]posops.ProductSalesRow, error) {
	// Omzet = pos_orders + items only. Do not join pos_checkouts totals.
	// SKU: the master code first; the i.product_sku snapshot may hold an old UUID.
	rows, err := q.Query(ctx, `SELECT
		i.product_id::text,
		COALESCE(MAX(i.product_name), MAX(pp.name), 'Unknown') AS product_name,
		COALESCE(MAX(p.kode), MAX(pp.sku), MAX(i.product_sku)) AS product_sku,
		p.warehouse_id::text,
		MAX(w.code) AS stall_code,
		MAX(w.name) AS stall_name,
		SUM(COALESCE(i.quantity, 0))::text AS quantity,
		SUM(COALESCE(i.total_amount, 0))::text AS revenue,
		COUNT(DISTINCT o.id)::text AS order_count
		FROM pos.pos_orders o
		INNER JOIN pos.pos_order_items i ON i.order_id = o.id
		LEFT JOIN pos.pos_products pp ON pp.id = i.product_id
		LEFT JOIN item.products p ON p.id = pp.source_product_id
		LEFT JOIN configuration.warehouses w ON w.id = p.warehouse_id
		WHERE o.ordered_at >= $1::text::timestamptz
		  AND o.ordered_at <= $2::text::timestamptz
		  AND o.status NOT IN ('cancelled', 'voided', 'merged')
		  AND (o.payment_status = 'paid' OR o.status = 'completed')
		  AND ($3::uuid[] IS NULL OR p.warehouse_id = ANY($3::uuid[]))
		GROUP BY i.product_id, p.warehouse_id
		ORDER BY SUM(COALESCE(i.total_amount, 0)) DESC, COALESCE(MAX(i.product_name), '') ASC`,
		startIso, endIso, warehouseIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (posops.ProductSalesRow, error) {
		var p posops.ProductSalesRow
		err := r.Scan(&p.ProductID, &p.ProductName, &p.ProductSku, &p.WarehouseID, &p.StallCode, &p.StallName,
			&p.Quantity, &p.Revenue, &p.OrderCount)
		return p, err
	})
}

func (posOpsReportRows) Transactions(ctx context.Context, q database.Querier, startIso, endIso string, warehouseIDs []string) ([]posops.TransactionRow, error) {
	rows, err := q.Query(ctx, `SELECT
		o.id::text, o.order_number, o.ordered_at, o.status::text, o.payment_status::text,
		o.payment_method::text, o.payment_method_code, o.payment_method_name,
		o.subtotal::text, o.discount_amount::text, o.tax_amount::text, o.service_charge_amount::text,
		o.total_amount::text, o.ark_coins_used::text, o.cashier_id::text,
		(o.ordered_at AT TIME ZONE 'Asia/Jakarta')::date::text AS hari_wib,
		COALESCE(o.warehouse_id, stall_from_item.warehouse_id)::text AS warehouse_id,
		COALESCE(w_order.code, stall_from_item.stall_code) AS stall_code,
		COALESCE(w_order.name, stall_from_item.stall_name) AS stall_name,
		o.checkout_id::text, o.sold_from::text,
		(to_jsonb(o) ->> 'comp_type') AS comp_type,
		(to_jsonb(o) ->> 'comp_approved_name') AS comp_approved_name,
		chk.checkout_number,
		COALESCE(o.xendit_qr_id, chk.xendit_qr_id) AS xendit_qr_id,
		COALESCE(o.xendit_external_id, chk.xendit_external_id) AS xendit_external_id
		FROM pos.pos_orders o
		LEFT JOIN pos.pos_checkouts chk ON chk.id = o.checkout_id
		LEFT JOIN configuration.warehouses w_order ON w_order.id = o.warehouse_id
		LEFT JOIN LATERAL (`+posOpsStallFromItem+`) stall_from_item ON o.warehouse_id IS NULL
		WHERE o.ordered_at >= $1::text::timestamptz
		  AND o.ordered_at <= $2::text::timestamptz
		  AND o.status NOT IN ('cancelled', 'voided', 'merged')
		  AND (o.payment_status = 'paid' OR o.status = 'completed')
		  AND ($3::uuid[] IS NULL OR o.warehouse_id = ANY($3::uuid[])
		       OR (o.warehouse_id IS NULL AND stall_from_item.warehouse_id = ANY($3::uuid[])))
		ORDER BY o.ordered_at DESC NULLS LAST`, startIso, endIso, warehouseIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (posops.TransactionRow, error) {
		var t posops.TransactionRow
		err := r.Scan(&t.ID, &t.OrderNumber, &t.OrderedAt, &t.Status, &t.PaymentStatus, &t.PaymentMethod,
			&t.PaymentMethodCode, &t.PaymentMethodName, &t.Subtotal, &t.DiscountAmount, &t.TaxAmount,
			&t.ServiceChargeAmount, &t.TotalAmount, &t.ArkCoinsUsed, &t.CashierID, &t.HariWib, &t.WarehouseID,
			&t.StallCode, &t.StallName, &t.CheckoutID, &t.SoldFrom, &t.CompType, &t.CompApprovedName,
			&t.CheckoutNumber, &t.XenditQrID, &t.XenditExternalID)
		return t, err
	})
}

func (posOpsReportRows) StallSales(ctx context.Context, q database.Querier, orderIDs []string) ([]posops.StallSalesRow, error) {
	// Per stall by ITEM: an order across stalls counts toward each item's stall.
	rows, err := q.Query(ctx, `SELECT COALESCE(w.code, w_sku.code) AS stall_code,
		COALESCE(w.name, w_sku.name) AS stall_name,
		COUNT(DISTINCT i.order_id)::text AS transactions,
		SUM(i.quantity)::float8 AS quantity,
		SUM(i.total_amount)::float8 AS sales
		FROM pos.pos_order_items i
		INNER JOIN pos.pos_products pp ON pp.id = i.product_id
		LEFT JOIN item.products p ON p.id = pp.source_product_id AND p.deleted_at IS NULL
		LEFT JOIN configuration.warehouses w ON w.id = p.warehouse_id
		LEFT JOIN item.products p_sku
		  ON pp.source_product_id IS NULL
		 AND pp.sku = ('PUR-' || p_sku.kode)
		 AND p_sku.deleted_at IS NULL
		 AND p_sku.kode IS NOT NULL
		 AND btrim(p_sku.kode) <> ''
		LEFT JOIN configuration.warehouses w_sku ON w_sku.id = p_sku.warehouse_id
		WHERE i.order_id = ANY($1::uuid[])
		GROUP BY 1, 2
		ORDER BY SUM(i.total_amount) DESC`, orderIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (posops.StallSalesRow, error) {
		var s posops.StallSalesRow
		err := r.Scan(&s.StallCode, &s.StallName, &s.Transactions, &s.Quantity, &s.Sales)
		return s, err
	})
}

func (posOpsReportRows) TopProducts(ctx context.Context, q database.Querier, orderIDs []string) ([]posops.TopProductRow, error) {
	rows, err := q.Query(ctx, `SELECT COALESCE(i.product_name, 'Tanpa Nama') AS product_name,
		SUM(i.quantity)::float8 AS quantity,
		SUM(i.total_amount)::float8 AS revenue
		FROM pos.pos_order_items i
		WHERE i.order_id = ANY($1::uuid[])
		GROUP BY 1
		ORDER BY SUM(i.total_amount) DESC
		LIMIT 50`, orderIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (posops.TopProductRow, error) {
		var p posops.TopProductRow
		err := r.Scan(&p.ProductName, &p.Quantity, &p.Revenue)
		return p, err
	})
}

// BrandName is resolveBrandName. Every read failure counts as "not set",
// as the TS .catch(() => null) does; ids compare as text so a malformed id
// does not abort the caller's transaction.
func (posOpsDirectory) BrandName(ctx context.Context, q database.Querier, companyID *string) string {
	companyName := func(id string) string {
		var name *string
		if id == "" || q.QueryRow(ctx, `SELECT name FROM configuration.companies WHERE id::text = $1`, id).Scan(&name) != nil || name == nil {
			return ""
		}
		return *name
	}
	if companyID != nil {
		if name := strings.TrimSpace(companyName(*companyID)); name != "" {
			return name
		}
	}
	// Only a jsonb string is a usable id: String() of anything else is
	// never a company id.
	var raw []byte
	var defaultCompany string
	if q.QueryRow(ctx, `SELECT value FROM crm.crm_settings WHERE key = 'default_company_id'`).Scan(&raw) == nil {
		_ = json.Unmarshal(raw, &defaultCompany)
	}
	var setting *string
	_ = q.QueryRow(ctx, `SELECT value FROM configuration.app_settings WHERE key = 'app_brand_name'`).Scan(&setting)
	candidates := []string{companyName(defaultCompany), "", os.Getenv("NEXT_PUBLIC_APP_NAME")}
	if setting != nil {
		candidates[1] = *setting
	}
	for _, c := range candidates {
		if name := strings.TrimSpace(c); name != "" {
			return name
		}
	}
	return "NüHabit"
}
