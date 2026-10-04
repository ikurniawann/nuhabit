package ticketing

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Selling settings per ticket (product-sales-server.ts): channel price
// overrides, distribution toggles, bundle composition, the Channel Manager
// board and the loket options.

// ChannelPrice is one variant's override on a channel (nil = follow the variant).
type ChannelPrice struct {
	VariantID    string
	PriceRegular *float64
	PriceHigh    *float64
}

// SaveChannelPrices is saveChannelPrices: both prices nil deletes the
// override row.
func (s *Service) SaveChannelPrices(ctx context.Context, v Venue, productID, channelID string, prices []ChannelPrice) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		if _, _, err := lockProduct(ctx, tx, v, productID); err != nil {
			return err
		}
		var known bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ticketing.ticket_channels
			WHERE id = $1 AND branch_id = $2 AND company_id = $3)`, channelID, v.BranchID, v.CompanyID).Scan(&known); err != nil {
			return err
		}
		if !known {
			return httpx.BadRequest("Kanal tidak dikenal")
		}
		ids := make([]string, len(prices))
		distinct := map[string]bool{}
		for i, p := range prices {
			ids[i] = p.VariantID
			distinct[p.VariantID] = true
		}
		var owned int
		if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM ticketing.ticket_product_variants
			WHERE ticket_product_id = $1 AND id = ANY($2) AND is_active = true`, productID, ids).Scan(&owned); err != nil {
			return err
		}
		if owned != len(distinct) {
			return httpx.BadRequest("Ada varian yang bukan milik ticket ini / sudah nonaktif")
		}
		for _, p := range prices {
			if p.PriceRegular == nil && p.PriceHigh == nil {
				if _, err := tx.Exec(ctx, `DELETE FROM ticketing.ticket_variant_channel_prices
					WHERE variant_id = $1 AND channel_id = $2`, p.VariantID, channelID); err != nil {
					return err
				}
				continue
			}
			if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_variant_channel_prices
				(company_id, branch_id, variant_id, channel_id, price_regular, price_high)
				VALUES ($1, $2, $3, $4, $5, $6)
				ON CONFLICT (variant_id, channel_id) DO UPDATE SET
				  price_regular = EXCLUDED.price_regular, price_high = EXCLUDED.price_high, updated_at = now()`,
				v.CompanyID, v.BranchID, p.VariantID, channelID, p.PriceRegular, p.PriceHigh); err != nil {
				return err
			}
		}
		return nil
	})
}

// SetDistribution is setChannelDistribution: turning a channel on needs
// an Active ticket whose active variants are all priced for both seasons
// on that channel; turning it off is always allowed.
func (s *Service) SetDistribution(ctx context.Context, v Venue, productID, channelID string, distributed bool) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		_, status, err := lockProduct(ctx, tx, v, productID)
		if err != nil {
			return err
		}
		var known bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ticketing.ticket_channels
			WHERE id = $1 AND branch_id = $2 AND company_id = $3 AND is_active = true)`, channelID, v.BranchID, v.CompanyID).Scan(&known); err != nil {
			return err
		}
		if !known {
			return httpx.BadRequest("Kanal tidak dikenal")
		}
		if distributed {
			if status != "active" {
				return httpx.BadRequest("Ticket masih Draft — aktifkan dulu sebelum didistribusi")
			}
			variants, err := variantPrices(ctx, tx, `WHERE ticket_product_id = $1 AND is_active = true`, productID)
			if err != nil {
				return err
			}
			if len(variants) == 0 {
				return httpx.BadRequest("Ticket tidak punya varian aktif")
			}
			ids := make([]string, len(variants))
			for i, vp := range variants {
				ids[i] = vp.ID
			}
			overrides, err := overridePairs(ctx, tx, `WHERE channel_id = $1 AND variant_id = ANY($2)`, channelID, ids)
			if err != nil {
				return err
			}
			byVariant := map[string]domain.PricePair{}
			for key, pair := range overrides {
				byVariant[key.variantID] = pair
			}
			if incomplete := domain.FirstIncompleteVariant(variants, byVariant); incomplete != nil {
				return httpx.BadRequest(`Harga varian "` + incomplete.Name + `" belum lengkap (Regular & High Season) untuk kanal ini`)
			}
		}
		_, err = tx.Exec(ctx, `INSERT INTO ticketing.ticket_product_channels
			(company_id, branch_id, ticket_product_id, channel_id, is_distributed)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (ticket_product_id, channel_id) DO UPDATE SET
			  is_distributed = EXCLUDED.is_distributed, updated_at = now()`,
			v.CompanyID, v.BranchID, productID, channelID, distributed)
		return err
	})
}

