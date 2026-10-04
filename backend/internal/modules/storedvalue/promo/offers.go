package promo

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/storedvalue/promo/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Offer rules: bundles, buy X get Y and volume discounts
// (offer-rules-server.ts, offer-pos.ts).

// OfferRuleDetail is an offer rule with its items (OfferRuleDetail).
// Numeric columns are text, as node-postgres returns them.
type OfferRuleDetail struct {
	ID               string   `json:"id"`
	CompanyID        string   `json:"company_id"`
	BranchID         string   `json:"branch_id"`
	OfferType        string   `json:"offer_type"`
	Name             string   `json:"name"`
	Description      *string  `json:"description"`
	ValidFrom        *string  `json:"valid_from"`
	ValidUntil       *string  `json:"valid_until"`
	IsActive         bool     `json:"is_active"`
	BundlePrice      *string  `json:"bundle_price"`
	BuyQty           *int     `json:"buy_qty"`
	GetQty           *int     `json:"get_qty"`
	GetMode          *string  `json:"get_mode"`
	VolumeBasis      *string  `json:"volume_basis"`
	VolumeMin        *string  `json:"volume_min"`
	DiscountType     *string  `json:"discount_type"`
	DiscountValue    *string  `json:"discount_value"`
	SalesChannels    []string `json:"sales_channels"`
	MaxUses          *int     `json:"max_uses"`
	MaxUsesPerMember *int     `json:"max_uses_per_member"`
	IsExclusive      bool     `json:"is_exclusive"`
	Priority         int      `json:"priority"`
	UnlockCode       *string  `json:"unlock_code"`
	// UsedCount counts live uses (fresh held + captured) across orders.
	UsedCount int `json:"used_count"`
	// MemberUsedCount counts live uses of the requested member (0 without).
	MemberUsedCount int             `json:"member_used_count"`
	CreatedAt       jsTime          `json:"created_at"`
	UpdatedAt       jsTime          `json:"updated_at"`
	Items           []OfferRuleItem `json:"items" db:"-"`
}

// OfferRuleItem is one promo.offer_rule_items row with the POS names.
type OfferRuleItem struct {
	ID           string  `json:"id"`
	RuleID       string  `json:"rule_id"`
	Role         string  `json:"role"`
	ProductID    *string `json:"product_id"`
	CategoryID   *string `json:"category_id"`
	Qty          string  `json:"qty"`
	SortOrder    int     `json:"sort_order"`
	ProductName  *string `json:"product_name" db:"-"`
	CategoryName *string `json:"category_name" db:"-"`
}

// liveUsage counts captured uses and held ones younger than 30 minutes; an
// older hold is a checkout that failed midway and expires on its own.
const liveUsage = `(u.status = 'captured' OR (u.status = 'held' AND u.created_at > now() - interval '30 minutes'))`

const ruleSelect = `
	SELECT r.id, r.company_id, r.branch_id, r.offer_type, r.name, r.description,
	       r.valid_from::text, r.valid_until::text, r.is_active,
	       r.bundle_price::text, r.buy_qty, r.get_qty, r.get_mode,
	       r.volume_basis, r.volume_min::text, r.discount_type, r.discount_value::text,
	       r.sales_channels, r.max_uses, r.max_uses_per_member, r.is_exclusive,
	       r.priority, r.unlock_code,
	       (SELECT COUNT(*)::int FROM promo.offer_usages u
	         WHERE u.rule_id = r.id AND ` + liveUsage + `) AS used_count,
	       (SELECT COUNT(*)::int FROM promo.offer_usages u
	         WHERE u.rule_id = r.id AND u.customer_id = $1::uuid AND ` + liveUsage + `) AS member_used_count,
	       r.created_at, r.updated_at
	FROM promo.offer_rules r`

