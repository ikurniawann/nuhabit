package domain

import (
	"encoding/base64"
	"math"
	"regexp"
	"strings"

	"nuhabit/backend/internal/platform/jsmath"
)

/* ── channel pricing (lib/pos/channel-pricing.ts) ─────────────────────── */

// ChannelRule is ChannelRule: a pos.sales_channels row.
type ChannelRule struct {
	Code          string
	Name          string
	MarkupPercent float64
	RoundingStep  float64
	RoundingMode  string
	IsActive      bool
}

// RoundToStep is roundToStep: drop float noise to cents, then round to a
// multiple of step (up, down, or nearest).
func RoundToStep(value, step float64, mode string) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
		return 0
	}
	units := jsmath.RoundTo(value, 2) / step
	switch mode {
	case "up":
		units = math.Ceil(units)
	case "down":
		units = math.Floor(units)
	default:
		units = jsmath.Round(units)
	}
	return units * step
}

// ApplyChannelMarkup is applyChannelMarkup: base + markup %, rounded to the
// channel step, never below the base price. An inactive channel sells at
// the base price.
func ApplyChannelMarkup(value float64, rule ChannelRule) float64 {
	if math.IsNaN(value) || value <= 0 {
		return 0
	}
	if !rule.IsActive {
		return jsmath.Round(value)
	}
	marked := value * (1 + rule.MarkupPercent/100)
	return math.Max(jsmath.Round(value), RoundToStep(marked, rule.RoundingStep, rule.RoundingMode))
}

// ResolveChannelPrice is resolveChannelPrice(...).final: the owner's manual
// price while the channel is active, else the automatic price.
func ResolveChannelPrice(basePrice float64, rule ChannelRule, override *float64) float64 {
	if rule.IsActive && override != nil && !math.IsInf(*override, 0) && !math.IsNaN(*override) && *override > 0 {
		return jsmath.Round(*override)
	}
	return ApplyChannelMarkup(jsmath.Round(basePrice), rule)
}

/* ── catalog payload (lib/gobiz/catalog.ts) ───────────────────────────── */

// CatalogProduct is CatalogProductInput: one POS product to push.
type CatalogProduct struct {
	ID             string
	Name           string
	Description    *string
	Price          float64
	Image          *string
	InStock        bool
	CategoryName   *string
	Variants       []CatalogVariant
	ModifierGroups []ModifierGroup
}

// CatalogVariant is a POS variant with its price adjustment.
type CatalogVariant struct {
	ID              string
	Name            string
	PriceAdjustment float64
	GroupName       *string
}

// ModifierGroup is CatalogModifierGroupInput: a POS add-on group.
type ModifierGroup struct {
	ID           string
	Name         string
	MinSelection float64
	MaxSelection float64
	Modifiers    []Modifier
}

// Modifier is one add-on option.
type Modifier struct {
	ID              string
	Name            string
	PriceAdjustment float64
}

// PriceForChannel is priceCatalogForChannel: item price = manual price or
// base + markup; variant and add-on prices follow the markup.
func PriceForChannel(products []CatalogProduct, rule ChannelRule, overrides map[string]float64) []CatalogProduct {
	out := make([]CatalogProduct, len(products))
	for i, p := range products {
		var override *float64
		if v, ok := overrides[p.ID]; ok {
			override = &v
		}
		p.Price = ResolveChannelPrice(p.Price, rule, override)
		variants := make([]CatalogVariant, len(p.Variants))
		for j, v := range p.Variants {
			v.PriceAdjustment = ApplyChannelMarkup(v.PriceAdjustment, rule)
			variants[j] = v
		}
		p.Variants = variants
		groups := make([]ModifierGroup, len(p.ModifierGroups))
		for j, g := range p.ModifierGroups {
			mods := make([]Modifier, len(g.Modifiers))
			for k, m := range g.Modifiers {
				m.PriceAdjustment = ApplyChannelMarkup(m.PriceAdjustment, rule)
				mods[k] = m
			}
			g.Modifiers = mods
			groups[j] = g
		}
		p.ModifierGroups = groups
		out[i] = p
	}
	return out
}

// CatalogPayload is GobizCatalogPayload (PUT …/v1/catalog, full replace).
type CatalogPayload struct {
	RequestID         string            `json:"request_id"`
	Menus             []Menu            `json:"menus"`
	VariantCategories []VariantCategory `json:"variant_categories"`
}

