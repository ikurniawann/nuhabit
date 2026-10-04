package domain

import (
	"bytes"
	"encoding/json"
	"math"
	"slices"
	"sort"
)

// Offer types (OFFER_TYPES).
const (
	OfferBundle = "bundle"
	OfferBxgy   = "bxgy"
	OfferVolume = "volume"
)

// OfferTypes lists the offer types in TS order.
var OfferTypes = []string{OfferBundle, OfferBxgy, OfferVolume}

// OfferCartLine is one POS cart line.
type OfferCartLine struct {
	ProductID string
	Quantity  float64
	UnitPrice float64
}

// OfferEvalItem is one rule target. ProductID is "" for an unexpanded
// category target (see ExpandCategoryTargets).
type OfferEvalItem struct {
	Role       string
	ProductID  string
	CategoryID *string
	Qty        float64
	// noCategoryKey drops category_id from the JSON, as the TS objects
	// ExpandCategoryTargets builds for category members lack the key.
	noCategoryKey bool
}

// MarshalJSON writes {role, product_id[, category_id], qty}.
func (i OfferEvalItem) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteString(`{"role":`)
	writeJSON(&b, i.Role)
	b.WriteString(`,"product_id":`)
	writeJSON(&b, i.ProductID)
	if !i.noCategoryKey {
		b.WriteString(`,"category_id":`)
		writeJSON(&b, i.CategoryID)
	}
	b.WriteString(`,"qty":`)
	writeJSON(&b, i.Qty)
	b.WriteByte('}')
	return b.Bytes(), nil
}

func writeJSON(b *bytes.Buffer, v any) {
	raw, _ := json.Marshal(v)
	b.Write(raw)
}

// OfferEvalRule is an offer rule ready for evaluation; its JSON matches
// toOfferEvalRules (the `eval` field of /api/pos/offer-rules).
type OfferEvalRule struct {
	ID            string   `json:"id"`
	OfferType     string   `json:"offer_type"`
	Name          string   `json:"name"`
	Description   *string  `json:"description"`
	BundlePrice   *float64 `json:"bundle_price"`
	BuyQty        *int     `json:"buy_qty"`
	GetQty        *int     `json:"get_qty"`
	GetMode       *string  `json:"get_mode"`
	VolumeBasis   *string  `json:"volume_basis"`
	VolumeMin     *float64 `json:"volume_min"`
	DiscountType  *string  `json:"discount_type"`
	DiscountValue *float64 `json:"discount_value"`
	// SalesChannels nil or empty = every channel.
	SalesChannels []string `json:"sales_channels"`
	// RequiresCode = active only once the cashier typed its unlock code.
	RequiresCode bool `json:"requires_code"`
	// IsExclusive = never stacked; wins only when >= the stacked total.
	IsExclusive bool `json:"is_exclusive"`
	// Priority: higher is processed first (default 0).
	Priority         int             `json:"priority"`
	MaxUses          *int            `json:"max_uses"`
	UsedCount        int             `json:"used_count"`
	MaxUsesPerMember *int            `json:"max_uses_per_member"`
	MemberUsedCount  int             `json:"member_used_count"`
	Items            []OfferEvalItem `json:"items"`
}

// OfferEvalContext is the transaction context.
type OfferEvalContext struct {
	// Channel "" ignores the channel limit.
	Channel string
	// UnlockedRuleIDs are coded offers the cashier unlocked.
	UnlockedRuleIDs []string
}

// FreeUnit is one BXGY free unit group (the FREE row in the cart UI).
type FreeUnit struct {
	ProductID string  `json:"productId"`
	Qty       float64 `json:"qty"`
	UnitPrice float64 `json:"unitPrice"`
}

// AppliedOffer is one offer applied to a cart.
type AppliedOffer struct {
	RuleID    string     `json:"rule_id"`
	OfferType string     `json:"offer_type"`
	Name      string     `json:"name"`
	Discount  float64    `json:"discount"`
	FreeUnits []FreeUnit `json:"free_units"`
}

