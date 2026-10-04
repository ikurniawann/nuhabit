package app

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/integrations/gobiz"
	gobizdomain "nuhabit/backend/internal/modules/integrations/gobiz/domain"
	"nuhabit/backend/internal/modules/possales/gofood"
	tableorderdomain "nuhabit/backend/internal/modules/possales/tableorder/domain"
	"nuhabit/backend/internal/platform/database"
	gobizapi "nuhabit/backend/internal/platform/gobiz"
	"nuhabit/backend/internal/platform/module"
)

// Adapters of the GoBiz webhook and catalog sync ports. The catalog and
// channel-price reads are the SQL of lib/gobiz/service.ts,
// lib/pos/channel-pricing-server.ts and lib/table-order/server.ts on pos-ops
// tables (pos-ops exports no reader for them). GoFood orders belong to
// pos-sales: its gofood package exports the event upsert, the auto-accept
// claim, setPosOrderStatus and the POS order creation.

func newIntegrationsGobizPorts(d module.Deps) gobiz.Ports {
	return gobiz.Ports{
		Catalog: gobizCatalog{},
		Orders:  gobizOrders{now: d.Now, log: d.Log, client: gobizapi.NewClient(nil, nil)},
		Venues:  gobizVenues{},
	}
}

/* ── Venues ───────────────────────────────────────────────────────────── */

type gobizVenues struct{}

func (gobizVenues) DefaultVenue(ctx context.Context, q database.Querier) gobiz.Venue {
	v := gofood.CrmVenueSQL{}.DefaultVenue(ctx, q)
	return gobiz.Venue{CompanyID: v.CompanyID, BranchID: v.BranchID}
}

/* ── Catalog ──────────────────────────────────────────────────────────── */

type gobizCatalog struct{}

// gobizModifierGroupsSQL is MODIFIER_GROUPS_SQL: the active add-on groups of
// product p, a correlated subquery so variant rows are not multiplied.
const gobizModifierGroupsSQL = `COALESCE((
       SELECT json_agg(json_build_object(
                'id', g.id, 'name', g.name,
                'min_selection', g.min_selection, 'max_selection', g.max_selection,
                'modifiers', COALESCE((
                  SELECT json_agg(json_build_object('id', m.id, 'name', m.name,
                                                    'price_adjustment', m.price_adjustment::float)
                                  ORDER BY m.display_order, m.name)
                  FROM pos.pos_modifiers m
                  WHERE m.group_id = g.id AND m.is_active IS NOT FALSE
                ), '[]'::json)
              ) ORDER BY g.display_order, g.name)
       FROM pos.pos_product_modifiers pm
       JOIN pos.pos_modifier_groups g ON g.id = pm.modifier_group_id
       WHERE pm.product_id = p.id AND g.is_active IS NOT FALSE
     ), '[]'::json)`

