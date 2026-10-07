package ticketing

import (
	"context"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
)

// resolveVariantPriceOnDate is pricing-server.ts: the ticket's calendar,
// the channel's online flag and the channel override feed the pure
// resolver. A failed result must be rejected, never guessed.
func resolveVariantPriceOnDate(ctx context.Context, q database.Querier, v Venue, variantID, channelID, visitDate string) (domain.PriceResult, error) {
	var productID string
	var variant domain.PricePair
	err := q.QueryRow(ctx, `SELECT ticket_product_id::text, price_regular::float8, price_high::float8
		FROM ticketing.ticket_product_variants
		WHERE id = $1 AND branch_id = $2 AND company_id = $3 AND is_active = true`,
		variantID, v.BranchID, v.CompanyID).Scan(&productID, &variant.Regular, &variant.High)
	if database.IsNoRows(err) {
		return domain.PriceResult{Reason: domain.ReasonPriceMissing}, nil
	}
	if err != nil {
		return domain.PriceResult{}, err
	}
	dates, err := productDates(ctx, q, productID)
	if err != nil {
		return domain.PriceResult{}, err
	}
	var isOnline bool
	err = q.QueryRow(ctx, `SELECT is_online FROM ticketing.ticket_channels
		WHERE id = $1 AND branch_id = $2 AND company_id = $3`, channelID, v.BranchID, v.CompanyID).Scan(&isOnline)
	if err != nil && !database.IsNoRows(err) {
		return domain.PriceResult{}, err
	}
	var override *domain.PricePair
	var o domain.PricePair
	err = q.QueryRow(ctx, `SELECT price_regular::float8, price_high::float8
		FROM ticketing.ticket_variant_channel_prices WHERE variant_id = $1 AND channel_id = $2`,
		variantID, channelID).Scan(&o.Regular, &o.High)
	switch {
	case err == nil:
		override = &o
	case !database.IsNoRows(err):
		return domain.PriceResult{}, err
	}
	return domain.ResolveTicketPrice(visitDate, isOnline, dates, variant, override), nil
}

// productDates loads a ticket's calendar ranges.
func productDates(ctx context.Context, q database.Querier, productID string) ([]domain.ProductDateRange, error) {
	var out []domain.ProductDateRange
	err := scanAll(ctx, q, `SELECT date_kind, start_date::text, end_date::text, is_active
		FROM ticketing.ticket_product_dates WHERE ticket_product_id = $1`, []any{productID}, func(scan func(...any) error) error {
		var d domain.ProductDateRange
		err := scan(&d.DateKind, &d.StartDate, &d.EndDate, &d.IsActive)
		out = append(out, d)
		return err
	})
	return out, err
}

// loadBundleComposition is bundle-server.ts loadBundleComposition.
func loadBundleComposition(ctx context.Context, q database.Querier, v Venue, bundleProductID string) ([]domain.CompositionRow, error) {
	var out []domain.CompositionRow
	err := scanAll(ctx, q, `SELECT bi.component_variant_id::text, bi.qty,
		        tp.name, pv.name, tp.id::text, tp.status, tp.product_kind,
		        pv.is_active, pv.price_regular::float8, pv.price_high::float8
		   FROM ticketing.ticket_bundle_items bi
		   JOIN ticketing.ticket_product_variants pv ON pv.id = bi.component_variant_id
		   JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
		  WHERE bi.bundle_product_id = $1 AND bi.branch_id = $2 AND bi.company_id = $3
		  ORDER BY bi.sort_order, bi.created_at`, []any{bundleProductID, v.BranchID, v.CompanyID}, func(scan func(...any) error) error {
		var c domain.CompositionRow
		err := scan(&c.ComponentVariantID, &c.Qty, &c.ProductName, &c.VariantName, &c.ComponentProductID,
			&c.ComponentStatus, &c.ComponentKind, &c.VariantIsActive, &c.PriceRegular, &c.PriceHigh)
		out = append(out, c)
		return err
	})
	return out, err
}