// OfferEvalResult is the evaluation of a cart.
type OfferEvalResult struct {
	OfferDiscount float64        `json:"offer_discount"`
	Applied       []AppliedOffer `json:"applied"`
}

// Offer skip reasons (OfferSkipReason).
const (
	SkipChannel     = "channel"
	SkipCode        = "kode"
	SkipQuotaUsed   = "kuota-habis"
	SkipMemberLimit = "limit-member"
)

// OfferCaps are the total and per-member quotas with their live counts.
type OfferCaps struct {
	MaxUses          *int
	UsedCount        int
	MaxUsesPerMember *int
	MemberUsedCount  int
}

// Caps returns the rule's quotas.
func (r OfferEvalRule) Caps() OfferCaps {
	return OfferCaps{MaxUses: r.MaxUses, UsedCount: r.UsedCount, MaxUsesPerMember: r.MaxUsesPerMember, MemberUsedCount: r.MemberUsedCount}
}

// OfferCapReason is "kuota-habis", "limit-member" or "" (offerCapReason);
// the total quota is checked first.
func OfferCapReason(c OfferCaps) string {
	if c.MaxUses != nil && c.UsedCount >= *c.MaxUses {
		return SkipQuotaUsed
	}
	if c.MaxUsesPerMember != nil && c.MemberUsedCount >= *c.MaxUsesPerMember {
		return SkipMemberLimit
	}
	return ""
}

// OfferSkipReason checks the non-cart conditions (channel, unlock code,
// quotas); "" = the rule may be evaluated. Without a member the member
// count is 0.
func OfferSkipReason(r OfferEvalRule, ctx OfferEvalContext) string {
	if ctx.Channel != "" && len(r.SalesChannels) > 0 && !slices.Contains(r.SalesChannels, ctx.Channel) {
		return SkipChannel
	}
	if r.RequiresCode && !slices.Contains(ctx.UnlockedRuleIDs, r.ID) {
		return SkipCode
	}
	return OfferCapReason(r.Caps())
}

// ExpandCategoryTargets replaces category targets with their member
// products so the evaluator works per product. The order endpoint and the
// cashier endpoint use the same map, so client and server discounts match.
func ExpandCategoryTargets(rules []OfferEvalRule, productIDsByCategory map[string][]string) []OfferEvalRule {
	out := make([]OfferEvalRule, len(rules))
	for ri, rule := range rules {
		out[ri] = rule
		if !slices.ContainsFunc(rule.Items, func(i OfferEvalItem) bool { return truthy(i.CategoryID) }) {
			continue
		}
		items := []OfferEvalItem{}
		seen := map[string]bool{}
		push := func(item OfferEvalItem) {
			key := item.Role + ":" + item.ProductID
			if seen[key] {
				return
			}
			seen[key] = true
			items = append(items, item)
		}
		for _, item := range rule.Items {
			if !truthy(item.CategoryID) {
				push(item)
				continue
			}
			members := productIDsByCategory[*item.CategoryID]
			// An empty category stays a target that matches nothing, so a
			// volume rule does not fall back to "every item".
			if len(members) == 0 {
				empty := item
				empty.ProductID = ""
				push(empty)
			}
			for _, productID := range members {
				push(OfferEvalItem{Role: item.Role, ProductID: productID, Qty: item.Qty, noCategoryKey: true})
			}
		}
		out[ri].Items = items
	}
	return out
}

func truthy(s *string) bool { return s != nil && *s != "" }

/* ── evaluator ───────────────────────────────────────────────────────── */

type consumed struct {
	productID string
	qty       float64
}

type evalOutcome struct {
	discount float64
	consume  []consumed
	free     []consumed
}

