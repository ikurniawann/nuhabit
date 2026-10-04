package posops

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/database"
)

// Catalog SQL. The list embeds reproduce the QueryBuilder's subqueries
// (row_to_json for many-to-one, json_agg for one-to-many) so the nested
// JSON matches; channels come from the Shop port.

const (
	categoryEmbed = `(SELECT row_to_json(e) FROM (SELECT name FROM pos.pos_categories WHERE id = pp.category_id) e) AS category`
	variantsEmbed = `COALESCE((SELECT json_agg(e) FROM (SELECT * FROM pos.pos_product_variants WHERE product_id = pp.id) e), '[]'::json) AS variants`
	skusEmbed     = `COALESCE((SELECT json_agg(e) FROM (SELECT * FROM pos.pos_product_skus WHERE product_id = pp.id) e), '[]'::json) AS skus`
	// channelsSlot keeps the channels key in place until the port fills it.
	channelsSlot   = `NULL::json AS channels`
	modifiersEmbed = `COALESCE((SELECT json_agg(e) FROM (
		SELECT (SELECT row_to_json(e) FROM (
			SELECT g.id, g.name, g.min_selection, g.max_selection, g.display_order,
			       COALESCE((SELECT json_agg(e) FROM (SELECT * FROM pos.pos_modifiers WHERE group_id = g.id) e), '[]'::json) AS modifiers
			FROM pos.pos_modifier_groups g WHERE g.id = pm.modifier_group_id) e) AS modifier_group
		FROM pos.pos_product_modifiers pm WHERE pm.product_id = pp.id) e), '[]'::json) AS modifiers`
)

// productFilter is GET /api/pos/products' filters.
type productFilter struct {
	IDs             []string // nil = every product
	IncludeInactive bool
	Category        *string
	Search          *string
}

func listCatalogProducts(ctx context.Context, q database.Querier, f productFilter) ([]*Obj, error) {
	var clauses []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	if f.IDs != nil {
		clauses = append(clauses, "pp.id = ANY("+arg(f.IDs)+"::text[]::uuid[])")
	}
	if !f.IncludeInactive {
		clauses = append(clauses, "pp.is_active = true", "pp.is_available = true")
	}
	if f.Category != nil {
		clauses = append(clauses, "pp.category_id = "+arg(*f.Category)+"::text::uuid")
	}
	if f.Search != nil {
		clauses = append(clauses, "pp.name ILIKE "+arg("%"+*f.Search+"%"))
	}
	where := ""
	if len(clauses) > 0 {
		where = " WHERE " + strings.Join(clauses, " AND ")
	}
	return QueryObjs(ctx, q, `SELECT pp.*, `+categoryEmbed+`, `+variantsEmbed+`, `+skusEmbed+`, `+channelsSlot+`, `+modifiersEmbed+`
		FROM pos.pos_products pp`+where+` ORDER BY pp.name ASC`, args...)
}

// productWithOptions is the POST response read: variants and modifiers.
func productWithOptions(ctx context.Context, q database.Querier, id string) (*Obj, error) {
	return QueryObj(ctx, q, `SELECT pp.*, `+variantsEmbed+`, `+modifiersEmbed+` FROM pos.pos_products pp WHERE pp.id = $1`, id)
}

// columnCasts maps a column to the SQL type its text parameter is cast to.
var columnCasts = map[string]string{
	"category_id": "uuid", "source_product_id": "uuid", "product_id": "uuid", "group_id": "uuid", "modifier_group_id": "uuid",
	"base_price": "numeric", "cost_price": "numeric", "inventory_quantity": "numeric", "weight_gram": "numeric",
	"length_cm": "numeric", "width_cm": "numeric", "height_cm": "numeric", "price_adjustment": "numeric",
	"price_override": "numeric", "stock_quantity": "numeric",
	"xp_points": "int", "min_xp": "int", "bonus_xp": "int", "display_order": "int", "min_selection": "int", "max_selection": "int",
	"is_active": "boolean", "is_available": "boolean", "inventory_tracking": "boolean",
	"updated_at": "timestamptz", "created_at": "timestamptz", "card_issued_at": "timestamptz", "is_kol": "boolean",
	"sales_channels": "text[]", "options": "jsonb",
}

// columnParam is the shim's parameter: JSON text for json columns, the
// node-postgres text form otherwise, with the cast that parses it.
func columnParam(name string, v any) (any, string) {
	cast := columnCasts[name]
	if cast == "jsonb" && v != nil {
		if _, isText := v.(string); !isText {
			b, _ := json.Marshal(v)
			v = string(b)
		}
	}
	if cast == "" {
		return nodeParam(v), "::text"
	}
	return nodeParam(v), "::text::" + cast
}

// insertRows inserts rows (all with the same columns) and returns them.
func insertRows(ctx context.Context, q database.Querier, table string, rows []domain.Columns, returning string) ([]*Obj, error) {
	if len(rows) == 0 {
		return nil, nil
	}
	var args []any
	values := make([]string, len(rows))
	names := make([]string, len(rows[0]))
	for i, c := range rows[0] {
		names[i] = c.Name
	}
	for r, cols := range rows {
		ph := make([]string, len(cols))
		for i, c := range cols {
			v, cast := columnParam(c.Name, c.Value)
			args = append(args, v)
			ph[i] = "$" + strconv.Itoa(len(args)) + cast
		}
		values[r] = "(" + strings.Join(ph, ", ") + ")"
	}
	sql := "INSERT INTO " + table + " (" + strings.Join(names, ", ") + ") VALUES " + strings.Join(values, ", ")
	if returning != "" {
		sql += " RETURNING " + returning
	}
	return QueryObjs(ctx, q, sql, args...)
}