// queryRules runs ruleSelect + where and attaches the items.
func (s *Service) queryRules(ctx context.Context, q database.Querier, where string, args ...any) ([]OfferRuleDetail, error) {
	rows, err := q.Query(ctx, ruleSelect+where, args...)
	rules, err := collect[OfferRuleDetail](rows, err)
	if err != nil || len(rules) == 0 {
		return rules, err
	}
	ids := make([]string, len(rules))
	for i, r := range rules {
		ids[i] = r.ID
	}
	rows, err = q.Query(ctx, `
		SELECT i.id, i.rule_id, i.role, i.product_id, i.category_id, i.qty::text, i.sort_order
		FROM promo.offer_rule_items i
		WHERE i.rule_id = ANY($1::uuid[])
		ORDER BY i.sort_order, i.created_at`, ids)
	items, err := collect[OfferRuleItem](rows, err)
	if err != nil {
		return nil, err
	}
	if err := s.nameItems(ctx, q, items); err != nil {
		return nil, err
	}
	byRule := map[string][]OfferRuleItem{}
	for _, item := range items {
		byRule[item.RuleID] = append(byRule[item.RuleID], item)
	}
	for i := range rules {
		rules[i].Items = orEmptyItems(byRule[rules[i].ID])
	}
	return rules, nil
}

// nameItems fills product_name and category_name (a LEFT JOIN on the POS
// catalog in the TS).
func (s *Service) nameItems(ctx context.Context, q database.Querier, items []OfferRuleItem) error {
	var productIDs, categoryIDs []string
	for _, item := range items {
		if item.ProductID != nil && !slices.Contains(productIDs, *item.ProductID) {
			productIDs = append(productIDs, *item.ProductID)
		}
		if item.CategoryID != nil && !slices.Contains(categoryIDs, *item.CategoryID) {
			categoryIDs = append(categoryIDs, *item.CategoryID)
		}
	}
	if len(productIDs) == 0 && len(categoryIDs) == 0 {
		return nil
	}
	products, categories, err := s.ports.Catalog.Names(ctx, q, productIDs, categoryIDs)
	if err != nil {
		return err
	}
	lookup := func(names map[string]string, id *string) *string {
		if id == nil {
			return nil
		}
		if name, ok := names[*id]; ok {
			return &name
		}
		return nil
	}
	for i := range items {
		items[i].ProductName = lookup(products, items[i].ProductID)
		items[i].CategoryName = lookup(categories, items[i].CategoryID)
	}
	return nil
}

func orEmptyItems(items []OfferRuleItem) []OfferRuleItem {
	if items == nil {
		return []OfferRuleItem{}
	}
	return items
}

func (s *Service) listOfferRules(ctx context.Context, v venue, offerType string) ([]OfferRuleDetail, error) {
	return s.queryRules(ctx, s.db, `
		WHERE r.company_id = $2 AND r.branch_id = $3 AND r.offer_type = $4
		ORDER BY r.priority DESC, r.created_at DESC`, nil, v.companyID, v.branchID, offerType)
}

// getOfferRule is nil when the rule is not in this venue.
func (s *Service) getOfferRule(ctx context.Context, v venue, id string) (*OfferRuleDetail, error) {
	rules, err := s.queryRules(ctx, s.db, `
		WHERE r.id = $4 AND r.company_id = $2 AND r.branch_id = $3
		LIMIT 1`, nil, v.companyID, v.branchID, id)
	if err != nil || len(rules) == 0 {
		return nil, err
	}
	return &rules[0], nil
}

const ruleColumns = `name, description, valid_from, valid_until, is_active,
  bundle_price, buy_qty, get_qty, get_mode, volume_basis, volume_min,
  discount_type, discount_value, sales_channels, max_uses,
  max_uses_per_member, is_exclusive, priority, unlock_code`