// GofoodProducts is loadCatalogProductsForGobiz.
func (gobizCatalog) GofoodProducts(ctx context.Context, q database.Querier) ([]gobizdomain.CatalogProduct, error) {
	rows, err := q.Query(ctx, `SELECT p.id::text, p.name, p.description, p.base_price::float8, p.image_url,
            p.is_available, c.name,
            COALESCE(json_agg(json_build_object(
              'id', v.id, 'name', v.name, 'price_adjustment', v.price_adjustment::float,
              'group_name', v.group_name
            ) ORDER BY v.display_order NULLS LAST, v.name) FILTER (WHERE v.id IS NOT NULL AND v.is_active IS NOT FALSE), '[]'::json),
            `+gobizModifierGroupsSQL+`
     FROM pos.pos_products p
     LEFT JOIN pos.pos_categories c ON c.id = p.category_id
     LEFT JOIN pos.pos_product_variants v ON v.product_id = p.id
     WHERE p.is_active = true AND COALESCE(p.product_kind, 'regular') <> 'gift_card'
       AND (p.sales_channels IS NULL OR cardinality(p.sales_channels) = 0 OR 'gofood' = ANY(p.sales_channels))
     GROUP BY p.id, c.name, c.display_order
     ORDER BY c.display_order NULLS LAST, c.name NULLS LAST, p.name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (gobizdomain.CatalogProduct, error) {
		var p gobizdomain.CatalogProduct
		var available *bool
		var variants []struct {
			ID              string  `json:"id"`
			Name            string  `json:"name"`
			PriceAdjustment float64 `json:"price_adjustment"`
			GroupName       *string `json:"group_name"`
		}
		var groups []struct {
			ID           string  `json:"id"`
			Name         string  `json:"name"`
			MinSelection float64 `json:"min_selection"`
			MaxSelection float64 `json:"max_selection"`
			Modifiers    []struct {
				ID              string  `json:"id"`
				Name            string  `json:"name"`
				PriceAdjustment float64 `json:"price_adjustment"`
			} `json:"modifiers"`
		}
		var rawVariants, rawGroups []byte
		if err := r.Scan(&p.ID, &p.Name, &p.Description, &p.Price, &p.Image, &available, &p.CategoryName, &rawVariants, &rawGroups); err != nil {
			return p, err
		}
		if err := json.Unmarshal(rawVariants, &variants); err != nil {
			return p, err
		}
		if err := json.Unmarshal(rawGroups, &groups); err != nil {
			return p, err
		}
		p.InStock = available == nil || *available
		for _, v := range variants {
			p.Variants = append(p.Variants, gobizdomain.CatalogVariant{ID: v.ID, Name: v.Name, PriceAdjustment: v.PriceAdjustment, GroupName: v.GroupName})
		}
		for _, g := range groups {
			if g.MaxSelection == 0 { // Number(max_selection) || 1
				g.MaxSelection = 1
			}
			group := gobizdomain.ModifierGroup{ID: g.ID, Name: g.Name, MinSelection: g.MinSelection, MaxSelection: g.MaxSelection}
			for _, m := range g.Modifiers {
				group.Modifiers = append(group.Modifiers, gobizdomain.Modifier{ID: m.ID, Name: m.Name, PriceAdjustment: m.PriceAdjustment})
			}
			p.ModifierGroups = append(p.ModifierGroups, group)
		}
		return p, nil
	})
}

// ProductRefs is loadProductsByIds (PRODUCT_SELECT, normalized by
// normalizeTableOrderProduct) reduced to what mapping reads.
func (gobizCatalog) ProductRefs(ctx context.Context, q database.Querier, ids []string) (map[string]gobizdomain.ProductRef, error) {
	refs := map[string]gobizdomain.ProductRef{}
	if len(ids) == 0 {
		return refs, nil
	}
	rows, err := q.Query(ctx, `SELECT p.id::text, p.sku, p.name, p.station,
         COALESCE(json_agg(json_build_object(
               'id', v.id, 'name', v.name,
               'price_adjustment', v.price_adjustment::float,
               'is_active', v.is_active
             ) ORDER BY v.display_order NULLS LAST, v.name) FILTER (WHERE v.id IS NOT NULL), '[]'::json),
         `+gobizModifierGroupsSQL+`
  FROM pos.pos_products p
  LEFT JOIN pos.pos_product_variants v ON v.product_id = p.id
  WHERE p.id = ANY($1::uuid[])
  GROUP BY p.id`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var row tableorderdomain.ProductRow
		if err := rows.Scan(&row.ID, &row.SKU, &row.Name, &row.Station, &row.Variants, &row.ModifierGroups); err != nil {
			return nil, err
		}
		p := tableorderdomain.NormalizeProduct(row)
		ref := gobizdomain.ProductRef{ID: p.ID, Name: p.Name, SKU: p.SKU, Station: p.Station}
		for _, v := range p.Variants {
			ref.Variants = append(ref.Variants, gobizdomain.RefVariant{ID: v.ID, Name: v.Name})
		}
		for _, g := range p.ModifierGroups {
			for _, m := range g.Modifiers {
				ref.Modifiers = append(ref.Modifiers, gobizdomain.RefModifier{ID: m.ID, Name: m.Name, GroupName: g.Name, Price: m.PriceAdjustment})
			}
		}
		refs[p.ID] = ref
	}
	return refs, rows.Err()
}

// ChannelRule is loadChannelRule.
func (gobizCatalog) ChannelRule(ctx context.Context, q database.Querier, code string) (*gobizdomain.ChannelRule, error) {
	var r gobizdomain.ChannelRule
	err := q.QueryRow(ctx, `SELECT code, name, COALESCE(markup_percent, 0)::float8, rounding_step::float8, rounding_mode, is_active
		FROM pos.sales_channels WHERE code = $1`, code).Scan(&r.Code, &r.Name, &r.MarkupPercent, &r.RoundingStep, &r.RoundingMode, &r.IsActive)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// ChannelOverrides is loadChannelOverrides.
func (gobizCatalog) ChannelOverrides(ctx context.Context, q database.Querier, code string) (map[string]float64, error) {
	rows, err := q.Query(ctx, `SELECT product_id::text, price::float8 FROM pos.pos_product_channel_prices WHERE channel_code = $1`, code)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var id string
		var price float64
		if err := rows.Scan(&id, &price); err != nil {
			return nil, err
		}
		out[id] = price
	}
	return out, rows.Err()
}

/* ── Orders ───────────────────────────────────────────────────────────── */

// gobizOrders is pos-sales' GoFood order writes.
type gobizOrders struct {
	now    func() time.Time
	log    *slog.Logger
	client *gobizapi.Client
}

func (gobizOrders) ByGofoodID(ctx context.Context, q database.Querier, gofoodOrderID string) (*gobiz.ExistingOrder, error) {
	o, err := gofood.FindByGofoodID(ctx, q, gofoodOrderID)
	if o == nil || err != nil {
		return nil, err
	}
	return &gobiz.ExistingOrder{ID: o.ID, Status: o.Status, HasItems: o.HasItems}, nil
}

func (gobizOrders) Insert(ctx context.Context, q database.Querier, w gobiz.OrderWrite) (*gobiz.OrderRow, error) {
	return gobizOrderRow(gofood.InsertOrder(ctx, q, gofoodUpsert(w)))
}

func (gobizOrders) Update(ctx context.Context, q database.Querier, id string, w gobiz.OrderWrite) (*gobiz.OrderRow, error) {
	return gobizOrderRow(gofood.UpdateOrder(ctx, q, id, gofoodUpsert(w)))
}

func gofoodUpsert(w gobiz.OrderWrite) gofood.OrderUpsert {
	s := w.Summary
	return gofood.OrderUpsert{
		Status: w.Status, GofoodOrderID: s.GofoodOrderID, GofoodOrderType: s.GofoodOrderType, OutletID: s.OutletID,
		OrderTotal: s.OrderTotal, Currency: s.Currency, CustomerName: s.CustomerName, DriverName: s.DriverName, Pin: s.Pin,
		CutleryRequested: s.CutleryRequested, TakeawayCharges: s.TakeawayCharges, CancelReason: s.CancelReason,
		Items: w.Items, Unmapped: w.Unmapped, RawPayload: w.RawPayload, AwaitingSince: w.AwaitingSince,
		Venue: gofood.Venue{CompanyID: w.Venue.CompanyID, BranchID: w.Venue.BranchID},
	}
}

func gobizOrderRow(o *gofood.UpsertedOrder, err error) (*gobiz.OrderRow, error) {
	if err != nil {
		return nil, err
	}
	return &gobiz.OrderRow{ID: o.ID, GofoodOrderID: o.GofoodOrderID, GofoodOrderType: o.GofoodOrderType, Status: o.Status,
		PosOrderID: o.PosOrderID, CancelReason: o.CancelReason}, nil
}

func (gobizOrders) ClaimAutoAccept(ctx context.Context, q database.Querier, id string) (bool, error) {
	return gofood.ClaimAutoAccept(ctx, q, id)
}

func (gobizOrders) ReleaseAutoAccept(ctx context.Context, q database.Querier, id, message string) error {
	return gofood.ReleaseAutoAccept(ctx, q, id, message)
}

// EnsurePosOrder is `ensurePosOrderForGofood((await getGofoodOrder(id)) ?? row)`
// through pos-sales' GoFood service.
func (o gobizOrders) EnsurePosOrder(ctx context.Context, db database.DB, id string) error {
	svc := gofood.NewService(db, gofood.Ports{Config: gofood.SettingsSQL{}, Venues: gofood.CrmVenueSQL{}}, o.client, o.now, o.log)
	row, err := svc.Get(ctx, id)
	if err != nil || row == nil {
		return err
	}
	_, err = svc.EnsurePosOrder(ctx, row)
	return err
}

func (o gobizOrders) SetPosOrderStatus(ctx context.Context, db database.DB, posOrderID, status, note string) error {
	return gofood.SetPosOrderStatus(ctx, db, posOrderID, status, note, o.now())
}
