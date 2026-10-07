package domain

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"nuhabit/backend/internal/platform/jsmath"
)

// Event is GofoodWebhookEvent as the zod schema in mapping.ts outputs it:
// unknown keys dropped, item defaults filled. Its JSON is what the TS
// stored in gofood_events.payload and gofood_orders.raw_payload.
type Event struct {
	Header Header `json:"header"`
	Body   Body   `json:"body"`
}

// Header is the event header.
type Header struct {
	EventName string   `json:"event_name"`
	EventID   string   `json:"event_id"`
	Version   *float64 `json:"version,omitempty"`
	Timestamp *string  `json:"timestamp,omitempty"`
}

// Body is the event body (`{}` when the payload has none).
type Body struct {
	ServiceType *string `json:"service_type,omitempty"`
	Customer    *Party  `json:"customer,omitempty"`
	Driver      *Party  `json:"driver,omitempty"`
	Outlet      *Outlet `json:"outlet,omitempty"`
	Order       *Order  `json:"order,omitempty"`
}

// Party is body.customer ({id?, name?}) or body.driver ({name?}).
type Party struct {
	ID   *string `json:"id,omitempty"`
	Name *string `json:"name,omitempty"`
}

// Outlet is body.outlet.
type Outlet struct {
	ID               *string `json:"id,omitempty"`
	ExternalOutletID *string `json:"external_outlet_id,omitempty"`
}

// Order is body.order.
type Order struct {
	Status             *string             `json:"status,omitempty"`
	Pin                *string             `json:"pin,omitempty"`
	OrderNumber        *string             `json:"order_number,omitempty"`
	OrderTotal         *float64            `json:"order_total,omitempty"`
	Currency           *string             `json:"currency,omitempty"`
	OrderItems         *[]Item             `json:"order_items,omitempty"`
	CutleryRequested   *bool               `json:"cutlery_requested,omitempty"`
	TakeawayCharges    *float64            `json:"takeaway_charges,omitempty"`
	CreatedAt          *string             `json:"created_at,omitempty"`
	CancellationDetail *CancellationDetail `json:"cancellation_detail,omitempty"`
	ScheduledFlag      *ScheduledFlag      `json:"scheduled_flag,omitempty"`
}

// CancellationDetail is order.cancellation_detail.
type CancellationDetail struct {
	Reason *string `json:"reason,omitempty"`
}

// ScheduledFlag is order.scheduled_flag.
type ScheduledFlag struct {
	IsCatering                *bool   `json:"is_catering,omitempty"`
	ScheduleDeliveryTimeStart *string `json:"schedule_delivery_time_start,omitempty"`
	ScheduleDeliveryTimeEnd   *string `json:"schedule_delivery_time_end,omitempty"`
}

// Item is GofoodWebhookItem.
type Item struct {
	ID         *string    `json:"id,omitempty"`
	ExternalID *string    `json:"external_id,omitempty"`
	Name       string     `json:"name"`
	Quantity   float64    `json:"quantity"`
	Price      float64    `json:"price"`
	Notes      *string    `json:"notes,omitempty"`
	Variants   *[]Variant `json:"variants,omitempty"`
}

// Variant is GofoodWebhookItemVariant.
type Variant struct {
	ID         *string `json:"id,omitempty"`
	Name       *string `json:"name,omitempty"`
	ExternalID *string `json:"external_id,omitempty"`
}