// ruleColumnValues are the ruleColumns values ($1..$19).
func ruleColumnValues(p domain.OfferRuleInput) []any {
	var channels []string
	for _, c := range p.SalesChannels {
		if c != "" {
			channels = append(channels, c)
		}
	}
	var unlockCode *string
	if p.UnlockCode != nil {
		unlockCode = nullIfEmpty(strings.ToUpper(validate.JSTrim(*p.UnlockCode)))
	}
	var description *string
	if p.Description != nil {
		description = nullIfEmpty(validate.JSTrim(*p.Description))
	}
	priority := 0
	if p.Priority != nil {
		priority = *p.Priority
	}
	return []any{
		validate.JSTrim(p.Name), description, nullIfEmptyPtr(p.ValidFrom), nullIfEmptyPtr(p.ValidUntil),
		p.IsActive == nil || *p.IsActive, p.BundlePrice, p.BuyQty, p.GetQty, p.GetMode, p.VolumeBasis, p.VolumeMin,
		p.DiscountType, p.DiscountValue, channels, p.MaxUses, p.MaxUsesPerMember,
		p.IsExclusive != nil && *p.IsExclusive, priority, unlockCode,
	}
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func nullIfEmptyPtr(s *string) *string {
	if s == nil {
		return nil
	}
	return nullIfEmpty(*s)
}

func replaceItems(ctx context.Context, tx pgx.Tx, ruleID string, items []domain.OfferRuleItemInput) error {
	if _, err := tx.Exec(ctx, `DELETE FROM promo.offer_rule_items WHERE rule_id = $1`, ruleID); err != nil {
		return err
	}
	for i, item := range items {
		qty := 1.0
		if item.Qty != nil && *item.Qty > 0 {
			qty = *item.Qty
		}
		sortOrder := i
		if item.SortOrder != nil {
			sortOrder = *item.SortOrder
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO promo.offer_rule_items
			  (rule_id, role, product_id, category_id, qty, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			ruleID, item.Role, nullIfEmptyPtr(item.ProductID), nullIfEmptyPtr(item.CategoryID), qty, sortOrder); err != nil {
			return err
		}
	}
	return nil
}

// offerInputError is OfferRuleInputError: a 400 with the message.
func offerInputError(err error) error {
	if database.IsUniqueViolation(err) {
		return httpx.BadRequest("Kode pembuka sudah dipakai penawaran lain — pilih kode lain")
	}
	return err
}

func (s *Service) createOfferRule(ctx context.Context, v venue, userID string, p domain.OfferRuleInput) (*OfferRuleDetail, error) {
	if msg := domain.ValidateOfferRule(p); msg != "" {
		return nil, httpx.BadRequest(msg)
	}
	var id string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		args := append(ruleColumnValues(p), v.companyID, v.branchID, p.OfferType, userID)
		if err := tx.QueryRow(ctx, `
			INSERT INTO promo.offer_rules (
			  `+ruleColumns+`, company_id, branch_id, offer_type, created_by
			) VALUES (
			  $1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
			  $20,$21,$22,$23
			) RETURNING id`, args...).Scan(&id); err != nil {
			return err
		}
		return replaceItems(ctx, tx, id, p.Items)
	})
	if err != nil {
		return nil, offerInputError(err)
	}
	detail, err := s.getOfferRule(ctx, v, id)
	if err == nil && detail == nil {
		err = errors.New("Gagal memuat aturan yang baru dibuat")
	}
	return detail, err
}

// updateOfferRule replaces the rule columns and items; the offer type
// never changes.
func (s *Service) updateOfferRule(ctx context.Context, v venue, id string, p domain.OfferRuleInput) (*OfferRuleDetail, error) {
	existing, err := s.getOfferRule(ctx, v, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, httpx.BadRequest("Aturan tidak ditemukan")
	}
	p.OfferType = existing.OfferType
	if msg := domain.ValidateOfferRule(p); msg != "" {
		return nil, httpx.BadRequest(msg)
	}
	var sets []string
	for i, column := range strings.Split(ruleColumns, ",") {
		name := strings.TrimSpace(column)
		cast := ""
		if name == "valid_from" || name == "valid_until" {
			cast = "::date"
		}
		sets = append(sets, name+" = $"+strconv.Itoa(i+1)+cast)
	}
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		args := append(ruleColumnValues(p), id, v.companyID, v.branchID)
		if _, err := tx.Exec(ctx, `UPDATE promo.offer_rules SET `+strings.Join(sets, ", ")+`, updated_at = now()
			WHERE id = $20 AND company_id = $21 AND branch_id = $22`, args...); err != nil {
			return err
		}
		return replaceItems(ctx, tx, id, p.Items)
	})
	if err != nil {
		return nil, offerInputError(err)
	}
	detail, err := s.getOfferRule(ctx, v, id)
	if err == nil && detail == nil {
		err = errors.New("Gagal memuat aturan")
	}
	return detail, err
}

