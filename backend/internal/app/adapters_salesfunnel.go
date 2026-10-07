package app

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/accounting"
	"nuhabit/backend/internal/modules/salesfunnel"
	sfdomain "nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Adapters for the sales-funnel ports: the SQL lib/sales-funnel ran on other
// contexts' tables (configuration.users, pos.pos_products/pos_recipes/
// pos_customers/pos_orders, item.raw_materials, inventory.inventory,
// crm.crm_custom_fields/crm_settings/wa_messages, crm_member_profiles) and
// accounting's AR service. Each moves to its owner's service once that
// module exposes the operation.

var (
	_ salesfunnel.Directory   = salesFunnelDirectory{}
	_ salesfunnel.Catalog     = salesFunnelCatalog{}
	_ salesfunnel.Stock       = salesFunnelStock{}
	_ salesfunnel.Members     = salesFunnelMembers{}
	_ salesfunnel.CRM         = salesFunnelCRM{}
	_ salesfunnel.Receivables = salesFunnelReceivables{}
)

/* ── Directory (configuration.users) ─────────────────────────────────── */

type salesFunnelDirectory struct{}

func (salesFunnelDirectory) Owners(ctx context.Context, q database.Querier, companyID *string) ([]*pgrow.Row, error) {
	return pgrow.Query(ctx, q, `SELECT id, full_name, role, company_id FROM configuration.users
     WHERE status = 'active' AND role IN ('sales', 'admin', 'super_admin', 'marketing', 'hrd')
       AND ($1::uuid IS NULL OR company_id IS NULL OR company_id = $1)
     ORDER BY role, full_name LIMIT 200`, companyID)
}

func (salesFunnelDirectory) Assignee(ctx context.Context, q database.Querier, userID string) (string, *string, bool, error) {
	var role string
	var company *string
	err := q.QueryRow(ctx, `SELECT role::text, company_id::text FROM configuration.users WHERE id = $1`, userID).Scan(&role, &company)
	if database.IsNoRows(err) {
		return "", nil, false, nil
	}
	return role, company, err == nil, err
}

func (salesFunnelDirectory) ForecastUsers(ctx context.Context, q database.Querier, companyID, onlyUserID *string) ([]sfdomain.ForecastUser, error) {
	sql := `SELECT id::text, full_name FROM configuration.users
     WHERE status = 'active' AND role IN ('sales', 'admin', 'super_admin') AND ($1::uuid IS NULL OR company_id IS NULL OR company_id = $1)`
	args := []any{companyID}
	if onlyUserID != nil {
		sql += ` AND id = $2`
		args = append(args, *onlyUserID)
	}
	rows, err := q.Query(ctx, sql+` ORDER BY full_name`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (sfdomain.ForecastUser, error) {
		var u sfdomain.ForecastUser
		var name *string
		err := r.Scan(&u.ID, &name)
		if name != nil {
			u.Name = *name
		}
		return u, err
	})
}

/* ── Catalog (pos.pos_products, pos.pos_recipes, item.raw_materials) ─── */

type salesFunnelCatalog struct{}

func (salesFunnelCatalog) Products(ctx context.Context, q database.Querier) ([]*pgrow.Row, error) {
	return pgrow.Query(ctx, q, `SELECT id, name, base_price
     FROM pos.pos_products
     WHERE is_active = true
     ORDER BY name ASC
     LIMIT 200`)
}

