package domain

// Channel distribution, the Channel Manager board and loket options
// (distribution.ts), over rows already loaded and scoped to the venue.

// VariantPrice is a variant with its own price pair.
type VariantPrice struct {
	ID   string
	Name string
	PricePair
}

// FirstIncompleteVariant is firstIncompleteVariant: the first variant not
// priced for both seasons on the channel, or nil.
func FirstIncompleteVariant(variants []VariantPrice, overrides map[string]PricePair) *VariantPrice {
	for i, v := range variants {
		var o *PricePair
		if p, ok := overrides[v.ID]; ok {
			o = &p
		}
		if !IsVariantPriceComplete(v.PricePair, o) {
			return &variants[i]
		}
	}
	return nil
}

// BoardProduct is one ticket on the Channel Manager board.
type BoardProduct struct {
	ID           string         `json:"id"`
	Code         string         `json:"code"`
	Name         string         `json:"name"`
	Status       string         `json:"status"`
	ProductKind  string         `json:"product_kind"`
	ThumbnailURL *string        `json:"thumbnail_url"`
	Variants     []BoardVariant `json:"variants"`
	Channels     []BoardChannel `json:"channels"`
}

// BoardVariant is a variant with its numeric prices.
type BoardVariant struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	PriceRegular *float64 `json:"price_regular"`
	PriceHigh    *float64 `json:"price_high"`
}

// BoardChannel is one product × channel cell.
type BoardChannel struct {
	ChannelID     string          `json:"channel_id"`
	ChannelCode   string          `json:"channel_code"`
	ChannelName   string          `json:"channel_name"`
	IsOnline      bool            `json:"is_online"`
	IsDistributed bool            `json:"is_distributed"`
	PriceComplete bool            `json:"price_complete"`
	Overrides     []BoardOverride `json:"overrides"`
}

// BoardOverride is a variant's channel price override (nil = none).
type BoardOverride struct {
	VariantID    string   `json:"variant_id"`
	PriceRegular *float64 `json:"price_regular"`
	PriceHigh    *float64 `json:"price_high"`
}

// BoardInput carries the venue rows buildChannelBoard reads.
type BoardInput struct {
	Products []BoardProduct // Variants and Channels are filled by BuildChannelBoard
	Variants []struct {
		ProductID string
		VariantPrice
	}
	Channels []BoardChannel // ChannelID, ChannelCode, ChannelName, IsOnline
	// Distributed maps productID|channelID to is_distributed.
	Distributed map[string]bool
	// Overrides maps variantID|channelID to the override pair.
	Overrides map[string]PricePair
}

// BoardKey joins two ids the way the board maps are keyed.
func BoardKey(a, b string) string { return a + "|" + b }

// BuildChannelBoard is buildChannelBoard.
func BuildChannelBoard(in BoardInput) []BoardProduct {
	out := make([]BoardProduct, 0, len(in.Products))
	for _, p := range in.Products {
		var variants []VariantPrice
		for _, v := range in.Variants {
			if v.ProductID == p.ID {
				variants = append(variants, v.VariantPrice)
			}
		}
		p.Variants = make([]BoardVariant, len(variants))
		for i, v := range variants {
			p.Variants[i] = BoardVariant{ID: v.ID, Name: v.Name, PriceRegular: v.Regular, PriceHigh: v.High}
		}
		p.Channels = make([]BoardChannel, len(in.Channels))
		for ci, ch := range in.Channels {
			overrides := make([]BoardOverride, len(variants))
			complete := len(variants) > 0
			for i, v := range variants {
				o := BoardOverride{VariantID: v.ID}
				if pair, ok := in.Overrides[BoardKey(v.ID, ch.ChannelID)]; ok {
					o.PriceRegular, o.PriceHigh = pair.Regular, pair.High
				}
				overrides[i] = o
				if !IsVariantPriceComplete(v.PricePair, &PricePair{Regular: o.PriceRegular, High: o.PriceHigh}) {
					complete = false
				}
			}
			ch.IsDistributed = in.Distributed[BoardKey(p.ID, ch.ChannelID)]
			ch.PriceComplete = complete
			ch.Overrides = overrides
			p.Channels[ci] = ch
		}
		out = append(out, p)
	}
	return out
}

// LoketOption is one sellable variant at the loket.
type LoketOption struct {
	VariantID       string        `json:"variant_id"`
	VariantName     string        `json:"variant_name"`
	TicketProductID string        `json:"ticket_product_id"`
	TicketCode      string        `json:"ticket_code"`
	TicketName      string        `json:"ticket_name"`
	ProductKind     string        `json:"product_kind"`
	PriceRegular    *float64      `json:"price_regular"`
	PriceHigh       *float64      `json:"price_high"`
	Members         []LoketMember `json:"members"`
	MembersPerUnit  int           `json:"members_per_unit"`
}

// LoketMember is one bundle composition line shown at the loket.
type LoketMember struct {
	ComponentVariantID string `json:"component_variant_id"`
	Qty                int    `json:"qty"`
	Label              string `json:"label"`
}

// LoketBundleRow is one composition row of a bundle on sale.
type LoketBundleRow struct {
	BundleProductID string
	CompositionRow
}

func sellable(rows []LoketBundleRow) bool {
	if len(rows) == 0 {
		return false
	}
	for _, r := range rows {
		if r.ComponentStatus != "active" || r.ComponentKind != "single" || !r.VariantIsActive {
			return false
		}
	}
	return true
}

// BuildLoketOptions is buildLoketOptions: bundles carry their composition
// and unsellable bundles are hidden. Members and MembersPerUnit of the
// input options are ignored.
func BuildLoketOptions(options []LoketOption, memberRows []LoketBundleRow) []LoketOption {
	byBundle := map[string][]LoketBundleRow{}
	for _, m := range memberRows {
		byBundle[m.BundleProductID] = append(byBundle[m.BundleProductID], m)
	}
	out := []LoketOption{}
	for _, o := range options {
		members := []LoketBundleRow{}
		if o.ProductKind == "bundle" {
			if !sellable(byBundle[o.TicketProductID]) {
				continue
			}
			members = byBundle[o.TicketProductID]
		}
		o.Members = make([]LoketMember, len(members))
		o.MembersPerUnit = 0
		for i, m := range members {
			o.Members[i] = LoketMember{ComponentVariantID: m.ComponentVariantID, Qty: m.Qty, Label: m.ProductName + " — " + m.VariantName}
			o.MembersPerUnit += m.Qty
		}
		out = append(out, o)
	}
	return out
}

// DateUnmarkPlan is planDateUnmark's result. Kind is delete, set-start,
// set-end or split.
type DateUnmarkPlan struct {
	Kind       string
	Start      string
	End        string
	LeftEnd    string
	RightStart string
}

// PlanDateUnmark is planDateUnmark: remove one date from a range that
// contains it.
func PlanDateUnmark(startDate, endDate, date string) DateUnmarkPlan {
	switch {
	case startDate == endDate:
		return DateUnmarkPlan{Kind: "delete"}
	case startDate == date:
		return DateUnmarkPlan{Kind: "set-start", Start: AddDaysISO(date, 1)}
	case endDate == date:
		return DateUnmarkPlan{Kind: "set-end", End: AddDaysISO(date, -1)}
	}
	return DateUnmarkPlan{Kind: "split", LeftEnd: AddDaysISO(date, -1), RightStart: AddDaysISO(date, 1)}
}