func qtyByProduct(lines []OfferCartLine) map[string]float64 {
	m := map[string]float64{}
	for _, l := range lines {
		if l.ProductID == "" {
			continue
		}
		q := max(0, finite(l.Quantity))
		if q <= 0 {
			continue
		}
		m[l.ProductID] += q
	}
	return m
}

// priceByProduct keeps the highest unit price per product (conservative
// for the value of free items).
func priceByProduct(lines []OfferCartLine) map[string]float64 {
	m := map[string]float64{}
	for _, l := range lines {
		if l.ProductID == "" {
			continue
		}
		price := max(0, finite(l.UnitPrice))
		if existing, ok := m[l.ProductID]; ok {
			price = max(existing, price)
		}
		m[l.ProductID] = price
	}
	return m
}

func finite(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

func consume(qty map[string]float64, productID string, need float64) float64 {
	have := qty[productID]
	take := min(have, need)
	qty[productID] = have - take
	return take
}

func itemsWithRole(r OfferEvalRule, role string) []OfferEvalItem {
	var out []OfferEvalItem
	for _, i := range r.Items {
		if i.Role == role {
			out = append(out, i)
		}
	}
	return out
}

func productIDsWithRole(r OfferEvalRule, role string) []string {
	var out []string
	for _, i := range itemsWithRole(r, role) {
		out = append(out, i.ProductID)
	}
	return out
}

// orOne is `Number(x) || 1`.
func orOne(v float64) float64 {
	if v == 0 || math.IsNaN(v) {
		return 1
	}
	return v
}

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

func evalBundle(r OfferEvalRule, qty, price map[string]float64) evalOutcome {
	components := itemsWithRole(r, "component")
	bundlePrice := max(0, deref(r.BundlePrice))
	if len(components) < 2 || bundlePrice <= 0 {
		return evalOutcome{}
	}
	sets := math.Inf(1)
	for _, c := range components {
		need := max(0.001, orOne(c.Qty))
		sets = min(sets, math.Floor(qty[c.ProductID]/need))
	}
	if math.IsInf(sets, 0) || sets <= 0 {
		return evalOutcome{}
	}
	retail := 0.0
	var used []consumed
	for _, c := range components {
		n := max(0.001, orOne(c.Qty)) * sets
		retail += price[c.ProductID] * n
		used = append(used, consumed{c.ProductID, n})
	}
	return evalOutcome{discount: max(0, math.Floor(retail-bundlePrice*sets)), consume: used}
}

type pooled struct {
	id    string
	have  float64
	price float64
}

// pool lists the products held in the cart (and priced when pricedOnly),
// cheapest first; equal prices keep the rule order.
func pool(ids []string, qty, price map[string]float64, pricedOnly bool) []*pooled {
	var out []*pooled
	for _, id := range ids {
		p := &pooled{id: id, have: qty[id], price: price[id]}
		if p.have > 0 && (!pricedOnly || p.price > 0) {
			out = append(out, p)
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].price < out[b].price })
	return out
}