func variantPrices(ctx context.Context, q database.Querier, where string, args ...any) ([]domain.VariantPrice, error) {
	var out []domain.VariantPrice
	err := scanAll(ctx, q, `SELECT id::text, name, price_regular::float8, price_high::float8
		FROM ticketing.ticket_product_variants `+where, args, func(scan func(...any) error) error {
		var vp domain.VariantPrice
		err := scan(&vp.ID, &vp.Name, &vp.Regular, &vp.High)
		out = append(out, vp)
		return err
	})
	return out, err
}

type overrideKey struct{ variantID, channelID string }

func overridePairs(ctx context.Context, q database.Querier, where string, args ...any) (map[overrideKey]domain.PricePair, error) {
	out := map[overrideKey]domain.PricePair{}
	err := scanAll(ctx, q, `SELECT variant_id::text, channel_id::text, price_regular::float8, price_high::float8
		FROM ticketing.ticket_variant_channel_prices `+where, args, func(scan func(...any) error) error {
		var k overrideKey
		var p domain.PricePair
		err := scan(&k.variantID, &k.channelID, &p.Regular, &p.High)
		out[k] = p
		return err
	})
	return out, err
}

// BundleItem is one composition line to save.
type BundleItem struct {
	ComponentVariantID string
	Qty                int
}

// SaveBundleItems is saveBundleItems: replace-all; components must be
// active variants of Active single tickets of the venue.
func (s *Service) SaveBundleItems(ctx context.Context, v Venue, productID string, items []BundleItem) error {
	ids := make([]string, len(items))
	seen := map[string]bool{}
	for i, it := range items {
		if seen[it.ComponentVariantID] {
			return httpx.BadRequest("Ada komponen yang sama dipilih dua kali")
		}
		seen[it.ComponentVariantID] = true
		ids[i] = it.ComponentVariantID
	}
	return s.inTx(ctx, func(tx pgx.Tx) error {
		kind, status, err := lockProduct(ctx, tx, v, productID)
		if err != nil {
			return err
		}
		if kind != "bundle" {
			return httpx.BadRequest("Komposisi hanya berlaku untuk produk paket")
		}
		if status == "active" && len(items) == 0 {
			return httpx.BadRequest("Paket Active tidak boleh tanpa komposisi — turunkan ke Draft dulu")
		}
		if len(ids) > 0 {
			var valid int
			if err := tx.QueryRow(ctx, `SELECT COUNT(*)
				FROM ticketing.ticket_product_variants pv
				JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
				WHERE pv.id = ANY($1) AND pv.branch_id = $2 AND pv.company_id = $3
				  AND pv.is_active = true AND tp.status = 'active' AND tp.product_kind = 'single'`,
				ids, v.BranchID, v.CompanyID).Scan(&valid); err != nil {
				return err
			}
			if valid != len(ids) {
				return httpx.BadRequest("Ada komponen yang bukan tiket satuan Active — paket hanya boleh berisi varian tiket satuan yang aktif")
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM ticketing.ticket_bundle_items WHERE bundle_product_id = $1`, productID); err != nil {
			return err
		}
		for i, it := range items {
			if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_bundle_items
				(company_id, branch_id, bundle_product_id, component_variant_id, qty, sort_order)
				VALUES ($1, $2, $3, $4, $5, $6)`,
				v.CompanyID, v.BranchID, productID, it.ComponentVariantID, it.Qty, (i+1)*10); err != nil {
				return err
			}
		}
		return nil
	})
}