// StripNulls is stripNulls: real GoBiz payloads send null for empty fields,
// which the optional-only schema would reject, so nulls (and null array
// items) are dropped first.
func StripNulls(v any) any {
	switch x := v.(type) {
	case []any:
		out := make([]any, 0, len(x))
		for _, item := range x {
			if item != nil {
				out = append(out, StripNulls(item))
			}
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, item := range x {
			if item != nil {
				out[k] = StripNulls(item)
			}
		}
		return out
	}
	return v
}

// ParseWebhook is parseGofoodWebhook over the raw body (JSON.parse, then
// stripNulls and the zod schema); nil when GoBiz would not send it.
func ParseWebhook(raw string) *Event {
	var v any
	if raw == "" || json.Unmarshal([]byte(raw), &v) != nil {
		return nil
	}
	root, ok := StripNulls(v).(map[string]any)
	if !ok {
		return nil
	}
	p := &parser{}
	ev := p.event(root)
	if p.failed {
		return nil
	}
	return ev
}

// parser mirrors the zod schema; any mismatch sets failed.
type parser struct{ failed bool }

// object is z.object(...).optional(): absent is nil, a non-object fails.
func (p *parser) object(m map[string]any, key string) map[string]any {
	v, ok := m[key]
	if !ok {
		return nil
	}
	obj, ok := v.(map[string]any)
	if !ok {
		p.failed = true
	}
	return obj
}

// str is z.string().optional().
func (p *parser) str(m map[string]any, key string) *string {
	v, ok := m[key]
	if !ok {
		return nil
	}
	s, ok := v.(string)
	if !ok {
		p.failed = true
		return nil
	}
	return &s
}

// boolean is z.boolean().optional().
func (p *parser) boolean(m map[string]any, key string) *bool {
	v, ok := m[key]
	if !ok {
		return nil
	}
	b, ok := v.(bool)
	if !ok {
		p.failed = true
		return nil
	}
	return &b
}

// number is z.number().optional() (version): finite numbers only.
func (p *parser) number(m map[string]any, key string) *float64 {
	v, ok := m[key]
	if !ok {
		return nil
	}
	n, ok := v.(float64)
	if !ok {
		p.failed = true
		return nil
	}
	return &n
}

// numberish is the `numberish` preprocess: "" is 0, anything else goes
// through Number() and must come out finite.
func (p *parser) numberish(m map[string]any, key string) *float64 {
	v, ok := m[key]
	if !ok {
		return nil
	}
	n := jsNumber(v)
	if math.IsNaN(n) || math.IsInf(n, 0) {
		p.failed = true
		return nil
	}
	return &n
}

func (p *parser) event(root map[string]any) *Event {
	ev := &Event{}
	header, ok := root["header"].(map[string]any)
	if !ok {
		p.failed = true
		return nil
	}
	name, id := p.str(header, "event_name"), p.str(header, "event_id")
	if name == nil || id == nil || *name == "" || *id == "" {
		p.failed = true
		return nil
	}
	ev.Header = Header{EventName: *name, EventID: *id, Version: p.number(header, "version"), Timestamp: p.str(header, "timestamp")}

	body := p.object(root, "body")
	if body == nil {
		return ev
	}
	ev.Body.ServiceType = p.str(body, "service_type")
	if c := p.object(body, "customer"); c != nil {
		ev.Body.Customer = &Party{ID: p.str(c, "id"), Name: p.str(c, "name")}
	}
	if d := p.object(body, "driver"); d != nil {
		ev.Body.Driver = &Party{Name: p.str(d, "name")}
	}
	if o := p.object(body, "outlet"); o != nil {
		ev.Body.Outlet = &Outlet{ID: p.str(o, "id"), ExternalOutletID: p.str(o, "external_outlet_id")}
	}
	if o := p.object(body, "order"); o != nil {
		ev.Body.Order = p.order(o)
	}
	return ev
}

func (p *parser) order(o map[string]any) *Order {
	out := &Order{
		Status:      p.str(o, "status"),
		Pin:         p.str(o, "pin"),
		OrderNumber: p.str(o, "order_number"),
		OrderTotal:  p.numberish(o, "order_total"),
		Currency:    p.str(o, "currency"),
	}
	if v, ok := o["order_items"]; ok {
		list, isList := v.([]any)
		if !isList {
			p.failed = true
		}
		items := make([]Item, 0, len(list))
		for _, raw := range list {
			m, isObj := raw.(map[string]any)
			if !isObj {
				p.failed = true
				continue
			}
			items = append(items, p.item(m))
		}
		out.OrderItems = &items
	}
	out.CutleryRequested = p.boolean(o, "cutlery_requested")
	out.TakeawayCharges = p.numberish(o, "takeaway_charges")
	out.CreatedAt = p.str(o, "created_at")
	if c := p.object(o, "cancellation_detail"); c != nil {
		out.CancellationDetail = &CancellationDetail{Reason: p.str(c, "reason")}
	}
	if s := p.object(o, "scheduled_flag"); s != nil {
		out.ScheduledFlag = &ScheduledFlag{
			IsCatering:                p.boolean(s, "is_catering"),
			ScheduleDeliveryTimeStart: p.str(s, "schedule_delivery_time_start"),
			ScheduleDeliveryTimeEnd:   p.str(s, "schedule_delivery_time_end"),
		}
	}
	return out
}

func (p *parser) item(m map[string]any) Item {
	it := Item{ID: p.str(m, "id"), ExternalID: p.str(m, "external_id"), Quantity: 1}
	if s := p.str(m, "name"); s != nil {
		it.Name = *s
	}
	if n := p.numberish(m, "quantity"); n != nil {
		it.Quantity = *n
	}
	if n := p.numberish(m, "price"); n != nil {
		it.Price = *n
	}
	it.Notes = p.str(m, "notes")
	if v, ok := m["variants"]; ok {
		list, isList := v.([]any)
		if !isList {
			p.failed = true
		}
		variants := make([]Variant, 0, len(list))
		for _, raw := range list {
			vm, isObj := raw.(map[string]any)
			if !isObj {
				p.failed = true
				continue
			}
			variants = append(variants, Variant{ID: p.str(vm, "id"), Name: p.str(vm, "name"), ExternalID: p.str(vm, "external_id")})
		}
		it.Variants = &variants
	}
	return it
}

// jsNumber is Number(value) for a decoded JSON value.
func jsNumber(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		return stringToNumber(x)
	case []any:
		// Number([x]) is Number(String([x])).
		switch len(x) {
		case 0:
			return 0
		case 1:
			if s, ok := x[0].(string); ok {
				return stringToNumber(s)
			}
			if n, ok := x[0].(float64); ok {
				return n
			}
			if _, ok := x[0].([]any); ok {
				return jsNumber(x[0])
			}
		}
	}
	return math.NaN()
}