func evalBxgy(r OfferEvalRule, qty, price map[string]float64) evalOutcome {
	buyQty := max(0, math.Floor(float64(deref(r.BuyQty))))
	getQty := max(0, math.Floor(float64(deref(r.GetQty))))
	if buyQty <= 0 || getQty <= 0 {
		return evalOutcome{}
	}
	buyProducts := productIDsWithRole(r, "buy")
	if len(buyProducts) == 0 {
		return evalOutcome{}
	}
	buyHave := 0.0
	for _, id := range buyProducts {
		buyHave += qty[id]
	}
	mode := deref(r.GetMode)
	if mode == "" {
		mode = "same_as_buy"
	}

	if mode != "same_as_buy" {
		getProducts := productIDsWithRole(r, "get")
		if len(getProducts) == 0 {
			return evalOutcome{}
		}
		times := math.Floor(buyHave / buyQty)
		if times <= 0 {
			return evalOutcome{}
		}
		out := evalOutcome{}
		buyNeed := times * buyQty
		for _, b := range pool(buyProducts, qty, price, false) {
			if buyNeed <= 0 {
				break
			}
			take := min(b.have, buyNeed)
			out.consume = append(out.consume, consumed{b.id, take})
			buyNeed -= take
		}
		remaining := times * getQty
		for _, p := range pool(getProducts, qty, price, true) {
			if remaining <= 0 {
				break
			}
			take := min(p.have, remaining)
			out.discount += math.Floor(p.price * take)
			out.consume = append(out.consume, consumed{p.id, take})
			out.free = append(out.free, consumed{p.id, take})
			remaining -= take
		}
		out.discount = max(0, out.discount)
		return out
	}

	// Buy X get Y from the same pool: one cycle is X+Y units; the cheapest
	// units are the free ones.
	times := math.Floor(buyHave / (buyQty + getQty))
	if times <= 0 {
		return evalOutcome{}
	}
	payNeed, freeNeed := times*buyQty, times*getQty
	out := evalOutcome{}
	items := pool(buyProducts, qty, price, false)
	for _, p := range items {
		if freeNeed <= 0 {
			break
		}
		take := min(p.have, freeNeed)
		out.discount += math.Floor(p.price * take)
		out.consume = append(out.consume, consumed{p.id, take})
		out.free = append(out.free, consumed{p.id, take})
		freeNeed -= take
		p.have -= take
	}
	for _, p := range items {
		if payNeed <= 0 {
			break
		}
		take := min(p.have, payNeed)
		if take <= 0 {
			continue
		}
		out.consume = append(out.consume, consumed{p.id, take})
		payNeed -= take
		p.have -= take
	}
	out.discount = max(0, out.discount)
	return out
}

// evalVolume never reserves quantity for other rules.
func evalVolume(r OfferEvalRule, lines []OfferCartLine) evalOutcome {
	eligible := productIDsWithRole(r, "eligible")
	scoped := lines
	if len(eligible) > 0 {
		scoped = nil
		for _, l := range lines {
			if slices.Contains(eligible, l.ProductID) {
				scoped = append(scoped, l)
			}
		}
	}
	minimum := max(0, deref(r.VolumeMin))
	if minimum <= 0 {
		return evalOutcome{}
	}
	totalQty, totalSpend := 0.0, 0.0
	for _, l := range scoped {
		totalQty += max(0, l.Quantity)
		totalSpend += max(0, l.Quantity) * max(0, l.UnitPrice)
	}
	reached := totalQty >= minimum
	if deref(r.VolumeBasis) == "spend" {
		reached = totalSpend >= minimum
	}
	if !reached {
		return evalOutcome{}
	}
	value := deref(r.DiscountValue)
	if r.DiscountType == nil || *r.DiscountType == "" || value <= 0 {
		return evalOutcome{}
	}
	base := math.Floor(totalSpend)
	discount := math.Floor(value)
	if *r.DiscountType == "percent" {
		discount = math.Floor(base * min(100, value) / 100)
	}
	return evalOutcome{discount: min(discount, base)}
}

func evalOne(r OfferEvalRule, lines []OfferCartLine, qty, price map[string]float64) evalOutcome {
	switch r.OfferType {
	case OfferBundle:
		return evalBundle(r, qty, price)
	case OfferBxgy:
		return evalBxgy(r, qty, price)
	case OfferVolume:
		return evalVolume(r, lines)
	}
	return evalOutcome{}
}

type scoredRule struct {
	rule     OfferEvalRule
	discount float64
	applied  []AppliedOffer
}

// byPriorityThenDiscount sorts higher priority first, then bigger discount.
func byPriorityThenDiscount(list []scoredRule) {
	sort.SliceStable(list, func(a, b int) bool {
		if list[a].rule.Priority != list[b].rule.Priority {
			return list[a].rule.Priority > list[b].rule.Priority
		}
		return list[a].discount > list[b].discount
	})
}

