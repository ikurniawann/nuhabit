package ticketing

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Ticket master (products-server.ts): list, detail, create, update. A
// product is a single ticket, a bundle (Fase P) or a season pass.

const productNotFound = "Ticket tidak ditemukan"

// lockProduct is lockProduct: the venue's product FOR UPDATE or 404.
func lockProduct(ctx context.Context, q database.Querier, v Venue, id string) (kind, status string, err error) {
	err = q.QueryRow(ctx, `SELECT product_kind, status FROM ticketing.ticket_products
		WHERE id = $1 AND branch_id = $2 AND company_id = $3
		FOR UPDATE`, id, v.BranchID, v.CompanyID).Scan(&kind, &status)
	if database.IsNoRows(err) {
		return "", "", httpx.NotFound(productNotFound)
	}
	return kind, status, err
}

// ListProducts is listProducts.
func (s *Service) ListProducts(ctx context.Context, v Venue, q string) ([]*Row, error) {
	where, args := "tp.branch_id = $1 AND tp.company_id = $2", []any{v.BranchID, v.CompanyID}
	if q != "" {
		args = append(args, "%"+q+"%")
		where += " AND (tp.name ILIKE $3 OR tp.code ILIKE $3)"
	}
	rows, err := queryRows(ctx, s.db, `SELECT tp.id, tp.code, tp.name, c.name AS category_name, tp.status,
		  tp.product_kind, tp.base_price, tp.cogs, tp.has_gate,
		  tp.thumbnail_url, tp.updated_at,
		  (SELECT COUNT(*) FROM ticketing.ticket_product_variants pv
		   WHERE pv.ticket_product_id = tp.id AND pv.is_active) AS variant_count,
		  (SELECT array_agg(ch.code) FROM ticketing.ticket_product_channels pc
		   JOIN ticketing.ticket_channels ch ON ch.id = pc.channel_id
		   WHERE pc.ticket_product_id = tp.id AND pc.is_distributed) AS distributed_channels
		FROM ticketing.ticket_products tp
		LEFT JOIN ticketing.ticket_categories c ON c.id = tp.category_id
		WHERE `+where+`
		ORDER BY tp.created_at DESC`, args...)
	for _, r := range rows {
		r.ToNum("base_price", "cogs", "variant_count")
		if r.Get("distributed_channels") == nil {
			r.Set("distributed_channels", []any{})
		}
	}
	return rows, err
}

// ProductDetail is getProductDetail.
func (s *Service) ProductDetail(ctx context.Context, v Venue, id string) (*Row, error) {
	product, err := queryRow(ctx, s.db, `SELECT tp.id, tp.code, tp.name, tp.category_id, c.name AS category_name,
		  tp.status, tp.product_kind, tp.base_price, tp.cogs, tp.has_gate,
		  tp.thumbnail_url,
		  tp.description, tp.re_entry_policy, tp.created_at, tp.updated_at
		FROM ticketing.ticket_products tp
		LEFT JOIN ticketing.ticket_categories c ON c.id = tp.category_id
		WHERE tp.id = $1 AND tp.branch_id = $2 AND tp.company_id = $3`, id, v.BranchID, v.CompanyID)
	if err != nil {
		return nil, err
	}
	if product == nil {
		return nil, httpx.NotFound(productNotFound)
	}
	bundleItems := []*Row{}
	if product.Str("product_kind") == "bundle" {
		if bundleItems, err = queryRows(ctx, s.db, `SELECT bi.id, bi.component_variant_id, bi.qty, bi.sort_order,
			  tp.id AS component_product_id, tp.code AS component_code,
			  tp.name AS product_name, pv.name AS variant_name,
			  tp.status AS component_status,
			  pv.is_active AS variant_is_active,
			  pv.price_regular, pv.price_high
			FROM ticketing.ticket_bundle_items bi
			JOIN ticketing.ticket_product_variants pv ON pv.id = bi.component_variant_id
			JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
			WHERE bi.bundle_product_id = $1
			ORDER BY bi.sort_order, bi.created_at`, id); err != nil {
			return nil, err
		}
	}
	variants, err := queryRows(ctx, s.db, `SELECT id, code, name, price_regular, price_high, sort_order, is_active
		FROM ticketing.ticket_product_variants
		WHERE ticket_product_id = $1
		ORDER BY sort_order`, id)
	if err != nil {
		return nil, err
	}
	dates, err := queryRows(ctx, s.db, `SELECT id, date_kind, label, start_date::text AS start_date,
		  end_date::text AS end_date, is_active
		FROM ticketing.ticket_product_dates
		WHERE ticket_product_id = $1
		ORDER BY start_date`, id)
	if err != nil {
		return nil, err
	}
	channels, err := queryRows(ctx, s.db, `SELECT pc.id, ch.code AS channel_code, ch.name AS channel_name,
		  ch.is_online, pc.is_distributed
		FROM ticketing.ticket_product_channels pc
		JOIN ticketing.ticket_channels ch ON ch.id = pc.channel_id
		WHERE pc.ticket_product_id = $1
		ORDER BY ch.sort_order`, id)
	if err != nil {
		return nil, err
	}
	for _, r := range append(append([]*Row{}, variants...), bundleItems...) {
		r.ToNumOrNull("price_regular", "price_high")
	}
	return object(
		"product", product.ToNum("base_price", "cogs"),
		"variants", variants,
		"dates", dates,
		"channels", channels,
		"bundle_items", bundleItems,
	), nil
}