// ChannelBoard is loadChannelBoard.
func (s *Service) ChannelBoard(ctx context.Context, v Venue) ([]domain.BoardProduct, error) {
	in := domain.BoardInput{Distributed: map[string]bool{}, Overrides: map[string]domain.PricePair{}}
	venue := []any{v.BranchID, v.CompanyID}
	err := scanAll(ctx, s.db, `SELECT id::text, code, name, status, product_kind, thumbnail_url
		FROM ticketing.ticket_products WHERE branch_id = $1 AND company_id = $2
		ORDER BY created_at DESC`, venue, func(scan func(...any) error) error {
		var p domain.BoardProduct
		err := scan(&p.ID, &p.Code, &p.Name, &p.Status, &p.ProductKind, &p.ThumbnailURL)
		in.Products = append(in.Products, p)
		return err
	})
	if err != nil {
		return nil, err
	}
	err = scanAll(ctx, s.db, `SELECT ticket_product_id::text, id::text, name, price_regular::float8, price_high::float8
		FROM ticketing.ticket_product_variants
		WHERE branch_id = $1 AND company_id = $2 AND is_active = true
		ORDER BY sort_order`, venue, func(scan func(...any) error) error {
		var pv struct {
			ProductID string
			domain.VariantPrice
		}
		err := scan(&pv.ProductID, &pv.ID, &pv.Name, &pv.Regular, &pv.High)
		in.Variants = append(in.Variants, pv)
		return err
	})
	if err != nil {
		return nil, err
	}
	err = scanAll(ctx, s.db, `SELECT id::text, code, name, is_online FROM ticketing.ticket_channels
		WHERE branch_id = $1 AND company_id = $2 AND is_active = true
		ORDER BY sort_order`, venue, func(scan func(...any) error) error {
		var ch domain.BoardChannel
		err := scan(&ch.ChannelID, &ch.ChannelCode, &ch.ChannelName, &ch.IsOnline)
		in.Channels = append(in.Channels, ch)
		return err
	})
	if err != nil {
		return nil, err
	}
	err = scanAll(ctx, s.db, `SELECT ticket_product_id::text, channel_id::text, is_distributed
		FROM ticketing.ticket_product_channels WHERE branch_id = $1 AND company_id = $2`, venue,
		func(scan func(...any) error) error {
			var productID, channelID string
			var on bool
			err := scan(&productID, &channelID, &on)
			in.Distributed[domain.BoardKey(productID, channelID)] = on
			return err
		})
	if err != nil {
		return nil, err
	}
	overrides, err := overridePairs(ctx, s.db, `WHERE branch_id = $1 AND company_id = $2`, venue...)
	if err != nil {
		return nil, err
	}
	for k, p := range overrides {
		in.Overrides[domain.BoardKey(k.variantID, k.channelID)] = p
	}
	return domain.BuildChannelBoard(in), nil
}

// LoketOptions is loadLoketOptions: variants of Active tickets distributed
// to walk-in; bundles carry their composition.
func (s *Service) LoketOptions(ctx context.Context, v Venue) ([]domain.LoketOption, error) {
	var options []domain.LoketOption
	var bundleIDs []string
	err := scanAll(ctx, s.db, `SELECT pv.id::text, pv.name, tp.id::text, tp.code, tp.name, tp.product_kind,
		  pv.price_regular::float8, pv.price_high::float8
		FROM ticketing.ticket_product_variants pv
		JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
		JOIN ticketing.ticket_product_channels pc ON pc.ticket_product_id = tp.id AND pc.is_distributed = true
		JOIN ticketing.ticket_channels ch ON ch.id = pc.channel_id AND ch.code = 'walk-in'
		WHERE tp.branch_id = $1 AND tp.company_id = $2 AND tp.status = 'active' AND pv.is_active = true
		ORDER BY tp.name, pv.sort_order`, []any{v.BranchID, v.CompanyID}, func(scan func(...any) error) error {
		var o domain.LoketOption
		err := scan(&o.VariantID, &o.VariantName, &o.TicketProductID, &o.TicketCode, &o.TicketName,
			&o.ProductKind, &o.PriceRegular, &o.PriceHigh)
		if o.ProductKind == "bundle" {
			bundleIDs = append(bundleIDs, o.TicketProductID)
		}
		options = append(options, o)
		return err
	})
	if err != nil || len(bundleIDs) == 0 {
		return domain.BuildLoketOptions(options, nil), err
	}
	var members []domain.LoketBundleRow
	err = scanAll(ctx, s.db, `SELECT bi.bundle_product_id::text, bi.component_variant_id::text, bi.qty,
		  tp.name, pv.name, tp.status, tp.product_kind, pv.is_active
		FROM ticketing.ticket_bundle_items bi
		JOIN ticketing.ticket_product_variants pv ON pv.id = bi.component_variant_id
		JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
		WHERE bi.bundle_product_id = ANY($1) AND bi.branch_id = $2 AND bi.company_id = $3
		ORDER BY bi.sort_order, bi.created_at`, []any{bundleIDs, v.BranchID, v.CompanyID}, func(scan func(...any) error) error {
		var m domain.LoketBundleRow
		err := scan(&m.BundleProductID, &m.ComponentVariantID, &m.Qty, &m.ProductName, &m.VariantName,
			&m.ComponentStatus, &m.ComponentKind, &m.VariantIsActive)
		members = append(members, m)
		return err
	})
	return domain.BuildLoketOptions(options, members), err
}