func insertRow(ctx context.Context, q database.Querier, table string, cols domain.Columns, returning string) (*Obj, error) {
	rows, err := insertRows(ctx, q, table, []domain.Columns{cols}, returning)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// updateRows writes cols where every match column equals its value and
// returns the changed rows.
func updateRows(ctx context.Context, q database.Querier, table string, cols domain.Columns, match domain.Columns, returning string) ([]*Obj, error) {
	var args []any
	sets := make([]string, len(cols))
	for i, c := range cols {
		v, cast := columnParam(c.Name, c.Value)
		args = append(args, v)
		sets[i] = c.Name + " = $" + strconv.Itoa(len(args)) + cast
	}
	conds := make([]string, len(match))
	for i, c := range match {
		args = append(args, c.Value)
		conds[i] = c.Name + " = $" + strconv.Itoa(len(args)) + "::text::uuid"
	}
	sql := "UPDATE " + table + " SET " + strings.Join(sets, ", ") + " WHERE " + strings.Join(conds, " AND ")
	if returning != "" {
		sql += " RETURNING " + returning
	}
	return QueryObjs(ctx, q, sql, args...)
}

// productKindOf is SELECT id, sku, name, product_kind for the SKU routes.
func productKindOf(ctx context.Context, q database.Querier, id string) (*Obj, error) {
	return QueryObj(ctx, q, `SELECT id, sku, name, product_kind FROM pos.pos_products WHERE id = $1::text::uuid`, id)
}

func listProductSkus(ctx context.Context, q database.Querier, productID string) ([]*Obj, error) {
	return QueryObjs(ctx, q, `SELECT * FROM pos.pos_product_skus WHERE product_id = $1::text::uuid ORDER BY name ASC`, productID)
}

func deleteProductSku(ctx context.Context, q database.Querier, productID, skuID string) error {
	_, err := q.Exec(ctx, `DELETE FROM pos.pos_product_skus WHERE id = $1::text::uuid AND product_id = $2::text::uuid`, skuID, productID)
	return err
}

/* ── SKU matrix (one transaction, rows locked) ───────────────────────── */

const skuMatrixColumns = `id, product_id, sku, name, options, barcode, price_override, stock_quantity, is_active, created_at, updated_at`

func lockProductSkus(ctx context.Context, q database.Querier, productID string) ([]*Obj, error) {
	return QueryObjs(ctx, q, `SELECT `+skuMatrixColumns+` FROM pos.pos_product_skus WHERE product_id = $1 FOR UPDATE`, productID)
}

func reactivateSkus(ctx context.Context, q database.Querier, productID string, ids []string) ([]*Obj, error) {
	return QueryObjs(ctx, q, `UPDATE pos.pos_product_skus SET is_active = true, updated_at = now()
		WHERE product_id = $1 AND id = ANY($2::uuid[]) AND is_active = false
		RETURNING id, sku, name, options`, productID, ids)
}

func insertMatrixSku(ctx context.Context, q database.Querier, productID, sku, name, options string, barcode *string, price *float64) (*Obj, error) {
	return QueryObj(ctx, q, `INSERT INTO pos.pos_product_skus
		(product_id, sku, name, options, barcode, price_override, stock_quantity, is_active)
		VALUES ($1, $2, $3, $4::jsonb, $5, $6, 0, true)
		RETURNING `+skuMatrixColumns, productID, sku, name, options, barcode, price)
}

func deactivateSkus(ctx context.Context, q database.Querier, productID string, ids []string) ([]*Obj, error) {
	return QueryObjs(ctx, q, `UPDATE pos.pos_product_skus SET is_active = false, updated_at = now()
		WHERE product_id = $1 AND id = ANY($2::uuid[]) AND is_active = true
		RETURNING `+skuMatrixColumns, productID, ids)
}

func productSkusByName(ctx context.Context, q database.Querier, productID string) ([]*Obj, error) {
	return QueryObjs(ctx, q, `SELECT `+skuMatrixColumns+` FROM pos.pos_product_skus WHERE product_id = $1 ORDER BY name`, productID)
}

/* ── Purchasing sync ─────────────────────────────────────────────────── */

// posCategoryID finds a category by name (ILIKE, as the TS) or creates it;
// nil when the insert fails.
func posCategoryID(ctx context.Context, db database.DB, name string) (*string, error) {
	row, err := QueryObj(ctx, db, `SELECT id, name FROM pos.pos_categories WHERE name ILIKE $1 LIMIT 1`, name)
	if err != nil {
		return nil, err
	}
	if row != nil {
		return row.StrPtr("id"), nil
	}
	var id string
	if err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `INSERT INTO pos.pos_categories (name, is_active) VALUES ($1, true) RETURNING id::text`, name).Scan(&id)
	}); err != nil {
		return nil, nil
	}
	return &id, nil
}

func productIDBySku(ctx context.Context, q database.Querier, sku string) (*string, error) {
	row, err := QueryObj(ctx, q, `SELECT id FROM pos.pos_products WHERE sku = $1`, sku)
	if err != nil || row == nil {
		return nil, err
	}
	return row.StrPtr("id"), nil
}

// trackedPosStock lists active POS products with flat stock tracking.
func trackedPosStock(ctx context.Context, q database.Querier) ([]domain.PosStockRow, error) {
	rows, err := q.Query(ctx, `SELECT id::text, sku, name, inventory_quantity::text, inventory_min_stock::text
		FROM pos.pos_products WHERE is_active = true AND inventory_tracking = true`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.PosStockRow, error) {
		var p domain.PosStockRow
		err := r.Scan(&p.ID, &p.Sku, &p.Name, &p.Quantity, &p.MinStock)
		return p, err
	})
}