// CreateProductInput is createProductSchema after parsing (defaults applied).
type CreateProductInput struct {
	Name                  string
	ProductKind           string
	ValidityMonths        int
	EntryPolicy           string
	VisitQuota            *int
	MemberDiscountPercent float64
	VariantPreset         string
	CategoryID            *string
	CategoryName          *string
	Status                string
	BasePrice             float64
	Cogs                  float64
	HasGate               bool
	Description           *string
	ReEntryPolicy         *string
}

type defaultVariant struct {
	code, name string
	sortOrder  int
}

// defaultVariantsFor is defaultVariantsFor: a bundle gets one "Paket",
// a season pass or the "umum" preset one "Umum", otherwise Adult/Child.
func defaultVariantsFor(kind, preset string) []defaultVariant {
	switch {
	case kind == "bundle":
		return []defaultVariant{{"paket", "Paket", 10}}
	case preset == "umum" || kind == "season_pass":
		return []defaultVariant{{"umum", "Umum", 10}}
	}
	return []defaultVariant{{"adult", "Adult", 10}, {"child", "Child", 20}}
}

// CreateProduct is createProduct: auto code TKT-#### per venue, default
// variants, walk-in distribution on and website off.
func (s *Service) CreateProduct(ctx context.Context, v Venue, in CreateProductInput) (string, string, error) {
	if in.ProductKind == "bundle" && in.Status == "active" {
		return "", "", httpx.BadRequest("Paket baru wajib berstatus Draft — lengkapi komposisi dulu")
	}
	if in.ProductKind == "season_pass" && in.EntryPolicy == "limited_visits" && (in.VisitQuota == nil || *in.VisitQuota <= 0) {
		return "", "", httpx.BadRequest("Kuota kunjungan wajib diisi untuk pass jenis punch-card (jatah kunjungan)")
	}
	var id, code string
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		reEntry := "sekali-masuk"
		if in.ReEntryPolicy != nil {
			reEntry = *in.ReEntryPolicy
		} else if err := tx.QueryRow(ctx, `SELECT re_entry_policy FROM ticketing.ticket_settings
			WHERE branch_id = $1 AND company_id = $2`, v.BranchID, v.CompanyID).Scan(&reEntry); err != nil && !database.IsNoRows(err) {
			return err
		}
		categoryID, _, err := resolveProductCategory(ctx, tx, v, false, in.CategoryID, in.CategoryName)
		if err != nil {
			return err
		}
		var next int
		if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(NULLIF(substring(code from 5), '')::int), 0) + 1
			FROM ticketing.ticket_products
			WHERE branch_id = $1 AND code ~ '^TKT-[0-9]+$'`, v.BranchID).Scan(&next); err != nil {
			return err
		}
		code = fmt.Sprintf("TKT-%04d", next)
		if err := tx.QueryRow(ctx, `INSERT INTO ticketing.ticket_products
			(company_id, branch_id, code, name, category_id, status, product_kind, base_price, cogs, has_gate,
			 description, re_entry_policy, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			RETURNING id::text`,
			v.CompanyID, v.BranchID, code, in.Name, categoryID, in.Status, in.ProductKind, in.BasePrice, in.Cogs,
			in.HasGate, orNil(in.Description), reEntry, v.UserID).Scan(&id); err != nil {
			return err
		}
		for _, dv := range defaultVariantsFor(in.ProductKind, in.VariantPreset) {
			if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_product_variants
				(company_id, branch_id, ticket_product_id, code, name, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
				v.CompanyID, v.BranchID, id, dv.code, dv.name, dv.sortOrder); err != nil {
				return err
			}
		}
		if in.ProductKind == "season_pass" {
			var quota *int
			if in.EntryPolicy == "limited_visits" {
				quota = in.VisitQuota
			}
			if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_pass_configs
				(company_id, branch_id, ticket_product_id, validity_months, entry_policy, visit_quota, member_discount_percent, created_by)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
				v.CompanyID, v.BranchID, id, in.ValidityMonths, in.EntryPolicy, quota, in.MemberDiscountPercent, v.UserID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, defaultChannelsSQL, v.CompanyID, v.BranchID, v.UserID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO ticketing.ticket_product_channels
			(company_id, branch_id, ticket_product_id, channel_id, is_distributed)
			SELECT $1, $2, $3, ch.id, (ch.code = 'walk-in')
			FROM ticketing.ticket_channels ch
			WHERE ch.branch_id = $2 AND ch.company_id = $1
			ON CONFLICT (ticket_product_id, channel_id) DO NOTHING`, v.CompanyID, v.BranchID, id)
		return err
	})
	return id, code, onDuplicate(err, "Tabrakan kode ticket — coba simpan sekali lagi")
}