func (s *Service) deleteOfferRule(ctx context.Context, v venue, id string) (bool, error) {
	tag, err := s.db.Exec(ctx, `DELETE FROM promo.offer_rules
		WHERE id = $1 AND company_id = $2 AND branch_id = $3`, id, v.companyID, v.branchID)
	return tag.RowsAffected() > 0, err
}

/* ── checkout-facing (POS sales) ─────────────────────────────────────── */

// ActiveOffersInput selects the active offers of a venue on a day.
type ActiveOffersInput struct {
	CompanyID    string
	BranchID     string
	TodayISODate string
	// CustomerID fills MemberUsedCount so the per-member quota evaluates
	// the same on client and server; nil or "" = no member.
	CustomerID *string
}

// ListActiveOfferRules is listActiveOfferRules: active rules within their
// period (every type), by type, priority and newest first.
func (s *Service) ListActiveOfferRules(ctx context.Context, q database.Querier, in ActiveOffersInput) ([]OfferRuleDetail, error) {
	return s.queryRules(ctx, q, `
		WHERE r.company_id = $2
		  AND r.branch_id = $3
		  AND r.is_active = true
		  AND (r.valid_from IS NULL OR r.valid_from <= $4::date)
		  AND (r.valid_until IS NULL OR r.valid_until >= $4::date)
		ORDER BY r.offer_type, r.priority DESC, r.created_at DESC`,
		nullIfEmptyPtr(in.CustomerID), in.CompanyID, in.BranchID, in.TodayISODate)
}

// LoadCategoryProductMap is loadCategoryProductMap: the member products of
// every category the rules target (for domain.ExpandCategoryTargets).
func (s *Service) LoadCategoryProductMap(ctx context.Context, q database.Querier, details []OfferRuleDetail) (map[string][]string, error) {
	var categoryIDs []string
	for _, rule := range details {
		for _, item := range rule.Items {
			if item.CategoryID != nil && *item.CategoryID != "" && !slices.Contains(categoryIDs, *item.CategoryID) {
				categoryIDs = append(categoryIDs, *item.CategoryID)
			}
		}
	}
	if len(categoryIDs) == 0 {
		return map[string][]string{}, nil
	}
	return s.ports.Catalog.CategoryProducts(ctx, q, categoryIDs)
}

// UnlockedOffer is an offer opened by its unlock code.
type UnlockedOffer struct {
	ID   string
	Name string
}

// UnlockCodeInput looks up an unlock code.
type UnlockCodeInput struct {
	CompanyID    string
	BranchID     string
	Code         string
	TodayISODate string
}