func (salesFunnelCatalog) ActiveProductCount(ctx context.Context, q database.Querier, ids []string) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM pos.pos_products WHERE id = ANY($1::uuid[]) AND is_active = true`, ids).Scan(&n)
	return n, err
}

func (salesFunnelCatalog) SearchRawMaterials(ctx context.Context, q database.Querier, term string, companyID, branchID *string) ([]*pgrow.Row, error) {
	where := sfdomain.NewWhere([]string{"rm.is_active = true", "rm.deleted_at IS NULL"}, 1)
	like := where.Param("%" + term + "%")
	where.Push("(rm.nama ILIKE " + like + " OR rm.kode ILIKE " + like + ")")
	if companyID != nil {
		where.Add("(rm.company_id IS NULL OR rm.company_id = ?)", *companyID)
	}
	if branchID != nil {
		where.Add("(rm.branch_id IS NULL OR rm.branch_id = ?)", *branchID)
	}
	return pgrow.Query(ctx, q, `SELECT rm.id, rm.kode, rm.nama, u.nama AS satuan_kecil
     FROM item.raw_materials rm
     LEFT JOIN item.units u ON u.id = rm.satuan_kecil_id
     WHERE `+where.SQL()+`
     ORDER BY rm.nama ASC
     LIMIT 20`, where.Params...)
}

func (salesFunnelCatalog) Recipe(ctx context.Context, q database.Querier, productID string) ([]*pgrow.Row, error) {
	return pgrow.Query(ctx, q, `SELECT r.id, r.raw_material_id, r.quantity_per_unit,
            r.unit_of_measure, r.waste_percentage,
            rm.kode AS material_kode, rm.nama AS material_nama,
            u.nama AS satuan_kecil
     FROM pos.pos_recipes r
     JOIN item.raw_materials rm ON rm.id = r.raw_material_id
     LEFT JOIN item.units u ON u.id = rm.satuan_kecil_id
     WHERE r.product_id = $1 AND r.is_active = true
     ORDER BY rm.nama ASC`, productID)
}

// ReplaceRecipe derives each line's unit from the material's small unit
// (input units are ignored, as in the TS).
func (salesFunnelCatalog) ReplaceRecipe(ctx context.Context, tx database.Querier, productID string, items []salesfunnel.RecipeItem) error {
	var found bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pos.pos_products WHERE id = $1 AND is_active = true)`, productID).Scan(&found); err != nil {
		return err
	}
	if !found {
		return httpx.BadRequest("Produk tidak ditemukan")
	}
	units := map[string]string{}
	if len(items) > 0 {
		ids := make([]string, len(items))
		for i, it := range items {
			ids[i] = it.RawMaterialID
		}
		rows, err := tx.Query(ctx, `SELECT rm.id::text, LEFT(COALESCE(u.nama, 'unit'), 20)
         FROM item.raw_materials rm
         LEFT JOIN item.units u ON u.id = rm.satuan_kecil_id
         WHERE rm.id = ANY($1::uuid[]) AND rm.is_active = true
           AND rm.deleted_at IS NULL`, ids)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id, unit string
			if err := rows.Scan(&id, &unit); err != nil {
				rows.Close()
				return err
			}
			units[id] = unit
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if len(units) != len(items) {
			return httpx.BadRequest("Ada bahan baku yang tidak ditemukan atau nonaktif")
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM pos.pos_recipes WHERE product_id = $1`, productID); err != nil {
		return err
	}
	for _, it := range items {
		if _, err := tx.Exec(ctx, `INSERT INTO pos.pos_recipes
           (product_id, raw_material_id, quantity_per_unit,
            unit_of_measure, waste_percentage, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`, productID, it.RawMaterialID, it.QuantityPerUnit, units[it.RawMaterialID], it.WastePercentage); err != nil {
			return err
		}
	}
	return nil
}

func (salesFunnelCatalog) MaterialNeeds(ctx context.Context, q database.Querier, lines []salesfunnel.ProductQty) ([]sfdomain.MaterialRequirement, error) {
	ids, qtys := make([]string, len(lines)), make([]string, len(lines))
	for i, l := range lines {
		ids[i], qtys[i] = l.ProductID, l.Qty
	}
	rows, err := pgrow.Query(ctx, q, `SELECT r.raw_material_id::text AS raw_material_id,
            SUM(i.qty * r.quantity_per_unit * (1 + COALESCE(r.waste_percentage, 0) / 100)) AS needed
       FROM unnest($1::uuid[], $2::numeric[]) AS i(product_id, qty)
       JOIN pos.pos_recipes r ON r.product_id = i.product_id AND r.is_active = true
      GROUP BY r.raw_material_id`, ids, qtys)
	if err != nil {
		return nil, err
	}
	out := make([]sfdomain.MaterialRequirement, len(rows))
	for i, row := range rows {
		out[i] = sfdomain.MaterialRequirement{RawMaterialID: row.Str("raw_material_id"), Needed: row.Num("needed")}
	}
	return out, nil
}

func (salesFunnelCatalog) ProductsWithoutRecipe(ctx context.Context, q database.Querier, productIDs []string) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT DISTINCT p.name
       FROM unnest($1::uuid[]) AS i(product_id)
       JOIN pos.pos_products p ON p.id = i.product_id
      WHERE NOT EXISTS (
        SELECT 1 FROM pos.pos_recipes r
         WHERE r.product_id = i.product_id AND r.is_active = true)`, productIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

/* ── Stock (inventory.inventory, inventory_movements) ────────────────── */

type salesFunnelStock struct{}

func (salesFunnelStock) LockStock(ctx context.Context, tx database.Querier, branchID string, materialIDs []string) ([]sfdomain.StockRow, error) {
	rows, err := pgrow.Query(ctx, tx, `SELECT id::text AS id, raw_material_id::text AS raw_material_id, warehouse_id::text AS warehouse_id, qty_available
     FROM inventory.inventory
     WHERE raw_material_id = ANY($1::uuid[])
       AND branch_id = $2 AND is_active = true
     ORDER BY id ASC
     FOR UPDATE`, materialIDs, branchID)
	if err != nil {
		return nil, err
	}
	out := make([]sfdomain.StockRow, len(rows))
	for i, row := range rows {
		out[i] = sfdomain.StockRow{ID: row.Str("id"), RawMaterialID: row.Str("raw_material_id"), WarehouseID: row.StrPtr("warehouse_id"),
			QtyAvailable: row.Num("qty_available")}
	}
	return out, nil
}

func (salesFunnelStock) Material(ctx context.Context, tx database.Querier, id string) (salesfunnel.MaterialInfo, error) {
	var m salesfunnel.MaterialInfo
	var nama *string
	err := tx.QueryRow(ctx, `SELECT rm.kode, rm.nama, u.nama
     FROM item.raw_materials rm
     LEFT JOIN item.units u ON u.id = rm.satuan_kecil_id
     WHERE rm.id = $1`, id).Scan(&m.Kode, &nama, &m.Satuan)
	if database.IsNoRows(err) {
		return m, nil
	}
	if err != nil {
		return m, err
	}
	m.Found = nama != nil
	if nama != nil {
		m.Nama = *nama
	}
	return m, nil
}

func (salesFunnelStock) Deduct(ctx context.Context, tx database.Querier, m salesfunnel.StockMove) error {
	s := m.Step
	if _, err := tx.Exec(ctx, `UPDATE inventory.inventory
     SET qty_available = $1, last_movement_at = now(), updated_at = now(), updated_by = $2
     WHERE id = $3`, s.After, m.UserID, s.InventoryID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO inventory.inventory_movements
       (inventory_id, raw_material_id, tipe, jumlah, qty_before,
        qty_after, reference_type, reference_id, reference_number,
        alasan, created_by, branch_id, warehouse_id)
     VALUES ($1, $2, 'out', $3, $4, $5, 'sales_realization', $6, $7, $8, $9, $10, $11)`,
		s.InventoryID, s.RawMaterialID, s.Take, s.Before, s.After, m.QuotationID, m.QuoteNumber,
		"Realisasi quotation "+m.QuoteNumber, m.UserID, m.BranchID, s.WarehouseID)
	return err
}

/* ── Members (pos.pos_customers, pos.pos_orders, crm_member_profiles) ── */

type salesFunnelMembers struct{}

func (salesFunnelMembers) Search(ctx context.Context, q database.Querier, term, phoneLike string) ([]*pgrow.Row, error) {
	return pgrow.Query(ctx, q, `SELECT id, name, phone, membership_tier
     FROM pos.pos_customers
     WHERE is_active = true
       AND (name ILIKE $1 OR phone LIKE $2)
     ORDER BY name ASC
     LIMIT 10`, term, phoneLike)
}

func (salesFunnelMembers) Summary(ctx context.Context, q database.Querier, id string) (*pgrow.Row, error) {
	return pgrow.QueryOne(ctx, q, `SELECT id, name, phone, membership_tier, total_xp, ark_coin_balance,
                total_spent, visit_count, last_visit, is_active
         FROM pos.pos_customers WHERE id = $1`, id)
}

func (salesFunnelMembers) RecentOrders(ctx context.Context, q database.Querier, customerID string) ([]*pgrow.Row, error) {
	return pgrow.Query(ctx, q, `SELECT id, total_amount, status, payment_status, created_at
         FROM pos.pos_orders
         WHERE customer_id = $1
         ORDER BY created_at DESC
         LIMIT 5`, customerID)
}

// UpsertFromPic upserts by phone, then enrols the regular tier; a missing
// CRM loyalty schema (42P01) skips the enrolment, any other error fails.
func (salesFunnelMembers) UpsertFromPic(ctx context.Context, db database.DB, lead salesfunnel.PicLead) (string, error) {
	var id string
	err := db.QueryRow(ctx, `INSERT INTO pos.pos_customers (name, phone, email, city, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (phone) DO UPDATE
       SET is_active = true, updated_at = now()
     RETURNING id::text`, lead.PicName, lead.PicPhone, lead.PicEmail, lead.City,
		"PIC "+lead.OrgName+" — didaftarkan dari Sales Funneling").Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	err = database.WithTx(ctx, db, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO crm.crm_member_profiles
         (customer_id, tier_id, lifetime_xp, loyalty_score, status, last_activity_at)
       SELECT $1, t.id, 0, 0, 'active', now()
       FROM crm.crm_membership_tiers t
       WHERE t.code = 'regular'
       ON CONFLICT (customer_id) DO NOTHING`, id)
		return err
	})
	if err != nil && !database.IsUndefinedTable(err) {
		return "", err
	}
	return id, nil
}

/* ── CRM (custom fields, settings, WhatsApp log) ──────────────────────── */

type salesFunnelCRM struct{}

const customFieldSQL = `SELECT id, object, key, label, field_type, options, is_required, validation, help_text, show_in_list, sort_order
     FROM crm.crm_custom_fields
     WHERE is_active AND object = $1 AND (company_id IS NULL OR company_id = $2)
     ORDER BY sort_order, created_at`

func (salesFunnelCRM) CustomFieldRows(ctx context.Context, q database.Querier, object string, companyID *string) ([]*pgrow.Row, error) {
	return pgrow.Query(ctx, q, customFieldSQL, object, companyID)
}

func (c salesFunnelCRM) CustomFieldDefs(ctx context.Context, q database.Querier, object string, companyID *string) ([]sfdomain.CustomFieldDef, error) {
	rows, err := c.CustomFieldRows(ctx, q, object, companyID)
	if err != nil {
		return nil, err
	}
	defs := make([]sfdomain.CustomFieldDef, len(rows))
	for i, row := range rows {
		d := sfdomain.CustomFieldDef{Key: row.Str("key"), Label: row.Str("label"), FieldType: row.Str("field_type"), IsRequired: row.Bool("is_required")}
		if raw, ok := row.Get("options").(json.RawMessage); ok {
			_ = json.Unmarshal(raw, &d.Options)
		}
		if raw, ok := row.Get("validation").(json.RawMessage); ok {
			_ = json.Unmarshal(raw, &d.Validation)
		}
		defs[i] = d
	}
	return defs, nil
}

// DefaultVenue reads the CRM default venue; any read failure counts as
// unset, as the TS catch does.
func (salesFunnelCRM) DefaultVenue(ctx context.Context, q database.Querier) (*string, *string, error) {
	rows, err := q.Query(ctx, `SELECT key, value #>> '{}' FROM crm.crm_settings
       WHERE key IN ('default_company_id', 'default_branch_id') AND jsonb_typeof(value) = 'string'`)
	if err != nil {
		return nil, nil, nil
	}
	defer rows.Close()
	var company, branch *string
	for rows.Next() {
		var key string
		var value *string
		if rows.Scan(&key, &value) != nil || value == nil || *value == "" {
			continue
		}
		switch key {
		case "default_company_id":
			company = value
		case "default_branch_id":
			branch = value
		}
	}
	return company, branch, nil
}

func (salesFunnelCRM) WaMessages(ctx context.Context, q database.Querier, suffixes []string) ([]*pgrow.Row, error) {
	return pgrow.Query(ctx, q, `SELECT m.id, m.direction, m.body, m.status, m.created_at, u.full_name AS sender_name
       FROM crm.wa_messages m
       LEFT JOIN configuration.users u ON u.id = m.sent_by_user_id
       WHERE right(regexp_replace(m.phone, '[^0-9]', '', 'g'), 9) = ANY($1::text[])
       ORDER BY m.created_at DESC LIMIT 100`, suffixes)
}

func (salesFunnelCRM) LeadConsents(ctx context.Context, q database.Querier, leadID string) ([]*pgrow.Row, error) {
	return pgrow.Query(ctx, q, `SELECT id, channel, granted, consent_text_version, source_path, created_at
       FROM crm.lead_consents WHERE lead_id = $1
       ORDER BY created_at DESC, channel`, leadID)
}

/* ── Receivables (accounting AR) ──────────────────────────────────────── */

// salesFunnelReceivables posts the AR invoice through accounting's service
// on the caller's database handle.
type salesFunnelReceivables struct{ svc *accounting.Service }

func (r salesFunnelReceivables) CreateFromSalesInvoice(ctx context.Context, db database.DB, salesInvoiceID, userID string) (string, *string, error) {
	inv, err := r.svc.CreateArFromSalesInvoice(ctx, db, salesInvoiceID, userID)
	if err != nil {
		return "", nil, err
	}
	return inv.InvoiceNo, nil, nil
}