// UpdateProductInput is updateProductSchema after parsing.
type UpdateProductInput struct {
	Fields        *patch // name, status, base_price, cogs, has_gate, description, re_entry_policy
	Status        *string
	CategoryIDSet bool
	CategoryID    *string
	CategoryName  *string
	Variants      []VariantPatch
}

// VariantPatch is one entry of the PATCH variants list.
type VariantPatch struct {
	ID     string
	Fields *patch
}

// UpdateProduct is updateProduct.
func (s *Service) UpdateProduct(ctx context.Context, v Venue, id string, in UpdateProductInput) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		kind, _, err := lockProduct(ctx, tx, v, id)
		if err != nil {
			return err
		}
		// A bundle only goes Active with a sellable composition.
		if in.Status != nil && *in.Status == "active" && kind == "bundle" {
			composition, err := loadBundleComposition(ctx, tx, v, id)
			if err != nil {
				return err
			}
			if issue := domain.BundleCompositionIssue(composition); issue != "" {
				return httpx.BadRequest("Paket belum bisa diaktifkan: " + issue)
			}
		}
		categoryID, set, err := resolveProductCategory(ctx, tx, v, in.CategoryIDSet, in.CategoryID, in.CategoryName)
		if err != nil {
			return err
		}
		fields := in.Fields
		if set {
			fields.add("category_id", categoryID)
		}
		if len(fields.values) > 0 {
			if _, err := tx.Exec(ctx, `UPDATE ticketing.ticket_products SET `+fields.sql()+` WHERE id = $1`,
				append([]any{id}, fields.values...)...); err != nil {
				return err
			}
		}
		// Back to Draft = no longer distributed anywhere.
		if in.Status != nil && *in.Status == "draft" {
			if _, err := tx.Exec(ctx, `UPDATE ticketing.ticket_product_channels
				SET is_distributed = false, updated_at = now()
				WHERE ticket_product_id = $1 AND is_distributed = true`, id); err != nil {
				return err
			}
		}
		for _, vp := range in.Variants {
			if len(vp.Fields.values) == 0 {
				continue
			}
			if _, err := tx.Exec(ctx, `UPDATE ticketing.ticket_product_variants SET `+vp.Fields.sql()+`
				WHERE id = $1 AND ticket_product_id = $2`, append([]any{vp.ID, id}, vp.Fields.values...)...); err != nil {
				return err
			}
		}
		return nil
	})
}