// stringToNumber is Number(string).
func stringToNumber(s string) float64 {
	s = JSTrim(s)
	switch s {
	case "":
		return 0
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if len(s) > 2 && s[0] == '0' {
		if base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[s[1]]; base != 0 {
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	// ParseFloat also takes "inf", "nan", hex floats and "_"; JS does not.
	if strings.ContainsAny(s, "_iInNxXpP") {
		return math.NaN()
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

/* ── order status ─────────────────────────────────────────────────────── */

// OrderTypeFromServiceType is gofoodOrderTypeFromServiceType.
func OrderTypeFromServiceType(serviceType *string) string {
	if serviceType != nil && strings.Contains(strings.ToLower(*serviceType), "pickup") {
		return "pickup"
	}
	return "delivery"
}

// StatusFromEventName is statusFromEventName ("" = no status change).
func StatusFromEventName(eventName string) string {
	switch eventName {
	case "gofood.order.created":
		return "created"
	case "gofood.order.awaiting_merchant_acceptance":
		return "awaiting_acceptance"
	case "gofood.order.merchant_accepted":
		return "accepted"
	case "gofood.order.driver_otw_pickup":
		return "driver_otw_pickup"
	case "gofood.order.driver_arrived":
		return "driver_arrived"
	case "gofood.order.placed":
		return "placed"
	case "gofood.order.completed":
		return "completed"
	case "gofood.order.cancelled":
		return "cancelled"
	}
	return ""
}

var statusRank = map[string]int{
	"created": 0, "awaiting_acceptance": 1, "accepted": 2, "driver_otw_pickup": 3, "driver_arrived": 4,
	"placed": 5, "completed": 6, "rejected": 9, "cancelled": 9, "error": 9,
}

func terminal(status string) bool {
	return status == "cancelled" || status == "rejected" || status == "completed"
}

// ShouldAdvanceStatus is shouldAdvanceStatus: events may arrive late or
// twice, so the status only moves forward, except that a terminal status
// always wins over a non-terminal one.
func ShouldAdvanceStatus(current, next string) bool {
	if current == next {
		return false
	}
	if terminal(next) {
		return !terminal(current)
	}
	if terminal(current) {
		return false
	}
	return statusRank[next] > statusRank[current]
}

// WebhookEvents is GOFOOD_WEBHOOK_EVENTS: what registerGobizWebhooks
// subscribes to.
var WebhookEvents = []string{
	"gofood.order.created",
	"gofood.order.awaiting_merchant_acceptance",
	"gofood.order.merchant_accepted",
	"gofood.order.driver_otw_pickup",
	"gofood.order.driver_arrived",
	"gofood.order.placed",
	"gofood.order.completed",
	"gofood.order.cancelled",
	"gofood.order.webhook_error",
	"gofood.catalog.menu_mapping_updated",
}

// OrderSummary is summarizeGofoodOrder: the gofood_orders columns of an
// event.
type OrderSummary struct {
	GofoodOrderID    string
	GofoodOrderType  string
	OutletID         *string
	OrderTotal       float64
	Currency         string
	CustomerName     *string
	DriverName       *string
	Pin              *string
	CutleryRequested bool
	TakeawayCharges  float64
	CancelReason     *string
	Items            []Item
}

// Summarize is summarizeGofoodOrder.
func Summarize(ev *Event) OrderSummary {
	o := ev.Body.Order
	if o == nil {
		o = &Order{}
	}
	s := OrderSummary{
		GofoodOrderID:    JSTrim(deref(o.OrderNumber)),
		GofoodOrderType:  OrderTypeFromServiceType(ev.Body.ServiceType),
		OrderTotal:       nonNegativeRound(o.OrderTotal),
		Currency:         orDefault(deref(o.Currency), "IDR"),
		Pin:              o.Pin,
		CutleryRequested: o.CutleryRequested != nil && *o.CutleryRequested,
		TakeawayCharges:  nonNegativeRound(o.TakeawayCharges),
		Items:            []Item{},
	}
	if ev.Body.Outlet != nil {
		s.OutletID = ev.Body.Outlet.ID
	}
	if ev.Body.Customer != nil {
		s.CustomerName = trimmedOrNil(ev.Body.Customer.Name)
	}
	if ev.Body.Driver != nil {
		s.DriverName = trimmedOrNil(ev.Body.Driver.Name)
	}
	if o.CancellationDetail != nil {
		s.CancelReason = trimmedOrNil(o.CancellationDetail.Reason)
	}
	if o.OrderItems != nil {
		s.Items = *o.OrderItems
	}
	return s
}

// nonNegativeRound is Math.max(0, Math.round(Number(v) || 0)).
func nonNegativeRound(v *float64) float64 {
	if v == nil {
		return 0
	}
	return math.Max(0, jsmath.Round(*v))
}

/* ── item mapping ─────────────────────────────────────────────────────── */

// ProductRef is CatalogProductRef: what mapping needs of a POS product.
type ProductRef struct {
	ID        string
	Name      string
	SKU       string
	Station   string
	Variants  []RefVariant
	Modifiers []RefModifier
}

// RefVariant is a POS variant (pos_product_variants).
type RefVariant struct{ ID, Name string }

// RefModifier is a POS add-on option with its GoFood price.
type RefModifier struct {
	ID, Name, GroupName string
	Price               float64
}

// LineModifier is the add-on stored on a mapped line ({name, group, price}).
type LineModifier struct {
	Name  string  `json:"name"`
	Group string  `json:"group"`
	Price float64 `json:"price"`
}

// MappedLine is MappedGofoodLine (gofood_orders.items).
type MappedLine struct {
	ProductID   string         `json:"product_id"`
	ProductName string         `json:"product_name"`
	ProductSKU  string         `json:"product_sku"`
	Quantity    float64        `json:"quantity"`
	UnitPrice   float64        `json:"unit_price"`
	VariantName *string        `json:"variant_name"`
	Modifiers   []LineModifier `json:"modifiers,omitempty"`
	Notes       *string        `json:"notes"`
	Station     string         `json:"station"`
}

// UnmappedLine is UnmappedGofoodLine (gofood_orders.unmapped_items).
type UnmappedLine struct {
	GofoodItemID *string `json:"gofood_item_id"`
	ExternalID   *string `json:"external_id"`
	Name         string  `json:"name"`
	Quantity     float64 `json:"quantity"`
	Price        float64 `json:"price"`
	Reason       string  `json:"reason"`
}

// MappedItems is mapGofoodItems' result.
type MappedItems struct {
	Lines    []MappedLine
	Unmapped []UnmappedLine
}

// MapItems is mapGofoodItems: match GoFood items to POS products by
// external_id (= pos_products.id). GoFood choices become POS add-ons when
// their external_id is a modifier, else variant text, so the kitchen sees
// them; the unit price is what the customer paid at GoFood.
func MapItems(items []Item, products map[string]ProductRef) MappedItems {
	out := MappedItems{Lines: []MappedLine{}, Unmapped: []UnmappedLine{}}
	for _, item := range items {
		quantity := math.Max(1, jsmath.Round(orOne(item.Quantity)))
		price := math.Max(0, jsmath.Round(item.Price))
		var externalID *string
		if item.ExternalID != nil && *item.ExternalID != "" {
			externalID = item.ExternalID
		}
		product, found := ProductRef{}, false
		if externalID != nil {
			product, found = products[*externalID]
		}
		if !found {
			reason := "no_external_id"
			if externalID != nil {
				reason = "product_not_found"
			}
			out.Unmapped = append(out.Unmapped, UnmappedLine{
				GofoodItemID: item.ID, ExternalID: externalID, Name: item.Name,
				Quantity: quantity, Price: price, Reason: reason,
			})
			continue
		}

		var variantNames []string
		var modifiers []LineModifier
		if item.Variants != nil {
			for _, v := range *item.Variants {
				vid := ""
				if v.ExternalID != nil {
					vid = *v.ExternalID
				}
				if m, ok := findModifier(product.Modifiers, vid); ok {
					modifiers = append(modifiers, LineModifier{Name: m.Name, Group: m.GroupName, Price: m.Price})
					continue
				}
				name := ""
				if known, ok := findVariant(product.Variants, vid); ok {
					name = known.Name
				}
				if name == "" {
					name = deref(v.Name)
				}
				if name = JSTrim(name); name != "" {
					variantNames = append(variantNames, name)
				}
			}
		}
		line := MappedLine{
			ProductID:   product.ID,
			ProductName: product.Name,
			ProductSKU:  utf16Prefix(product.SKU, 50),
			Quantity:    quantity,
			UnitPrice:   price,
			Modifiers:   modifiers,
			Notes:       trimmedOrNil(item.Notes),
			Station:     product.Station,
		}
		if len(variantNames) > 0 {
			joined := strings.Join(variantNames, ", ")
			line.VariantName = &joined
		}
		out.Lines = append(out.Lines, line)
	}
	return out
}

func findModifier(list []RefModifier, id string) (RefModifier, bool) {
	for _, m := range list {
		if id != "" && m.ID == id {
			return m, true
		}
	}
	return RefModifier{}, false
}

func findVariant(list []RefVariant, id string) (RefVariant, bool) {
	for _, v := range list {
		if id != "" && v.ID == id {
			return v, true
		}
	}
	return RefVariant{}, false
}

/* ── small JS helpers ─────────────────────────────────────────────────── */

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// orOne is `Number(x) || 1`.
func orOne(x float64) float64 {
	if x == 0 || math.IsNaN(x) {
		return 1
	}
	return x
}

// trimmedOrNil is `value?.trim() || null`.
func trimmedOrNil(p *string) *string {
	if p == nil {
		return nil
	}
	s := JSTrim(*p)
	if s == "" {
		return nil
	}
	return &s
}

// utf16Prefix is String#slice(0, n): n UTF-16 units.
func utf16Prefix(s string, n int) string {
	units := utf16.Encode([]rune(s))
	if len(units) <= n {
		return s
	}
	return string(utf16.Decode(units[:n]))
}

// uuidPattern is UUID_RE of lib/table-order/server.ts (versions 1-5).
var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// ProductIDs is the id list loadProductRefs hands to loadProductsByIds:
// the items' external ids, keeping only unique version 1-5 UUIDs.
func ProductIDs(items []Item) []string {
	seen := map[string]bool{}
	ids := []string{}
	for _, item := range items {
		if id := deref(item.ExternalID); uuidPattern.MatchString(id) && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids
}
