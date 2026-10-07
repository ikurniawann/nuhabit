package ticketing

import (
	"context"
	"regexp"
	"strings"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
)

// The public venue and its website catalog (booking-server.ts). Every
// function here serves routes without auth: the internal venue ids never
// reach the client.

// PublicVenue is PublicVenueCtx.
type PublicVenue struct {
	Venue
	WebsiteChannelID string
	VenueName        string
}

var publicSlugPattern = regexp.MustCompile(`^[a-z0-9-]{2,50}$`)

// resolvePublicVenue is resolvePublicVenue: nil for an unknown slug or a
// venue without an active online channel (both a generic 404).
func (s *Service) resolvePublicVenue(ctx context.Context, slug string) (*PublicVenue, error) {
	if !publicSlugPattern.MatchString(slug) {
		return nil, nil
	}
	var v PublicVenue
	err := s.db.QueryRow(ctx, `SELECT company_id::text, branch_id::text FROM ticketing.ticket_settings
		WHERE booking_slug = $1`, slug).Scan(&v.CompanyID, &v.BranchID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	err = s.db.QueryRow(ctx, `SELECT id::text FROM ticketing.ticket_channels
		WHERE branch_id = $1 AND company_id = $2
		  AND is_online = true AND is_active = true
		ORDER BY sort_order LIMIT 1`, v.BranchID, v.CompanyID).Scan(&v.WebsiteChannelID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	name, err := s.ports.Public.Branches.Name(ctx, s.db, v.BranchID)
	if err != nil {
		return nil, err
	}
	v.VenueName = "Tiket Wisata"
	if name != nil && strings.TrimSpace(*name) != "" {
		v.VenueName = strings.TrimSpace(*name)
	}
	return &v, nil
}

type catalogVariantRow struct {
	id, productID, name string
	pair                domain.PricePair
}

type catalogDateRow struct {
	productID string
	domain.ProductDateRange
}

type compositionRow struct {
	bundleProductID string
	domain.CompositionRow
}

// buildPublicCatalog is buildPublicCatalog: Active products distributed to
// the website channel and not blocked online on visitDate, each variant
// priced by the v2 resolver (the website override wins). Variants without
// a complete price are hidden.
func (s *Service) buildPublicCatalog(ctx context.Context, v *PublicVenue, visitDate string) ([]domain.CatalogProduct, error) {
	products, err := queryRows(ctx, s.db, `SELECT p.id, p.code, p.name, p.description, p.thumbnail_url, p.product_kind
		FROM ticketing.ticket_products p
		JOIN ticketing.ticket_product_channels pc
		  ON pc.ticket_product_id = p.id AND pc.channel_id = $3
		 AND pc.is_distributed = true
		WHERE p.branch_id = $1 AND p.company_id = $2 AND p.status = 'active'
		ORDER BY p.code`, v.BranchID, v.CompanyID, v.WebsiteChannelID)
	if err != nil {
		return nil, err
	}
	var variants []catalogVariantRow
	err = scanAll(ctx, s.db, `SELECT id::text, ticket_product_id::text, name, price_regular::float8, price_high::float8
		FROM ticketing.ticket_product_variants
		WHERE branch_id = $1 AND company_id = $2 AND is_active = true
		ORDER BY sort_order`, []any{v.BranchID, v.CompanyID}, func(scan func(...any) error) error {
		var r catalogVariantRow
		err := scan(&r.id, &r.productID, &r.name, &r.pair.Regular, &r.pair.High)
		variants = append(variants, r)
		return err
	})
	if err != nil {
		return nil, err
	}
	var dates []catalogDateRow
	err = scanAll(ctx, s.db, `SELECT ticket_product_id::text, date_kind, start_date::text, end_date::text, is_active
		FROM ticketing.ticket_product_dates
		WHERE branch_id = $1 AND company_id = $2 AND is_active = true`, []any{v.BranchID, v.CompanyID},
		func(scan func(...any) error) error {
			var r catalogDateRow
			err := scan(&r.productID, &r.DateKind, &r.StartDate, &r.EndDate, &r.IsActive)
			dates = append(dates, r)
			return err
		})
	if err != nil {
		return nil, err
	}
	overrides := map[string]*domain.PricePair{}
	err = scanAll(ctx, s.db, `SELECT variant_id::text, price_regular::float8, price_high::float8
		FROM ticketing.ticket_variant_channel_prices
		WHERE branch_id = $1 AND company_id = $2 AND channel_id = $3`, []any{v.BranchID, v.CompanyID, v.WebsiteChannelID},
		func(scan func(...any) error) error {
			var id string
			var p domain.PricePair
			err := scan(&id, &p.Regular, &p.High)
			overrides[id] = &p
			return err
		})
	if err != nil {
		return nil, err
	}
	datesOf := func(productID string) []domain.ProductDateRange {
		var out []domain.ProductDateRange
		for _, d := range dates {
			if d.productID == productID {
				out = append(out, d.ProductDateRange)
			}
		}
		return out
	}

	// Bundle compositions in one batch: an empty or unsellable composition
	// hides the bundle, and a component blocked online blocks it too.
	var bundleIDs []string
	for _, p := range products {
		if p.Str("product_kind") == "bundle" {
			bundleIDs = append(bundleIDs, p.Str("id"))
		}
	}
	compositions := map[string][]domain.CompositionRow{}
	if len(bundleIDs) > 0 {
		err = scanAll(ctx, s.db, `SELECT bi.bundle_product_id::text, bi.component_variant_id::text, bi.qty,
			  tp.name, pv.name, tp.id::text, tp.status, tp.product_kind, pv.is_active,
			  pv.price_regular::float8, pv.price_high::float8
			FROM ticketing.ticket_bundle_items bi
			JOIN ticketing.ticket_product_variants pv ON pv.id = bi.component_variant_id
			JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
			WHERE bi.bundle_product_id = ANY($1::uuid[])
			  AND bi.branch_id = $2 AND bi.company_id = $3
			ORDER BY bi.sort_order, bi.created_at`, []any{bundleIDs, v.BranchID, v.CompanyID},
			func(scan func(...any) error) error {
				var r compositionRow
				err := scan(&r.bundleProductID, &r.ComponentVariantID, &r.Qty, &r.ProductName, &r.VariantName,
					&r.ComponentProductID, &r.ComponentStatus, &r.ComponentKind, &r.VariantIsActive, &r.PriceRegular, &r.PriceHigh)
				compositions[r.bundleProductID] = append(compositions[r.bundleProductID], r.CompositionRow)
				return err
			})
		if err != nil {
			return nil, err
		}
	}

	catalog := []domain.CatalogProduct{}
	for _, p := range products {
		id, kind := p.Str("id"), p.Str("product_kind")
		var composition []domain.CompositionRow
		if kind == "bundle" {
			composition = compositions[id]
			if domain.BundleCompositionIssue(composition) != "" {
				continue
			}
			blocked := false
			for _, c := range composition {
				if domain.IsDateBlockedOnline(visitDate, datesOf(c.ComponentProductID)) {
					blocked = true
					break
				}
			}
			if blocked {
				continue
			}
		}
		productDates := datesOf(id)
		var resolved []domain.CatalogVariant
		blocked := false
		for _, vr := range variants {
			if vr.productID != id {
				continue
			}
			res := domain.ResolveTicketPrice(visitDate, true, productDates, vr.pair, overrides[vr.id])
			if !res.OK {
				if res.Reason == domain.ReasonDateBlocked {
					blocked = true
				}
				continue // a missing price hides the variant, never guess
			}
			cv := domain.CatalogVariant{VariantID: vr.id, VariantName: vr.name, Price: res.Price, SeasonKind: res.SeasonKind}
			if kind == "bundle" {
				// One unit's members, weighted by the component price for the
				// season (a filled website override wins).
				components := make([]domain.BundleComponent, len(composition))
				for i, c := range composition {
					components[i] = domain.BundleComponent{
						ComponentVariantID: c.ComponentVariantID, Qty: c.Qty, ProductName: c.ProductName, VariantName: c.VariantName,
						WeightPrice: domain.ResolveVariantPrice(domain.PricePair{Regular: c.PriceRegular, High: c.PriceHigh},
							overrides[c.ComponentVariantID], res.SeasonKind),
					}
				}
				members := domain.ExpandBundleMembers(components)
				cv.Members = &members
			}
			resolved = append(resolved, cv)
		}
		if blocked || len(resolved) == 0 {
			continue
		}
		catalog = append(catalog, domain.CatalogProduct{
			TicketProductID: id, Code: p.Str("code"), Name: p.Str("name"),
			Description: strPtr(p.Get("description")), ThumbnailURL: strPtr(p.Get("thumbnail_url")),
			ProductKind: kind, Variants: resolved,
		})
	}
	return catalog, nil
}

// strPtr is a nullable text column of a Row.
func strPtr(v any) *string {
	if s, ok := v.(string); ok {
		return &s
	}
	return nil
}