// stackOffers applies one group of stackable rules greedily: highest
// priority first, then biggest discount. Quantity used by a bundle or
// BXGY is not reused; volume reserves nothing and only the best volume
// rule is kept.
func stackOffers(lines []OfferCartLine, rules []OfferEvalRule) []AppliedOffer {
	price := priceByProduct(lines)
	qty := qtyByProduct(lines)
	applied := []AppliedOffer{}

	var scored []scoredRule
	for _, r := range rules {
		if d := evalOne(r, lines, cloneQty(qty), price).discount; d > 0 {
			scored = append(scored, scoredRule{rule: r, discount: d})
		}
	}
	byPriorityThenDiscount(scored)

	for _, s := range scored {
		out := evalOne(s.rule, lines, qty, price)
		if out.discount <= 0 {
			continue
		}
		if s.rule.OfferType != OfferVolume {
			check := cloneQty(qty)
			enough := true
			for _, u := range out.consume {
				if consume(check, u.productID, u.qty) < u.qty-1e-9 {
					enough = false
					break
				}
			}
			if !enough {
				continue
			}
			for _, u := range out.consume {
				consume(qty, u.productID, u.qty)
			}
		}
		free := []FreeUnit{}
		for _, f := range out.free {
			free = append(free, FreeUnit{ProductID: f.productID, Qty: f.qty, UnitPrice: price[f.productID]})
		}
		applied = append(applied, AppliedOffer{
			RuleID: s.rule.ID, OfferType: s.rule.OfferType, Name: s.rule.Name, Discount: out.discount, FreeUnits: free,
		})
	}

	var best *AppliedOffer
	volumes := 0
	for i := range applied {
		if applied[i].OfferType == OfferVolume {
			volumes++
			if best == nil || applied[i].Discount > best.Discount {
				best = &applied[i]
			}
		}
	}
	if volumes <= 1 {
		return applied
	}
	bestID := best.RuleID
	kept := []AppliedOffer{}
	for _, a := range applied {
		if a.OfferType != OfferVolume || a.RuleID == bestID {
			kept = append(kept, a)
		}
	}
	return kept
}

func cloneQty(m map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func sumDiscount(applied []AppliedOffer) float64 {
	total := 0.0
	for _, a := range applied {
		total += a.Discount
	}
	return total
}

// EvaluateOfferRules applies active offers to a cart. Exclusive offers
// never stack, so the engine compares the chosen exclusive offer alone
// (highest priority, then biggest discount) with every non-exclusive offer
// stacked, and gives the bigger one (a tie goes to the exclusive). The
// total never exceeds the subtotal.
func EvaluateOfferRules(lines []OfferCartLine, rules []OfferEvalRule, ctx OfferEvalContext) OfferEvalResult {
	var stackable, exclusive []OfferEvalRule
	for _, r := range rules {
		if OfferSkipReason(r, ctx) != "" {
			continue
		}
		if r.IsExclusive {
			exclusive = append(exclusive, r)
		} else {
			stackable = append(stackable, r)
		}
	}
	applied := stackOffers(lines, stackable)
	stackedTotal := sumDiscount(applied)

	var candidates []scoredRule
	for _, r := range exclusive {
		alone := stackOffers(lines, []OfferEvalRule{r})
		if d := sumDiscount(alone); d > 0 {
			candidates = append(candidates, scoredRule{rule: r, discount: d, applied: alone})
		}
	}
	byPriorityThenDiscount(candidates)
	if len(candidates) > 0 && candidates[0].discount >= stackedTotal {
		applied = candidates[0].applied
	}

	subtotal := 0.0
	for _, l := range lines {
		subtotal += max(0, finite(l.Quantity)) * max(0, finite(l.UnitPrice))
	}
	return OfferEvalResult{OfferDiscount: min(sumDiscount(applied), math.Floor(subtotal)), Applied: applied}
}