// FindOfferByUnlockCode is findOfferByUnlockCode: the active offer this
// code opens (case-insensitive), or nil.
func (s *Service) FindOfferByUnlockCode(ctx context.Context, q database.Querier, in UnlockCodeInput) (*UnlockedOffer, error) {
	code := validate.JSTrim(in.Code)
	if code == "" {
		return nil, nil
	}
	var o UnlockedOffer
	err := q.QueryRow(ctx, `
		SELECT id, name FROM promo.offer_rules
		WHERE company_id = $1 AND branch_id = $2
		  AND unlock_code IS NOT NULL AND upper(unlock_code) = upper($3)
		  AND is_active = true
		  AND (valid_from IS NULL OR valid_from <= $4::date)
		  AND (valid_until IS NULL OR valid_until >= $4::date)
		LIMIT 1`, in.CompanyID, in.BranchID, code, in.TodayISODate).Scan(&o.ID, &o.Name)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// ToOfferEvalRules is toOfferEvalRules: the evaluator view of the rules.
func ToOfferEvalRules(details []OfferRuleDetail) []domain.OfferEvalRule {
	out := make([]domain.OfferEvalRule, len(details))
	for i, r := range details {
		items := make([]domain.OfferEvalItem, len(r.Items))
		for j, item := range r.Items {
			qty, _ := strconv.ParseFloat(item.Qty, 64)
			if qty == 0 {
				qty = 1
			}
			productID := ""
			if item.ProductID != nil {
				productID = *item.ProductID
			}
			items[j] = domain.OfferEvalItem{Role: item.Role, ProductID: productID, CategoryID: item.CategoryID, Qty: qty}
		}
		out[i] = domain.OfferEvalRule{
			ID: r.ID, OfferType: r.OfferType, Name: r.Name, Description: r.Description,
			BundlePrice: parseNumeric(r.BundlePrice), BuyQty: r.BuyQty, GetQty: r.GetQty,
			GetMode:       oneOf(r.GetMode, "same_as_buy", "specific_products"),
			VolumeBasis:   oneOf(r.VolumeBasis, "qty", "spend"),
			VolumeMin:     parseNumeric(r.VolumeMin),
			DiscountType:  oneOf(r.DiscountType, "percent", "fixed"),
			DiscountValue: parseNumeric(r.DiscountValue),
			SalesChannels: r.SalesChannels, RequiresCode: r.UnlockCode != nil && *r.UnlockCode != "",
			IsExclusive: r.IsExclusive, Priority: r.Priority,
			MaxUses: r.MaxUses, UsedCount: r.UsedCount,
			MaxUsesPerMember: r.MaxUsesPerMember, MemberUsedCount: r.MemberUsedCount,
			Items: items,
		}
	}
	return out
}

func parseNumeric(s *string) *float64 {
	if s == nil {
		return nil
	}
	v, _ := strconv.ParseFloat(*s, 64)
	return &v
}

func oneOf(s *string, options ...string) *string {
	if s == nil || !slices.Contains(options, *s) {
		return nil
	}
	return s
}

// OfferCapReachedError is OfferCapReachedError: the offer ran out of quota
// while the order was placed (HTTP 422).
type OfferCapReachedError struct{ OfferName string }

// StatusCode is the HTTP status the TS attaches.
func (e *OfferCapReachedError) StatusCode() int { return 422 }

func (e *OfferCapReachedError) Error() string {
	return `Kuota penawaran "` + e.OfferName + `" sudah habis — muat ulang keranjang`
}

// RecordOfferUsageInput records the offers applied to one order.
type RecordOfferUsageInput struct {
	CompanyID  *string
	BranchID   *string
	OrderID    string
	CustomerID *string
	Applied    []domain.AppliedOffer
	Status     string // "held" | "captured"
	// Enforce locks each rule and rejects a spent quota; without it (an
	// open bill whose lines are already stored) the usage is only recorded.
	Enforce bool
}

// RecordOfferUsage is recordOfferUsage, inside the caller's transaction:
// rules in id order (so two orders never deadlock), each under
// pg_advisory_xact_lock(hashtext('offer'), hashtext(rule_id)) when
// enforcing, live counts checked, then an insert that is idempotent per
// (rule, order) through ON CONFLICT DO NOTHING. A spent quota is an
// *OfferCapReachedError.
func (s *Service) RecordOfferUsage(ctx context.Context, q database.Querier, in RecordOfferUsageInput) error {
	applied := slices.Clone(in.Applied)
	slices.SortStableFunc(applied, func(a, b domain.AppliedOffer) int { return strings.Compare(a.RuleID, b.RuleID) })
	for _, offer := range applied {
		if in.Enforce {
			if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('offer'), hashtext($1::text))`, offer.RuleID); err != nil {
				return err
			}
			var caps domain.OfferCaps
			err := q.QueryRow(ctx, `
				SELECT r.max_uses, r.max_uses_per_member,
				       (SELECT COUNT(*)::int FROM promo.offer_usages u
				         WHERE u.rule_id = r.id AND `+liveUsage+`) AS used_count,
				       (SELECT COUNT(*)::int FROM promo.offer_usages u
				         WHERE u.rule_id = r.id AND u.customer_id = $2::uuid AND `+liveUsage+`) AS member_used_count
				FROM promo.offer_rules r WHERE r.id = $1`, offer.RuleID, nullIfEmptyPtr(in.CustomerID),
			).Scan(&caps.MaxUses, &caps.MaxUsesPerMember, &caps.UsedCount, &caps.MemberUsedCount)
			switch {
			case err == nil:
				if domain.OfferCapReason(caps) != "" {
					return &OfferCapReachedError{OfferName: offer.Name}
				}
			case !database.IsNoRows(err):
				return err
			}
		}
		if _, err := q.Exec(ctx, `
			INSERT INTO promo.offer_usages
			  (company_id, branch_id, rule_id, order_id, customer_id, discount_amount, status)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (rule_id, order_id) DO NOTHING`,
			in.CompanyID, in.BranchID, offer.RuleID, in.OrderID, nullIfEmptyPtr(in.CustomerID), offer.Discount, in.Status); err != nil {
			return err
		}
	}
	return nil
}

// CaptureOfferUsage turns the order's held uses into captured (order
// paid). Idempotent.
func (s *Service) CaptureOfferUsage(ctx context.Context, q database.Querier, orderID string) error {
	_, err := q.Exec(ctx, `UPDATE promo.offer_usages SET status = 'captured', updated_at = now()
		WHERE order_id = $1 AND status = 'held'`, orderID)
	return err
}

// ReleaseOfferUsage gives the order's quota back (void). Idempotent.
func (s *Service) ReleaseOfferUsage(ctx context.Context, q database.Querier, orderID string) error {
	_, err := q.Exec(ctx, `UPDATE promo.offer_usages SET status = 'released', updated_at = now()
		WHERE order_id = $1 AND status <> 'released'`, orderID)
	return err
}

// LoadActiveOfferEvalRules is loadActiveOfferEvalRules: today's active
// rules (Asia/Jakarta) and their evaluator view with category targets
// expanded. The cashier endpoint and order creation both use it, so client
// and server discounts come from identical rules.
func (s *Service) LoadActiveOfferEvalRules(ctx context.Context, q database.Querier, companyID, branchID string, customerID *string) ([]OfferRuleDetail, []domain.OfferEvalRule, error) {
	details, err := s.ListActiveOfferRules(ctx, q, ActiveOffersInput{
		CompanyID: companyID, BranchID: branchID, TodayISODate: s.TodayJakarta(), CustomerID: customerID,
	})
	if err != nil {
		return nil, nil, err
	}
	if len(details) == 0 {
		return details, []domain.OfferEvalRule{}, nil
	}
	byCategory, err := s.LoadCategoryProductMap(ctx, q, details)
	if err != nil {
		return nil, nil, err
	}
	return details, domain.ExpandCategoryTargets(ToOfferEvalRules(details), byCategory), nil
}

// PosOfferResult is the cart evaluation plus the offer the typed code
// unlocked (nil when the code is not an unlock code).
type PosOfferResult struct {
	OfferDiscount  float64               `json:"offer_discount"`
	Applied        []domain.AppliedOffer `json:"applied"`
	UnlockedRuleID *string               `json:"unlocked_rule_id"`
}

// PosCartInput is a POS cart to evaluate.
type PosCartInput struct {
	// CompanyID or BranchID "" = no venue: nothing applies.
	CompanyID  string
	BranchID   string
	Items      []domain.OfferCartLine
	Code       string // what the cashier typed, "" = none
	CustomerID *string
}

// EvaluateActiveOffersForPosCart is evaluateActiveOffersForPosCart: the
// active offers on a POS cart (channel "pos"). When Code matches an unlock
// code that offer joins and UnlockedRuleID is set; the caller then no
// longer treats the code as a promo campaign code.
func (s *Service) EvaluateActiveOffersForPosCart(ctx context.Context, q database.Querier, in PosCartInput) (PosOfferResult, error) {
	result := PosOfferResult{Applied: []domain.AppliedOffer{}}
	if in.CompanyID == "" || in.BranchID == "" {
		return result, nil
	}
	var unlocked []string
	if in.Code != "" {
		offer, err := s.FindOfferByUnlockCode(ctx, q, UnlockCodeInput{
			CompanyID: in.CompanyID, BranchID: in.BranchID, Code: in.Code, TodayISODate: s.TodayJakarta(),
		})
		if err != nil {
			return result, err
		}
		if offer != nil {
			result.UnlockedRuleID = &offer.ID
			unlocked = []string{offer.ID}
		}
	}
	if len(in.Items) == 0 {
		return result, nil
	}
	_, rules, err := s.LoadActiveOfferEvalRules(ctx, q, in.CompanyID, in.BranchID, in.CustomerID)
	if err != nil {
		return result, err
	}
	eval := domain.EvaluateOfferRules(in.Items, rules, domain.OfferEvalContext{Channel: "pos", UnlockedRuleIDs: unlocked})
	result.OfferDiscount, result.Applied = eval.OfferDiscount, eval.Applied
	return result, nil
}