// Menu is one GoFood menu (a POS category).
type Menu struct {
	Name      string     `json:"name"`
	MenuItems []MenuItem `json:"menu_items"`
}

// MenuItem is one GoFood item; ExternalID is the pos_products id.
type MenuItem struct {
	ExternalID                 string   `json:"external_id"`
	Name                       string   `json:"name"`
	InStock                    bool     `json:"in_stock"`
	Price                      float64  `json:"price"`
	Description                string   `json:"description,omitempty"`
	Image                      string   `json:"image,omitempty"`
	VariantCategoryExternalIDs []string `json:"variant_category_external_ids,omitempty"`
}

// VariantCategory is a GoFood variant category: a product's variants
// (vc:<product>) or a shared add-on group (mg:<group>).
type VariantCategory struct {
	ExternalID   string            `json:"external_id"`
	InternalName string            `json:"internal_name"`
	Name         string            `json:"name"`
	Rules        SelectionRules    `json:"rules"`
	Variants     []CategoryVariant `json:"variants"`
}

// SelectionRules is rules: {selection: {min_quantity, max_quantity}}.
type SelectionRules struct {
	Selection Selection `json:"selection"`
}

// Selection is the pick count GoFood enforces.
type Selection struct {
	MinQuantity float64 `json:"min_quantity"`
	MaxQuantity float64 `json:"max_quantity"`
}

// CategoryVariant is one option of a variant category.
type CategoryVariant struct {
	ExternalID string  `json:"external_id"`
	Name       string  `json:"name"`
	Price      float64 `json:"price"`
	InStock    bool    `json:"in_stock"`
}

// CatalogStats is CatalogBuildResult.stats.
type CatalogStats struct {
	Menus             int           `json:"menus"`
	Items             int           `json:"items"`
	VariantCategories int           `json:"variantCategories"`
	Skipped           []SkippedItem `json:"skipped"`
}

// SkippedItem is a product left out of the payload.
type SkippedItem struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

const (
	nameMax     = 150
	defaultMenu = "Menu"
)

// clampName is clampName: trimmed, at most 150 UTF-16 units.
func clampName(s string) string { return utf16Prefix(JSTrim(s), nameMax) }

// VariantCategoryID is variantCategoryId.
func VariantCategoryID(productID string) string { return "vc:" + productID }

// ModifierCategoryID is modifierCategoryId.
func ModifierCategoryID(groupID string) string { return "mg:" + groupID }

// ModifierSelection is modifierSelectionRule: min as set (0 = optional),
// max capped by the option count and at least 1, min never above max.
func ModifierSelection(g ModifierGroup) Selection {
	rawMax := jsmath.Round(g.MaxSelection)
	if rawMax <= 0 {
		rawMax = 1
	}
	mx := math.Max(1, math.Min(float64(len(g.Modifiers)), rawMax))
	mn := math.Max(0, math.Min(mx, jsmath.Round(g.MinSelection)))
	return Selection{MinQuantity: mn, MaxQuantity: mx}
}

// BuildCatalog is buildGobizCatalog: menus per POS category, variants as a
// min1/max1 category per product, add-on groups as shared categories sent
// once. Products priced 0 or without a name are skipped and reported.
func BuildCatalog(products []CatalogProduct, appURL, requestID string) (CatalogPayload, CatalogStats) {
	payload := CatalogPayload{RequestID: requestID, Menus: []Menu{}, VariantCategories: []VariantCategory{}}
	stats := CatalogStats{Skipped: []SkippedItem{}}
	menuIndex := map[string]int{}
	modifierCategories := map[string]bool{}

	for _, product := range products {
		price := jsmath.Round(product.Price)
		if !(price > 0) {
			stats.Skipped = append(stats.Skipped, SkippedItem{product.ID, product.Name, "harga 0"})
			continue
		}
		name := clampName(product.Name)
		if name == "" {
			stats.Skipped = append(stats.Skipped, SkippedItem{product.ID, product.Name, "nama kosong"})
			continue
		}
		menuName := orDefault(clampName(deref(product.CategoryName)), defaultMenu)
		idx, ok := menuIndex[menuName]
		if !ok {
			idx = len(payload.Menus)
			menuIndex[menuName] = idx
			payload.Menus = append(payload.Menus, Menu{Name: menuName, MenuItems: []MenuItem{}})
		}

		item := MenuItem{
			ExternalID:  product.ID,
			Name:        name,
			InStock:     product.InStock,
			Price:       price,
			Description: JSTrim(deref(product.Description)),
			Image:       ImageURL(deref(product.Image), appURL),
		}

		var active []CatalogVariant
		for _, v := range product.Variants {
			if v.ID != "" && JSTrim(v.Name) != "" {
				active = append(active, v)
			}
		}
		if len(active) > 0 {
			categoryID := VariantCategoryID(product.ID)
			groupName := orDefault(clampName(deref(active[0].GroupName)), "Pilihan")
			variants := make([]CategoryVariant, len(active))
			for i, v := range active {
				variants[i] = CategoryVariant{v.ID, clampName(v.Name), math.Max(0, jsmath.Round(v.PriceAdjustment)), true}
			}
			payload.VariantCategories = append(payload.VariantCategories, VariantCategory{
				ExternalID:   categoryID,
				InternalName: clampName(name + " — " + groupName),
				Name:         groupName,
				Rules:        SelectionRules{Selection{1, 1}},
				Variants:     variants,
			})
			item.VariantCategoryExternalIDs = []string{categoryID}
		}

		for _, group := range product.ModifierGroups {
			var options []Modifier
			for _, m := range group.Modifiers {
				if m.ID != "" && JSTrim(m.Name) != "" {
					options = append(options, m)
				}
			}
			if len(options) == 0 {
				continue
			}
			categoryID := ModifierCategoryID(group.ID)
			if !modifierCategories[categoryID] {
				modifierCategories[categoryID] = true
				group.Modifiers = options
				variants := make([]CategoryVariant, len(options))
				for i, m := range options {
					variants[i] = CategoryVariant{m.ID, clampName(m.Name), math.Max(0, jsmath.Round(m.PriceAdjustment)), true}
				}
				payload.VariantCategories = append(payload.VariantCategories, VariantCategory{
					ExternalID:   categoryID,
					InternalName: clampName("Add-on — " + group.Name),
					Name:         orDefault(clampName(group.Name), "Tambahan"),
					Rules:        SelectionRules{ModifierSelection(group)},
					Variants:     variants,
				})
			}
			item.VariantCategoryExternalIDs = append(item.VariantCategoryExternalIDs, categoryID)
		}

		payload.Menus[idx].MenuItems = append(payload.Menus[idx].MenuItems, item)
		stats.Items++
	}
	stats.Menus = len(payload.Menus)
	stats.VariantCategories = len(payload.VariantCategories)
	return payload, stats
}

/* ── product images (lib/gobiz/image.ts) ──────────────────────────────── */

var (
	directExt  = regexp.MustCompile(`(?i)\.(jpe?g|png)$`)
	httpScheme = regexp.MustCompile(`(?i)^https?://`)
)

// ImageRoute is GOFOOD_IMAGE_ROUTE, the Next route that converts WebP to JPEG.
const ImageRoute = "/api/public/gofood-image/"

// isConvertibleImageSource: our own static photos and storage uploads only.
func isConvertibleImageSource(src string) bool {
	return (strings.HasPrefix(src, "/products/") || strings.HasPrefix(src, "/api/files/")) &&
		!strings.Contains(src, "..") && !strings.Contains(src, `\`)
}

// EncodeImageSource is encodeImageSource (base64url, no padding).
func EncodeImageSource(src string) string { return base64.RawURLEncoding.EncodeToString([]byte(src)) }

// ImageURL is gofoodImageUrl: GoBiz takes JPEG/PNG over http(s) only, so a
// local JPEG/PNG is linked directly, another local photo goes through the
// converter route, and anything else is dropped ("").
func ImageURL(image, appURL string) string {
	value := JSTrim(image)
	if value == "" {
		return ""
	}
	if httpScheme.MatchString(value) {
		if directExt.MatchString(strings.SplitN(value, "?", 2)[0]) {
			return value
		}
		return ""
	}
	if appURL == "" {
		return ""
	}
	base := strings.TrimSuffix(appURL, "/")
	path := value
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if directExt.MatchString(strings.SplitN(path, "?", 2)[0]) {
		return base + path
	}
	if !isConvertibleImageSource(path) {
		return ""
	}
	return base + ImageRoute + EncodeImageSource(path) + ".jpg"
}
